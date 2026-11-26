// ─── BEAN Classroom Intelligence (CI-7F): evaluation readiness gate ───────────
// GET /api/admin/ci7/evaluation-readiness?datasetSlug=&datasetVersion=
//      &modelProvider=&modelVersion=
//
// Derives, from the REAL CI-5F benchmark ledgers, whether a meaningful
// human-grounded evaluation is possible. When evidence is insufficient the
// response IS the honest state: status INSUFFICIENT EVIDENCE with the missing
// list — no performance score is produced here, ever. The model binding must
// be supplied by the approved evaluation design (protocol §17); it is never
// inferred from a run row, because a run IS an evaluation and readiness gates
// the design.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { pilotEvaluationReadinessFromDb } from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const slug = url.searchParams.get('datasetSlug') ?? ''
    const version = url.searchParams.get('datasetVersion') ?? ''
    const provider = url.searchParams.get('modelProvider') ?? ''
    const modelVersion = url.searchParams.get('modelVersion') ?? ''
    if (!slug || !version) {
      return NextResponse.json({ error: 'datasetSlug and datasetVersion are required — an unversioned dataset can never ground an evaluation' }, { status: 400 })
    }
    const modelBinding = provider && modelVersion ? { provider, version: modelVersion } : null
    const readiness = await pilotEvaluationReadinessFromDb(db, slug, version, modelBinding)
    return NextResponse.json({ readiness })
  } catch (err) {
    console.error('[api/admin/ci7/evaluation-readiness GET]', err)
    return NextResponse.json({ error: 'Could not derive evaluation readiness — please try again.' }, { status: 500 })
  }
}
