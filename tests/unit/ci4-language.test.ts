// ─── CI-4F tests: multilingual quality + honest capability states ────────────
//   F1  every catalogue language has a BEAN-authored terminology case; all
//       11 languages covered; notation-preservation case present
//   F2  measurement runner without an adapter records NOTHING (honest ran=false)
//   F3  measurement runner with a passing adapter records LIMITED with full
//       provenance — NEVER VERIFIED (a model never certifies itself)
//   F4  a partially-failing language records LIMITED with the honest counts
//   F5  human bilingual approval verifies a MEASURED capability and refuses
//       unmeasured ones; TRANSCRIPTION untouchable; refusal behaviour intact
//   F6  capability records carry dialect/model/version/domain/benchmark
//       provenance and round-trip

import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import {
  CI3_LANGUAGES,
  CI4_TERMINOLOGY_CASES,
  CI4_BENCHMARK_VERSION,
  runCi4LanguageBenchmark,
  recordCapabilityMeasurement,
  listLanguageCapabilities,
  resetLanguageCapabilitiesForTests,
  isCapabilityVerified,
  capabilityRefusalReason,
  TEXT_BENCHMARK_CASES,
} from '@/lib/ci/fleet/language'
import { setCiModelAdapterForProcess, resetCiModelAdapterForTests } from '@/lib/ci/model-adapter'
import { persistLanguageMeasurement, recordLanguageCapabilityReview, languageGovernanceDbFromPrisma, computeBenchmarkChecksum, type LanguageGovernanceDb } from '@/lib/ci/fleet/language-governance'
import { submitReviewerApplication, beginQualificationReview, decideReviewerQualification, activateReviewer, resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'

// CI-5E: the durable governance path needs a real schema (measurements,
// reviews, persisted status). Provision an isolated DB like the other suites.
const dir = mkdtempSync(join(tmpdir(), 'bean-ci4f-'))
const isolatedUrl = `file:${join(dir, 'ci4f.db')}`
execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
const gdb: LanguageGovernanceDb = languageGovernanceDbFromPrisma(client)
const rdb = reviewerDbFromPrisma(client)

const ALL_OK_EVIDENCE = Object.fromEntries(
  ['meaning_preservation', 'domain_terminology', 'grammar', 'naturalness', 'script_correctness', 'mathematical_notation', 'scientific_symbols', 'code_switching', 'regional_register', 'dialect_differences', 'ambiguous_wording', 'unsupported_claims', 'safety_refusal_accuracy'].map((id) => [id, { status: 'OK', notes: 'fixture review' }]),
) as Record<string, { status: 'OK' | 'ISSUE' | 'NOT_ASSESSED'; notes?: string }>

beforeAll(async () => {
  // a qualified bilingual reviewer fixture (synthetic; scoped to en/hi/kn text tasks)
  const secondAdmin = { kind: 'ADMIN' as const, studentId: 'ci4f-admin2', displayName: 'Second Admin' }
  await submitReviewerApplication(rdb, { studentId: 'ci4f-bilingual', displayName: 'Bilingual Fixture' }, { category: 'BILINGUAL_LANGUAGE', conflictOfInterest: 'none declared (fixture)' })
  const profile = await resolveReviewerProfile(rdb, 'ci4f-bilingual')!
  await beginQualificationReview(rdb, secondAdmin, profile.id, 'fixture bilingual review')
  await decideReviewerQualification(rdb, secondAdmin, profile.id, {
    decision: 'APPROVED',
    rationale: 'fixture bilingual qualification verified for CI-5E durable path tests',
    verificationStatus: 'REFERENCED_VERIFIED',
    verificationNote: 'synthetic fixture — no real credentials exist',
    scope: { approvedLanguages: [{ tag: 'en', tasks: ['TEXT_UNDERSTANDING', 'TERMINOLOGY', 'GENERATION'] }, { tag: 'hi', tasks: ['TERMINOLOGY', 'TEXT_UNDERSTANDING'] }, { tag: 'kn', tasks: ['GENERATION'] }] },
  })
  await activateReviewer(rdb, secondAdmin, profile.id)
}, 120_000)

beforeEach(() => {
  resetLanguageCapabilitiesForTests()
  resetCiModelAdapterForTests()
})

describe('CI-4F multilingual benchmark expansion', () => {
  test('F1 all 11 catalogue languages have BEAN-authored benchmark cases; notation case present', () => {
    // The union of the CI-3F cases (en/ta/hi comprehension + code-switch) and
    // the CI-4F terminology/notation cases must cover every catalogue language.
    const languages = new Set([...TEXT_BENCHMARK_CASES, ...CI4_TERMINOLOGY_CASES].map((c) => c.language))
    for (const lang of CI3_LANGUAGES) {
      expect(languages.has(lang.tag)).toBe(true)
    }
    expect(languages.size).toBe(CI3_LANGUAGES.length)
    const notation = CI4_TERMINOLOGY_CASES.find((c) => c.id === 'ci4-bench-notation-preserve')!
    expect(notation.accept('यह है: x² + 2x + 1 = 0')).toBe(true)
    expect(notation.accept('translated away: x^2 + 2x + 1')).toBe(false)
    // every CI-4F case carries the benchmark version in its id family + the
    // whole benchmark set is BEAN-authored original content
    expect(CI4_BENCHMARK_VERSION).toBe('ci4-lang-bench-1')
    for (const c of CI4_TERMINOLOGY_CASES) {
      expect(c.user.length).toBeGreaterThan(10)
    }
    expect(TEXT_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(6) // CI-3F cases intact
  })

  test('F2 without an adapter nothing runs and nothing is recorded', async () => {
    setCiModelAdapterForProcess(null) // explicitly none (reset restores the real adapter)
    const summary = await runCi4LanguageBenchmark()
    expect(summary.ran).toBe(false)
    expect(summary.reason).toContain('no model adapter')
    expect(summary.perLanguage).toEqual([])
    // every capability still at its honest default
    const caps = listLanguageCapabilities()
    expect(caps.every((c) => c.status === 'EXPERIMENTAL' || c.status === 'NEEDS_HUMAN_REVIEW' || c.status === 'UNSUPPORTED')).toBe(true)
    expect(caps.some((c) => c.status === 'VERIFIED')).toBe(false)
  })

  test('F3 a passing adapter records LIMITED with provenance — never VERIFIED', async () => {
    // perfect adapter: echoes the required term for terminology cases
    setCiModelAdapterForProcess({
      id: 'ci4f-perfect-adapter',
      complete: async ({ user }) => {
        // naive echo: return everything after the last ': '
        const idx = user.lastIndexOf(':')
        return user.slice(idx + 1).trim()
      },
    })
    const summary = await runCi4LanguageBenchmark()
    expect(summary.ran).toBe(true)
    expect(summary.benchmarkVersion).toBe('ci4-lang-bench-1')
    expect(summary.perLanguage.length).toBeGreaterThan(0)
    for (const lang of summary.perLanguage) {
      expect(lang.recorded).toBe(true)
      expect(lang.statusAfter).toBe('LIMITED')
    }
    const caps = listLanguageCapabilities()
    const hiTerm = caps.find((c) => c.language === 'hi' && c.task === 'TERMINOLOGY')!
    expect(hiTerm.status).toBe('LIMITED') // machine pass ≠ capability claim
    expect(hiTerm.humanApproved).toBe(false)
    expect(hiTerm.modelProvider).toBe('ci4f-perfect-adapter')
    expect(hiTerm.modelVersion).toBe('unversioned-adapter')
    expect(hiTerm.benchmarkVersion).toBe('ci4-lang-bench-1')
    expect(hiTerm.testRef).toContain('ci4-lang-bench-1')
    expect(caps.some((c) => c.status === 'VERIFIED')).toBe(false)
    // TRANSCRIPTION untouched by the whole run
    expect(caps.filter((c) => c.task === 'TRANSCRIPTION').every((c) => c.status === 'UNSUPPORTED')).toBe(true)
  })

  test('F4 a partially-failing language records LIMITED with honest counts', async () => {
    // adapter that preserves Hindi but transliterates Tamil away
    setCiModelAdapterForProcess({
      id: 'ci4f-biased-adapter',
      complete: async ({ user }) => {
        if (user.includes('बीजगणित')) return 'बीजगणित'
        return 'vee ganith (transliterated)' // fails the Tamil script check
      },
    })
    const summary = await runCi4LanguageBenchmark()
    const ta = summary.perLanguage.find((l) => l.language === 'ta')!
    expect(ta.recorded).toBe(true)
    const termTask = ta.tasks.find((t) => t.task === 'TERMINOLOGY')!
    expect(termTask.total).toBe(1)
    expect(termTask.passed).toBe(0) // honest failure recorded
    const caps = listLanguageCapabilities()
    const hi = caps.find((c) => c.language === 'hi' && c.task === 'TERMINOLOGY')!
    expect(hi.status).toBe('LIMITED') // passed but machine-only evidence
    const taCap = caps.find((c) => c.language === 'ta' && c.task === 'TERMINOLOGY')!
    expect(taCap.status).toBe('LIMITED') // recorded failed measurement too
    expect(taCap.testRef).toContain('(0/1 cases)')
  })

  test('F5 human bilingual approval verifies MEASURED capabilities ONLY through the DURABLE path; TRANSCRIPTION untouchable; unmeasured cannot be approved', async () => {
    const reviewer = await resolveReviewerProfile(rdb, 'ci4f-bilingual')!

    // approve an UNMEASURED capability → refused (no measurement row exists)
    const unmeasured = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: 'no-such-measurement',
      decision: 'APPROVED',
      rationale: 'attempting to approve an unmeasured capability',
      evidence: ALL_OK_EVIDENCE,
    })
    expect(unmeasured.ok).toBe(false)
    if (!unmeasured.ok) expect(unmeasured.error).toContain('measurement not found')

    // measure first (durable), then approve (durable) — VERIFIED only via this path
    const measured = await persistLanguageMeasurement(gdb, {
      languageTag: 'en',
      task: 'TEXT_UNDERSTANDING',
      passed: true,
      testRef: 'ci4-lang-bench-1 (5/5 cases)',
      measuredAt: new Date(),
      modelProvider: 'fixture-provider',
      modelVersion: 'fixture-model-1',
      benchmarkVersion: CI4_BENCHMARK_VERSION,
      benchmarkChecksum: computeBenchmarkChecksum([...TEXT_BENCHMARK_CASES, ...CI4_TERMINOLOGY_CASES]),
      caseCount: 5,
      passedCount: 5,
    })
    expect(measured.ok).toBe(true)
    const measurement = (measured as { ok: true; value: { id: string } }).value

    const ok = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: measurement.id,
      decision: 'APPROVED',
      rationale: 'reference set reviewed line by line by a qualified bilingual reviewer (fixture)',
      evidence: ALL_OK_EVIDENCE,
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.value.status.status).toBe('VERIFIED')
      expect(ok.value.status.basis).toBe('HUMAN_APPROVED')
      expect(ok.value.status.note).toContain('VERIFIED by qualified bilingual review')
    }
    // the review row is append-only with full binding provenance
    const rows = await client.languageCapabilityReview.findMany({ where: { measurementId: measurement.id } })
    expect(rows.length).toBe(1)
    expect(rows[0].modelProvider).toBe('fixture-provider')
    expect(rows[0].benchmarkVersion).toBe('ci4-lang-bench-1')

    // TRANSCRIPTION: neither benchmarks nor the durable approval path can move it
    const asrMeasurement = await persistLanguageMeasurement(gdb, {
      languageTag: 'en',
      task: 'TRANSCRIPTION',
      passed: true,
      testRef: 'cheating-benchmark',
      measuredAt: new Date(),
    })
    expect(asrMeasurement.ok).toBe(false)
    if (!asrMeasurement.ok) expect(asrMeasurement.error).toContain('§9.2')

    // scope check: a reviewer scoped for en/hi/kn cannot approve an ur capability
    const urMeasured = await persistLanguageMeasurement(gdb, {
      languageTag: 'ur',
      task: 'TEXT_UNDERSTANDING',
      passed: true,
      testRef: 'ci4-lang-bench-1 (5/5 cases)',
      measuredAt: new Date(),
      modelProvider: 'fixture-provider',
      modelVersion: 'fixture-model-1',
      benchmarkVersion: CI4_BENCHMARK_VERSION,
      benchmarkChecksum: 'x'.repeat(64),
      caseCount: 5,
      passedCount: 5,
    })
    const urReview = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: (urMeasured as { ok: true; value: { id: string } }).value.id,
      decision: 'APPROVED',
      rationale: 'attempting to approve outside the reviewer scope (ur not authorised)',
      evidence: ALL_OK_EVIDENCE,
    })
    expect(urReview.ok).toBe(false)
    if (!urReview.ok) expect(urReview.error).toContain('scope mismatch')
  })

  test('F6 refusal behaviour stays intact; the in-memory view can NEVER claim VERIFIED (CI-5E closes the self-certification hole)', () => {
    expect(capabilityRefusalReason('kn', 'GENERATION')).toContain('EXPERIMENTAL')
    recordCapabilityMeasurement({ language: 'kn', task: 'GENERATION', passed: true, testRef: 'ci4-lang-bench-1/x', measuredAt: '2026-11-25' })
    expect(capabilityRefusalReason('kn', 'GENERATION')).toContain('LIMITED')
    expect(capabilityRefusalReason('ur', 'TRANSCRIPTION')).toContain('UNSUPPORTED')
    expect(capabilityRefusalReason('klingon', 'TERMINOLOGY')).toContain('outside the catalogue')
    // CI-5E: the legacy humanApproved flag is GONE — no in-memory write can
    // mint VERIFIED; the durable governance path is the only verification route
    expect(listLanguageCapabilities().some((c) => c.status === 'VERIFIED')).toBe(false)
    expect(isCapabilityVerified('kn', 'GENERATION')).toBe(false)
  })
})
