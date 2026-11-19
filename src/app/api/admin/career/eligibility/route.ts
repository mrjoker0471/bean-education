// ─── Phase 7: Admin — adult-eligibility reviews queue (safeguarding) ──────────
// GET lists eligibility requests (PENDING_REVIEW default). Decisions are
// recorded via the dynamic subpath route. No identity documents are collected
// or stored anywhere in this flow — the decision is based on the documented,
// privacy-minimizing review process.

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
    const status = (url.searchParams.get('status') ?? 'PENDING_REVIEW').toUpperCase()
    const allowed = ['PENDING_REVIEW', 'APPROVED', 'DENIED', 'NOT_ELIGIBLE', 'ALL']
    const where = allowed.includes(status) && status !== 'ALL' ? { status } : {}

    const reviews = await db.careerEligibilityReview.findMany({
      where,
      include: { student: { select: { displayName: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return NextResponse.json(
      {
        reviews: reviews.map(r => ({
          id: r.id,
          student: { displayName: r.student.displayName },
          status: r.status,
          requestedAt: r.requestedAt?.toISOString() ?? null,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          decisionReason: r.decisionReason,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/admin/career/eligibility GET]', err)
    return NextResponse.json({ error: 'Could not load eligibility reviews.' }, { status: 500 })
  }
}
