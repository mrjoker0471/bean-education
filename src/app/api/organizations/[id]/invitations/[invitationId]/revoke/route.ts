// ─── Phase 7: Invitation revocation (org admins only) ────────────────────────
// POST sets revokedAt on a PENDING invitation so its link stops working
// immediately (the accept route re-checks the row server-side). Already-used
// (accepted) and already-revoked invitations are rejected with 409 — history
// is never rewritten. The action is audited inside the same transaction.
// Rate limit: none needed — revocation only closes doors.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, requireOrgAdmin } from '@/lib/institution'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; invitationId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, invitationId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgAdmin(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const invitation = await db.organizationInvitation.findUnique({ where: { id: invitationId } })
    if (!invitation || invitation.organizationId !== id) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }
    if (invitation.revokedAt) {
      return NextResponse.json({ error: 'This invitation has already been revoked.' }, { status: 409 })
    }
    if (invitation.acceptedAt) {
      return NextResponse.json({ error: 'This invitation was already accepted — revoke the membership instead.' }, { status: 409 })
    }

    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { revokedAt: new Date() },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'INVITATION',
        entityId: invitation.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'INVITATION_REVOKED',
        detail: `role=${invitation.intendedRole}`,
      })
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/organizations/[id]/invitations/[invitationId]/revoke POST]', err)
    return NextResponse.json({ error: 'Could not revoke the invitation.' }, { status: 500 })
  }
}
