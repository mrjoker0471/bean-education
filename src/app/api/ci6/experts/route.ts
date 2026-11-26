// ─── BEAN Classroom Intelligence (CI-6D): public expert directory ─────────────
// GET /api/ci6/experts — the consent-gated public projection of expert
// profiles. Only LISTED profiles with recorded disclosure consent appear; the
// response NEVER contains account emails/ids, conflict-of-interest text,
// verification reasons/notes, evidence files or internal audit data. The five
// capability states (applicant / credential-verified / reviewer-eligible /
// domain approvals / language verified) each come from their own ledger.

import { NextResponse } from 'next/server'
import { expertProfilesDbFromPrisma, listPublicExpertProfiles } from '@/lib/ci/fleet/expert-profiles'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(db))
    return NextResponse.json({
      experts,
      note: 'States are derived from independent authoritative ledgers. Real expert activity is zero until genuine verified records exist.',
    })
  } catch (err) {
    console.error('[api/ci6/experts GET]', err)
    return NextResponse.json({ error: 'Could not load the expert directory — please try again.' }, { status: 500 })
  }
}
