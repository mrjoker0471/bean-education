// ─── BEAN Classroom Intelligence (CI-5C): reviewer starts assigned work ──────
// POST /api/ci5/reviewer/assignments/[assignmentId]/start — ownership is
// re-verified server-side against the session's reviewer profile; only the
// ASSIGNED owner can start. Lazy expiry applies first.

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { startAssignment, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 403 })
    const { assignmentId } = await params
    const result = await startAssignment(assignmentDbFromPrisma(db), profile, assignmentId, student.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ assignment: { id: result.assignment.id, status: result.assignment.status } })
  } catch (err) {
    console.error('[api/ci5/reviewer/assignments/[assignmentId]/start POST]', err)
    return NextResponse.json({ error: 'Could not start the assignment — please try again.' }, { status: 500 })
  }
}
