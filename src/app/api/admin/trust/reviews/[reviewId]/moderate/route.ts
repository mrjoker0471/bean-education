// ─── BEAN Trust & Quality (Phase 6): admin review moderation decision ────────
// POST /api/admin/trust/reviews/:reviewId/moderate — ADMIN-only.
//   KEEP_PUBLISHED — FLAGGED → PUBLISHED (criticism is not a violation).
//   HIDE           — any visible state → HIDDEN; requires documented reason.
//                    Only an authorised moderator may hide, with a reason —
//                    a negative review alone is never sufficient grounds.
//   RESTORE        — HIDDEN → PUBLISHED (restoring when a decision is reversed).
// Every decision writes audit (REVIEW_HIDDEN / REVIEW_RESTORED /
// REVIEW_KEPT_PUBLISHED) inside the same transaction as the state change; the
// audit actor is later used for the appeal self-review ban. Original history
// is never deleted — re-moderation appends.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { REVIEW_STATUS } from '@/lib/trust'
import { adminReviewModerationSchema } from '@/lib/trust-schema'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json().catch(() => null)
    const parsed = adminReviewModerationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid decision' }, { status: 400 })
    }

    const { reviewId } = await params
    const { action, reason } = parsed.data
    const now = new Date()

    const outcome = await db.$transaction(async (tx) => {
      const review = await tx.classReview.findUnique({ where: { id: reviewId } })
      if (!review) return { kind: 'notFound' as const }

      let nextStatus: string | null = null
      let auditAction: string | null = null
      if (action === 'HIDE') {
        if (review.status === REVIEW_STATUS.HIDDEN) return { kind: 'noop' as const }
        nextStatus = REVIEW_STATUS.HIDDEN
        auditAction = 'REVIEW_HIDDEN'
      } else if (action === 'RESTORE') {
        if (review.status !== REVIEW_STATUS.HIDDEN) return { kind: 'noop' as const }
        nextStatus = REVIEW_STATUS.PUBLISHED
        auditAction = 'REVIEW_RESTORED'
      } else {
        if (review.status !== REVIEW_STATUS.FLAGGED) return { kind: 'noop' as const }
        nextStatus = REVIEW_STATUS.PUBLISHED
        auditAction = 'REVIEW_KEPT_PUBLISHED'
      }

      const updated = await tx.classReview.update({
        where: { id: review.id },
        data: {
          status: nextStatus,
          moderatedAt: now,
          moderationReason: reason,
        },
      })
      await appendAudit(tx, {
        entityType: 'CLASS_REVIEW',
        entityId: review.id,
        actorId: guard.student.id,
        actorRole: guard.student.role,
        action: auditAction,
        detail: reason,
      })
      return { kind: 'ok' as const, status: updated.status }
    })

    switch (outcome.kind) {
      case 'notFound':
        return NextResponse.json({ error: 'Review not found' }, { status: 404 })
      case 'noop':
        return NextResponse.json({ error: 'The review is already in the requested state.' }, { status: 409 })
    }

    return NextResponse.json({ ok: true, status: outcome.status })
  } catch (err) {
    console.error('[api/admin/trust/reviews/:reviewId/moderate POST]', err)
    return NextResponse.json({ error: 'Could not record the moderation decision — please try again.' }, { status: 500 })
  }
}
