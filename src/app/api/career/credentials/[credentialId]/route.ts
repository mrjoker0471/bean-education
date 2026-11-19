// ─── Phase 7: Credentials (student view + portfolio sharing toggle) ──────────
// PATCH toggles portfolioShared for an OWN credential only. Revoked
// credentials are never presented as active verified achievements anywhere.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { credentialShareSchema } from '@/lib/career-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ credentialId: string }> }

/** PATCH toggles portfolio sharing for an OWN credential (owner only). */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const { credentialId } = await params

    const parsed = credentialShareSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid sharing flag' }, { status: 400 })

    const existing = await db.careerCredential.findFirst({
      where: { id: credentialId, studentId: student.id },
    })
    if (!existing) return NextResponse.json({ error: 'Credential not found' }, { status: 404 })

    const updated = await db.careerCredential.update({
      where: { id: existing.id },
      data: { portfolioShared: parsed.data.portfolioShared },
    })
    return NextResponse.json({ credential: { id: updated.id, portfolioShared: updated.portfolioShared, status: updated.status } })
  } catch (err) {
    console.error('[api/career/credentials/[credentialId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update sharing.' }, { status: 500 })
  }
}
