// ─── BEAN Classroom Intelligence (CI-6B): applicant answers an info request ───
// POST /api/ci5/reviewers/me/info-requests/[requestId]/answer — the applicant
// answers an OPEN administrator information request on their OWN application.
// Ownership is server-resolved; answered requests are immutable; both the
// request and the answer are audited reviewer events.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { applicationsDbFromPrisma, answerInfoRequest } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const { requestId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await answerInfoRequest(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, requestId, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.request) return NextResponse.json({ error: 'unexpected missing request row' }, { status: 500 })
    const r = result.request
    return NextResponse.json({
      request: {
        id: r.id,
        status: r.status,
        responseText: r.responseText,
        answeredAt: r.answeredAt,
      },
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/info-requests/[requestId]/answer POST]', err)
    return NextResponse.json({ error: 'Could not record the response — please try again.' }, { status: 500 })
  }
}
