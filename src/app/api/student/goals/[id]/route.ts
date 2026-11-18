// PATCH  /api/student/goals/[id] — update title / status / targetDate (owner only)
// DELETE /api/student/goals/[id] — permanently remove the goal (owner only)
//
// Both handlers: same-origin → 403, signed-in → 401, ownership
// (goal.studentId === student.id) → 404 for missing or foreign goals.
//
// Response DTOs (documented for the UI client):
//   PATCH  → { goal: GoalDTO }        (same shape as GET /api/student/goals items)
//   DELETE → { ok: true }
//
// PATCH semantics:
//   • title 3..140 (trimmed), status ACTIVE|COMPLETED|ARCHIVED
//   • targetDate: ISO date string to set, null to CLEAR, omitted = unchanged
//   • an empty PATCH changes nothing and returns the goal unchanged

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import type { GoalDTO } from '../route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/
function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value))
}

// StudyGoal carries examId/topicId as plain FK columns (no Prisma relation),
// so labels are resolved with two small batched lookups. Duplicated here (and
// in the dashboard route) because shared lib files are outside this task's
// allowed file list.
async function toGoalDTOs(rows: {
  id: string
  title: string
  examId: string | null
  topicId: string | null
  targetDate: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
}[]): Promise<GoalDTO[]> {
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
    status: r.status as GoalDTO['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    exam: r.examId ? examById.get(r.examId) ?? null : null,
    topic: r.topicId ? topicById.get(r.topicId) ?? null : null,
  }))
}

function unauthorized() {
  return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
}

function notFound() {
  return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
}

async function loadOwnedGoal(id: string, studentId: string) {
  const goal = await db.studyGoal.findUnique({ where: { id } })
  if (!goal || goal.studentId !== studentId) return null
  return goal
}

// ─── PATCH ─────────────────────────────────────────────────────────────────────

const patchSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']).optional(),
  targetDate: z.string().refine(isIsoDate).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    }
    const auth = await requireStudent()
    if (!auth) return unauthorized()

    const raw: unknown = await req.json().catch(() => null)
    if (raw === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const parsed = patchSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid goal update' }, { status: 400 })
    }

    const goal = await loadOwnedGoal(id, auth.id)
    if (!goal) return notFound()

    const { title, status, targetDate } = parsed.data
    const data: { title?: string; status?: string; targetDate?: Date | null } = {}
    if (title !== undefined) data.title = title
    if (status !== undefined) data.status = status
    if (targetDate !== undefined) data.targetDate = targetDate === null ? null : new Date(targetDate)

    if (Object.keys(data).length === 0) {
      const [unchanged] = await toGoalDTOs([goal])
      return NextResponse.json({ goal: unchanged })
    }

    const updated = await db.studyGoal.update({ where: { id }, data })
    const [goalDto] = await toGoalDTOs([updated])
    return NextResponse.json({ goal: goalDto })
  } catch (err) {
    console.error('[api/student/goals/:id PATCH]', err)
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 })
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    }
    const auth = await requireStudent()
    if (!auth) return unauthorized()

    const goal = await loadOwnedGoal(id, auth.id)
    if (!goal) return notFound()

    await db.studyGoal.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/student/goals/:id DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 })
  }
}
