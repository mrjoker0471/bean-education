import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

// ─── Real-persistence regression: mastery evidence pagination beyond 200 ──────
// The pure engine tests mock the DB; THIS file runs the actual recompute
// orchestration (recomputeTopicMastery) against a REAL Prisma + SQLite
// database in an isolated temp file, with MORE attempts than one evidence
// page. It proves the documented guarantees:
//   1. the LAST attempt can update the outcome of a question first answered
//      in the FIRST page,
//   2. a topic that first appears AFTER attempt 200 receives a mastery row
//      (the pre-fix take-200 window silently dropped it),
//   3. evidence counts and the latest-attempt regression rule stay correct,
//   4. pagination loses and duplicates NO attempt — and stays exact even when
//      a group of attempts shares ONE timestamp across the page boundary (the
//      failure mode of a naive cursor over the non-unique startedAt).
//
// The isolated URL is bound twice on purpose: the Prisma CLI (schema push)
// and the PrismaClient used by the code under test (explicit datasources
// override) — the developer DB and the main checkout are never touched.

const dir = mkdtempSync(join(tmpdir(), 'bean-3b-mastery-pagination-'))
const isolatedUrl = `file:${join(dir, 'evidence.db')}`

let client: PrismaClient
mock.module('@/lib/db', () => {
  client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
  return { db: client }
})

const { recomputeTopicMastery, EVIDENCE_PAGE_SIZE } = await import('@/lib/learning/mastery')

