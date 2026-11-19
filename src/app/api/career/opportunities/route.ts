// ─── Phase 7: Opportunity browse (public, admin-moderated only) ──────────────
// GET lists PUBLISHED opportunities with pagination and bounded search. Every
// listing identifies its organization truthfully (name + verification
// status). Closed/expired listings never accept applications (enforced again
// at apply time).

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { MAX_QUERY_LENGTH, OPPORTUNITIES_PAGE_SIZE_DEFAULT, OPPORTUNITIES_PAGE_SIZE_MAX, OPPORTUNITY_TYPES } from '@/lib/career'
import { toPublicOpportunityDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const type = (url.searchParams.get('type') ?? '').trim().toUpperCase()
    const workMode = (url.searchParams.get('workMode') ?? '').slice(0, 30).trim()
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(
      1,
      Math.min(OPPORTUNITIES_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || OPPORTUNITIES_PAGE_SIZE_DEFAULT),
    )

    const now = new Date()
    const where = {
      status: 'PUBLISHED' as const,
      OR: [{ applicationDeadline: null }, { applicationDeadline: { gt: now } }],
      ...(OPPORTUNITY_TYPES.includes(type as (typeof OPPORTUNITY_TYPES)[number]) ? { opportunityType: type } : {}),
      ...(workMode ? { workMode: { contains: workMode } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { organization: { displayName: { contains: q } } },
              { organization: { name: { contains: q } } },
            ],
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      db.careerOpportunity.findMany({
        where,
        include: { organization: true },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.careerOpportunity.count({ where }),
    ])

    return NextResponse.json(
      { opportunities: rows.map(toPublicOpportunityDTO), total, page, pageSize },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/opportunities GET]', err)
    return NextResponse.json({ error: 'Could not load opportunities.' }, { status: 500 })
  }
}
