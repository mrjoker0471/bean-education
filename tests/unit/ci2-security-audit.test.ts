// ─── CI-2G: consolidated security, privacy and deletion audit ────────────────
// Reinspects every CI-1 + CI-2 access path on an isolated SQLite database:
//   G1  student ownership of class summaries (+ no personal data in links)
//   G2  teacher ownership of reports/evaluations/trends (cross-teacher denials)
//   G3  admin-only routes (incl. the new CI-2E report-inspection route)
//   G4  dispute access is teacher-scoped; reconsider is owner-only
//   G5  export completeness: reports, summaries, disputes, reconsider events
//   G6  account deletion erases every CI row (cascades verified, not assumed)
//   G7  session expiry/invalidation → 401 on every CI endpoint
//   G8  log minimisation: CI code never logs report/summary/notes content
//   G9  sensitive-information exposure: student DTOs carry no model provenance
//       and no teacher identity

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci2-audit-'))
const isolatedUrl = `file:${join(dir, 'ci2-audit.db')}`

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

const { GET: summariesGET } = await import('@/app/api/learn/class-summaries/route')
const { GET: trendsGET } = await import('@/app/api/teach/classroom-intelligence/trends/route')
const { GET: teacherCiGET } = await import('@/app/api/teach/classroom-intelligence/route')
const { GET: disputesGET } = await import('@/app/api/teach/classroom-intelligence/disputes/route')
const { POST: reconsiderPOST } = await import('@/app/api/teach/classroom-intelligence/disputes/[id]/reconsider/route')
const { GET: adminReportGET } = await import('@/app/api/admin/classroom-intelligence/reports/[reportId]/route')
const { GET: adminQueueGET } = await import('@/app/api/admin/classroom-intelligence/disputes/route')
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asUser(id: string | null, role = 'STUDENT') {
  currentStudent = id
    ? { id, email: `${id}@bean.test`, displayName: null, learningLevel: null, role, onboardedAt: new Date().toISOString(), signupIntent: null }
    : null
}
function jsonReq(method = 'GET', body?: unknown): NextRequest {
  return new Request('http://localhost:3000/x', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

async function makeTeacher(id: string): Promise<string> {
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
  return profile.id
}

const REPORT_JSON = JSON.stringify({
  generatedAtIso: new Date().toISOString(),
  lessonSummary:
    'A sixty-minute mathematics class on quadratics, restricted to what the aggregate evidence shows about the session and its attendance.',
  strengths: [],
  improvements: [
    {
      findingId: 'judge-1',
      source: 'TEACHER_JUDGE',
      category: 'LESSON_STRUCTURE',
      observation: 'A lesson-structure observation grounded in the lesson plan for the audit fixture class.',
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
  ].map((category, i) => ({ category, status: i < 3 ? 'EVALUATED' : 'INSUFFICIENT_EVIDENCE', summary: i < 3 ? 'Grounded summary.' : 'Evidence unavailable.' })),
  objectivesCovered: ['solving quadratic equations'],
  objectivesUnverifiable: [],
  conceptsRequiringRevision: [],
  suggestedPractice: [],
  evidenceRegister: [{ kind: 'LESSON_PLAN', available: true, summary: 'Lesson plan available.' }],
  conflicts: [],
  insufficientEvidence: false,
  requiresHumanReview: false,
})

const SUMMARY_JSON = JSON.stringify({
  classId: 'audit-class',
  lessonSummary:
    'A ninety-minute mathematics class on fractions, restricted to what the aggregate evidence shows; no individual claims are made anywhere.',
  conceptsCovered: ['Equivalent fractions'],
  revisionRecommendations: [],
  suggestedPractice: ['Practice equivalent fractions with visual models'],
  scopeNote:
    'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
})

/** Full classroom fixture for one teacher: ENDED class + job + report + attended booking + summary + dispute (+ reconsider event). */
async function seedFullFixture(teacherId: string, profileId: string, suffix: string): Promise<{ classId: string; reportId: string; disputeId: string; bookingId: string }> {
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profileId,
      title: `Audit class ${suffix}`,
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
      liveSession: { create: { roomName: `bean-live-audit-${suffix}`, status: 'ENDED', startedById: teacherId, startedAt: new Date(), endedAt: new Date(), usageMonthKey: new Date().toISOString().slice(0, 7) } },
    },
  })
  const job = await client.classroomEvaluationJob.create({ data: { classSessionId: cls.id, teacherProfileId: profileId, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' } })
  const report = await client.classroomEvaluationReport.create({
    data: { jobId: job.id, classSessionId: cls.id, teacherProfileId: profileId, version: 1, status: 'CURRENT', reportJson: REPORT_JSON, insufficientEvidence: false, requiresHumanReview: false },
  })
  await client.classroomEvidenceRef.create({ data: { reportId: report.id, kind: 'LESSON_PLAN', refId: cls.id, summary: 'Lesson plan available.', available: true } })
  const student = await client.student.create({ data: { id: `audit-stu-${suffix}`, email: `audit-stu-${suffix}@bean.test`, ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() } })
  const booking = await client.classBooking.create({ data: { classSessionId: cls.id, studentId: student.id, status: 'ATTENDED' } })
  await client.classroomStudentSummary.create({ data: { jobId: job.id, bookingId: booking.id, classSessionId: cls.id, summaryJson: SUMMARY_JSON } })
  const dispute = await client.classroomEvaluationDispute.create({
    data: { reportId: report.id, teacherId, status: 'SUBMITTED', findingsJson: JSON.stringify([{ findingId: 'judge-1', reason: 'The lesson notes show the structure was taught as planned and the finding understates it.' }]) },
  })
  await client.classroomDisputeEvent.create({ data: { disputeId: dispute.id, actorId: teacherId, actorRole: 'STUDENT', action: 'SUBMITTED', detail: 'Disputed 1 finding(s): judge-1.' } })
  return { classId: cls.id, reportId: report.id, disputeId: dispute.id, bookingId: booking.id }
}

// ─── G1/G9: student ownership + DTO exposure ────────────────────────────────

describe('CI-2G student ownership and DTO exposure', () => {
  test('G1+G9: a student sees only own summaries; the payload carries no model provenance, no teacher identity, and links are class-level', async () => {
    const tProfile = await makeTeacher('audit-teacher')
    const fixture = await seedFullFixture('audit-teacher', tProfile, 'a')
    const other = await client.student.create({ data: { id: 'audit-stu-other', email: 'audit-stu-other@bean.test', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() } })
    const otherBooking = await client.classBooking.create({ data: { classSessionId: fixture.classId, studentId: other.id, status: 'ATTENDED' } })
    const job = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: fixture.classId } })
    await client.classroomStudentSummary.create({ data: { jobId: job.id, bookingId: otherBooking.id, classSessionId: fixture.classId, summaryJson: SUMMARY_JSON, modelId: 'bean-server-provider' } })

    asUser('audit-stu-a')
    const res = await summariesGET(jsonReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summaries: Record<string, unknown>[] }
    // only the caller's own booking row — the other student's summary is invisible
    expect(body.summaries).toHaveLength(1)
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('modelId')
    expect(raw).not.toContain('bean-server-provider')
    expect(raw).not.toContain('audit-teacher')
    // learning links contain only existing-catalogue navigation, never personal claims
    const links = body.summaries[0].learningLinks as { syllabusTopics: { label: string; matchedOn: string[] }[] }
    for (const topic of links.syllabusTopics) {
      expect(topic.matchedOn.length).toBeGreaterThan(0)
    }
    await client.student.deleteMany({ where: { id: { in: ['audit-stu-other', 'audit-teacher', 'audit-stu-a'] } } })
  })
})

