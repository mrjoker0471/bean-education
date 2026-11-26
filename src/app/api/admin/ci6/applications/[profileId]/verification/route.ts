// ─── BEAN Classroom Intelligence (CI-6C): record a verification examination ───
// POST /api/admin/ci6/applications/[profileId]/verification — authorised
// administrator records ONE append-only ExpertVerificationRecord. The actor is
// requireAdmin-resolved; self-verification is refused; strict schema refuses
// forged privileged fields; the reviewer lifecycle (status/scope/
// verificationStatus) is deliberately untouched — qualification decisions
// remain the CI-5B authority. Content approvals remain CI-4C/CI-5D/CI-5E.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { verificationDbFromPrisma, recordVerification } from '@/lib/ci/fleet/verification'
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
    const result = await recordVerification(verificationDbFromPrisma(db), admin, profileId, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const r = result.record
    return NextResponse.json(
      {
        record: {
          id: r.id,
          credentialType: r.credentialType,
          issuingInstitution: r.issuingInstitution,
          qualificationScope: r.qualificationScope,
          verificationMethod: r.verificationMethod,
          decision: r.decision,
          reason: r.reason,
          expiresAt: r.expiresAt,
          verifiedAt: r.verifiedAt,
        },
        note: 'Verification records never change the reviewer lifecycle by themselves — qualification decisions remain the CI-5B authority.',
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/admin/ci6/applications/[profileId]/verification POST]', err)
    return NextResponse.json({ error: 'Could not record the verification — please try again.' }, { status: 500 })
  }
}
