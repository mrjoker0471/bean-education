// ─── Phase 7: Employer opportunity edit / submit-for-review ──────────────────
// PATCH edits a listing (own organization only). Status moves are scoped:
// DRAFT → PENDING_REVIEW (submit), PUBLISHED → PAUSED/CLOSED. Only admin
// moderation can reach PUBLISHED or REJECTED. Every transition is audited.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, OPPORTUNITY_STATUS } from '@/lib/career'
import { ORG_EMPLOYER_ROLES, requireOrgRole } from '@/lib/institution'
import { opportunityUpdateSchema } from '@/lib/career-schema'
import { toPublicOpportunityDTO } from '@/lib/career-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ employerOpportunityId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { employerOpportunityId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const opportunity = await db.careerOpportunity.findUnique({
      where: { id: employerOpportunityId },
      include: { organization: true },
    })
    if (!opportunity) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

    const guard = await requireOrgRole(student.id, opportunity.employerOrganizationId, ORG_EMPLOYER_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = opportunityUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid opportunity details' }, { status: 400 })
    const input = parsed.data

    // Employer-side status transitions (admin-only outcomes stay admin-only).
    if (input.status) {
      const legal: Record<string, string[]> = {
        [OPPORTUNITY_STATUS.DRAFT]: [],
        [OPPORTUNITY_STATUS.PENDING_REVIEW]: [OPPORTUNITY_STATUS.DRAFT, OPPORTUNITY_STATUS.PAUSED, OPPORTUNITY_STATUS.REJECTED],
        [OPPORTUNITY_STATUS.PAUSED]: [OPPORTUNITY_STATUS.PUBLISHED],
        [OPPORTUNITY_STATUS.CLOSED]: [OPPORTUNITY_STATUS.DRAFT, OPPORTUNITY_STATUS.PENDING_REVIEW, OPPORTUNITY_STATUS.PUBLISHED, OPPORTUNITY_STATUS.PAUSED],
        // PUBLISHED and REJECTED are moderation outcomes — employers cannot set them.
      }
      // PUBLISHED and REJECTED are moderation outcomes — the Zod schema
      // already refuses them here, so employers can never set them.
      if (!(legal[input.status] ?? []).includes(opportunity.status)) {
        return NextResponse.json({ error: `Cannot move a ${opportunity.status.toLowerCase()} listing to ${input.status.toLowerCase()}.` }, { status: 409 })
      }
    }
    if (input.applicationDeadline && new Date(input.applicationDeadline).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'The application deadline must be in the future.' }, { status: 400 })
    }

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.careerOpportunity.update({
        where: { id: opportunity.id },
        data: {
          title: input.title ?? undefined,
          description: input.description ?? undefined,
          responsibilities: input.responsibilities ?? undefined,
          requiredSkills: input.requiredSkills ? JSON.stringify(input.requiredSkills) : undefined,
          preferredSkills: input.preferredSkills ? JSON.stringify(input.preferredSkills) : undefined,
          location: input.location ?? undefined,
          workMode: input.workMode ?? undefined,
          opportunityType: input.opportunityType ?? undefined,
          compensationDescription: input.compensationDescription ?? undefined,
          applicationDeadline: input.applicationDeadline === undefined ? undefined : input.applicationDeadline ? new Date(input.applicationDeadline) : null,
          eligibilityDescription: input.eligibilityDescription ?? undefined,
          status: input.status ?? undefined,
        },
        include: { organization: true },
      })
      await appendCareerAudit(tx, {
        entityType: 'OPPORTUNITY',
        entityId: row.id,
        actorId: student.id,
        actorRole: student.role,
        action: input.status ? `OPPORTUNITY_${input.status}` : 'OPPORTUNITY_EDITED',
      })
      return row
    })
    return NextResponse.json({ opportunity: toPublicOpportunityDTO(updated) })
  } catch (err) {
    console.error('[api/career/employer/opportunities/[employerOpportunityId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the opportunity.' }, { status: 500 })
  }
}
