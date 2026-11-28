// ─── Phase 7: Opportunity browse (public, admin-moderated only) ──────────────
// GET lists PUBLISHED opportunities of APPROVED + active employer organizations
// with pagination and bounded search (q/type/workMode/location/skill/employer/
// deadline window). Every listing identifies its organization truthfully
// (name + verification status). Closed/expired listings never accept
// applications (enforced again at apply time).

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  BROWSE_FILTER_MAX,
  MAX_PAGE_NUMBER,
  MAX_QUERY_LENGTH,
  OPPORTUNITIES_PAGE_SIZE_DEFAULT,
  OPPORTUNITIES_PAGE_SIZE_MAX,
  OPPORTUNITY_TYPES,
} from '@/lib/career'
import { toPublicOpportunityDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Accepts "2026-03-01" and full ISO timestamps; anything else is invalid. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

type DeadlineFilter = { valid: true; date: Date } | { valid: false } | null

function parseDeadlineFilter(raw: string | null): DeadlineFilter {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (value.length > 40 || !ISO_DATE_PATTERN.test(value)) return { valid: false }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { valid: false }
  return { valid: true, date }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const type = (url.searchParams.get('type') ?? '').trim().toUpperCase()
    const workMode = (url.searchParams.get('workMode') ?? '').slice(0, 30).trim()
    const location = (url.searchParams.get('location') ?? '').slice(0, BROWSE_FILTER_MAX).trim()
    const skill = (url.searchParams.get('skill') ?? '').slice(0, BROWSE_FILTER_MAX).trim()
    const employer = (url.searchParams.get('employer') ?? '').slice(0, BROWSE_FILTER_MAX).trim()
    const deadlineBefore = parseDeadlineFilter(url.searchParams.get('deadlineBefore'))
    const deadlineAfter = parseDeadlineFilter(url.searchParams.get('deadlineAfter'))
    if (deadlineBefore?.valid === false || deadlineAfter?.valid === false) {
      return NextResponse.json({ error: 'Invalid deadline filter — use an ISO date (YYYY-MM-DD).' }, { status: 400 })
    }
    const deadlineBeforeDate = deadlineBefore && deadlineBefore.valid ? deadlineBefore.date : null
    const deadlineAfterDate = deadlineAfter && deadlineAfter.valid ? deadlineAfter.date : null
    const page = Math.max(1, Math.min(MAX_PAGE_NUMBER, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(
      1,
      Math.min(OPPORTUNITIES_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || OPPORTUNITIES_PAGE_SIZE_DEFAULT),
    )

    const now = new Date()
    // Only listings of BEAN-verified, active employer organizations stay visible
    // (a suspended or archived org's listings disappear from public browse).
    const organizationFilter = employer
      ? {
          verificationStatus: 'APPROVED',
          isActive: true,
          OR: [{ name: { contains: employer } }, { displayName: { contains: employer } }],
        }
      : { verificationStatus: 'APPROVED', isActive: true }

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
      ...(location ? { location: { contains: location } } : {}),
      ...(skill ? { preferredSkills: { contains: skill } } : {}),
      organization: organizationFilter,
      ...(deadlineBeforeDate || deadlineAfterDate
        ? {
            applicationDeadline: {
              ...(deadlineBeforeDate ? { lte: deadlineBeforeDate } : {}),
              ...(deadlineAfterDate ? { gte: deadlineAfterDate } : {}),
            },
          }
        : {}),
    }

    const [rows, total] = await Promise.all([
      db.careerOpportunity.findMany({
        where,
        include: { organization: true },
        // Stable pagination: publishedAt DESC remains the primary order, id ASC
        // is the deterministic unique tiebreaker so records sharing an exact
        // publishedAt can never reorder across pages. Nothing else changes.
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
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
