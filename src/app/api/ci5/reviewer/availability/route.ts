// ─── BEAN Classroom Intelligence (CI-6F): reviewer availability control ───────
// POST /api/ci5/reviewer/availability — the reviewer pauses or resumes new
// assignment intake (workload control). Server-side gate: PAUSED reviewers
// receive no new assignments (createAssignment refuses 409); in-flight work is
// unaffected; qualification/eligibility state is never touched by this route.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { expertProfilesDbFromPrisma, setReviewerAvailability } from '@/lib/ci/fleet/expert-profiles'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await setReviewerAvailability(expertProfilesDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      availability: result.profile.availability,
      note: 'PAUSED reviewers receive no new assignments until they resume; in-flight work is unaffected.',
    })
  } catch (err) {
    console.error('[api/ci5/reviewer/availability POST]', err)
    return NextResponse.json({ error: 'Could not update availability — please try again.' }, { status: 500 })
  }
}
