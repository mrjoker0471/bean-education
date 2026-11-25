// ─── BEAN Classroom Intelligence (CI-5B): reviewer application ────────────────
// POST /api/ci5/reviewers/apply — any signed-in BEAN account may apply to
// become an expert reviewer. Identity comes from the session (requireStudent);
// the body can never supply a reviewer id, qualification result or scope —
// proposed scopes are recorded as ADVISORY in the application event only.
// Applying confers no privileges: only an admin qualification decision (a
// different authorised administrator) can approve anything.

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { submitReviewerApplication, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const result = await submitReviewerApplication(reviewerDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      profile: {
        id: result.profile.id,
        reviewerCode: result.profile.reviewerCode,
        category: result.profile.category,
        status: result.profile.status,
      },
      note: 'Application recorded. Applying confers no review privileges — an authorised administrator must complete qualification review.',
    }, { status: 201 })
  } catch (err) {
    console.error('[api/ci5/reviewers/apply POST]', err)
    return NextResponse.json({ error: 'Could not submit the reviewer application — please try again.' }, { status: 500 })
  }
}
