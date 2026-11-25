// ─── BEAN Classroom Intelligence (CI-5C): the reviewer's own queue ────────────
// GET /api/ci5/reviewer/assignments — only the signed-in reviewer's OWN
// assignments (active work, completed reviews, recusal history). Another
// reviewer's assignments are never exposed through this route.

import { NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { listAssignments, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ reviewer: false, assignments: [] })

    const rows = await listAssignments(assignmentDbFromPrisma(db), { reviewerProfileId: profile.id })
    return NextResponse.json({
      reviewer: true,
      reviewerCode: profile.reviewerCode,
      reviewerStatus: profile.status,
      assignments: rows.map((a) => ({
        id: a.id,
        subjectType: a.subjectType,
        subjectKey: a.subjectKey,
        subjectVersion: a.subjectVersion,
        subjectChecksum: a.subjectChecksum,
        riskClass: a.riskClass,
        status: a.status,
        dueAt: a.dueAt,
        expiresAt: a.expiresAt,
        outcomeRef: a.outcomeRef,
        createdAt: a.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/ci5/reviewer/assignments GET]', err)
    return NextResponse.json({ error: 'Could not load your assignments — please try again.' }, { status: 500 })
  }
}
