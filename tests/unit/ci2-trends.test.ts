// ─── CI-2C: teacher improvement trends — pure aggregation + route ownership ─
// T1  pure trends: subject grouping, sample-size gates, coverage math
// T2  pure trends: missing evidence separated from performance signals;
//     flagged (advisory-only) findings never feed trends
// T3  pure trends: recurring suggestions (exact text, ≥2 occurrences);
//     determinism; suggested resources from the static catalogue only
// T4  trends route: approved-teacher gate, ownership scoping (only the
//     caller's own reports), retracted reports excluded, malformed report
//     rows skipped honestly

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'

// ─── Pure part (no db) ──────────────────────────────────────────────────────
import { buildTeacherTrends, MIN_TREND_SAMPLE, type TrendReportInput } from '@/lib/ci/trends'
import { parseFinalReport, type FinalReport } from '@/lib/ci/schemas'
import { CI_EVIDENCE_KIND } from '@/lib/ci/constants'

function validReport(overrides: Partial<FinalReport> & { improvements?: FinalReport['improvements'] }): FinalReport {
  const base: FinalReport = {
    generatedAtIso: '2026-01-01T00:00:00.000Z',
    lessonSummary:
      'A synthetic thirty-character-plus lesson summary for the trends fixtures used by the CI-2C suite.',
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
    ].map((category, i) => ({
      category,
      status: i < 3 ? 'EVALUATED' : 'INSUFFICIENT_EVIDENCE',
      summary: i < 3 ? `Grounded summary for ${category.toLowerCase()}.` : 'Evidence unavailable.',
    })),
    objectivesCovered: [],
    objectivesUnverifiable: [],
    conceptsRequiringRevision: [],
    suggestedPractice: [],
    evidenceRegister: [{ kind: CI_EVIDENCE_KIND.LESSON_PLAN, available: true, summary: 'Plan available.' }],
    conflicts: [],
    insufficientEvidence: false,
    requiresHumanReview: false,
  }
  const merged = { ...base, ...overrides } as FinalReport
  return parseFinalReport(merged)
}

function trendInput(id: string, subject: string, daysAgo: number, report: FinalReport): TrendReportInput {
  return {
    reportId: id,
    version: 1,
    createdAtIso: new Date(Date.now() - daysAgo * 86400_000).toISOString(),
    subject,
    report,
  }
}

function improvementFinding(category: string, suggestion?: string, flagged = false) {
  return {
    findingId: `judge-${Math.floor(Math.random() * 100000)}`,
    source: 'TEACHER_JUDGE' as const,
    category,
    observation: `A ${category.toLowerCase()} observation long enough to satisfy the schema bounds for findings.`,
    evidenceKinds: [CI_EVIDENCE_KIND.LESSON_PLAN],
    evidenceBasis: 'available' as const,
    confidence: 'medium' as const,
    suggestion,
    flaggedForReview: flagged,
    flagReason: flagged ? 'Rests on evidence marked unavailable — advisory only, requires human review.' : undefined,
  }
}

