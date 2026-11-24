// ─── CI-2E: reconsideration (appeal), reviewer separation, admin inspection ─
// Real API/database behaviour on an isolated SQLite database. Coverage:
//   E1  reconsider route: ownership, closed-state and once-only rules, note
//       bounds, SUBMITTED transition + append-only RECONSIDER_REQUESTED event
//   E2  reviewer separation: the admin whose decision is reconsidered is
//       refused (403); a DIFFERENT admin can decide the reconsidered case
//   E3  self-review refusal: an administrator cannot decide a dispute on
//       their own report
//   E4  admin report inspection: ADMIN-only; returns report JSON, evidence
//       register and agent-run audit rows; teachers refused

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci2-disputes-'))
const isolatedUrl = `file:${join(dir, 'ci2-disputes.db')}`

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
const { POST: reconsiderPOST } = await import('@/app/api/teach/classroom-intelligence/disputes/[id]/reconsider/route')
const { POST: adminActionPOST } = await import('@/app/api/admin/classroom-intelligence/disputes/[id]/action/route')
const { GET: adminReportGET } = await import('@/app/api/admin/classroom-intelligence/reports/[reportId]/route')

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

function asUser(id: string, role = 'STUDENT') {
  currentStudent = { id, email: `${id}@bean.test`, displayName: null, learningLevel: null, role, onboardedAt: new Date().toISOString(), signupIntent: null }
}

