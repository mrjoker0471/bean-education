// ─── BEAN Classroom Intelligence (CI-5F): expert-labelled benchmark programme ──
// Independent, BEAN-authored datasets with expert reference labels, strict
// split separation and honest measured metrics.
//
// Hard rules:
//   • Datasets carry BEAN-authored original material (or licence-recorded
//     material). Nothing here is ingested into retrieval packs, prompts or
//     training inputs (no import from retrieval/packs modules — leakage
//     prevention is structural).
//   • Splits are enforced: BLIND_HOLDOUT labels cannot be written through the
//     normal path (holdout scoring reads sealed reference data only), and
//     blind-holdout cases never appear in development views.
//   • Expert reference labels may record MULTIPLE acceptable answers and
//     explicit prohibited conclusions; two labels for one case are BOTH
//     preserved (never averaged, never silently favourable).
//   • Metrics always carry sample sizes, task scope, model version and the
//     evaluation method. A percentage without its sample size is never
//     published.
//   • NO SELF-CERTIFICATION: a run is a measurement only. It never mutates
//     ClassroomPackReview, LanguageCapabilityStatus, or any other governance
//     ledger. ran=false (no adapter / no executable path) is recorded
//     honestly; metrics are never fabricated.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { reviewerCanReviewDomain, reviewerCanReviewLanguage, type ReviewerProfileRow } from './reviewers'
import type { Ci3LanguageTask } from './language'

// ─── Structural DB view ───────────────────────────────────────────────────────

export interface DatasetRow {
  id: string
  slug: string
  name: string
  taskKind: string
  split: string
  version: string
  checksum: string
  licence: string
  domain: string
  languageTag: string
  casesJson: string
  createdBy: string
  createdAt: Date
}

export interface CaseLabelRow {
  id: string
  datasetId: string
  datasetVersion: string
  caseKey: string
  reviewerProfileId: string
  reviewerCode: string
  expectedResults: string
  prohibitedConclusions: string
  supportingSources: string
  confidence: string
  ambiguityNote: string | null
  rubricVersion: string
  createdAt: Date
}

export interface BenchmarkRunRow {
  id: string
  datasetId: string
  datasetVersion: string
  datasetChecksum: string
  agentKind: string
  agentDomain: string
  modelProvider: string
  modelVersion: string
  metricsJson: string
  ran: boolean
  runReason: string
  expertLabelCount: number
  runBy: string
  createdAt: Date
}

export interface BenchmarkDb {
  expertBenchmarkDataset: {
    create(args: { data: Record<string, unknown> }): Promise<DatasetRow>
    findFirst(args?: Record<string, unknown>): Promise<DatasetRow | null>
    findMany(args?: Record<string, unknown>): Promise<DatasetRow[]>
  }
  expertBenchmarkCaseLabel: {
    create(args: { data: Record<string, unknown> }): Promise<CaseLabelRow>
    findFirst(args?: Record<string, unknown>): Promise<CaseLabelRow | null>
    findMany(args?: Record<string, unknown>): Promise<CaseLabelRow[]>
  }
  expertBenchmarkRun: {
    create(args: { data: Record<string, unknown> }): Promise<BenchmarkRunRow>
    findFirst(args?: Record<string, unknown>): Promise<BenchmarkRunRow | null>
    findMany(args?: Record<string, unknown>): Promise<BenchmarkRunRow[]>
  }
}

export function benchmarkDbFromPrisma(client: unknown): BenchmarkDb {
  return client as BenchmarkDb
}

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const EXPERT_BENCHMARK_TASK_KINDS = [
  'SUBJECT_CORRECTNESS',
  'EXPLANATION_QUALITY',
  'REASONING',
  'SOURCE_FIDELITY',
  'CITATION_ACCURACY',
  'SYLLABUS_ALIGNMENT',
  'LESSON_SUMMARY_QUALITY',
  'TEACHING_EVALUATION',
  'REFUSAL_ACCURACY',
  'UNCERTAINTY_HANDLING',
  'HANDOFF_QUALITY',
  'MULTILINGUAL_QUALITY',
] as const
export type ExpertBenchmarkTaskKind = (typeof EXPERT_BENCHMARK_TASK_KINDS)[number]

export const BENCHMARK_SPLITS = ['DEVELOPMENT', 'CALIBRATION', 'VALIDATION', 'BLIND_HOLDOUT'] as const
export type BenchmarkSplit = (typeof BENCHMARK_SPLITS)[number]

