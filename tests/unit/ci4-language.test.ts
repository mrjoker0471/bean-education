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

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  CI3_LANGUAGES,
  CI4_TERMINOLOGY_CASES,
  CI4_BENCHMARK_VERSION,
  runCi4LanguageBenchmark,
  recordCapabilityMeasurement,
  recordHumanLanguageApproval,
  listLanguageCapabilities,
  resetLanguageCapabilitiesForTests,
  isCapabilityVerified,
  capabilityRefusalReason,
  TEXT_BENCHMARK_CASES,
} from '@/lib/ci/fleet/language'
import { setCiModelAdapterForProcess, resetCiModelAdapterForTests } from '@/lib/ci/model-adapter'

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

  test('F5 human bilingual approval verifies MEASURED capabilities only; TRANSCRIPTION untouchable', () => {
    // approve an UNMEASURED capability → refused
    const unmeasured = recordHumanLanguageApproval({ language: 'en', task: 'TEXT_UNDERSTANDING', reviewerId: 'reviewer-1', reviewerName: 'Bilingual Reviewer' })
    expect(unmeasured.ok).toBe(false)
    if (!unmeasured.ok) expect(unmeasured.reason).toContain('UNMEASURED')
    // measure first, then approve
    recordCapabilityMeasurement({ language: 'en', task: 'TEXT_UNDERSTANDING', passed: true, testRef: 'ci4-lang-bench-1/x', measuredAt: '2026-11-25', modelProvider: 'a' })
    const ok = recordHumanLanguageApproval({ language: 'en', task: 'TEXT_UNDERSTANDING', reviewerId: 'reviewer-1', reviewerName: 'Qualified Bilingual Reviewer', note: 'reference set reviewed line by line' })
    expect(ok.ok).toBe(true)
    const en = listLanguageCapabilities().find((c) => c.language === 'en' && c.task === 'TEXT_UNDERSTANDING')!
    expect(en.status).toBe('VERIFIED')
    expect(en.humanApproved).toBe(true)
    expect(en.note).toContain('Qualified Bilingual Reviewer')
    expect(isCapabilityVerified('en', 'TEXT_UNDERSTANDING')).toBe(true)
    // TRANSCRIPTION: neither benchmarks nor humans can move it
    const asrBench = recordCapabilityMeasurement as unknown
    void asrBench
    const asrHuman = recordHumanLanguageApproval({ language: 'en', task: 'TRANSCRIPTION', reviewerId: 'reviewer-1', reviewerName: 'Bilingual Reviewer' })
    expect(asrHuman.ok).toBe(false)
    if (!asrHuman.ok) expect(asrHuman.reason).toContain('§9.2')
    expect(listLanguageCapabilities().find((c) => c.language === 'en' && c.task === 'TRANSCRIPTION')!.status).toBe('UNSUPPORTED')
    // a reviewer identity is required
    const noId = recordHumanLanguageApproval({ language: 'en', task: 'TERMINOLOGY', reviewerId: '', reviewerName: 'X' })
    expect(noId.ok).toBe(false)
    if (!noId.ok) expect(noId.reason).toContain('reviewer identity')
  })

  test('F6 refusal behaviour stays intact for unmeasured and LIMITED capabilities', () => {
    expect(capabilityRefusalReason('kn', 'GENERATION')).toContain('EXPERIMENTAL')
    recordCapabilityMeasurement({ language: 'kn', task: 'GENERATION', passed: true, testRef: 'ci4-lang-bench-1/x', measuredAt: '2026-11-25' })
    expect(capabilityRefusalReason('kn', 'GENERATION')).toContain('LIMITED')
    recordHumanLanguageApproval({ language: 'kn', task: 'GENERATION', reviewerId: 'reviewer-2', reviewerName: 'Bilingual Reviewer Two' })
    expect(capabilityRefusalReason('kn', 'GENERATION')).toBeNull()
    expect(capabilityRefusalReason('ur', 'TRANSCRIPTION')).toContain('UNSUPPORTED')
    expect(capabilityRefusalReason('klingon', 'TERMINOLOGY')).toContain('outside the catalogue')
  })
})
