// ─── CI-2A: authenticated browser walkthrough fixture seeding ────────────────
// Seeds ISOLATED demo accounts and realistic synthetic classroom data on the
// development database, then runs the REAL multi-agent evaluation pipeline
// (real provider) for two classes so the walkthrough exercises the actual
// product — never hand-written report JSON.
//
// Fixture accounts (demo sandbox only; the runtime DB is never committed):
//   ci2-teacher@bean.test   approved teacher with CI consent
//   ci2-student@bean.test   walkthrough student (attended classes)
//   ci2-outsider@bean.test  unrelated student (cross-access denial tests)
//   ci2-admin@bean.test     ADMIN for the trust-review walkthrough
//   ci2-mate1/2@bean.test   extra attendees for realistic aggregates
// All demo passwords: "bean-ci2-demo" (clearly-labelled QA data; delete with
//   bun scripts/ci2-walkthrough-seed.ts --clean).
//
// Usage:
//   bun scripts/ci2-walkthrough-seed.ts            # seed + evaluate (live provider)
//   bun scripts/ci2-walkthrough-seed.ts --clean    # remove every ci2 fixture row

const CLEAN = process.argv.includes('--clean')

// Inline scrypt password hashing — same format as src/lib/auth.ts
// (importing auth.ts here would pull next/headers into a plain script).
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>

