// ─── Phase 7: Credential revocation (issuing institution staff only) ─────────
// POST revokes an ISSUED credential. The caller must hold an active
// OWNER/ADMIN/INSTRUCTOR membership in the ISSUING organization and the
// organization must still be operational. A written reason (10–1000 chars) is
// mandatory and audited in OrganizationAuditEvent + CareerAuditEvent.
// Revocation is permanent: already-revoked credentials return 409 and no
// un-revoke exists. Revoked credentials never display as active verified
// achievements anywhere.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, CREDENTIAL_STATUS } from '@/lib/career'
import { appendOrgAudit, isOperationalOrg, ORG_CREDENTIAL_ROLES, requireOrgRole } from '@/lib/institution'
import { credentialRevokeSchema } from '@/lib/career-schema'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ credentialId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const { credentialId } = await params

    const parsed = credentialRevokeSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Give a short written reason (10–1000 characters).' }, { status: 400 })
    }

    const credential = await db.careerCredential.findUnique({ where: { id: credentialId } })
    if (!credential) return NextResponse.json({ error: 'Credential not found' }, { status: 404 })

    // Authorization is against the ISSUING organization, never the caller's
    // other memberships or any client-supplied org id.
    const guard = await requireOrgRole(student.id, credential.issuerOrganizationId, ORG_CREDENTIAL_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const org = await db.organization.findUnique({ where: { id: credential.issuerOrganizationId } })
    if (!org || !isOperationalOrg(org)) {
      return NextResponse.json({ error: 'The issuing organization is not currently operational.' }, { status: 403 })
    }

    if (credential.status !== CREDENTIAL_STATUS.ISSUED) {
      return NextResponse.json({ error: 'This credential has already been revoked.' }, { status: 409 })
    }

    const now = new Date()
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.careerCredential.update({
        where: { id: credential.id },
        data: {
          status: CREDENTIAL_STATUS.REVOKED,
          revokedAt: now,
          revokedByMembershipId: guard.membership.id,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: org.id,
        entityType: 'CREDENTIAL',
        entityId: credential.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'CREDENTIAL_REVOKED',
        detail: `credentialName=${credential.credentialName.slice(0, 80)}`,
      })
      await appendCareerAudit(tx, {
        entityType: 'CREDENTIAL',
        entityId: credential.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'CREDENTIAL_REVOKED',
        detail: `org=${org.slug},reason=${parsed.data.reason.slice(0, 200)}`,
      })
    })

    return NextResponse.json({ credential: { id: credential.id, status: CREDENTIAL_STATUS.REVOKED, revokedAt: now.toISOString() } })
  } catch (err) {
    console.error('[api/career/credentials/[credentialId]/revoke POST]', err)
    return NextResponse.json({ error: 'Could not revoke the credential.' }, { status: 500 })
  }
}
