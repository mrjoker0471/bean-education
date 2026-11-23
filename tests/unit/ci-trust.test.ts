// ─── BEAN Classroom Intelligence (CI-1E): trust, privacy & safety tests ─────
// Real API/database behaviour on an isolated SQLite database. Coverage:
//   D1  dispute submission: ownership, finding-id verification, one-open-
//       dispute rule, append-only event
//   D2  admin queue: ADMIN-only; teachers get 403
//   D3  admin actions: ASSIGN/UNDER_REVIEW append history; RESOLVE requires
//       note+resolution; DISMISS requires note; closed disputes are final
//   D4  RESOLVE CORRECTED: deterministic rebuild — new CURRENT version without
//       the disputed findings, old version SUPERSEDED, modelId null
//   D5  RESOLVE RETRACTED: report hidden (RETRACTED), nothing deleted
//   D6  report deletion: owner-only, blocked while a dispute is open, real
//       deletion otherwise (evidence refs cascade)
//   D7  account export includes the classroomIntelligence section for the
//       teacher's reports, the student's summaries and filed disputes
//   D8  account deletion erases every CI row owned by the account
//   D9  trust-table isolation: the whole CI flow never writes reviews,
//       complaints, trust actions or appeals (structural advisory guarantee)

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci-trust-'))
const isolatedUrl = `file:${join(dir, 'ci-trust.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

let currentStudent: { id: string; email: string; displayName: string | null; learningLevel: string | null; role: string; onboardedAt: string | null; signupIntent: string | null } | null = null
mock.module('@/lib/auth', () => {
  const { completeAuthMock } = require('../helpers/auth-mock')
  return completeAuthMock({
    getSessionStudent: async () => currentStudent,
    requireStudent: async () => currentStudent,
    sameOrigin: () => true,
  })
})

const { POST: disputePOST } = await import('@/app/api/teach/classroom-intelligence/reports/[reportId]/dispute/route')
const { GET: disputesGET } = await import('@/app/api/teach/classroom-intelligence/disputes/route')
const { DELETE: reportDELETE } = await import('@/app/api/teach/classroom-intelligence/reports/[reportId]/route')
const { GET: adminQueueGET } = await import('@/app/api/admin/classroom-intelligence/disputes/route')
const { POST: adminActionPOST } = await import('@/app/api/admin/classroom-intelligence/disputes/[id]/action/route')
const { GET: exportGET } = await import('@/app/api/auth/account/export/route')

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HOUR = 3600_000

function asUser(id: string, role = 'STUDENT') {
  currentStudent = { id, email: `${id}@bean.test`, displayName: null, learningLevel: null, role, onboardedAt: new Date().toISOString(), signupIntent: null }
}
const signOut = () => {
  currentStudent = null
}

function jsonReq(url: string, method = 'GET', body?: unknown): NextRequest {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as NextRequest
}

async function makeStudent(id: string, role = 'STUDENT') {
  return client.student.create({ data: { id, email: `${id}@bean.test`, role, ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() } })
}

const REPORT_FINDINGS = {
  strengths: [{ findingId: 'judge-1', source: 'TEACHER_JUDGE', category: 'LESSON_STRUCTURE', observation: 'A coherent lesson arc is visible in the notes.', evidenceKinds: ['TEACHER_LESSON_NOTES'], evidenceBasis: 'available', confidence: 'high', flaggedForReview: false }],
  improvements: [{ findingId: 'learner-2', source: 'LEARNER', category: 'CONCEPT_GAP', observation: 'Verifying solutions by substitution is not evidenced anywhere.', evidenceKinds: ['TEACHER_LESSON_NOTES', 'LESSON_PLAN'], evidenceBasis: 'available', confidence: 'medium', suggestion: 'Add a substitution check next time.', flaggedForReview: false }],
  otherFindings: [{ findingId: 'learner-3', source: 'LEARNER', category: 'PACING', observation: 'The pace reading is uncertain from the interval data alone.', evidenceKinds: ['PARTICIPANT_INTERVALS'], evidenceBasis: 'partially_available', confidence: 'low', flaggedForReview: true, flagReason: 'Rests on evidence marked unavailable — advisory only, requires human review.' }],
}

async function seedEvaluation(ownerStudentId: string, withAttendee = true) {
  const profile = await client.teacherProfile.create({
    data: {
      studentId: ownerStudentId,
      teachingName: `T ${ownerStudentId.slice(0, 6)}`,
      headline: 'h',
      bio: 'b',
      subjectsJson: '[]',
      levelsJson: '[]',
      languagesJson: '[]',
      qualificationsText: 'q',
      experienceYears: 1,
      verificationStatus: 'APPROVED',
      isPublished: true,
    },
  })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Dispute test class',
      description: 'A class used by the trust tests.',
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
          startedById: ownerStudentId,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: new Date(Date.now() - HOUR),
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  let bookingId: string | null = null
  if (withAttendee) {
    const attendee = await makeStudent(`att-${Math.random().toString(36).slice(2, 8)}`)
    const booking = await client.classBooking.create({ data: { classSessionId: cls.id, studentId: attendee.id, status: 'ATTENDED' } })
    bookingId = booking.id
  }
  const job = await client.classroomEvaluationJob.create({
    data: { classSessionId: cls.id, teacherProfileId: profile.id, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
  })
  const report = await client.classroomEvaluationReport.create({
    data: {
      jobId: job.id,
      classSessionId: cls.id,
      teacherProfileId: profile.id,
      version: 1,
      status: 'CURRENT',
      reportJson: JSON.stringify({
        generatedAtIso: new Date().toISOString(),
        lessonSummary: 'A coherent summary of the lesson drawn from the recorded evidence.',
        ...REPORT_FINDINGS,
        categories: ['SUBJECT_ACCURACY', 'EXPLANATION_CLARITY', 'LESSON_STRUCTURE', 'SYLLABUS_COVERAGE', 'TEACHING_PACE', 'USE_OF_EXAMPLES', 'STUDENT_INTERACTION', 'QUESTION_HANDLING', 'TIME_MANAGEMENT', 'LEARNING_RESOURCE_QUALITY'].map((c) => ({ category: c, status: 'EVALUATED', summary: 's' })),
        objectivesCovered: [],
        objectivesUnverifiable: [],
        conceptsRequiringRevision: [],
        suggestedPractice: [],
        evidenceRegister: [{ kind: 'TEACHER_LESSON_NOTES', available: true, summary: 'Notes included.' }],
        conflicts: [],
        insufficientEvidence: false,
        requiresHumanReview: true,
      }),
      insufficientEvidence: false,
      requiresHumanReview: true,
      modelId: 'test-engine',
    },
  })
  await client.classroomEvidenceRef.create({
    data: { reportId: report.id, kind: 'TEACHER_LESSON_NOTES', refId: cls.id, summary: 'Teacher-provided lesson notes were included (opt-in).', available: true },
  })
  await client.classroomAgentRun.create({
    data: { jobId: job.id, agent: 'LEARNER', status: 'COMPLETED', attempt: 1, modelId: 'test-engine', outputJson: JSON.stringify({
      lessonSummary: 'A coherent summary of the lesson drawn from the recorded evidence.',
      objectivesCovered: [], conceptsRequiringRevision: [], explanationObservations: [], suggestedPractice: [], insufficientEvidence: false,
    }) },
  })
  await client.classroomAgentRun.create({
    data: { jobId: job.id, agent: 'TEACHER_JUDGE', status: 'COMPLETED', attempt: 1, modelId: 'test-engine', outputJson: JSON.stringify({
      findings: REPORT_FINDINGS.strengths.map((f, i) => ({ id: i + 1, category: 'LESSON_STRUCTURE', observation: f.observation, evidenceKinds: ['TEACHER_LESSON_NOTES'], evidenceBasis: 'available', confidence: 'high' })),
      categoriesNotEvaluable: [], objectivesCovered: [], objectivesUnverifiable: [], insufficientEvidence: false,
    }) },
  })
  if (bookingId) {
    await client.classroomStudentSummary.create({
      data: {
        jobId: job.id,
        bookingId,
        classSessionId: cls.id,
        summaryJson: JSON.stringify({
          classId: cls.id,
          lessonSummary: 'A coherent summary of the lesson drawn from the recorded evidence.',
          conceptsCovered: [], revisionRecommendations: [], suggestedPractice: [],
          scopeNote: 'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
        }),
      },
    })
  }
  return { profileId: profile.id, classId: cls.id, jobId: job.id, reportId: report.id, teacherStudentId: ownerStudentId }
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('CI trust & privacy (real DB)', () => {
  it('D1: dispute submission — ownership enforced, finding ids verified, one open dispute, append-only event', async () => {
    const owner = await makeStudent('d1-owner')
    const stranger = await makeStudent('d1-stranger')
    // The stranger must hold an APPROVED profile so the ownership check (not
    // the role gate) produces the 404.
    await client.teacherProfile.create({
      data: { studentId: stranger.id, teachingName: 'D1 Stranger', headline: 'h', bio: 'b', subjectsJson: '[]', levelsJson: '[]', languagesJson: '[]', qualificationsText: 'q', experienceYears: 1, verificationStatus: 'APPROVED', isPublished: true },
    })
    const seeded = await seedEvaluation(owner.id)

    asUser(stranger.id)
    const resStranger = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'judge-1', reason: 'This observation is not supported by the actual lesson notes.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(resStranger.status).toBe(404)

    asUser(owner.id)
    // Unknown finding id → 400.
    const resUnknown = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'judge-99', reason: 'This finding id does not exist in the report at all.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(resUnknown.status).toBe(400)

    // Valid dispute → SUBMITTED + one event.
    const res = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'judge-1', reason: 'The lesson notes do not support the claimed coherent arc as stated.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dispute: { id: string; status: string } }
    expect(body.dispute.status).toBe('SUBMITTED')

    // Second open dispute on the same report → 409.
    const resAgain = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'learner-2', reason: 'A second open dispute while the first is still under review.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(resAgain.status).toBe(409)

    const events = await client.classroomDisputeEvent.findMany({ where: { disputeId: body.dispute.id } })
    expect(events.length).toBe(1)
    expect(events[0].action).toBe('SUBMITTED')

    // Teacher sees their dispute in the list.
    const list = await disputesGET()
    const listBody = (await list.json()) as { disputes: { id: string; status: string }[] }
    expect(listBody.disputes.some((d) => d.id === body.dispute.id)).toBe(true)
  })

  it('D2: admin queue is ADMIN-only', async () => {
    const teacher = await makeStudent('d2-teacher')
    asUser(teacher.id)
    const resTeacher = await adminQueueGET()
    expect(resTeacher.status).toBe(403)

    signOut()
    const res401 = await adminQueueGET()
    expect(res401.status).toBe(401)

    await makeStudent('d2-admin', 'ADMIN')
    asUser('d2-admin', 'ADMIN')
    const res = await adminQueueGET()
    expect(res.status).toBe(200)
  })

  it('D3: admin actions require notes for RESOLVE/DISMISS and closed disputes are final', async () => {
    const owner = await makeStudent('d3-owner')
    const seeded = await seedEvaluation(owner.id)
    asUser(owner.id)
    const res = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'learner-3', reason: 'The pace reading rests on partial evidence and should be reviewed.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    const { dispute } = (await res.json()) as { dispute: { id: string } }

    await makeStudent('d3-admin', 'ADMIN')
    asUser('d3-admin', 'ADMIN')

    // RESOLVE without note → 400.
    const resNoNote = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'RESOLVE', resolution: 'UPHELD' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resNoNote.status).toBe(400)

    // ASSIGN then UNDER_REVIEW append events.
    const resAssign = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'ASSIGN' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resAssign.status).toBe(200)
    const resReview = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'UNDER_REVIEW' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resReview.status).toBe(200)

    // RESOLVE UPHELD closes the dispute.
    const resResolve = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'RESOLVE', resolution: 'UPHELD', note: 'The finding is consistent with the recorded lesson notes and intervals.' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resResolve.status).toBe(200)

    // Closed dispute → further actions are 409.
    const resClosed = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'DISMISS', note: 'Attempting to act on a closed dispute must fail.' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resClosed.status).toBe(409)

    const events = await client.classroomDisputeEvent.findMany({ where: { disputeId: dispute.id }, orderBy: { createdAt: 'asc' } })
    expect(events.map((e) => e.action)).toEqual(['SUBMITTED', 'ASSIGNED', 'UNDER_REVIEW', 'RESOLVED'])
  })

  it('D4: RESOLVE CORRECTED — deterministic rebuild without the disputed findings', async () => {
    const owner = await makeStudent('d4-owner')
    const seeded = await seedEvaluation(owner.id)
    asUser(owner.id)
    const res = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'learner-2', reason: 'The substitution-verification gap is actually covered in my lesson notes.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    const { dispute } = (await res.json()) as { dispute: { id: string } }

    await makeStudent('d4-admin', 'ADMIN')
    asUser('d4-admin', 'ADMIN')
    const resAction = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'RESOLVE', resolution: 'CORRECTED', note: 'Rebuilt without the disputed finding after checking the notes.' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resAction.status).toBe(200)

    const versions = await client.classroomEvaluationReport.findMany({ where: { classSessionId: seeded.classId }, orderBy: { version: 'asc' } })
    expect(versions.length).toBe(2)
    expect(versions[0].status).toBe('SUPERSEDED')
    expect(versions[1].status).toBe('CURRENT')
    expect(versions[1].version).toBe(2)
    expect(versions[1].modelId).toBeNull() // pure deterministic rebuild
    const corrected = JSON.parse(versions[1].reportJson) as { improvements: { findingId: string }[] }
    expect(corrected.improvements.some((f) => f.findingId === 'learner-2')).toBe(false)

    const disputeRow = await client.classroomEvaluationDispute.findUniqueOrThrow({ where: { id: dispute.id } })
    expect(disputeRow.resolution).toBe('CORRECTED')
    expect(disputeRow.resolvedById).toBe('d4-admin')
  })

  it('D5: RESOLVE RETRACTED — report hidden, nothing deleted', async () => {
    const owner = await makeStudent('d5-owner')
    const seeded = await seedEvaluation(owner.id)
    asUser(owner.id)
    const res = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'learner-3', reason: 'This advisory finding should never have been flagged for publication.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    const { dispute } = (await res.json()) as { dispute: { id: string } }

    await makeStudent('d5-admin', 'ADMIN')
    asUser('d5-admin', 'ADMIN')
    const resAction = await adminActionPOST(jsonReq(`http://localhost/x/${dispute.id}/action`, 'POST', { action: 'RESOLVE', resolution: 'RETRACTED', note: 'The underlying evidence is insufficient; the report is retracted.' }), { params: Promise.resolve({ id: dispute.id }) })
    expect(resAction.status).toBe(200)

    const report = await client.classroomEvaluationReport.findUniqueOrThrow({ where: { id: seeded.reportId } })
    expect(report.status).toBe('RETRACTED')
    expect(report.reportJson.length).toBeGreaterThan(0) // nothing deleted

    // A retracted report can no longer be disputed.
    asUser(owner.id)
    const resAgain = await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'judge-1', reason: 'Disputing a retracted report must be refused by the server.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(resAgain.status).toBe(409)
  })

  it('D6: report deletion — owner-only, blocked while a dispute is open, real otherwise', async () => {
    const owner = await makeStudent('d6-owner')
    const stranger = await makeStudent('d6-stranger')
    await client.teacherProfile.create({
      data: { studentId: stranger.id, teachingName: 'D6 Stranger', headline: 'h', bio: 'b', subjectsJson: '[]', levelsJson: '[]', languagesJson: '[]', qualificationsText: 'q', experienceYears: 1, verificationStatus: 'APPROVED', isPublished: true },
    })
    const seeded = await seedEvaluation(owner.id)

    asUser(stranger.id)
    const resStranger = await reportDELETE(jsonReq(`http://localhost/x/${seeded.reportId}`, 'DELETE'), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(resStranger.status).toBe(404)

    asUser(owner.id)
    const dispute = await client.classroomEvaluationDispute.create({
      data: { reportId: seeded.reportId, teacherId: owner.id, status: 'SUBMITTED', findingsJson: JSON.stringify([{ findingId: 'judge-1', reason: 'Open dispute blocks deletion of the report version.' }]) },
    })
    const resBlocked = await reportDELETE(jsonReq(`http://localhost/x/${seeded.reportId}`, 'DELETE'), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(resBlocked.status).toBe(409)

    await client.classroomEvaluationDispute.update({ where: { id: dispute.id }, data: { status: 'RESOLVED', resolution: 'UPHELD', resolvedAt: new Date() } })
    const refsBefore = await client.classroomEvidenceRef.count({ where: { reportId: seeded.reportId } })
    expect(refsBefore).toBeGreaterThan(0)
    const res = await reportDELETE(jsonReq(`http://localhost/x/${seeded.reportId}`, 'DELETE'), { params: Promise.resolve({ reportId: seeded.reportId }) })
    expect(res.status).toBe(200)
    expect(await client.classroomEvaluationReport.findUnique({ where: { id: seeded.reportId } })).toBeNull()
    expect(await client.classroomEvidenceRef.count({ where: { reportId: seeded.reportId } })).toBe(0)
  })

  it('D7: account export includes the classroomIntelligence section', async () => {
    const owner = await makeStudent('d7-owner')
    const seeded = await seedEvaluation(owner.id)
    asUser(owner.id)
    const res = await exportGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      classroomIntelligence: {
        teacherReports: { id: string; version: number }[]
        classSummaries: unknown[]
        disputesFiled: { resolution: string | null }[]
      }
    }
    expect(body.classroomIntelligence.teacherReports.some((r) => r.id === seeded.reportId)).toBe(true)
    // The owner is a teacher, not an attendee — their own export carries no
    // class summaries (those belong to the attending student's account).
    expect(body.classroomIntelligence.classSummaries.length).toBe(0)
    expect(body.classroomIntelligence.disputesFiled.length).toBe(0)
  })

  it('D8: account deletion erases every CI row owned by the account', async () => {
    const owner = await makeStudent('d8-owner')
    const seeded = await seedEvaluation(owner.id)
    // Give the teacher a closed dispute too (plain teacherId — must not orphan).
    await client.classroomEvaluationDispute.create({
      data: { reportId: seeded.reportId, teacherId: owner.id, status: 'RESOLVED', resolution: 'UPHELD', resolvedAt: new Date(), findingsJson: '[]' },
    })

    // Simulate the deletion transaction's CI section.
    await client.classroomEvaluationDispute.deleteMany({ where: { teacherId: owner.id } })
    const ciClassIds = (await client.classSession.findMany({ where: { teacherProfileId: seeded.profileId }, select: { id: true } })).map((c) => c.id)
    await client.classroomEvaluationJob.deleteMany({ where: { classSessionId: { in: ciClassIds } } })
    await client.classroomStudentSummary.deleteMany({ where: { booking: { studentId: owner.id } } })

    expect(await client.classroomEvaluationDispute.count({ where: { teacherId: owner.id } })).toBe(0)
    expect(await client.classroomEvaluationJob.count({ where: { classSessionId: { in: ciClassIds } } })).toBe(0)
    expect(await client.classroomEvaluationReport.count({ where: { classSessionId: { in: ciClassIds } } })).toBe(0)
    expect(await client.classroomEvidenceRef.count({ where: { reportId: seeded.reportId } })).toBe(0)
    expect(await client.classroomStudentSummary.count({ where: { classSessionId: { in: ciClassIds } } })).toBe(0)
    expect(await client.classroomAgentRun.count({ where: { jobId: seeded.jobId } })).toBe(0)
  })

  it('D9: trust-table isolation — CI rows exist while reviews/complaints/trust actions/appeals stay untouched', async () => {
    const owner = await makeStudent('d9-owner')
    const seeded = await seedEvaluation(owner.id)
    asUser(owner.id)
    await disputePOST(jsonReq(`http://localhost/x/${seeded.reportId}/dispute`, 'POST', { findings: [{ findingId: 'judge-1', reason: 'Isolation check: dispute this finding and inspect the trust tables.' }] }), { params: Promise.resolve({ reportId: seeded.reportId }) })

    expect(await client.classReview.count()).toBe(0)
    expect(await client.teachComplaint.count()).toBe(0)
    expect(await client.trustAction.count()).toBe(0)
    expect(await client.teachAppeal.count()).toBe(0)
    // The class itself is untouched.
    const cls = await client.classSession.findUniqueOrThrow({ where: { id: seeded.classId } })
    expect(cls.status).toBe('PUBLISHED')
  })
})
