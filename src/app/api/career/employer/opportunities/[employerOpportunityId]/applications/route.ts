// ─── Phase 7: Employer applicant list (own opportunities only) ───────────────
// GET returns applications for ONE of the caller's organization's own
// opportunities. The applicant view is built from the submission-time
// snapshot — contact details appear ONLY with explicit consent, employerNotes
// are included for the employer's private record (this DTO is never used in
// student responses), and no account ids/emails of the platform identity are
// exposed beyond the consented contact.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { ORG_EMPLOYER_ROLES, requireOrgRole } from '@/lib/institution'
import { toEmployerApplicationDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ employerOpportunityId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { employerOpportunityId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const opportunity = await db.careerOpportunity.findUnique({
      where: { id: employerOpportunityId },
      select: { id: true, employerOrganizationId: true, title: true },
    })
    if (!opportunity) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })

    const guard = await requireOrgRole(student.id, opportunity.employerOrganizationId, ORG_EMPLOYER_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const applications = await db.careerApplication.findMany({
      where: { opportunityId: opportunity.id },
      orderBy: { submittedAt: 'desc' },
    })
    const counts: Record<string, number> = {}
    for (const a of applications) counts[a.status] = (counts[a.status] ?? 0) + 1

    return NextResponse.json(
      {
        opportunity: { id: opportunity.id, title: opportunity.title },
        applications: applications.map(toEmployerApplicationDTO),
        counts,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/employer/opportunities/[employerOpportunityId]/applications GET]', err)
    return NextResponse.json({ error: 'Could not load applicants.' }, { status: 500 })
  }
}
