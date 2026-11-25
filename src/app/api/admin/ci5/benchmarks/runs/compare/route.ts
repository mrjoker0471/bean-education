// ─── BEAN Classroom Intelligence (CI-5F): regression comparison ───────────────
// GET /api/admin/ci5/benchmarks/runs/compare?datasetSlug&datasetVersion&baselineRunId&candidateRunId
// Compares two recorded runs of the same dataset version across model
// versions. Refuses to compare non-runs (ran=false carries no metrics).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { compareRunsForRegression, benchmarkDbFromPrisma } from '@/lib/ci/fleet/expert-benchmarks'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const result = await compareRunsForRegression(
      benchmarkDbFromPrisma(db),
      url.searchParams.get('datasetSlug') ?? '',
      url.searchParams.get('datasetVersion') ?? '',
      url.searchParams.get('baselineRunId') ?? '',
      url.searchParams.get('candidateRunId') ?? '',
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ comparison: result.value })
  } catch (err) {
    console.error('[api/admin/ci5/benchmarks/runs/compare GET]', err)
    return NextResponse.json({ error: 'Could not compare the runs — please try again.' }, { status: 500 })
  }
}
