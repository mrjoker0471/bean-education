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
