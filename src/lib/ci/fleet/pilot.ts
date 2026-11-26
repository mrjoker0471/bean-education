// ─── BEAN Classroom Intelligence (CI-7B): controlled real expert pilot ───────
// Protocol constants and read-only derivations for the CI-7 pilot.
//
// DESIGN RULES (charter CI-7 §2):
// - This module NEVER replaces an existing authority. It pins the pilot
//   protocol's governing constants and derives pilot facts from the EXISTING
//   CI-4/CI-5/CI-6 ledgers (registry, curator reviews, reviewer profiles,
//   assignments, benchmark labels). Where an existing gate applies, the pilot
//   calls it — it does not re-implement it.
// - Every real count is derived from an authoritative ledger; missing values
//   are never calculated as successful outcomes. Until genuine humans complete
//   the real process, cohort/review/approval counts are honestly zero.
// - The pilot is restricted to non-consequential educational knowledge
//   validation (protocol §3). It never touches student data, transcription,
//   payments, admissions, hiring or any consequential decision.

import {
  computePackChecksum,
  getDomainPack,
  listDomainPacks,
  type DomainPack,
} from './domain-packs'
import { resolveCuratedStatus, type CuratedStatusResult } from './curator'
import { assertSourceContentUsable, listSources } from './sources'
import { composeRubricEvidence, type PackReviewRubric } from './domain-rubric'
import { detectReviewDisagreement } from './assignments'
import type { ReviewerDb, ReviewerProfileRow, ReviewerActor } from './reviewers'

/** Version of the pilot protocol these constants encode (protocol document §header). */
export const CI7_PILOT_PROTOCOL_VERSION = 'ci7-pilot-protocol-1'

/** The recommended pilot subject (CI-7A readiness audit; owner approval is gate G1). */
export const CI7_PILOT_DOMAIN_ID = 'education-pedagogy'
export const CI7_PILOT_PACK_VERSION = '1.0.0'

/**
 * Independent reviews the pilot requires before any acceptance evaluation.
 *
 * The EXISTING approval policy for a STANDARD pack requires 1 distinct
 * qualified approver (resolveCuratedStatus) — CI-7 never relaxes that. The
 * pilot deliberately requires MORE: at least two independent completed reviews
 * by two different verified experts, so genuine disagreement can be observed,
 * preserved and (where needed) adjudicated rather than hidden behind the
 * single-approval minimum.
 */
export const CI7_PILOT_MIN_INDEPENDENT_REVIEWS = 2

/** Hard exclusions (protocol §3) — recorded here so tests and reporting can bind to them. */
export const CI7_PILOT_EXCLUDED_USES: readonly string[] = [
  'student assessment decisions (grades, progress judgements, promotion/retention)',
  'payment, pricing, admissions, hiring, employment or institutional high-stakes decisions',
  'diagnosis of learning disabilities or health conditions; replacement of a qualified special-educational-needs assessment',
  'public ranking or grading of any named student',
  'retention/discipline decisions for any individual learner',
  'transcription, audio/video recording, or any voice capability (TRANSCRIPTION stays structurally UNSUPPORTED)',
  'global activation of the pack beyond the bounded restricted pilot scope',
  'use of quarantined or reference-only external material as content',
  'benchmark publication or model-performance claims beyond the CI-7F evidence rules',
]

/** Stop conditions (protocol §13) — any one halts the pilot. */
export const CI7_PILOT_STOP_CONDITIONS: readonly string[] = [
  'any attempt to use pilot output in a consequential decision',
  'credential verification cannot be completed honestly for a participant',
  'pack checksum drift without version-bound re-review',
  'licence status change on any cited source',
  'adjudication deadlock (recorded honestly, never resolved by forced consensus)',
  'evidence of a fabricated identity or credential',
  'owner authorisation withdrawn at any gate',
]

/**
 * Snapshot of the pilot pack as it exists RIGHT NOW, plus the protocol
 * discipline around it. Throws when the registry no longer matches the
 * protocol's pinned subject — CI-7 must fail loudly on drift rather than
 * silently review a different pack than the protocol describes.
 */
export function pilotPackSnapshot(): {
  protocolVersion: string
  domainId: string
  pack: DomainPack
  checksum: string
  approvalsRequired: number
  declaredStatus: string
  humanReviewRecorded: boolean
  sourceLicenceSnapshot: Array<{
    sourceId: string
    publisher: string
    version: string
    restrictions: string[]
    contentUsable: boolean
    reason: string | null
  }>
} {
  const found = getDomainPack(CI7_PILOT_DOMAIN_ID)
  if (!found) {
    throw new Error(`pilot protocol drift: domain ${CI7_PILOT_DOMAIN_ID} is not registered`)
  }
  const { pack, checksum } = found
  if (pack.packVersion !== CI7_PILOT_PACK_VERSION) {
    throw new Error(
      `pilot protocol drift: pack version ${pack.packVersion} != protocol ${CI7_PILOT_PACK_VERSION} — the protocol must be re-approved for the new version (gate G2)`,
    )
  }
  // derivation comes from the EXISTING curator authority (never re-implemented)
  const curated: CuratedStatusResult = resolveCuratedStatus(pack, [])
  const licenceSnapshot = pack.sources.map((citation) => {
    const gate = assertSourceContentUsable(citation.sourceId, { commercialOperation: true })
    const record = listSources().find((s) => s.sourceId === citation.sourceId) ?? null
    return {
      sourceId: citation.sourceId,
      publisher: record?.publisher ?? 'unknown',
      version: record?.version ?? 'unknown',
      restrictions: record?.licence.restrictions ?? [],
      contentUsable: gate.usable,
      reason: gate.usable ? null : (gate.reason ?? 'content not usable'),
    }
  })
  return {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
    domainId: CI7_PILOT_DOMAIN_ID,
    pack,
    checksum,
    approvalsRequired: curated.approvalsRequired,
    declaredStatus: pack.status,
    humanReviewRecorded: pack.humanReview !== null,
    sourceLicenceSnapshot: licenceSnapshot,
  }
}


/**
 * Guard against the protocol's subject silently disappearing from the
 * registry (e.g. a future pack retirement). Used by tests and reporting.
 */
export function pilotSubjectIsRegistered(): boolean {
  return listDomainPacks().some((p) => p.pack.domainId === CI7_PILOT_DOMAIN_ID)
}

