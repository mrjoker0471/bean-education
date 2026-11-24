// ─── BEAN Classroom Intelligence (CI-3C): fleet task worker pool ─────────────
// Bounded, durable worker pool for per-agent fleet tasks (charter §4.3),
// mirroring the proven CI-1 queue semantics (src/lib/ci/queue.ts):
//   • One task per planned agent per class — ClassroomFleetTask.taskKey is
//     UNIQUE, so duplicate prevention is a DB guarantee (the dispatcher's job).
//   • Atomic claims via conditional UPDATE (CAS) — safe across processes and
//     across in-process pool slots.
//   • Claim-time honesty re-checks: consent (a withdrawal between dispatch and
//     claim stops the task), role resolvability (a domain pack retired between
//     dispatch and claim is an honest skip, never a guessed run) and capacity
//     backpressure (ENRICHMENT yields first — core honesty work beats
//     coaching, always).
//   • Lease-based recovery with heartbeats — a dead worker's task is re-queued
//     (bounded by maxAttempts) or FAILED honestly.
//   • Execution seam (dependency inversion): the worker owns scheduling; the
//     specialist runtime (later CI-3 milestones) owns execution via
//     registerFleetTaskExecutor. A deployment without an executor fails tasks
//     HONESTLY (FAILED with an explanation) instead of pretending to run.
//   • Every output must pass the charter §12 contract (validateFleetTaskOutput)
//     before anything is persisted; the validated envelope is stored verbatim.
//
// Failure isolation: a failed fleet task never touches the class, bookings,
// attendance or live-session state. Classroom routes never wait on this pool.

import { db } from '@/lib/db'
import { FLEET_TASK_STATUS, FLEET_TASK_ROLE, FLEET_LEASE_MS, FLEET_POLL_MS, FLEET_HEARTBEAT_MS, FLEET_MAX_ATTEMPTS, FLEET_BACKLOG_BACKPRESSURE, FLEET_WORKER_CONCURRENCY_DEFAULT, FLEET_WORKER_CONCURRENCY_MIN, FLEET_WORKER_CONCURRENCY_MAX } from './constants'
import { validateFleetTaskOutput } from './contracts'
import { resolveAgentId, type FleetAgentSpec } from './registry'
import { hasCiConsent } from '../queue'

// ─── Execution seam (dependency inversion) ────────────────────────────────────

export interface FleetTaskExecutionContext {
  taskKey: string
  classSessionId: string
  teacherProfileId: string
  agentId: string
  taskRole: string
  attempt: number
  /** Resolved registry spec at claim time. */
  spec: FleetAgentSpec
  /** Domain-pack id for subject-expert instances, else null. */
  domainPackId: string | null
  /** True when the resolved pack is IN_REVIEW (output must say so honestly). */
  underReviewPack: boolean
  contractVersion: string
}

/**
 * Executes one claimed fleet task and returns a candidate charter §12 output
 * (validated by the worker before anything is persisted). Throwing means a
 * real failure: the task retries within maxAttempts, then FAILED honestly.
 */
export type FleetTaskExecutor = (ctx: FleetTaskExecutionContext) => Promise<unknown>

let executorImpl: FleetTaskExecutor | null = null

/** Register the specialist runtime (called once by the runtime module). */
export function registerFleetTaskExecutor(fn: FleetTaskExecutor): void {
  executorImpl = fn
}

/** Test hook: clear the executor (tests assert the honest no-executor failure). */
export function unregisterFleetTaskExecutorForTests(): void {
  executorImpl = null
}

/** Test hook: inspect what executor is registered (never the impl itself). */
export function fleetExecutorRegistered(): boolean {
  return executorImpl !== null
}

// ─── Claims ────────────────────────────────────────────────────────────────────

export interface ClaimableFleetTask {
  id: string
  taskKey: string
  classSessionId: string
  teacherProfileId: string
  agentId: string
  taskRole: string
  attempts: number
  maxAttempts: number
  contractVersion: string
  /** Resolved at claim time (pre-resolution) and attached to the claim. */
  spec: FleetAgentSpec
  domainPackId: string | null
  underReviewPack: boolean
}

/**
 * Atomically claim the next runnable fleet task (CAS — one winner only).
 * Candidate order: priority asc (core honesty work first), createdAt asc.
 * Claim-time checks run per candidate; a failed check SKIPS that task
 * honestly (status SKIPPED + skipReason) and moves to the next candidate.
 */