// ─── G2/G3/G4: teacher ownership, admin-only, dispute scoping ────────────────

describe('CI-2G teacher/admin access paths', () => {
  let profileA: string
  let profileB: string
  let fixtureA: { classId: string; reportId: string; disputeId: string }
  let fixtureB: { classId: string; reportId: string; disputeId: string }

  beforeAll(async () => {
    await makeTeacher('audit-t-a')
    await makeTeacher('audit-t-b')
    profileA = (await client.teacherProfile.findUniqueOrThrow({ where: { studentId: 'audit-t-a' } })).id
    profileB = (await client.teacherProfile.findUniqueOrThrow({ where: { studentId: 'audit-t-b' } })).id
    fixtureA = await seedFullFixture('audit-t-a', profileA, 'ta')
    fixtureB = await seedFullFixture('audit-t-b', profileB, 'tb')
    await client.student.create({ data: { id: 'audit-admin', email: 'audit-admin@bean.test', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), role: 'ADMIN' } })
  })

  afterAll(async () => {
    await client.student.deleteMany({ where: { id: { in: ['audit-t-a', 'audit-t-b', 'audit-admin'] } } })
  })

  test('G2: teacher B cannot see teacher A classes in the CI summary, B\'s trends exclude A\'s reports', async () => {
    asUser('audit-t-a')
    const resA = await teacherCiGET(jsonReq())
    const bodyA = (await resA.json()) as { evaluated: { classSessionId: string }[] }
    expect(bodyA.evaluated.every((e) => e.classSessionId === fixtureA.classId)).toBe(true)

    asUser('audit-t-b')
    const resB = await trendsGET(jsonReq())
    expect(resB.status).toBe(200)
    const trendsB = (await resB.json()) as { trends: { evaluatedClasses: number } }
    expect(trendsB.trends.evaluatedClasses).toBe(1) // only B's own report

    asUser('audit-t-a')
    const trendsA = await trendsGET(jsonReq())
    const trendsABody = (await trendsA.json()) as { trends: { evaluatedClasses: number } }
    expect(trendsABody.trends.evaluatedClasses).toBe(1)
  })

  test('G3: the admin report-inspection route is ADMIN-only; the admin queue lists all disputes', async () => {
    asUser('audit-t-a')
    const forbidden = await adminReportGET(jsonReq(), { params: Promise.resolve({ reportId: fixtureA.reportId }) })
    expect(forbidden.status).toBe(403)
    asUser('audit-admin', 'ADMIN')
    const ok = await adminReportGET(jsonReq(), { params: Promise.resolve({ reportId: fixtureA.reportId }) })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { report: { evidenceRefs: unknown[]; id: string } }
    expect(body.report.id).toBe(fixtureA.reportId)
    expect(body.report.evidenceRefs.length).toBeGreaterThan(0)

    const queue = await adminQueueGET(jsonReq())
    const queueBody = (await queue.json()) as { disputes: { id: string }[] }
    expect(queueBody.disputes.some((d) => d.id === fixtureA.disputeId)).toBe(true)
    expect(queueBody.disputes.some((d) => d.id === fixtureB.disputeId)).toBe(true)
  })

  test('G4: teacher dispute list is teacher-scoped; reconsider is owner-only', async () => {
    asUser('audit-t-b')
    const res = await disputesGET(jsonReq())
    const body = (await res.json()) as { disputes: { id: string }[] }
    expect(body.disputes.some((d) => d.id === fixtureB.disputeId)).toBe(true)
    expect(body.disputes.some((d) => d.id === fixtureA.disputeId)).toBe(false)

    asUser('audit-t-b')
    const rec = await reconsiderPOST(jsonReq('POST', { note: 'A reconsideration attempt on another teacher dispute must fail.' }), { params: Promise.resolve({ id: fixtureA.disputeId }) })
    expect(rec.status).toBe(404)
  })
})

