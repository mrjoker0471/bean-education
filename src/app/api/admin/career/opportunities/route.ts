// ─── Phase 7: Admin — opportunity moderation queue ───────────────────────────
// GET lists listings for the moderation workbench, newest activity first.
// Status filter: one of PENDING_REVIEW | PUBLISHED | PAUSED | REJECTED |
// CLOSED | DRAFT (default PENDING_REVIEW) or ALL. Evidence per row is the
// privacy-safe public listing DTO plus the employer organization's display
// name and verification status — never employer-private notes.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { db } from '@/lib/db'
import { OPPORTUNITY_STATUS } from '@/lib/career'
import { toPublicOpportunityDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QUEUE_PAGE_SIZE = 100

const LISTING_STATUSES = Object.values(OPPORTUNITY_STATUS)

export async function GET(req: Request) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const statusRaw = (url.searchParams.get('status') ?? '').trim().toUpperCase()
    if (statusRaw && statusRaw !== 'ALL' && !LISTING_STATUSES.includes(statusRaw as (typeof OPPORTUNITY_STATUS)[keyof typeof OPPORTUNITY_STATUS])) {
      return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 })
    }

    const where = statusRaw && statusRaw !== 'ALL' ? { status: statusRaw } : {}
    const [rows, total] = await Promise.all([
      db.careerOpportunity.findMany({
        where,
        include: { organization: true },
        orderBy: { updatedAt: 'desc' },
        take: QUEUE_PAGE_SIZE,
      }),
      db.careerOpportunity.count({ where }),
    ])

    return NextResponse.json(
      { opportunities: rows.map(toPublicOpportunityDTO), total },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/admin/career/opportunities GET]', err)
    return NextResponse.json({ error: 'Could not load the moderation queue.' }, { status: 500 })
  }
}