describe('CI-2C trends — pure aggregation', () => {
  test('subject grouping: subjects are never merged or compared as equivalent', () => {
    const inputs = [
      trendInput('r1', 'Mathematics', 5, validReport({})),
      trendInput('r2', 'Physics', 4, validReport({})),
      trendInput('r3', 'Mathematics', 3, validReport({})),
    ]
    const t = buildTeacherTrends(inputs)
    expect(t.evaluatedClasses).toBe(3)
    expect(t.subjects.map((s) => s.subject).sort()).toEqual(['Mathematics', 'Physics'])
    const math = t.coverage.find((c) => c.subject === 'Mathematics')
    const physics = t.coverage.find((c) => c.subject === 'Physics')
    expect(math?.evaluatedClasses).toBe(2)
    expect(physics?.evaluatedClasses).toBe(1)
  })

  test('sample-size gate: below MIN_TREND_SAMPLE the honest state is insufficient data and no signals', () => {
    const inputs = [
      trendInput('r1', 'Mathematics', 5, validReport({})),
      trendInput('r2', 'Mathematics', 4, validReport({})),
    ]
    const t = buildTeacherTrends(inputs)
    expect(MIN_TREND_SAMPLE).toBe(3)
    expect(t.insufficientData).toBe(true)
    expect(t.improvementSignals).toHaveLength(0)
    for (const c of t.coverage) expect(c.sufficientSample).toBe(false)
  })

  test('with MIN_TREND_SAMPLE+ evaluated classes: directional signals carry counts, caveat and subject', () => {
    const inputs = [
      trendInput('r1', 'Mathematics', 40, validReport({ improvements: [improvementFinding('LESSON_STRUCTURE')] })),
      trendInput('r2', 'Mathematics', 30, validReport({ improvements: [improvementFinding('LESSON_STRUCTURE')] })),
      trendInput('r3', 'Mathematics', 10, validReport({})),
      trendInput('r4', 'Mathematics', 2, validReport({})),
    ]
    const t = buildTeacherTrends(inputs)
    expect(t.insufficientData).toBe(false)
    const signal = t.improvementSignals.find((s) => s.category === 'LESSON_STRUCTURE')
    expect(signal).toBeTruthy()
    expect(signal!.subject).toBe('Mathematics')
    expect(signal!.classesCompared).toBe(4)
    expect(signal!.direction).toBe('improving')
    expect(signal!.earlierCount).toBe(2)
    expect(signal!.recentCount).toBe(0)
    expect(signal!.caveat).toContain('small sample')
    expect(signal!.caveat).toContain('dispute')
  })

  test('missing evidence is separated: unevaluable categories produce a note, never a negative signal', () => {
    const inputs = [
      trendInput('r1', 'Mathematics', 5, validReport({})),
      trendInput('r2', 'Mathematics', 4, validReport({})),
      trendInput('r3', 'Mathematics', 3, validReport({})),
    ]
    const t = buildTeacherTrends(inputs)
    const interaction = t.categories.find((c) => c.category === 'STUDENT_INTERACTION')
    expect(interaction!.evaluatedCount).toBe(0)
    expect(interaction!.insufficientCount).toBe(3)
    expect(interaction!.missingEvidenceNote).toContain('missing evidence, not a performance signal')
    expect(interaction!.strengthCount).toBe(0)
    expect(interaction!.improvementCount).toBe(0)
  })

  test('flagged (advisory-only) findings never feed trends or recurring suggestions', () => {
    const flaggedFinding = improvementFinding('EXPLANATION_CLARITY', 'Flagged suggestion text.', true)
    const inputs = [
      trendInput('r1', 'Mathematics', 30, validReport({ improvements: [flaggedFinding] })),
      trendInput('r2', 'Mathematics', 4, validReport({ improvements: [flaggedFinding] })),
      trendInput('r3', 'Mathematics', 2, validReport({ improvements: [flaggedFinding] })),
    ]
    const t = buildTeacherTrends(inputs)
    const clarity = t.categories.find((c) => c.category === 'EXPLANATION_CLARITY')
    expect(clarity!.improvementCount).toBe(0)
    expect(t.recurringSuggestions).toHaveLength(0)
    const signal = t.improvementSignals.find((s) => s.category === 'EXPLANATION_CLARITY')
    expect(signal?.direction).toBe('steady')
    expect(signal?.earlierCount).toBe(0)
    expect(signal?.recentCount).toBe(0)
  })

  test('recurring suggestions: exact text across ≥2 reports; suggested resources only from the catalogue', () => {
    const suggestion = 'Add one deliberate check-for-understanding question per segment and note the responses.'
    const inputs = [
      trendInput('r1', 'Mathematics', 30, validReport({ improvements: [improvementFinding('STUDENT_INTERACTION', suggestion)] })),
      trendInput('r2', 'Mathematics', 20, validReport({ improvements: [improvementFinding('STUDENT_INTERACTION', suggestion)] })),
      trendInput('r3', 'Mathematics', 2, validReport({ improvements: [improvementFinding('TIME_MANAGEMENT', 'One-off suggestion that never repeats.')] })),
    ]
    const t = buildTeacherTrends(inputs)
    expect(t.recurringSuggestions).toHaveLength(1)
    expect(t.recurringSuggestions[0].occurrences).toBe(2)
    expect(t.recurringSuggestions[0].categories).toContain('STUDENT_INTERACTION')
    const resourceCategories = new Set(t.suggestedResources.map((r) => r.category))
    for (const category of resourceCategories) {
      expect(['SUBJECT_ACCURACY', 'EXPLANATION_CLARITY', 'LESSON_STRUCTURE', 'SYLLABUS_COVERAGE', 'TEACHING_PACE', 'USE_OF_EXAMPLES', 'STUDENT_INTERACTION', 'QUESTION_HANDLING', 'TIME_MANAGEMENT', 'LEARNING_RESOURCE_QUALITY']).toContain(category)
    }
    expect(t.suggestedResources.find((r) => r.category === 'STUDENT_INTERACTION')!.title).toContain('check-for-understanding')
  })

  test('coverage ratio math: covered/(covered+unverifiable); null when nothing was advertised', () => {
    const inputs = [
      trendInput('r1', 'Mathematics', 9, validReport({ objectivesCovered: ['factorisation method', 'discriminant use'], objectivesUnverifiable: ['repeated roots'] })),
      trendInput('r2', 'Mathematics', 5, validReport({ objectivesCovered: ['completing the square'], objectivesUnverifiable: [] })),
      trendInput('r3', 'Mathematics', 1, validReport({ objectivesCovered: [], objectivesUnverifiable: [] })),
    ]
    const t = buildTeacherTrends(inputs)
    const coverage = t.coverage[0]
    expect(coverage.coveredObjectives).toBe(3)
    expect(coverage.unverifiableObjectives).toBe(1)
    expect(coverage.coverageRatio).toBe(0.75)
    expect(coverage.sufficientSample).toBe(true)
    const empty = buildTeacherTrends([
      trendInput('r1', 'Mathematics', 9, validReport({})),
      trendInput('r2', 'Mathematics', 5, validReport({})),
      trendInput('r3', 'Mathematics', 1, validReport({})),
    ])
    expect(empty.coverage[0].coverageRatio).toBeNull()
  })

  test('determinism: identical inputs produce byte-identical trends', () => {
    const mk = () =>
      buildTeacherTrends([
        trendInput('r1', 'Mathematics', 30, validReport({ improvements: [improvementFinding('LESSON_STRUCTURE', 's1')] })),
        trendInput('r2', 'Mathematics', 20, validReport({})),
        trendInput('r3', 'Mathematics', 2, validReport({})),
      ])
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()))
  })
})

