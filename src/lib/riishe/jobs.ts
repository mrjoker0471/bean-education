// ─── Riishe durable job runner (Phase 2A) ────────────────────────────────────
// Replaces the Phase 1 in-process Maps with durable storage:
//   • Persistent job state lives in RiisheJob — one row per (kind, refId).
//   • Atomic claims: a status-guarded UPDATE (compare-and-set) — a job can
//     only ever be claimed by exactly one worker, across processes.
//   • Lease-based recovery: RUNNING rows hold a lease that is heartbeated;
//     an expired lease means the process died — the job is re-queued (bounded
//     by maxAttempts) or FAILED honestly, and the domain row is reconciled.
//   • Per-owner limits: at most MAX_OWNER_RUNNING jobs run per owner; a soft
//     cap bounds pending jobs per owner.
//   • Hourly provider-protection quotas are durable (JobQuota) with race-safe
//     reservation (conditional UPDATE) and release on failure/cancellation.
//   • Explicit cancellation: QUEUED jobs can be cancelled (materials DELETE);
//     RUNNING jobs are bounded by their lease and finish their current stage.
//
// SQLite concurrency note: claims are atomic via conditional UPDATE statements
// (SQLite serialises writers), so the queue is safe for a single-node
// deployment including multi-process access. Claim safety does NOT depend on
// this process's in-memory state; the worker loop only schedules.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { WorkerLoopLiveness } from '@/lib/worker-liveness'
import { processDocument } from './pipeline'
import { generateTestJob } from './generate'
import { explainAttemptJob } from './explain'
import { runResearchJob } from './research'

export type JobKind = 'DOCUMENT_ANALYSIS' | 'TEST_GENERATION' | 'EXPLANATION' | 'DEEP_RESEARCH'
export type QuotaKind = 'analyse' | 'generate' | 'explain' | 'research'

/** Legacy constant kept for domain-row recovery semantics (12 min). */
export const STALE_MS = 12 * 60_000

const LEASE_MS = 12 * 60_000
const POLL_MS = 2_500
const MAX_OWNER_RUNNING = 2
const MAX_OWNER_PENDING = 10

export const QUOTA_LIMITS: Record<QuotaKind, number> = {
  analyse: 30,
  generate: 12,
  explain: 6,
  research: 6,
}

function kindToQuota(kind: JobKind): QuotaKind {
  if (kind === 'DOCUMENT_ANALYSIS') return 'analyse'
  if (kind === 'TEST_GENERATION') return 'generate'
  if (kind === 'DEEP_RESEARCH') return 'research'
  return 'explain'
}

// ─── Enqueue / cancel ─────────────────────────────────────────────────────────

export interface EnqueueResult { jobId: string; alreadyQueued: boolean }

/** Enqueue (or re-enqueue) a durable job. A (kind, refId) pair is unique: an
 *  existing QUEUED/RUNNING job is reused (no duplicate generation after
 *  recovery); a terminal row is reset for a fresh run. */
export async function enqueueJob(opts: { kind: JobKind; refId: string; ownerId: string; payload?: Record<string, unknown> }): Promise<EnqueueResult> {
  const existing = await db.riisheJob.findUnique({
    where: { kind_refId: { kind: opts.kind, refId: opts.refId } },
    select: { id: true, status: true, ownerId: true },
  })

  if (existing && (existing.status === 'QUEUED' || existing.status === 'RUNNING')) {
    return { jobId: existing.id, alreadyQueued: true }
  }

  // Soft per-owner pending cap — honest rejection instead of silent pile-up
  const pending = await db.riisheJob.count({ where: { ownerId: opts.ownerId, status: { in: ['QUEUED', 'RUNNING'] } } })
  if (pending >= MAX_OWNER_PENDING) {
    throw Object.assign(
      new Error(`Too many queued Riishe jobs (${pending}) — please wait for the current ones to finish.`),
      { status: 429 },
    )
  }

  const reset = {
    status: 'QUEUED',
    attempts: 0,
    error: null,
    claimedAt: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    payloadJson: opts.payload ? JSON.stringify(opts.payload) : null,
    updatedAt: new Date(),
  }
  const row = existing
    ? await db.riisheJob.update({ where: { id: existing.id }, data: reset })
    : await db.riisheJob.create({ data: { kind: opts.kind, refId: opts.refId, ownerId: opts.ownerId, payloadJson: opts.payload ? JSON.stringify(opts.payload) : null } })

  ensureWorker()
  return { jobId: row.id, alreadyQueued: false }
}

