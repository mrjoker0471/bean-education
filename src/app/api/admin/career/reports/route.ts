// ─── Phase 7: Admin — career safety reports queue ────────────────────────────
// GET lists safety reports (status filter). Decisions are recorded via the
// dynamic subpath route. Report descriptions and resolution notes stay
// admin-private.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const status = (url.searchParams.get('status') ?? 'OPEN').toUpperCase()
    const allowed = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED', 'ALL']
    const where = allowed.includes(status) && status !== 'ALL' ? { status } : {}

    const reports = await db.careerSafetyReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ reports, total: reports.length }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/admin/career/reports GET]', err)
    return NextResponse.json({ error: 'Could not load safety reports.' }, { status: 500 })
  }
}