// ─── Route part (isolated SQLite, real route behaviour) ─────────────────────

const dir = mkdtempSync(join(tmpdir(), 'bean-ci2-trends-'))
const isolatedUrl = `file:${join(dir, 'ci2-trends.db')}`
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

const { GET: trendsGET } = await import('@/app/api/teach/classroom-intelligence/trends/route')

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

async function seedTeacher(id: string): Promise<{ studentId: string; profileId: string }> {
  const student = await client.student.create({
    data: { id, email: `${id}@bean.test`, ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), teacherProfile: { create: { teachingName: id, headline: 'h', bio: 'b', subjectsJson: '["Mathematics"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 3, verificationStatus: 'APPROVED', isPublished: true } } },
  })
  const profile = await client.teacherProfile.findUniqueOrThrow({ where: { studentId: id } })
  return { studentId: id, profileId: profile.id }
}

async function seedEvaluatedClass(teacherProfileId: string, teacherStudentId: string, subject: string, reportJson: string, status = 'CURRENT') {
  const cls = await client.classSession.create({
    data: {
      teacherProfileId,
      title: `Trend fixture ${subject}`,
      description: 'd',
      subject,
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
    data: { classSessionId: cls.id, teacherProfileId, liveSessionId: (await client.liveClassSession.findUniqueOrThrow({ where: { classSessionId: cls.id } })).id, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
  })
  return client.classroomEvaluationReport.create({
    data: { jobId: job.id, classSessionId: cls.id, teacherProfileId, version: 1, status, reportJson, insufficientEvidence: false, requiresHumanReview: false },
  })
}

function jsonReq(): NextRequest {
  return new Request('http://localhost:3000/api/teach/classroom-intelligence/trends', { method: 'GET' }) as unknown as NextRequest
}

describe('CI-2C trends — route ownership and scoping', () => {
  test('guest gets 401; student without an approved profile gets 403', async () => {
    currentStudent = null
    const guest = await trendsGET(jsonReq())
    expect(guest.status).toBe(401)
    currentStudent = { id: 'plain-student', email: 'plain@bean.test', displayName: 'P', learningLevel: null, role: 'STUDENT', onboardedAt: new Date().toISOString(), signupIntent: 'STUDENT' }
    const forbidden = await trendsGET(jsonReq())
    expect(forbidden.status).toBe(403)
  })

  test('a teacher sees ONLY their own reports in trends; retracted rows are excluded; malformed rows skipped', async () => {
    const a = await seedTeacher('trend-teacher-a')
    const b = await seedTeacher('trend-teacher-b')

    await seedEvaluatedClass(a.profileId, a.studentId, 'Mathematics', JSON.stringify(validReport({ improvements: [improvementFinding('LESSON_STRUCTURE', 'repeat-me')] })))
    await seedEvaluatedClass(a.profileId, a.studentId, 'Mathematics', JSON.stringify(validReport({ improvements: [improvementFinding('LESSON_STRUCTURE', 'repeat-me')] })))
    await seedEvaluatedClass(a.profileId, a.studentId, 'Mathematics', JSON.stringify(validReport({})))
    await seedEvaluatedClass(a.profileId, a.studentId, 'Mathematics', JSON.stringify(validReport({})), 'RETRACTED')
    await seedEvaluatedClass(a.profileId, a.studentId, 'Mathematics', '{ this is not json')
    // another teacher's data — must never leak into A's trends
    await seedEvaluatedClass(b.profileId, b.studentId, 'Physics', JSON.stringify(validReport({})))

    currentStudent = { id: a.studentId, email: `${a.studentId}@bean.test`, displayName: 'A', learningLevel: null, role: 'STUDENT', onboardedAt: new Date().toISOString(), signupIntent: 'STUDENT' }
    const res = await trendsGET(jsonReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { trends: { evaluatedClasses: number; subjects: { subject: string }[]; recurringSuggestions: { occurrences: number }[] }; scopeNote: string }
    // 4 valid CURRENT rows for A (the malformed row is skipped, the retracted row excluded, B's row invisible)
    expect(body.trends.evaluatedClasses).toBe(3)
    expect(body.trends.subjects.map((s) => s.subject)).toEqual(['Mathematics'])
    expect(body.trends.recurringSuggestions[0]?.occurrences).toBe(2)
    expect(body.scopeNote).toContain('never part of public ratings or rankings')

    currentStudent = { id: b.studentId, email: `${b.studentId}@bean.test`, displayName: 'B', learningLevel: null, role: 'STUDENT', onboardedAt: new Date().toISOString(), signupIntent: 'STUDENT' }
    const resB = await trendsGET(jsonReq())
    const bodyB = (await resB.json()) as { trends: { evaluatedClasses: number; subjects: { subject: string }[] } }
    expect(bodyB.trends.evaluatedClasses).toBe(1)
    expect(bodyB.trends.subjects.map((s) => s.subject)).toEqual(['Physics'])
  })
})
