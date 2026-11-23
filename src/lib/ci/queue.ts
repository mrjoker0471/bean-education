// ─── BEAN Classroom Intelligence (CI-1B): durable evaluation queue ───────────
// Dedicated durable queue for classroom evaluations, mirroring the proven
// Riishe runner semantics (docs/CLASSROOM-INTELLIGENCE-ARCHITECTURE.md §3):
//   • One job per class — ClassroomEvaluationJob.classSessionId is UNIQUE, so
//     duplicate prevention is a DB guarantee, not a best effort.
//   • Atomic claims via conditional UPDATE (CAS) — safe across processes.
//   • Lease-based recovery with heartbeats — a dead worker's job is re-queued
//     (bounded by maxAttempts) or FAILED honestly.
//   • Failure isolation — a failed evaluation never touches the class,
//     bookings, attendance or live-session state. Classroom routes never
//     wait on this pipeline.
//   • Consent gate — evaluations are created only for teachers whose
//     ConsentRecord (purpose CLASSROOM_INTELLIGENCE_TEACHER) is currently
//     granted. Withdrawal stops future evaluations immediately.

import { db } from '@/lib/db'
import {
  CI_AGENT,
  CI_JOB_STATUS,
  CI_LEASE_MS,
  CI_MAX_ATTEMPTS,
  CI_POLL_MS,
  CI_STAGE,
  CI_TRIGGER,
  CI_CONSENT_PURPOSE,
} from './constants'
import type { EvidenceBundle } from './evidence'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

// ─── Pipeline seam (dependency inversion) ──────────────────────────────────────
// The queue owns scheduling; the multi-agent pipeline (CI-1C) owns execution.
// execJob resolves the pipeline dynamically so this module stays independently
// testable — and so a deployment without the agents fails HONESTLY (job
// FAILED with a clear error) instead of pretending to run.

export interface EvaluationPipelineContext {
  jobId: string
  classSessionId: string
  attempt: number
  teacherNotes: string | null
}

export type EvaluationPipeline = (ctx: EvaluationPipelineContext) => Promise<void>

let pipelineImpl: EvaluationPipeline | null = null

/** Register the multi-agent pipeline (called once by src/lib/ci/pipeline.ts). */
export function registerCiEvaluationPipeline(fn: EvaluationPipeline): void {
  pipelineImpl = fn
}

// ─── Evidence bundle passed to the pipeline (set during exec, test-inspectable)

let lastEvidenceBundle: EvidenceBundle | null = null
export function lastGatheredEvidence(): EvidenceBundle | null {
  return lastEvidenceBundle
}

// ─── Consent ────────────────────────────────────────────────────────────────────

/** True when the teacher account currently holds CI consent (granted, not withdrawn). */
export async function hasCiConsent(teacherStudentId: string): Promise<boolean> {
  const record = await db.consentRecord.findFirst({
    where: { studentId: teacherStudentId, purpose: CI_CONSENT_PURPOSE, granted: true, withdrawnAt: null },
    orderBy: { grantedAt: 'desc' },
  })
  return record !== null
}

// ─── Enqueue ────────────────────────────────────────────────────────────────────

export type EnqueueOutcome =
  | { queued: true; jobId: string; alreadyQueued: boolean }
  | { queued: false; reason: 'no_consent' }
  | { queued: false; reason: 'class_not_found' }
  | { queued: false; reason: 'class_not_terminal' }
  | { queued: false; reason: 'no_live_session' }
  | { queued: false; reason: 'already_evaluated' }

/**
 * Create or re-arm the evaluation job for a class. Guards, in order:
 *   1. the class exists, belongs to a real teacher profile;
 *   2. a live session existed and has reached a terminal state (ENDED or
 *      INTERRUPTED) — evaluations never race a running room;
 *   3. the teacher currently holds CI consent (checked against the teacher's
 *      Student account, never a client-supplied id).
 * An existing QUEUED/RUNNING job is reused (no duplicate scheduling); a
 * terminal job is reset for a fresh run whose reports become the next VERSION.
 */
