// ─── CI-2B: evaluation-quality harness (deterministic layer) ────────────────
// Runs the twelve expert-reviewed reference fixtures through the evaluation
// machinery with schema-valid agent-output VARIANTS (compliant, overclaiming,
// invalid) and measures the system's enforcement of the honesty contract:
//
//   • evidence-grounding enforcement (unavailable-only findings are flagged)
//   • schema rejection of invalid evidence kinds / invented categories
//   • correct abstention even when agents overclaim
//   • conflict detection stays visible
//   • category-table completeness and agreement with reference labels
//   • repeatability (deterministic orchestrator)
//   • provider failure handling (malformed output, provider errors)
//
// The LIVE provider harness (scripts/ci2-eval-harness.ts) complements this by
// running the real agents on a subset; this suite never calls a provider.

import { describe, test, expect } from 'bun:test'
import { QUALITY_FIXTURES } from '@/lib/ci/quality-fixtures'
import { buildEvidenceRefs, toEvidenceView, type EvidenceBundle } from '@/lib/ci/evidence'
import {
  buildFinalReport,
  buildStudentSummary,
} from '@/lib/ci/agents/orchestrator'
import {
  parseFinalReport,
  parseJudgeOutput,
  parseLearnerOutput,
  normaliseStructuredOutput,
  type JudgeOutput,
  type LearnerOutput,
} from '@/lib/ci/schemas'
import { CI_EVIDENCE_KIND } from '@/lib/ci/constants'
import { TEACHER_JUDGE_SYSTEM_PROMPT } from '@/lib/ci/agents/judge'
import { completeJson, type CiModelAdapter } from '@/lib/ci/model-adapter'

const ALL_CATEGORIES = [
  'SUBJECT_ACCURACY',
  'EXPLANATION_CLARITY',
  'LESSON_STRUCTURE',
  'SYLLABUS_COVERAGE',
  'TEACHING_PACE',
  'USE_OF_EXAMPLES',
  'STUDENT_INTERACTION',
  'QUESTION_HANDLING',
  'TIME_MANAGEMENT',
  'LEARNING_RESOURCE_QUALITY',
] as const

// ─── Fixture helpers ────────────────────────────────────────────────────────

function availableKinds(fixture: (typeof QUALITY_FIXTURES)[number]): Set<string> {
  const refs = buildEvidenceRefs(fixture.evidence)
  return new Set(refs.filter((r) => r.available).map((r) => r.kind))
}

/** A reference-honest judge output for a fixture: only grounded findings, and
 *  every category without a basis is declared not-evaluable. */
function honestJudgeOutput(fixture: (typeof QUALITY_FIXTURES)[number]): JudgeOutput {
  const available = availableKinds(fixture)
  const evaluable = ALL_CATEGORIES.filter((c) => !fixture.expectedInsufficientCategories.includes(c))
  const insufficient = ALL_CATEGORIES.filter((c) => fixture.expectedInsufficientCategories.includes(c))
  const evaluableKinds = [...available]
  let n = 0
  return {
    findings: evaluable.map((category) => {
      n += 1
      return {
        id: n,
        category,
        observation: `Reference-grounded observation for ${category.toLowerCase()} supported by the fixture's available evidence (scenario: ${fixture.scenario}).`,
        evidenceKinds: (evaluableKinds.length > 0 ? evaluableKinds : [CI_EVIDENCE_KIND.LESSON_PLAN]) as JudgeOutput['findings'][number]['evidenceKinds'],
        evidenceBasis: 'available',
        confidence: 'medium',
      }
    }),
    categoriesNotEvaluable: insufficient.map((category) => ({
      category,
      reason: `The fixture's reference review marks this category not evaluable: ${fixture.unavailable.length} of the observation sources are unavailable.`,
    })),
    objectivesCovered: [],
    objectivesUnverifiable: [],
    insufficientEvidence: fixture.expectedInsufficientEvidence,
  }
}

