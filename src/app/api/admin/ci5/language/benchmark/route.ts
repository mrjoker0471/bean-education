// ─── BEAN Classroom Intelligence (CI-5E): run + persist the language benchmark ──
// POST /api/admin/ci5/language/benchmark — ADMIN-triggered. Runs BOTH text
// benchmark sets against the current adapter and PERSISTS every measurement
// (language × task × provider × model version × benchmark version × dataset
// checksum) durably. Honest rules: without an adapter nothing runs and nothing
// is recorded; a measured pass records at most LIMITED; TRANSCRIPTION is never
// recorded. VERIFIED stays reachable only through the qualified bilingual
// review path.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { runCi4LanguageBenchmark } from '@/lib/ci/fleet/language'
import { persistLanguageMeasurement, languageGovernanceDbFromPrisma, computeBenchmarkChecksum, LanguageGovernanceDb } from '@/lib/ci/fleet/language-governance'
import { TEXT_BENCHMARK_CASES, CI4_TERMINOLOGY_CASES, CI4_BENCHMARK_VERSION } from '@/lib/ci/fleet/language'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const summary = await runCi4LanguageBenchmark()
    if (!summary.ran) {
      return NextResponse.json({
        ran: false,
        reason: summary.reason,
        persisted: 0,
        note: 'no model adapter in this deployment — nothing measured, nothing recorded (honest); capabilities stay at their default states',
      })
    }

    const checksum = computeBenchmarkChecksum([...TEXT_BENCHMARK_CASES, ...CI4_TERMINOLOGY_CASES])
    const gdb = languageGovernanceDbFromPrisma(db)
    const persisted: { languageTag: string; task: string; passed: boolean; testRef: string }[] = []
    for (const lang of summary.perLanguage) {
      for (const task of lang.tasks) {
        if (task.total === 0) continue
        const res = await persistLanguageMeasurement(gdb as LanguageGovernanceDb, {
          languageTag: lang.language,
          task: task.task as Parameters<typeof persistLanguageMeasurement>[1]['task'],
          passed: task.passed === task.total,
          testRef: `${CI4_BENCHMARK_VERSION} (${task.passed}/${task.total} cases)`,
          measuredAt: new Date(),
          modelProvider: summary.adapterId,
          modelVersion: 'unversioned-adapter',
          benchmarkVersion: CI4_BENCHMARK_VERSION,
          benchmarkChecksum: checksum,
          caseCount: task.total,
          passedCount: task.passed,
        })
        if (res.ok) persisted.push({ languageTag: lang.language, task: task.task, passed: task.passed === task.total, testRef: res.value.testRef })
      }
    }
    return NextResponse.json({
      ran: true,
      reason: summary.reason,
      benchmarkVersion: CI4_BENCHMARK_VERSION,
      benchmarkChecksum: checksum,
      adapterId: summary.adapterId,
      persisted,
      note: 'measurements persisted durably — LIMITED at most; VERIFIED requires qualified bilingual review bound to these exact measurements',
    }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/language/benchmark POST]', err)
    return NextResponse.json({ error: 'Could not run the language benchmark — please try again.' }, { status: 500 })
  }
}
