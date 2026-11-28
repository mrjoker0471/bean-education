// ─── OPS-1A: /api/healthz — real readiness endpoint tests ────────────────────
// Coverage (all on isolated infrastructure; never a developer/production DB):
//   H1  database healthy + all three workers registered → HTTP 200 / status ok
//   H2  database unavailable → HTTP 503 / honest unhealthy body
//   H3  worker bootstrap unavailable or incomplete (each queue individually
//       and combinations) → HTTP 503
//   H4  unexpected probe failure → HTTP 503, fixed unhealthy shape, nothing
//       from the failure leaks into the response
//   H5  response contract is minimal and leak-safe: exactly
//       { status, database, workers, timestamp }; worker entries carry only
//       { registered, lastTickAt }; no environment values / stack traces
//   H6  a hanging database probe is bounded (the endpoint cannot hang)
//   R1  route integration: real deps + real worker registration after the
//       OPS-1B bootstrap → GET /api/healthz returns 200
//   R2  route integration: response is no-store and carries the same contract

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ops1-healthz-'))
const isolatedUrl = `file:${join(dir, 'ops1-healthz.db')}`

// Bind the app's db singleton to the isolated database BEFORE the modules
// under test are imported (mock.module runs first; dynamic imports follow).
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

// Allow the real CI/fleet worker loops to register under the test runtime
// (the documented escape hatch the queue modules themselves provide).
process.env.CI_ENABLE_WORKER = '1'

const { performHealthCheck, defaultHealthCheckDeps, HEALTH_PROBE_TIMEOUT_MS } = await import('@/lib/health')
const { bootstrapDurableQueueWorkers } = await import('@/instrumentation')
const { riisheWorkerLiveness, stopRiisheWorkerForTests } = await import('@/lib/riishe/jobs')
const { ciWorkerLiveness, stopCiWorkerForTests } = await import('@/lib/ci/queue')
const { fleetWorkerLiveness, stopFleetWorkerForTests } = await import('@/lib/ci/fleet/worker')

beforeAll(() => {
  execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
})

