// ─── Phase 7: Employer applicant list (own opportunities only) ───────────────
// GET returns applications for ONE of the caller's organization's own
// opportunities, with optional status filter and pagination. The applicant
// view is built from the submission-time snapshot — contact details appear
// ONLY with explicit consent, employerNotes are included for the employer's
// private record (this DTO is never used in student responses), and no account
// ids/emails of the platform identity are exposed beyond the consented contact.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { APPLICATION_STATUS, EMPLOYER_PAGE_SIZE_DEFAULT, EMPLOYER_PAGE_SIZE_MAX, MAX_PAGE_NUMBER } from '@/lib/career'
import { ORG_EMPLOYER_ROLES, requireOrgRole } from '@/lib/institution'
import { toEmployerApplicationDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ employerOpportunityId: string }> }

const APPLICATION_STATUSES = Object.values(APPLICATION_STATUS)

export async function GET(req: NextRequest, { params }: Params) {
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

    // Optional filters: status (enum or ALL, default ALL) + pagination.
    const url = new URL(req.url)
    const statusRaw = (url.searchParams.get('status') ?? '').trim().toUpperCase()
    if (statusRaw && statusRaw !== 'ALL' && !APPLICATION_STATUSES.includes(statusRaw as (typeof APPLICATION_STATUS)[keyof typeof APPLICATION_STATUS])) {
      return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 })
    }
    const page = Math.max(1, Math.min(MAX_PAGE_NUMBER, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(
      1,
      Math.min(EMPLOYER_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || EMPLOYER_PAGE_SIZE_DEFAULT),
    )

    const scopeWhere = { opportunityId: opportunity.id }
    const where = statusRaw && statusRaw !== 'ALL' ? { ...scopeWhere, status: statusRaw } : scopeWhere

    // The per-status breakdown always covers EVERY applicant of the
    // opportunity (never the filtered slice) so pipeline tabs keep their totals.
    const [allRows, applications, total] = await Promise.all([
      db.careerApplication.findMany({ where: scopeWhere, select: { status: true } }),
      db.careerApplication.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.careerApplication.count({ where }),
    ])
    const counts: Record<string, number> = {}
    for (const a of allRows) counts[a.status] = (counts[a.status] ?? 0) + 1

    return NextResponse.json(
      {
        opportunity: { id: opportunity.id, title: opportunity.title },
        applications: applications.map(toEmployerApplicationDTO),
        counts,
        total,
        page,
        pageSize,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/employer/opportunities/[employerOpportunityId]/applications GET]', err)
    return NextResponse.json({ error: 'Could not load applicants.' }, { status: 500 })
  }
}
