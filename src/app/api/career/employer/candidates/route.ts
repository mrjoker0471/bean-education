// ─── Phase 7: Candidate discovery (consent + adult-eligibility gated) ────────
// GET searches DISCOVERABLE career profiles of APPROVED-eligible students.
// Safeguards (all server-enforced):
//   • caller must hold an employer role in an APPROVED EMPLOYER organization
//   • rate-limited per recruiter (rolling 24 h), paginated (≤ 20/page)
//   • every search is audited (CANDIDATE_SEARCH) WITHOUT recording the query
//     string — queries are never logged with personal data
//   • DTO exposes ONLY candidate-approved fields; never account ids, emails,
//     phone numbers or private learning data
//   • no AI ranking or scoring — plain filtered list, newest first

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendCareerAudit,
  CAREER_VISIBILITY,
  CANDIDATE_PAGE_SIZE_DEFAULT,
  CANDIDATE_PAGE_SIZE_MAX,
  ELIGIBILITY_STATUS,
  countRecentCareer,
  careerRateLimited,
  MAX_QUERY_LENGTH,
} from '@/lib/career'
import { isApprovedEmployerOrg, ORG_EMPLOYER_ROLES, requireOrgRole } from '@/lib/institution'
import { toDiscoverableCandidateDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const organizationId = (new URL(req.url).searchParams.get('organizationId') ?? '').slice(0, 64)
    const guard = await requireOrgRole(student.id, organizationId, ORG_EMPLOYER_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const org = await db.organization.findUnique({ where: { id: organizationId } })
    if (!org || !isApprovedEmployerOrg(org)) {
      return NextResponse.json({ error: 'Candidate discovery is available to verified employer organizations only.' }, { status: 403 })
    }

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const roleType = (url.searchParams.get('roleType') ?? '').slice(0, 60).trim()
    const skill = (url.searchParams.get('skill') ?? '').slice(0, 60).trim()
    const location = (url.searchParams.get('location') ?? '').slice(0, 60).trim()
    const page = Math.max(1, Math.min(200, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(1, Math.min(CANDIDATE_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || CANDIDATE_PAGE_SIZE_DEFAULT))

    const recent = await countRecentCareer('candidateSearch', student.id, new Date())
    if (careerRateLimited('CANDIDATE_SEARCHES_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Discovery search limit reached for today — please try again tomorrow.' }, { status: 429 })
    }

    const where = {
      visibility: CAREER_VISIBILITY.DISCOVERABLE,
      student: { careerEligibilityReview: { status: ELIGIBILITY_STATUS.APPROVED } },
      ...(skill ? { preferredSkills: { contains: skill } } : {}),
      ...(q ? { OR: [{ headline: { contains: q } }, { summary: { contains: q } }, { preferredSkills: { contains: q } }] } : {}),
    }

    // Discovery list: eligibility is re-fetched per row below (defense in
    // depth — the join filter is the primary gate; the map re-checks).
    const [profiles, total] = await Promise.all([
      db.careerProfile.findMany({
        where,
        include: {
          student: {
            select: {
              careerEligibilityReview: { select: { status: true } },
              careerSkills: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
              careerProjects: { where: { visibility: 'SHARED', status: 'ACTIVE' } },
              careerCredentials: { where: { portfolioShared: true, status: 'ISSUED' }, include: { issuerOrganization: { select: { id: true, name: true, displayName: true, verificationStatus: true } } } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.careerProfile.count({ where }),
    ])

    const candidates = profiles
      .filter(p => p.student.careerEligibilityReview?.status === ELIGIBILITY_STATUS.APPROVED)
      .map(p => toDiscoverableCandidateDTO(p))

    // Audit WITHOUT the query string — only that a search happened.
    await appendCareerAudit(db, {
      entityType: 'CANDIDATE_SEARCH',
      entityId: organizationId,
      actorId: student.id,
      actorRole: `ORG_MEMBER:${guard.membership.role}`,
      action: 'CANDIDATE_SEARCH',
      detail: null,
    })

    return NextResponse.json(
      { candidates, total, page, pageSize },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/employer/candidates GET]', err)
    return NextResponse.json({ error: 'Could not search candidates.' }, { status: 500 })
  }
}