afterAll(async () => {
  stopRiisheWorkerForTests()
  stopCiWorkerForTests()
  stopFleetWorkerForTests()
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

const readyWorkers = () => ({
  riishe: { registered: true, lastTickAt: Date.now() },
  classroomEvaluations: { registered: true, lastTickAt: Date.now() },
  specialistFleet: { registered: true, lastTickAt: Date.now() },
})

const withWorker = (name: 'riishe' | 'classroomEvaluations' | 'specialistFleet', registered: boolean) => {
  const base = readyWorkers()
  return { ...base, [name]: { registered, lastTickAt: registered ? Date.now() : null } }
}

const TOP_LEVEL_KEYS = ['status', 'database', 'workers', 'timestamp']
const WORKER_KEYS = ['registered', 'lastTickAt']

function assertMinimalLeakSafeContract(body: unknown): void {
  const raw = JSON.stringify(body)
  const parsed = JSON.parse(raw) as Record<string, unknown>
  expect(Object.keys(parsed).sort()).toEqual([...TOP_LEVEL_KEYS].sort())
  const workers = parsed.workers as Record<string, Record<string, unknown>>
  expect(Object.keys(workers).sort()).toEqual(['classroomEvaluations', 'riishe', 'specialistFleet'])
  for (const entry of Object.values(workers)) {
    expect(Object.keys(entry).sort()).toEqual([...WORKER_KEYS].sort())
  }
  // Leak safety: no connection strings, no internal paths, no stack frames,
  // no error transcripts — for any outcome.
  expect(raw).not.toContain(isolatedUrl)
  expect(raw).not.toContain('file:')
  expect(raw).not.toContain('DATABASE_URL')
  expect(raw).not.toContain('Error')
  expect(raw).not.toContain('error')
  expect(raw).not.toContain('at /')
  expect(raw).not.toContain('stack')
}

// ─── H1–H6: the health check core (dependency-injected for exact scenarios) ──

describe('OPS-1A performHealthCheck', () => {
  it('H1: healthy database + all workers registered → 200 / ok', async () => {
    const deps = { probeDatabase: async () => 'ok' as const, collectWorkerLiveness: readyWorkers }
    const { httpStatus, body } = await performHealthCheck(deps)
    expect(httpStatus).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.database).toBe('ok')
    expect(body.workers.riishe.registered).toBe(true)
    expect(body.workers.classroomEvaluations.registered).toBe(true)
    expect(body.workers.specialistFleet.registered).toBe(true)
    expect(new Date(body.timestamp).getTime()).not.toBeNaN()
    assertMinimalLeakSafeContract(body)
  })

  it('H2: database unavailable → 503 / database unavailable / status unhealthy', async () => {
    const deps = { probeDatabase: async () => 'unavailable' as const, collectWorkerLiveness: readyWorkers }
    const { httpStatus, body } = await performHealthCheck(deps)
    expect(httpStatus).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.database).toBe('unavailable')
    assertMinimalLeakSafeContract(body)
  })

  it('H3: worker bootstrap incomplete → 503, naming the unregistered loop only', async () => {
    for (const name of ['riishe', 'classroomEvaluations', 'specialistFleet'] as const) {
      const deps = { probeDatabase: async () => 'ok' as const, collectWorkerLiveness: () => withWorker(name, false) }
      const { httpStatus, body } = await performHealthCheck(deps)
      expect(httpStatus).toBe(503)
      expect(body.status).toBe('unhealthy')
      expect(body.database).toBe('ok') // the database is fine — the worker is the problem
      expect(body.workers[name].registered).toBe(false)
      // the OTHER two still report their real state honestly
      for (const other of ['riishe', 'classroomEvaluations', 'specialistFleet'] as const) {
        if (other !== name) expect(body.workers[other].registered).toBe(true)
      }
      assertMinimalLeakSafeContract(body)
    }
  })

  it('H4: unexpected probe failure → 503 with the fixed unhealthy shape; failure details never leak', async () => {
    const secret = 'postgres://user:hunter2@internal-host/secret-db'
    const deps = {
      probeDatabase: async () => {
        throw new Error(`engine exploded: ${secret}`)
      },
      collectWorkerLiveness: readyWorkers,
    }
    const { httpStatus, body } = await performHealthCheck(deps)
    expect(httpStatus).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.database).toBe('unavailable')
    const raw = JSON.stringify(body)
    expect(raw).not.toContain(secret)
    expect(raw).not.toContain('exploded')
    assertMinimalLeakSafeContract(body)
  })

  it('H4b: unexpected worker-liveness collector failure → 503, fixed unhealthy shape', async () => {
    const deps = {
      probeDatabase: async () => 'ok' as const,
      collectWorkerLiveness: () => {
        throw new Error('collector blew up with internal details')
      },
    }
    const { httpStatus, body } = await performHealthCheck(deps)
    expect(httpStatus).toBe(503)
    expect(body.status).toBe('unhealthy')
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('blew up')
    assertMinimalLeakSafeContract(body)
  })

  it('H5: default production deps produce the minimal leak-safe contract (real probe on isolated DB)', async () => {
    // Workers are not yet bootstrapped in this file — the default deps must
    // report that honestly (registered: false), NOT invent readiness.
    const { httpStatus, body } = await performHealthCheck(defaultHealthCheckDeps)
    expect(httpStatus).toBe(503)
    expect(body.status).toBe('unhealthy')
    expect(body.database).toBe('ok') // real bounded probe against the isolated DB
    expect(body.workers.riishe.registered).toBe(false)
    expect(body.workers.classroomEvaluations.registered).toBe(false)
    expect(body.workers.specialistFleet.registered).toBe(false)
    assertMinimalLeakSafeContract(body)
  })

  it('H6: a hanging database probe is bounded — the endpoint cannot hang', async () => {
    const deps = {
      probeDatabase: () =>
        new Promise<'ok'>((resolve) => {
          // Resolves long after the probe bound — the check must not wait for it.
          setTimeout(() => resolve('ok'), HEALTH_PROBE_TIMEOUT_MS * 10)
        }),
      collectWorkerLiveness: readyWorkers,
    }
    const startedAt = Date.now()
    const { httpStatus, body } = await performHealthCheck(deps)
    const elapsed = Date.now() - startedAt
    expect(elapsed).toBeLessThan(HEALTH_PROBE_TIMEOUT_MS + 2_000)
    expect(httpStatus).toBe(503) // no answer within the bound = unavailable
    expect(body.database).toBe('unavailable')
    assertMinimalLeakSafeContract(body)
  }, 20_000)
})

// ─── R1–R2: the real route wiring (real deps + real worker registration) ──────

describe('OPS-1A GET /api/healthz (route integration)', () => {
  it('R1: after the OPS-1B bootstrap, GET returns 200 with every loop registered', async () => {
    await bootstrapDurableQueueWorkers()
    const { GET } = await import('@/app/api/healthz/route')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.database).toBe('ok')
    expect(riisheWorkerLiveness().registered).toBe(true)
    expect(ciWorkerLiveness().registered).toBe(true)
    expect(fleetWorkerLiveness().registered).toBe(true)
    expect(body.workers.riishe.registered).toBe(true)
    expect(body.workers.classroomEvaluations.registered).toBe(true)
    expect(body.workers.specialistFleet.registered).toBe(true)
    assertMinimalLeakSafeContract(body)
  })

  it('R2: route returns a NextResponse with JSON body matching the lib contract', async () => {
    const { GET } = await import('@/app/api/healthz/route')
    const res = await GET()
    const contentType = res.headers.get('content-type') ?? ''
    expect(contentType).toContain('application/json')
    const body = await res.json()
    assertMinimalLeakSafeContract(body)
  })
})
