// ─── BEAN Classroom Intelligence (CI-6D): own disclosure settings ─────────────
// GET/PUT /api/ci5/reviewers/me/disclosure — the applicant/reviewer controls
// exactly what the public expert directory may show about them. Listing
// (LISTED) is consent-gated (disclosureConsentAt recorded on first enable).
// These settings never change qualification or eligibility state.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { expertProfilesDbFromPrisma, updateDisclosureSettings, PROFILE_VISIBILITY } from '@/lib/ci/fleet/expert-profiles'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function serialize(profile: {
  profileVisibility: string
  disclosureConsentAt: Date | null
  publicDisplayName: string | null
  professionalSummary: string | null
  availabilityNote: string | null
  disclosedAffiliation: boolean
  institutionAffiliation: string | null
}) {
  return {
    profileVisibility: profile.profileVisibility,
    disclosureConsentAt: profile.disclosureConsentAt,
    publicDisplayName: profile.publicDisplayName,
    professionalSummary: profile.professionalSummary,
    availabilityNote: profile.availabilityNote,
    disclosedAffiliation: profile.disclosedAffiliation,
    institutionAffiliation: profile.institutionAffiliation,
    visibilityOptions: [...PROFILE_VISIBILITY],
  }
}

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await db.expertReviewerProfile.findUnique({ where: { studentId: student.id } })
    if (!profile) return NextResponse.json({ profile: null })
    return NextResponse.json(serialize(profile))
  } catch (err) {
    console.error('[api/ci5/reviewers/me/disclosure GET]', err)
    return NextResponse.json({ error: 'Could not load disclosure settings — please try again.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await updateDisclosureSettings(expertProfilesDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(serialize(result.profile))
  } catch (err) {
    console.error('[api/ci5/reviewers/me/disclosure PUT]', err)
    return NextResponse.json({ error: 'Could not update disclosure settings — please try again.' }, { status: 500 })
  }
}
