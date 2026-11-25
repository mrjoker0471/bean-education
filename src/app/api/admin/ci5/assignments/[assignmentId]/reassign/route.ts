// ─── BEAN Classroom Intelligence (CI-5C): admin reassignment ──────────────────
// POST /api/admin/ci5/assignments/[assignmentId]/reassign — closes the current
// open assignment as REASSIGNED (reason required, append-only) and creates the
// replacement through the SAME eligibility gates (scope match, COI check,
// independence) for the new reviewer.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { reassignAssignment, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfileById, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { assignmentId } = await params
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await reassignAssignment(
      assignmentDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      assignmentId,
      { reason: body.reason, newReviewerProfileId: body.newReviewerProfileId, expiresAt: body.expiresAt },
      (profileId) => resolveReviewerProfileById(reviewerDbFromPrisma(db), profileId),
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ closedAssignmentId: result.assignment.id, status: result.assignment.status })
  } catch (err) {
    console.error('[api/admin/ci5/assignments/[assignmentId]/reassign POST]', err)
    return NextResponse.json({ error: 'Could not reassign the review — please try again.' }, { status: 500 })
  }
}
