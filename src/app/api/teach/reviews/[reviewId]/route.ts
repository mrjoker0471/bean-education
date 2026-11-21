// ─── BEAN Trust & Quality (Phase 6): edit own review (7-day window) ──────────
// PATCH /api/teach/reviews/:reviewId — the review's AUTHOR may edit rating /
// title / text / display-name consent within 7 days of creation. Every edit is
// audited (REVIEW_EDITED). Hidden reviews cannot be edited. The edit never
// touches moderation state — moderation is admin-only and preserved.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  isWithinEditWindow,
  isValidRating,
  rateLimited,
  countRecent,
  RATE_LIMITS,
  REVIEW_EDIT_WINDOW_DAYS,
  REVIEW_STATUS,
} from '@/lib/trust'
import { reviewEditSchema } from '@/lib/trust-schema'
import { toPublicReview } from '@/lib/trust-dto'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const parsed = reviewEditSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid edit' }, { status: 400 })
    }
    if (parsed.data.rating !== undefined && !isValidRating(parsed.data.rating)) {
      return NextResponse.json({ error: 'Rating must be a whole number from 1 to 5.' }, { status: 400 })
    }
    if (
      parsed.data.rating === undefined &&
      parsed.data.title === undefined &&
      parsed.data.reviewText === undefined &&
      parsed.data.showDisplayName === undefined
    ) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const recent = await countRecent('classReview', student.id, new Date())
    if (rateLimited('REVIEWS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'You have reached the edit limit for today — please try again later.' }, { status: 429 })
    }

    const { reviewId } = await params
    const now = new Date()

    const outcome = await db.$transaction(async (tx) => {
      const review = await tx.classReview.findUnique({ where: { id: reviewId } })
      if (!review) return { kind: 'notFound' as const }
      // Ownership is intrinsic: only the author can reach their own review here.
      if (review.studentId !== student.id) return { kind: 'forbidden' as const }
      if (review.status === REVIEW_STATUS.HIDDEN) {
        return { kind: 'hidden' as const }
      }
      if (!isWithinEditWindow(review.createdAt, now, REVIEW_EDIT_WINDOW_DAYS)) {
        return { kind: 'windowClosed' as const }
      }

      const updated = await tx.classReview.update({
        where: { id: review.id },
        data: {
          ...(parsed.data.rating !== undefined ? { rating: parsed.data.rating } : {}),
          ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
          ...(parsed.data.reviewText !== undefined ? { reviewText: parsed.data.reviewText } : {}),
          ...(parsed.data.showDisplayName !== undefined ? { showDisplayName: parsed.data.showDisplayName } : {}),
          editedAt: now,
        },
      })
      await appendAudit(tx, {
        entityType: 'CLASS_REVIEW',
        entityId: review.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'REVIEW_EDITED',
        detail: 'author edit within 7-day window',
      })
      return { kind: 'ok' as const, review: updated }
    })

    switch (outcome.kind) {
      case 'notFound':
        return NextResponse.json({ error: 'Review not found' }, { status: 404 })
      case 'forbidden':
        return NextResponse.json({ error: 'You can only edit your own review.' }, { status: 403 })
      case 'hidden':
        return NextResponse.json({ error: 'This review is under moderation and cannot be edited.' }, { status: 409 })
      case 'windowClosed':
        return NextResponse.json(
          { error: `Reviews can be edited for ${REVIEW_EDIT_WINDOW_DAYS} days after posting.` },
          { status: 409 },
        )
    }

    const full = await db.classReview.findUnique({
      where: { id: outcome.review.id },
      include: { response: true, student: { select: { displayName: true } } },
    })
    return NextResponse.json({ review: toPublicReview(full!, student.id, now) })
  } catch (err) {
    console.error('[api/teach/reviews/:reviewId PATCH]', err)
    return NextResponse.json({ error: 'Could not update your review — please try again.' }, { status: 500 })
  }
}
