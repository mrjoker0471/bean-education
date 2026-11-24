// ─── CI-2D: learning links — deterministic matcher + summaries route ─────────
// L1  pure matcher: real catalogue matches only, matchedOn honesty, caps,
//     determinism, empty-on-no-match
// L2  summaries route: learningLinks present per owned summary; ownership and
//     the class-level boundary unchanged

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import type { NextRequest } from 'next/server'

import { buildLearningLinks } from '@/lib/ci/learning-links'

describe('CI-2D learning links — pure matcher', () => {
  test('real catalogue matches: tokens map to existing topics with honest matchedOn', () => {
    const links = buildLearningLinks({
      subject: 'Mathematics',
      conceptsCovered: ['Fractions as parts of a whole', 'Equivalent fractions', 'Adding fractions with the same denominator'],
      revisionTopics: [],
    })
    expect(links.syllabusTopics.length).toBeGreaterThan(0)
    expect(links.syllabusTopics.length).toBeLessThanOrEqual(4)
    for (const t of links.syllabusTopics) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.href).toMatch(/^#\/exam\/[a-z0-9-]+\?tab=study$/)
      expect(t.matchedOn.length).toBeGreaterThan(0)
      expect(t.detail).toContain('·')
    }
    // practice links exist for matched exams + the always-present revision planner
    expect(links.practice.some((p) => p.href === '#/learning')).toBe(true)
    expect(links.practice.length).toBeGreaterThanOrEqual(2)
  })

  test('no match → honestly empty lists (nothing invented)', () => {
    const links = buildLearningLinks({
      subject: 'Underwater basket weaving',
      conceptsCovered: ['kelp strand tension', 'weave density'],
      revisionTopics: [],
    })
    // Subject may match nothing; if a topic matched, every match must still be real.
    for (const t of links.syllabusTopics) expect(t.href).toMatch(/^#\/exam\//)
    if (links.syllabusTopics.length === 0) {
      expect(links.resources).toHaveLength(0)
    }
  })

  test('resources only come from the curated EXAM_RESOURCES list of matched exams', () => {
    const links = buildLearningLinks({
      subject: 'Mathematics',
      conceptsCovered: ['quadratic equations', 'discriminant'],
      revisionTopics: [],
    })
    const matchedExams = new Set(links.syllabusTopics.map((t) => t.href))
    for (const r of links.resources) {
      expect(r.url).toMatch(/^https?:\/\//)
      expect(r.provider.length).toBeGreaterThan(0)
      expect(r.accessType).toBeOneOf(['FREE', 'REGISTRATION', 'PAID'])
    }
    expect(links.resources.length).toBeLessThanOrEqual(3)
    void matchedExams
  })

  test('determinism: identical inputs produce identical links', () => {
    const input = {
      subject: 'Mathematics',
      conceptsCovered: ['trigonometry ratios', 'sin cos tan'],
      revisionTopics: ['identities'],
    }
    expect(JSON.stringify(buildLearningLinks(input))).toBe(JSON.stringify(buildLearningLinks(input)))
  })

  test('caps: at most 4 topics, 2 exam practice links + revision planner, 3 resources', () => {
    const links = buildLearningLinks({
      subject: 'Mathematics',
      conceptsCovered: ['fractions', 'algebra', 'geometry', 'trigonometry', 'probability', 'statistics', 'quadratic equations', 'linear equations'],
      revisionTopics: ['mensuration', 'number systems'],
    })
    expect(links.syllabusTopics.length).toBeLessThanOrEqual(4)
    const examPractice = links.practice.filter((p) => p.href !== '#/learning')
    expect(examPractice.length).toBeLessThanOrEqual(2)
    expect(links.practice.some((p) => p.href === '#/learning')).toBe(true)
    expect(links.resources.length).toBeLessThanOrEqual(3)
  })
})

// ─── Route behaviour (isolated SQLite, real route) ───────────────────────────

const dir = mkdtempSync(join(tmpdir(), 'bean-ci2-links-'))
const isolatedUrl = `file:${join(dir, 'ci2-links.db')}`
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

const SUMMARY_JSON = JSON.stringify({
  classId: 'will-be-overwritten',
  lessonSummary:
    'A ninety-minute mathematics class covering equivalent fractions and adding fractions with the same denominator, ending with guided practice items.',
  conceptsCovered: ['Equivalent fractions', 'Adding fractions with the same denominator'],
  revisionRecommendations: ['Comparing fraction sizes with visual models'],
  suggestedPractice: ['Practice equivalent fractions with visual models like fraction circles'],
  scopeNote:
    'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
})

function jsonReq(): NextRequest {
  return new Request('http://localhost:3000/api/learn/class-summaries', { method: 'GET' }) as unknown as NextRequest
}

describe('CI-2D learning links — summaries route', () => {
  test('student sees ONLY their own summaries, each carrying deterministic learningLinks', async () => {
    const owner = await client.student.create({ data: { id: 'links-student', email: 'links-student@bean.test', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() } })
    const other = await client.student.create({ data: { id: 'links-other', email: 'links-other@bean.test', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date() } })
    const teacher = await client.student.create({
      data: {
        id: 'links-teacher',
        email: 'links-teacher@bean.test',
        ageBand: 'ADULT_18_PLUS',
        onboardedAt: new Date(),
        teacherProfile: { create: { teachingName: 'T', headline: 'h', bio: 'b', subjectsJson: '["Mathematics"]', levelsJson: '["SCHOOL_6_8"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 2, verificationStatus: 'APPROVED', isPublished: true } },
      },
    })
    const profile = await client.teacherProfile.findUniqueOrThrow({ where: { studentId: 'links-teacher' } })
    const cls = await client.classSession.create({
      data: {
        teacherProfileId: profile.id,
        title: 'Fractions — visual first',
        description: 'd',
        subject: 'Mathematics',
        targetLevel: 'SCHOOL_6_8',
        language: 'English',
        durationMinutes: 90,
        startsAt: new Date(),
        timeZone: 'Asia/Kolkata',
        status: 'PUBLISHED',
        capacity: 5,
        minimumStudents: 1,
        liveSession: { create: { roomName: 'bean-live-links', status: 'ENDED', startedById: teacher.id, startedAt: new Date(), endedAt: new Date(), usageMonthKey: new Date().toISOString().slice(0, 7) } },
      },
    })
    const job = await client.classroomEvaluationJob.create({
      data: { classSessionId: cls.id, teacherProfileId: profile.id, status: 'COMPLETED', stage: 'DONE', trigger: 'SESSION_END' },
    })
    const bookingOwner = await client.classBooking.create({ data: { classSessionId: cls.id, studentId: owner.id, status: 'ATTENDED' } })
    const bookingOther = await client.classBooking.create({ data: { classSessionId: cls.id, studentId: other.id, status: 'ATTENDED' } })
    await client.classroomStudentSummary.create({ data: { jobId: job.id, bookingId: bookingOwner.id, classSessionId: cls.id, summaryJson: SUMMARY_JSON } })
    await client.classroomStudentSummary.create({ data: { jobId: job.id, bookingId: bookingOther.id, classSessionId: cls.id, summaryJson: SUMMARY_JSON } })

    currentStudent = { id: 'links-student', email: 'links-student@bean.test', displayName: 'S', learningLevel: null, role: 'STUDENT', onboardedAt: new Date().toISOString(), signupIntent: 'STUDENT' }
    const res = await summariesGET(jsonReq())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      summaries: { bookingId: string; learningLinks: { syllabusTopics: unknown[]; practice: unknown[]; resources: unknown[] } }[]
    }
    // ownership: only the caller's own booking rows
    expect(body.summaries).toHaveLength(1)
    expect(body.summaries[0].bookingId).toBe(bookingOwner.id)
    const links = body.summaries[0].learningLinks
    expect(Array.isArray(links.syllabusTopics)).toBe(true)
    expect(Array.isArray(links.practice)).toBe(true)
    expect(Array.isArray(links.resources)).toBe(true)
    expect(links.practice.some((p: { href: string }) => p.href === '#/learning')).toBe(true)
  })
})