/** Cancel a QUEUED job (no-op for RUNNING jobs — they are lease-bounded). */
export async function cancelJob(kind: JobKind, refId: string): Promise<boolean> {
  const now = new Date()
  const cancelled = await db.riisheJob.updateMany({
    where: { kind, refId, status: 'QUEUED' },
    data: { status: 'CANCELLED', finishedAt: now },
  })
  if (cancelled.count > 0) {
    // release the quota reservation the cancelled job will never consume
    const row = await db.riisheJob.findFirst({ where: { kind, refId }, select: { ownerId: true } })
    if (row) await releaseQuota(row.ownerId, kindToQuota(kind))
    void purgeOldJobRows()
    return true
  }
  return false
}

// ─── Worker loop ───────────────────────────────────────────────────────────────

const workerG = globalThis as unknown as {
  __riisheWorker?: { busy: boolean; timer: NodeJS.Timeout; lastPurge: number; lastTickAt: number | null }
}

/** Start the singleton worker loop (idempotent, survives module reloads). */
export function ensureWorker(): void {
  if (workerG.__riisheWorker) return
  const state = { busy: false, timer: undefined as unknown as NodeJS.Timeout, lastPurge: 0, lastTickAt: null as number | null }
  state.timer = setInterval(() => {
    void tick().catch(err => console.error('[riishe worker tick]', err))
  }, POLL_MS)
  state.timer.unref?.() // never hold the process open just for the queue
  workerG.__riisheWorker = state
}

/** Test hook: stop the loop (mirrors stopCiWorkerForTests/stopFleetWorkerForTests). */
export function stopRiisheWorkerForTests(): void {
  const state = workerG.__riisheWorker
  if (state) {
    clearInterval(state.timer)
    workerG.__riisheWorker = undefined
  }
}

/** Read-only liveness of this module's own worker loop (the registration
 *  authority — health reporting reads this, never a second registry). */
export function riisheWorkerLiveness(): WorkerLoopLiveness {
  const state = workerG.__riisheWorker
  return { registered: !!state, lastTickAt: state?.lastTickAt ?? null }
}

async function tick(): Promise<void> {
  const state = workerG.__riisheWorker
  if (!state || state.busy) return
  state.busy = true
  state.lastTickAt = Date.now()
  try {
    await recoverExpiredLeases()
    // Claim up to 2 jobs per tick; runJob runs in the background so one slow
    // job never blocks claiming work for other owners.
    for (let i = 0; i < 2; i++) {
      const job = await claimNextJob()
      if (!job) break
      void runJob(job).catch(err => console.error('[riishe worker runJob]', err))
    }
    if (Date.now() - state.lastPurge > 5 * 60_000) {
      state.lastPurge = Date.now()
      void purgeOldJobRows()
      void purgeOldQuotaWindows()
    }
  } finally {
    state.busy = false
  }
}

interface ClaimableJob { id: string; kind: JobKind; refId: string; ownerId: string; payloadJson: string | null }

/** Atomically claim the next runnable job for this worker. */
async function claimNextJob(): Promise<ClaimableJob | null> {
  const candidates = await db.riisheJob.findMany({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true, kind: true, refId: true, ownerId: true, payloadJson: true },
  })
  const now = new Date()
  for (const c of candidates) {
    const kind = c.kind as JobKind
    // Per-owner concurrency limit
    const running = await db.riisheJob.count({ where: { ownerId: c.ownerId, status: 'RUNNING' } })
    if (running >= MAX_OWNER_RUNNING) continue
    // CAS claim — atomic even across processes: only one claimer wins.
    const claimed = await db.riisheJob.updateMany({
      where: { id: c.id, status: 'QUEUED' },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        claimedAt: now,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        startedAt: now,
      },
    })
    if (claimed.count === 1) return { ...c, kind }
  }
  return null
}