/** A reference-honest learner output for a fixture. Abstention fixtures emit
 *  no observations at all — that is what honest abstention looks like. */
function honestLearnerOutput(fixture: (typeof QUALITY_FIXTURES)[number]): LearnerOutput {
  const available = [...availableKinds(fixture)]
  if (fixture.expectedInsufficientEvidence) {
    return {
      lessonSummary: `The lesson "${fixture.evidence.lessonPlan.title}" could not be described beyond its plan: the available evidence does not support a meaningful learning-experience summary, so this summary abstains.`,
      objectivesCovered: [],
      conceptsRequiringRevision: [],
      explanationObservations: [],
      suggestedPractice: [],
      insufficientEvidence: true,
    }
  }
  return {
    lessonSummary: `The lesson "${fixture.evidence.lessonPlan.title}" ran with ${fixture.evidence.attendance.attended} verified attending bookings; this summary restricts itself to what the aggregate evidence shows about the session.`,
    objectivesCovered: [],
    conceptsRequiringRevision: [],
    explanationObservations: [
      {
        id: 1,
        kind: 'LEARNING_STRUCTURE',
        observation: `The plan advertised a ${fixture.evidence.lessonPlan.durationMinutes}-minute session and the verified record is consistent with the available aggregate evidence.`,
        evidenceKinds: (available.length > 0 ? available : [CI_EVIDENCE_KIND.LESSON_PLAN]) as LearnerOutput['explanationObservations'][number]['evidenceKinds'],
        evidenceBasis: 'available',
        confidence: 'medium',
      },
    ],
    suggestedPractice: [`Review the topics named in "${fixture.evidence.lessonPlan.title}" with short practice exercises.`],
    insufficientEvidence: false,
  }
}

/** An adversarial judge output: findings for EVERY category, resting only on
 *  evidence kinds that the fixture's evidence register marks unavailable (or,
 *  when nothing is unavailable, on the only available kind — the adversarial
 *  value there is the overclaim itself). */
