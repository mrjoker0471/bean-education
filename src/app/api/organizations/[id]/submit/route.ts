// ─── Phase 7: Organization verification submission ───────────────────────────
// OWNER/ADMIN submit a DRAFT (or previously rejected) organization for admin
// review. Approval itself is a separate deliberate admin decision — submitting
// never approves. Uses the pure state machine (isLegalVerificationTransition).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, isLegalVerificationTransition, ORG_VERIFICATION_STATUS, requireOrgAdmin } from '@/lib/institution'
import { toOwnOrganization } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgAdmin(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const org = await tx.organization.findUnique({ where: { id } })
      if (!org) return { kind: 'notFound' as const }
      if (!isLegalVerificationTransition(org.verificationStatus, ORG_VERIFICATION_STATUS.PENDING_REVIEW)) {
        return { kind: 'badState' as const, current: org.verificationStatus }
      }
      const updated = await tx.organization.update({
        where: { id },
        data: { verificationStatus: ORG_VERIFICATION_STATUS.PENDING_REVIEW },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'ORGANIZATION',
        entityId: id,
        actorId: student.id,
        actorRole: student.role,
        action: 'VERIFICATION_SUBMITTED',
        detail: `from=${org.verificationStatus}`,
      })
      return { kind: 'ok' as const, org: updated }
    })

    if (result.kind === 'notFound') return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    if (result.kind === 'badState') {
      return NextResponse.json({ error: `This organization is currently ${result.current.toLowerCase().replace('_', ' ')} and cannot be resubmitted right now.` }, { status: 409 })
    }
    return NextResponse.json({ organization: toOwnOrganization(result.org) })
  } catch (err) {
    console.error('[api/organizations/[id]/submit POST]', err)
    return NextResponse.json({ error: 'Could not submit the organization for review.' }, { status: 500 })
  }
}
