// ─── BEAN Classroom Intelligence (CI-5F): benchmark harness runs ──────────────
// POST /api/admin/ci5/benchmarks/runs — run the harness for one dataset + agent
// kind. Honest: without an adapter executor the run records ran=false with the
// reason — metrics are never fabricated. A run NEVER mutates governance ledgers.
// GET  /api/admin/ci5/benchmarks/runs — list runs with parsed metrics.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { runBenchmarkHarness, benchmarkDbFromPrisma, EXPERT_AGENTS, type RunMetrics } from '@/lib/ci/fleet/expert-benchmarks'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const runs = await benchmarkDbFromPrisma(db).expertBenchmarkRun.findMany({ orderBy: { createdAt: 'asc' as const } })
    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        datasetId: r.datasetId,
        datasetVersion: r.datasetVersion,
        datasetChecksum: r.datasetChecksum,
        agentKind: r.agentKind,
        agentDomain: r.agentDomain,
        modelProvider: r.modelProvider,
        modelVersion: r.modelVersion,
        ran: r.ran,
        runReason: r.runReason,
        expertLabelCount: r.expertLabelCount,
        metrics: JSON.parse(r.metricsJson) as RunMetrics,
        runBy: r.runBy,
        createdAt: r.createdAt,
      })),
      vocabularies: { agents: EXPERT_AGENTS },
    })
  } catch (err) {
    console.error('[api/admin/ci5/benchmarks/runs GET]', err)
    return NextResponse.json({ error: 'Could not load the benchmark runs — please try again.' }, { status: 500 })
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
    // The sandbox/production executor: the CI model adapter, when configured.
    // Without an adapter the run records ran=false honestly.
    let executor: ((prompt: string) => Promise<string>) | null = null
    let description = 'none'
    try {
      const { getCiModelAdapter } = await import('@/lib/ci/model-adapter')
      const adapter = getCiModelAdapter()
      if (adapter) {
        executor = async (prompt: string) => adapter.complete({ system: 'You are BEAN\u2019s benchmark probe. Follow the instruction exactly.', user: prompt })
        description = adapter.id
      }
    } catch {
      executor = null
    }
    const result = await runBenchmarkHarness(benchmarkDbFromPrisma(db), {
      datasetSlug: typeof body.datasetSlug === 'string' ? body.datasetSlug : '',
      datasetVersion: typeof body.datasetVersion === 'string' ? body.datasetVersion : '',
      agentKind: (typeof body.agentKind === 'string' ? body.agentKind : 'SUBJECT_SPECIALIST') as 'LEARNER' | 'TEACHER_JUDGE' | 'SUBJECT_SPECIALIST' | 'LANGUAGE_SPECIALIST' | 'EVIDENCE_AUDITOR' | 'SAFETY_GUARDIAN' | 'EVALUATION_ORCHESTRATOR' | 'TEACHER_COACH' | 'REVISION_COACH',
      agentDomain: typeof body.agentDomain === 'string' ? body.agentDomain : undefined,
      runBy: guard.student.id,
      executor,
      executorDescription: description,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const metrics = JSON.parse(result.value.metricsJson) as RunMetrics
    return NextResponse.json({
      run: {
        id: result.value.id,
        datasetVersion: result.value.datasetVersion,
        agentKind: result.value.agentKind,
        ran: result.value.ran,
        runReason: result.value.runReason,
        expertLabelCount: result.value.expertLabelCount,
        metrics: { sampleSize: metrics.sampleSize, accuracy: metrics.accuracy, expertLabelledSample: metrics.expertLabelledSample, notes: metrics.notes },
      },
    }, { status: result.value.ran ? 201 : 200 })
  } catch (err) {
    console.error('[api/admin/ci5/benchmarks/runs POST]', err)
    return NextResponse.json({ error: 'Could not run the benchmark — please try again.' }, { status: 500 })
  }
}