const DEMO_PASSWORD = 'bean-ci2-demo'

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password.normalize('NFKC'), salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`
}

import { PrismaClient } from '@prisma/client'
// Import for side effects: registers the real pipeline into the queue.
const ciQueue = await import('@/lib/ci/queue')
await import('@/lib/ci/pipeline')

const db = new PrismaClient()
const HOUR = 3600_000

const EMAILS = [
  'ci2-teacher@bean.test',
  'ci2-student@bean.test',
  'ci2-outsider@bean.test',
  'ci2-admin@bean.test',
  'ci2-mate1@bean.test',
  'ci2-mate2@bean.test',
]

async function clean(): Promise<void> {
  // Delete fixture rows in explicit dependency order (cascades exist, but
  // being explicit keeps this safe against schema drift).
  const students = await db.student.findMany({ where: { email: { in: EMAILS } }, select: { id: true } })
  const ids = students.map((s) => s.id)
  if (ids.length === 0) return
  await db.classroomDisputeEvent.deleteMany({ where: { dispute: { report: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } } } })
  await db.classroomEvaluationDispute.deleteMany({ where: { report: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } } })
  await db.classroomStudentSummary.deleteMany({ where: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await db.classroomEvidenceRef.deleteMany({ where: { report: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } } })
  await db.classroomEvaluationReport.deleteMany({ where: { job: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await db.classroomAgentRun.deleteMany({ where: { job: { teacherProfile: { studentId: { in: ids } } } } })
  await db.classroomEvaluationJob.deleteMany({ where: { teacherProfile: { studentId: { in: ids } } } })
  await db.liveClassParticipant.deleteMany({ where: { liveSession: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await db.liveWhiteboardState.deleteMany({ where: { liveSession: { classSession: { teacherProfile: { studentId: { in: ids } } } } } })
  await db.liveClassSession.deleteMany({ where: { classSession: { teacherProfile: { studentId: { in: ids } } } } })
  await db.classBooking.deleteMany({ where: { OR: [{ classSession: { teacherProfile: { studentId: { in: ids } } } }, { studentId: { in: ids } }] } })
  await db.classSession.deleteMany({ where: { teacherProfile: { studentId: { in: ids } } } })
  await db.consentRecord.deleteMany({ where: { studentId: { in: ids } } })
  await db.session.deleteMany({ where: { studentId: { in: ids } } })
  await db.student.deleteMany({ where: { id: { in: ids } } })
}

async function runEvaluation(classSessionId: string, notes?: string): Promise<void> {
  const outcome = await ciQueue.enqueueEvaluation({
    classSessionId,
    trigger: 'SESSION_END',
    teacherNotes: notes ?? null,
  })
  if (!outcome.queued) {
    console.log(`  evaluation for ${classSessionId} not queued:`, outcome)
    return
  }
  const claimed = await ciQueue.claimNextCiJob()
  if (!claimed) throw new Error('claim failed — no queued job found')
  await ciQueue.runCiJob(claimed)
}

const WHITEBOARD_SNAPSHOT = JSON.stringify({
  strokes: [
    { id: 's1', tool: 'pen', colour: '#d4af37', size: 3, points: [[0.1, 0.15], [0.3, 0.25], [0.5, 0.2]] },
    { id: 's2', tool: 'pen', colour: '#1a1a1a', size: 2, points: [[0.2, 0.4], [0.45, 0.45], [0.6, 0.42], [0.75, 0.5]] },
    { id: 's3', tool: 'eraser', colour: '#ffffff', size: 12, points: [[0.5, 0.2], [0.52, 0.21]] },
    { id: 's4', tool: 'pen', colour: '#1a1a1a', size: 2, points: [[0.15, 0.6], [0.35, 0.62], [0.55, 0.6], [0.7, 0.65], [0.85, 0.62]] },
  ],
})

async function main(): Promise<void> {
  await clean()
  if (CLEAN) {
    console.log('CI2 walkthrough fixtures removed.')
    await db.$disconnect()
    return
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD)

  // ── Accounts ──
  const teacher = await db.student.create({
    data: {
      email: 'ci2-teacher@bean.test',
      passwordHash,
      displayName: 'Walkthrough Teacher',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      signupIntent: 'TEACHER',
      teacherProfile: {
        create: {
          teachingName: 'Walkthrough Teacher',
          headline: 'Mathematics teacher — CI-2 walkthrough fixture',
          bio: 'Synthetic demo teacher created for the CI-2 authenticated browser walkthrough. Not a real person.',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_6_8", "SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'M.Sc. Mathematics (fixture)',
          experienceYears: 6,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  await db.consentRecord.create({
    data: { studentId: teacher.id, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true },
  })

  const student = await db.student.create({
    data: { email: 'ci2-student@bean.test', passwordHash, displayName: 'Walkthrough Student', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  const outsider = await db.student.create({
    data: { email: 'ci2-outsider@bean.test', passwordHash, displayName: 'Outsider Student', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  const admin = await db.student.create({
    data: { email: 'ci2-admin@bean.test', passwordHash, displayName: 'Walkthrough Admin', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), role: 'ADMIN' },
  })
  const mate1 = await db.student.create({
    data: { email: 'ci2-mate1@bean.test', passwordHash, displayName: 'Classmate One', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  const mate2 = await db.student.create({
    data: { email: 'ci2-mate2@bean.test', passwordHash, displayName: 'Classmate Two', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), signupIntent: 'STUDENT' },
  })
  const profile = await db.teacherProfile.findUniqueOrThrow({ where: { studentId: teacher.id } })

  // ── Class A: fully evaluated (whiteboard + notes) ──
  const classA = await db.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Quadratic equations — intuition first',
      description:
        'Build the geometric intuition behind quadratics, then solve by factorisation and the quadratic formula, ending with two fully worked examples and a common sign-error discussion.',
      subject: 'Mathematics',
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
          roomName: 'bean-live-ci2-a',
          status: 'ENDED',
          endReason: 'TEACHER_ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: new Date(Date.now() - HOUR),
          actualParticipantMinutes: 128,
          usageMonthKey: new Date().toISOString().slice(0, 7),
          whiteboard: { create: { snapshotJson: WHITEBOARD_SNAPSHOT, version: 1, updatedById: teacher.id } },
        },
      },
    },
  })
  await db.classBooking.createMany({
    data: [
      { classSessionId: classA.id, studentId: student.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - HOUR) },
      { classSessionId: classA.id, studentId: mate1.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - HOUR) },
      { classSessionId: classA.id, studentId: mate2.id, status: 'NO_SHOW', attendanceMarkedAt: new Date(Date.now() - HOUR) },
    ],
  })
  const liveA = await db.liveClassSession.findUniqueOrThrow({ where: { classSessionId: classA.id } })
  await db.liveClassParticipant.createMany({
    data: [
      { liveClassSessionId: liveA.id, studentId: teacher.id, participantIdentity: 'bean:ci2-teacher-a', participantRole: 'TEACHER', totalConnectedSeconds: 3480, reconnectCount: 0 },
      { liveClassSessionId: liveA.id, studentId: student.id, participantIdentity: 'bean:ci2-student-a', participantRole: 'STUDENT', totalConnectedSeconds: 3120, reconnectCount: 1 },
      { liveClassSessionId: liveA.id, studentId: mate1.id, participantIdentity: 'bean:ci2-mate1-a', participantRole: 'STUDENT', totalConnectedSeconds: 2760, reconnectCount: 0 },
    ],
  })

  // ── Class A2: evaluated without notes and without a whiteboard ──
  const classA2 = await db.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Introduction to fractions — visual first',
      description:
        'Fractions as parts of a whole: equivalent fractions, comparing sizes with visual models, and adding fractions with the same denominator, closing with three guided practice items.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_6_8',
      language: 'English',
      durationMinutes: 90,
      startsAt: new Date(Date.now() - 26 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 12,
      minimumStudents: 1,
      liveSession: {
        create: {
          roomName: 'bean-live-ci2-a2',
          status: 'ENDED',
          endReason: 'TEACHER_ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 26 * HOUR),
          endedAt: new Date(Date.now() - 24.5 * HOUR),
          actualParticipantMinutes: 105,
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  await db.classBooking.createMany({
    data: [
      { classSessionId: classA2.id, studentId: student.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - 24 * HOUR) },
      { classSessionId: classA2.id, studentId: mate1.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - 24 * HOUR) },
    ],
  })
  const liveA2 = await db.liveClassSession.findUniqueOrThrow({ where: { classSessionId: classA2.id } })
  await db.liveClassParticipant.createMany({
    data: [
      { liveClassSessionId: liveA2.id, studentId: teacher.id, participantIdentity: 'bean:ci2-teacher-a2', participantRole: 'TEACHER', totalConnectedSeconds: 5200, reconnectCount: 1 },
      { liveClassSessionId: liveA2.id, studentId: student.id, participantIdentity: 'bean:ci2-student-a2', participantRole: 'STUDENT', totalConnectedSeconds: 4700, reconnectCount: 2 },
      { liveClassSessionId: liveA2.id, studentId: mate1.id, participantIdentity: 'bean:ci2-mate1-a2', participantRole: 'STUDENT', totalConnectedSeconds: 1400, reconnectCount: 3 },
    ],
  })

  // ── Class B: ended, never evaluated (teacher can request) ──
  const classB = await db.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Trigonometry basics — sin, cos, tan',
      description:
        'Right-triangle trigonometry from scratch: naming the sides, reading SOH-CAH-TOA, and computing one unknown side and one unknown angle with a calculator.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 3 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 8,
      minimumStudents: 1,
      liveSession: {
        create: {
          roomName: 'bean-live-ci2-b',
          status: 'ENDED',
          endReason: 'TEACHER_ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 3 * HOUR),
          endedAt: new Date(Date.now() - 2 * HOUR),
          actualParticipantMinutes: 58,
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  await db.classBooking.create({ data: { classSessionId: classB.id, studentId: student.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - 2 * HOUR) } })
  const liveB = await db.liveClassSession.findUniqueOrThrow({ where: { classSessionId: classB.id } })
  await db.liveClassParticipant.createMany({
    data: [
      { liveClassSessionId: liveB.id, studentId: teacher.id, participantIdentity: 'bean:ci2-teacher-b', participantRole: 'TEACHER', totalConnectedSeconds: 3450, reconnectCount: 0 },
      { liveClassSessionId: liveB.id, studentId: student.id, participantIdentity: 'bean:ci2-student-b', participantRole: 'STUDENT', totalConnectedSeconds: 2980, reconnectCount: 0 },
    ],
  })

  // ── Class D: attended by the student, not yet evaluated ──
  const classD = await db.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Reading the exam paper carefully',
      description: 'Exam technique: how to read command words, allocate time across sections, and avoid the most common avoidable mistakes.',
      subject: 'Study skills',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 45,
      startsAt: new Date(Date.now() - 50 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 20,
      minimumStudents: 1,
      liveSession: {
        create: {
          roomName: 'bean-live-ci2-d',
          status: 'ENDED',
          endReason: 'TEACHER_ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 50 * HOUR),
          endedAt: new Date(Date.now() - 49 * HOUR),
          actualParticipantMinutes: 42,
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  await db.classBooking.create({ data: { classSessionId: classD.id, studentId: student.id, status: 'ATTENDED', attendanceMarkedAt: new Date(Date.now() - 49 * HOUR) } })
  const liveD = await db.liveClassSession.findUniqueOrThrow({ where: { classSessionId: classD.id } })
  await db.liveClassParticipant.createMany({
    data: [
      { liveClassSessionId: liveD.id, studentId: teacher.id, participantIdentity: 'bean:ci2-teacher-d', participantRole: 'TEACHER', totalConnectedSeconds: 2600, reconnectCount: 0 },
      { liveClassSessionId: liveD.id, studentId: student.id, participantIdentity: 'bean:ci2-student-d', participantRole: 'STUDENT', totalConnectedSeconds: 2450, reconnectCount: 0 },
    ],
  })

  // ── Class E: the walkthrough student was a no-show ──
  const classE = await db.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Geometry past-paper drill',
      description: 'Timed drill through a geometry past paper section; students attempt questions and compare solutions.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 72 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
      liveSession: {
        create: {
          roomName: 'bean-live-ci2-e',
          status: 'ENDED',
          endReason: 'TEACHER_ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 72 * HOUR),
          endedAt: new Date(Date.now() - 71 * HOUR),
          actualParticipantMinutes: 55,
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  await db.classBooking.create({ data: { classSessionId: classE.id, studentId: student.id, status: 'NO_SHOW', attendanceMarkedAt: new Date(Date.now() - 71 * HOUR) } })

  // ── REAL evaluations (classes A and A2) via the real pipeline ──
  console.log('Running REAL evaluation for class A (with teacher notes, whiteboard present)…')
  await runEvaluation(classA.id, 'Opened with the geometric intuition of the discriminant, worked two factorisation examples, derived the quadratic formula by completing the square; two students asked about repeated roots near the end.')
  console.log('Running REAL evaluation for class A2 (no notes, no whiteboard snapshot)…')
  await runEvaluation(classA2.id)

  const jobA = await db.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: classA.id } })
  const jobA2 = await db.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: classA2.id } })
  if (jobA.status !== 'COMPLETED' || jobA2.status !== 'COMPLETED') {
    console.log('HONEST OUTCOME: evaluations did not complete.', {
      A: { status: jobA.status, error: jobA.error },
      A2: { status: jobA2.status, error: jobA2.error },
    })
    await db.$disconnect()
    process.exit(2)
  }

  const reportA = await db.classroomEvaluationReport.findFirstOrThrow({
    where: { classSessionId: classA.id, status: 'CURRENT' },
  })

  // ── Dispute fixture: the teacher challenges one real finding of report A ──
  const parsed = JSON.parse(reportA.reportJson) as {
    strengths: { findingId: string }[]
    improvements: { findingId: string }[]
    otherFindings: { findingId: string }[]
  }
  const target =
    parsed.improvements[0] ?? parsed.otherFindings[0] ?? parsed.strengths[0]
  if (!target) throw new Error('report A has no findings to dispute')
  const dispute = await db.classroomEvaluationDispute.create({
    data: {
      reportId: reportA.id,
      teacherId: teacher.id,
      status: 'SUBMITTED',
      findingsJson: JSON.stringify([
        {
          findingId: target.findingId,
          reason:
            'The observation understates what the lesson covered: the lesson notes show the sign-error discussion and two worked examples, which the evidence register lists as available. Requesting human review of this finding.',
        },
      ]),
    },
  })
  await db.classroomDisputeEvent.create({
    data: {
      disputeId: dispute.id,
      actorId: teacher.id,
      actorRole: 'STUDENT',
      action: 'SUBMITTED',
      detail: `Disputed 1 finding(s): ${target.findingId}.`,
    },
  })

  const summaryCount = await db.classroomStudentSummary.count({ where: { jobId: { in: [jobA.id, jobA2.id] } } })
  console.log('=== CI-2 walkthrough fixtures seeded ===')
  console.log(`teacher        : ci2-teacher@bean.test (approved, consent granted)`)
  console.log(`student        : ci2-student@bean.test (attended A, A2, B, D; no-show E)`)
  console.log(`outsider       : ci2-outsider@bean.test (no bookings)`)
  console.log(`admin          : ci2-admin@bean.test (ADMIN)`)
  console.log(`password       : ${DEMO_PASSWORD} (demo only)`)
  console.log(`class A        : ${classA.id} — evaluated v${reportA.version} (job ${jobA.status})`)
  console.log(`class A2       : ${classA2.id} — evaluated (job ${jobA2.status})`)
  console.log(`class B        : ${classB.id} — eligible (no evaluation job)`)
  console.log(`class D        : ${classD.id} — attended, not evaluated`)
  console.log(`class E        : ${classE.id} — student no-show`)
  console.log(`dispute fixture: ${dispute.id} on report A v${reportA.version} (finding ${target.findingId})`)
  console.log(`student summaries created for attended bookings: ${summaryCount}`)
  await db.$disconnect()
}

void main().catch(async (err) => {
  console.error('CI2 walkthrough seeding failed:', err)
  await db.$disconnect()
  process.exit(1)
})
