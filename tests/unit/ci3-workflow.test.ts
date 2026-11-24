// ─── CI-3G tests: teacher/student workflow integration (isolated real DB) ─────
//   W1  teacher development coach — converts terminal specialist outputs into
//       bounded, advisory recommendations with REAL BEAN learning links;
//       honest INSUFFICIENT_EVIDENCE when nothing is terminal; deterministic
//       fallback without an adapter; model path bounded; advisory-only
//       limitations everywhere
//   W2  student revision coach — deterministic assembly from the published
//       class-level summary; honest abstention without one; class-level
//       privacy boundaries (no student ids, no mastery inference from
//       attendance); real syllabus/practice links or honest absence
//   W3  ranking/decision language stripped deterministically with risk flags
//   W4  the fleet summary surfaces on the teacher's CI overview (additive,
//       ownership-scoped)

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3g-'))
const isolatedUrl = `file:${join(dir, 'ci3g.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { dispatchFleetForSession } = await import('@/lib/ci/fleet/dispatcher')
const { claimNextFleetTask, runFleetTask } = await import('@/lib/ci/fleet/worker')
const { grantCiConsent } = await import('@/lib/ci/trigger')
const { FLEET_AGENT_ID, FLEET_TASK_STATUS } = await import('@/lib/ci/fleet/constants')
const { registerFleetRuntime } = await import('@/lib/ci/fleet/runtime')
const { setCiModelAdapterForProcess, resetCiModelAdapterForTests } = await import('@/lib/ci/model-adapter')
const { studentSummarySchema } = await import('@/lib/ci/schemas')

beforeAll(() => {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
  registerFleetRuntime()
})

afterAll(async () => {
  resetCiModelAdapterForTests()
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

let scripted: string[] = []
function installAdapter(): void {
  setCiModelAdapterForProcess({
    id: 'fake-ci3g-adapter',
    async complete() {
      const next = scripted.shift()
      if (next === undefined) throw new Error('fake adapter has no scripted response — test bug')
      return next
    },
  })
}

const HOUR = 3600_000

async function seedEndedClass(opts?: { subject?: string; title?: string }) {
  const teacher = await client.student.create({
    data: {
      id: `t-${Math.random().toString(36).slice(2, 10)}`,
      email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Workflow Teacher',
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 3,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
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
      liveSession: {
        create: {
          roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
          status: 'ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: new Date(Date.now() - 1 * HOUR),
          usageMonthKey: new Date().toISOString().slice(0, 7),
          usageFinalisedAt: new Date(Date.now() - 1 * HOUR),
        },
      },
    },
  })
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } })
}

async function drainQueue(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const task = await claimNextFleetTask()
    if (!task) return
    await runFleetTask(task)
  }
}

/** Seed one terminal specialist output so the coaches have inputs. */
async function seedSpecialistOutput(classId: string, profileId: string) {
  const { FLEET_CONTRACT_VERSION, fleetTaskId } = await import('@/lib/ci/fleet/contracts')
  const { FLEET_TASK_PRIORITY, subjectExpertInstanceId, FLEET_TASK_ROLE } = await import('@/lib/ci/fleet/constants')
  const specialistId = subjectExpertInstanceId('mathematics-statistics')
  const output = {
    contractVersion: FLEET_CONTRACT_VERSION,
    taskId: fleetTaskId(classId, specialistId, 'mathematics-statistics'),
    classSessionId: classId,
    agentId: specialistId,
    agentVersion: '1.0.0',
    domainPackId: 'mathematics-statistics',
    domainPackVersion: '1.0.0',
    language: { requested: 'English', detected: 'English', confidence: 'low' },
    status: 'COMPLETED',
    findings: [
      {
        findingId: 'spec-1',
        category: 'concept accuracy',
        observation: 'Quadratic factorisation steps matched the worked procedure anchored in the pack glossary.',
        evidenceRefIds: [],
        evidenceKinds: ['LESSON_PLAN'],
        evidenceBasis: 'available',
        sourceRefs: ['openstax-mathematics'],
        confidence: 'high',
        limitations: [],
        suggestion: 'Add one explicit discriminant-sign check before factorising.',
      },
    ],
    unknowns: [],
    conflicts: [],
    riskFlags: [],
    requiresHumanReview: false,
  }
  await client.classroomFleetTask.create({
    data: {
      taskKey: fleetTaskId(classId, specialistId, 'mathematics-statistics'),
      classSessionId: classId,
      teacherProfileId: profileId,
      agentId: specialistId,
      taskRole: FLEET_TASK_ROLE.DOMAIN_SPECIALIST,
      priority: FLEET_TASK_PRIORITY.DOMAIN_SPECIALIST,
      status: 'COMPLETED',
      attempts: 1,
      maxAttempts: 3,
      contractVersion: FLEET_CONTRACT_VERSION,
      outputJson: JSON.stringify(output),
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })
}

async function seedPublishedSummary(classId: string, profileId: string, teacherStudentId: string) {
  const summary = {
    classId,
    lessonSummary: 'The class built quadratic intuition with two worked examples and a practice block.',
    conceptsCovered: ['factorising quadratics', 'roots of a quadratic equation'],
    revisionRecommendations: ['Re-do the two board examples without looking at the steps.'],
    suggestedPractice: ['Solve five factorisation problems with negative coefficients.'],
    scopeNote: 'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
  }
  studentSummarySchema.parse(summary)
  const job = await client.classroomEvaluationJob.create({
    data: {
      classSessionId: classId,
      teacherProfileId: profileId,
      status: 'COMPLETED',
      stage: 'DONE',
      trigger: 'SESSION_END',
    },
  })
  const booking = await client.classBooking.create({
    data: { classSessionId: classId, studentId: teacherStudentId, status: 'ATTENDED' },
  })
  await client.classroomStudentSummary.create({
    data: {
      jobId: job.id,
      bookingId: booking.id,
      classSessionId: classId,
      summaryJson: JSON.stringify(summary),
    },
  })
}

// ─── W1: teacher coach ────────────────────────────────────────────────────────

describe('CI-3G teacher development coach (W1)', () => {
  test('W1.1 deterministic fallback converts terminal specialist suggestions into advisory recommendations with real links', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      await seedSpecialistOutput(seeded.classId, seeded.profileId)
      setCiModelAdapterForProcess(null) // deterministic path
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      const coach = rows.find((r) => r.agentId === FLEET_AGENT_ID.TEACHER_COACH)
      expect(coach).toBeDefined()
      expect(coach!.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const out = JSON.parse(coach!.outputJson!) as {
        findings: { category: string; suggestion: string; limitations: string[] }[]
        unknowns: string[]
      }
      expect(out.findings.length).toBeGreaterThan(0)
      expect(out.findings[0].category.startsWith('teacher development')).toBe(true)
      // advisory-only limitations
      expect(out.findings[0].limitations.some((l) => l.includes('never alters official reviews'))).toBe(true)
      expect(out.findings[0].limitations.some((l) => l.includes('no trend claims'))).toBe(true)
      // deterministic-fallback honesty note
      expect(out.unknowns.some((u) => u.includes('aggregated deterministically'))).toBe(true)
      // real BEAN learning links (the catalogue matches mathematics topics)
      expect(out.findings[0].suggestion).toContain('#/exam/')
      expect(out.findings[0].suggestion).toContain('#/learning')
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('W1.2 the model path stays bounded and honest on failure', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      await seedSpecialistOutput(seeded.classId, seeded.profileId)
      installAdapter()
      scripted = ['not json at all', 'still not json'] // malformed twice → honest failure
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      const coach = rows.find((r) => r.agentId === FLEET_AGENT_ID.TEACHER_COACH)
      expect(coach!.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      const out = JSON.parse(coach!.outputJson!) as { unknowns: string[] }
      expect(out.unknowns.some((u) => u.includes('model coaching pass failed honestly'))).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
      scripted = []
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('W1.3 abstains honestly when nothing is terminal', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null)
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      const coach = rows.find((r) => r.agentId === FLEET_AGENT_ID.TEACHER_COACH)
      expect(coach!.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── W2: student revision coach ───────────────────────────────────────────────

describe('CI-3G student revision coach (W2)', () => {
  test('W2.1 assembles deterministic class-level revision activities with real links and privacy boundaries', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      await seedSpecialistOutput(seeded.classId, seeded.profileId)
      await seedPublishedSummary(seeded.classId, seeded.profileId, seeded.teacherId)
      setCiModelAdapterForProcess(null)
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      const coach = rows.find((r) => r.agentId === FLEET_AGENT_ID.STUDENT_REVISION_COACH)
      expect(coach!.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const out = JSON.parse(coach!.outputJson!) as {
        findings: { category: string; observation: string; suggestion: string; limitations: string[] }[]
      }
      expect(out.findings[0].category).toBe('class revision activities')
      // privacy boundaries enforced verbatim
      expect(out.findings[0].limitations.some((l) => l.includes('identical for every attendee'))).toBe(true)
      expect(out.findings[0].limitations.some((l) => l.includes('never to infer individual mastery'))).toBe(true)
      // no student identity anywhere in the persisted output
      const raw = coach!.outputJson as string
      expect(raw).not.toContain('"bean:')
      // real catalogue links (mathematics matches the exam catalogue)
      expect(out.findings[0].suggestion).toContain('#/exam/')
      expect(out.findings[0].suggestion).toContain('#/learning')
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('W2.2 abstains honestly when no summary is published yet', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null)
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      const coach = rows.find((r) => r.agentId === FLEET_AGENT_ID.STUDENT_REVISION_COACH)
      expect(coach!.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      const out = JSON.parse(coach!.outputJson!) as { unknowns: string[] }
      expect(out.unknowns[0]).toContain('no published class-level student summary')
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── W3: ranking-language guard ───────────────────────────────────────────────

describe('CI-3G ranking guard (W3)', () => {
  test('W3.1 ranking/decision language is stripped with a risk flag before persistence', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      await seedSpecialistOutput(seeded.classId, seeded.profileId)
      installAdapter()
      scripted = [
        // the auditor (claims before enrichment) gets its challenge JSON first
        JSON.stringify({ unsupported: [], disagreements: [] }),
        // then the coach recommendations — one honest, one with ranking language
        JSON.stringify({
          recommendations: [
            { area: 'pacing', recommendation: 'Try a two-minute recap before the practice block.' },
            { area: 'leaderboard', recommendation: 'Publish a leaderboard ranking students by speed next class.' },
          ],
        }),
      ]
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId } })
      const coach = rows.find((r) => r.agentId === FLEET_AGENT_ID.TEACHER_COACH)
      const out = JSON.parse(coach!.outputJson!) as {
        findings: { observation: string }[]
        riskFlags: string[]
      }
      expect(out.findings.some((f) => f.observation.includes('leaderboard'))).toBe(false)
      expect(out.findings.some((f) => f.observation.includes('two-minute recap'))).toBe(true)
      expect(out.riskFlags.some((f) => f.includes('ranking/decision language stripped'))).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
      scripted = []
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── W4: fleet summary on the teacher CI overview ─────────────────────────────

describe('CI-3G fleet summary surface (W4)', () => {
  test('W4.1 the teacher CI overview reports fleet task counts for ended classes (additive field)', async () => {
    const { GET: teacherCiGET } = await import('@/app/api/teach/classroom-intelligence/route')
    const { completeAuthMock } = await import('../helpers/auth-mock')
    const state = { student: null as unknown }
    mock.module('@/lib/auth', () =>
      completeAuthMock({
        requireStudent: async () => state.student as never,
        getSessionStudent: async () => state.student as never,
      }),
    )
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      const teacher = await client.student.findUniqueOrThrow({ where: { id: seeded.teacherId } })
      state.student = teacher
      const res = await teacherCiGET(new Request('http://localhost/api/teach/classroom-intelligence'))
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        evaluated: { classSessionId: string; fleet?: { total: number; completed: number; failed: number } }[]
        pending: { classSessionId: string }[]
        eligible: { classSessionId: string; fleet?: { total: number } }[]
      }
      // the fleet summary appears wherever the class appears (evaluated,
      // pending or eligible — the counts are additive in every list)
      const all = [...body.evaluated, ...body.pending, ...body.eligible]
      const mine = all.find((e) => e.classSessionId === seeded.classId)
      expect(mine).toBeDefined()
      expect(mine!.fleet).toBeDefined()
      expect(mine!.fleet!.total).toBeGreaterThanOrEqual(0)
    } finally {
      state.student = null
      await cleanupTeacher(seeded.teacherId)
    }
  })
})