export async function enqueueEvaluation(opts: {
  classSessionId: string
  trigger: (typeof CI_TRIGGER)[keyof typeof CI_TRIGGER]
  requestedById?: string | null
  teacherNotes?: string | null
}): Promise<EnqueueOutcome> {
  const cls = await db.classSession.findUnique({
    where: { id: opts.classSessionId },
    select: {
      id: true,
      teacherProfileId: true,
      teacherProfile: { select: { studentId: true } },
      liveSession: { select: { id: true, status: true } },
    },
  })
  if (!cls) return { queued: false, reason: 'class_not_found' }
  if (!cls.liveSession) return { queued: false, reason: 'no_live_session' }
  if (cls.liveSession.status !== 'ENDED' && cls.liveSession.status !== 'INTERRUPTED') {
    return { queued: false, reason: 'class_not_terminal' }
  }
  if (!(await hasCiConsent(cls.teacherProfile.studentId))) {
    return { queued: false, reason: 'no_consent' }
  }

  const now = new Date()
  const existing = await db.classroomEvaluationJob.findUnique({ where: { classSessionId: cls.id } })
  if (existing && (existing.status === CI_JOB_STATUS.QUEUED || existing.status === CI_JOB_STATUS.RUNNING)) {
    // Preserve the original trigger of an in-flight evaluation; nothing to do.
    return { queued: true, jobId: existing.id, alreadyQueued: true }
  }
  if (
    existing &&
    existing.status !== CI_JOB_STATUS.QUEUED &&
    existing.status !== CI_JOB_STATUS.RUNNING &&
    (opts.trigger === CI_TRIGGER.SESSION_END || opts.trigger === CI_TRIGGER.PROVIDER_ROOM_FINISHED)
  ) {
    // Auto-triggers are deduplicated: a class with any terminal job state
    // (COMPLETED / SKIPPED / FAILED) is never silently re-run by a second
    // lifecycle event. Only explicit human re-requests reset a job.
    return { queued: false, reason: 'already_evaluated' }
  }

  const reset = {
    status: CI_JOB_STATUS.QUEUED,
    stage: CI_STAGE.PENDING,
    trigger: opts.trigger,
    requestedById: opts.requestedById ?? null,
    // Teacher notes are part of the REQUESTED evaluation: a re-run without
    // explicit notes keeps the previous notes only when the same teacher
    // re-requests; an automatic session-end trigger never carries notes.
    teacherNotes: opts.teacherNotes !== undefined ? opts.teacherNotes : (existing?.teacherNotes ?? null),
    attempts: 0,
    maxAttempts: CI_MAX_ATTEMPTS,
    error: null,
    claimedAt: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  }
  const job = existing
    ? await db.classroomEvaluationJob.update({ where: { id: existing.id }, data: reset })
    : await db.classroomEvaluationJob.create({
        data: {
          classSessionId: cls.id,
          teacherProfileId: cls.teacherProfileId,
          liveSessionId: cls.liveSession.id,
          ...reset,
        },
      })

  ensureCiWorker()
  return { queued: true, jobId: job.id, alreadyQueued: false }
}

// ─── Worker loop (singleton, idempotent across module reloads) ────────────────

const workerG = globalThis as unknown as { __ciWorker?: { busy: boolean; timer: NodeJS.Timeout } }

/** Start the singleton worker loop. Safe to call repeatedly. */
export function ensureCiWorker(): void {
  // Under `bun test` the tests drive claims and runs directly and deterministically;
  // a live in-test worker would race them (and could reach the real provider).
  // The Next.js server never sets NODE_ENV=test — the loop starts there as usual.
  if (process.env.NODE_ENV === 'test' && process.env.CI_ENABLE_WORKER !== '1') return
  if (workerG.__ciWorker) return
  const state = { busy: false, timer: undefined as unknown as NodeJS.Timeout }
  state.timer = setInterval(() => {
    void ciTick().catch((err) => console.error('[ci worker tick]', err))
  }, CI_POLL_MS)
  state.timer.unref?.() // never hold the process open just for the queue
  workerG.__ciWorker = state
}

/** Test hook: stop the loop (tests drive claims directly). */
export function stopCiWorkerForTests(): void {
  const state = workerG.__ciWorker
  if (state) {
    clearInterval(state.timer)
    workerG.__ciWorker = undefined
  }
}

async function ciTick(): Promise<void> {
  const state = workerG.__ciWorker
  if (!state || state.busy) return
  state.busy = true
  try {
    await recoverExpiredCiLeases()
    const job = await claimNextCiJob()
    if (job) {
      // Sequential execution: evaluations are few (one per ended class) and
      // provider calls are the bottleneck; parallelism adds retry churn.
      await runCiJob(job)
    }
  } finally {
    state.busy = false
  }
}

interface ClaimableCiJob {
  id: string
  classSessionId: string
  teacherProfileId: string
  attempts: number
  maxAttempts: number
  teacherNotes: string | null
}

/** Atomically claim the next runnable evaluation (CAS — one winner only). */
export async function claimNextCiJob(): Promise<ClaimableCiJob | null> {
  const candidates = await db.classroomEvaluationJob.findMany({
    where: { status: CI_JOB_STATUS.QUEUED },
    orderBy: { createdAt: 'asc' },
    take: 5,
    select: { id: true, classSessionId: true, teacherProfileId: true, attempts: true, maxAttempts: true, teacherNotes: true },
  })
  const now = new Date()
  for (const c of candidates) {
    // Consent re-check at claim time: a withdrawal between enqueue and claim
    // stops the evaluation honestly.
    const cls = await db.classSession.findUnique({
      where: { id: c.classSessionId },
      select: { teacherProfile: { select: { studentId: true } } },
    })
    if (!cls || !(await hasCiConsent(cls.teacherProfile.studentId))) {
      await db.classroomEvaluationJob.updateMany({
        where: { id: c.id, status: CI_JOB_STATUS.QUEUED },
        data: { status: CI_JOB_STATUS.SKIPPED, error: 'consent_not_granted', finishedAt: now },
      })
      continue
    }
    const claimed = await db.classroomEvaluationJob.updateMany({
      where: { id: c.id, status: CI_JOB_STATUS.QUEUED },
      data: {
        status: CI_JOB_STATUS.RUNNING,
        attempts: { increment: 1 },
        claimedAt: now,
        leaseUntil: new Date(Date.now() + CI_LEASE_MS),
        startedAt: c.attempts === 0 ? now : undefined,
        error: null,
      },
    })
    if (claimed.count === 1) return c
  }
  return null
}

