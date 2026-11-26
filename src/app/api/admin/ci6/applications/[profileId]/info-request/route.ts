// ─── BEAN Classroom Intelligence (CI-6C): request additional information ──────
// POST /api/admin/ci6/applications/[profileId]/info-request — authorised
// administrator asks the applicant for more information/evidence during
// verification. The applicant answers through the CI-6B applicant route.
// Admin-only; the loop is append-only audited on both sides.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { applicationsDbFromPrisma, requestAdditionalInfo } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { profileId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const admin = { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN administrator' }
    const result = await requestAdditionalInfo(applicationsDbFromPrisma(db), admin, profileId, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.request) return NextResponse.json({ error: 'unexpected missing request row' }, { status: 500 })
    return NextResponse.json(
      {
        request: {
          id: result.request.id,
          requestText: result.request.requestText,
          status: result.request.status,
          requestedAt: result.request.requestedAt,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/admin/ci6/applications/[profileId]/info-request POST]', err)
    return NextResponse.json({ error: 'Could not record the information request — please try again.' }, { status: 500 })
  }
}
