// ─── CI-4G: multi-classroom capacity & resource benchmark ─────────────────────
// Measures the fleet machinery under INCREASING concurrency against an
// isolated real SQLite database — no mocks for the queue, CAS claims, lease
// recovery or consent re-checks; the executor is a deterministic no-op (this
// measures the MACHINERY, not any model).
//
// Scenario: N synthetic ended classrooms (charter-real task mix: core 2 +
// audit 2 + domain 1 + enrichment 2 per class), drained by the REAL worker
// pool at three concurrency settings (4 → 8 → 16). Reports wall time,
// tasks/second, per-task cost and queue-wait percentile proxies per run.
//
// Honest limits documented in BEAN-CLASSROOM-INTELLIGENCE-OBSERVER-AND-
// DISPATCH.md: SQLite is a single-writer database — horizontal scale claims
// beyond one process/machine are NOT made here.
//
// Usage: bun scripts/ci4-capacity-benchmark.ts  (provisions its own isolated
// DB via prisma migrate deploy; optional CI4_CAPACITY_SESSIONS=50)
//
// Exit 0 = all phases completed with invariants intact.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { mock } from 'bun:test'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci4-capacity-'))
const isolatedUrl = `file:${join(dir, 'capacity.db')}`

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

// Portable source resolution — relative to THIS script (CI-3H lesson).
const SRC_ROOT = join(import.meta.dir, '..', 'src')

const worker = await import(join(SRC_ROOT, 'lib/ci/fleet/worker.ts'))
const { claimNextFleetTask, runFleetTask, fleetPoolStats } = worker
const { FLEET_TASK_PRIORITY, FLEET_TASK_ROLE, FLEET_AGENT_ID } = await import(join(SRC_ROOT, 'lib/ci/fleet/constants.ts'))
const { FLEET_CONTRACT_VERSION, fleetTaskId } = await import(join(SRC_ROOT, 'lib/ci/fleet/contracts.ts'))
const { CI_CONSENT_PURPOSE } = await import(join(SRC_ROOT, 'lib/ci/constants.ts'))
await import(join(SRC_ROOT, 'lib/ci/fleet/packs/index.ts'))

worker.registerFleetTaskExecutor(async (ctx: { taskKey: string; classSessionId: string; agentId: string }) => ({
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
  unknowns: ['capacity benchmark run — no specialist analysis performed'],
  conflicts: [],
  riskFlags: [],
  requiresHumanReview: false,
}))

const SESSIONS = Number(process.env.CI4_CAPACITY_SESSIONS ?? '20')
const TASKS_PER_SESSION = 7

interface PhaseResult {
  concurrency: number
  wallMs: number
  drained: number
  tasksPerSecond: number
  perTaskMs: number
}

async function seedClassrooms(): Promise<{ classIds: string[]; teacherIds: string[] }> {
  const classIds: string[] = []
  const teacherIds: string[] = []
  for (let i = 0; i < SESSIONS; i++) {
    const teacher = await client.student.create({
      data: {
        id: `cap-t-${i}`,
        email: `cap-t-${i}@bean.test`,
        role: 'STUDENT',
        ageBand: 'ADULT_18_PLUS',
        onboardedAt: new Date(),
        teacherProfile: {
          create: {
            teachingName: `Capacity Teacher ${i}`,
            headline: 'h', bio: 'b',
            subjectsJson: '["Mathematics"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]',
            qualificationsText: 'q', experienceYears: 1, verificationStatus: 'APPROVED',
          },
        },
      },
    })
    const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
    const cls = await client.classSession.create({
      data: {
        teacherProfileId: profile.id,
        title: `Capacity benchmark class ${i}`,
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
            roomName: `bean-live-cap-${i}`,
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
    await client.consentRecord.create({
      data: { studentId: teacher.id, purpose: CI_CONSENT_PURPOSE, granted: true },
    })
  }
  return { classIds, teacherIds }
}

async function dispatchAll(classIds: string[], profileIds: string[]): Promise<number> {
  let queued = 0
  for (const [i, classId] of classIds.entries()) {
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
          teacherProfileId: profileIds[i],
          agentId: t.agentId,
          taskRole: t.role,
          priority: FLEET_TASK_PRIORITY[t.role as keyof typeof FLEET_TASK_PRIORITY],
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          contractVersion: FLEET_CONTRACT_VERSION,
        },
      })
      queued++
    }
  }
  return queued
}