/** Execute a claimed evaluation with lease heartbeat and honest failure. */
export async function runCiJob(job: ClaimableCiJob): Promise<void> {
  const heartbeat = setInterval(() => {
    void db.classroomEvaluationJob
      .updateMany({
        where: { id: job.id, status: CI_JOB_STATUS.RUNNING },
        data: { leaseUntil: new Date(Date.now() + CI_LEASE_MS) },
      })
      .catch(() => undefined)
  }, 60_000)

  try {
    // Stage: EVIDENCE — gather the authorised bundle first; evidence failures
    // are honest failures (e.g. class deleted mid-run).
    await db.classroomEvaluationJob.updateMany({
      where: { id: job.id, status: CI_JOB_STATUS.RUNNING },
      data: { stage: CI_STAGE.EVIDENCE },
    })
    const { gatherEvidence } = await import('./evidence')
    const bundle = await gatherEvidence(job.classSessionId)
    bundle.teacherNotes = job.teacherNotes
    lastEvidenceBundle = bundle

    // Stage: LEARNER → TEACHER_JUDGE → ORCHESTRATE → PUBLISH — the pipeline.
    const pipeline = pipelineImpl
    if (!pipeline) {
      throw Object.assign(new Error('Evaluation pipeline is not registered in this deployment.'), {
        ciNoPipeline: true,
      })
    }
    await pipeline({ jobId: job.id, classSessionId: job.classSessionId, attempt: job.attempts + 1, teacherNotes: job.teacherNotes })

    await db.classroomEvaluationJob.updateMany({
      where: { id: job.id, status: CI_JOB_STATUS.RUNNING },
      data: { status: CI_JOB_STATUS.COMPLETED, stage: CI_STAGE.DONE, finishedAt: new Date(), leaseUntil: null, error: null },
    })
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const current = await db.classroomEvaluationJob.findUnique({
      where: { id: job.id },
      select: { attempts: true, maxAttempts: true },
    })
    const canRetry = !!current && current.attempts < current.maxAttempts
    await db.classroomEvaluationJob.updateMany({
      where: { id: job.id, status: CI_JOB_STATUS.RUNNING },
      data: canRetry
        ? { status: CI_JOB_STATUS.QUEUED, stage: CI_STAGE.PENDING, leaseUntil: null, claimedAt: null, error: msg }
        : { status: CI_JOB_STATUS.FAILED, finishedAt: new Date(), leaseUntil: null, error: msg },
    })
  } finally {
    clearInterval(heartbeat)
  }
}

/** Lease recovery: a RUNNING job whose lease expired was interrupted. */
export async function recoverExpiredCiLeases(): Promise<number> {
  const now = new Date()
  const stale = await db.classroomEvaluationJob.findMany({
    where: { status: CI_JOB_STATUS.RUNNING, leaseUntil: { lt: now } },
    select: { id: true, attempts: true, maxAttempts: true },
  })
  for (const j of stale) {
    const canRetry = j.attempts < j.maxAttempts
    await db.classroomEvaluationJob.updateMany({
      where: { id: j.id, status: CI_JOB_STATUS.RUNNING, leaseUntil: { lt: now } },
      data: canRetry
        ? { status: CI_JOB_STATUS.QUEUED, stage: CI_STAGE.PENDING, leaseUntil: null, claimedAt: null, error: 'lease expired — re-queued' }
        : { status: CI_JOB_STATUS.FAILED, finishedAt: now, leaseUntil: null, error: 'lease expired (the server restarted or the run was interrupted)' },
    })
  }
  return stale.length
}

// ─── Agent-run audit helper (used by the pipeline, defined here for one table) ─

export async function recordAgentRun(
  tx: Tx,
  opts: {
    jobId: string
    agent: (typeof CI_AGENT)[keyof typeof CI_AGENT]
    attempt: number
    modelId: string | null
    inputDigest: string | null
    outputJson: string | null
    error: string | null
    startedAt: Date
  },
): Promise<void> {
  const finishedAt = new Date()
  await tx.classroomAgentRun.create({
    data: {
      jobId: opts.jobId,
      agent: opts.agent,
      attempt: opts.attempt,
      status: opts.error ? 'FAILED' : 'COMPLETED',
      modelId: opts.modelId,
      inputDigest: opts.inputDigest,
      outputJson: opts.outputJson,
      error: opts.error,
      startedAt: opts.startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - opts.startedAt.getTime(),
    },
  })
}
