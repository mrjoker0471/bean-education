// ─── BEAN Classroom Intelligence (CI-5H): audit-history export ────────────────
// GET /api/admin/ci5/audit-export — machine-readable export of every CI-5
// append-only ledger (reviewer lifecycle, assignments + events, pack reviews,
// language measurements/reviews/statuses, report audits, renewal demands).
// Read-only; retention policy follows the existing audit-retention rules.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { buildAuditExport } from '@/lib/ci/fleet/re-review'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const [reviewerEvents, reviewerProfiles, assignments, assignmentEvents, packReviews, languageMeasurements, languageReviews, languageStatuses, reportAudits, renewalDemands] = await Promise.all([
      db.expertReviewerEvent.findMany({ orderBy: { createdAt: 'asc' } }),
      db.expertReviewerProfile.findMany({ orderBy: { createdAt: 'asc' } }),
      db.expertReviewAssignment.findMany({ orderBy: { createdAt: 'asc' } }),
      db.expertReviewAssignmentEvent.findMany({ orderBy: { createdAt: 'asc' } }),
      db.classroomPackReview.findMany({ orderBy: { createdAt: 'asc' } }),
      db.languageBenchmarkMeasurement.findMany({ orderBy: { createdAt: 'asc' } }),
      db.languageCapabilityReview.findMany({ orderBy: { createdAt: 'asc' } }),
      db.languageCapabilityStatus.findMany({ orderBy: { updatedAt: 'asc' } }),
      db.classroomReportAuditReview.findMany({ orderBy: { createdAt: 'asc' } }),
      db.expertReviewRenewalDemand.findMany({ orderBy: { createdAt: 'asc' } }),
    ])
    const exportPayload = buildAuditExport({
      reviewerEvents, reviewerProfiles, assignments, assignmentEvents,
      packReviews, languageMeasurements, languageReviews, languageStatuses,
      reportAudits, renewalDemands,
    })
    return NextResponse.json(exportPayload, {
      headers: { 'content-disposition': `attachment; filename="bean-ci5-audit-${new Date().toISOString().slice(0, 10)}.json"` },
    })
  } catch (err) {
    console.error('[api/admin/ci5/audit-export GET]', err)
    return NextResponse.json({ error: 'Could not build the audit export — please try again.' }, { status: 500 })
  }
}
