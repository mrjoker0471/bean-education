// ─── Phase 7: Organization invitations — list / create ───────────────────────
// GET lists the org's invitations (never includes token hashes). POST creates
// an invitation: a high-entropy token is generated server-side, ONLY its
// SHA-256 hash is stored, and the raw token is returned exactly once for the
// copy-link workflow (no email service exists; none is pretended). Invitations
// can never grant OWNER or ADMIN. Rate-limited per organization.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  countRecentOrg,
  hashInvitationToken,
  isInvitableRole,
  isOperationalOrg,
  newInvitationToken,
  orgRateLimited,
  requireOrgAdmin,
} from '@/lib/institution'
import { invitationCreateSchema } from '@/lib/institution-schema'
import { toInvitationDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const guard = await requireOrgAdmin(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const invitations = await db.organizationInvitation.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      { invitations: invitations.map(toInvitationDTO) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/invitations GET]', err)
    return NextResponse.json({ error: 'Could not load invitations.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgAdmin(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    if (!isOperationalOrg(guard.organization)) {
      return NextResponse.json({ error: 'This organization is not approved yet — invitations unlock after BEAN verifies it.' }, { status: 403 })
    }

    const parsed = invitationCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid invitation details' }, { status: 400 })
    const { email, intendedRole, ttlDays, maxUses } = parsed.data
    if (!isInvitableRole(intendedRole)) {
      return NextResponse.json({ error: 'Invitations cannot grant owner or administrator roles.' }, { status: 400 })
    }

    const recent = await countRecentOrg('invite', student.id, id, new Date())
    if (orgRateLimited('INVITES_PER_DAY_PER_ORG', recent)) {
      return NextResponse.json({ error: 'Invitation limit reached for today — please try again tomorrow.' }, { status: 429 })
    }

    const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600_000)
    const rawToken = newInvitationToken()
    const tokenHash = hashInvitationToken(rawToken)

    const invitation = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.organizationInvitation.create({
        data: {
          organizationId: id,
          email: email ?? null,
          intendedRole,
          tokenHash,
          createdByMembershipId: guard.membership.id,
          expiresAt,
          maxUses: maxUses ?? null,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'INVITATION',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'INVITATION_CREATED',
        detail: `role=${intendedRole}${email ? ',email-restricted=true' : ''}`,
      })
      return created
    })

    // The raw token appears exactly once, in this response, for the copy-link UI.
    return NextResponse.json({ invitation: { ...toInvitationDTO(invitation), rawToken } }, { status: 201 })
  } catch (err) {
    console.error('[api/organizations/[id]/invitations POST]', err)
    return NextResponse.json({ error: 'Could not create the invitation.' }, { status: 500 })
  }
}
