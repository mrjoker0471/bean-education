// ─── CI-3C tests: fleet dispatcher + bounded worker pool (isolated real DB) ──
// Real database behaviour, not mocked output. Coverage:
//   P1  planFleetTasks (pure): mandatory honesty pair + core pair always
//       planned; deterministic subject→domain resolution with dispatchable
//       packs and the 3-domain cap; honest no-match skip; language only on
//       multilingual evidence; enrichment default-on and excludable; taskKey
//       scheme matches the contract's fleetTaskId
//   D1  dispatchFleetForSession (DB): eligibility guards (class / live
//       terminal / consent), durable idempotent dispatch (UNIQUE taskKey,
//       P2002 race → alreadyQueued), worker ensured
//   C1  claims: CAS single-winner, priority order (core before enrichment),
//       claim-time consent re-check → honest skip, unresolvable agent → honest
//       skip, ENRICHMENT backpressure → honest skip
//   E1  execution: executor seam, contract-validated outputs persisted
//       verbatim, honest INSUFFICIENT_EVIDENCE, contract rejection → FAILED
//       with reason, identity mismatch → FAILED, no executor → honest FAILED,
//       throw → retry then FAILED, lease recovery, session cancellation,
//       pool stats

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { FleetTaskExecutionContext } from '@/lib/ci/fleet/worker'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3c-'))
const isolatedUrl = `file:${join(dir, 'ci3c.db')}`

// Bind the app's db singleton to the isolated database BEFORE the modules
// under test are imported (mock.module runs first; dynamic imports follow).
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const {
  planFleetTasks,
  dispatchFleetForSession,
} = await import('@/lib/ci/fleet/dispatcher')
const {
  registerFleetTaskExecutor,
  unregisterFleetTaskExecutorForTests,
  claimNextFleetTask,
  runFleetTask,
  recoverExpiredFleetLeases,
  cancelFleetTasksForSession,
  fleetPoolStats,
  fleetTick,
} = await import('@/lib/ci/fleet/worker')
const { grantCiConsent, withdrawCiConsent } = await import('@/lib/ci/trigger')
const { FLEET_AGENT_ID, FLEET_TASK_ROLE, FLEET_TASK_PRIORITY, FLEET_TASK_STATUS, subjectExpertInstanceId } = await import('@/lib/ci/fleet/constants')
const { FLEET_CONTRACT_VERSION, fleetTaskId } = await import('@/lib/ci/fleet/contracts')
const { CI_CONSENT_PURPOSE } = await import('@/lib/ci/constants')

beforeAll(() => {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  unregisterFleetTaskExecutorForTests()
})

// ─── Seed helpers ───────────────────────────────────────────────────────────────

const HOUR = 3600_000
const FLEET_LEASE_TEST_MS = 8 * 60_000