export const EXPERT_AGENTS = [
  'LEARNER',
  'TEACHER_JUDGE',
  'SUBJECT_SPECIALIST',
  'LANGUAGE_SPECIALIST',
  'EVIDENCE_AUDITOR',
  'SAFETY_GUARDIAN',
  'EVALUATION_ORCHESTRATOR',
  'TEACHER_COACH',
  'REVISION_COACH',
] as const
export type ExpertAgentKind = (typeof EXPERT_AGENTS)[number]

export const LABEL_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const
export const EXPERT_LABEL_RUBRIC_VERSION = 'ci5-expert-label-rubric-1'

// ─── Dataset creation ─────────────────────────────────────────────────────────

export const benchmarkCaseSchema = z.object({
  caseKey: z.string().min(3).max(80),
  prompt: z.string().min(10).max(4000),
  /** Deterministic fallback scoring when no expert label exists (structural checks only). */
  deterministicCheck: z.enum(['EXACT_TERM_PRESENT', 'REFUSAL_STRUCTURE', 'CITATION_PRESENT', 'NONE']).default('NONE'),
  /** The exact term / token the deterministic check looks for, when applicable. */
  deterministicNeedle: z.string().max(400).optional(),
}).strict()
export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>

export const createDatasetSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  name: z.string().min(4).max(160),
  taskKind: z.enum(EXPERT_BENCHMARK_TASK_KINDS),
  split: z.enum(BENCHMARK_SPLITS),
  version: z.string().min(1).max(40),
  licence: z.string().min(4).max(160),
  domain: z.string().max(80).optional(),
  languageTag: z.string().max(12).optional(),
  cases: z.array(benchmarkCaseSchema).min(1, 'a dataset needs at least one case').max(500),
}).strict()

export function computeDatasetChecksum(cases: BenchmarkCase[]): string {
  const canonical = cases.map((c) => ({ caseKey: c.caseKey, prompt: c.prompt, deterministicCheck: c.deterministicCheck, deterministicNeedle: c.deterministicNeedle ?? null })).sort((a, b) => a.caseKey.localeCompare(b.caseKey))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export type BenchmarkOpResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string }

export async function createBenchmarkDataset(db: BenchmarkDb, actor: { studentId: string; displayName: string }, input: unknown): Promise<BenchmarkOpResult<DatasetRow>> {
  const parsed = createDatasetSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid dataset: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const data = parsed.data
  const existing = await db.expertBenchmarkDataset.findFirst({ where: { slug: data.slug, version: data.version } })
  if (existing) {
    return { ok: false, status: 409, error: `dataset ${data.slug} v${data.version} already exists — dataset versions are immutable; create a new version` }
  }
  const created = await db.expertBenchmarkDataset.create({
    data: {
      slug: data.slug,
      name: data.name,
      taskKind: data.taskKind,
      split: data.split,
      version: data.version,
      checksum: computeDatasetChecksum(data.cases),
      licence: data.licence,
      domain: data.domain ?? '',
      languageTag: data.languageTag ?? '',
      casesJson: JSON.stringify(data.cases),
      createdBy: actor.studentId,
    },
  })
  return { ok: true, value: created }
}

// ─── Expert reference labels ──────────────────────────────────────────────────

export const caseLabelSchema = z.object({
  datasetSlug: z.string().min(3).max(60),
  datasetVersion: z.string().min(1).max(40),
  caseKey: z.string().min(3).max(80),
  expectedResults: z.object({
    expected: z.string().min(1).max(2000),
    acceptedAlternatives: z.array(z.string().min(1).max(1000)).max(10).default([]),
  }).strict(),
  prohibitedConclusions: z.array(z.string().min(3).max(500)).max(10).default([]),
  supportingSources: z.array(z.string().min(3).max(300)).max(10).default([]),
  confidence: z.enum(LABEL_CONFIDENCE),
  ambiguityNote: z.string().max(1000).optional(),
}).strict()

/**
 * Add an expert reference label. The reviewer must be ACTIVE and scoped for
 * the dataset's domain/language. BLIND_HOLDOUT labels are refused through this
 * path (holdout references are sealed — labelling them before scoring would
 * break the blind evaluation); a dedicated sealed-import path exists for the
 * scoring system only.
 */
