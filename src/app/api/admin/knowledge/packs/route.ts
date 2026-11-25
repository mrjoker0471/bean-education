// ─── BEAN Classroom Intelligence (CI-4C): admin knowledge-governance pack list
// GET /api/admin/knowledge/packs — ADMIN-only. Every registered domain pack
// with its curated status derived from the append-only human review ledger
// (never from declared flags alone). No findings, no student data — packs are
// code-level knowledge assets.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { curatedPackSummaries, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const packs = await curatedPackSummaries(curatorDbFromPrisma(db))
    return NextResponse.json({ packs })
  } catch (err) {
    console.error('[api/admin/knowledge/packs GET]', err)
    return NextResponse.json({ error: 'Could not load the pack registry — please try again.' }, { status: 500 })
  }
}
