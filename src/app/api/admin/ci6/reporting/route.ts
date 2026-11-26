// ─── BEAN Classroom Intelligence (CI-6G): honest activation reporting ─────────
// GET /api/admin/ci6/reporting — the aggregate surface that separates software
// readiness from real-world activation. Admin-only (requireAdmin). Every count
// is computed from its own authoritative ledger; zero is displayed where the
// real count is zero. This endpoint never fabricates, never averages and never
// turns missing data into success indicators.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { reportingDbFromPrisma, buildActivationReport } from '@/lib/ci/fleet/reporting'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const report = await buildActivationReport(reportingDbFromPrisma(db), db)
    return NextResponse.json({
      report,
      note: 'Real-world activation is reported separately from software readiness. Until genuine experts are recruited and independently verified, verified counts read zero.',
    })
  } catch (err) {
    console.error('[api/admin/ci6/reporting GET]', err)
    return NextResponse.json({ error: 'Could not build the activation report — please try again.' }, { status: 500 })
  }
}
