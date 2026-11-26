// ─── BEAN Classroom Intelligence (CI-6E): claim an invitation ─────────────────
// POST /api/ci6/invitations/claim — the signed-in account claims an invitation
// with the RAW token (single-use; sha-256 matched server-side; replay/expiry/
// revocation refused; rate-limited). Claiming STARTS OR LINKS an application —
// it NEVER grants reviewer privileges, verification state or eligibility, and
// it creates no application by itself: the applicant completes #/expert-apply.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { invitationsDbFromPrisma, claimInvitation } from '@/lib/ci/fleet/invitations'
import { clientKey, rateLimited } from '@/lib/rate-limit'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    // Token-guessing resistance: strict per-account rate limit on claims.
    if (rateLimited(clientKey(req, `ci6-invite-claim:${student.id}`), 10, 5 * 60_000)) {
      return NextResponse.json({ error: 'Too many claim attempts — please try again later.' }, { status: 429 })
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const token = typeof (body as { token?: unknown }).token === 'string' ? (body as { token: string }).token : ''
    const result = await claimInvitation(invitationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, token)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.value) return NextResponse.json({ error: 'unexpected missing claim context' }, { status: 500 })
    return NextResponse.json({
      claim: result.value,
      note: 'Invitation claimed. Complete your application at #/expert-apply — claiming does not grant any reviewer privilege; verification stays human and independent.',
    })
  } catch (err) {
    console.error('[api/ci6/invitations/claim POST]', err)
    return NextResponse.json({ error: 'Could not claim the invitation — please try again.' }, { status: 500 })
  }
}
