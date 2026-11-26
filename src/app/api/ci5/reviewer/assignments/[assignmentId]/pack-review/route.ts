// ─── BEAN Classroom Intelligence (CI-5D): expert domain-pack review submit ────
// POST /api/ci5/reviewer/assignments/[assignmentId]/pack-review
//
// The only NEW expert-facing decision path — and it writes exclusively through
// the CI-4C append-only authority (`recordPackReview` → ClassroomPackReview).
// There is no alternative store, no bypass: the assignment supplies the case,
// the rubric structures the evidence, and the qualification gate is re-checked
// server-side at submit time.
//
// Hard rules:
//   • ownership: only the assigned reviewer can submit (lazy expiry applies);
//   • freshness: the assignment's checksum must equal the CURRENT pack content
//     — a stale assignment refuses (the reviewer must be re-assigned to the
//     new version after re-inspection);
//   • rubric: all six sections A–F recorded; decision-vs-rubric consistency
//     enforced (APPROVED ⇒ all OK; REJECTED ⇒ ≥1 ISSUE; work-states need
//     concrete findings);
//   • qualification: APPROVED requires an ACTIVE reviewer profile scoped to
//     the pack's domain, re-verified at submit (the assignment gate is not
//     sufficient on its own);
//   • decision lands in ClassroomPackReview via recordPackReview (checksum
//     binding + distinct-reviewer rules unchanged from CI-4).

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { getAssignment, markAssignmentSubmitted, markAssignmentCompleted, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfile, reviewerDbFromPrisma, qualifyingApproverIdsForDomain, reviewerCanReviewDomain } from '@/lib/ci/fleet/reviewers'
import { recordPackReview, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { packReviewRubricSchema, checkRubricAgainstDecision, composeRubricEvidence } from '@/lib/ci/fleet/domain-rubric'
import { getDomainPack, computePackChecksum } from '@/lib/ci/fleet/domain-packs'
import { composePilotReviewEvidence, isPilotPackSubject } from '@/lib/ci/fleet/pilot'
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
    const { assignmentId } = await params

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const decision = typeof body.decision === 'string' ? body.decision : ''
    const rationale = typeof body.rationale === 'string' ? body.rationale : ''

    const adb = assignmentDbFromPrisma(db)
    const assignment = await getAssignment(adb, assignmentId)
    if (!assignment) return NextResponse.json({ error: 'assignment not found' }, { status: 404 })
    if (assignment.reviewerProfileId !== profile.id) {
      return NextResponse.json({ error: 'this assignment belongs to a different reviewer' }, { status: 403 })
    }
    if (assignment.subjectType !== 'DOMAIN_PACK') {
      return NextResponse.json({ error: 'this assignment is not a domain-pack review' }, { status: 400 })
    }

    // Freshness: the decision can only bind to the content the assignment was
    // created for — and that content must still be the CURRENT pack content.
    const entry = getDomainPack(assignment.subjectKey)
    if (!entry) return NextResponse.json({ error: `unknown pack: ${assignment.subjectKey}` }, { status: 404 })
    const currentChecksum = computePackChecksum(entry.pack)
    if (!assignment.subjectChecksum || assignment.subjectChecksum !== currentChecksum) {
      return NextResponse.json({ error: `the pack content changed since this assignment was created (assignment checksum ${assignment.subjectChecksum?.slice(0, 12) ?? 'none'} ≠ current ${currentChecksum.slice(0, 12)}…) — request re-inspection: a reviewer can never review a version they have not actually inspected` }, { status: 409 })
    }
    if (assignment.subjectVersion && assignment.subjectVersion !== entry.pack.packVersion) {
      return NextResponse.json({ error: `assignment was created for version ${assignment.subjectVersion} but the pack is at ${entry.pack.packVersion}` }, { status: 409 })
    }

    // Reviewer must be ACTIVE for ANY submit through the assignment path — a
    // suspended/expired/lapsed reviewer cannot record decisions here (admins
    // retain the separate work-state path through the admin API).
    if (profile.status !== 'ACTIVE') {
      return NextResponse.json({ error: `reviewer is ${profile.status} — only an ACTIVE qualified reviewer can submit through an assignment` }, { status: 403 })
    }
    // Qualification re-check at submit time for the promotion path (ACTIVE +
    // exact scope). This is the approval gate — an unscoped reviewer can never approve.
    if (decision === 'APPROVED' && !reviewerCanReviewDomain(profile, assignment.subjectKey)) {
      return NextResponse.json({ error: `reviewer is not an ACTIVE qualified reviewer for domain "${assignment.subjectKey}" — approvals require an authorised, ACTIVE scope` }, { status: 403 })
    }

    // Rubric: structure + decision-consistency.
    const rubricParsed = packReviewRubricSchema.safeParse(body.rubric)
    if (!rubricParsed.success) {
      const first = rubricParsed.error.issues[0]
      return NextResponse.json({ error: `invalid rubric: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }, { status: 400 })
    }
    const rubricCheck = checkRubricAgainstDecision(decision, rubricParsed.data)
    if (!rubricCheck.ok) {
      return NextResponse.json({ error: rubricCheck.error, rubricSummary: rubricCheck.summary }, { status: 400 })
    }
    if (rationale.trim().length < 20) {
      return NextResponse.json({ error: 'rationale required (min 20 chars) — the decision must carry the reviewer\u2019s reasoning' }, { status: 400 })
    }

    // Hand the case to the authoritative append-only ledger. Pilot-domain
    // reviews (CI-7D) embed the source-licence snapshot + protocol binding in
    // the evidence; every other domain keeps the exact CI-5 evidence format.
    const submitted = await markAssignmentSubmitted(adb, profile, assignmentId, student.id)
    if (!submitted.ok) return NextResponse.json({ error: submitted.error }, { status: submitted.status })

    let evidenceJson: string
    try {
      evidenceJson = isPilotPackSubject(assignment.subjectKey)
        ? composePilotReviewEvidence(rubricParsed.data, entry.pack, currentChecksum)
        : composeRubricEvidence(rubricParsed.data)
    } catch (bindErr) {
      // binding drift must refuse the submission, never record weaker evidence
      await adb.expertReviewAssignment.update({ where: { id: assignmentId }, data: { status: 'IN_PROGRESS' } })
      return NextResponse.json({ error: bindErr instanceof Error ? bindErr.message : 'pilot binding refused' }, { status: 409 })
    }

    const qualified = await qualifyingApproverIdsForDomain(reviewerDbFromPrisma(db), assignment.subjectKey)
    const result = await recordPackReview(
      curatorDbFromPrisma(db),
      { studentId: student.id, displayName: profile.reviewerCode },
      {
        packId: assignment.subjectKey,
        packVersion: entry.pack.packVersion,
        packChecksum: currentChecksum,
        decision,
        rationale,
        evidence: evidenceJson,
      },
      { qualifiedApproverIds: qualified },
    )
    if (!result.ok) {
      // The authoritative ledger refused — the assignment goes back to IN_PROGRESS
      // so the reviewer can correct the submission (append-only history preserved).
      await adb.expertReviewAssignment.update({ where: { id: assignmentId }, data: { status: 'IN_PROGRESS' } })
      await adb.expertReviewAssignmentEvent.create({
        data: { assignmentId, eventType: 'STARTED', actorKind: 'SYSTEM', actorId: 'system', rationale: `authoritative ledger refused the submission — returned to IN_PROGRESS: ${result.error}` },
      })
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const completed = await markAssignmentCompleted(adb, assignmentId, result.reviewId)
    if (!completed.ok) {
      return NextResponse.json({ reviewId: result.reviewId, curated: result.curatedStatus, disagreement: result.disagreement, warning: `decision recorded but assignment completion failed: ${completed.error}` })
    }
    return NextResponse.json({
      reviewId: result.reviewId,
      curated: result.curatedStatus,
      disagreement: result.disagreement,
      assignment: { id: assignmentId, status: 'COMPLETED', outcomeRef: result.reviewId },
    }, { status: 201 })
  } catch (err) {
    console.error('[api/ci5/reviewer/assignments/[assignmentId]/pack-review POST]', err)
    return NextResponse.json({ error: 'Could not record the expert review — please try again.' }, { status: 500 })
  }
}