export async function addExpertCaseLabel(db: BenchmarkDb, reviewer: ReviewerProfileRow, input: unknown): Promise<BenchmarkOpResult<CaseLabelRow>> {
  const parsed = caseLabelSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid expert label: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  if (reviewer.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: `reviewer is ${reviewer.status} — only an ACTIVE qualified reviewer records reference labels` }
  }
  const data = parsed.data
  const dataset = await db.expertBenchmarkDataset.findFirst({ where: { slug: data.datasetSlug, version: data.datasetVersion } })
  if (!dataset) return { ok: false, status: 404, error: 'dataset version not found' }
  if (dataset.split === 'BLIND_HOLDOUT') {
    return { ok: false, status: 403, error: 'BLIND_HOLDOUT datasets cannot be labelled through the open path — holdout references are sealed until scoring to keep the evaluation blind' }
  }
  const cases = JSON.parse(dataset.casesJson) as BenchmarkCase[]
  if (!cases.some((c) => c.caseKey === data.caseKey)) {
    return { ok: false, status: 404, error: `case "${data.caseKey}" does not exist in ${data.datasetSlug} v${data.datasetVersion}` }
  }
  // Scope match: domain-scoped datasets need the exact domain; language-scoped
  // datasets need the exact language/task scope.
  if (dataset.domain && !reviewerCanReviewDomain(reviewer, dataset.domain)) {
    return { ok: false, status: 403, error: `reviewer is not authorised for domain "${dataset.domain}" — scope mismatch` }
  }
  if (dataset.languageTag && !reviewerCanReviewLanguage(reviewer, dataset.languageTag, 'TEXT_UNDERSTANDING' as Ci3LanguageTask, dataset.domain || null)) {
    return { ok: false, status: 403, error: `reviewer is not authorised for language "${dataset.languageTag}" — scope mismatch` }
  }
  const existing = await db.expertBenchmarkCaseLabel.findFirst({ where: { datasetId: dataset.id, datasetVersion: dataset.version, caseKey: data.caseKey, reviewerProfileId: reviewer.id } })
  if (existing) {
    return { ok: false, status: 409, error: 'this reviewer already labelled this case — labels are append-only per reviewer; a revision is a NEW label from a re-review event, never an overwrite' }
  }
  const created = await db.expertBenchmarkCaseLabel.create({
    data: {
      datasetId: dataset.id,
      datasetVersion: dataset.version,
      caseKey: data.caseKey,
      reviewerProfileId: reviewer.id,
      reviewerCode: reviewer.reviewerCode,
      expectedResults: JSON.stringify(data.expectedResults),
      prohibitedConclusions: JSON.stringify(data.prohibitedConclusions),
      supportingSources: JSON.stringify(data.supportingSources),
      confidence: data.confidence,
      ambiguityNote: data.ambiguityNote ?? null,
      rubricVersion: EXPERT_LABEL_RUBRIC_VERSION,
    },
  })
  return { ok: true, value: created }
}

// ─── Harness + metrics ────────────────────────────────────────────────────────

export interface CaseScore {
  caseKey: string
  passed: boolean
  scoredAgainst: 'EXPERT_LABEL' | 'DETERMINISTIC_CHECK'
  detail: string
}

export interface RunMetrics {
  method: string
  sampleSize: number
  expertLabelledSample: number
  deterministicOnlySample: number
  accuracy: number | null
  prohibitedConclusionViolations: number
  falseRefusalCount: number | null
  notes: string[]
}

/**
 * Score one reply against an expert label (multiple acceptable answers honoured,
 * prohibited conclusions checked) or the deterministic check.
 */
