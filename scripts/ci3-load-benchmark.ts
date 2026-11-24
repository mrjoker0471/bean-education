// CI-3H load/recovery benchmark (charter §19 CI-3H: "load/recovery benchmarks").
//
// Measures REAL throughput and recovery behaviour of the CI-3 fleet machinery
// against an isolated real SQLite database — no mocks for the queue, the CAS
// claims, the lease recovery or the observer cancellation sweep. The executor
// is a deterministic no-op (this benchmark measures the MACHINERY, not the
// model). Every number printed is measured here; nothing is extrapolated or
// claimed beyond what this run did.
//
// Usage: DATABASE_URL=file:/tmp/ci3-load.db bun scripts/ci3-load-benchmark.ts
// (the script provisions the schema itself via prisma migrate deploy).
//
// Exit code 0 = all benchmark phases completed. Results are transcribed into
// docs/BEAN-CLASSROOM-INTELLIGENCE-CI3-RESULTS.md.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { mock } from 'bun:test'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3-load-'))
const isolatedUrl = `file:${join(dir, 'load.db')}`

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { claimNextFleetTask, runFleetTask, recoverExpiredFleetLeases, cancelFleetTasksForSession, fleetPoolStats } = await import(
  '/home/z/ci3c/src/lib/ci/fleet/worker.ts'
)
const { registerFleetTaskExecutor } = await import('/home/z/ci3c/src/lib/ci/fleet/worker.ts')
const { FLEET_TASK_PRIORITY, FLEET_TASK_ROLE, FLEET_AGENT_ID } = await import('/home/z/ci3c/src/lib/ci/fleet/constants.ts')
const { FLEET_CONTRACT_VERSION, fleetTaskId } = await import('/home/z/ci3c/src/lib/ci/fleet/contracts.ts')
const { CI_CONSENT_PURPOSE } = await import('/home/z/ci3c/src/lib/ci/constants.ts')
// The dispatcher imports the seed packs so specialists resolve against the
// deployed knowledge base — the benchmark reproduces the same deployment shape.
await import('/home/z/ci3c/src/lib/ci/fleet/packs/index.ts')

// Deterministic executor: validates the seam contract end-to-end.
registerFleetTaskExecutor(async (ctx) => ({
  contractVersion: FLEET_CONTRACT_VERSION,
  taskId: ctx.taskKey,
  classSessionId: ctx.classSessionId,
  agentId: ctx.agentId,
  agentVersion: '1.0.0',
  domainPackId: null,
  domainPackVersion: null,
  language: { requested: 'English', detected: 'English', confidence: 'low' },
  status: 'COMPLETED',
  findings: [],
  unknowns: ['benchmark run — no specialist analysis performed'],
  conflicts: [],
  riskFlags: [],
  requiresHumanReview: false,
}))

const SESSIONS = Number(process.env.CI3_LOAD_SESSIONS ?? '50')

async function timed(label: string, fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now()
  await fn()
  const ms = performance.now() - t0
  console.log(`[load] ${label}: ${ms.toFixed(0)} ms`)
  return ms
}

