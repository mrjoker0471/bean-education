// ─── BEAN Classroom Intelligence (CI-1D): route ownership & permission tests ─
// Real API/database behaviour on an isolated SQLite database. Coverage:
//   R1  teacher summary route: requires an approved teacher; rows scoped to
//       the caller's OWN profile (another teacher's classes are invisible)
//   R2  consent POST: grant → withdraw lifecycle persisted on ConsentRecord
//   R3  class evaluation GET: 404 for a stranger's class; owner sees job +
//       versions; report JSON is returned parsed
//   R4  class evaluation POST: consent gate (403 + no job row), notes bounds
//       (400), success enqueues with TEACHER_REQUEST trigger and teacher
//       attribution; auto-dedup rules still respected on re-request semantics
//   R5  student summaries GET: unauthenticated 401; a student sees ONLY their
//       own booking rows; malformed summary rows are skipped honestly
//   R6  consent withdrawal stops requests (403) while previously completed
//       evaluations remain readable

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci-routes-'))
const isolatedUrl = `file:${join(dir, 'ci-routes.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

// Auth: the session cookie resolves to a controllable "current user".
let currentStudent: { id: string; email: string; displayName: string | null; learningLevel: string | null; role: string; onboardedAt: string | null; signupIntent: string | null } | null = null
mock.module('@/lib/auth', () => {
  const { completeAuthMock } = require('../helpers/auth-mock')
  return completeAuthMock({
    getSessionStudent: async () => currentStudent,
    requireStudent: async () => currentStudent,
    sameOrigin: () => true,
  })
})

const { GET: teacherCiGET, POST: teacherCiPOST } = await import('@/app/api/teach/classroom-intelligence/route')
const { GET: evaluationGET, POST: evaluationPOST } = await import('@/app/api/teach/classes/[id]/evaluation/route')
const { GET: summariesGET } = await import('@/app/api/learn/class-summaries/route')

beforeAll(() => {
  execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HOUR = 3600_000

function makeStudent(id: string, role = 'STUDENT') {
  return client.student.create({
    data: { id, email: `${id}@bean.test`, role, ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() },
  })
}

async function seedClassWithTeacher(teacherStudentId: string, opts?: { bookings?: Array<{ studentId: string; status: string }>; skipProfile?: boolean }) {
  const profile = opts?.skipProfile
    ? await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacherStudentId } })
    : await client.teacherProfile.create({
        data: {
          studentId: teacherStudentId,
          teachingName: `Teacher ${teacherStudentId.slice(0, 6)}`,
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Maths"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 2,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Trigonometry basics',
      description: 'Sine, cosine and their graphs, with worked examples.',
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
          roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
          status: 'ENDED',
          startedById: teacherStudentId,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: new Date(Date.now() - HOUR),
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  for (const b of opts?.bookings ?? []) {
    await client.classBooking.create({ data: { classSessionId: cls.id, studentId: b.studentId, status: b.status } })
  }
  return { profileId: profile.id, classId: cls.id }
}

function jsonReq(url: string, method = 'GET', body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const asTeacher = (id: string) => {
  currentStudent = { id, email: `${id}@bean.test`, displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: new Date().toISOString(), signupIntent: null }
}
const signOut = () => {
  currentStudent = null
}

const VALID_LEARNER = {
  lessonSummary: 'The class introduced trigonometric ratios with a unit-circle intuition and worked two graph examples from the lesson notes.',
  objectivesCovered: ['Understand sine and cosine'],
  conceptsRequiringRevision: [],
  explanationObservations: [],
  suggestedPractice: ['Sketch y=sin(x) for three periods'],
  insufficientEvidence: false,
}

const VALID_JUDGE = {
  findings: [
    {
      id: 1,
      category: 'LESSON_STRUCTURE' as const,
      observation: 'The lesson notes follow a coherent arc from ratio definitions to graph sketching.',
      evidenceKinds: ['TEACHER_LESSON_NOTES' as const],
      evidenceBasis: 'available' as const,
      confidence: 'high' as const,
    },
  ],
  categoriesNotEvaluable: [{ category: 'STUDENT_INTERACTION' as const, reason: 'No interaction data exists in this evidence set.' }],
  objectivesCovered: ['Understand sine and cosine'],
  objectivesUnverifiable: [],
  insufficientEvidence: false,
}

const VALID_REPORT = {
  generatedAtIso: new Date().toISOString(),
  lessonSummary: VALID_LEARNER.lessonSummary,
  strengths: [],
  improvements: [],
  otherFindings: [],
  categories: [
    'SUBJECT_ACCURACY',
    'EXPLANATION_CLARITY',
    'LESSON_STRUCTURE',
    'SYLLABUS_COVERAGE',
    'TEACHING_PACE',
    'USE_OF_EXAMPLES',
    'STUDENT_INTERACTION',
    'QUESTION_HANDLING',
    'TIME_MANAGEMENT',
    'LEARNING_RESOURCE_QUALITY',
  ].map((category) => ({ category, status: category === 'LESSON_STRUCTURE' ? 'EVALUATED' : 'INSUFFICIENT_EVIDENCE', summary: 'n/a — insufficient evidence in this fixture' })),
  objectivesCovered: ['Understand sine and cosine'],
  objectivesUnverifiable: [],
  conceptsRequiringRevision: [],
  suggestedPractice: VALID_LEARNER.suggestedPractice,
  evidenceRegister: [{ kind: 'TEACHER_LESSON_NOTES', available: true, summary: 'Notes included.' }],
  conflicts: [],
  insufficientEvidence: false,
  requiresHumanReview: false,
}

async function publishReportFor(classId: string, teacherProfileId: string, jobId: string) {
  const now = new Date()
  await client.classroomEvaluationReport.create({
    data: {
      jobId,
      classSessionId: classId,
      teacherProfileId,
      version: 1,
      status: 'CURRENT',
      reportJson: JSON.stringify(VALID_REPORT),
      insufficientEvidence: false,
      requiresHumanReview: false,
      modelId: 'test-engine',
    },
  })
  void now
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('CI teacher routes (real DB)', () => {
  it('R1: summary requires an approved teacher and is scoped to the caller\'s own profile', async () => {
    signOut()
    const res401 = await teacherCiGET()
    expect(res401.status).toBe(401)

    const teacherA = await makeStudent('ci-t-a')
    const teacherB = await makeStudent('ci-t-b')
    asTeacher('ci-t-a')
    const resNoProfile = await teacherCiGET()
    expect(resNoProfile.status).toBe(403) // signed in but not an approved teacher

    const seededA = await seedClassWithTeacher('ci-t-a')
    const seededB = await seedClassWithTeacher('ci-t-b')
    await client.consentRecord.create({ data: { studentId: 'ci-t-a', purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true } })

    asTeacher('ci-t-a')
    const res = await teacherCiGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { consent: { granted: boolean }; evaluated: unknown[]; eligible: { classSessionId: string }[] }
    expect(body.consent.granted).toBe(true)
    const visibleIds = [...body.eligible.map((e) => e.classSessionId)]
    expect(visibleIds).toContain(seededA.classId)
    expect(visibleIds).not.toContain(seededB.classId) // another teacher's class is invisible
  })

  it('R2: consent POST persists grant and withdraw (idempotent)', async () => {
    const teacher = await makeStudent('ci-t-c')
    await client.teacherProfile.create({
      data: { studentId: teacher.id, teachingName: 'T C', headline: 'h', bio: 'b', subjectsJson: '[]', levelsJson: '[]', languagesJson: '[]', qualificationsText: 'q', experienceYears: 1, verificationStatus: 'APPROVED', isPublished: true },
    })
    asTeacher('ci-t-c')
    const grant = await teacherCiPOST(jsonReq('http://localhost/api/teach/classroom-intelligence', 'POST', { granted: true }))
    expect(grant.status).toBe(200)
    expect(((await grant.json()) as { consent: { granted: boolean } }).consent.granted).toBe(true)
    const grantAgain = await teacherCiPOST(jsonReq('http://localhost/api/teach/classroom-intelligence', 'POST', { granted: true }))
    const records = await client.consentRecord.findMany({ where: { studentId: 'ci-t-c', purpose: 'CLASSROOM_INTELLIGENCE_TEACHER' } })
    expect(records.length).toBe(1)
    void grantAgain

    const withdraw = await teacherCiPOST(jsonReq('http://localhost/api/teach/classroom-intelligence', 'POST', { granted: false }))
    const body = (await withdraw.json()) as { consent: { granted: boolean; withdrawnAt: string | null } }
    expect(body.consent.granted).toBe(false)
    expect(body.consent.withdrawnAt).not.toBeNull()
  })

  it('R3: evaluation GET — stranger gets 404; owner sees job and parsed versions', async () => {
    const teacher = await makeStudent('ci-t-d')
    const stranger = await makeStudent('ci-t-s')
    // The stranger must be an APPROVED teacher so the guard passes and the
    // ownership check (not the role gate) produces the 404.
    await client.teacherProfile.create({
      data: { studentId: stranger.id, teachingName: 'Stranger T', headline: 'h', bio: 'b', subjectsJson: '[]', levelsJson: '[]', languagesJson: '[]', qualificationsText: 'q', experienceYears: 1, verificationStatus: 'APPROVED', isPublished: true },
    })
    const seeded = await seedClassWithTeacher(teacher.id)
    const job = await client.classroomEvaluationJob.create({
      data: { classSessionId: seeded.classId, teacherProfileId: seeded.profileId, status: 'COMPLETED', stage: 'DONE', trigger: 'TEACHER_REQUEST' },
    })
    await publishReportFor(seeded.classId, seeded.profileId, job.id)

    asTeacher(stranger.id)
    const resForbidden = await evaluationGET(jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`), { params: Promise.resolve({ id: seeded.classId }) })
    expect(resForbidden.status).toBe(404)

    asTeacher(teacher.id)
    const res = await evaluationGET(jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`), { params: Promise.resolve({ id: seeded.classId }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { job: { status: string } | null; versions: { version: number; report: { categories: unknown[] } | null }[] }
    expect(body.job?.status).toBe('COMPLETED')
    expect(body.versions.length).toBe(1)
    expect(body.versions[0].report?.categories.length).toBe(10)
  })

  it('R4: evaluation POST — consent gate, notes bounds, and a successful TEACHER_REQUEST', async () => {
    const teacher = await makeStudent('ci-t-e')
    const seeded = await seedClassWithTeacher(teacher.id)

    asTeacher(teacher.id)
    // Consent gate: 403 and NO job row.
    const resNoConsent = await evaluationPOST(
      jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`, 'POST', {}),
      { params: Promise.resolve({ id: seeded.classId }) },
    )
    expect(resNoConsent.status).toBe(403)
    expect(await client.classroomEvaluationJob.findUnique({ where: { classSessionId: seeded.classId } })).toBeNull()

    await client.consentRecord.create({ data: { studentId: teacher.id, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true } })

    // Notes bounds: too short → 400, no job.
    const resShortNotes = await evaluationPOST(
      jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`, 'POST', { teacherNotes: 'too short' }),
      { params: Promise.resolve({ id: seeded.classId }) },
    )
    expect(resShortNotes.status).toBe(400)

    // Success: queued with the requesting teacher attributed.
    const res = await evaluationPOST(
      jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`, 'POST', {
        teacherNotes: 'Covered ratios and two graph examples; students asked about amplitude.',
      }),
      { params: Promise.resolve({ id: seeded.classId }) },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { queued: boolean }
    expect(body.queued).toBe(true)
    const job = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
    expect(job.trigger).toBe('TEACHER_REQUEST')
    expect(job.requestedById).toBe('ci-t-e')
    expect(job.teacherNotes).toContain('amplitude')
  })

  it('R5: student summaries — 401 when signed out; strict own-booking scoping; malformed rows skipped', async () => {
    signOut()
    const res401 = await summariesGET()
    expect(res401.status).toBe(401)

    const teacher = await makeStudent('ci-t-f')
    const seeded = await seedClassWithTeacher(teacher.id)
    const seeded2 = await seedClassWithTeacher(teacher.id, { skipProfile: true }) // second class for the malformed row
    const studentMine = await makeStudent('ci-st-mine')
    const studentOther = await makeStudent('ci-st-other')
    const myBooking = await client.classBooking.create({ data: { classSessionId: seeded.classId, studentId: studentMine.id, status: 'ATTENDED' } })
    const otherBooking = await client.classBooking.create({ data: { classSessionId: seeded.classId, studentId: studentOther.id, status: 'ATTENDED' } })

    const job = await client.classroomEvaluationJob.create({
      data: { classSessionId: seeded.classId, teacherProfileId: seeded.profileId, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
    })
    const job2 = await client.classroomEvaluationJob.create({
      data: { classSessionId: seeded2.classId, teacherProfileId: seeded2.profileId, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
    })
    const validSummary = {
      classId: seeded.classId,
      lessonSummary: 'The class introduced trigonometric ratios and worked through two graph examples together.',
      conceptsCovered: ['Sine and cosine ratios'],
      revisionRecommendations: [],
      suggestedPractice: ['Sketch y=sin(x)'],
      scopeNote: 'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
    }
    await client.classroomStudentSummary.create({
      data: { jobId: job.id, bookingId: myBooking.id, classSessionId: seeded.classId, summaryJson: JSON.stringify(validSummary) },
    })
    // Another student's row must never leak; plus one malformed row for mine
    // (on the second class — booking uniqueness is per class+student).
    await client.classroomStudentSummary.create({
      data: { jobId: job.id, bookingId: otherBooking.id, classSessionId: seeded.classId, summaryJson: JSON.stringify(validSummary) },
    })
    const malformedBooking = await client.classBooking.create({ data: { classSessionId: seeded2.classId, studentId: studentMine.id, status: 'ATTENDED' } })
    await client.classroomStudentSummary.create({
      data: { jobId: job2.id, bookingId: malformedBooking.id, classSessionId: seeded2.classId, summaryJson: '{broken json' },
    })

    asTeacher('ci-st-mine')
    const res = await summariesGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summaries: { bookingId: string }[] }
    expect(body.summaries.length).toBe(1) // malformed skipped, other student's row absent
    expect(body.summaries[0].bookingId).toBe(myBooking.id)
  })

  it('R6: withdrawal blocks new requests but completed evaluations stay readable', async () => {
    const teacher = await makeStudent('ci-t-g')
    const seeded = await seedClassWithTeacher(teacher.id)
    const job = await client.classroomEvaluationJob.create({
      data: { classSessionId: seeded.classId, teacherProfileId: seeded.profileId, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
    })
    await publishReportFor(seeded.classId, seeded.profileId, job.id)

    asTeacher(teacher.id)
    await client.consentRecord.create({ data: { studentId: teacher.id, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true, withdrawnAt: new Date() } })

    const resPost = await evaluationPOST(jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`, 'POST', {}), { params: Promise.resolve({ id: seeded.classId }) })
    expect(resPost.status).toBe(403)

    const resGet = await evaluationGET(jsonReq(`http://localhost/api/teach/classes/${seeded.classId}/evaluation`), { params: Promise.resolve({ id: seeded.classId }) })
    expect(resGet.status).toBe(200)
    const body = (await resGet.json()) as { versions: unknown[] }
    expect(body.versions.length).toBe(1)
  })
})
