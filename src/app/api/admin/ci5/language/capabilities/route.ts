// ─── BEAN Classroom Intelligence (CI-5E): durable language capabilities view ──
// GET /api/admin/ci5/language/capabilities — the effective capability for every
// catalogue language × task, resolved from the PERSISTED governance store
// (measurements, human reviews, revocations, supersessions) with honest
// catalogue defaults where nothing durable exists. TRANSCRIPTION is always
// structurally UNSUPPORTED.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { listDurableLanguageCapabilities, languageGovernanceDbFromPrisma } from '@/lib/ci/fleet/language-governance'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const capabilities = await listDurableLanguageCapabilities(languageGovernanceDbFromPrisma(db))
    return NextResponse.json({ capabilities })
  } catch (err) {
    console.error('[api/admin/ci5/language/capabilities GET]', err)
    return NextResponse.json({ error: 'Could not load the language capability view — please try again.' }, { status: 500 })
  }
}