function jsonReq(method: string, body?: unknown, url?: string): NextRequest {
  return new Request(url ?? 'http://localhost:3000/x', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

async function makeTeacher(id: string): Promise<{ studentId: string; profileId: string }> {
  await client.student.create({
    data: {
      id,
      email: `${id}@bean.test`,
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: { create: { teachingName: id, headline: 'h', bio: 'b', subjectsJson: '["Mathematics"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 3, verificationStatus: 'APPROVED', isPublished: true } },
    },
  })
  const profile = await client.teacherProfile.findUniqueOrThrow({ where: { studentId: id } })
  return { studentId: id, profileId: profile.id }
}

async function makeAdmin(id: string) {
  await client.student.create({ data: { id, email: `${id}@bean.test`, ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), role: 'ADMIN' } })
}

async function makeEvaluatedClass(teacherProfileId: string, teacherStudentId: string): Promise<string> {
  const cls = await client.classSession.create({
    data: {
      teacherProfileId,
      title: 'Dispute fixture class',
      description: 'd',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 5,
      minimumStudents: 1,
      liveSession: { create: { roomName: `bean-live-${Math.random().toString(36).slice(2, 9)}`, status: 'ENDED', startedById: teacherStudentId, startedAt: new Date(), endedAt: new Date(), usageMonthKey: new Date().toISOString().slice(0, 7) } },
    },
  })
  const job = await client.classroomEvaluationJob.create({
    data: { classSessionId: cls.id, teacherProfileId, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
  })
  // Agent-run audit rows (the CORRECTED rebuild reads the original outputs)
  await client.classroomAgentRun.create({
    data: {
      jobId: job.id,
      agent: 'LEARNER',
      status: 'COMPLETED',
      attempt: 1,
      modelId: 'bean-server-provider',
      outputJson: JSON.stringify({
        lessonSummary:
          'A sixty-minute mathematics class on quadratics with two worked examples and a sign-error discussion, restricted to what the aggregate evidence shows.',
        objectivesCovered: ['solving quadratic equations'],
        conceptsRequiringRevision: [],
        explanationObservations: [],
        suggestedPractice: [],
        insufficientEvidence: false,
      }),
      startedAt: new Date(),
    },
  })
  await client.classroomAgentRun.create({
    data: {
      jobId: job.id,
      agent: 'TEACHER_JUDGE',
      status: 'COMPLETED',
      attempt: 1,
      modelId: 'bean-server-provider',
      outputJson: JSON.stringify({
        findings: [
          {
            id: 1,
            category: 'LESSON_STRUCTURE',
            observation: 'A lesson-structure observation grounded in the lesson plan and teacher notes for the fixture class.',
            evidenceKinds: ['LESSON_PLAN'],
            evidenceBasis: 'available',
            confidence: 'medium',
            suggestedImprovement: 'Plan the lesson as hook, guided practice, independent practice.',
          },
        ],
        categoriesNotEvaluable: [],
        objectivesCovered: [],
        objectivesUnverifiable: [],
        insufficientEvidence: false,
      }),
      startedAt: new Date(),
    },
  })
  const report = await client.classroomEvaluationReport.create({
    data: {
      jobId: job.id,
      classSessionId: cls.id,
      teacherProfileId,
      version: 1,
      status: 'CURRENT',
      insufficientEvidence: false,
      requiresHumanReview: false,
      reportJson: JSON.stringify({
        generatedAtIso: new Date().toISOString(),
        lessonSummary:
          'A sixty-minute mathematics class on quadratics with two worked examples and a sign-error discussion, restricted to what the aggregate evidence shows.',
        strengths: [],
        improvements: [
          {
            findingId: 'judge-1',
            source: 'TEACHER_JUDGE',
            category: 'LESSON_STRUCTURE',
            observation: 'A lesson-structure observation grounded in the lesson plan and teacher notes for the fixture class.',
            evidenceKinds: ['LESSON_PLAN'],
            evidenceBasis: 'available',
            confidence: 'medium',
            suggestion: 'Plan the lesson as hook, guided practice, independent practice.',
            flaggedForReview: false,
          },
        ],
        otherFindings: [],
        categories: [
          'SUBJECT_ACCURACY', 'EXPLANATION_CLARITY', 'LESSON_STRUCTURE', 'SYLLABUS_COVERAGE', 'TEACHING_PACE',
          'USE_OF_EXAMPLES', 'STUDENT_INTERACTION', 'QUESTION_HANDLING', 'TIME_MANAGEMENT', 'LEARNING_RESOURCE_QUALITY',
        ].map((category, i) => ({ category, status: i < 3 ? 'EVALUATED' : 'INSUFFICIENT_EVIDENCE', summary: i < 3 ? 'Grounded fixture summary.' : 'Evidence unavailable.' })),
        objectivesCovered: ['solving quadratic equations'],
        objectivesUnverifiable: [],
        conceptsRequiringRevision: [],
        suggestedPractice: [],
        evidenceRegister: [{ kind: 'LESSON_PLAN', available: true, summary: 'Lesson plan available.' }],
        conflicts: [],
        insufficientEvidence: false,
        requiresHumanReview: false,
      }),
    },
  })
  return report.id
}

async function makeDispute(reportId: string, teacherStudentId: string): Promise<string> {
  asUser(teacherStudentId)
  const res = await disputePOST(jsonReq('POST', { findings: [{ findingId: 'judge-1', reason: 'The lesson notes show the structure was taught as planned and the finding understates it.' }] }), { params: Promise.resolve({ reportId }) })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { dispute: { id: string } }
  return body.dispute.id
}

// ─── E1: reconsider route ────────────────────────────────────────────────────

describe('CI-2E reconsideration route', () => {
  let teacher: { studentId: string; profileId: string }
  let reportId: string
  let disputeId: string

  beforeAll(async () => {
    teacher = await makeTeacher('ci2e-teacher')
    await makeAdmin('ci2e-admin-a')
    await makeAdmin('ci2e-admin-b')
    reportId = await makeEvaluatedClass(teacher.profileId, teacher.studentId)
    disputeId = await makeDispute(reportId, teacher.studentId)
  })

  test('ownership: another teacher gets 404; note bounds enforced', async () => {
    const stranger = await makeTeacher('ci2e-stranger')
    asUser(stranger.studentId)
    const r404 = await reconsiderPOST(jsonReq('POST', { note: 'A perfectly valid reconsideration note for the test.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(r404.status).toBe(404)

    asUser(teacher.studentId)
    const short = await reconsiderPOST(jsonReq('POST', { note: 'too short' }), { params: Promise.resolve({ id: disputeId }) })
    expect(short.status).toBe(400)
  })

  test('open disputes cannot be reconsidered (only closed ones)', async () => {
    asUser(teacher.studentId)
    const r = await reconsiderPOST(jsonReq('POST', { note: 'A valid note while the dispute is still open for review.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(r.status).toBe(409)
  })

  test('admin A resolves UPHELD → teacher reconsiders once → admin A is barred, admin B decides', async () => {
    // admin A assigns and resolves
    asUser('ci2e-admin-a', 'ADMIN')
    const assign = await adminActionPOST(jsonReq('POST', { action: 'ASSIGN' }), { params: Promise.resolve({ id: disputeId }) })
    expect(assign.status).toBe(200)
    const resolve = await adminActionPOST(jsonReq('POST', { action: 'RESOLVE', resolution: 'UPHELD', note: 'The finding is grounded in the lesson plan and notes; it stands.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(resolve.status).toBe(200)

    // teacher requests reconsideration (the one appeal)
    asUser(teacher.studentId)
    const rec = await reconsiderPOST(jsonReq('POST', { note: 'The lesson notes explicitly describe the planned three-part structure; requesting a second review.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(rec.status).toBe(200)
    const recBody = (await rec.json()) as { dispute: { status: string }; note: string }
    expect(recBody.dispute.status).toBe('SUBMITTED')
    expect(recBody.note).toContain('different administrator')

    // once-only: second reconsideration refused
    const again = await reconsiderPOST(jsonReq('POST', { note: 'A second reconsideration attempt that must be refused by the server.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(again.status).toBe(409)

    // reviewer separation: admin A (original decider) is now barred
    asUser('ci2e-admin-a', 'ADMIN')
    const barred = await adminActionPOST(jsonReq('POST', { action: 'ASSIGN' }), { params: Promise.resolve({ id: disputeId }) })
    expect(barred.status).toBe(403)
    const barredResolve = await adminActionPOST(jsonReq('POST', { action: 'RESOLVE', resolution: 'UPHELD', note: 'The original decider must not be able to decide this.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(barredResolve.status).toBe(403)

    // a DIFFERENT admin can decide the reconsidered case
    asUser('ci2e-admin-b', 'ADMIN')
    const ok = await adminActionPOST(jsonReq('POST', { action: 'RESOLVE', resolution: 'CORRECTED', note: 'Second review agrees the notes support the structure; the finding is rebuilt without it.' }), { params: Promise.resolve({ id: disputeId }) })
    expect(ok.status).toBe(200)

    // the append-only history shows the full chain
    const events = await client.classroomDisputeEvent.findMany({ where: { disputeId }, orderBy: { createdAt: 'asc' } })
    const actions = events.map((e) => e.action)
    expect(actions).toContain('RECONSIDER_REQUESTED')
    expect(actions.filter((a) => a === 'RESOLVED')).toHaveLength(2)
    expect(events[events.length - 1].detail).toContain('CORRECTED')
  })

  test('self-review refusal: an administrator cannot decide a dispute on their own report', async () => {
    // make the teacher account an ADMIN as well, then have them dispute their own report
    await client.student.update({ where: { id: teacher.studentId }, data: { role: 'ADMIN' } })
    const ownDisputeId = await makeDispute(reportId, teacher.studentId)
    asUser(teacher.studentId, 'ADMIN')
    const r = await adminActionPOST(jsonReq('POST', { action: 'ASSIGN' }), { params: Promise.resolve({ id: ownDisputeId }) })
    expect(r.status).toBe(403)
  })
})

// ─── E4: admin report inspection ─────────────────────────────────────────────

describe('CI-2E admin report inspection', () => {
  test('ADMIN-only: teachers and guests refused; admins see report + evidence + agent runs', async () => {
    const teacher = await makeTeacher('ci2e-inspect-teacher')
    const reportId = await makeEvaluatedClass(teacher.profileId, teacher.studentId)
    // an agent-run audit row
    const job = await client.classroomEvaluationJob.findFirstOrThrow({ where: { teacherProfileId: teacher.profileId } })
    await client.classroomAgentRun.create({
      data: { jobId: job.id, agent: 'LEARNER', status: 'COMPLETED', attempt: 1, modelId: 'bean-server-provider', outputJson: '{"lessonSummary":"fixture"}', startedAt: new Date() },
    })

    asUser(teacher.studentId)
    const forbidden = await adminReportGET(jsonReq('GET'), { params: Promise.resolve({ reportId }) })
    expect(forbidden.status).toBe(403)

    asUser(null as unknown as string)
    currentStudent = null
    const anon = await adminReportGET(jsonReq('GET'), { params: Promise.resolve({ reportId }) })
    expect(anon.status).toBe(401)

    asUser('ci2e-admin-a', 'ADMIN')
    const ok = await adminReportGET(jsonReq('GET'), { params: Promise.resolve({ reportId }) })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as {
      report: { id: string; version: number; evidenceRefs: unknown[]; agentRuns: { agent: string }[]; report: { improvements: unknown[] } | null }
    }
    expect(body.report.id).toBe(reportId)
    expect(body.report.version).toBe(1)
    expect(Array.isArray(body.report.evidenceRefs)).toBe(true)
    expect(body.report.agentRuns[0].agent).toBe('LEARNER')
    expect(body.report.report?.improvements).toHaveLength(1)
  })
})
