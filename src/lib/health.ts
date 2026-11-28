// ─── OPS-1A: application health — real readiness, not "the port is open" ─────
// The health endpoint reports the app's ACTUAL startup-dependency state:
//   • database — a bounded, real connectivity probe through the EXISTING
//     Prisma client singleton (never a second client).
//   • workers  — the liveness of the three durable-queue worker loops (Riishe
//     document jobs, Classroom Intelligence evaluations, specialist fleet),
//     read from each queue's own registration authority. A worker that never
//     bootstrapped reports `registered: false` — readiness is never assumed
//     merely because the HTTP process responds.
//
// Readiness gate: HTTP 200 requires the database AND all three worker loops
// registered; anything else is 503. Worker-loop heartbeat freshness is
// reported (lastTickAt) but not gated on: registration is the boot-time
// contract (OPS-1B), and gating on a freshness window would flap readiness
// during ordinary event-loop pauses. The heartbeat remains visible for
// operators and future monitoring.
//
// Response contract (minimal and leak-safe): status / database / workers /
// timestamp. No database details, no environment values, no secrets, no stack
// traces, no user data — unexpected failures collapse to the fixed unhealthy
// shape below, never an error transcript.

import { db } from '@/lib/db'
import type { WorkerLoopLiveness } from '@/lib/worker-liveness'
import { riisheWorkerLiveness } from '@/lib/riishe/jobs'
import { ciWorkerLiveness } from '@/lib/ci/queue'
import { fleetWorkerLiveness } from '@/lib/ci/fleet/worker'

/** Bound for the database probe — the check must never hang indefinitely. */
export const HEALTH_PROBE_TIMEOUT_MS = 3_000

export type WorkerMap = {
  riishe: WorkerLoopLiveness
  classroomEvaluations: WorkerLoopLiveness
  specialistFleet: WorkerLoopLiveness
}

export interface HealthResponseBody {
  status: 'ok' | 'unhealthy'
  database: 'ok' | 'unavailable'
  workers: WorkerMap
  timestamp: string
}

export interface HealthCheckDeps {
  probeDatabase: () => Promise<'ok' | 'unavailable'>
  collectWorkerLiveness: () => WorkerMap
}

/** Fixed unhealthy body used when the check itself fails unexpectedly —
 *  every field is a coarse state label, so nothing internal can leak. */
function unhealthyBody(timestamp: string): HealthResponseBody {
  const notRegistered: WorkerLoopLiveness = { registered: false, lastTickAt: null }
  return {
    status: 'unhealthy',
    database: 'unavailable',
    workers: {
      riishe: { ...notRegistered },
      classroomEvaluations: { ...notRegistered },
      specialistFleet: { ...notRegistered },
    },
    timestamp,
  }
}

/**
 * Real database connectivity probe through the existing Prisma client.
 * Bounded by HEALTH_PROBE_TIMEOUT_MS so a stuck engine can never hang the
 * endpoint; the outcome is a coarse ok/unavailable — query errors are never
 * surfaced in the response.
 */
function probeDatabaseBounded(): Promise<'ok' | 'unavailable'> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve('unavailable')
    }, HEALTH_PROBE_TIMEOUT_MS)
    timer.unref?.()
    db.$queryRaw`SELECT 1`
      .then(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve('ok')
      })
      .catch(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve('unavailable')
      })
  })
}

/** Structural bound applied to EVERY database probe — including injected
 *  dependency implementations. The readiness check can therefore never wait
 *  longer than HEALTH_PROBE_TIMEOUT_MS for the database outcome, whatever the
 *  probe implementation does. */
function withProbeBound(probe: () => Promise<'ok' | 'unavailable'>): Promise<'ok' | 'unavailable'> {
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve('unavailable')
    }, HEALTH_PROBE_TIMEOUT_MS)
    timer.unref?.()
    Promise.resolve()
      .then(probe)
      .then((outcome) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(outcome)
      })
      .catch(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve('unavailable')
      })
  })
}

/** The production dependency set: real Prisma probe + real registration authorities. */
export const defaultHealthCheckDeps: HealthCheckDeps = {
  probeDatabase: probeDatabaseBounded,
  collectWorkerLiveness: () => ({
    riishe: riisheWorkerLiveness(),
    classroomEvaluations: ciWorkerLiveness(),
    specialistFleet: fleetWorkerLiveness(),
  }),
}

/**
 * Perform the readiness check. Never throws: an unexpected failure inside a
 * dependency collapses to the fixed unhealthy shape with HTTP 503 (honest,
 * leak-safe). HTTP 200 only when the database is reachable AND all three
 * worker loops registered.
 */
export async function performHealthCheck(
  deps: HealthCheckDeps = defaultHealthCheckDeps,
): Promise<{ httpStatus: 200 | 503; body: HealthResponseBody }> {
  try {
    const [database, workers] = await Promise.all([
      withProbeBound(deps.probeDatabase),
      Promise.resolve().then(() => deps.collectWorkerLiveness()),
    ])
    const workersReady =
      workers.riishe.registered &&
      workers.classroomEvaluations.registered &&
      workers.specialistFleet.registered
    const healthy = database === 'ok' && workersReady
    const body: HealthResponseBody = {
      status: healthy ? 'ok' : 'unhealthy',
      database,
      workers,
      timestamp: new Date().toISOString(),
    }
    return { httpStatus: healthy ? 200 : 503, body }
  } catch {
    // Unexpected probe failure: report honestly and leak nothing.
    return { httpStatus: 503, body: unhealthyBody(new Date().toISOString()) }
  }
}