/** Execute a claimed job, heartbeating its lease while it runs. */
async function runJob(job: ClaimableJob): Promise<void> {
  const heartbeat = setInterval(() => {
    void db.riisheJob.updateMany({
      where: { id: job.id, status: 'RUNNING' },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    }).catch(() => undefined)
  }, 60_000)
  try {
    await execJob(job)
    await db.riisheJob.updateMany({
      where: { id: job.id, status: 'RUNNING' },
      data: { status: 'COMPLETED', finishedAt: new Date(), leaseUntil: null, error: null },
    })
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const current = await db.riisheJob.findUnique({ where: { id: job.id }, select: { attempts: true, maxAttempts: true } })
    const canRetry = !!current && current.attempts < current.maxAttempts
    const updated = await db.riisheJob.updateMany({
      where: { id: job.id, status: 'RUNNING' },
      data: canRetry
        ? { status: 'QUEUED', leaseUntil: null, claimedAt: null, error: msg } // retry with the reservation still held
        : { status: 'FAILED', finishedAt: new Date(), leaseUntil: null, error: msg },
    })
    if (updated.count === 1 && !canRetry) {
      await releaseQuota(job.ownerId, kindToQuota(job.kind))
      await markDomainFailed(job.kind, job.refId, msg)
    }
  } finally {
    clearInterval(heartbeat)
  }
}

async function execJob(job: ClaimableJob): Promise<void> {
  if (job.kind === 'DOCUMENT_ANALYSIS') {
    const payload = safeParse<{ force?: boolean }>(job.payloadJson ?? '', {})
    return processDocument(job.refId, { force: payload?.force === true })
  }
  if (job.kind === 'TEST_GENERATION') return generateTestJob(job.refId)
  if (job.kind === 'EXPLANATION') return explainAttemptJob(job.refId, job.ownerId)
  if (job.kind === 'DEEP_RESEARCH') return runResearchJob(job.refId)
  throw new Error(`Unknown job kind: ${job.kind}`)
}

/** Lease recovery: a RUNNING job whose lease expired was interrupted. */
async function recoverExpiredLeases(): Promise<void> {
  const now = new Date()
  const stale = await db.riisheJob.findMany({
    where: { status: 'RUNNING', leaseUntil: { lt: now } },
    select: { id: true, attempts: true, maxAttempts: true, kind: true, refId: true, ownerId: true, error: true },
  })
  for (const j of stale) {
    if (j.attempts < j.maxAttempts) {
      // bounded retry — the reservation stays held until a terminal outcome
      await db.riisheJob.updateMany({
        where: { id: j.id, status: 'RUNNING', leaseUntil: { lt: now } },
        data: { status: 'QUEUED', leaseUntil: null, claimedAt: null },
      })
      continue
    }
    const updated = await db.riisheJob.updateMany({
      where: { id: j.id, status: 'RUNNING', leaseUntil: { lt: now } },
      data: {
        status: 'FAILED',
        finishedAt: now,
        leaseUntil: null,
        error: j.error ?? 'Job lease expired (the server restarted or the job was interrupted).',
      },
    })
    if (updated.count === 1) {
      await releaseQuota(j.ownerId, kindToQuota(j.kind as JobKind))
      await markDomainFailed(j.kind, j.refId, j.error ?? undefined)
    }
  }
}

/** Keep the domain row honest when a job dies terminally (matches Phase 1
 *  recovery messages so the UI guidance stays identical). */