// ─── CI-7D: source-frozen expert review binding ──────────────────────────────
// The review authority itself is CI-4C's recordPackReview (append-only,
// checksum-bound, qualified-approver-gated) exercised through the CI-5D
// assignment route — CI-7 adds NO alternative path. The genuinely missing
// pilot piece is the provenance binding in the recorded evidence: a pilot
// review embeds the source-licence snapshot the reviewer actually saw plus
// the protocol identity, so the audit trail shows exactly which content,
// version and licensing facts the decision was made against.

export interface Ci7PilotReviewBinding {
  protocolVersion: string
  domainId: string
  packVersion: string
  packChecksum: string
  reviewedAt: string
  sourceRefs: Array<{ sourceId: string; scope: string }>
  sourceLicenceSnapshot: Array<{
    sourceId: string
    publisher: string
    version: string
    restrictions: string[]
    contentUsable: boolean
    reason: string | null
  }>
}

/**
 * Compose the evidence payload for a PILOT-domain pack review: the CI-5 rubric
 * evidence (unchanged shape inside `rubric`) extended with the pilot binding —
 * protocol version, exact checksum, actual source references and the
 * source-licence status at review time.
 *
 * Fails loudly when the pack being reviewed has drifted from the protocol
 * subject (wrong version) or the checksum does not match the live content —
 * a pilot review can never silently bind to different content than the
 * reviewer inspected.
 */
export function composePilotReviewEvidence(
  rubric: PackReviewRubric,
  pack: DomainPack,
  packChecksum: string,
  reviewedAt: Date = new Date(),
): string {
  const snap = pilotPackSnapshot()
  if (pack.domainId !== snap.domainId) {
    throw new Error(`pilot review binding refused: pack ${pack.domainId} is not the pilot subject ${snap.domainId}`)
  }
  if (pack.packVersion !== snap.pack.packVersion || packChecksum !== snap.checksum) {
    throw new Error(`pilot review binding refused: content drift (checksum ${packChecksum.slice(0, 12)}… ≠ protocol-bound ${snap.checksum.slice(0, 12)}…) — re-inspect the current version`)
  }
  const binding: Ci7PilotReviewBinding = {
    protocolVersion: snap.protocolVersion,
    domainId: snap.domainId,
    packVersion: snap.pack.packVersion,
    packChecksum,
    reviewedAt: reviewedAt.toISOString(),
    sourceRefs: snap.pack.sources.map((s) => ({ sourceId: s.sourceId, scope: s.scope })),
    sourceLicenceSnapshot: snap.sourceLicenceSnapshot,
  }
  const rubricEvidence = JSON.parse(composeRubricEvidence(rubric)) as Record<string, unknown>
  return JSON.stringify({ ...rubricEvidence, kind: 'CI7-PILOT-SOURCE-FROZEN-REVIEW', pilot: binding })
}

/** True when the given assignment subject is the pilot domain (used by routes to select the evidence composition). */
export function isPilotPackSubject(subjectKey: unknown): boolean {
  return subjectKey === CI7_PILOT_DOMAIN_ID
}

// ─── CI-7E: structured disagreement analysis (append-only) ───────────────────
// Disagreement preservation itself is the EXISTING authority: individual
// ClassroomPackReview rows are never edited, and detectReviewDisagreement /
// the adjudications path decide when independent adjudication is required.
// This adds the ANALYSIS record: one append-only row per analysed
// disagreement, anchored to the REAL review rows (the decisions stored are
// copied verbatim from the ledger — never from request bodies alone).

export const CI7_DISAGREEMENT_CLASSIFICATIONS = ['FACTUAL', 'INTERPRETIVE', 'RUBRIC_RELATED', 'MIXED'] as const
export type Ci7DisagreementClassification = (typeof CI7_DISAGREEMENT_CLASSIFICATIONS)[number]

export interface Ci7DisagreementReviewRow {
  id: string
  packId: string
  packVersion: string
  packChecksum: string
  decision: string
  reviewerStudentId: string
  reviewerName: string
  rationale: string
  evidence: string
  createdAt: Date
}

export interface Ci7DisagreementAnalysisDb {
  ci7DisagreementAnalysis: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown> & { id: string }>>
  }
}

export function ci7DisagreementDbFromPrisma(client: unknown): Ci7DisagreementAnalysisDb {
  return client as Ci7DisagreementAnalysisDb
}

export interface Ci7DisagreementAnalysisInput {
  packId?: unknown
  packVersion?: unknown
  packChecksum?: unknown
  reviewIds?: unknown
  rubricDimensions?: unknown
  evidenceCited?: unknown
  classification?: unknown
  adjudicationRef?: unknown
  adjudicationOutcome?: unknown
  correctionRequired?: unknown
  correctionApplied?: unknown
  packVersionChanged?: unknown
  reReviewRequired?: unknown
  analysis?: unknown
}

export type Ci7DisagreementRecordResult =
  | { ok: true; analysisId: string }
  | { ok: false; status: number; error: string }

/**
 * Record an append-only analysis of a GENUINE disagreement. The review set is
 * loaded by the caller (route) from the authoritative ledger and passed in —
 * the service re-derives everything from those real rows:
 *   - every referenced review must exist in the passed set (no phantom ids);
 *   - a real disagreement must exist among them (never analysed consensus);
 *   - decisions/evidence stored are copied from the real rows verbatim.
 */
