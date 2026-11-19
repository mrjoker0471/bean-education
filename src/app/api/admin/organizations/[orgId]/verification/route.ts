// ─── Phase 7: Admin — organization verification decision ─────────────────────
// POST applies one legal transition (approve / reject / suspend / reinstate)
// with a required reason for rejections and suspensions. The decision is a
// deliberate human action recorded in OrganizationAuditEvent inside the same
// transaction. Moderation here NEVER touches teacher TrustAction history —
// institutional, teacher and employer verification contexts stay separate.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, isLegalVerificationTransition, ORG_VERIFICATION_STATUS } from '@/lib/institution'
import { toPublicOrganization } from '@/lib/institution-dto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ orgId: string }> }

const decisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE']),
  reason: z.string().trim().max(1000).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { orgId } = await params
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = decisionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid verification decision' }, { status: 400 })
    const { action, reason } = parsed.data
    if ((action === 'REJECT' || action === 'SUSPEND') && (!reason || reason.length < 10)) {
      return NextResponse.json({ error: 'A written reason (10+ characters) is required for rejections and suspensions.' }, { status: 400 })
    }

    const target: Record<string, string> = {
      APPROVE: ORG_VERIFICATION_STATUS.APPROVED,
      REJECT: ORG_VERIFICATION_STATUS.REJECTED,
      SUSPEND: ORG_VERIFICATION_STATUS.SUSPENDED,
      REINSTATE: ORG_VERIFICATION_STATUS.APPROVED,
    }
    const nextStatus = target[action]

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const org = await tx.organization.findUnique({ where: { id: orgId } })
      if (!org) return { kind: 'notFound' as const }
      const from = action === 'REINSTATE' ? ORG_VERIFICATION_STATUS.SUSPENDED : org.verificationStatus
      if (!isLegalVerificationTransition(from, nextStatus)) {
        return { kind: 'conflict' as const, current: org.verificationStatus, action }
      }
      const updated = await tx.organization.update({
        where: { id: orgId },
        data: {
          verificationStatus: nextStatus,
          verificationNote: reason ?? undefined,
          reviewedByAdminId: guard.student.id,
          reviewedAt: new Date(),
          rejectionReason: action === 'REJECT' ? reason ?? null : action === 'REINSTATE' ? null : undefined,
          isActive: nextStatus === ORG_VERIFICATION_STATUS.SUSPENDED ? false : true,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: orgId,
        entityType: 'ORGANIZATION',
        entityId: orgId,
        actorId: guard.student.id,
        actorRole: guard.student.role,
        action: `VERIFICATION_${action}`,
        detail: `from=${org.verificationStatus}${reason ? `,reason=${reason.slice(0, 300)}` : ''}`,
      })
      return { kind: 'ok' as const, org: updated }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ organization: toPublicOrganization(outcome.org) })
      case 'notFound':
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      case 'conflict':
        return NextResponse.json({ error: `Cannot ${outcome.action.toLowerCase()} an organization that is ${outcome.current.toLowerCase().replace('_', ' ')}.` }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/admin/organizations/[orgId]/verification POST]', err)
    return NextResponse.json({ error: 'Could not record the verification decision.' }, { status: 500 })
  }
}