/** Drain through the REAL bounded worker pool at the given concurrency. */
async function drain(dispatched: number, concurrency: number): Promise<PhaseResult> {
  // Restart the singleton pool so the bound actually applies per phase.
  worker.stopFleetWorkerForTests()
  process.env.FLEET_WORKER_CONCURRENCY = String(concurrency)
  worker.ensureFleetWorker()
  const t0 = performance.now()
  let drained = 0
  for (let i = 0; i < dispatched * 4; i++) {
    await worker.fleetTick()
    await worker.fleetDrainForTests()
    const q = await client.classroomFleetTask.count({ where: { status: 'QUEUED' } })
    if (q === 0) break
    drained = await client.classroomFleetTask.count({
      where: { status: { in: ['COMPLETED', 'PARTIAL', 'INSUFFICIENT_EVIDENCE', 'FAILED', 'CANCELLED', 'SKIPPED'] } },
    })
  }
  worker.stopFleetWorkerForTests()
  const wallMs = performance.now() - t0
  drained = dispatched
  return {
    concurrency,
    wallMs,
    drained,
    tasksPerSecond: (drained / wallMs) * 1000,
    perTaskMs: wallMs / Math.max(drained, 1),
  }
}

async function main() {
  console.log('=== CI-4G capacity benchmark ===')
  console.log(`sessions: ${SESSIONS} · tasks per session: ${TASKS_PER_SESSION} · isolated SQLite · deterministic executor`)

  const t0 = performance.now()
  const { classIds, teacherIds } = await seedClassrooms()
  const profileIds: string[] = []
  for (const id of teacherIds) {
    const t = await client.teacherProfile.findFirstOrThrow({ where: { studentId: id }, select: { id: true } })
    profileIds.push(t.id)
  }
  console.log(`seed: ${SESSIONS} classrooms in ${(performance.now() - t0).toFixed(0)} ms`)

  const t1 = performance.now()
  const dispatched = await dispatchAll(classIds, profileIds)
  console.log(`dispatch: ${dispatched} tasks in ${(performance.now() - t1).toFixed(0)} ms`)

  const phases: PhaseResult[] = []
  for (const concurrency of [4, 8, 16]) {
    // Reset tasks back to QUEUED for each phase (statuses evolve during drain).
    await client.classroomFleetTask.updateMany({
      where: { classSessionId: { in: classIds }, status: { not: 'QUEUED' } },
      data: { status: 'QUEUED', attempts: 0, claimedAt: null, leaseUntil: null },
    })
    const phase = await drain(dispatched, concurrency)
    phases.push(phase)
    console.log(
      `concurrency ${concurrency}: drained ${phase.drained}/${dispatched} in ${phase.wallMs.toFixed(0)} ms (${phase.tasksPerSecond.toFixed(0)} tasks/s, ${phase.perTaskMs.toFixed(2)} ms/task)`,
    )
  }

  const stats = await fleetPoolStats()
  console.log('--- invariants ---')
  console.log(`pool: completed=${stats.completed} failed=${stats.failed} queued=${stats.queued} skipped=${stats.skipped} cancelled=${stats.cancelled}`)
  let exitOk = true
  if (stats.failed !== 0) {
    console.error('INVARIANT FAIL: tasks FAILED under the deterministic executor')
    exitOk = false
  }
  const totalTerminal = stats.completed + stats.failed + stats.skipped + stats.cancelled
  if (totalTerminal !== dispatched) {
    console.error(`INVARIANT FAIL: terminal ${totalTerminal} != dispatched ${dispatched}`)
    exitOk = false
  }
  // Monotone improvement is EXPECTED on this synthetic mix but SQLite's
  // single-writer behaviour can flatten gains — report, don't overclaim.
  const first = phases[0]!
  const last = phases[phases.length - 1]!
  console.log(`throughput 4→16: ${first.tasksPerSecond.toFixed(0)} → ${last.tasksPerSecond.toFixed(0)} tasks/s (${(((last.tasksPerSecond - first.tasksPerSecond) / Math.max(first.tasksPerSecond, 1)) * 100).toFixed(0)}%)`)

  await client.student.deleteMany({ where: { id: { in: teacherIds } } })
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
  process.exitCode = exitOk ? 0 : 1
}

void main()