export async function recordDisagreementAnalysis(
  db: Ci7DisagreementAnalysisDb,
  admin: { studentId: string; displayName: string },
  input: Ci7DisagreementAnalysisInput,
  reviews: readonly Ci7DisagreementReviewRow[],
  now: Date = new Date(),
): Promise<Ci7DisagreementRecordResult> {
  const classification = typeof input.classification === 'string' ? input.classification : ''
  if (!CI7_DISAGREEMENT_CLASSIFICATIONS.includes(classification as Ci7DisagreementClassification)) {
    return { ok: false, status: 400, error: `classification must be one of ${CI7_DISAGREEMENT_CLASSIFICATIONS.join(' | ')}` }
  }
  const analysis = typeof input.analysis === 'string' ? input.analysis.trim() : ''
  if (analysis.length < 20) {
    return { ok: false, status: 400, error: 'an analysis of at least 20 characters is required — record what the disagreement actually shows' }
  }
  const reviewIds = Array.isArray(input.reviewIds) ? (input.reviewIds as unknown[]).filter((id): id is string => typeof id === 'string') : []
  if (reviewIds.length < 2) {
    return { ok: false, status: 400, error: 'a disagreement analysis requires at least two referenced reviews' }
  }
  const byId = new Map(reviews.map((r) => [r.id, r]))
  const selected = reviewIds.map((id) => byId.get(id)).filter((r): r is Ci7DisagreementReviewRow => Boolean(r))
  if (selected.length !== reviewIds.length) {
    return { ok: false, status: 400, error: 'reviewIds must reference real ClassroomPackReview rows (phantom references refused)' }
  }
  const disagreement = detectReviewDisagreement(selected)
  if (!disagreement.disagreement) {
    return { ok: false, status: 409, error: 'the referenced reviews do not disagree — only a genuine disagreement is analysed here (consensus needs no analysis)' }
  }
  const packId = typeof input.packId === 'string' ? input.packId : selected[0].packId
  const packVersion = typeof input.packVersion === 'string' ? input.packVersion : selected[0].packVersion
  const packChecksum = typeof input.packChecksum === 'string' ? input.packChecksum : selected[0].packChecksum
  if (selected.some((r) => r.packId !== packId || r.packVersion !== packVersion || r.packChecksum !== packChecksum)) {
    return { ok: false, status: 400, error: 'the referenced reviews span different subjects/versions — an analysis binds ONE exact pack version + checksum' }
  }
  const rubricDimensions = Array.isArray(input.rubricDimensions)
    ? (input.rubricDimensions as unknown[]).filter((d): d is string => typeof d === 'string')
    : []
  const evidenceCited = Array.isArray(input.evidenceCited)
    ? (input.evidenceCited as unknown[]).filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    : []
  const created = await db.ci7DisagreementAnalysis.create({
    data: {
      packId,
      packVersion,
      packChecksum,
      reviewIdsJson: JSON.stringify(reviewIds),
      decisionsJson: JSON.stringify(selected.map((r) => ({ reviewerStudentId: r.reviewerStudentId, reviewerName: r.reviewerName, decision: r.decision, rationale: r.rationale }))),
      rubricDimensionsJson: JSON.stringify(rubricDimensions),
      evidenceCitedJson: JSON.stringify(evidenceCited),
      classification,
      adjudicationRef: typeof input.adjudicationRef === 'string' ? input.adjudicationRef : null,
      adjudicationOutcome: typeof input.adjudicationOutcome === 'string' ? input.adjudicationOutcome : null,
      correctionRequired: input.correctionRequired === true,
      correctionApplied: input.correctionApplied === true,
      packVersionChanged: input.packVersionChanged === true,
      reReviewRequired: input.reReviewRequired === true,
      analysis,
      recordedByAdminId: admin.studentId,
      recordedByAdminName: admin.displayName,
    },
  })
  return { ok: true, analysisId: created.id }
}

export interface Ci7FindingsSummary {
  totalAnalyses: number
  byClassification: Record<Ci7DisagreementClassification, number>
  correctionsRequired: number
  correctionsApplied: number
  packVersionChanges: number
  reReviewsRequired: number
  adjudicated: number
  unresolved: number
  note: string
}

/**
 * Aggregate the findings summary from the append-only analysis ledger — every
 * number comes from real recorded rows; an empty ledger reports an honest
 * zero state with the pilot's NOT STARTED note.
 */
export function buildFindingsSummary(analyses: ReadonlyArray<Record<string, unknown> & { id: string }>): Ci7FindingsSummary {
  const byClassification: Record<Ci7DisagreementClassification, number> = { FACTUAL: 0, INTERPRETIVE: 0, RUBRIC_RELATED: 0, MIXED: 0 }
  let correctionsRequired = 0
  let correctionsApplied = 0
  let packVersionChanges = 0
  let reReviewsRequired = 0
  let adjudicated = 0
  let unresolved = 0
  for (const row of analyses) {
    const classification = row.classification as Ci7DisagreementClassification
    if (classification in byClassification) byClassification[classification] += 1
    if (row.correctionRequired === true) correctionsRequired += 1
    if (row.correctionApplied === true) correctionsApplied += 1
    if (row.packVersionChanged === true) packVersionChanges += 1
    if (row.reReviewRequired === true) reReviewsRequired += 1
    if (typeof row.adjudicationOutcome === 'string' && row.adjudicationOutcome.length > 0) adjudicated += 1
    else unresolved += 1
  }
  return {
    totalAnalyses: analyses.length,
    byClassification,
    correctionsRequired,
    correctionsApplied,
    packVersionChanges,
    reReviewsRequired,
    adjudicated,
    unresolved,
    note: analyses.length === 0
      ? 'NOT STARTED — no genuine disagreement has been recorded because no genuine expert review has been executed yet; every count above is a real ledger count, not a projection'
      : 'counts derive from append-only analysis rows bound to exact pack versions + checksums; unresolved rows still require authorised adjudication',
  }
}

// ─── CI-7F: human-grounded model evaluation readiness ────────────────────────
// The evaluation authority is CI-5F's benchmark programme (datasets, expert
// case labels by scoped ACTIVE reviewers, harness runs, regression compare) —
// CI-7 adds NO second benchmark system. This gate derives, from the REAL
// ledgers, whether a meaningful evaluation is possible BEFORE any metric is
// reported. When evidence is insufficient, the honest output is
// INSUFFICIENT EVIDENCE — never a performance score.
//
// Explicit rules (protocol §17):
//   - a metric is reported only from GENUINE expert labels (reviewer-bound;
//     deterministic-only rows never count as human evidence);
//   - a minimum labelled sample and ≥2 independent reviewers are required;
//   - model outputs can never approve their own quality (runs are
//     measurements only — recordPackReview / LanguageCapabilityStatus stay
//     human-gated, and executor:null rows are honest non-runs);
//   - fixture labels never count as human evidence (fixture-only results stay
//     marked fixture-only);
//   - reviewer disagreement is treated as information to analyse (CI-7E),
//     never silently as model failure;
//   - a small pilot is never reported as universal model validation.

/** Minimum distinct labelled cases before ANY metric may be reported. */
export const CI7_EVALUATION_MIN_LABELLED_CASES = 10
/** Minimum distinct human reviewers providing labels (independence). */
export const CI7_EVALUATION_MIN_INDEPENDENT_REVIEWERS = 2
/** Minimum genuine human labels in total. */
export const CI7_EVALUATION_MIN_HUMAN_LABELS = 10

