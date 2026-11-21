// ─── Phase 7: Credential issuance (institution staff only) ───────────────────
// POST issues a credential to a student on behalf of an APPROVED organization.
// The issuer must hold an active OWNER/ADMIN/INSTRUCTOR membership; EMPLOYER
// organizations do not issue educational credentials. Every issuance (and
// later revocation) is recorded in OrganizationAuditEvent + CareerAuditEvent.
// Revoked credentials never display as active verified achievements.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, CREDENTIAL_STATUS } from '@/lib/career'
import { appendOrgAudit, isOperationalOrg, ORG_CREDENTIAL_ROLES, requireOrgRole } from '@/lib/institution'
import { toCredentialDTO } from '@/lib/career-dto'
import { z } from 'zod'
import { CREDENTIAL_REF_MAX } from '@/lib/career'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const issueSchema = z.object({
  organizationId: z.string().min(6).max(64),
  studentId: z.string().min(6).max(64),
  credentialName: z.string().trim().min(4).max(160)
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), { message: 'Unsupported characters' }),
  credentialDescription: z.string().trim().max(1000).optional().nullable(),
  issuedDate: z.string().datetime({ offset: true }).optional(),
  expiryDate: z.string().datetime({ offset: true }).optional().nullable(),
  credentialReference: z.string().trim().max(CREDENTIAL_REF_MAX).optional().nullable(),
})

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = issueSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid credential details' }, { status: 400 })
    const input = parsed.data

    const guard = await requireOrgRole(student.id, input.organizationId, ORG_CREDENTIAL_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const org = await db.organization.findUnique({ where: { id: input.organizationId } })
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    if (!isOperationalOrg(org)) {
      return NextResponse.json({ error: 'Only BEAN-verified organizations can issue credentials.' }, { status: 403 })
    }
    if (org.orgType === 'EMPLOYER') {
      return NextResponse.json({ error: 'Employer organizations cannot issue educational credentials.' }, { status: 403 })
    }

    const recipient = await db.student.findUnique({ where: { id: input.studentId }, select: { id: true } })
    if (!recipient) return NextResponse.json({ error: 'Student not found' }, { status: 404 })

    const credential = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.careerCredential.create({
        data: {
          studentId: recipient.id,
          issuerOrganizationId: org.id,
          credentialName: input.credentialName,
          credentialDescription: input.credentialDescription ?? null,
          issuedDate: input.issuedDate ? new Date(input.issuedDate) : new Date(),
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          credentialReference: input.credentialReference ?? null,
          status: CREDENTIAL_STATUS.ISSUED,
          issuedByMembershipId: guard.membership.id,
        },
        include: { issuerOrganization: true },
      })
      await appendOrgAudit(tx, {
        organizationId: org.id,
        entityType: 'CREDENTIAL',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'CREDENTIAL_ISSUED',
        detail: `credentialName=${created.credentialName.slice(0, 80)}`,
      })
      await appendCareerAudit(tx, {
        entityType: 'CREDENTIAL',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'CREDENTIAL_ISSUED',
        detail: `org=${org.slug}`,
      })
      return created
    })
    return NextResponse.json({ credential: toCredentialDTO(credential) }, { status: 201 })
  } catch (err) {
    console.error('[api/career/credentials/issue POST]', err)
    return NextResponse.json({ error: 'Could not issue the credential.' }, { status: 500 })
  }
}
