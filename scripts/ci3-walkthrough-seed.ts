// CI-3H browser-walkthrough seed (charter §19 CI-3H: "UI browser verification").
// Synthetic QA-labelled fixtures on the WORKTREE dev database only:
//   ci3-teacher@bean.test  — APPROVED teacher, CI consent granted
//     • Class A "Quadratic equations — intuition first": ENDED, whiteboard +
//       teacher notes + bookings → evaluated by the REAL pipeline (real
//       provider) → REAL fleet dispatch + drain with the real runtime
//     • Class B "Trigonometry basics": ENDED, never evaluated (eligible list)
// No report or fleet content is hand-written. Password: bean-ci3-demo
//
// Usage: bun scripts/ci3-walkthrough-seed.ts [--clean]

import { mock } from 'bun:test'
import { PrismaClient } from '@prisma/client'

const client = new PrismaClient()
mock.module('@/lib/db', () => ({ db: client }))

const { hashPassword } = await import('@/lib/auth')
const ciQueue = await import('@/lib/ci/queue')
const ciTrigger = await import('@/lib/ci/trigger')
// importing the dispatcher brings the runtime + packs (same as the app)
const ciFleet = await import('@/lib/ci/fleet/dispatcher')
const ciWorker = await import('@/lib/ci/fleet/worker')

const EMAILS = ['ci3-teacher@bean.test', 'ci3-student@bean.test', 'ci3-mate@bean.test']
const DEMO_PASS = 'bean-ci3-demo'
const CLEAN = process.argv.includes('--clean')

const WHITEBOARD_SNAPSHOT = JSON.stringify({
  strokes: [
    { id: 's1', tool: 'pen', colour: '#d4af37', size: 3, points: [[0.1, 0.15], [0.3, 0.25], [0.5, 0.2]] },
    { id: 's2', tool: 'pen', colour: '#1a1a1a', size: 2, points: [[0.2, 0.4], [0.45, 0.45], [0.6, 0.42], [0.75, 0.5]] },
    { id: 's3', tool: 'eraser', colour: '#ffffff', size: 12, points: [[0.5, 0.2], [0.52, 0.21]] },
    { id: 's4', tool: 'pen', colour: '#1a1a1a', size: 2, points: [[0.15, 0.6], [0.35, 0.62], [0.55, 0.6], [0.7, 0.65], [0.85, 0.62]] },
  ],
})