// ─── G5/G6: export completeness and deletion cascades ───────────────────────

describe('CI-2G export and deletion', () => {
  test('G5: export includes reports, summaries and disputes (with reconsider events)', async () => {
    const tProfile = await makeTeacher('audit-export-t')
    const fixture = await seedFullFixture('audit-export-t', tProfile, 'ex')
    await client.classroomDisputeEvent.create({
      data: { disputeId: fixture.disputeId, actorId: 'audit-export-t', actorRole: 'STUDENT', action: 'RECONSIDER_REQUESTED', detail: 'Teacher requested reconsideration for the audit export check.' },
    })
    asUser('audit-export-t')
    const res = await exportGET(jsonReq())
    expect(res.status).toBe(200)
    const raw = JSON.stringify(await res.json())
    expect(raw).toContain('classroomIntelligence')
    expect(raw).toContain('judge-1')
    expect(raw).toContain('RECONSIDER_REQUESTED')
    await client.student.deleteMany({ where: { id: 'audit-export-t' } })
  })

  test('G6: deleting the owner erases every CI row — cascades verified row by row', async () => {
    const tProfile = await makeTeacher('audit-del-t')
    const fixture = await seedFullFixture('audit-del-t', tProfile, 'del')
    await client.student.delete({ where: { id: 'audit-del-t' } })

    expect(await client.classroomEvaluationJob.count({ where: { classSessionId: fixture.classId } })).toBe(0)
    expect(await client.classroomEvaluationReport.count({ where: { id: fixture.reportId } })).toBe(0)
    expect(await client.classroomEvidenceRef.count({ where: { reportId: fixture.reportId } })).toBe(0)
    expect(await client.classroomStudentSummary.count({ where: { classSessionId: fixture.classId } })).toBe(0)
    expect(await client.classroomEvaluationDispute.count({ where: { id: fixture.disputeId } })).toBe(0)
    expect(await client.classroomDisputeEvent.count({ where: { disputeId: fixture.disputeId } })).toBe(0)
    expect(await client.classSession.count({ where: { id: fixture.classId } })).toBe(0)
    // the attendee student remains (their own account) but their summary is gone with the class
    expect(await client.student.findUnique({ where: { id: `audit-stu-del` } })).not.toBeNull()
  })
})

