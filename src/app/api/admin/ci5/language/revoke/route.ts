// ─── BEAN Classroom Intelligence (CI-5E): admin language-capability revocation ──
// POST /api/admin/ci5/language/revoke — ADMIN-only, reason required,
// history-preserving: the review rows and the prior approval record stay
// intact; the persisted binding becomes REVOKED. Knowledge becoming outdated
// must un-verify, not erase.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { revokeLanguageCapability, languageGovernanceDbFromPrisma } from '@/lib/ci/fleet/language-governance'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const task = typeof body.task === 'string' ? body.task : ''
    if (!['TEXT_UNDERSTANDING', 'TERMINOLOGY', 'TRANSLATION', 'GENERATION'].includes(task)) {
      return NextResponse.json({ error: 'task must be a reviewable language task — TRANSCRIPTION is structurally UNSUPPORTED and cannot be revoked (it was never verified)' }, { status: 400 })
    }
    const result = await revokeLanguageCapability(
      languageGovernanceDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      {
        languageTag: typeof body.languageTag === 'string' ? body.languageTag : '',
        task,
        domain: typeof body.domain === 'string' ? body.domain : null,
        dialect: typeof body.dialect === 'string' ? body.dialect : null,
        modelProvider: typeof body.modelProvider === 'string' ? body.modelProvider : null,
        modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion : null,
        benchmarkVersion: typeof body.benchmarkVersion === 'string' ? body.benchmarkVersion : null,
      },
      typeof body.reason === 'string' ? body.reason : '',
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      binding: {
        languageTag: result.value.languageTag,
        task: result.value.task,
        status: result.value.status,
        basis: result.value.basis,
      },
      note: result.note,
    })
  } catch (err) {
    console.error('[api/admin/ci5/language/revoke POST]', err)
    return NextResponse.json({ error: 'Could not revoke the capability — please try again.' }, { status: 500 })
  }
}
