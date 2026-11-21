// ─── Phase 7: Credentials — student's own list ───────────────────────────────
// GET lists the caller's credentials (issued AND revoked — the truthful
// status travels with each row). Portfolio sharing is a separate owner-only
// PATCH on /api/career/credentials/:credentialId.

import { NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { toCredentialDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const credentials = await db.careerCredential.findMany({
      where: { studentId: student.id },
      include: { issuerOrganization: true },
      orderBy: { issuedDate: 'desc' },
    })
    return NextResponse.json({ credentials: credentials.map(toCredentialDTO) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/career/credentials GET]', err)
    return NextResponse.json({ error: 'Could not load your credentials.' }, { status: 500 })
  }
}
