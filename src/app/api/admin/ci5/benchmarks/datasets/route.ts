// ─── BEAN Classroom Intelligence (CI-5F): expert benchmark dataset registry ───
// GET  /api/admin/ci5/benchmarks/datasets — list datasets (splits, versions,
//      checksums, licence, expert-label counts). Blind-holdout cases are NOT
//      returned through this view (leakage prevention).
// POST /api/admin/ci5/benchmarks/datasets — create an immutable dataset
//      version. Material must be BEAN-authored or licence-recorded.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { createBenchmarkDataset, benchmarkDbFromPrisma, EXPERT_BENCHMARK_TASK_KINDS, BENCHMARK_SPLITS } from '@/lib/ci/fleet/expert-benchmarks'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const datasets = await benchmarkDbFromPrisma(db).expertBenchmarkDataset.findMany({ orderBy: { createdAt: 'asc' as const } })
    const labels = await benchmarkDbFromPrisma(db).expertBenchmarkCaseLabel.findMany({})
    return NextResponse.json({
      datasets: datasets.map((d) => {
        const cases = JSON.parse(d.casesJson) as { caseKey: string }[]
        return {
          slug: d.slug,
          name: d.name,
          taskKind: d.taskKind,
          split: d.split,
          version: d.version,
          checksum: d.checksum,
          licence: d.licence,
          domain: d.domain,
          languageTag: d.languageTag,
          caseCount: cases.length,
          caseKeys: d.split === 'BLIND_HOLDOUT' ? [] : cases.map((c) => c.caseKey),
          expertLabelCount: labels.filter((l) => l.datasetId === d.id).length,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
        }
      }),
      vocabularies: { taskKinds: EXPERT_BENCHMARK_TASK_KINDS, splits: BENCHMARK_SPLITS },
    })
  } catch (err) {
    console.error('[api/admin/ci5/benchmarks/datasets GET]', err)
    return NextResponse.json({ error: 'Could not load the benchmark registry — please try again.' }, { status: 500 })
  }
}

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
    const result = await createBenchmarkDataset(benchmarkDbFromPrisma(db), { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      dataset: { slug: result.value.slug, version: result.value.version, split: result.value.split, taskKind: result.value.taskKind, checksum: result.value.checksum, caseCount: (JSON.parse(result.value.casesJson) as unknown[]).length },
    }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/benchmarks/datasets POST]', err)
    return NextResponse.json({ error: 'Could not create the dataset — please try again.' }, { status: 500 })
  }
}
