// ─── Riishe job runner ────────────────────────────────────────────────────────
// In-process background jobs with DB-persisted status. The client polls; a job
// never blocks the HTTP request that started it. Deduplication: one job per
// key (document / test / attempt) — a retried request reuses the running job.
// Stale recovery: a job stuck in a processing state for > STALE_MS (e.g. the
// server restarted mid-job) is marked FAILED honestly instead of spinning.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'

const running = new Map<string, Promise<void>>()

export function runOnce(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = running.get(key)
  if (existing) return existing
  const p = fn()
    .catch(err => {
      console.error(`[riishe job ${key}]`, err)
    })
    .finally(() => {
      running.delete(key)
    })
  running.set(key, p)
  return p
}

export const STALE_MS = 12 * 60_000

/** Mark stale processing rows as FAILED (called from poll/list endpoints). */
export async function recoverStaleDocuments(ids?: string[]) {
  const cutoff = new Date(Date.now() - STALE_MS)
  const where = {
    status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING'] },
    updatedAt: { lt: cutoff },
    ...(ids && ids.length ? { id: { in: ids } } : {}),
  }
  const stale = await db.studyDocument.findMany({ where, select: { id: true } })
  for (const d of stale) {
    // Only fail it if no in-memory job is actually running for it
    if (running.has(`doc:${d.id}`)) continue
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
    if (running.has(`test:${t.id}`)) continue
    await db.riisheTest.update({
      where: { id: t.id },
      data: {
        status: 'FAILED',
        statusDetail: 'Generation was interrupted (the server restarted or the job timed out). You can start a new one.',
      },
    })
  }
}

/** Simple per-guest concurrency guard for expensive AI jobs. */
const guestJobs = new Map<string, number>()
const MAX_GUEST_JOBS = 2

export function guestJobSlots(guestId: string): number {
  return guestJobs.get(guestId) ?? 0
}

export async function withGuestSlot<T>(guestId: string, fn: () => Promise<T>): Promise<T> {
  if ((guestJobs.get(guestId) ?? 0) >= MAX_GUEST_JOBS) {
    throw Object.assign(new Error('You already have 2 Riishe jobs running — please wait for them to finish.'), { status: 429 })
  }
  guestJobs.set(guestId, (guestJobs.get(guestId) ?? 0) + 1)
  try {
    return await fn()
  } finally {
    guestJobs.set(guestId, Math.max(0, (guestJobs.get(guestId) ?? 1) - 1))
  }
}

// ─── Per-guest FIFO queue: expensive AI jobs run one after another ───────────
const guestQueues = new Map<string, Promise<unknown>>()

/** Chain a job onto the guest's queue — keeps status transitions honest and
 * prevents provider stampedes; the queue continues even if an earlier job failed. */
export function enqueueGuestJob<T>(guestId: string, key: string, fn: () => Promise<T>): Promise<T> {
  const prev = guestQueues.get(guestId) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  guestQueues.set(guestId, next)
  return next
}

/** Combined dedupe + FIFO queue: same key never runs twice concurrently and
 * jobs for one guest run sequentially (provider-friendly, honest statuses). */
export function queueOnce<T>(guestId: string, key: string, fn: () => Promise<T>): Promise<T> {
  const existing = running.get(key)
  if (existing) return existing as unknown as Promise<T>
  const p = enqueueGuestJob(guestId, key, fn)
    .catch(err => {
      console.error(`[riishe job ${key}]`, err)
    })
    .finally(() => {
      running.delete(key)
    }) as unknown as Promise<T>
  running.set(key, p as unknown as Promise<void>)
  return p
}

// ─── Per-guest hourly caps for provider quota protection ─────────────────────
const hourly = new Map<string, number[]>()
const HOUR_MS = 60 * 60_000

export function checkHourlyQuota(guestId: string, kind: 'analyse' | 'generate' | 'explain', limit: number) {
  const now = Date.now()
  const key = `${kind}:${guestId}`
  const hits = (hourly.get(key) ?? []).filter(t => now - t < HOUR_MS)
  if (hits.length >= limit) {
    throw Object.assign(new Error(`Hourly limit reached for ${kind} (${limit}/hour) — please try again later.`), { status: 429 })
  }
  hits.push(now)
  hourly.set(key, hits)
}

/** Parse an attempt's config with the untimed-aware defaults. */
export function parseAttemptConfig(json: string) {
  return safeParse(json, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0, timed: true })
}