export interface Ci7EvaluationLabelRow {
  caseKey: string
  reviewerProfileId: string | null
  rubricVersion: string | null
}

export interface Ci7EvaluationReadinessInput {
  dataset: { slug: string; version: string; checksum: string; split: string } | null
  labels: ReadonlyArray<Ci7EvaluationLabelRow>
  modelBinding: { provider: string; version: string } | null
}

export interface Ci7EvaluationReadinessResult {
  status: 'INSUFFICIENT EVIDENCE' | 'EVALUABLE'
  missing: string[]
  sampleSize: number
  humanLabels: number
  deterministicOnlyLabels: number
  labelledCases: number
  independentReviewers: number
  holdoutPolicy: string
  note: string
}

/**
 * Derive evaluation readiness from real ledger rows. PURE function over the
 * passed rows — the route loads them from the authoritative tables.
 */
export function evaluatePilotEvaluationReadiness(input: Ci7EvaluationReadinessInput): Ci7EvaluationReadinessResult {
  const missing: string[] = []
  const humanLabels = input.labels.filter((l) => typeof l.reviewerProfileId === 'string' && l.reviewerProfileId.length > 0)
  const deterministicOnly = input.labels.length - humanLabels.length
  const labelledCases = new Set(humanLabels.map((l) => l.caseKey)).size
  const independentReviewers = new Set(humanLabels.map((l) => l.reviewerProfileId)).size

  if (!input.dataset) missing.push('a bound evaluation dataset (slug + version + checksum) must exist before any evaluation is designed')
  else {
    if (!input.dataset.version) missing.push('the dataset version is missing — an unversioned dataset can never ground a metric')
    if (!input.dataset.checksum) missing.push('the dataset checksum is missing — an unchecksummed dataset can never ground a metric')
  }
  if (humanLabels.length < CI7_EVALUATION_MIN_HUMAN_LABELS) {
    missing.push(`only ${humanLabels.length} genuine human label(s) recorded — at least ${CI7_EVALUATION_MIN_HUMAN_LABELS} reviewer-bound labels are required (deterministic-only rows do not count as human evidence)`)
  }
  if (labelledCases < CI7_EVALUATION_MIN_LABELLED_CASES) {
    missing.push(`only ${labelledCases} distinct case(s) carry human labels — at least ${CI7_EVALUATION_MIN_LABELLED_CASES} labelled cases are required before any metric is reported`)
  }
  if (independentReviewers < CI7_EVALUATION_MIN_INDEPENDENT_REVIEWERS) {
    missing.push(`only ${independentReviewers} independent reviewer(s) contributed labels — at least ${CI7_EVALUATION_MIN_INDEPENDENT_REVIEWERS} independent qualified reviewers are required`)
  }
  if (!input.modelBinding || !input.modelBinding.provider || !input.modelBinding.version) {
    missing.push('the model provider + exact model version must be bound before evaluating — an unversioned model can never be reported against')
  }

  const status: Ci7EvaluationReadinessResult['status'] = missing.length === 0 ? 'EVALUABLE' : 'INSUFFICIENT EVIDENCE'
  return {
    status,
    missing,
    sampleSize: input.labels.length,
    humanLabels: humanLabels.length,
    deterministicOnlyLabels: deterministicOnly,
    labelledCases,
    independentReviewers,
    holdoutPolicy: 'existing CI-5F split policy: DEVELOPMENT/CALIBRATION/VALIDATION/BLIND_HOLDOUT — holdout cases are sealed until scoring and never labelled through the open path',
    note: status === 'INSUFFICIENT EVIDENCE'
      ? 'INSUFFICIENT EVIDENCE — no performance score may be reported from this state; the honest report is the missing-evidence list below, and fixture-only results stay marked fixture-only'
      : 'evidence thresholds met for the PILOT SCOPE ONLY — a result is attributable to this dataset version + checksum and this reviewer cohort; it is never a universal model validation, and reviewer disagreement routes to CI-7E analysis rather than being counted as model failure without analysis',
  }
}

/**
 * Load the readiness inputs from the authoritative benchmark ledgers (the
 * CI-5F tables) for a given dataset slug + version. The model binding comes
 * from the APPROVED evaluation design (protocol §17) — it is never inferred
 * from a run row, because a run IS an evaluation; readiness gates the design,
 * not the result. Returns null dataset when absent — readiness then honestly
 * reports INSUFFICIENT EVIDENCE.
 */
export async function pilotEvaluationReadinessFromDb(
  benchmarkDb: {
    expertBenchmarkDataset: { findFirst(args?: Record<string, unknown>): Promise<{ id: string; slug: string; version: string; checksum: string; split: string } | null> }
    expertBenchmarkCaseLabel: { findMany(args?: Record<string, unknown>): Promise<Array<{ caseKey: string; reviewerProfileId: string | null; rubricVersion: string | null }>> }
  },
  slug: string,
  version: string,
  modelBinding: { provider: string; version: string } | null,
): Promise<Ci7EvaluationReadinessResult> {
  const dataset = await benchmarkDb.expertBenchmarkDataset.findFirst({ where: { slug, version } })
  const labels = dataset
    ? await benchmarkDb.expertBenchmarkCaseLabel.findMany({ where: { datasetId: dataset.id, datasetVersion: dataset.version } })
    : []
  return evaluatePilotEvaluationReadiness({
    dataset: dataset ? { slug: dataset.slug, version: dataset.version, checksum: dataset.checksum, split: dataset.split } : null,
    labels,
    modelBinding,
  })
}

// ─── CI-7G: controlled internal pilot activation, kill switch, rollback ──────
// The restricted pilot activation ledger (`Ci7PilotActivation`, append-only).
// DEFAULT IS DISABLED: no rows = never activated. ACTIVATED requires the
// pack's EXISTING CI-4/CI-5 approval authority to have recorded the required
// genuine approvals (curated status VERIFIED at the exact checksum) — CI-7
// never bypasses an approval threshold. The kill switch (DEACTIVATED) and
// ROLLED_BACK records are always available to authorised admins. The current
// state is derived from the LATEST event; an activation bound to a stale
// checksum (pack content changed since) is STALE — it does not apply and
// re-review is required.

