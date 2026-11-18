// ─── BEAN Trust & Quality (Phase 6): flag a review for moderation ────────────
// POST /api/teach/reviews/:reviewId/flag — the reviewed class's OWNER teacher
// (or an ADMIN) asks for moderation with a written reason. Flagging sets the
// review to FLAGGED — which stays publicly visible (flagging is NEVER
// auto-hiding) and merely queues it for admin review while excluding it from
// aggregates. Rate-limited; audited (REVIEW_FLAGGED). Complaints never touch
// review status — this route is the only non-admin path to FLAGGED.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasRole } from '@/lib/roles'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  rateLimited,
  countRecent,
  RATE_LIMITS,
  REVIEW_STATUS,
  requireOwnTeacherProfile,
} from '@/lib/trust'
import { reviewFlagSchema } from '@/lib/trust-schema'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const parsed = reviewFlagSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
    }

    const recent = await countRecent('trustFlag', student.id, new Date())
    if (rateLimited('FLAGS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'You have reached the report limit for today — please try again later.' }, { status: 429 })
    }

    const { reviewId } = await params
    const isAdmin = hasRole(student.role, ['ADMIN'])

    const outcome = await db.$transaction(async (tx) => {
      const review = await tx.classReview.findUnique({ where: { id: reviewId } })
      if (!review) return { kind: 'notFound' as const }
      if (!isAdmin) {
        const profile = await tx.teacherProfile.findUnique({
          where: { studentId: student.id },
          select: { id: true, verificationStatus: true },
        })
        if (!profile || profile.verificationStatus !== 'APPROVED' || profile.id !== review.teacherProfileId) {
          return { kind: 'forbidden' as const }
        }
      }
      if (review.status === REVIEW_STATUS.HIDDEN) {
        return { kind: 'alreadyHidden' as const }
      }
      if (review.status === REVIEW_STATUS.FLAGGED) {
        return { kind: 'alreadyFlagged' as const }
      }
      await tx.classReview.update({
        where: { id: review.id },
        data: { status: REVIEW_STATUS.FLAGGED },
      })
      await appendAudit(tx, {
        entityType: 'CLASS_REVIEW',
        entityId: review.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'REVIEW_FLAGGED',
        detail: parsed.data.reason,
      })
      return { kind: 'ok' as const }
    })

    switch (outcome.kind) {
      case 'notFound':
        return NextResponse.json({ error: 'Review not found' }, { status: 404 })
      case 'forbidden':
        return NextResponse.json({ error: 'Only the reviewed class\'s teacher or an administrator can flag a review.' }, { status: 403 })
      case 'alreadyHidden':
        return NextResponse.json({ error: 'This review is already hidden by moderation.' }, { status: 409 })
      case 'alreadyFlagged':
        return NextResponse.json({ error: 'This review is already awaiting moderation.' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, status: REVIEW_STATUS.FLAGGED })
  } catch (err) {
    console.error('[api/teach/reviews/:reviewId/flag POST]', err)
    return NextResponse.json({ error: 'Could not flag the review — please try again.' }, { status: 500 })
  }
}