async function main() {
  console.log('=== CI-3H load/recovery benchmark ===')
  console.log(`sessions: ${SESSIONS} · tasks per session: 7 (core 2 + audit 2 + domain 1 + enrichment 2) · isolated SQLite`)

  // ── Seed: N teachers, classes and terminal live sessions ──
  const teacherIds: string[] = []
  const classIds: string[] = []
  const tSeed = await timed('seed', async () => {
    for (let i = 0; i < SESSIONS; i++) {
      const teacher = await client.student.create({
        data: {
          id: `load-t-${i}`,
          email: `load-t-${i}@bean.test`,
          role: 'STUDENT',
          ageBand: 'ADULT_18_PLUS',
          onboardedAt: new Date(),
          teacherProfile: {
            create: {
              teachingName: `Load Teacher ${i}`,
              headline: 'h',
              bio: 'b',
              subjectsJson: '[]',
              levelsJson: '[]',
              languagesJson: '[]',
              qualificationsText: 'q',
              experienceYears: 1,
              verificationStatus: 'APPROVED',
            },
          },
        },
      })
      const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
      const cls = await client.classSession.create({
        data: {
          teacherProfileId: profile.id,
          title: `Load benchmark class ${i}`,
          description: 'd',
          subject: 'Mathematics',
          targetLevel: 'SCHOOL_9_10',
          language: 'English',
          durationMinutes: 60,
          startsAt: new Date(),
          timeZone: 'UTC',
          status: 'PUBLISHED',
          capacity: 5,
          minimumStudents: 1,
          liveSession: {
            create: {
              roomName: `bean-live-load-${i}`,
              status: 'ENDED',
              startedById: teacher.id,
              startedAt: new Date(),
              endedAt: new Date(),
              usageMonthKey: '2026-11',
              usageFinalisedAt: new Date(),
            },
          },
        },
      })
      teacherIds.push(teacher.id)
      classIds.push(cls.id)
      // The claim-time consent re-check is part of the machinery under test —
      // benchmark teachers hold the same CI consent record the real flow grants.
      await client.consentRecord.create({
        data: { studentId: teacher.id, purpose: CI_CONSENT_PURPOSE, granted: true },
      })
    }
  })

  // ── Dispatch: 7 tasks per session (the real taskKey uniqueness path) ──
  let dispatched = 0
  const tDispatch = await timed(`dispatch ${SESSIONS * 7} tasks`, async () => {
    for (const classId of classIds) {
      const tasks = [
        { agentId: FLEET_AGENT_ID.LEARNER, role: FLEET_TASK_ROLE.CORE, domain: undefined },
        { agentId: FLEET_AGENT_ID.TEACHER_JUDGE, role: FLEET_TASK_ROLE.CORE, domain: undefined },
        { agentId: FLEET_AGENT_ID.EVIDENCE_AUDITOR, role: FLEET_TASK_ROLE.MANDATORY_AUDIT, domain: undefined },
        { agentId: FLEET_AGENT_ID.SAFETY_GUARDIAN, role: FLEET_TASK_ROLE.MANDATORY_AUDIT, domain: undefined },
        { agentId: 'BEAN_SUBJECT_EXPERT::mathematics-statistics', role: FLEET_TASK_ROLE.DOMAIN_SPECIALIST, domain: 'mathematics-statistics' },
        { agentId: FLEET_AGENT_ID.TEACHER_COACH, role: FLEET_TASK_ROLE.ENRICHMENT, domain: undefined },
        { agentId: FLEET_AGENT_ID.STUDENT_REVISION_COACH, role: FLEET_TASK_ROLE.ENRICHMENT, domain: undefined },
      ]
      for (const t of tasks) {
        await client.classroomFleetTask.create({
          data: {
            taskKey: fleetTaskId(classId, t.agentId, t.domain),
            classSessionId: classId,
            teacherProfileId: classIds.indexOf(classId) >= 0 ? (await client.classSession.findUniqueOrThrow({ where: { id: classId }, select: { teacherProfileId: true } })).teacherProfileId : '',
            agentId: t.agentId,
            taskRole: t.role,
            priority: FLEET_TASK_PRIORITY[t.role as keyof typeof FLEET_TASK_PRIORITY],
            status: 'QUEUED',
            attempts: 0,
            maxAttempts: 3,
            contractVersion: FLEET_CONTRACT_VERSION,
          },
        })
        dispatched++
      }
    }
  })

  // ── Drain: CAS claim + run to completion (sequential — measures per-task cost).
  // A null claim means one pass found only legitimately-skippable candidates —
  // the drain continues until the queue is actually empty. ──
  let drained = 0
  const tDrain = await timed(`drain ${dispatched} tasks (claim+run)`, async () => {
    for (let i = 0; i < dispatched * 8; i++) {
      const task = await claimNextFleetTask()
      if (!task) {
        const queued = await client.classroomFleetTask.count({ where: { status: 'QUEUED' } })
        if (queued === 0) break
        continue
      }
      await runFleetTask(task)
      drained++
    }
  })

  const statsAfter = await fleetPoolStats()

  // ── Lease recovery: interrupt tasks mid-flight and recover them ──
  const interrupted = await client.classroomFleetTask.updateMany({
    where: { classSessionId: { in: classIds.slice(0, 10) }, status: 'COMPLETED' },
    data: { status: 'RUNNING', leaseUntil: new Date(Date.now() - 60_000) },
  })
  const tRecover = await timed(`lease recovery sweep (${interrupted.count} stale)`, async () => {
    await recoverExpiredFleetLeases()
  })

  // ── Cancellation sweep: cancel all non-terminal tasks for 20 sessions ──
  await client.classroomFleetTask.updateMany({
    where: { classSessionId: { in: classIds.slice(0, 20) }, status: { in: ['COMPLETED', 'QUEUED'] } },
    data: { status: 'QUEUED' },
  })
  const tCancel = await timed('cancellation sweep (20 sessions)', async () => {
    for (const classId of classIds.slice(0, 20)) {
      await cancelFleetTasksForSession(classId)
    }
  })

  const statsEnd = await fleetPoolStats()

  console.log('--- summary ---')
  console.log(`seed: ${SESSIONS} sessions in ${tSeed.toFixed(0)} ms`)
  console.log(`dispatch: ${dispatched} tasks in ${tDispatch.toFixed(0)} ms (${((dispatched / tDispatch) * 1000).toFixed(0)} tasks/s)`)
  console.log(`drain: ${drained}/${dispatched} tasks claimed+run in ${tDrain.toFixed(0)} ms (${drained > 0 ? ((drained / tDrain) * 1000).toFixed(0) : 0} tasks/s, ${(tDrain / Math.max(drained, 1)).toFixed(1)} ms/task)`)
  console.log(`lease recovery: ${interrupted.count} stale rows re-queued in ${tRecover.toFixed(0)} ms`)
  console.log(`cancellation: 20 sessions swept in ${tCancel.toFixed(0)} ms`)
  console.log(`pool after drain: completed=${statsAfter.completed} failed=${statsAfter.failed} queued=${statsAfter.queued} skipped=${statsAfter.skipped}`)
  console.log(`pool after sweeps: queued=${statsEnd.queued} cancelled=${statsEnd.cancelled} skipped=${statsEnd.skipped}`)

  // Honest invariants — the benchmark FAILS if the machinery misbehaved.
  const terminal = statsEnd.completed + statsEnd.failed + statsEnd.skipped + statsEnd.cancelled
  if (terminal !== dispatched) {
    console.error(`INVARIANT FAIL: terminal tasks ${terminal} != dispatched ${dispatched}`)
    process.exitCode = 1
  }
  if (statsEnd.failed !== 0) {
    console.error(`INVARIANT FAIL: ${statsEnd.failed} tasks FAILED under the deterministic executor`)
    process.exitCode = 1
  }

  await client.student.deleteMany({ where: { id: { in: teacherIds } } })
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
}

void main()