export const CI7_PILOT_ACTIVATION_EVENTS = ['ACTIVATED', 'DEACTIVATED', 'REACTIVATED', 'ROLLED_BACK'] as const
export type Ci7PilotActivationEventType = (typeof CI7_PILOT_ACTIVATION_EVENTS)[number]

export interface Ci7PilotActivationDb {
  ci7PilotActivation: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown> & { id: string; createdAt: Date }>>
  }
}

export function ci7ActivationDbFromPrisma(client: unknown): Ci7PilotActivationDb {
  return client as Ci7PilotActivationDb
}

export interface Ci7ActivationDecisionInput {
  eventType?: unknown
  packId?: unknown
  packVersion?: unknown
  packChecksum?: unknown
  pilotScope?: unknown
  protocolVersion?: unknown
  reason?: unknown
}

export type Ci7ActivationRecordResult =
  | { ok: true; eventId: string }
  | { ok: false; status: number; error: string }

/**
 * Record an activation-ledger event. ACTIVATED/REACTIVATED are gated on the
 * pack's real curated status (genuine approvals recorded by the existing
 * authority at the exact checksum); DEACTIVATED (kill switch) and
 * ROLLED_BACK are always allowed for authorised admins — turning a pilot OFF
 * must never be harder than turning it ON.
 */
export async function recordPilotActivationEvent(
  db: Ci7PilotActivationDb,
  admin: { studentId: string; displayName: string },
  input: Ci7ActivationDecisionInput,
  pack: DomainPack,
  packChecksum: string,
  curatedStatus: CuratedStatusResult | null,
  now: Date = new Date(),
): Promise<Ci7ActivationRecordResult> {
  const eventType = typeof input.eventType === 'string' ? input.eventType : ''
  if (!CI7_PILOT_ACTIVATION_EVENTS.includes(eventType as Ci7PilotActivationEventType)) {
    return { ok: false, status: 400, error: `eventType must be one of ${CI7_PILOT_ACTIVATION_EVENTS.join(' | ')}` }
  }
  const packId = typeof input.packId === 'string' ? input.packId : ''
  if (packId !== CI7_PILOT_DOMAIN_ID) {
    return { ok: false, status: 400, error: `only the pilot subject ${CI7_PILOT_DOMAIN_ID} can be activated — no global or cross-domain activation exists` }
  }
  const version = typeof input.packVersion === 'string' ? input.packVersion : pack.packVersion
  const checksum = typeof input.packChecksum === 'string' ? input.packChecksum : packChecksum
  if (version !== pack.packVersion || checksum !== packChecksum) {
    return { ok: false, status: 409, error: `activation must bind the CURRENT pack content (v${pack.packVersion}, checksum ${packChecksum.slice(0, 12)}…) — the requested binding is stale, re-review the current version first` }
  }
  const protocolVersion = typeof input.protocolVersion === 'string' ? input.protocolVersion : ''
  if (protocolVersion !== CI7_PILOT_PROTOCOL_VERSION) {
    return { ok: false, status: 400, error: `activation must name the current protocol version ${CI7_PILOT_PROTOCOL_VERSION}` }
  }
  const pilotScope = typeof input.pilotScope === 'string' ? input.pilotScope.trim() : ''
  if ((eventType === 'ACTIVATED' || eventType === 'REACTIVATED') && pilotScope.length < 10) {
    return { ok: false, status: 400, error: 'pilotScope is required (min 10 chars) — the activation names its exact bounded scope; global enablement does not exist' }
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (reason.length < 10) {
    return { ok: false, status: 400, error: 'a reason of at least 10 characters is required (audit trail)' }
  }
  if (eventType === 'ACTIVATED' || eventType === 'REACTIVATED') {
    // THE GATE: genuine approvals recorded by the existing authority.
    if (!curatedStatus || curatedStatus.status !== 'VERIFIED') {
      return {
        ok: false,
        status: 409,
        error: `the pack has not earned activation: curated status is ${curatedStatus?.status ?? 'unavailable'} — restricted pilot activation requires the existing CI-4/CI-5 approval authority to have recorded the required genuine approvals for this exact version + checksum`,
      }
    }
  }
  const created = await db.ci7PilotActivation.create({
    data: {
      eventType,
      packId,
      packVersion: version,
      packChecksum: checksum,
      pilotScope: pilotScope.length > 0 ? pilotScope : `${eventType.toLowerCase()} — the previously recorded scope no longer applies`,
      protocolVersion,
      reason,
      actorAdminId: admin.studentId,
      actorAdminName: admin.displayName,
    },
  })
  return { ok: true, eventId: created.id }
}

export interface Ci7PilotActivationState {
  state: 'DISABLED' | 'ACTIVE' | 'DEACTIVATED' | 'ROLLED_BACK' | 'STALE'
  currentStatus: string
  latestEvent: Record<string, unknown> | null
  activatedChecksum: string | null
  currentChecksum: string | null
  reReviewRequired: boolean
  note: string
}

/**
 * Derive the CURRENT activation state from the append-only event ledger —
 * latest event governs; DEFAULT IS DISABLED. If the pack content has changed
 * since the latest ACTIVATED event (checksum drift), the state is STALE: the
 * activation does not apply and a version-bound re-review is required.
 */
export function resolvePilotActivationState(
  events: ReadonlyArray<Record<string, unknown> & { id: string; eventType: string; packChecksum: string; createdAt: Date }>,
  currentChecksum: string | null,
): Ci7PilotActivationState {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null
  const activatedChecksum = latest && (latest.eventType === 'ACTIVATED' || latest.eventType === 'REACTIVATED') ? latest.packChecksum : null
  if (!latest) {
    return {
      state: 'DISABLED',
      currentStatus: 'DISABLED',
      latestEvent: null,
      activatedChecksum: null,
      currentChecksum,
      reReviewRequired: false,
      note: 'DISABLED — the default. The pilot has never been activated: no activation event exists, and activation requires the pack to earn it through genuine approvals first.',
    }
  }
  if (activatedChecksum && currentChecksum && activatedChecksum !== currentChecksum) {
    return {
      state: 'STALE',
      currentStatus: 'STALE — NOT ACTIVE',
      latestEvent: latest,
      activatedChecksum,
      currentChecksum,
      reReviewRequired: true,
      note: 'STALE — the pack content changed since the last activation; the previous activation no longer applies and a version-bound re-review is required before any restricted use',
    }
  }
  const state = latest.eventType === 'ACTIVATED' || latest.eventType === 'REACTIVATED'
    ? 'ACTIVE'
    : latest.eventType === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'DEACTIVATED'
  const notes: Record<string, string> = {
    ACTIVE: 'ACTIVE — restricted pilot use per the recorded scope; the binding is the exact version + checksum on the latest event',
    DEACTIVATED: 'DEACTIVATED — kill switch engaged; the pilot is off (audit trail preserved)',
    ROLLED_BACK: 'ROLLED_BACK — restored to the previous safe state; the pilot is off (audit trail preserved)',
  }
  return {
    state,
    currentStatus: state,
    latestEvent: latest,
    activatedChecksum: activatedChecksum,
    currentChecksum,
    reReviewRequired: false,
    note: notes[state] ?? 'unknown state',
  }
}

// ─── CI-7H: pilot dashboard — honest ledger-derived reporting ────────────────
// Extends the CI-6G activation-reporting discipline to the pilot: EVERY count
// comes from its own authoritative ledger (profiles, verification records,
// consent events, invitations, assignments, pack reviews, disagreement
// analyses, activation events, benchmark labels). Missing values are never
// calculated as successful outcomes; synthetic fixture records are never
// counted as real ones; when the real pilot has not been executed the report
// says NOT STARTED with genuine zeros.

import { resolveVerificationState, type VerificationRecordRow } from './verification'

export interface Ci7PilotReportingDb {
  expertReviewerProfile: { findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; studentId: string; status: string; approvedDomains: string; availability: string; profileVisibility: string }>> }
  expertVerificationRecord: { findMany(args?: Record<string, unknown>): Promise<VerificationRecordRow[]> }
  expertReviewerEvent: { findMany(args?: Record<string, unknown>): Promise<Array<{ profileId: string; eventType: string; payload: string | null; createdAt: Date }>> }
  expertInvitation: { findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; status: string; requestedDomainsJson: string }>> }
  expertReviewAssignment: { findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; subjectType: string; subjectKey: string; subjectChecksum: string | null; status: string }>> }
  classroomPackReview: { findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; packId: string; packVersion: string; packChecksum: string; decision: string; reviewerStudentId: string }>> }
  ci7DisagreementAnalysis: { findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown> & { id: string }>> }
  ci7PilotActivation: { findMany(args?: Record<string, unknown>): Promise<Array<Record<string, unknown> & { id: string; eventType: string; packChecksum: string; createdAt: Date }>> }
  expertBenchmarkDataset: { findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; slug: string; version: string; checksum: string; split: string; domain: string }>> }
  expertBenchmarkCaseLabel: { findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; datasetId: string; datasetVersion: string; caseKey: string; reviewerProfileId: string | null }>> }
}

