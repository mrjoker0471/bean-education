// ─── Phase 7: Invitation acceptance ──────────────────────────────────────────
// POST /api/organizations/invitations/accept — a signed-in student redeems a
// raw invitation token. The token is hashed and looked up; the hash is never
// guessable and raw tokens are never stored. Guards: token not revoked/expired/
// exhausted, organization APPROVED + active, email restriction respected, no
// duplicate membership (unique constraint + status checks), invited role only.
// Acceptance creates the membership in INVITED state pending org approval, or
// activates LEARNER/STAFF roles directly when the invitation allows it — OWNER
// and ADMIN are never granted through invitations. Rate-limited per student.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  countRecentOrg,
  hashInvitationToken,
  isInvitationRedeemable,
  isOperationalOrg,
  ORG_MEMBERSHIP_STATUS,
  orgRateLimited,
} from '@/lib/institution'
import { invitationAcceptSchema } from '@/lib/institution-schema'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = invitationAcceptSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid invitation token' }, { status: 400 })
    const token = parsed.data.token

    const recent = await countRecentOrg('inviteAccept', student.id, null, new Date())
    if (orgRateLimited('INVITE_ACCEPTS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Too many invitation attempts today — please try again tomorrow.' }, { status: 429 })
    }

    const tokenHash = hashInvitationToken(token)
    const now = new Date()

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const invitation = await tx.organizationInvitation.findUnique({ where: { tokenHash } })
      // Same generic error for unknown/invalid tokens — no oracle.
      if (!invitation) return { kind: 'invalid' as const }
      const redeemable = isInvitationRedeemable(invitation, now)
      if (!redeemable.ok) return { kind: 'invalid' as const, reason: redeemable.error }

      const org = await tx.organization.findUnique({ where: { id: invitation.organizationId } })
      if (!org || !isOperationalOrg(org)) return { kind: 'orgNotReady' as const }

      if (invitation.email && invitation.email.toLowerCase() !== student.email.toLowerCase()) {
        return { kind: 'emailMismatch' as const }
      }

      const existing = await tx.organizationMembership.findUnique({
        where: { organizationId_studentId: { organizationId: org.id, studentId: student.id } },
      })
      if (existing && (existing.status === ORG_MEMBERSHIP_STATUS.ACTIVE || existing.status === ORG_MEMBERSHIP_STATUS.INVITED)) {
        return { kind: 'duplicate' as const }
      }

      // Suspended/LEFT members rejoining: restore the previous row (history
      // preserved) with the invited role — admins can re-approve or adjust.
      // Policy: LEARNER invitations activate immediately; elevated roles
      // (INSTRUCTOR/STAFF/CAREER_COORDINATOR/RECRUITER) stay INVITED until an
      // existing administrator approves them (APPROVE_OWNER action).
      const startStatus = invitation.intendedRole === 'LEARNER' ? ORG_MEMBERSHIP_STATUS.ACTIVE : ORG_MEMBERSHIP_STATUS.INVITED
      const membership = existing
        ? await tx.organizationMembership.update({
            where: { id: existing.id },
            data: {
              role: invitation.intendedRole,
              status: startStatus,
              activatedAt: startStatus === ORG_MEMBERSHIP_STATUS.ACTIVE ? now : undefined,
              leftAt: null,
              suspendedAt: null,
            },
          })
        : await tx.organizationMembership.create({
            data: {
              organizationId: org.id,
              studentId: student.id,
              role: invitation.intendedRole,
              status: startStatus,
              activatedAt: startStatus === ORG_MEMBERSHIP_STATUS.ACTIVE ? now : null,
              invitedByMembershipId: invitation.createdByMembershipId,
            },
          })

      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: {
          useCount: { increment: 1 },
          acceptedAt: now,
          acceptedByStudentId: student.id,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: org.id,
        entityType: 'MEMBERSHIP',
        entityId: membership.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'INVITATION_ACCEPTED',
        detail: `role=${invitation.intendedRole}`,
      })
      return { kind: 'ok' as const, membershipId: membership.id, orgName: org.displayName ?? org.name, role: invitation.intendedRole, startStatus }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ ok: true, membershipId: outcome.membershipId, organizationName: outcome.orgName, role: outcome.role, status: outcome.startStatus }, { status: 201 })
      case 'invalid':
        return NextResponse.json({ error: 'This invitation is not valid.' }, { status: 404 })
      case 'orgNotReady':
        return NextResponse.json({ error: 'This organization is not verified yet — invitations cannot be redeemed.' }, { status: 409 })
      case 'emailMismatch':
        return NextResponse.json({ error: 'This invitation was issued for a different account email.' }, { status: 403 })
      case 'duplicate':
        return NextResponse.json({ error: 'You already hold a membership in this organization.' }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/organizations/invitations/accept POST]', err)
    return NextResponse.json({ error: 'Could not accept the invitation.' }, { status: 500 })
  }
}
