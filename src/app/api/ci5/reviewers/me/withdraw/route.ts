// ─── BEAN Classroom Intelligence (CI-6B): applicant withdrawal ────────────────
// POST /api/ci5/reviewers/me/withdraw — applicant-initiated withdrawal of an
// OPEN application (strict CI-5 transition table: APPLICATION_PENDING or
// QUALIFICATION_REVIEW → WITHDRAWN; WITHDRAWN is terminal). All ACTIVE
// credential-evidence files are purged per the retention rules (bytes removed,
// metadata + sha256 retained, event audited).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { applicationsDbFromPrisma, withdrawApplication } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let body: unknown = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    const result = await withdrawApplication(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.profile) return NextResponse.json({ error: 'unexpected missing profile' }, { status: 500 })
    return NextResponse.json({
      profile: {
        id: result.profile.id,
        status: result.profile.status,
      },
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/withdraw POST]', err)
    return NextResponse.json({ error: 'Could not withdraw the application — please try again.' }, { status: 500 })
  }
}