async function clean(): Promise<void> {
  const students = await client.student.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })
  const ids = students.map((s) => s.id)
  if (ids.length === 0) return
  await client.classroomFleetTask.deleteMany({ where: { classSession: { teacherProfile: { studentId: { in: ids } } } } })
  await client.classroomObserverSession.deleteMany({ where: { liveSession: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await client.classroomStudentSummary.deleteMany({ where: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await client.classroomEvidenceRef.deleteMany({ where: { report: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } } })
  await client.classroomEvaluationReport.deleteMany({ where: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await client.classroomAgentRun.deleteMany({ where: { job: { teacherProfile: { studentId: { in: ids } } } } })
  await client.classroomEvaluationJob.deleteMany({ where: { teacherProfile: { studentId: { in: ids } } } })
  await client.liveClassParticipant.deleteMany({ where: { liveSession: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await client.liveWhiteboardState.deleteMany({ where: { liveSession: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await client.liveClassSession.deleteMany({ where: { classSession: { teacherProfile: { studentId: { in: ids } } } } })
  await client.classBooking.deleteMany({ where: { OR: [{ classSession: { teacherProfile: { studentId: { in: ids } } } }, { studentId: { in: ids } }] } })
  await client.classSession.deleteMany({ where: { teacherProfile: { studentId: { in: ids } } } })
  await client.consentRecord.deleteMany({ where: { studentId: { in: ids } } })
  await client.session.deleteMany({ where: { studentId: { in: ids } } })
  await client.student.deleteMany({ where: { id: { in: ids } } })
}

async function runEvaluation(classSessionId: string, notes?: string): Promise<void> {
  const outcome = await ciQueue.enqueueEvaluation({ classSessionId, trigger: 'SESSION_END', teacherNotes: notes ?? null })
  if (!outcome.queued) {
    console.log(`  evaluation for ${classSessionId} not queued:`, outcome)
    return
  }
  const claimed = await ciQueue.claimNextCiJob()
  if (!claimed) throw new Error('claim failed — no queued job found')
  await ciQueue.runCiJob(claimed)
}

async function main(): Promise<void> {
  await clean()
  if (CLEAN) {
    console.log('CI3 walkthrough fixtures removed.')
    await client.$disconnect()
    return
  }

  const passwordHash = await hashPassword(DEMO_PASS)
  const HOUR = 3600_000

  const teacher = await client.student.create({
    data: {
      email: 'ci3-teacher@bean.test',
      passwordHash,
      displayName: 'Walkthrough Teacher',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      signupIntent: 'TEACHER',
      teacherProfile: {
        create: {
          teachingName: 'Walkthrough Teacher',
          headline: 'Mathematics teacher — CI-3 walkthrough fixture',
          bio: 'Synthetic demo teacher created for the CI-3 authenticated browser walkthrough. Not a real person.',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'B.Sc Mathematics; synthetic walkthrough fixture.',
          experienceYears: 5,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  await ciTrigger.grantCiConsent(teacher.id)

  // Accept the current legal documents for the walkthrough account (fixture
  // setup — the same thing the legal gate's UI does, recorded server-side).
  const { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import('@/lib/legal-config')
  await client.legalAcceptance.createMany({
    data: [
      { studentId: teacher.id, document: 'TERMS', version: CURRENT_TERMS_VERSION },
      { studentId: teacher.id, document: 'PRIVACY', version: CURRENT_PRIVACY_VERSION },
    ],
  })

  const student = await client.student.create({
    data: { email: 'ci3-student@bean.test', passwordHash, displayName: 'Walkthrough Student', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() },
  })
  const mate = await client.student.create({
    data: { email: 'ci3-mate@bean.test', passwordHash, displayName: 'Walkthrough Mate', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })

  // ── Class A: ended + evaluated + REAL fleet run ──
  const classA = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Quadratic equations — intuition first',
      description: 'Build the intuition behind quadratics, then solve by factorisation and the formula.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 26 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
      bookings: {
        create: [
          { studentId: student.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - 24 * HOUR) },
          { studentId: mate.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - 24 * HOUR) },
        ],
      },
      liveSession: {
        create: {
          roomName: `bean-live-ci3a-${Math.random().toString(36).slice(2, 8)}`,
          status: 'ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 26 * HOUR),
          endedAt: new Date(Date.now() - 25 * HOUR),
          endReason: 'teacher_ended',
          actualParticipantMinutes: 110,
          usageFinalisedAt: new Date(Date.now() - 25 * HOUR),
          usageMonthKey: new Date().toISOString().slice(0, 7),
          whiteboard: { create: { snapshotJson: WHITEBOARD_SNAPSHOT, version: 4, updatedById: teacher.id } },
          participants: {
            create: [
              { studentId: teacher.id, participantIdentity: `bean:${teacher.id}`, participantRole: 'TEACHER', totalConnectedSeconds: 3500, reconnectCount: 0, firstJoinedAt: new Date(Date.now() - 26 * HOUR), lastLeftAt: new Date(Date.now() - 25 * HOUR) },
              { studentId: student.id, participantIdentity: `bean:${student.id}`, participantRole: 'STUDENT', totalConnectedSeconds: 3300, reconnectCount: 1, firstJoinedAt: new Date(Date.now() - 26 * HOUR), lastLeftAt: new Date(Date.now() - 25 * HOUR) },
              { studentId: mate.id, participantIdentity: `bean:${mate.id}`, participantRole: 'STUDENT', totalConnectedSeconds: 3100, reconnectCount: 0, firstJoinedAt: new Date(Date.now() - 26 * HOUR), lastLeftAt: new Date(Date.now() - 25 * HOUR) },
            ],
          },
        },
      },
    },
  })

  console.log('Evaluating class A with the REAL pipeline (provider calls — takes a minute)…')
  await runEvaluation(classA.id, 'Focus of the lesson was intuition before the formula; students asked for one more worked example near the end.')

  console.log('Dispatching the REAL fleet for class A (specialist + audit + coaches)…')
  const dispatch = await ciFleet.dispatchFleetForSession({ classSessionId: classA.id })
  if (!dispatch.dispatched) throw new Error(`fleet dispatch failed: ${JSON.stringify(dispatch)}`)
  console.log(`  queued ${dispatch.queued.length} tasks; driving the real pool…`)
  for (let i = 0; i < 200; i++) {
    const task = await ciWorker.claimNextFleetTask()
    if (!task) break
    await ciWorker.runFleetTask(task)
  }
  const aStats = await ciWorker.fleetPoolStats()
  console.log(`  fleet pool: completed=${aStats.completed} partial=${aStats.partial} insufficient=${aStats.insufficientEvidence} failed=${aStats.failed} skipped=${aStats.skipped}`)

  // ── Class B: ended, never evaluated (eligible list + observer-free) ──
  await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Trigonometry basics',
      description: 'Sine, cosine and tangent from right-angled triangles.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 45,
      startsAt: new Date(Date.now() - 3 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
      bookings: { create: [{ studentId: student.id, status: 'CONFIRMED' }] },
      liveSession: {
        create: {
          roomName: `bean-live-ci3b-${Math.random().toString(36).slice(2, 8)}`,
          status: 'ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 3 * HOUR),
          endedAt: new Date(Date.now() - 2 * HOUR),
          endReason: 'teacher_ended',
          usageFinalisedAt: new Date(Date.now() - 2 * HOUR),
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })

  console.log('CI3 walkthrough fixtures ready.')
  console.log('  teacher: ci3-teacher@bean.test / bean-ci3-demo')
  await client.$disconnect()
}

void main()
