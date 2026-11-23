import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionStudent, sameOrigin } from '@/lib/auth'
import { legalStatusForStudent } from '@/lib/legal-acceptance'
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@/lib/legal-config'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  acceptedTermsVersion: z.string().min(1).max(64),
  privacyNoticeVersion: z.string().min(1).max(64),
})

// POST — record re-acceptance of the CURRENT Terms and Privacy versions for
// the signed-in student. Versions are validated SERVER-side; a stale version
// from the browser is rejected. Re-acceptance is a deliberate action — it is
// never implied by signing in, and logout/export/deletion/grievance paths are
// never blocked behind it.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  const student = await getSessionStudent()
  if (!student) {
    return NextResponse.json({ error: 'Sign in to record your acceptance.' }, { status: 401 })
  }
  if (rateLimited(clientKey(req, 'legal-accept'), 10, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment and try again.' }, { status: 429 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please review the current versions before accepting.' }, { status: 400 })
  }

  const versionErrors: Record<string, string> = {}
  if (parsed.data.acceptedTermsVersion !== CURRENT_TERMS_VERSION) versionErrors.terms = 'Please review and accept the current Terms and Conditions to continue.'
  if (parsed.data.privacyNoticeVersion !== CURRENT_PRIVACY_VERSION) versionErrors.privacy = 'Please review the current Privacy Notice to continue.'
  if (Object.keys(versionErrors).length > 0) {
    return NextResponse.json(
      { error: 'The legal documents have changed — please review the current versions.', code: 'stale_legal_version', details: versionErrors },
      { status: 400 },
    )
  }

  await db.legalAcceptance.createMany({
    data: [
      { studentId: student.id, document: 'TERMS', version: CURRENT_TERMS_VERSION },
      { studentId: student.id, document: 'PRIVACY', version: CURRENT_PRIVACY_VERSION },
    ],
  })

  const legal = await legalStatusForStudent(student.id)
  return NextResponse.json({ ok: true, legal })
}
