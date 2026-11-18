// GET  /api/student/goals — all goals of the signed-in student
//                       (ACTIVE first, then everything else; updatedAt desc within each group)
// POST /api/student/goals — same-origin + signed-in; create a study goal
//
// Response DTOs (documented for the UI client):
//   GET  → { goals: GoalDTO[] }
//   POST → { goal: GoalDTO }
//
// Notes:
//   • targetDate is mapped to an ISO string (null when unset).
//   • exam/topic labels are resolved eagerly (id/slug/name) so the UI does not
//     need extra catalogue round-trips; dangling ids (deleted catalogue rows)
//     honestly resolve to null labels.
//   • POST rejects when the student already has 50 non-archived goals (409).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Type-only exports — erased at compile time, safe for a Route Handler file.
export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
export interface GoalExamRef {
  id: string
  slug: string
  name: string
  shortName: string | null
}
export interface GoalTopicRef {
  id: string
  name: string
}
export interface GoalDTO {
  id: string
  title: string
  examId: string | null
  topicId: string | null
  targetDate: string | null // ISO 8601
  status: GoalStatus
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  exam: GoalExamRef | null
  topic: GoalTopicRef | null
}

const MAX_NON_ARCHIVED_GOALS = 50

// YYYY-MM-DD (HTML date inputs) or a full ISO datetime — nothing looser.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/
function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
}

type GoalRow = {
  id: string
  title: string
  examId: string | null
  topicId: string | null
  targetDate: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
}

// StudyGoal carries examId/topicId as plain FK columns (no Prisma relation),
// so labels are resolved with two small batched lookups.
async function toGoalDTOs(rows: GoalRow[]): Promise<GoalDTO[]> {
  const examIds = [...new Set(rows.map(r => r.examId).filter((v): v is string => typeof v === 'string'))]
  const topicIds = [...new Set(rows.map(r => r.topicId).filter((v): v is string => typeof v === 'string'))]
  const [exams, topics] = await Promise.all([
    examIds.length > 0
      ? db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, slug: true, name: true, shortName: true } })
      : Promise.resolve([] as { id: string; slug: string; name: string; shortName: string | null }[]),
    topicIds.length > 0
      ? db.topic.findMany({ where: { id: { in: topicIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ])
  const examById = new Map(exams.map(e => [e.id, e]))
  const topicById = new Map(topics.map(t => [t.id, t]))
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    examId: r.examId,
    topicId: r.topicId,
    targetDate: r.targetDate ? r.targetDate.toISOString() : null,
    status: r.status as GoalStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    exam: r.examId ? examById.get(r.examId) ?? null : null,
    topic: r.topicId ? topicById.get(r.topicId) ?? null : null,
  }))
}

function unauthorized() {
  return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const auth = await requireStudent()
    if (!auth) return unauthorized()
    const rows = await db.studyGoal.findMany({
      where: { studentId: auth.id },
      orderBy: { updatedAt: 'desc' },
    })
    // ACTIVE first, then the rest; each group stays updatedAt-desc (stable sort).
    rows.sort((a, b) => {
      const aActive = a.status === 'ACTIVE' ? 0 : 1
      const bActive = b.status === 'ACTIVE' ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return b.updatedAt.getTime() - a.updatedAt.getTime()
    })
    return NextResponse.json({ goals: await toGoalDTOs(rows) })
  } catch (err) {
    console.error('[api/student/goals GET]', err)
    return NextResponse.json({ error: 'Failed to load goals' }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────────

const postSchema = z.object({
  title: z.string().trim().min(3).max(140),
  examId: z.string().min(1).max(64).optional(),
  topicId: z.string().min(1).max(64).optional(),
  targetDate: z.string().refine(isIsoDate).optional(),
})

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    }
    const auth = await requireStudent()
    if (!auth) return unauthorized()

    const raw: unknown = await req.json().catch(() => null)
    if (raw === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const parsed = postSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid goal' }, { status: 400 })
    }
    const { title, examId, topicId, targetDate } = parsed.data

    // Honest existence checks — never create a goal pointing at a missing row.
    if (examId !== undefined) {
      const exam = await db.exam.findUnique({ where: { id: examId }, select: { id: true } })
      if (!exam) return NextResponse.json({ error: 'Exam not found' }, { status: 400 })
    }
    if (topicId !== undefined) {
      const topic = await db.topic.findUnique({ where: { id: topicId }, select: { id: true } })
      if (!topic) return NextResponse.json({ error: 'Topic not found' }, { status: 400 })
    }

    const nonArchived = await db.studyGoal.count({
      where: { studentId: auth.id, status: { not: 'ARCHIVED' } },
    })
    if (nonArchived >= MAX_NON_ARCHIVED_GOALS) {
      return NextResponse.json(
        { error: `Goal limit reached — complete or archive goals to add more (max ${MAX_NON_ARCHIVED_GOALS} non-archived)` },
        { status: 409 },
      )
    }

    const created = await db.studyGoal.create({
      data: {
        studentId: auth.id,
        title,
        examId: examId ?? null,
        topicId: topicId ?? null,
        targetDate: targetDate ? new Date(targetDate) : null,
        status: 'ACTIVE',
      },
    })
    const [goal] = await toGoalDTOs([created])
    return NextResponse.json({ goal })
  } catch (err) {
    console.error('[api/student/goals POST]', err)
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 })
  }
}
