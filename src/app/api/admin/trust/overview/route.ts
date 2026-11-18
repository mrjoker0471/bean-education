// ─── BEAN Trust & Quality (Phase 6): admin overview ──────────────────────────
// GET /api/admin/trust/overview — ADMIN-guarded counters for the Trust Center
// dashboard: new complaints, open investigations, open sensitive (safeguarding)
// cases, flagged reviews, hidden reviews, pending appeals, active restrictions.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import {
  COMPLAINT_STATUS,
  OPEN_COMPLAINT_STATUSES,
  ENFORCING_ACTIONS,
  evaluateTrustState,
  REVIEW_STATUS,
  OPEN_APPEAL_STATUSES,
} from '@/lib/trust'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const now = new Date()
    const [
      newComplaints,
      openInvestigations,
      sensitiveOpen,
      flaggedReviews,
      hiddenReviews,
      pendingAppeals,
      activeActionRows,
    ] = await Promise.all([
      db.teachComplaint.count({ where: { status: COMPLAINT_STATUS.OPEN } }),
      db.teachComplaint.count({
        where: {
          status: { in: OPEN_COMPLAINT_STATUSES.filter((s) => s !== COMPLAINT_STATUS.OPEN) },
        },
      }),
      db.teachComplaint.count({
        where: { isSensitive: true, status: { in: [...OPEN_COMPLAINT_STATUSES] } },
      }),
      db.classReview.count({ where: { status: REVIEW_STATUS.FLAGGED } }),
      db.classReview.count({ where: { status: REVIEW_STATUS.HIDDEN } }),
      db.teachAppeal.count({ where: { status: { in: [...OPEN_APPEAL_STATUSES] } } }),
      db.trustAction.findMany({
        where: { isActive: true, action: { in: [...ENFORCING_ACTIONS] } },
        select: { action: true, isActive: true, startsAt: true, endsAt: true },
      }),
    ])

    // Expiry evaluated at read time — an expired temporary restriction no
    // longer counts as active even before any admin touches it.
    const activeRestrictions = activeActionRows.filter(
      (r) => evaluateTrustState([r], now).restricted,
    ).length

    return NextResponse.json({
      newComplaints,
      openInvestigations,
      sensitiveOpen,
      flaggedReviews,
      hiddenReviews,
      pendingAppeals,
      activeRestrictions,
    })
  } catch (err) {
    console.error('[api/admin/trust/overview GET]', err)
    return NextResponse.json({ error: 'Could not load the trust overview — please try again.' }, { status: 500 })
  }
}
