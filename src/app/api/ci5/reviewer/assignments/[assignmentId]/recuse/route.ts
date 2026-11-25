// ─── BEAN Classroom Intelligence (CI-5C): reviewer recusal ────────────────────
// POST /api/ci5/reviewer/assignments/[assignmentId]/recuse — ownership re-verified
// server-side; reason required; append-only audit event. Recusal preserves
// reviewer independence: a reviewer who recognises a conflict can always step
// aside, and the recusal is permanent history.

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { recuseAssignment, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
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
    const result = await recuseAssignment(assignmentDbFromPrisma(db), profile, assignmentId, typeof body.reason === 'string' ? body.reason : '', student.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ assignment: { id: result.assignment.id, status: result.assignment.status } })
  } catch (err) {
    console.error('[api/ci5/reviewer/assignments/[assignmentId]/recuse POST]', err)
    return NextResponse.json({ error: 'Could not record the recusal — please try again.' }, { status: 500 })
  }
}
