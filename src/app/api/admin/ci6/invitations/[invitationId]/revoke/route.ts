// ─── BEAN Classroom Intelligence (CI-6E): revoke an unused invitation ─────────
// POST /api/admin/ci6/invitations/[invitationId]/revoke — authorised
// administrator revokes a PENDING invitation (reason required). Claimed,
// expired and already-revoked invitations refuse. No token material involved.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { invitationsDbFromPrisma, revokeInvitation } from '@/lib/ci/fleet/invitations'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ invitationId: string }> }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { invitationId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const admin = { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN administrator' }
    const reason = typeof (body as { reason?: unknown }).reason === 'string' ? (body as { reason: string }).reason : ''
    const result = await revokeInvitation(invitationsDbFromPrisma(db), admin, invitationId, reason)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      invitation: {
        id: result.invitation.id,
        status: result.invitation.status,
        revokedReason: result.invitation.revokedReason,
      },
    })
  } catch (err) {
    console.error('[api/admin/ci6/invitations/[invitationId]/revoke POST]', err)
    return NextResponse.json({ error: 'Could not revoke the invitation — please try again.' }, { status: 500 })
  }
}
