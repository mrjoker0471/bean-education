// ─── OPS-1B: eager, idempotent worker bootstrap (instrumentation) ─────────────
// Coverage:
//   B1  register() is a no-op on an unsupported runtime (NEXT_RUNTIME unset)
//       and during build-time compilation (NEXT_PHASE=phase-production-build)
//   B2  register() on the Node.js runtime with valid core configuration
//       starts all three REAL worker loops + the executor seams
//   B3  repeated registration (register()/bootstrap again) never starts
//       duplicate loops — the singleton timers keep their identity
//   B4  worker-loop heartbeat: the registered loop actually ticks and the
//       liveness readout reflects it (real registration authority, no mocks)
//   B5  startup failures are handled honestly: a worker whose bootstrap
//       throws is logged, does not throw out of register(), and the OTHER
//       workers still start (covered in ops1-worker-bootstrap-failure.test.ts)
//
// All worker loops run against an ISOLATED temporary SQLite database (their
// idle ticks only read it); the developer database is never touched.

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ops1-bootstrap-'))
const isolatedUrl = `file:${join(dir, 'ops1-bootstrap.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

// The documented escape hatch: allow the CI/fleet loops to start under the
// test runtime. Without it, ensureCiWorker/ensureFleetWorker deliberately
// no-op under NODE_ENV=test (existing queue tests rely on that).
process.env.CI_ENABLE_WORKER = '1'

const { register, bootstrapDurableQueueWorkers } = await import('@/instrumentation')
const { riisheWorkerLiveness, stopRiisheWorkerForTests } = await import('@/lib/riishe/jobs')
const { ciWorkerLiveness, ciEvaluationPipelineRegistered, stopCiWorkerForTests } = await import('@/lib/ci/queue')
const { fleetWorkerLiveness, fleetExecutorRegistered, stopFleetWorkerForTests } = await import('@/lib/ci/fleet/worker')

const workerGlobals = globalThis as unknown as {
  __riisheWorker?: { timer: NodeJS.Timeout }
  __ciWorker?: { timer: NodeJS.Timeout }
  __fleetWorker?: { timer: NodeJS.Timeout }
}

const expectAllUnregistered = () => {
  expect(riisheWorkerLiveness().registered).toBe(false)
  expect(ciWorkerLiveness().registered).toBe(false)
  expect(fleetWorkerLiveness().registered).toBe(false)
}

beforeAll(() => {
  execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
})

afterAll(() => {
  stopRiisheWorkerForTests()
  stopCiWorkerForTests()
  stopFleetWorkerForTests()
  delete process.env.CI_ENABLE_WORKER
  rmSync(dir, { recursive: true, force: true })
})

describe('OPS-1B worker bootstrap', () => {
  it('B1: register() is a no-op on an unsupported runtime and during build phase', async () => {
    // bun test does not set NEXT_RUNTIME — the guard must skip everything.
    await register()
    expectAllUnregistered()

    // Build-time compilation must never start background loops.
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-build'
    try {
      await register()
    } finally {
      delete process.env.NEXT_RUNTIME
      delete process.env.NEXT_PHASE
    }
    expectAllUnregistered()
  })

  it('B2: register() on the nodejs runtime starts all three real workers + executor seams', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.DATABASE_URL = isolatedUrl // valid core-startup configuration
    try {
      await register()
    } finally {
      delete process.env.NEXT_RUNTIME
      delete process.env.DATABASE_URL
    }
    expect(riisheWorkerLiveness().registered).toBe(true)
    expect(ciWorkerLiveness().registered).toBe(true)
    expect(fleetWorkerLiveness().registered).toBe(true)
    // Executor seams — an eagerly started worker must never claim a job whose
    // executor is missing (side-effect parity with the lazy enqueue paths).
    expect(ciEvaluationPipelineRegistered()).toBe(true)
    expect(fleetExecutorRegistered()).toBe(true)
  })

  it('B3: repeated registration never starts duplicate worker loops', async () => {
    const riisheBefore = workerGlobals.__riisheWorker?.timer
    const ciBefore = workerGlobals.__ciWorker?.timer
    const fleetBefore = workerGlobals.__fleetWorker?.timer
    expect(riisheBefore).toBeDefined()
    expect(ciBefore).toBeDefined()
    expect(fleetBefore).toBeDefined()

    await register()
    await bootstrapDurableQueueWorkers()
    await bootstrapDurableQueueWorkers()

    expect(workerGlobals.__riisheWorker?.timer).toBe(riisheBefore)
    expect(workerGlobals.__ciWorker?.timer).toBe(ciBefore)
    expect(workerGlobals.__fleetWorker?.timer).toBe(fleetBefore)
    expect(riisheWorkerLiveness().registered).toBe(true)
    expect(ciWorkerLiveness().registered).toBe(true)
    expect(fleetWorkerLiveness().registered).toBe(true)
  })

  it('B4: a registered worker loop really ticks — liveness reports the heartbeat', async () => {
    // Riishe polls every 2.5s; wait for at least one real tick against the
    // isolated DB and assert the heartbeat is a fresh timestamp from the
    // worker's own registration state.
    const waitMs = 3_500
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    const liveness = riisheWorkerLiveness()
    expect(liveness.registered).toBe(true)
    expect(liveness.lastTickAt).not.toBeNull()
    const age = Date.now() - (liveness.lastTickAt as number)
    expect(age).toBeGreaterThanOrEqual(0)
    expect(age).toBeLessThan(waitMs)
  }, 15_000)
})
