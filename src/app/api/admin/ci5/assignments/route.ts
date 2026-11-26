// ─── BEAN Classroom Intelligence (CI-5C): admin review-assignment queue ──────
// GET  /api/admin/ci5/assignments — the governance queue: pending assignments,
//      per-subject status, reviewer eligibility, reassignments, expiry state.
// POST /api/admin/ci5/assignments — create an assignment. The admin identity is
//      server-resolved; the reviewer profile is loaded server-side by id and
//      re-verified (ACTIVE + exact scope match + COI check + independence).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { createAssignment, listAssignments, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfileById, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { pilotAssignmentGate, resolvePilotParticipation } from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? undefined
    const subjectType = url.searchParams.get('subjectType') ?? undefined
    const subjectKey = url.searchParams.get('subjectKey') ?? undefined

    const rows = await listAssignments(assignmentDbFromPrisma(db), { status, subjectType, subjectKey })
    return NextResponse.json({
      assignments: rows.map((a) => ({
        id: a.id,
        subjectType: a.subjectType,
        subjectKey: a.subjectKey,
        subjectVersion: a.subjectVersion,
        subjectChecksum: a.subjectChecksum,
        riskClass: a.riskClass,
        reviewerCode: a.reviewerCode,
        status: a.status,
        dueAt: a.dueAt,
        expiresAt: a.expiresAt,
        coiCheckResult: a.coiCheckResult,
        outcomeRef: a.outcomeRef,
        reassignmentReason: a.reassignmentReason,
        createdAt: a.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/admin/ci5/assignments GET]', err)
    return NextResponse.json({ error: 'Could not load the assignment queue — please try again.' }, { status: 500 })
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
    const reviewerProfileId = typeof body.reviewerProfileId === 'string' ? body.reviewerProfileId : ''
    if (!reviewerProfileId) return NextResponse.json({ error: 'reviewerProfileId is required (the profile is loaded server-side; identity is never taken from display names).' }, { status: 400 })

    // Lazy expiry applies here too: a lapsed profile can never be assigned work.
    const profile = await resolveReviewerProfileById(reviewerDbFromPrisma(db), reviewerProfileId)
    if (!profile) return NextResponse.json({ error: 'reviewer profile not found' }, { status: 404 })

    // CI-7C pilot gate (additive; never relaxes the CI-5C gates below): an
    // assignment for the pilot pack requires the reviewer's recorded pilot
    // participation consent for the CURRENT protocol version.
    const participationEvents = await db.expertReviewerEvent.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'asc' },
    })
    const pilotGate = pilotAssignmentGate(body.subjectType, body.subjectKey, resolvePilotParticipation(participationEvents))
    if (!pilotGate.ok) return NextResponse.json({ error: pilotGate.error }, { status: pilotGate.status })

    const result = await createAssignment(assignmentDbFromPrisma(db), { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' }, profile, {
      subjectType: body.subjectType,
      subjectKey: body.subjectKey,
      subjectVersion: body.subjectVersion,
      subjectChecksum: body.subjectChecksum,
      riskClass: body.riskClass,
      dueAt: body.dueAt,
      expiresAt: body.expiresAt,
      coiCheck: body.coiCheck,
      conflictNote: body.conflictNote,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      assignment: {
        id: result.assignment.id,
        subjectType: result.assignment.subjectType,
        subjectKey: result.assignment.subjectKey,
        reviewerCode: result.assignment.reviewerCode,
        status: result.assignment.status,
        expiresAt: result.assignment.expiresAt,
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/assignments POST]', err)
    return NextResponse.json({ error: 'Could not create the assignment — please try again.' }, { status: 500 })
  }
}