export async function claimNextFleetTask(): Promise<ClaimableFleetTask | null> {
  const candidates = await db.classroomFleetTask.findMany({
    where: { status: 'QUEUED' },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    take: 10,
    select: {
      id: true,
      taskKey: true,
      classSessionId: true,
      teacherProfileId: true,
      agentId: true,
      taskRole: true,
      attempts: true,
      maxAttempts: true,
      contractVersion: true,
    },
  })
  const now = new Date()
  // Backpressure is measured ONCE per claim pass: this pass either runs under
  // pressure (enrichment yields, uniformly) or it does not. Re-measuring per
  // candidate would let the skip mechanism itself drain the backlog until an
  // enrichment task sneaks through.
  const backlogAtPassStart = await db.classroomFleetTask.count({ where: { status: 'QUEUED' } })
  for (const c of candidates) {
    // 1. Consent re-check at claim time: a withdrawal between dispatch and
    //    claim stops the task honestly. Skips are CAS (a concurrent worker
    //    may have claimed the task already — then it is not ours to skip).
    const teacher = await db.teacherProfile.findUnique({
      where: { id: c.teacherProfileId },
      select: { studentId: true },
    })
    if (!teacher || !(await hasCiConsent(teacher.studentId))) {
      // Whether or not this worker wins the skip CAS (a concurrent claim may
      // have taken the task), this candidate is not claimable now — move on.
      await db.classroomFleetTask.updateMany({
        where: { id: c.id, status: 'QUEUED' },
        data: { status: 'SKIPPED', skipReason: 'consent_not_granted', finishedAt: now },
      })
      continue
    }

    // 2. Role pre-resolution: the registry is the server-side authority. A
    //    pack that lost dispatchability (RETIRED) between dispatch and claim
    //    is an honest "cannot run", never a guessed run.
    const resolution = resolveAgentId(c.agentId)
    if (!resolution.ok) {
      await db.classroomFleetTask.updateMany({
        where: { id: c.id, status: 'QUEUED' },
        data: {
          status: 'SKIPPED',
          skipReason: `agent_unresolvable: ${resolution.reason.slice(0, 300)}`,
          finishedAt: now,
        },
      })
      continue
    }

    // 3. Capacity backpressure: when the queued backlog is heavy, ENRICHMENT
    //    yields first. Core/audit/domain/language tasks still claim — honest
    //    capacity management, not silent starvation of the honesty pair.
    if (c.taskRole === FLEET_TASK_ROLE.ENRICHMENT) {
      if (backlogAtPassStart > FLEET_BACKLOG_BACKPRESSURE) {
        await db.classroomFleetTask.updateMany({
          where: { id: c.id, status: 'QUEUED' },
          data: { status: 'SKIPPED', skipReason: 'capacity_backpressure', finishedAt: now },
        })
        continue
      }
    }

    // 4. CAS claim — exactly one worker wins.
    const claimed = await db.classroomFleetTask.updateMany({
      where: { id: c.id, status: 'QUEUED' },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        claimedAt: now,
        leaseUntil: new Date(Date.now() + FLEET_LEASE_MS),
        startedAt: c.attempts === 0 ? now : undefined,
        error: null,
        skipReason: null,
      },
    })
    if (claimed.count === 1) {
      return {
        id: c.id,
        taskKey: c.taskKey,
        classSessionId: c.classSessionId,
        teacherProfileId: c.teacherProfileId,
        agentId: c.agentId,
        taskRole: c.taskRole,
        attempts: c.attempts,
        maxAttempts: c.maxAttempts,
        contractVersion: c.contractVersion,
        spec: resolution.spec,
        domainPackId: resolution.domainPackId,
        underReviewPack: resolution.underReviewPack,
      }
    }
  }
  return null
}

// ─── Execution ────────────────────────────────────────────────────────────────

/**
 * Execute a claimed task with lease heartbeat and honest failure handling.
 * Persisted terminal states follow charter §12: the executor's validated
 * envelope status (COMPLETED / PARTIAL / INSUFFICIENT_EVIDENCE / FAILED) is
 * stored verbatim with the validated JSON; contract-invalid outputs and
 * thrown errors become FAILED with a bounded explanation (rule C5 — a bare
 * failure is never merged silently).
 */