export function scoreReply(caseDef: BenchmarkCase, reply: string, label: {
  expectedResults: { expected: string; acceptedAlternatives: string[] }
  prohibitedConclusions: string[]
} | null): CaseScore {
  if (label) {
    const acceptable = [label.expectedResults.expected, ...label.expectedResults.acceptedAlternatives]
    const matched = acceptable.find((a) => reply.includes(a))
    const prohibitedHit = label.prohibitedConclusions.find((p) => reply.includes(p))
    if (prohibitedHit) {
      return { caseKey: caseDef.caseKey, passed: false, scoredAgainst: 'EXPERT_LABEL', detail: `reply contained a prohibited conclusion ("${prohibitedHit.slice(0, 80)}")` }
    }
    return {
      caseKey: caseDef.caseKey,
      passed: !!matched,
      scoredAgainst: 'EXPERT_LABEL',
      detail: matched ? 'reply matched an acceptable expert reference answer' : `reply did not match any accepted expert reference answer (${acceptable.length} accepted variants)`,
    }
  }
  // deterministic fallback (structural checks only)
  switch (caseDef.deterministicCheck) {
    case 'EXACT_TERM_PRESENT':
      return { caseKey: caseDef.caseKey, passed: !!caseDef.deterministicNeedle && reply.includes(caseDef.deterministicNeedle), scoredAgainst: 'DETERMINISTIC_CHECK', detail: 'exact-term presence check' }
    case 'REFUSAL_STRUCTURE':
      return { caseKey: caseDef.caseKey, passed: /"refuse"\s*:\s*true/.test(reply), scoredAgainst: 'DETERMINISTIC_CHECK', detail: 'structured refusal check' }
    case 'CITATION_PRESENT':
      return { caseKey: caseDef.caseKey, passed: /\[\d+\]|source:/i.test(reply), scoredAgainst: 'DETERMINISTIC_CHECK', detail: 'citation-presence check' }
    default:
      return { caseKey: caseDef.caseKey, passed: false, scoredAgainst: 'DETERMINISTIC_CHECK', detail: 'no expert label and no deterministic check — case excluded from scored metrics' }
  }
}

export async function runBenchmarkHarness(
  db: BenchmarkDb,
  opts: {
    datasetSlug: string
    datasetVersion: string
    agentKind: ExpertAgentKind
    agentDomain?: string
    runBy: string
    /** Adapter-like executor: (prompt) => reply. Null ⇒ honest ran=false. */
    executor: ((prompt: string) => Promise<string>) | null
    executorDescription?: string
  },
): Promise<BenchmarkOpResult<BenchmarkRunRow>> {
  const dataset = await db.expertBenchmarkDataset.findFirst({ where: { slug: opts.datasetSlug, version: opts.datasetVersion } })
  if (!dataset) return { ok: false, status: 404, error: 'dataset version not found' }

  const cases = JSON.parse(dataset.casesJson) as BenchmarkCase[]
  const labels = await db.expertBenchmarkCaseLabel.findMany({ where: { datasetId: dataset.id, datasetVersion: dataset.version } })
  const labelByCase = new Map(labels.map((l) => [l.caseKey, l]))

  const scores: CaseScore[] = []
  let ran = false
  let runReason = ''
  if (!opts.executor) {
    runReason = 'no model adapter available in this deployment — nothing was measured; metrics are NOT fabricated and no capability or pack status was touched'
    // record the honest non-run
    const record = await db.expertBenchmarkRun.create({
      data: {
        datasetId: dataset.id,
        datasetVersion: dataset.version,
        datasetChecksum: dataset.checksum,
        agentKind: opts.agentKind,
        agentDomain: opts.agentDomain ?? '',
        modelProvider: 'none',
        modelVersion: 'none',
        metricsJson: JSON.stringify({ method: 'not-run', sampleSize: 0, expertLabelledSample: 0, deterministicOnlySample: 0, accuracy: null, falseRefusalCount: null, prohibitedConclusionViolations: 0, notes: [runReason] } satisfies RunMetrics),
        ran: false,
        runReason,
        expertLabelCount: labels.length,
        runBy: opts.runBy,
      },
    })
    return { ok: true, value: record }
  }
  ran = true
  runReason = `measured with executor "${opts.executorDescription ?? 'model-adapter'}" against ${cases.length} case(s); expert-labelled cases scored against expert reference labels (multi-answer honoured, prohibited conclusions checked); unlabelled cases scored only where a deterministic structural check exists`
  for (const caseDef of cases) {
    const reply = await opts.executor(caseDef.prompt)
    const label = labelByCase.get(caseDef.caseKey)
      ? {
          expectedResults: JSON.parse((labelByCase.get(caseDef.caseKey) as CaseLabelRow).expectedResults) as { expected: string; acceptedAlternatives: string[] },
          prohibitedConclusions: JSON.parse((labelByCase.get(caseDef.caseKey) as CaseLabelRow).prohibitedConclusions) as string[],
        }
      : null
    scores.push(scoreReply(caseDef, reply, label))
  }

  const expertScored = scores.filter((s) => s.scoredAgainst === 'EXPERT_LABEL')
  const deterministicScored = scores.filter((s) => s.scoredAgainst === 'DETERMINISTIC_CHECK' && !s.detail.includes('excluded'))
  const sampleSize = expertScored.length + deterministicScored.length
  const accuracy = sampleSize > 0 ? scores.filter((s) => s.passed).length / sampleSize : null
  const metrics: RunMetrics = {
    method: runReason,
    sampleSize,
    expertLabelledSample: expertScored.length,
    deterministicOnlySample: deterministicScored.length,
    accuracy,
    prohibitedConclusionViolations: scores.filter((s) => s.detail.includes('prohibited conclusion')).length,
    falseRefusalCount: null,
    notes: [
      'scoring is deterministic against expert reference labels and structural checks — no model judges a model',
      'this run is a MEASUREMENT ONLY: it never mutates pack reviews, language capability status or any governance ledger',
      sampleSize < cases.length ? `${cases.length - sampleSize} case(s) excluded (no expert label and no deterministic check) — reported honestly` : 'all cases scored',
    ],
  }
  const created = await db.expertBenchmarkRun.create({
    data: {
      datasetId: dataset.id,
      datasetVersion: dataset.version,
      datasetChecksum: dataset.checksum,
      agentKind: opts.agentKind,
      agentDomain: opts.agentDomain ?? '',
      modelProvider: opts.executorDescription ?? 'model-adapter',
      modelVersion: 'executor-reported',
      metricsJson: JSON.stringify({ ...metrics, scores }),
      ran,
      runReason,
      expertLabelCount: labels.length,
      runBy: opts.runBy,
    },
  })
  return { ok: true, value: created }
}