export function ci7ReportingDbFromPrisma(client: unknown): Ci7PilotReportingDb {
  return client as Ci7PilotReportingDb
}

export interface Ci7PilotReport {
  pilotStatus: string
  domainId: string
  packVersion: string
  packChecksum: string
  protocolVersion: string
  expertApplications: number
  independentlyVerifiedExperts: number
  qualifiedActiveExperts: number
  pilotDomainEligibleExperts: number
  pilotInvitations: number
  claimedPilotInvitations: number
  acceptedAssignments: number
  submittedHumanReviews: number
  completedHumanReviews: number
  genuineExpertApprovals: number
  genuineDisagreements: number
  adjudicatedDisagreements: number
  packCorrections: number
  reReviewRequirements: number
  packActivationStatus: string
  benchmarkHumanLabels: number
  evaluationStatus: string
  fixturePolicy: string
  note: string
  generatedAt: string
}

export async function buildPilotReport(tables: Ci7PilotReportingDb, now: Date = new Date()): Promise<Ci7PilotReport> {
  const snap = pilotPackSnapshot()
  const domain = snap.domainId
  const checksum = snap.checksum

  const [profiles, verifications, events, invitations, assignments, reviews, analyses, activationEvents, datasets] = await Promise.all([
    tables.expertReviewerProfile.findMany(),
    tables.expertVerificationRecord.findMany(),
    tables.expertReviewerEvent.findMany(),
    tables.expertInvitation.findMany(),
    tables.expertReviewAssignment.findMany({ where: { subjectType: 'DOMAIN_PACK', subjectKey: domain } }),
    tables.classroomPackReview.findMany({ where: { packId: domain } }),
    tables.ci7DisagreementAnalysis.findMany({ where: { packId: domain } }),
    tables.ci7PilotActivation.findMany({ where: { packId: domain } }),
    tables.expertBenchmarkDataset.findMany({ where: { domain } }),
  ])

  // expert cohort — each count from its own ledger
  const verificationsByProfile = new Map<string, VerificationRecordRow[]>()
  for (const v of verifications) {
    const list = verificationsByProfile.get(v.profileId) ?? []
    list.push(v)
    verificationsByProfile.set(v.profileId, list)
  }
  const independentlyVerified = profiles.filter((p) => {
    const state = resolveVerificationState(verificationsByProfile.get(p.id) ?? [], now)
    return state.verified
  }).length
  const activeProfiles = profiles.filter((p) => p.status === 'ACTIVE')

  // pilot eligibility: ACTIVE + exact approved domain scope + current-protocol participation consent
  const pilotConsentByProfile = new Map<string, boolean>()
  for (const e of events) {
    if (e.eventType === 'PILOT_PARTICIPATION_CONSENT' || e.eventType === 'PILOT_PARTICIPATION_WITHDRAWN') {
      pilotConsentByProfile.set(e.profileId, e.eventType === 'PILOT_PARTICIPATION_CONSENT')
    }
  }
  const pilotDomainEligible = activeProfiles.filter((p) => {
    const domains = JSON.parse(p.approvedDomains || '[]') as string[]
    return domains.includes(domain) && pilotConsentByProfile.get(p.id) === true
  }).length

  // pilot invitations (advisory requested scope contains the pilot domain)
  const pilotInvitations = invitations.filter((inv) => {
    try {
      return (JSON.parse(inv.requestedDomainsJson || '[]') as string[]).includes(domain)
    } catch {
      return false
    }
  })
  const claimedPilotInvitations = pilotInvitations.filter((inv) => inv.status === 'CLAIMED').length

  // assignments / reviews — bound to the pilot subject
  const openOrDone = assignments.filter((a) => ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED'].includes(a.status))
  const completedAssignments = assignments.filter((a) => a.status === 'COMPLETED')
  const boundReviews = reviews.filter((r) => r.packVersion === snap.pack.packVersion && r.packChecksum === checksum)
  const genuineApprovals = new Set(boundReviews.filter((r) => r.decision === 'APPROVED').map((r) => r.reviewerStudentId)).size

  // disagreement analyses (append-only rows for this pack)
  const adjudicated = analyses.filter((a) => typeof a.adjudicationOutcome === 'string' && (a.adjudicationOutcome as string).length > 0).length
  const corrections = analyses.filter((a) => a.correctionApplied === true).length
  const reReviews = analyses.filter((a) => a.reReviewRequired === true).length

  // activation state (append-only ledger; default DISABLED; stale = re-review)
  const activation = resolvePilotActivationState(activationEvents, checksum)
  const reReviewRequirements = reReviews + (activation.reReviewRequired ? 1 : 0)

  // benchmark labels for pilot-domain datasets — human labels only
  const datasetIds = new Set(datasets.map((d) => d.id))
  const labels = datasetIds.size > 0
    ? (await tables.expertBenchmarkCaseLabel.findMany()).filter((l) => datasetIds.has(l.datasetId) && typeof l.reviewerProfileId === 'string' && l.reviewerProfileId.length > 0)
    : []
  const evaluation = datasets.length === 0
    ? 'NO DATASET — no evaluation dataset for the pilot domain exists yet'
    : 'INSUFFICIENT EVIDENCE — evaluate only where the real label count and evaluation design support a meaningful result (see /api/admin/ci7/evaluation-readiness)'

  const pilotHasExecuted = completedAssignments.length > 0 || boundReviews.length > 0
  return {
    pilotStatus: pilotHasExecuted ? 'IN EXECUTION' : 'NOT STARTED',
    domainId: domain,
    packVersion: snap.pack.packVersion,
    packChecksum: checksum,
    protocolVersion: snap.protocolVersion,
    expertApplications: profiles.length,
    independentlyVerifiedExperts: independentlyVerified,
    qualifiedActiveExperts: activeProfiles.length,
    pilotDomainEligibleExperts: pilotDomainEligible,
    pilotInvitations: pilotInvitations.length,
    claimedPilotInvitations,
    acceptedAssignments: openOrDone.length,
    submittedHumanReviews: boundReviews.length,
    completedHumanReviews: completedAssignments.length,
    genuineExpertApprovals: genuineApprovals,
    genuineDisagreements: analyses.length,
    adjudicatedDisagreements: adjudicated,
    packCorrections: corrections,
    reReviewRequirements,
    packActivationStatus: `${activation.state}${activation.reReviewRequired ? ' (re-review required)' : ''} — bound checksum ${activation.activatedChecksum ? activation.activatedChecksum.slice(0, 12) + '…' : 'none'}`,
    benchmarkHumanLabels: labels.length,
    evaluationStatus: evaluation,
    fixturePolicy: 'Synthetic fixture records are never counted as real expert records, real human decisions or real approvals. Every number above is a ledger count; zero means zero.',
    note: pilotHasExecuted
      ? 'pilot execution is recorded through the real ledgers — distinguish software readiness from real-world outcomes when reporting'
      : 'NOT STARTED — the real-world pilot has not been executed: no genuine expert has completed the real process. Zero counts are honest zeros, not projections.',
    generatedAt: now.toISOString(),
  }
}

// ─── CI-7C: expert cohort activation — pilot participation consent ───────────
// The cohort is NOT a second onboarding system: it reuses the existing CI-6
// flow (INVITE → APPLY → EVIDENCE → INDEPENDENT VERIFICATION → QUALIFICATION
// → ACTIVATION) and adds exactly one missing gate — explicit pilot
// participation consent, recorded as append-only reviewer events so the
// participant's acknowledgement of the protocol terms is auditable and the
// latest event governs.

/** Protocol participant information points every expert must acknowledge (protocol §15). */
export const CI7_PILOT_CONSENT_POINTS: readonly string[] = [
  'what-you-review: the education-pedagogy pack content (glossary, competency levels, task boundaries, safety boundary) against the six-section rubric',
  'how-decisions-are-used: append-only attributable review rows; genuine approvals can contribute to derived VERIFIED status; disagreements preserved and possibly adjudicated',
  'data-access: pack content, registered source metadata and licence snapshot — never student data, never other applicants evidence',
  'attribution: reviews are attributed to your reviewer identity in the audit ledger; public directory listing is optional and never a condition of participation',
  'compensation: the status recorded in the owner-approved participant terms (UNPAID | COMPENSATED | OTHERWISE_AGREED) — recorded verbatim, never invented',
  'confidentiality: pack content stays confidential outside BEAN; conflicts of interest must be declared and are enforced',
  'withdrawal-privacy: withdrawal runs through the existing reviewer withdrawal flow; consent events are retained in the audit trail per the retention rules',
]

export const CI7_PILOT_COMPENSATION_STATUSES = ['UNPAID', 'COMPENSATED', 'OTHERWISE_AGREED'] as const
export type Ci7PilotCompensationStatus = (typeof CI7_PILOT_COMPENSATION_STATUSES)[number]

const PILOT_CONSENT_STATUSES: readonly string[] = ['ACTIVE', 'APPROVED']

export interface Ci7PilotConsentInput {
  protocolVersion?: unknown
  acknowledged?: unknown
  compensationStatus?: unknown
}

/**
 * Record explicit pilot participation consent for an activated (or approved,
 * pre-activation) reviewer. Consent is the reviewer's own act — recorded with
 * the REVIEWER actor. This is NOT a privilege grant: eligibility still flows
 * from the CI-5B lifecycle (ACTIVE + scope + availability) and the CI-5C
 * assignment gates. Refuses:
 *  - profiles in states where participation makes no sense (pending review,
 *    terminal) — a pending applicant is never a pilot participant;
 *  - unknown protocol versions (consent must name the version it consented to);
 *  - missing/false acknowledgement of every participant information point;
 *  - an invented compensation status (only the owner-approved vocabulary).
 */
export async function recordPilotParticipationConsent(
  db: ReviewerDb,
  profile: ReviewerProfileRow,
  actor: ReviewerActor,
  input: Ci7PilotConsentInput,
  now: Date = new Date(),
): Promise<{ ok: true; eventId: string } | { ok: false; status: number; error: string }> {
  if (!PILOT_CONSENT_STATUSES.includes(profile.status)) {
    return {
      ok: false,
      status: 409,
      error: `pilot participation consent requires an APPROVED or ACTIVE reviewer profile (current status ${profile.status}) — a pending applicant is never a pilot participant, and terminal states cannot consent`,
    }
  }
  const protocolVersion = typeof input.protocolVersion === 'string' ? input.protocolVersion : ''
  if (!protocolVersion || protocolVersion !== CI7_PILOT_PROTOCOL_VERSION) {
    return { ok: false, status: 400, error: `consent must name the current pilot protocol version ${CI7_PILOT_PROTOCOL_VERSION}` }
  }
  const acknowledged = Array.isArray(input.acknowledged) ? (input.acknowledged as unknown[]) : []
  const missing = CI7_PILOT_CONSENT_POINTS.filter((point) => !acknowledged.includes(point))
  if (missing.length > 0) {
    return { ok: false, status: 400, error: `participation consent requires acknowledging every participant information point (missing ${missing.length})` }
  }
  const compensationStatus = input.compensationStatus
  if (
    typeof compensationStatus !== 'string' ||
    !CI7_PILOT_COMPENSATION_STATUSES.includes(compensationStatus as Ci7PilotCompensationStatus)
  ) {
    return { ok: false, status: 400, error: 'compensationStatus must record the owner-approved terms: UNPAID | COMPENSATED | OTHERWISE_AGREED — never an invented value' }
  }
  const event = await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'PILOT_PARTICIPATION_CONSENT',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: `consent to CI-7 pilot participation under ${protocolVersion} (education-pedagogy v${CI7_PILOT_PACK_VERSION})`,
      payload: JSON.stringify({
        kind: 'CI7-PILOT-PARTICIPATION',
        protocolVersion,
        packVersion: CI7_PILOT_PACK_VERSION,
        acknowledged: CI7_PILOT_CONSENT_POINTS,
        compensationStatus,
        consentedAt: now.toISOString(),
      }),
    },
  })
  return { ok: true, eventId: event.id }
}