export async function runFleetTask(task: ClaimableFleetTask): Promise<void> {
  const heartbeat = setInterval(() => {
    void db.classroomFleetTask
      .updateMany({
        where: { id: task.id, status: 'RUNNING' },
        data: { leaseUntil: new Date(Date.now() + FLEET_LEASE_MS) },
      })
      .catch(() => undefined)
  }, FLEET_HEARTBEAT_MS)

  try {
    const executor = executorImpl
    if (!executor) {
      throw Object.assign(
        new Error('Fleet task executor is not registered in this deployment.'),
        { fleetNoExecutor: true },
      )
    }

    const candidate = await executor({
      taskKey: task.taskKey,
      classSessionId: task.classSessionId,
      teacherProfileId: task.teacherProfileId,
      agentId: task.agentId,
      taskRole: task.taskRole,
      attempt: task.attempts + 1,
      spec: task.spec,
      domainPackId: task.domainPackId,
      underReviewPack: task.underReviewPack,
      contractVersion: task.contractVersion,
    })

    const validated = validateFleetTaskOutput(candidate)
    if (!validated.ok) {
      // Contract-invalid output: FAILED with the validator's reason (the
      // reason names the failed honesty checks — nothing is merged silently).
      await db.classroomFleetTask.updateMany({
        where: { id: task.id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: `contract rejected: ${validated.reason.slice(0, 480)}`,
          outputJson: null,
          finishedAt: new Date(),
          leaseUntil: null,
        },
      })
      return
    }

    // Envelope identity must match the claimed task — a validated output that
    // describes a different task is a real failure, not a merge candidate.
    const output = validated.output
    if (output.classSessionId !== task.classSessionId || output.agentId !== task.agentId) {
      await db.classroomFleetTask.updateMany({
        where: { id: task.id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: 'contract rejected: output identity does not match the claimed task',
          outputJson: null,
          finishedAt: new Date(),
          leaseUntil: null,
        },
      })
      return
    }

    const failedExplanation =
      output.status === FLEET_TASK_STATUS.FAILED
        ? (output.unknowns[0] ?? output.riskFlags[0] ?? 'failed without detail').slice(0, 480)
        : null

    await db.classroomFleetTask.updateMany({
      where: { id: task.id, status: 'RUNNING' },
      data: {
        status: output.status,
        outputJson: JSON.stringify(output),
        contractVersion: output.contractVersion,
        error: failedExplanation,
        finishedAt: new Date(),
        leaseUntil: null,
      },
    })
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const current = await db.classroomFleetTask.findUnique({
      where: { id: task.id },
      select: { attempts: true, maxAttempts: true },
    })
    // Permanent failures (missing pack, unparseable upstream output, missing
    // handler) can never succeed on retry — failing immediately is honest
    // capacity management, not impatience.
    const permanent = (err as { fleetPermanent?: boolean }).fleetPermanent === true
    const canRetry = !permanent && !!current && current.attempts < current.maxAttempts
    await db.classroomFleetTask.updateMany({
      where: { id: task.id, status: 'RUNNING' },
      data: canRetry
        ? { status: 'QUEUED', leaseUntil: null, claimedAt: null, error: msg }
        : { status: 'FAILED', finishedAt: new Date(), leaseUntil: null, error: msg },
    })
  } finally {
    clearInterval(heartbeat)
  }
}

// ─── Lease recovery ───────────────────────────────────────────────────────────

/** Lease recovery: a RUNNING task whose lease expired was interrupted. */
export async function recoverExpiredFleetLeases(): Promise<number> {
  const now = new Date()
  const stale = await db.classroomFleetTask.findMany({
    where: { status: 'RUNNING', leaseUntil: { lt: now } },
    select: { id: true, attempts: true, maxAttempts: true },
  })
  for (const t of stale) {
    const canRetry = t.attempts < t.maxAttempts
    await db.classroomFleetTask.updateMany({
      where: { id: t.id, status: 'RUNNING', leaseUntil: { lt: now } },
      data: canRetry
        ? { status: 'QUEUED', leaseUntil: null, claimedAt: null, error: 'lease expired — re-queued' }
        : { status: 'FAILED', finishedAt: now, leaseUntil: null, error: 'lease expired (the server restarted or the run was interrupted)' },
    })
  }
  return stale.length
}

// ─── Session cancellation ─────────────────────────────────────────────────────

/**
 * Cancel every non-terminal fleet task for a session (e.g. the class was
 * cancelled or consent was withdrawn mid-flight). QUEUED and RUNNING tasks
 * become CANCELLED honestly; terminal tasks are untouched (never rewritten).
 */
export async function cancelFleetTasksForSession(classSessionId: string): Promise<number> {
  const now = new Date()
  const result = await db.classroomFleetTask.updateMany({
    where: { classSessionId, status: { in: ['QUEUED', 'RUNNING'] } },
    data: { status: 'CANCELLED', finishedAt: now, leaseUntil: null },
  })
  return result.count
}