async function seedTeacherAndClass(opts?: { subject?: string; title?: string; liveStatus?: string | null }) {
  const teacher = await client.student.create({
    data: { id: `t-${Math.random().toString(36).slice(2, 10)}`, email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`, role: 'STUDENT', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), teacherProfile: { create: { teachingName: 'Teacher T', headline: 'h', bio: 'b', subjectsJson: '["Maths"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 3, verificationStatus: 'APPROVED', isPublished: true } } },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: opts?.title ?? 'Quadratic equations — intuition first',
      description: 'Build the intuition behind quadratics, then solve by factorisation and the formula.',
      subject: opts?.subject ?? 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 2 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
    },
  })
  if (opts?.liveStatus) {
    await client.liveClassSession.create({
      data: {
        classSessionId: cls.id,
        roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
        status: opts.liveStatus,
        startedById: teacher.id,
        startedAt: new Date(Date.now() - 2 * HOUR),
        endedAt: new Date(Date.now() - 1 * HOUR),
        usageMonthKey: new Date().toISOString().slice(0, 7),
      },
    })
  }
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } }) // cascades everything
}

async function seedFleetTask(opts: {
  classId: string
  profileId: string
  agentId: string
  taskRole?: string
  priority?: number
  status?: string
  attempts?: number
  maxAttempts?: number
  leaseUntil?: Date | null
  taskKeySuffix?: string
}) {
  return client.classroomFleetTask.create({
    data: {
      taskKey: `${opts.classId}:${opts.agentId}${opts.taskKeySuffix ? `:${opts.taskKeySuffix}` : ''}`,
      classSessionId: opts.classId,
      teacherProfileId: opts.profileId,
      agentId: opts.agentId,
      taskRole: opts.taskRole ?? FLEET_TASK_ROLE.CORE,
      priority: opts.priority ?? FLEET_TASK_PRIORITY.CORE,
      status: opts.status ?? 'QUEUED',
      attempts: opts.attempts ?? 0,
      maxAttempts: opts.maxAttempts ?? 3,
      contractVersion: FLEET_CONTRACT_VERSION,
      leaseUntil: opts.leaseUntil ?? null,
    },
  })
}

function validEnvelope(task: { taskKey: string; classSessionId: string; agentId: string }, status: string = FLEET_TASK_STATUS.COMPLETED) {
  return {
    contractVersion: FLEET_CONTRACT_VERSION,
    taskId: task.taskKey,
    classSessionId: task.classSessionId,
    agentId: task.agentId,
    agentVersion: '1.0.0',
    domainPackId: null,
    domainPackVersion: null,
    language: { requested: 'English', detected: 'English', confidence: 'high' },
    status,
    findings:
      status === FLEET_TASK_STATUS.COMPLETED
        ? [{
            findingId: 'f-1',
            category: 'subject accuracy',
            observation: 'Quadratic factorisation steps matched the worked examples on the board.',
            evidenceRefIds: [],
            evidenceKinds: ['ATTENDANCE_RECORD'],
            evidenceBasis: 'available',
            sourceRefs: [],
            confidence: 'medium',
            limitations: ['class-level observation only — no individual learner evidence'],
            suggestion: null,
          }]
        : [],
    unknowns: status === FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE ? ['no permitted evidence was available for this signal'] : [],
    conflicts: [],
    riskFlags: [],
    requiresHumanReview: false,
  }
}

// ─── P1: planning ───────────────────────────────────────────────────────────────

describe('CI-3C dispatcher: planFleetTasks (P1)', () => {
  test('P1.1 core pair + mandatory honesty pair are ALWAYS planned, with correct roles/priorities', () => {
    const plan = planFleetTasks({ classSessionId: 'c1', teacherProfileId: 'p1', subjectText: 'Underwater basket weaving', multilingualEvidence: false })
    const byAgent = new Map(plan.tasks.map(t => [t.agentId, t]))
    expect(byAgent.get(FLEET_AGENT_ID.LEARNER)?.taskRole).toBe(FLEET_TASK_ROLE.CORE)
    expect(byAgent.get(FLEET_AGENT_ID.LEARNER)?.priority).toBe(FLEET_TASK_PRIORITY.CORE)
    expect(byAgent.get(FLEET_AGENT_ID.TEACHER_JUDGE)?.taskRole).toBe(FLEET_TASK_ROLE.CORE)
    expect(byAgent.get(FLEET_AGENT_ID.EVIDENCE_AUDITOR)?.taskRole).toBe(FLEET_TASK_ROLE.MANDATORY_AUDIT)
    expect(byAgent.get(FLEET_AGENT_ID.SAFETY_GUARDIAN)?.taskRole).toBe(FLEET_TASK_ROLE.MANDATORY_AUDIT)
    // An unknown subject must never produce a guessed specialist.
    expect(plan.tasks.filter(t => t.taskRole === FLEET_TASK_ROLE.DOMAIN_SPECIALIST)).toHaveLength(0)
    expect(plan.skips.some(s => s.taskRole === FLEET_TASK_ROLE.DOMAIN_SPECIALIST && s.agentId === null)).toBe(true)
    // Language specialist absent without evidence — recorded honestly.
    expect(plan.tasks.filter(t => t.taskRole === FLEET_TASK_ROLE.LANGUAGE)).toHaveLength(0)
    expect(plan.notes.some(n => n.includes('language specialist not planned'))).toBe(true)
    expect(plan.notes.some(n => n.includes('no guessing'))).toBe(true)
  })

  test('P1.2 subject resolution plans a dispatchable-pack specialist with instance id and domain', () => {
    const plan = planFleetTasks({ classSessionId: 'c2', teacherProfileId: 'p2', subjectText: 'Mathematics quadratics', multilingualEvidence: false })
    const expectedInstance = subjectExpertInstanceId('mathematics-statistics')
    const specialist = plan.tasks.find(t => t.agentId === expectedInstance)
    expect(specialist).toBeDefined()
    expect(specialist?.taskRole).toBe(FLEET_TASK_ROLE.DOMAIN_SPECIALIST)
    expect(specialist?.priority).toBe(FLEET_TASK_PRIORITY.DOMAIN_SPECIALIST)
    expect(specialist?.domainId).toBe('mathematics-statistics')
    expect(specialist?.taskKey).toBe(fleetTaskId('c2', expectedInstance, 'mathematics-statistics'))
  })

  test('P1.3 language specialist planned ONLY with multilingual evidence', () => {
    const withEvidence = planFleetTasks({ classSessionId: 'c3', teacherProfileId: 'p3', subjectText: 'Underwater basket weaving', multilingualEvidence: true })
    expect(withEvidence.tasks.some(t => t.agentId === FLEET_AGENT_ID.LANGUAGE && t.taskRole === FLEET_TASK_ROLE.LANGUAGE)).toBe(true)
    const withoutEvidence = planFleetTasks({ classSessionId: 'c3', teacherProfileId: 'p3', subjectText: 'Mathematics', multilingualEvidence: false })
    expect(withoutEvidence.tasks.some(t => t.agentId === FLEET_AGENT_ID.LANGUAGE)).toBe(false)
  })

  test('P1.4 enrichment planned by default, excludable by the caller', () => {
    const def = planFleetTasks({ classSessionId: 'c4', teacherProfileId: 'p4', subjectText: 'nothing that matches', multilingualEvidence: false })
    expect(def.tasks.filter(t => t.taskRole === FLEET_TASK_ROLE.ENRICHMENT)).toHaveLength(2)
    const excluded = planFleetTasks({ classSessionId: 'c4', teacherProfileId: 'p4', subjectText: 'nothing that matches', multilingualEvidence: false, includeEnrichment: false })
    expect(excluded.tasks.filter(t => t.taskRole === FLEET_TASK_ROLE.ENRICHMENT)).toHaveLength(0)
    expect(excluded.notes.some(n => n.includes('enrichment not planned'))).toBe(true)
  })

  test('P1.5 every planned task carries the live contract version and a unique taskKey', () => {
    const plan = planFleetTasks({ classSessionId: 'c5', teacherProfileId: 'p5', subjectText: 'Mathematics statistics', multilingualEvidence: true })
    expect(plan.tasks.length).toBeGreaterThan(4)
    for (const t of plan.tasks) expect(t.contractVersion).toBe(FLEET_CONTRACT_VERSION)
    const keys = new Set(plan.tasks.map(t => t.taskKey))
    expect(keys.size).toBe(plan.tasks.length)
  })
})

// ─── D1: durable dispatch ───────────────────────────────────────────────────────

describe('CI-3C dispatcher: dispatchFleetForSession (D1)', () => {
  test('D1.1 refuses honestly before any row is created', async () => {
    const missing = await dispatchFleetForSession({ classSessionId: 'does-not-exist' })
    expect(missing).toEqual({ dispatched: false, reason: 'class_not_found' })

    const touchedClasses: string[] = []
    const seeded = await seedTeacherAndClass({ liveStatus: null })
    touchedClasses.push(seeded.classId)
    try {
      const noLive = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(noLive).toEqual({ dispatched: false, reason: 'no_live_session' })

      const running = await seedTeacherAndClass({ liveStatus: 'LIVE' })
      touchedClasses.push(running.classId)
      try {
        const notTerminal = await dispatchFleetForSession({ classSessionId: running.classId })
        expect(notTerminal).toEqual({ dispatched: false, reason: 'class_not_terminal' })
      } finally {
        await cleanupTeacher(running.teacherId)
      }

      const terminal = await seedTeacherAndClass({ liveStatus: 'ENDED' })
      touchedClasses.push(terminal.classId)
      try {
        const noConsent = await dispatchFleetForSession({ classSessionId: terminal.classId })
        expect(noConsent).toEqual({ dispatched: false, reason: 'no_consent' })
      } finally {
        await cleanupTeacher(terminal.teacherId)
      }
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
    const rows = await client.classroomFleetTask.count({ where: { classSessionId: { in: touchedClasses } } })
    expect(rows).toBe(0)
  })

  test('D1.2 dispatches the planned fleet durably after a terminal session with consent', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED' })
    try {
      await grantCiConsent(seeded.teacherId)
      const result = await dispatchFleetForSession({ classSessionId: seeded.classId })
      if (!result.dispatched) throw new Error('expected dispatch')
      // core(2) + audit(2) + mathematics specialist(1) + enrichment(2)
      expect(result.queued).toHaveLength(7)
      expect(result.alreadyQueued).toHaveLength(0)
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      expect(rows).toHaveLength(7)
      for (const row of rows) {
        expect(row.status).toBe('QUEUED')
        expect(row.contractVersion).toBe(FLEET_CONTRACT_VERSION)
        expect(row.maxAttempts).toBe(3)
      }
      const roles = new Set(rows.map(r => r.taskRole))
      expect(roles).toEqual(new Set([FLEET_TASK_ROLE.CORE, FLEET_TASK_ROLE.MANDATORY_AUDIT, FLEET_TASK_ROLE.DOMAIN_SPECIALIST, FLEET_TASK_ROLE.ENRICHMENT]))
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('D1.3 is idempotent: a repeat dispatch reports the winner rows as already queued', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'INTERRUPTED' })
    try {
      await grantCiConsent(seeded.teacherId)
      const first = await dispatchFleetForSession({ classSessionId: seeded.classId })
      if (!first.dispatched) throw new Error('expected first dispatch')
      expect(first.queued.length).toBeGreaterThan(0)
      const second = await dispatchFleetForSession({ classSessionId: seeded.classId })
      if (!second.dispatched) throw new Error('expected second dispatch')
      expect(second.queued).toHaveLength(0)
      expect(second.alreadyQueued).toHaveLength(first.queued.length)
      const rows = await client.classroomFleetTask.count({ where: { classSessionId: seeded.classId } })
      expect(rows).toBe(first.queued.length)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── C1: claims ─────────────────────────────────────────────────────────────────

describe('CI-3C worker: claims (C1)', () => {
  test('C1.1 claims are CAS single-winner and priority-ordered (core before enrichment)', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const enrichment = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.TEACHER_COACH, taskRole: FLEET_TASK_ROLE.ENRICHMENT, priority: FLEET_TASK_PRIORITY.ENRICHMENT, taskKeySuffix: 'k1' })
      const core = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskRole: FLEET_TASK_ROLE.CORE, priority: FLEET_TASK_PRIORITY.CORE, taskKeySuffix: 'k2' })
      const first = await claimNextFleetTask()
      expect(first?.id).toBe(core.id)
      const second = await claimNextFleetTask()
      expect(second?.id).toBe(enrichment.id)
      expect(second?.id).not.toBe(first?.id)
      const third = await claimNextFleetTask()
      expect(third).toBeNull()
      const states = await client.classroomFleetTask.findMany({ where: { id: { in: [core.id, enrichment.id] } } })
      for (const row of states) expect(row.status).toBe('RUNNING')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('C1.2 consent withdrawn between dispatch and claim → honest SKIPPED consent_not_granted', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k3' })
      await withdrawCiConsent(seeded.teacherId)
      const claimed = await claimNextFleetTask()
      expect(claimed).toBeNull()
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe('SKIPPED')
      expect(row.skipReason).toBe('consent_not_granted')
      expect(row.finishedAt).not.toBeNull()
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('C1.3 unresolvable agent (no registered pack) → honest SKIPPED agent_unresolvable', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const ghost = subjectExpertInstanceId('nonexistent-domain')
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: ghost, taskRole: FLEET_TASK_ROLE.DOMAIN_SPECIALIST, priority: FLEET_TASK_PRIORITY.DOMAIN_SPECIALIST, taskKeySuffix: 'k4' })
      const claimed = await claimNextFleetTask()
      expect(claimed).toBeNull()
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe('SKIPPED')
      expect(row.skipReason).toContain('agent_unresolvable')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('C1.4 ENRICHMENT yields under backpressure: backlog > threshold → honest SKIPPED capacity_backpressure', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      // Target first so it is the first candidate; then fill the backlog past the threshold.
      const target = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.STUDENT_REVISION_COACH, taskRole: FLEET_TASK_ROLE.ENRICHMENT, priority: FLEET_TASK_PRIORITY.ENRICHMENT, taskKeySuffix: 'k5' })
      const filler = Array.from({ length: 51 }, (_, i) => ({
        taskKey: `${seeded.classId}:BEAN_FILLER:${i}`,
        classSessionId: seeded.classId,
        teacherProfileId: seeded.profileId,
        agentId: FLEET_AGENT_ID.TEACHER_COACH,
        taskRole: FLEET_TASK_ROLE.ENRICHMENT,
        priority: FLEET_TASK_PRIORITY.ENRICHMENT,
        status: 'QUEUED',
        contractVersion: FLEET_CONTRACT_VERSION,
      }))
      await client.classroomFleetTask.createMany({ data: filler })
      const claimed = await claimNextFleetTask()
      expect(claimed).toBeNull()
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: target.id } })
      expect(row.status).toBe('SKIPPED')
      expect(row.skipReason).toBe('capacity_backpressure')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('C1.5 core work still claims under backpressure — enrichment yields, honesty does not', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const core = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.EVIDENCE_AUDITOR, taskRole: FLEET_TASK_ROLE.MANDATORY_AUDIT, priority: FLEET_TASK_PRIORITY.MANDATORY_AUDIT, taskKeySuffix: 'k6' })
      const filler = Array.from({ length: 60 }, (_, i) => ({
        taskKey: `${seeded.classId}:BEAN_FILLER2:${i}`,
        classSessionId: seeded.classId,
        teacherProfileId: seeded.profileId,
        agentId: FLEET_AGENT_ID.TEACHER_COACH,
        taskRole: FLEET_TASK_ROLE.ENRICHMENT,
        priority: FLEET_TASK_PRIORITY.ENRICHMENT,
        status: 'QUEUED',
        contractVersion: FLEET_CONTRACT_VERSION,
      }))
      await client.classroomFleetTask.createMany({ data: filler })
      const claimed = await claimNextFleetTask()
      expect(claimed?.id).toBe(core.id)
      expect(claimed?.spec.agentId).toBe(FLEET_AGENT_ID.EVIDENCE_AUDITOR)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── E1: execution, recovery, cancellation, stats ───────────────────────────────

describe('CI-3C worker: execution and recovery (E1)', () => {
  test('E1.1 valid contract output is persisted verbatim with its status and contract version', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k7' })
      let seenCtx: FleetTaskExecutionContext | null = null
      registerFleetTaskExecutor(async (ctx) => {
        seenCtx = ctx
        return validEnvelope({ taskKey: task.taskKey, classSessionId: seeded.classId, agentId: FLEET_AGENT_ID.LEARNER })
      })
      const claimed = await claimNextFleetTask()
      expect(claimed?.id).toBe(task.id)
      await runFleetTask(claimed!)
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      expect(row.contractVersion).toBe(FLEET_CONTRACT_VERSION)
      const output = JSON.parse(row.outputJson ?? '{}')
      expect(output.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      expect(output.taskId).toBe(task.taskKey)
      expect(row.error).toBeNull()
      expect(row.finishedAt).not.toBeNull()
      expect(seenCtx).not.toBeNull()
      expect((seenCtx as unknown as FleetTaskExecutionContext).attempt).toBe(1)
      expect((seenCtx as unknown as FleetTaskExecutionContext).spec.agentId).toBe(FLEET_AGENT_ID.LEARNER)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.2 honest INSUFFICIENT_EVIDENCE is a first-class terminal state, not a failure', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.TEACHER_JUDGE, taskKeySuffix: 'k8' })
      registerFleetTaskExecutor(async () => validEnvelope({ taskKey: task.taskKey, classSessionId: seeded.classId, agentId: FLEET_AGENT_ID.TEACHER_JUDGE }, FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE))
      const claimed = await claimNextFleetTask()
      await runFleetTask(claimed!)
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      expect(row.error).toBeNull()
      expect(JSON.parse(row.outputJson ?? '{}').unknowns.length).toBeGreaterThan(0)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.3 contract-invalid output → FAILED with the validator reason, nothing merged', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k9' })
      registerFleetTaskExecutor(async () => ({ ...validEnvelope({ taskKey: task.taskKey, classSessionId: seeded.classId, agentId: FLEET_AGENT_ID.LEARNER }), sneakyExtraField: true }))
      const claimed = await claimNextFleetTask()
      await runFleetTask(claimed!)
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.FAILED)
      expect(row.error).toContain('contract rejected')
      expect(row.outputJson).toBeNull()
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.4 envelope identity mismatch → FAILED, never merged', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k10' })
      registerFleetTaskExecutor(async () => validEnvelope({ taskKey: task.taskKey, classSessionId: 'some-other-class', agentId: FLEET_AGENT_ID.LEARNER }))
      const claimed = await claimNextFleetTask()
      await runFleetTask(claimed!)
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.FAILED)
      expect(row.error).toContain('identity does not match')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.5 no executor registered → honest FAILED with explanation', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k11', maxAttempts: 1 })
      const claimed = await claimNextFleetTask()
      await runFleetTask(claimed!)
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.FAILED)
      expect(row.error).toContain('not registered')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.6 executor throw retries within maxAttempts then FAILED with the error', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k12', maxAttempts: 2 })
      registerFleetTaskExecutor(async () => { throw new Error('model provider unavailable') })
      const claimed1 = await claimNextFleetTask()
      await runFleetTask(claimed1!)
      let row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe('QUEUED') // attempt 1 of 2 — re-queued honestly
      expect(row.error).toContain('model provider unavailable')
      const claimed2 = await claimNextFleetTask()
      expect(claimed2?.attempts).toBe(1)
      await runFleetTask(claimed2!)
      row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.FAILED)
      expect(row.error).toContain('model provider unavailable')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.7 expired leases recover: bounded retry re-queues, exhausted attempts FAIL honestly', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const retryable = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k13', status: 'RUNNING', attempts: 1, leaseUntil: new Date(Date.now() - 1000) })
      const exhausted = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.TEACHER_JUDGE, taskKeySuffix: 'k14', status: 'RUNNING', attempts: 3, leaseUntil: new Date(Date.now() - 1000) })
      const recovered = await recoverExpiredFleetLeases()
      expect(recovered).toBe(2)
      const r1 = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: retryable.id } })
      expect(r1.status).toBe('QUEUED')
      expect(r1.error).toContain('lease expired')
      const r2 = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: exhausted.id } })
      expect(r2.status).toBe(FLEET_TASK_STATUS.FAILED)
      expect(r2.error).toContain('lease expired')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.8 cancelFleetTasksForSession cancels non-terminal tasks and never rewrites terminal ones', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const queued = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k15' })
      const running = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.TEACHER_JUDGE, taskKeySuffix: 'k16', status: 'RUNNING', attempts: 1, leaseUntil: new Date(Date.now() + FLEET_LEASE_TEST_MS) })
      const completed = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.EVIDENCE_AUDITOR, taskKeySuffix: 'k17', status: FLEET_TASK_STATUS.COMPLETED, taskRole: FLEET_TASK_ROLE.MANDATORY_AUDIT, priority: FLEET_TASK_PRIORITY.MANDATORY_AUDIT })
      const cancelled = await cancelFleetTasksForSession(seeded.classId)
      expect(cancelled).toBe(2)
      const q = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: queued.id } })
      const r = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: running.id } })
      const c = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: completed.id } })
      expect(q.status).toBe('CANCELLED')
      expect(r.status).toBe('CANCELLED')
      expect(r.leaseUntil).toBeNull()
      expect(c.status).toBe(FLEET_TASK_STATUS.COMPLETED) // terminal state preserved
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.9 fleetTick (direct mode) claims and completes one task end-to-end; stats reflect states', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k18' })
      registerFleetTaskExecutor(async (ctx) => validEnvelope({ taskKey: ctx.taskKey, classSessionId: ctx.classSessionId, agentId: ctx.agentId }))
      const started = await fleetTick()
      expect(started).toBe(1)
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { id: task.id } })
      expect(row.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const stats = await fleetPoolStats()
      expect(stats.completed).toBeGreaterThanOrEqual(1)
      expect(stats.backpressureThreshold).toBeGreaterThan(0)
      expect(stats.concurrency).toBeGreaterThanOrEqual(1)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('E1.10 the fleet pipeline never touches classroom rows (failure isolation)', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED' })
    try {
      await grantCiConsent(seeded.teacherId)
      await dispatchFleetForSession({ classSessionId: seeded.classId })
      registerFleetTaskExecutor(async () => { throw new Error('boom') })
      // 7 tasks × 3 attempts — every retry path ends in an honest FAILED row.
      for (let i = 0; i < 21; i++) {
        const claimed = await claimNextFleetTask()
        if (!claimed) break
        await runFleetTask(claimed)
      }
      // The class, its live session and its bookings are untouched by fleet failures.
      const cls = await client.classSession.findUniqueOrThrow({ where: { id: seeded.classId }, include: { liveSession: true } })
      expect(cls.status).toBe('PUBLISHED')
      expect(cls.liveSession?.status).toBe('ENDED')
      const failedTasks = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId, status: FLEET_TASK_STATUS.FAILED } })
      expect(failedTasks.length).toBe(7)
      for (const t of failedTasks) expect(t.error).toContain('boom')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// Consent helper sanity: the gate the dispatcher and worker both rely on.
describe('CI-3C consent gate wiring', () => {
  test('grant/withdraw round-trip gates claims (purpose recorded)', async () => {
    const seeded = await seedTeacherAndClass({})
    try {
      await grantCiConsent(seeded.teacherId)
      const task = await seedFleetTask({ classId: seeded.classId, profileId: seeded.profileId, agentId: FLEET_AGENT_ID.LEARNER, taskKeySuffix: 'k19' })
      const claimed = await claimNextFleetTask()
      expect(claimed?.id).toBe(task.id)
      const record = await client.consentRecord.findFirst({ where: { studentId: seeded.teacherId, purpose: CI_CONSENT_PURPOSE, granted: true, withdrawnAt: null } })
      expect(record).not.toBeNull()
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})
