// ─── BEAN Classroom Intelligence (CI-7H): pilot dashboard reporting ───────────
// GET /api/admin/ci7/reporting — the pilot dashboard: every count derived from
// its own authoritative ledger (CI-6G discipline). Clearly separates synthetic
// fixture records from real expert records; when the real pilot has not been
// executed the report says NOT STARTED with genuine zeros.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { buildPilotReport, ci7ReportingDbFromPrisma } from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const report = await buildPilotReport(ci7ReportingDbFromPrisma(db))
    return NextResponse.json({ report, note: 'Every count comes from its own authoritative ledger. Zero is displayed where the real count is zero.' })
  } catch (err) {
    console.error('[api/admin/ci7/reporting GET]', err)
    return NextResponse.json({ error: 'Could not load the pilot report — please try again.' }, { status: 500 })
  }
}