// ─── Regression comparison (model version vs model version) ──────────────────

export interface RegressionComparison {
  datasetSlug: string
  datasetVersion: string
  baseline: { runId: string; agentKind: string; modelProvider: string; accuracy: number | null; sampleSize: number }
  candidate: { runId: string; agentKind: string; modelProvider: string; accuracy: number | null; sampleSize: number }
  deltaAccuracy: number | null
  verdict: string
}

export async function compareRunsForRegression(db: BenchmarkDb, datasetSlug: string, datasetVersion: string, baselineRunId: string, candidateRunId: string): Promise<BenchmarkOpResult<RegressionComparison>> {
  const baseline = await db.expertBenchmarkRun.findFirst({ where: { id: baselineRunId } })
  const candidate = await db.expertBenchmarkRun.findFirst({ where: { id: candidateRunId } })
  if (!baseline || !candidate) return { ok: false, status: 404, error: 'run not found' }
  if (baseline.datasetId !== candidate.datasetId || baseline.datasetVersion !== candidate.datasetVersion) {
    return { ok: false, status: 400, error: 'cannot compare runs from different datasets or dataset versions' }
  }
  const dataset = await db.expertBenchmarkDataset.findFirst({ where: { id: baseline.datasetId } })
  const baselineMetrics = JSON.parse(baseline.metricsJson) as RunMetrics
  const candidateMetrics = JSON.parse(candidate.metricsJson) as RunMetrics
  if (!baseline.ran || !candidate.ran) {
    return { ok: false, status: 409, error: 'cannot compare runs that did not run — record real measurements first (ran=false entries carry no metrics)' }
  }
  const delta = candidateMetrics.accuracy !== null && baselineMetrics.accuracy !== null ? candidateMetrics.accuracy - baselineMetrics.accuracy : null
  const verdict = delta === null
    ? 'incomparable — one of the runs lacks a computable accuracy (reported honestly, never fabricated)'
    : delta >= 0
      ? `candidate measured at or above baseline (+${(delta * 100).toFixed(1)} pp, sample sizes ${baselineMetrics.sampleSize}/${candidateMetrics.sampleSize}) — regression gate passes on this dataset`
      : `candidate measured BELOW baseline (${(delta * 100).toFixed(1)} pp, sample sizes ${baselineMetrics.sampleSize}/${candidateMetrics.sampleSize}) — regression signal recorded; per CI-5H policy a previously verified capability is not silently treated as valid for the new model version`
  return {
    ok: true,
    value: {
      datasetSlug: dataset?.slug ?? datasetSlug,
      datasetVersion,
      baseline: { runId: baseline.id, agentKind: baseline.agentKind, modelProvider: baseline.modelProvider, accuracy: baselineMetrics.accuracy, sampleSize: baselineMetrics.sampleSize },
      candidate: { runId: candidate.id, agentKind: candidate.agentKind, modelProvider: candidate.modelProvider, accuracy: candidateMetrics.accuracy, sampleSize: candidateMetrics.sampleSize },
      deltaAccuracy: delta,
      verdict,
    },
  }
}
