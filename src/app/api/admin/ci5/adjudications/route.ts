// ─── BEAN Classroom Intelligence (CI-5D): independent adjudication record ─────
// POST /api/admin/ci5/adjudications
//
// When qualified reviewers disagree on the same pack version (an APPROVED
// alongside an objection), both opinions stay preserved and the recorded
// resolution path is an independent adjudicator. The adjudicator must be an
// ACTIVE reviewer scoped for the SAME domain and must be distinct from every
// disagreeing reviewer. The adjudication record is AUDIT-ONLY: it never
// mutates ClassroomPackReview and never changes the curated status — only new,
// checksum-bound decisions on a version can do that.
//
// Body: { adjudicatorAssignmentId, resolution: UPHELD_APPROVAL |
// UPHELD_OBJECTION | NEW_VERSION_REQUIRED, rationale }

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { getAssignment, listAssignments, detectReviewDisagreement, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfileById, reviewerDbFromPrisma, reviewerCanReviewDomain } from '@/lib/ci/fleet/reviewers'
import { listPackReviews, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { getDomainPack, computePackChecksum } from '@/lib/ci/fleet/domain-packs'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RESOLUTIONS = ['UPHELD_APPROVAL', 'UPHELD_OBJECTION', 'NEW_VERSION_REQUIRED'] as const

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
    const adjudicatorAssignmentId = typeof body.adjudicatorAssignmentId === 'string' ? body.adjudicatorAssignmentId : ''
    const resolution = typeof body.resolution === 'string' ? body.resolution : ''
    const rationale = typeof body.rationale === 'string' ? body.rationale : ''
    if (!RESOLUTIONS.includes(resolution as (typeof RESOLUTIONS)[number])) {
      return NextResponse.json({ error: `resolution must be one of ${RESOLUTIONS.join(', ')}` }, { status: 400 })
    }
    if (rationale.trim().length < 20) {
      return NextResponse.json({ error: 'adjudication rationale required (min 20 chars) — the independent resolution must be reasoned' }, { status: 400 })
    }

    const adb = assignmentDbFromPrisma(db)
    const assignment = await getAssignment(adb, adjudicatorAssignmentId)
    if (!assignment) return NextResponse.json({ error: 'adjudicator assignment not found' }, { status: 404 })
    if (assignment.subjectType !== 'DOMAIN_PACK') {
      return NextResponse.json({ error: 'adjudication applies to domain-pack review disagreements' }, { status: 400 })
    }
    if (!['ASSIGNED', 'IN_PROGRESS'].includes(assignment.status)) {
      return NextResponse.json({ error: `adjudicator assignment is ${assignment.status} — adjudication records onto an OPEN assignment and completes it exactly once` }, { status: 409 })
    }

    // The adjudicator must be scoped for the domain and independent.
    const adjudicatorProfile = await resolveReviewerProfileById(reviewerDbFromPrisma(db), assignment.reviewerProfileId)
    if (!adjudicatorProfile) return NextResponse.json({ error: 'adjudicator profile not found' }, { status: 404 })
    if (adjudicatorProfile.status !== 'ACTIVE') {
      return NextResponse.json({ error: `adjudicator is ${adjudicatorProfile.status} — adjudication requires an ACTIVE qualified reviewer` }, { status: 403 })
    }
    if (!reviewerCanReviewDomain(adjudicatorProfile, assignment.subjectKey)) {
      return NextResponse.json({ error: `adjudicator is not authorised for domain "${assignment.subjectKey}"` }, { status: 403 })
    }

    // The disagreement must actually exist among the bound decisions.
    const entry = getDomainPack(assignment.subjectKey)
    if (!entry) return NextResponse.json({ error: `unknown pack: ${assignment.subjectKey}` }, { status: 404 })
    const reviews = await listPackReviews(curatorDbFromPrisma(db), assignment.subjectKey)
    const checksum = assignment.subjectChecksum ?? computePackChecksum(entry.pack)
    const bound = reviews.filter((r) => r.packVersion === entry.pack.packVersion && r.packChecksum === checksum)
    const disagreement = detectReviewDisagreement(bound)
    if (!disagreement.disagreement) {
      return NextResponse.json({ error: 'no recorded disagreement exists for this pack version — adjudication is only for conflicting qualified decisions' }, { status: 409 })
    }

    // Independence: the adjudicator must be distinct from every disagreeing reviewer.
    const involvedIds = new Set([...disagreement.approvals, ...disagreement.objections.map((o) => o.reviewerStudentId)])
    if (involvedIds.has(adjudicatorProfile.studentId)) {
      return NextResponse.json({ error: 'the adjudicator participated in the disagreement — an independent reviewer must adjudicate' }, { status: 409 })
    }

    // Record the adjudication on the adjudicator's assignment (append-only).
    const updated = await adb.expertReviewAssignment.update({ where: { id: adjudicatorAssignmentId }, data: { status: 'COMPLETED', outcomeRef: `adjudication:${resolution}` } })
    await adb.expertReviewAssignmentEvent.create({
      data: {
        assignmentId: adjudicatorAssignmentId,
        eventType: 'ADJUDICATED',
        actorKind: 'ADMIN',
        actorId: guard.student.id,
        rationale,
        payload: JSON.stringify({
          resolution,
          disagreement: disagreement.detail,
          approvals: disagreement.approvals,
          objections: disagreement.objections,
          packId: assignment.subjectKey,
          packVersion: assignment.subjectVersion,
          checksum,
          note: 'audit-only record — the decision ledgers and curated status are untouched; only new checksum-bound decisions change them',
        }),
      },
    })
    return NextResponse.json({
      adjudication: {
        assignmentId: updated.id,
        resolution,
        status: updated.status,
        outcomeRef: updated.outcomeRef,
        disagreement: disagreement.detail,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/adjudications POST]', err)
    return NextResponse.json({ error: 'Could not record the adjudication — please try again.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? undefined
    const rows = await listAssignments(assignmentDbFromPrisma(db), { status: status ?? undefined, subjectType: 'DOMAIN_PACK' })
    const adjudications = rows.filter((r) => r.outcomeRef?.startsWith('adjudication:'))
    return NextResponse.json({ adjudications: adjudications.map((a) => ({ id: a.id, subjectKey: a.subjectKey, reviewerCode: a.reviewerCode, status: a.status, outcomeRef: a.outcomeRef })) })
  } catch (err) {
    console.error('[api/admin/ci5/adjudications GET]', err)
    return NextResponse.json({ error: 'Could not load the adjudication queue — please try again.' }, { status: 500 })
  }
}
