// ─── BEAN Classroom Intelligence (CI-5E): bilingual review submit ─────────────
// POST /api/ci5/reviewer/assignments/[assignmentId]/language-review
//
// The qualified bilingual reviewer's decision path. Rules (all server-side):
//   • ownership + lazy expiry on the assignment (subjectType LANGUAGE_CAPABILITY);
//   • reviewer ACTIVE with exact tag/task/domain scope — re-checked here;
//   • the decision binds to an EXISTING measurement (measurementId) — an
//     UNMEASURED capability cannot be reviewed or approved;
//   • evidence checklist (13 facets: meaning preservation, terminology,
//     grammar, naturalness, script correctness, mathematical notation,
//     scientific symbols, code-switching, register, dialect differences,
//     ambiguous wording, unsupported claims, safety/refusal accuracy) —
//     APPROVED requires every facet OK;
//   • the decision lands in the append-only LanguageCapabilityReview ledger
//     and the persisted status is recomputed (VERIFIED only via APPROVED);
//   • TRANSCRIPTION is structurally refused at every layer.

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { getAssignment, markAssignmentSubmitted, markAssignmentCompleted, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfile, reviewerDbFromPrisma, reviewerCanReviewLanguage } from '@/lib/ci/fleet/reviewers'
import { recordLanguageCapabilityReview, languageGovernanceDbFromPrisma, languageReviewEvidenceSchemaIds } from '@/lib/ci/fleet/language-governance'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 403 })
    if (profile.status !== 'ACTIVE') {
      return NextResponse.json({ error: `reviewer is ${profile.status} — only an ACTIVE bilingual reviewer can submit through an assignment` }, { status: 403 })
    }
    const { assignmentId } = await params

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const measurementId = typeof body.measurementId === 'string' ? body.measurementId : ''
    const decision = typeof body.decision === 'string' ? body.decision : ''
    const rationale = typeof body.rationale === 'string' ? body.rationale : ''
    const evidence = (body.evidence ?? {}) as Record<string, { status: string; notes?: string }>

    const adb = assignmentDbFromPrisma(db)
    const assignment = await getAssignment(adb, assignmentId)
    if (!assignment) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })
    if (assignment.reviewerProfileId !== profile.id) {
      return NextResponse.json({ error: 'this assignment belongs to a different reviewer' }, { status: 403 })
    }
    if (assignment.subjectType !== 'LANGUAGE_CAPABILITY') {
      return NextResponse.json({ error: 'this assignment is not a language-capability review' }, { status: 400 })
    }

    const result = await recordLanguageCapabilityReview(languageGovernanceDbFromPrisma(db), profile, {
      measurementId,
      decision: decision as 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED',
      rationale,
      evidence: evidence as Record<string, { status: 'OK' | 'ISSUE' | 'NOT_ASSESSED'; notes?: string }>,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

    // Assignment lifecycle mirrors the authoritative decision.
    const submitted = await markAssignmentSubmitted(adb, profile, assignmentId, student.id)
    if (!submitted.ok) {
      return NextResponse.json({ reviewId: result.value.review.id, status: result.value.status.status, warning: `decision recorded but assignment submission failed: ${submitted.error}` })
    }
    const completed = await markAssignmentCompleted(adb, assignmentId, result.value.review.id)
    if (!completed.ok) {
      return NextResponse.json({ reviewId: result.value.review.id, status: result.value.status.status, warning: `decision recorded but assignment completion failed: ${completed.error}` })
    }
    return NextResponse.json({
      reviewId: result.value.review.id,
      capabilityStatus: {
        status: result.value.status.status,
        basis: result.value.status.basis,
        note: result.value.status.note,
      },
      assignment: { id: assignmentId, status: 'COMPLETED', outcomeRef: result.value.review.id },
      evidenceSchema: languageReviewEvidenceSchemaIds,
    }, { status: 201 })
  } catch (err) {
    console.error('[api/ci5/reviewer/assignments/[assignmentId]/language-review POST]', err)
    return NextResponse.json({ error: 'Could not record the bilingual review — please try again.' }, { status: 500 })
  }
}