/**
 * Withdraw pilot participation (append-only). The latest pilot event governs:
 * after withdrawal the reviewer is not a pilot participant. Existing recorded
 * decisions are retained per the retention rules — withdrawal never erases
 * history.
 */
export async function withdrawPilotParticipation(
  db: ReviewerDb,
  profile: ReviewerProfileRow,
  actor: ReviewerActor,
  reason: string,
  now: Date = new Date(),
): Promise<{ ok: true; eventId: string } | { ok: false; status: number; error: string }> {
  if (!reason || reason.trim().length < 10) {
    return { ok: false, status: 400, error: 'a withdrawal reason of at least 10 characters is required (audit trail)' }
  }
  const event = await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'PILOT_PARTICIPATION_WITHDRAWN',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: reason.slice(0, 2000),
      payload: JSON.stringify({
        kind: 'CI7-PILOT-PARTICIPATION-WITHDRAWAL',
        protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
        withdrawnAt: now.toISOString(),
      }),
    },
  })
  return { ok: true, eventId: event.id }
}

export interface Ci7PilotParticipationState {
  participant: boolean
  latestConsentAt: string | null
  latestWithdrawalAt: string | null
  protocolVersion: string | null
  compensationStatus: Ci7PilotCompensationStatus | null
}

/**
 * Derive pilot participation from the event ledger — the LATEST pilot consent
 * / withdrawal event governs. Derived server-side from append-only history;
 * never a client-supplied flag.
 */