// ─── G7/G8: session expiry and log minimisation ──────────────────────────────

describe('CI-2G sessions and logs', () => {
  test('G7: an unauthenticated session is refused on every CI endpoint (401/403)', async () => {
    asUser(null)
    const a = await summariesGET(jsonReq())
    expect(a.status).toBe(401)
    const b = await teacherCiGET(jsonReq())
    expect([401, 403]).toContain(b.status)
    const c = await trendsGET(jsonReq())
    expect([401, 403]).toContain(c.status)
    const d = await disputesGET(jsonReq())
    expect([401, 403]).toContain(d.status)
    const e = await adminQueueGET(jsonReq())
    expect([401, 403]).toContain(e.status)
    const f = await adminReportGET(jsonReq(), { params: Promise.resolve({ reportId: 'x' }) })
    expect([401, 403]).toContain(f.status)
    const g = await exportGET(jsonReq())
    expect([401, 403]).toContain(g.status)
  })

  test('G8: CI server code never logs report/summary/notes content (log minimisation scan)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const roots = ['src/lib/ci', 'src/app/api/admin/classroom-intelligence', 'src/app/api/teach/classroom-intelligence', 'src/app/api/learn/class-summaries']
    const files: string[] = []
    const walk = (p: string) => {
      for (const f of readdirSync(p)) {
        const full = join(p, f)
        if (statSync(full).isDirectory()) walk(full)
        else if (f.endsWith('.ts')) files.push(full)
      }
    }
    for (const r of roots) walk(r)
    expect(files.length).toBeGreaterThan(5)
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8').split('\n')
      src.forEach((line, i) => {
        if (/console\.(log|error|warn|info)/.test(line) && /(summaryJson|reportJson|teacherNotes|lessonSummary|outputJson)/.test(line)) {
          offenders.push(`${file}:${i + 1}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})
