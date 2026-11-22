// ─── Phase 7: Admin — adult-eligibility review decision (safeguarding) ────────
// POST records the admin decision (approve / deny with required reason).
// No identity documents are collected or stored anywhere in this flow — the
// decision is based on the documented, privacy-minimizing review process.
// Every decision is audited; denial keeps private career planning available
// but continues to block discovery and applications. The reviews listing
// lives at /api/admin/career/eligibility.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, ELIGIBILITY_STATUS } from '@/lib/career'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ reviewId: string }> }

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'DENY']),
  reason: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { reviewId } = await params
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid eligibility decision' }, { status: 400 })
    const { decision, reason } = parsed.data
    if (decision === 'DENY' && (!reason || reason.length < 10)) {
      return NextResponse.json({ error: 'A written reason (10+ characters) is required for denials.' }, { status: 400 })
    }

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const review = await tx.careerEligibilityReview.findUnique({ where: { id: reviewId } })
      if (!review) return { kind: 'notFound' as const }
      if (review.status === ELIGIBILITY_STATUS.APPROVED || review.status === ELIGIBILITY_STATUS.DENIED) {
        return { kind: 'conflict' as const, current: review.status }
      }
      const nextStatus = decision === 'APPROVE' ? ELIGIBILITY_STATUS.APPROVED : ELIGIBILITY_STATUS.DENIED
      const updated = await tx.careerEligibilityReview.update({
        where: { id: reviewId },
        data: {
          status: nextStatus,
          reviewedByAdminId: guard.student.id,
          reviewedAt: new Date(),
          decisionReason: reason ?? null,
        },
      })
      await appendCareerAudit(tx, {
        entityType: 'ELIGIBILITY',
        entityId: reviewId,
        actorId: guard.student.id,
        actorRole: guard.student.role,
        action: decision === 'APPROVE' ? 'ELIGIBILITY_APPROVED' : 'ELIGIBILITY_DENIED',
        detail: reason ? `reason=${reason.slice(0, 300)}` : null,
      })
      return { kind: 'ok' as const, status: updated.status }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ eligibility: { status: outcome.status } })
      case 'notFound':
        return NextResponse.json({ error: 'Review not found' }, { status: 404 })
      case 'conflict':
        return NextResponse.json({ error: `This review is already ${outcome.current.toLowerCase().replace('_', ' ')}.` }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/admin/career/eligibility/[reviewId]/decision POST]', err)
    return NextResponse.json({ error: 'Could not record the eligibility decision.' }, { status: 500 })
  }
}
