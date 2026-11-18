// ─── BEAN Trust & Quality (Phase 6): appeals ─────────────────────────────────
// GET  /api/teach/appeals — the caller's own appeals with status timeline.
// POST /api/teach/appeals — appeal a complaint decision, review moderation or
//      trust action. Server-side relationship checks:
//        • COMPLAINT_DECISION — complainant or the concerned teacher; the
//          complaint must be decided (RESOLVED / DISMISSED).
//        • REVIEW_MODERATION — the review's author; the review must be HIDDEN.
//        • TRUST_ACTION — the restricted teacher themselves.
//      originalDecisionById is captured SERVER-SIDE from the audit trail so
//      the deciding reviewer can later be refused when they made the original
//      decision (self-review ban). Duplicate open appeals are rejected.
//      Appeals never create payments or refunds — Phase 8 owns money.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  APPEAL_STATUS,
  APPEAL_TARGET,
  rateLimited,
  countRecent,
  RATE_LIMITS,
  OPEN_APPEAL_STATUSES,
} from '@/lib/trust'
import { appealCreateSchema } from '@/lib/trust-schema'
import { toOwnAppeal } from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const appeals = await db.teachAppeal.findMany({
      where: { appellantId: student.id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ appeals: appeals.map(toOwnAppeal) })
  } catch (err) {
    console.error('[api/teach/appeals GET]', err)
    return NextResponse.json({ error: 'Could not load your appeals — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in to submit an appeal.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const parsed = appealCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid appeal' }, { status: 400 })
    }

    const recent = await countRecent('teachAppeal', student.id, new Date())
    if (rateLimited('APPEALS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'You have reached the appeal limit for today — please try again later.' }, { status: 429 })
    }

    const { targetType, targetId, reason } = parsed.data

    // Duplicate open appeal for the same decision — rejected.
    const openDuplicate = await db.teachAppeal.findFirst({
      where: {
        appellantId: student.id,
        targetType,
        targetId,
        status: { in: [...OPEN_APPEAL_STATUSES] },
      },
      select: { id: true },
    })
    if (openDuplicate) {
      return NextResponse.json({ error: 'An appeal for this decision is already open.' }, { status: 409 })
    }

    // Relationship + decision-state checks per target type. All identity comes
    // from the session; client ids only NAME the target, never grant access.
    let originalDecisionById: string | null = null
    if (targetType === APPEAL_TARGET.COMPLAINT_DECISION) {
      const complaint = await db.teachComplaint.findUnique({ where: { id: targetId } })
      if (!complaint) return NextResponse.json({ error: 'Original case not found' }, { status: 404 })
      let isTeacherParty = false
      if (complaint.teacherProfileId) {
        const profile = await db.teacherProfile.findUnique({
          where: { studentId: student.id },
          select: { id: true, verificationStatus: true },
        })
        isTeacherParty =
          !!profile &&
          profile.verificationStatus === 'APPROVED' &&
          profile.id === complaint.teacherProfileId
      }
      if (complaint.complainantId !== student.id && !isTeacherParty) {
        return NextResponse.json({ error: 'You can only appeal decisions that concern you.' }, { status: 403 })
      }
      if (complaint.status !== 'RESOLVED' && complaint.status !== 'DISMISSED') {
        return NextResponse.json({ error: 'This case has not been decided yet.' }, { status: 409 })
      }
      const decisionEvent = await db.complaintEvent.findFirst({
        where: { complaintId: complaint.id, action: { in: ['RESOLVED', 'DISMISSED'] } },
        orderBy: { createdAt: 'desc' },
        select: { actorId: true },
      })
      originalDecisionById = decisionEvent?.actorId ?? null
    } else if (targetType === APPEAL_TARGET.REVIEW_MODERATION) {
      const review = await db.classReview.findUnique({ where: { id: targetId } })
      if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
      if (review.studentId !== student.id) {
        return NextResponse.json({ error: 'You can only appeal moderation of your own review.' }, { status: 403 })
      }
      if (review.status !== 'HIDDEN') {
        return NextResponse.json({ error: 'Only hidden reviews can be appealed.' }, { status: 409 })
      }
      const hideEvent = await db.teachAuditEvent.findFirst({
        where: { entityType: 'CLASS_REVIEW', entityId: review.id, action: 'REVIEW_HIDDEN' },
        orderBy: { createdAt: 'desc' },
        select: { actorId: true },
      })
      originalDecisionById = hideEvent?.actorId ?? null
    } else if (targetType === APPEAL_TARGET.TRUST_ACTION) {
      const action = await db.trustAction.findUnique({ where: { id: targetId } })
      if (!action) return NextResponse.json({ error: 'Trust action not found' }, { status: 404 })
      const profile = await db.teacherProfile.findUnique({
        where: { studentId: student.id },
        select: { id: true },
      })
      if (!profile || profile.id !== action.teacherProfileId) {
        return NextResponse.json({ error: 'You can only appeal trust actions on your own profile.' }, { status: 403 })
      }
      originalDecisionById = action.createdByAdminId
    }

    const appeal = await db.$transaction(async (tx) => {
      const created = await tx.teachAppeal.create({
        data: {
          appellantId: student.id,
          targetType,
          targetId,
          originalDecisionById,
          reason,
          status: APPEAL_STATUS.SUBMITTED,
        },
      })
      await tx.appealEvent.create({
        data: {
          appealId: created.id,
          actorId: student.id,
          actorRole: student.role,
          action: 'SUBMITTED',
          detail: null,
        },
      })
      return created
    })

    return NextResponse.json(
      { appeal: { id: appeal.id, status: appeal.status } },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/teach/appeals POST]', err)
    return NextResponse.json({ error: 'Could not submit your appeal — please try again.' }, { status: 500 })
  }
}
