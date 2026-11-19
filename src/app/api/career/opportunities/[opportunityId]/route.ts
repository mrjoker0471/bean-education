// ─── Phase 7: Opportunity detail (public view of published listings) ─────────
// Unpublished listings return 404 (never 403 — no existence oracle). The
// employer's own members may view their listing in any state through the
// employer management endpoint instead.

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { toPublicOpportunityDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ opportunityId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { opportunityId } = await params
    const opportunity = await db.careerOpportunity.findUnique({
      where: { id: opportunityId },
      include: { organization: true },
    })
    if (!opportunity || opportunity.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    return NextResponse.json(
      { opportunity: toPublicOpportunityDTO(opportunity) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/opportunities/[opportunityId] GET]', err)
    return NextResponse.json({ error: 'Could not load the opportunity.' }, { status: 500 })
  }
}
