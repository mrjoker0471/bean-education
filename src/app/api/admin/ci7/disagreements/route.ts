// ─── BEAN Classroom Intelligence (CI-7E): disagreement analysis ledger ────────
// GET  /api/admin/ci7/disagreements — the findings view: every recorded
//      disagreement analysis (append-only rows bound to exact pack versions +
//      checksums) plus the aggregate findings summary. Honest zero state when
//      nothing has been recorded.
// POST — record a NEW analysis of a GENUINE disagreement. The review set is
//      loaded server-side from the authoritative ClassroomPackReview ledger;
//      decisions are copied from the real rows (request bodies never supply
//      them); a real disagreement must exist; corrections of an analysis are
//      NEW rows, never edits.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import {
  buildFindingsSummary,
  ci7DisagreementDbFromPrisma,
  recordDisagreementAnalysis,
  type Ci7DisagreementReviewRow,
} from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const packId = url.searchParams.get('packId') ?? undefined
    const rows = await db.ci7DisagreementAnalysis.findMany({
      where: packId ? { packId } : undefined,
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({
      summary: buildFindingsSummary(rows),
      analyses: rows.map((r) => ({
        id: r.id,
        packId: r.packId,
        packVersion: r.packVersion,
        packChecksum: r.packChecksum,
        classification: r.classification,
        decisions: JSON.parse(r.decisionsJson ?? '[]'),
        rubricDimensions: JSON.parse(r.rubricDimensionsJson ?? '[]'),
        evidenceCited: JSON.parse(r.evidenceCitedJson ?? '[]'),
        adjudicationRef: r.adjudicationRef,
        adjudicationOutcome: r.adjudicationOutcome,
        correctionRequired: r.correctionRequired,
        correctionApplied: r.correctionApplied,
        packVersionChanged: r.packVersionChanged,
        reReviewRequired: r.reReviewRequired,
        analysis: r.analysis,
        recordedByAdminName: r.recordedByAdminName,
        createdAt: r.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/admin/ci7/disagreements GET]', err)
    return NextResponse.json({ error: 'Could not load disagreement analyses — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const packId = typeof body.packId === 'string' ? body.packId : ''
    if (!packId) return NextResponse.json({ error: 'packId is required' }, { status: 400 })
    // the review set comes from the AUTHORITATIVE ledger — never from the body
    const reviews = await db.classroomPackReview.findMany({
      where: { packId },
      orderBy: { createdAt: 'asc' },
    })
    const reviewRows: Ci7DisagreementReviewRow[] = reviews.map((r) => ({
      id: r.id,
      packId: r.packId,
      packVersion: r.packVersion,
      packChecksum: r.packChecksum,
      decision: r.decision,
      reviewerStudentId: r.reviewerStudentId,
      reviewerName: r.reviewerName,
      rationale: r.rationale,
      evidence: r.evidence,
      createdAt: r.createdAt,
    }))
    const result = await recordDisagreementAnalysis(
      ci7DisagreementDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      body,
      reviewRows,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ analysisId: result.analysisId }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci7/disagreements POST]', err)
    return NextResponse.json({ error: 'Could not record the disagreement analysis — please try again.' }, { status: 500 })
  }
}
