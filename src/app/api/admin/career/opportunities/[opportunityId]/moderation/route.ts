// ─── Phase 7: Admin — opportunity moderation decision ────────────────────────
// POST records a moderation decision (approve publication / reject with
// required reason / pause unsafe listings / resume paused listings / close).
// Every decision is audited. Moderation never touches teacher trust records.
// The moderation queue listing lives at /api/admin/career/opportunities.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, OPPORTUNITY_STATUS } from '@/lib/career'
import { toPublicOpportunityDTO } from '@/lib/career-dto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ opportunityId: string }> }

const moderationSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'PAUSE', 'CLOSE', 'RESUME']),
  reason: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { opportunityId } = await params
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = moderationSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid moderation action' }, { status: 400 })
    const { action, reason } = parsed.data
    if ((action === 'REJECT' || action === 'PAUSE') && (!reason || reason.length < 10)) {
      return NextResponse.json({ error: 'A written reason (10+ characters) is required for rejections and pauses.' }, { status: 400 })
    }

    const target: Record<string, string> = {
      APPROVE: OPPORTUNITY_STATUS.PUBLISHED,
      REJECT: OPPORTUNITY_STATUS.REJECTED,
      PAUSE: OPPORTUNITY_STATUS.PAUSED,
      CLOSE: OPPORTUNITY_STATUS.CLOSED,
      RESUME: OPPORTUNITY_STATUS.PUBLISHED,
    }

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const opportunity = await tx.careerOpportunity.findUnique({ where: { id: opportunityId } })
      if (!opportunity) return { kind: 'notFound' as const }
      const nextStatus = target[action]
      const legal: Record<string, string[]> = {
        [OPPORTUNITY_STATUS.PUBLISHED]: [OPPORTUNITY_STATUS.PENDING_REVIEW, OPPORTUNITY_STATUS.PAUSED],
        [OPPORTUNITY_STATUS.REJECTED]: [OPPORTUNITY_STATUS.PENDING_REVIEW],
        [OPPORTUNITY_STATUS.PAUSED]: [OPPORTUNITY_STATUS.PUBLISHED],
        [OPPORTUNITY_STATUS.CLOSED]: [OPPORTUNITY_STATUS.PUBLISHED, OPPORTUNITY_STATUS.PENDING_REVIEW, OPPORTUNITY_STATUS.DRAFT, OPPORTUNITY_STATUS.PAUSED],
      }
      if (!(legal[nextStatus] ?? []).includes(opportunity.status)) {
        return { kind: 'conflict' as const, current: opportunity.status }
      }
      const updated = await tx.careerOpportunity.update({
        where: { id: opportunityId },
        data: {
          status: nextStatus,
          reviewedByAdminId: guard.student.id,
          reviewedAt: new Date(),
          rejectionReason: action === 'REJECT' ? reason ?? null : action === 'RESUME' || action === 'APPROVE' ? null : undefined,
          publishedAt: nextStatus === OPPORTUNITY_STATUS.PUBLISHED && !opportunity.publishedAt ? new Date() : undefined,
        },
        include: { organization: true },
      })
      await appendCareerAudit(tx, {
        entityType: 'OPPORTUNITY',
        entityId: opportunityId,
        actorId: guard.student.id,
        actorRole: guard.student.role,
        action: `OPPORTUNITY_${action}`,
        detail: `${opportunity.status}->${nextStatus}${reason ? `,reason=${reason.slice(0, 300)}` : ''}`,
      })
      return { kind: 'ok' as const, opportunity: updated }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ opportunity: toPublicOpportunityDTO(outcome.opportunity) })
      case 'notFound':
        return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
      case 'conflict':
        return NextResponse.json({ error: `Cannot moderate a listing that is ${outcome.current.toLowerCase()}.` }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/admin/career/opportunities/[opportunityId]/moderation POST]', err)
    return NextResponse.json({ error: 'Could not record the moderation decision.' }, { status: 500 })
  }
}
