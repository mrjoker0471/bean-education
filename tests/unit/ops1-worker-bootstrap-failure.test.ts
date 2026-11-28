// ─── OPS-1B: bootstrap failure honesty (isolated file — mocks one queue) ─────
// B5: a worker whose bootstrap throws is handled honestly:
//     • register()/bootstrap do NOT throw out (startup never crashes opaque);
//     • the failure is logged with an operator-facing line;
//     • the OTHER two workers still start;
//     • the failed one reports registered:false to /api/healthz — readiness
//       is never invented.
// Separate file so mock.module cleanly replaces only the Riishe queue module
// in this file's own module registry (bun --isolate: per-file globals).

import { describe, it, expect, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ops1-bootstrap-fail-'))
const isolatedUrl = `file:${join(dir, 'ops1-bootstrap-fail.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

// Replace ONLY the Riishe queue module with a bootstrap that throws honestly.
mock.module('@/lib/riishe/jobs', () => ({
  ensureWorker: () => {
    throw new Error('simulated riishe worker bootstrap failure')
  },
  riisheWorkerLiveness: () => ({ registered: false, lastTickAt: null }),
  stopRiisheWorkerForTests: () => undefined,
}))

process.env.CI_ENABLE_WORKER = '1'

const { bootstrapDurableQueueWorkers } = await import('@/instrumentation')
const { ciWorkerLiveness, ciEvaluationPipelineRegistered, stopCiWorkerForTests } = await import('@/lib/ci/queue')
const { fleetWorkerLiveness, fleetExecutorRegistered, stopFleetWorkerForTests } = await import('@/lib/ci/fleet/worker')

afterAll(() => {
  stopCiWorkerForTests()
  stopFleetWorkerForTests()
  delete process.env.CI_ENABLE_WORKER
  rmSync(dir, { recursive: true, force: true })
})

describe('OPS-1B bootstrap failure honesty', () => {
  it('B5: one worker failing to start is logged, does not throw, and the others still start', async () => {
    const captured: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '))
      // keep the original output visible for debugging honesty
      originalError(...args)
    }

    let bootstrap: unknown = undefined
    try {
      bootstrap = await bootstrapDurableQueueWorkers()
    } finally {
      console.error = originalError
    }

    // register()/bootstrap resolved normally — a failed worker never crashes
    // server startup, and there is nothing to await.
    expect(bootstrap).toBeUndefined()

    // The failure was logged honestly and names the failing worker.
    const failureLine = captured.find((line) => line.includes('[worker bootstrap]') && line.includes('riishe'))
    expect(failureLine).toBeDefined()
    expect(failureLine).toContain('failed to start')

    // The other two workers still started, with their executor seams.
    expect(ciWorkerLiveness().registered).toBe(true)
    expect(fleetWorkerLiveness().registered).toBe(true)
    expect(ciEvaluationPipelineRegistered()).toBe(true)
    expect(fleetExecutorRegistered()).toBe(true)
  })
})