async function markDomainFailed(kind: string, refId: string, error?: string): Promise<void> {
  const detail = error
    ? `Processing was interrupted: ${error.slice(0, 180)} You can retry it.`
    : 'Processing was interrupted (the server restarted or the job timed out). You can retry it.'
  try {
    if (kind === 'DOCUMENT_ANALYSIS') {
      await db.studyDocument.updateMany({
        where: { id: refId, status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING'] } },
        data: { status: 'FAILED', statusDetail: detail },
      })
    } else if (kind === 'TEST_GENERATION') {
      await db.riisheTest.updateMany({
        where: { id: refId, status: { in: ['QUEUED', 'GENERATING'] } },
        data: { status: 'FAILED', statusDetail: detail },
      })
    } else if (kind === 'DEEP_RESEARCH') {
      await db.researchSession.updateMany({
        where: { id: refId, status: { in: ['QUEUED', 'RESEARCHING'] } },
        data: { status: 'FAILED', statusDetail: detail },
      })
    }
  } catch (err) {
    console.error('[riishe worker markDomainFailed]', err)
  }
}

// ─── Domain-row recovery (called from poll/list endpoints, Phase 1 contract) ──

export async function recoverStaleDocuments(ids?: string[]) {
  const cutoff = new Date(Date.now() - STALE_MS)
  const where = {
    status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING'] },
    updatedAt: { lt: cutoff },
    ...(ids && ids.length ? { id: { in: ids } } : {}),
  }
  const stale = await db.studyDocument.findMany({ where, select: { id: true } })
  for (const d of stale) {
    // Only fail it if no live durable job exists for it
    const live = await db.riisheJob.findFirst({
      where: { kind: 'DOCUMENT_ANALYSIS', refId: d.id, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    })
    if (live) continue
    await db.studyDocument.update({
      where: { id: d.id },
      data: {
        status: 'FAILED',
        statusDetail: 'Processing was interrupted (the server restarted or the job timed out). You can retry it.',
      },
    })
  }
}

export async function recoverStaleTests(ids?: string[]) {
  const cutoff = new Date(Date.now() - STALE_MS)
  const where = {
    status: { in: ['QUEUED', 'GENERATING'] },
    updatedAt: { lt: cutoff },
    ...(ids && ids.length ? { id: { in: ids } } : {}),
  }
  const stale = await db.riisheTest.findMany({ where, select: { id: true } })
  for (const t of stale) {
    const live = await db.riisheJob.findFirst({
      where: { kind: 'TEST_GENERATION', refId: t.id, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    })
    if (live) continue
    await db.riisheTest.update({
      where: { id: t.id },
      data: {
        status: 'FAILED',
        statusDetail: 'Generation was interrupted (the server restarted or the job timed out). You can start a new one.',
      },
    })
  }
}

/** Phase 3A: research sessions stuck mid-run without a live job → honest FAILED. */
export async function recoverStaleResearch(ids?: string[]) {
  const cutoff = new Date(Date.now() - STALE_MS)
  const where = {
    status: { in: ['QUEUED', 'RESEARCHING'] },
    updatedAt: { lt: cutoff },
    ...(ids && ids.length ? { id: { in: ids } } : {}),
  }
  const stale = await db.researchSession.findMany({ where, select: { id: true } })
  for (const s of stale) {
    const live = await db.riisheJob.findFirst({
      where: { kind: 'DEEP_RESEARCH', refId: s.id, status: { in: ['QUEUED', 'RUNNING'] } },
      select: { id: true },
    })
    if (live) continue
    await db.researchSession.update({
      where: { id: s.id },
      data: {
        status: 'FAILED',
        statusDetail: 'Research was interrupted (the server restarted or the run timed out). You can start a new run.',
        finishedAt: new Date(),
      },
    })
  }
}

// ─── Durable hourly quotas (Phase 2A) ──────────────────────────────────────────
// Reservation is a conditional UPDATE (count < limit → increment) — race-safe
// under SQLite's single-writer serialisation, durable across restarts. The
// reservation is released when a job fails terminally or is cancelled.

function hourWindow(): { windowKey: string; windowStart: Date } {
  const start = new Date()
  start.setUTCMinutes(0, 0, 0)
  return { windowKey: start.toISOString().slice(0, 13), windowStart: start }
}

/** Reserve one slot in this hour's quota window. Returns false when exhausted. */
export async function reserveQuota(ownerKey: string, kind: QuotaKind, limit: number = QUOTA_LIMITS[kind]): Promise<boolean> {
  const { windowKey, windowStart } = hourWindow()
  const bump = () => db.jobQuota.updateMany({
    where: { ownerKey, kind, windowKey, count: { lt: limit } },
    data: { count: { increment: 1 } },
  })
  const first = await bump()
  if (first.count === 1) return true
  try {
    await db.jobQuota.create({ data: { ownerKey, kind, windowKey, windowStart, count: 1 } })
    return true
  } catch {
    // another request created the row first — retry the conditional increment
    const retry = await bump()
    return retry.count === 1
  }
}

/** Release a reservation (job failed / was cancelled — the slot is free again). */
export async function releaseQuota(ownerKey: string, kind: QuotaKind): Promise<void> {
  const { windowKey } = hourWindow()
  try {
    await db.jobQuota.updateMany({
      where: { ownerKey, kind, windowKey, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    })
  } catch (err) {
    console.error('[riishe worker releaseQuota]', err)
  }
}

// ─── Lazy housekeeping ────────────────────────────────────────────────────────

async function purgeOldJobRows(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000)
    await db.riisheJob.deleteMany({ where: { status: { in: ['COMPLETED', 'CANCELLED'] }, finishedAt: { lt: cutoff } } })
  } catch { /* housekeeping is best-effort */ }
}

async function purgeOldQuotaWindows(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 60_000)
    await db.jobQuota.deleteMany({ where: { windowStart: { lt: cutoff } } })
  } catch { /* housekeeping is best-effort */ }
}

/** Parse an attempt's config with the untimed-aware defaults. */
export function parseAttemptConfig(json: string) {
  return safeParse(json, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0, timed: true })
}
