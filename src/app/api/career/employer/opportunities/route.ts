// ─── Phase 7: Employer opportunities — create / manage ───────────────────────
// GET lists the caller's organization's own listings (any status).
// POST creates a listing for an APPROVED EMPLOYER organization (OWNER/ADMIN/
// RECRUITER only) as DRAFT. Submission for admin review is a separate action.
// Employers are always scoped to their own organization.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, OPPORTUNITY_STATUS } from '@/lib/career'
import { isApprovedEmployerOrg, ORG_EMPLOYER_ROLES, requireOrgRole } from '@/lib/institution'
import { opportunityCreateSchema } from '@/lib/career-schema'
import { toPublicOpportunityDTO } from '@/lib/career-dto'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const listSchema = z.object({
  organizationId: z.string().min(6).max(64),
})

export async function GET(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = listSchema.safeParse({ organizationId: new URL(req.url).searchParams.get('organizationId') ?? '' })
    if (!parsed.success) return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })

    const guard = await requireOrgRole(student.id, parsed.data.organizationId, ORG_EMPLOYER_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const opportunities = await db.careerOpportunity.findMany({
      where: { employerOrganizationId: parsed.data.organizationId },
      include: { organization: true },
      orderBy: { updatedAt: 'desc' },
    })
    const counts = {
      draft: opportunities.filter(o => o.status === 'DRAFT').length,
      pending: opportunities.filter(o => o.status === 'PENDING_REVIEW').length,
      published: opportunities.filter(o => o.status === 'PUBLISHED').length,
      closed: opportunities.filter(o => ['CLOSED', 'REJECTED', 'PAUSED'].includes(o.status)).length,
    }
    return NextResponse.json(
      { opportunities: opportunities.map(toPublicOpportunityDTO), counts },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/employer/opportunities GET]', err)
    return NextResponse.json({ error: 'Could not load your listings.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = typeof body?.['organizationId'] === 'string' ? body['organizationId'] : ''
    const guard = await requireOrgRole(student.id, organizationId, ORG_EMPLOYER_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const org = await db.organization.findUnique({ where: { id: organizationId } })
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    if (!isApprovedEmployerOrg(org)) {
      return NextResponse.json(
        { error: 'Only BEAN-verified employer organizations can create opportunities.' },
        { status: 403 },
      )
    }

    const { organizationId: _omit, ...fields } = body ?? {}
    const parsed = opportunityCreateSchema.safeParse(fields)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid opportunity details' }, { status: 400 })
    const input = parsed.data
    if (input.applicationDeadline && new Date(input.applicationDeadline).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'The application deadline must be in the future.' }, { status: 400 })
    }

    const opportunity = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.careerOpportunity.create({
        data: {
          employerOrganizationId: org.id,
          title: input.title,
          description: input.description,
          responsibilities: input.responsibilities ?? null,
          requiredSkills: JSON.stringify(input.requiredSkills ?? []),
          preferredSkills: JSON.stringify(input.preferredSkills ?? []),
          location: input.location ?? null,
          workMode: input.workMode ?? null,
          opportunityType: input.opportunityType,
          compensationDescription: input.compensationDescription ?? null,
          applicationDeadline: input.applicationDeadline ? new Date(input.applicationDeadline) : null,
          eligibilityDescription: input.eligibilityDescription ?? null,
          status: OPPORTUNITY_STATUS.DRAFT,
        },
        include: { organization: true },
      })
      await appendCareerAudit(tx, {
        entityType: 'OPPORTUNITY',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'OPPORTUNITY_CREATED',
        detail: `org=${org.slug},type=${input.opportunityType}`,
      })
      return created
    })
    return NextResponse.json({ opportunity: toPublicOpportunityDTO(opportunity) }, { status: 201 })
  } catch (err) {
    console.error('[api/career/employer/opportunities POST]', err)
    return NextResponse.json({ error: 'Could not create the opportunity.' }, { status: 500 })
  }
}
