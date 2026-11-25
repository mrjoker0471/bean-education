// ─── BEAN Classroom Intelligence (CI-5G): reviewer report-audit submit ───────
// POST /api/ci5/reviewer/assignments/[assignmentId]/report-audit
// Privacy-masked classroom-report audit through an assignment (subject type
// CLASSROOM_REPORT). The reviewer records supported/unsupported/ambiguous
// findings on the EXACT report version; unobservable dimensions are marked;
// the Evidence Auditor's findings stay preserved; teacher disputes continue
// through the existing Trust workflow (no new bypass).

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { getAssignment, markAssignmentSubmitted, markAssignmentCompleted, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { recordClassroomReportAuditReview, buildMaskedReportView, reportAuditDbFromPrisma } from '@/lib/ci/fleet/report-audit'
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
      return NextResponse.json({ error: `reviewer is ${profile.status} — only an ACTIVE reviewer can submit report audits` }, { status: 403 })
    }
    const { assignmentId } = await params
    const adb = assignmentDbFromPrisma(db)
    const assignment = await getAssignment(adb, assignmentId)
    if (!assignment) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })
    if (assignment.reviewerProfileId !== profile.id) {
      return NextResponse.json({ error: 'this assignment belongs to a different reviewer' }, { status: 403 })
    }
    if (assignment.subjectType !== 'CLASSROOM_REPORT') {
      return NextResponse.json({ error: 'this assignment is not a classroom-report audit' }, { status: 400 })
    }
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const submitted = await markAssignmentSubmitted(adb, profile, assignmentId, student.id)
    if (!submitted.ok) return NextResponse.json({ error: submitted.error }, { status: submitted.status })

    const result = await recordClassroomReportAuditReview(
      reportAuditDbFromPrisma(db),
      profile,
      { ...body, reportId: assignment.subjectKey },
      assignmentId,
    )
    if (!result.ok) {
      await adb.expertReviewAssignment.update({ where: { id: assignmentId }, data: { status: 'IN_PROGRESS' } })
      await adb.expertReviewAssignmentEvent.create({
        data: { assignmentId, eventType: 'STARTED', actorKind: 'SYSTEM', actorId: 'system', rationale: `audit submission refused — returned to IN_PROGRESS: ${result.error}` },
      })
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const completed = await markAssignmentCompleted(adb, assignmentId, result.reviewId)
    if (!completed.ok) {
      return NextResponse.json({ reviewId: result.reviewId, warning: `audit recorded but assignment completion failed: ${completed.error}` })
    }
    // The masked view is returned so the reviewer workspace can render the evidence alongside the decision.
    const view = await buildMaskedReportView(reportAuditDbFromPrisma(db), assignment.subjectKey)
    return NextResponse.json({
      reviewId: result.reviewId,
      assignment: { id: assignmentId, status: 'COMPLETED', outcomeRef: result.reviewId },
      maskedView: view.ok ? view.view : null,
      note: 'Corrections are recorded as new audit events; the Evidence Auditor\u2019s findings remain preserved; teacher disputes flow through the existing Trust workflow.',
    }, { status: 201 })
  } catch (err) {
    console.error('[api/ci5/reviewer/assignments/[assignmentId]/report-audit POST]', err)
    return NextResponse.json({ error: 'Could not record the report audit — please try again.' }, { status: 500 })
  }
}