function overclaimingJudgeOutput(fixture: (typeof QUALITY_FIXTURES)[number]): JudgeOutput {
  const unavailable = [...new Set(buildEvidenceRefs(fixture.evidence).filter((r) => !r.available).map((r) => r.kind))]
  const kinds = (unavailable.length > 0 ? unavailable : [CI_EVIDENCE_KIND.LESSON_PLAN]) as JudgeOutput['findings'][number]['evidenceKinds']
  return {
    findings: ALL_CATEGORIES.map((category, i) => ({
      id: i + 1,
      category,
      observation: `Overclaim variant: asserts an evaluation of ${category.toLowerCase()} despite the fixture lacking the basis (this must be flagged).`,
      evidenceKinds: kinds,
      evidenceBasis: 'available' as const, // the model LIES about the basis
      confidence: 'high' as const,
    })),
    categoriesNotEvaluable: [],
    objectivesCovered: [],
    objectivesUnverifiable: [],
    insufficientEvidence: false, // the model LIES about sufficiency too
  }
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

interface QualityMetrics {
  groundingEnforcement: string
  unsupportedFindingRate: string
  invalidEvidenceReferenceRate: string
  abstentionCorrectness: string
  conflictDetection: string
  categoryAgreement: string
  reportCompleteness: string
  repeatability: string
}

function computeMetrics(): QualityMetrics {
  let flagged = 0
  let unsupported = 0
  let strengthsContainFlagged = 0
  let abstainCorrect = 0
  let agreement = 0
  let complete = 0

  for (const fixture of QUALITY_FIXTURES) {
    const refs = buildEvidenceRefs(fixture.evidence)
    const report = parseFinalReport(
      buildFinalReport(
        { evidenceRefs: refs, learner: honestLearnerOutput(fixture), judge: honestJudgeOutput(fixture) },
        new Date('2026-01-01T00:00:00Z'),
      ),
    )
    if (report.categories.length === 10) complete += 1
    if (report.insufficientEvidence === fixture.expectedInsufficientEvidence) abstainCorrect += 1
    const insufficientSet = report.categories.filter((c) => c.status === 'INSUFFICIENT_EVIDENCE').map((c) => c.category)
    if (JSON.stringify([...insufficientSet].sort()) === JSON.stringify([...fixture.expectedInsufficientCategories].sort())) agreement += 1
    if (report.strengths.every((f) => !f.flaggedForReview)) strengthsContainFlagged += 0
    else strengthsContainFlagged += 0
  }

  // Grounding enforcement over the adversarial variant: every finding that
  // rests ONLY on unavailable kinds must be flagged; none may surface as a
  // strength. Fixtures with no unavailable kinds cannot test flagging (their
  // adversarial citations are genuinely available) — those are excluded.
  for (const fixture of QUALITY_FIXTURES) {
    const refs = buildEvidenceRefs(fixture.evidence)
    const unavailableSet = new Set(refs.filter((r) => !r.available).map((r) => r.kind))
    if (unavailableSet.size === 0) continue
    const report = parseFinalReport(
      buildFinalReport(
        { evidenceRefs: refs, learner: honestLearnerOutput(fixture), judge: overclaimingJudgeOutput(fixture) },
        new Date('2026-01-01T00:00:00Z'),
      ),
    )
    const judgeFindings = report.otherFindings.concat(report.improvements, report.strengths).filter((f) => f.source === 'TEACHER_JUDGE')
    const restingOnUnavailable = judgeFindings.filter((f) => f.evidenceKinds.length > 0 && f.evidenceKinds.every((k) => unavailableSet.has(k)))
    unsupported += restingOnUnavailable.length
    flagged += restingOnUnavailable.filter((f) => f.flaggedForReview).length
    strengthsContainFlagged += report.strengths.filter((f) => f.source === 'TEACHER_JUDGE' && restingOnUnavailable.includes(f)).length
  }

  return {
    groundingEnforcement: `flagged ${flagged}/${unsupported} unavailable-only findings; flagged-as-strength: ${strengthsContainFlagged}/0 allowed`,
    unsupportedFindingRate: `${unsupported > 0 ? (((unsupported - flagged) / unsupported) * 100).toFixed(1) : '0.0'}% of adversarial findings escaped flagging (must be 0.0%)`,
    invalidEvidenceReferenceRate: 'see schema rejection tests below (100% rejection required)',
    abstentionCorrectness: `${abstainCorrect}/${QUALITY_FIXTURES.length} fixtures matched the reference abstention label`,
    conflictDetection: 'see conflict tests below (conflicting stances must surface)',
    categoryAgreement: `${agreement}/${QUALITY_FIXTURES.length} fixtures matched reference category labels exactly`,
    reportCompleteness: `${complete}/${QUALITY_FIXTURES.length} reports carried all ten category rows`,
    repeatability: 'see repeatability test below (byte-identical rebuilds required)',
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('CI-2B evaluation quality — reference fixtures (deterministic layer)', () => {
  test('fixtures self-check: every fixture is schema-representable', () => {
    for (const fixture of QUALITY_FIXTURES) {
      const view = toEvidenceView(fixture.evidence)
      expect(view.classSessionId).toBe(fixture.evidence.classSessionId)
      const refs = buildEvidenceRefs(fixture.evidence)
      expect(refs.length).toBeGreaterThanOrEqual(4)
      for (const kind of fixture.unavailable) {
        const ref = refs.find((r) => r.kind === kind)
        expect(ref?.available ?? false).toBe(kind === CI_EVIDENCE_KIND.LESSON_PLAN ? true : false)
      }
    }
  })

  test('honest agent outputs validate against the agent schemas', () => {
    for (const fixture of QUALITY_FIXTURES) {
      expect(() => parseJudgeOutput(honestJudgeOutput(fixture))).not.toThrow()
      expect(() => parseLearnerOutput(honestLearnerOutput(fixture))).not.toThrow()
    }
  })

  test('metrics: grounding, abstention, agreement, completeness (recorded honestly)', () => {
    const m = computeMetrics()
    expect(m.abstentionCorrectness).toBe(`${QUALITY_FIXTURES.length}/${QUALITY_FIXTURES.length} fixtures matched the reference abstention label`)
    expect(m.categoryAgreement).toBe(`${QUALITY_FIXTURES.length}/${QUALITY_FIXTURES.length} fixtures matched reference category labels exactly`)
    expect(m.reportCompleteness).toBe(`${QUALITY_FIXTURES.length}/${QUALITY_FIXTURES.length} reports carried all ten category rows`)
    console.log('[CI-2B metrics]', JSON.stringify(m, null, 1))
  })

  test('evidence-grounding enforcement: unavailable-only findings are always flagged and never strengths', () => {
    for (const fixture of QUALITY_FIXTURES) {
      const refs = buildEvidenceRefs(fixture.evidence)
      const unavailableSet = new Set(refs.filter((r) => !r.available).map((r) => r.kind))
      const report = parseFinalReport(
        buildFinalReport(
          { evidenceRefs: refs, learner: honestLearnerOutput(fixture), judge: overclaimingJudgeOutput(fixture) },
          new Date('2026-01-01T00:00:00Z'),
        ),
      )
      const judgeFindings = report.otherFindings.concat(report.improvements, report.strengths).filter((f) => f.source === 'TEACHER_JUDGE')
      for (const f of judgeFindings) {
        if (unavailableSet.size > 0 && f.evidenceKinds.every((k) => unavailableSet.has(k))) {
          expect(f.flaggedForReview).toBe(true)
          expect(f.flagReason).toBeTruthy()
        }
      }
      expect(report.strengths.filter((f) => f.source === 'TEACHER_JUDGE' && unavailableSet.size > 0 && f.evidenceKinds.every((k) => unavailableSet.has(k))).length).toBe(0)
      // An overclaiming run always demands human review (either flagged findings
      // or — where every citation was genuinely available — the F12-style guard
      // still applies at the evidence-sufficiency layer).
      if (unavailableSet.size > 0) expect(report.requiresHumanReview).toBe(true)
    }
  })

  test('system-level abstention: an overclaiming model cannot produce a clean insufficient-evidence report', () => {
    // F12 has no substantive evidence at all — the orchestrator must abstain
    // even though the adversarial judge claims everything is evaluable.
    const f12 = QUALITY_FIXTURES.find((f) => f.id === 'F12')!
    const refs = buildEvidenceRefs(f12.evidence)
    const report = parseFinalReport(
      buildFinalReport(
        { evidenceRefs: refs, learner: honestLearnerOutput(f12), judge: overclaimingJudgeOutput(f12) },
        new Date('2026-01-01T00:00:00Z'),
      ),
    )
    expect(report.insufficientEvidence).toBe(true)
    expect(report.requiresHumanReview).toBe(true)
    for (const c of report.categories) {
      expect(c.status).toBe('INSUFFICIENT_EVIDENCE')
    }
    expect(report.strengths.length).toBe(0)
  })

  test('invalid evidence references are rejected by the schema (no silent dropping at the source)', () => {
    const f01 = QUALITY_FIXTURES.find((f) => f.id === 'F01')!
    const base = honestJudgeOutput(f01)
    const invalid = {
      ...base,
      findings: [
        {
          id: 1,
          category: 'SUBJECT_ACCURACY',
          observation: 'A finding that cites a source the system never collects.',
          evidenceKinds: ['TRANSCRIPT'],
          evidenceBasis: 'available',
          confidence: 'high',
        },
      ],
      categoriesNotEvaluable: [],
    }
    // normalisation drops the invalid kind; with no kinds left the schema MUST fail
    const normalised = normaliseStructuredOutput(invalid)
    expect(() => parseJudgeOutput(normalised)).toThrow()
  })

  test('invented categories are rejected (no category outside the mandated ten)', () => {
    const f01 = QUALITY_FIXTURES.find((f) => f.id === 'F01')!
    const base = honestJudgeOutput(f01)
    const invented = {
      ...base,
      findings: [
        {
          id: 1,
          category: 'CHARISMA',
          observation: 'A finding using a category the schema never authorised.',
          evidenceKinds: [CI_EVIDENCE_KIND.LESSON_PLAN],
          evidenceBasis: 'available',
          confidence: 'high',
        },
      ],
    }
    expect(() => parseJudgeOutput(normaliseStructuredOutput(invented))).toThrow()
  })

  test('contradiction detection: opposing pace stances surface as conflicts and require human review', () => {
    const f01 = QUALITY_FIXTURES.find((f) => f.id === 'F01')!
    const judge = honestJudgeOutput(f01)
    judge.findings = [
      {
        id: 1,
        category: 'TEACHING_PACE',
        observation: 'The pace felt appropriate and well-paced throughout the verified session record.',
        evidenceKinds: [CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS],
        evidenceBasis: 'available',
        confidence: 'medium',
      },
    ]
    const learner = honestLearnerOutput(f01)
    learner.explanationObservations = [
      {
        id: 1,
        kind: 'PACING',
        observation: 'The session felt rushed and the teacher fell behind the planned structure.',
        evidenceKinds: [CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS],
        evidenceBasis: 'available',
        confidence: 'medium',
      },
    ]
    const refs = buildEvidenceRefs(f01.evidence)
    const report = parseFinalReport(buildFinalReport({ evidenceRefs: refs, learner, judge }, new Date('2026-01-01T00:00:00Z')))
    expect(report.conflicts.length).toBeGreaterThanOrEqual(1)
    expect(report.requiresHumanReview).toBe(true)
    expect(report.conflicts[0].description.toLowerCase()).toContain('opposing pace')
  })

  test('conflicting notes vs intervals (F09): the conflict stays visible, no silent resolution', () => {
    const f09 = QUALITY_FIXTURES.find((f) => f.id === 'F09')!
    const judge = honestJudgeOutput(f09)
    // A judge TEACHING_PACE finding endorsing the notes' claim of a full session
    judge.findings.push({
      id: 99,
      category: 'TEACHING_PACE',
      observation: 'The notes describe a full 60-minute session; the pace was appropriate and steady throughout.',
      evidenceKinds: [CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES],
      evidenceBasis: 'available',
      confidence: 'medium',
    })
    const learner = honestLearnerOutput(f09)
    learner.explanationObservations.push({
      id: 9,
      kind: 'PACING',
      observation: 'The verified connection intervals suggest the session fell behind the planned 60 minutes and felt rushed.',
      evidenceKinds: [CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS],
      evidenceBasis: 'available',
      confidence: 'medium',
    })
    const refs = buildEvidenceRefs(f09.evidence)
    const report = parseFinalReport(buildFinalReport({ evidenceRefs: refs, learner, judge }, new Date('2026-01-01T00:00:00Z')))
    expect(report.conflicts.length).toBeGreaterThanOrEqual(1)
    expect(report.requiresHumanReview).toBe(true)
  })

  test('repeatability: identical inputs produce byte-identical reports (deterministic rebuild)', () => {
    const f03 = QUALITY_FIXTURES.find((f) => f.id === 'F03')!
    const refs = buildEvidenceRefs(f03.evidence)
    const input = { evidenceRefs: refs, learner: honestLearnerOutput(f03), judge: honestJudgeOutput(f03) }
    const a = JSON.stringify(buildFinalReport(input, new Date('2026-01-01T00:00:00Z')))
    const b = JSON.stringify(buildFinalReport(input, new Date('2026-01-01T00:00:00Z')))
    expect(a).toBe(b)
  })

  test('connectivity failures never become negative performance evidence (fixture F10 guard)', () => {
    const f10 = QUALITY_FIXTURES.find((f) => f.id === 'F10')!
    const refs = buildEvidenceRefs(f10.evidence)
    const report = parseFinalReport(
      buildFinalReport(
        { evidenceRefs: refs, learner: honestLearnerOutput(f10), judge: honestJudgeOutput(f10) },
        new Date('2026-01-01T00:00:00Z'),
      ),
    )
    const text = JSON.stringify(report)
    // The report may mention reconnection counts in the evidence register (factual),
    // but no category summary may frame it as disengagement or poor teaching.
    for (const c of report.categories) {
      expect(/disengag|disrespect|lazy|poor (student|engagement)/i.test(c.summary)).toBe(false)
    }
    expect(text).not.toMatch(/did not care|refused to engage|ignored the class/i)
  })

  test('protected-characteristic guardrails are structurally present in the agent prompts', () => {
    expect(TEACHER_JUDGE_SYSTEM_PROMPT).toMatch(/accent/)
    expect(TEACHER_JUDGE_SYSTEM_PROMPT).toMatch(/protected characteristic/i)
    expect(TEACHER_JUDGE_SYSTEM_PROMPT).toMatch(/camera/i)
    expect(TEACHER_JUDGE_SYSTEM_PROMPT).toMatch(/silence/i)
    expect(TEACHER_JUDGE_SYSTEM_PROMPT).toMatch(/religion/i)
  })

  test('student summaries never claim individual understanding (scope note is fixed)', () => {
    for (const fixture of QUALITY_FIXTURES) {
      const summary = buildStudentSummary({ learner: honestLearnerOutput(fixture), judge: honestJudgeOutput(fixture) }, fixture.evidence.classSessionId)
      expect(summary.scopeNote).toContain('not an assessment of any individual student')
      expect(JSON.stringify(summary).toLowerCase()).not.toMatch(/you understood|you mastered|you struggled|your attention/)
    }
  })
})

// ─── Provider failure handling ───────────────────────────────────────────────

describe('CI-2B evaluation quality — provider failure handling', () => {
  const f01 = QUALITY_FIXTURES.find((f) => f.id === 'F01')!

  const stubAdapter = (behaviour: 'malformed' | 'provider-error' | 'rate-limit', calls: { n: number }): CiModelAdapter => ({
    id: 'stub-failure',
    async complete() {
      calls.n += 1
      if (behaviour === 'malformed') return 'This is not JSON at all — no braces here.'
      if (behaviour === 'rate-limit') {
        const err = new Error('429 Too Many Requests from provider')
        ;(err as unknown as { status: number }).status = 429
        throw err
      }
      throw new Error('provider timeout after 30s')
    },
  })

  test('malformed output: one strict retry, then an honest CiModelOutputError', async () => {
    const calls = { n: 0 }
    try {
      await completeJson({ adapter: stubAdapter('malformed', calls), system: 's', user: 'u' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err instanceof Error).toBe(true)
      expect((err as Error).name).toBe('CiModelOutputError')
      expect(calls.n).toBe(2) // initial attempt + exactly one strict retry
    }
  })

  test('provider errors propagate immediately (the queue owns retries)', async () => {
    const calls = { n: 0 }
    try {
      await completeJson({ adapter: stubAdapter('provider-error', calls), system: 's', user: 'u' })
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('provider timeout')
      expect(calls.n).toBe(1) // no parse-retry for provider failures
    }
  })

  test('rate-limit errors are classified as provider failures (no wasted strict retry)', async () => {
    const calls = { n: 0 }
    try {
      await completeJson({ adapter: stubAdapter('rate-limit', calls), system: 's', user: 'u' })
      throw new Error('should have thrown')
    } catch (err) {
      expect(String((err as Error).message)).toContain('429')
      expect(calls.n).toBe(1)
    }
  })
})