// ─── Pool stats ───────────────────────────────────────────────────────────────

export interface FleetPoolStats {
  queued: number
  running: number
  completed: number
  partial: number
  insufficientEvidence: number
  failed: number
  cancelled: number
  skipped: number
  backlog: number
  backpressureThreshold: number
  concurrency: number
}

/** Observability snapshot of the pool (also used by tests to assert states). */
export async function fleetPoolStats(): Promise<FleetPoolStats> {
  const rows = await db.classroomFleetTask.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const byStatus = new Map(rows.map(r => [r.status, r._count._all]))
  const queued = byStatus.get('QUEUED') ?? 0
  return {
    queued,
    running: byStatus.get('RUNNING') ?? 0,
    completed: byStatus.get(FLEET_TASK_STATUS.COMPLETED) ?? 0,
    partial: byStatus.get(FLEET_TASK_STATUS.PARTIAL) ?? 0,
    insufficientEvidence: byStatus.get(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE) ?? 0,
    failed: byStatus.get(FLEET_TASK_STATUS.FAILED) ?? 0,
    cancelled: byStatus.get(FLEET_TASK_STATUS.CANCELLED) ?? 0,
    skipped: byStatus.get('SKIPPED') ?? 0,
    backlog: queued,
    backpressureThreshold: FLEET_BACKLOG_BACKPRESSURE,
    concurrency: resolveConcurrency(),
  }
}

// ─── Worker loop (bounded pool, singleton, idempotent across reloads) ────────

interface FleetWorkerState {
  timer: NodeJS.Timeout
  active: number
  concurrency: number
}

const workerG = globalThis as unknown as { __fleetWorker?: FleetWorkerState }

function resolveConcurrency(): number {
  const raw = Number.parseInt(process.env.FLEET_WORKER_CONCURRENCY ?? '', 10)
  if (!Number.isFinite(raw)) return FLEET_WORKER_CONCURRENCY_DEFAULT
  return Math.min(FLEET_WORKER_CONCURRENCY_MAX, Math.max(FLEET_WORKER_CONCURRENCY_MIN, raw))
}

/**
 * One tick: recover expired leases, then top the pool up to its concurrency
 * bound. Claims run concurrently (bounded); each run manages its own lease.
 */
export async function fleetTick(): Promise<number> {
  const state = workerG.__fleetWorker
  const concurrency = state ? state.concurrency : resolveConcurrency()
  await recoverExpiredFleetLeases()
  let started = 0
  const maxStarts = state ? Math.max(0, state.concurrency - state.active) : 1
  for (let i = 0; i < maxStarts; i++) {
    const task = await claimNextFleetTask()
    if (!task) break
    started++
    const run = runFleetTask(task).catch((err) => console.error('[fleet worker run]', err))
    if (state) {
      state.active++
      void run.finally(() => {
        state.active = Math.max(0, state.active - 1)
      })
    } else {
      // Direct-call mode (tests without the loop): await so callers stay
      // deterministic.
      await run
    }
  }
  return started
}

/** Await all in-flight runs (test determinism). */
export async function fleetDrainForTests(): Promise<void> {
  const state = workerG.__fleetWorker
  if (!state) return
  while (state.active > 0) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Start the singleton worker loop. Safe to call repeatedly. */
export function ensureFleetWorker(): void {
  // Under `bun test` the tests drive claims and runs directly and
  // deterministically; a live in-test worker would race them. The Next.js
  // server never sets NODE_ENV=test — the loop starts there as usual.
  if (process.env.NODE_ENV === 'test' && process.env.CI_ENABLE_WORKER !== '1') return
  if (workerG.__fleetWorker) return
  const state: FleetWorkerState = {
    timer: undefined as unknown as NodeJS.Timeout,
    active: 0,
    concurrency: resolveConcurrency(),
  }
  state.timer = setInterval(() => {
    void fleetTick().catch((err) => console.error('[fleet worker tick]', err))
  }, FLEET_POLL_MS)
  state.timer.unref?.() // never hold the process open just for the pool
  workerG.__fleetWorker = state
}

/** Test hook: stop the loop (tests drive claims directly). */
export function stopFleetWorkerForTests(): void {
  const state = workerG.__fleetWorker
  if (state) {
    clearInterval(state.timer)
    workerG.__fleetWorker = undefined
  }
}
