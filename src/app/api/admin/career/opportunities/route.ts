// ─── Phase 7: Admin — opportunity moderation queue ───────────────────────────
// GET lists opportunities by status (PENDING_REVIEW default). Every row feeds
// the moderation queue; decisions are recorded via the dynamic subpath route.
// Moderation never touches teacher trust records.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { db } from '@/lib/db'
import { toPublicOpportunityDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const status = (url.searchParams.get('status') ?? 'PENDING_REVIEW').toUpperCase()
    const allowed = ['PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'CLOSED', 'REJECTED', 'DRAFT', 'ALL']
    const where = allowed.includes(status) && status !== 'ALL' ? { status } : {}

    const [opportunities, total] = await Promise.all([
      db.careerOpportunity.findMany({
        where,
        include: { organization: true },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      db.careerOpportunity.count({ where }),
    ])
    return NextResponse.json(
      { opportunities: opportunities.map(toPublicOpportunityDTO), total },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/admin/career/opportunities GET]', err)
    return NextResponse.json({ error: 'Could not load the moderation queue.' }, { status: 500 })
  }
}