beforeAll(() => {
  execFileSync('bun', ['x', 'prisma', 'db', 'push', '--skip-generate'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 120_000,
  })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

// ── Fixture layout (P = EVIDENCE_PAGE_SIZE = 200) ──────────────────────────────
// First pass (baseline test): exactly P attempts = one full page.
//   positions 1 … P-2   A1…A(P-2)  — t-old: pq-old1 WRONG in A1, then all six
//                                    t-old questions CORRECT; plus one unique
//                                    sentinel question (topic-count).
//   positions P-1 … P+2 Tie4       — FOUR attempts sharing ONE startedAt,
//                                    sentinels only. The page boundary falls
//                                    INSIDE this group, so the cursor must
//                                    seek past equal timestamps without
//                                    skipping or replaying any of them.
// Second pass (inner tests): 12 more attempts arrive (P + 12 total).
//   positions P+3 … P+11 TieGrp9   — NINE attempts sharing another startedAt:
//                                    unique sentinels; member 8 answers
//                                    pq-late WRONG; member 9 re-answers
//                                    pq-old1 CORRECTLY (a first-page question
//                                    updated by a later page).
//   position P+12       Final      — strictly latest startedAt: pq-old2 WRONG
//                                    (latest t-old attempt = 0% →
//                                    NEEDS_REVISION from STRONG), pq-late
//                                    CORRECT (latest wins on the post-200
//                                    topic), unique sentinel.
// Every attempt carries exactly one topic-count sentinel question, so
// attemptCount === evidenceQuestions === attempts processed — a lost or
// duplicated page breaks that equation. All order-sensitive outcomes (t-old,
// t-late latest answers) sit on DISTINCT startedAt values, so the tie groups'
// internal id order cannot change any assertion.
const GUEST = 'g-pag-pagination-test'
const OTHER = 'g-other-pagination-test'
const T0 = new Date('2026-05-01T06:00:00.000Z')
const min = (n: number) => new Date(T0.getTime() + n * 60_000)

let attemptNo = 0
function attemptData(overrides: {
  startedAt: Date
  answers: Record<string, number>
  questionIds: string[]
  guestId?: string
}) {
  attemptNo++
  return {
    id: `pa-${String(attemptNo).padStart(4, '0')}`,
    guestId: overrides.guestId ?? GUEST,
    examId: 'exam-pag',
    examLabel: 'PAG',
    title: `Pagination attempt ${attemptNo}`,
    configJson: JSON.stringify({ count: overrides.questionIds.length, durationMin: 10, marksPerQuestion: 1, negativeMark: 0 }),
    questionIdsJson: JSON.stringify(overrides.questionIds),
    answersJson: JSON.stringify(overrides.answers),
    status: 'SUBMITTED',
    score: 0,
    maxScore: overrides.questionIds.length,
    source: 'BANK',
    startedAt: overrides.startedAt,
    submittedAt: new Date(overrides.startedAt.getTime() + 30_000),
  }
}

describe('recomputeTopicMastery — real persistence beyond one evidence page', () => {
  const P = EVIDENCE_PAGE_SIZE
  const oldQuestions = ['pq-old1', 'pq-old2', 'pq-old3', 'pq-old4', 'pq-old5', 'pq-old6']

  beforeAll(async () => {
    expect(P).toBe(200) // the regression targets the shipped page size

    // Catalogue hierarchy the mastery rows label themselves with.
    await client.category.create({ data: { id: 'cat-pag', slug: 'engineering-pag', name: 'Engineering (fixture)' } })
    await client.exam.create({ data: { id: 'exam-pag', slug: 'pag', name: 'Pagination Exam', shortName: 'PAG', authority: 'Test Board', categorySlug: 'engineering-pag', description: 'Isolated fixture exam' } })
    await client.stage.create({ data: { id: 'stage-pag', examId: 'exam-pag', slug: 'main', name: 'Main', order: 1 } })
    await client.subject.create({ data: { id: 'subject-pag', stageId: 'stage-pag', slug: 'physics', name: 'Physics', order: 1 } })
    await client.unit.create({ data: { id: 'unit-pag', subjectId: 'subject-pag', slug: 'mechanics', name: 'Mechanics', order: 1 } })
    for (const [id, name] of [['topic-old', 'Kinematics'], ['topic-late', 'Late Topic'], ['topic-count', 'Sentinel Topic']] as const) {
      await client.topic.create({ data: { id, unitId: 'unit-pag', slug: id, name, order: 1 } })
    }
    const questions: Record<string, string> = {}
    for (const q of oldQuestions) questions[q] = 'topic-old'
    questions['pq-late'] = 'topic-late'
    questions['pq-fin'] = 'topic-count'
    for (let i = 1; i <= P - 2; i++) questions[`pq-s${i}`] = 'topic-count'
    for (let i = 1; i <= 4; i++) questions[`pq-tie${i}`] = 'topic-count'
    for (let i = 1; i <= 9; i++) questions[`pq-grp${i}`] = 'topic-count'
    await client.question.createMany({
      data: Object.entries(questions).map(([id, topicId]) => ({
        id,
        examId: 'exam-pag',
        stageId: 'stage-pag',
        subjectId: 'subject-pag',
        topicId,
        canonicalSlug: id,
        text: `${id}?`,
        optionsJson: JSON.stringify(['a', 'b', 'c', 'd']),
        correctIndex: 0,
        explanation: 'fixture',
        verificationStatus: 'VERIFIED',
      })),
    })

    // First pass: exactly one full page of attempts.
    const attempts: ReturnType<typeof attemptData>[] = []
    for (let i = 1; i <= P - 2; i++) {
      const answers: Record<string, number> = { [`pq-s${i}`]: 0 }
      for (const q of oldQuestions) answers[q] = i === 1 ? 2 : 0 // 2 = wrong (correct is 0)
      attempts.push(attemptData({ startedAt: min(i), answers, questionIds: [...oldQuestions, `pq-s${i}`] }))
    }
    for (let i = 1; i <= 4; i++) {
      // One timestamp for all four — the boundary straddles this group.
      attempts.push(attemptData({ startedAt: min(P), answers: { [`pq-tie${i}`]: 0 }, questionIds: [`pq-tie${i}`] }))
    }
    await client.attempt.createMany({ data: attempts }) // (P-2) + 4 = P attempts

    // Cross-owner attempt on the same topic — must never bleed into GUEST.
    await client.attempt.create({
      data: attemptData({ guestId: OTHER, startedAt: min(500), answers: { 'pq-old1': 0 }, questionIds: ['pq-old1'] }),
    })
  })

  it('baseline single-page pass stores STRONG for t-old with exact counts', async () => {
    await recomputeTopicMastery(GUEST)
    const row = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-old' } } })
    expect(row?.status).toBe('STRONG')
    expect(row?.accuracy).toBe(100)
    expect(row?.attemptCount).toBe(P - 2)
    const sentinel = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-count' } } })
    // (P-2) + 4 = P+2 attempts exist now; the tie group already straddles the
    // page boundary (positions P-1…P+2) — and the count is still exact.
    expect(sentinel?.attemptCount).toBe(P + 2)
    expect(sentinel?.evidenceQuestions).toBe(P + 2)
  })

  describe('after the post-page attempts arrive', () => {
    beforeAll(async () => {
      const tail: ReturnType<typeof attemptData>[] = []
      for (let i = 1; i <= 9; i++) {
        const answers: Record<string, number> = { [`pq-grp${i}`]: 0 }
        const questionIds = [`pq-grp${i}`]
        if (i === 8) { answers['pq-late'] = 2; questionIds.push('pq-late') } // wrong (correct is 0)
        if (i === 9) { answers['pq-old1'] = 0; questionIds.push('pq-old1') } // first-page question, updated beyond it
        tail.push(attemptData({ startedAt: min(1000), answers, questionIds }))
      }
      tail.push(attemptData({
        startedAt: min(1002), // strictly latest of everything
        answers: { 'pq-old2': 2, 'pq-late': 0, 'pq-fin': 0 },
        questionIds: ['pq-old2', 'pq-late', 'pq-fin'],
      }))
      await client.attempt.createMany({ data: tail }) // 9 + 1 → P + 12 total
    })

    it('every submitted attempt was folded in exactly once (no gap, no duplicate)', async () => {
      await recomputeTopicMastery(GUEST)
      const sentinel = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-count' } } })
      // One sentinel question per attempt: distinct questions === attempts
      // processed and attemptCount === attempts processed. A lost page lowers
      // both; a replayed page raises attemptCount; either breaks the equation.
      expect(sentinel?.attemptCount).toBe(P + 12)
      expect(sentinel?.evidenceQuestions).toBe(P + 12)
      expect(sentinel?.accuracy).toBe(100)
      expect(sentinel?.status).toBe('STRONG')
    })

    it('a topic first appearing AFTER attempt 200 receives a mastery row', async () => {
      const late = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-late' } } })
      expect(late).not.toBeNull()
      expect(late?.evidenceQuestions).toBe(1)
      // Latest answer wins: the strictly-latest attempt answered pq-late
      // CORRECTLY, replacing the earlier wrong answer from the tie group.
      expect(late?.accuracy).toBe(100)
      expect(late?.attemptCount).toBe(2)
      expect(late?.status).toBe('INSUFFICIENT_EVIDENCE')
    })

    it('the last attempt updates a question first answered in the first page', async () => {
      const old = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-old' } } })
      // pq-old1 (wrong in A1) was re-answered correctly beyond the first page;
      // pq-old2 went wrong in the final attempt.
      expect(old?.correctDistinct).toBe(5)
      expect(old?.evidenceQuestions).toBe(6)
      expect(old?.accuracy).toBe(83)
      expect(old?.attemptCount).toBe(P)
    })

    it('latest-attempt regression rule still fires across page boundaries', async () => {
      const old = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-old' } } })
      // The first pass stored STRONG; the final attempt scored 0% on t-old.
      expect(old?.status).toBe('NEEDS_REVISION')
      expect(old?.statusReason).toContain('0%')
    })

    it('another owner’s identical-topic evidence stays isolated', async () => {
      await recomputeTopicMastery(OTHER)
      const otherOld = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: OTHER, topicId: 'topic-old' } } })
      expect(otherOld?.attemptCount).toBe(1)
      expect(otherOld?.accuracy).toBe(100)
      const otherSentinel = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: OTHER, topicId: 'topic-count' } } })
      expect(otherSentinel).toBeNull()
      // And the owner under test was not polluted by the other guest:
      const mine = await client.topicMastery.findUnique({ where: { guestId_topicId: { guestId: GUEST, topicId: 'topic-old' } } })
      expect(mine?.attemptCount).toBe(P)
    })
  })
})
