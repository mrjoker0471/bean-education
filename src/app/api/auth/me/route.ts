import { NextResponse } from 'next/server'
import { getSessionStudent } from '@/lib/auth'
import { legalStatusForStudent } from '@/lib/legal-acceptance'
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@/lib/legal-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — who is signed in? `student` is null for guests; guest mode keeps
// working without any session. Always no-store: never cache identity.
// `legal` carries the server-computed acceptance state against the CURRENT
// policy versions; `legal.reacceptanceRequired` gates the re-acceptance screen
// for existing users after a material version change (never implied by a mere
// sign-in, and never bypassable for protected actions).
export async function GET() {
  try {
    const student = await getSessionStudent()
    const legal = student
      ? await legalStatusForStudent(student.id)
      : {
          reacceptanceRequired: false,
          terms: { document: 'TERMS' as const, currentVersion: CURRENT_TERMS_VERSION, acceptedVersion: null, acceptedAt: null },
          privacy: { document: 'PRIVACY' as const, currentVersion: CURRENT_PRIVACY_VERSION, acceptedVersion: null, acceptedAt: null },
        }
    return NextResponse.json({ student, legal }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/auth/me]', err)
    return NextResponse.json(
      { student: null, error: 'Could not check your session — please try again.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
