// ─── Phase 7: Admin — adult-eligibility review queue (safeguarding) ──────────
// GET lists adult-eligibility reviews for the safeguarding workbench, pending
// requests first. Status filter: PENDING_REVIEW | APPROVED | DENIED |
// NOT_ELIGIBLE (default PENDING_REVIEW) or ALL. The row is privacy-minimizing:
// display name plus review metadata only — BEAN never collects identity
// documents or numbers for this review. Decisions happen on the per-review
// decision route and are audited there.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REVIEW_STATUSES = ['NOT_ELIGIBLE', 'PENDING_REVIEW', 'APPROVED', 'DENIED'] as const
const QUEUE_PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const statusRaw = (req.nextUrl.searchParams.get('status') ?? '').trim().toUpperCase()
    if (statusRaw && statusRaw !== 'ALL' && !(REVIEW_STATUSES as readonly string[]).includes(statusRaw)) {
      return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 })
    }

    const where = statusRaw && statusRaw !== 'ALL' ? { status: statusRaw } : {}
    const rows = await db.careerEligibilityReview.findMany({
      where,
      include: { student: { select: { displayName: true } } },
      orderBy: [{ requestedAt: 'desc' }, { updatedAt: 'desc' }],
      take: QUEUE_PAGE_SIZE,
    })

    return NextResponse.json(
      {
        reviews: rows.map(r => ({
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