export function resolvePilotParticipation(events: readonly { eventType: string; payload: string | null; createdAt: Date }[]): Ci7PilotParticipationState {
  const pilotEvents = events
    .filter((e) => e.eventType === 'PILOT_PARTICIPATION_CONSENT' || e.eventType === 'PILOT_PARTICIPATION_WITHDRAWN')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const state: Ci7PilotParticipationState = {
    participant: false,
    latestConsentAt: null,
    latestWithdrawalAt: null,
    protocolVersion: null,
    compensationStatus: null,
  }
  for (const e of pilotEvents) {
    if (e.eventType === 'PILOT_PARTICIPATION_CONSENT') {
      state.participant = true
      state.latestConsentAt = e.createdAt.toISOString()
      state.latestWithdrawalAt = null
      try {
        const payload = JSON.parse(e.payload ?? '{}') as { protocolVersion?: string; compensationStatus?: Ci7PilotCompensationStatus }
        state.protocolVersion = payload.protocolVersion ?? null
        state.compensationStatus = payload.compensationStatus ?? null
      } catch {
        // an unparseable payload must not silently keep stale consent values
        state.protocolVersion = null
        state.compensationStatus = null
      }
    } else {
      state.participant = false
      state.latestWithdrawalAt = e.createdAt.toISOString()
    }
  }
  return state
}

/**
 * The pilot assignment gate. Reused by the EXISTING admin assignment route:
 * an assignment that targets the pilot pack may only be created for a reviewer
 * whose LATEST pilot event is a participation consent for the CURRENT protocol
 * version. Everything else (ACTIVE status, scope, COI, availability,
 * independence) remains the existing createAssignment authority — this gate is
 * purely additive and never relaxes any existing rule.
 */
export function pilotAssignmentGate(
  subjectType: unknown,
  subjectKey: unknown,
  participation: Ci7PilotParticipationState,
): { ok: true } | { ok: false; status: number; error: string } {
  const isPilotSubject = subjectType === 'DOMAIN_PACK' && subjectKey === CI7_PILOT_DOMAIN_ID
  if (!isPilotSubject) return { ok: true }
  if (!participation.participant) {
    return {
      ok: false,
      status: 409,
      error: `the reviewer has not consented to CI-7 pilot participation under ${CI7_PILOT_PROTOCOL_VERSION} (or has withdrawn) — pilot assignments require explicit recorded consent`,
    }
  }
  if (participation.protocolVersion !== CI7_PILOT_PROTOCOL_VERSION) {
    return {
      ok: false,
      status: 409,
      error: `the reviewer's pilot consent names protocol ${participation.protocolVersion ?? 'unknown'}, not the current ${CI7_PILOT_PROTOCOL_VERSION} — re-consent to the current protocol first`,
    }
  }
  return { ok: true }
}
