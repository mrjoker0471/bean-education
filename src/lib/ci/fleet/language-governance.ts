// ─── BEAN Classroom Intelligence (CI-5E): durable language governance ─────────
// Replaces the CI-4F process-local capabilityStore (proven non-durable in
// CI-5A: approvals vanished on restart, invisible to concurrent workers, and
// bound to nothing) with database-backed, separated records:
//
//   1. LanguageBenchmarkMeasurement — the deterministic benchmark result.
//   2. LanguageCapabilityReview     — the append-only human bilingual decision.
//   3. LanguageCapabilityStatus     — the derived, PERSISTED effective status.
//
// Structural rules (all enforced here, none bypassable):
//   • A benchmark pass alone produces at most LIMITED (machine evidence).
//   • Only a qualified, ACTIVE bilingual reviewer (CI-5B registry, exact
//     tag/task/domain scope) can approve a MEASURED capability.
//   • An approval binds to the EXACT measurement row — provider, model
//     version, benchmark version and dataset checksum must all match.
//   • A new model or benchmark version requires a NEW assessment; when a newer
//     binding becomes VERIFIED for the same language/task/domain/dialect, the
//     older VERIFIED binding is marked SUPERSEDED (never silently extended).
//   • Revocation preserves the historical approval (rows are never deleted;
//     the status row records basis=REVOKED with the review ids intact).
//   • An UNMEASURED capability cannot be approved.
//   • TRANSCRIPTION is structurally UNSUPPORTED — every write path refuses and
//     no approval workflow can bypass the charter §9.2 transcription/legal gate.
//   • No in-memory mutation can create a VERIFIED state: the CI-4F
//     self-certification hole (caller-supplied humanApproved flag) is closed in
//     language.ts, and VERIFIED exists only through this module's DB path.

import { createHash } from 'node:crypto'
import { CI3_LANGUAGES, CI3_LANGUAGE_TASKS, type Ci3LanguageTask, languageByTag } from './language'
import { reviewerCanReviewLanguage, type ReviewerProfileRow } from './reviewers'

// ─── Structural DB view (real Prisma and test fakes both satisfy) ─────────────

export interface MeasurementRow {
  id: string
  languageTag: string
  task: string
  domain: string | null
  dialect: string | null
  modelProvider: string
  modelVersion: string
  benchmarkVersion: string
  benchmarkChecksum: string
  testRef: string
  passed: boolean
  caseCount: number
  passedCount: number
  measuredAt: Date
  createdAt: Date
}

export interface LanguageReviewRow {
  id: string
  measurementId: string
  languageTag: string
  task: string
  domain: string | null
  dialect: string | null
  modelProvider: string
  modelVersion: string
  benchmarkVersion: string
  benchmarkChecksum: string
  reviewerStudentId: string
  reviewerCode: string
  reviewerQualification: string
  decision: string
  rationale: string
  evidence: string
  createdAt: Date
}

export interface LanguageStatusRow {
  id: string
  languageTag: string
  task: string
  domain: string | null
  dialect: string | null
  modelProvider: string | null
  modelVersion: string | null
  benchmarkVersion: string | null
  status: string
  basis: string
  latestMeasurementId: string | null
  approvalCount: number
  contributingReviewIds: string
  supersededBy: string | null
  note: string
  updatedAt: Date
}

export interface LanguageGovernanceDb {
  languageBenchmarkMeasurement: {
    findFirst(args?: Record<string, unknown>): Promise<MeasurementRow | null>
    findMany(args?: Record<string, unknown>): Promise<MeasurementRow[]>
    upsert(args: { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> }): Promise<MeasurementRow>
  }
  languageCapabilityReview: {
    create(args: { data: Record<string, unknown> }): Promise<LanguageReviewRow>
    findMany(args?: Record<string, unknown>): Promise<LanguageReviewRow[]>
  }
  languageCapabilityStatus: {
    findFirst(args?: Record<string, unknown>): Promise<LanguageStatusRow | null>
    findMany(args?: Record<string, unknown>): Promise<LanguageStatusRow[]>
    upsert(args: { where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown> }): Promise<LanguageStatusRow>
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<LanguageStatusRow>
    findUnique(args: { where: Record<string, unknown> }): Promise<LanguageStatusRow | null>
  }
}

export function languageGovernanceDbFromPrisma(client: unknown): LanguageGovernanceDb {
  return client as LanguageGovernanceDb
}

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const LANGUAGE_REVIEW_DECISIONS = ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const
export type LanguageReviewDecision = (typeof LANGUAGE_REVIEW_DECISIONS)[number]

export const LANGUAGE_CAPABILITY_STATUSES = [
  'UNSUPPORTED',
  'UNMEASURED',
  'EXPERIMENTAL',
  'LIMITED',
  'IN_REVIEW',
  'VERIFIED',
  'REVOKED',
  'SUPERSEDED',
] as const
export type LanguageCapabilityStatusValue = (typeof LANGUAGE_CAPABILITY_STATUSES)[number]

const REVIEWABLE_TASKS: readonly Ci3LanguageTask[] = ['TEXT_UNDERSTANDING', 'TERMINOLOGY', 'TRANSLATION', 'GENERATION']

export function isReviewableLanguageTask(task: string): task is Ci3LanguageTask {
  return (REVIEWABLE_TASKS as readonly string[]).includes(task)
}

/** Canonical checksum of a benchmark case set (CI-5F harness standard). */
export function computeBenchmarkChecksum(caseSets: readonly { id: string; language: string; task: string; user: string; detail: string }[]): string {
  const canonical = caseSets
    .map((c) => ({ id: c.id, language: c.language, task: c.task, user: c.user, detail: c.detail }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

// ─── Measurement persistence ──────────────────────────────────────────────────

export interface LanguageMeasurementInput {
  languageTag: string
  task: Ci3LanguageTask
  passed: boolean
  testRef: string
  measuredAt: string | Date
  dialect?: string | null
  modelProvider?: string | null
  modelVersion?: string | null
  domain?: string | null
  benchmarkVersion?: string | null
  benchmarkChecksum?: string | null
  caseCount?: number
  passedCount?: number
}

export type LanguageGovernanceResult<T = undefined> =
  | { ok: true; value: T; note?: string }
  | { ok: false; status: number; error: string }

function normaliseBinding(rec: {
  languageTag: string
  task: string
  domain?: string | null
  dialect?: string | null
  modelProvider?: string | null
  modelVersion?: string | null
  benchmarkVersion?: string | null
}) {
  return {
    languageTag: languageByTag(rec.languageTag)?.tag ?? rec.languageTag.toLowerCase(),
    task: rec.task,
    // "" sentinel = general / not-measured (compound-unique keys are non-null)
    domain: rec.domain ?? '',
    dialect: rec.dialect ?? '',
    modelProvider: rec.modelProvider ?? 'unversioned-adapter',
    modelVersion: rec.modelVersion ?? 'unversioned-adapter',
    benchmarkVersion: rec.benchmarkVersion ?? 'unversioned-benchmark',
  }
}

/**
 * Persist one benchmark measurement and recompute the persisted status for its
 * binding. Honest rules: TRANSCRIPTION is refused; a measurement — pass or
 * fail — records at most LIMITED (machine evidence); the unique binding key
  * makes re-running the same benchmark idempotent.
 */
export async function persistLanguageMeasurement(db: LanguageGovernanceDb, rec: LanguageMeasurementInput): Promise<LanguageGovernanceResult<MeasurementRow>> {
  if (rec.task === 'TRANSCRIPTION') {
    return { ok: false, status: 422, error: 'TRANSCRIPTION is structurally UNSUPPORTED (charter §9.2 consent/legal gate) — no benchmark measurement can be recorded for it' }
  }
  if (!languageByTag(rec.languageTag)) {
    return { ok: false, status: 400, error: `language "${rec.languageTag}" is outside the BEAN catalogue` }
  }
  if (!isReviewableLanguageTask(rec.task)) {
    return { ok: false, status: 400, error: `unknown language task: ${rec.task}` }
  }
  const binding = normaliseBinding(rec)
  const measuredAt = typeof rec.measuredAt === 'string' ? new Date(rec.measuredAt) : rec.measuredAt
  if (Number.isNaN(measuredAt.getTime())) {
    return { ok: false, status: 400, error: 'invalid measuredAt' }
  }
  const caseCount = rec.caseCount ?? 0
  const passedCount = rec.passedCount ?? (rec.passed ? caseCount : 0)
  if (rec.passed && caseCount > 0 && passedCount < caseCount) {
    return { ok: false, status: 400, error: `passed=true but passedCount (${passedCount}) < caseCount (${caseCount}) — a pass requires every case to pass` }
  }
  const checksum = rec.benchmarkChecksum ?? 'unchecksummed-benchmark'
  const whereKey = {
    languageTag_task_domain_dialect_modelProvider_modelVersion_benchmarkVersion_benchmarkChecksum: {
      languageTag: binding.languageTag,
      task: binding.task,
      domain: binding.domain,
      dialect: binding.dialect,
      modelProvider: binding.modelProvider,
      modelVersion: binding.modelVersion,
      benchmarkVersion: binding.benchmarkVersion,
      benchmarkChecksum: checksum,
    },
  }
  const measurement = await db.languageBenchmarkMeasurement.upsert({
    where: whereKey,
    update: {
      testRef: rec.testRef,
      passed: rec.passed,
      caseCount,
      passedCount,
      measuredAt,
    },
    create: {
      ...binding,
      benchmarkChecksum: checksum,
      testRef: rec.testRef,
      passed: rec.passed,
      caseCount,
      passedCount,
      measuredAt,
    },
  })
  // Recompute the status row for this binding: measurement ⇒ at most LIMITED.
  const statusWhere = {
    languageTag_task_domain_dialect_modelProvider_modelVersion_benchmarkVersion: {
      languageTag: binding.languageTag,
      task: binding.task,
      domain: binding.domain,
      dialect: binding.dialect,
      modelProvider: binding.modelProvider,
      modelVersion: binding.modelVersion,
      benchmarkVersion: binding.benchmarkVersion,
    },
  }
  const existingStatus = await db.languageCapabilityStatus.findUnique({ where: statusWhere })
  if (existingStatus && (existingStatus.status === 'VERIFIED' || existingStatus.status === 'REVOKED' || existingStatus.status === 'SUPERSEDED')) {
    // A human-approved (or revoked/superseded) binding is never silently
    // downgraded by a re-run of the benchmark — the review ledger governs it.
    return { ok: true, value: measurement, note: `status remains ${existingStatus.status} (human governance state is authoritative over benchmark re-runs)` }
  }
  const note = rec.passed
    ? `measured pass: ${rec.testRef} — LIMITED (machine evidence); VERIFIED requires qualified human bilingual review`
    : `measured FAIL: ${rec.testRef} — recorded honestly; the capability stays LIMITED-at-best (machine evidence only)`
  await db.languageCapabilityStatus.upsert({
    where: statusWhere,
    update: { status: 'LIMITED', basis: 'MEASUREMENT_ONLY', latestMeasurementId: measurement.id, note },
    create: {
      ...binding,
      status: 'LIMITED',
      basis: 'MEASUREMENT_ONLY',
      latestMeasurementId: measurement.id,
      approvalCount: 0,
      note,
    },
  })
  return { ok: true, value: measurement }
}

// ─── Human bilingual review (the only path to VERIFIED) ──────────────────────

export const languageReviewEvidenceSchemaIds = [
  'meaning_preservation',
  'domain_terminology',
  'grammar',
  'naturalness',
  'script_correctness',
  'mathematical_notation',
  'scientific_symbols',
  'code_switching',
  'regional_register',
  'dialect_differences',
  'ambiguous_wording',
  'unsupported_claims',
  'safety_refusal_accuracy',
] as const

export interface LanguageReviewInput {
  measurementId: string
  decision: LanguageReviewDecision
  rationale: string
  /** Checklist evidence: per-facet { status: OK|ISSUE|NOT_ASSESSED, notes }. */
  evidence: Record<string, { status: 'OK' | 'ISSUE' | 'NOT_ASSESSED'; notes?: string }>
}

/**
 * Record a bilingual reviewer's decision on an EXISTING measurement. The
 * reviewer profile must be ACTIVE (BILINGUAL_LANGUAGE) and scoped for the
 * exact tag/task/domain. The decision binds to the measurement's provider,
 * model version, benchmark version and dataset checksum — any mismatch
 * refuses. APPROVED recomputes the persisted status to VERIFIED (basis
 * HUMAN_APPROVED) and supersedes older VERIFIED bindings for the same
 * language/task/domain/dialect on other model/benchmark versions.
 */
export async function recordLanguageCapabilityReview(
  db: LanguageGovernanceDb,
  reviewer: ReviewerProfileRow,
  input: LanguageReviewInput,
): Promise<LanguageGovernanceResult<{ review: LanguageReviewRow; status: LanguageStatusRow }>> {
  if (!LANGUAGE_REVIEW_DECISIONS.includes(input.decision)) {
    return { ok: false, status: 400, error: `decision must be one of ${LANGUAGE_REVIEW_DECISIONS.join(', ')}` }
  }
  if (!input.rationale || input.rationale.trim().length < 20) {
    return { ok: false, status: 400, error: 'rationale required (min 20 chars) — the bilingual decision must carry the reviewer\u2019s reasoning' }
  }
  const missingFacets = languageReviewEvidenceSchemaIds.filter((id) => !(id in input.evidence))
  if (missingFacets.length > 0) {
    return { ok: false, status: 400, error: `evidence checklist incomplete — missing facets: ${missingFacets.join(', ')}` }
  }
  if (reviewer.status !== 'ACTIVE') {
    return { ok: false, status: 403, error: `reviewer is ${reviewer.status} — only an ACTIVE bilingual reviewer can record language decisions` }
  }

  const measurement = await db.languageBenchmarkMeasurement.findFirst({ where: { id: input.measurementId } })
  if (!measurement) {
    return { ok: false, status: 404, error: 'measurement not found — an UNMEASURED capability cannot be reviewed or approved' }
  }
  if (measurement.task === 'TRANSCRIPTION') {
    return { ok: false, status: 422, error: 'TRANSCRIPTION is structurally UNSUPPORTED (§9.2) — no human approval can change it' }
  }
  // Scope: the reviewer must be authorised for the exact language/task(/domain).
  if (!reviewerCanReviewLanguage(reviewer, measurement.languageTag, measurement.task as Ci3LanguageTask, measurement.domain)) {
    return { ok: false, status: 403, error: `reviewer ${reviewer.reviewerCode} is not authorised for ${measurement.languageTag}/${measurement.task}${measurement.domain ? ` in domain ${measurement.domain}` : ''} — scope mismatch` }
  }
  // Evidence honesty: an APPROVED decision requires every facet OK.
  if (input.decision === 'APPROVED') {
    const bad = languageReviewEvidenceSchemaIds.filter((id) => input.evidence[id].status !== 'OK')
    if (bad.length > 0) {
      return { ok: false, status: 400, error: `APPROVED requires every evidence facet OK — issues/not-assessed: ${bad.join(', ')}` }
    }
  }

  const review = await db.languageCapabilityReview.create({
    data: {
      measurementId: measurement.id,
      languageTag: measurement.languageTag,
      task: measurement.task,
      domain: measurement.domain,
      dialect: measurement.dialect,
      modelProvider: measurement.modelProvider,
      modelVersion: measurement.modelVersion,
      benchmarkVersion: measurement.benchmarkVersion,
      benchmarkChecksum: measurement.benchmarkChecksum,
      reviewerStudentId: reviewer.studentId,
      reviewerCode: reviewer.reviewerCode,
      reviewerQualification: reviewer.qualificationCategory ?? 'recorded qualification',
      decision: input.decision,
      rationale: input.rationale,
      evidence: JSON.stringify({ checklist: input.evidence, evidenceSchemaVersion: 1 }),
    },
  })

  const statusWhere = {
    languageTag_task_domain_dialect_modelProvider_modelVersion_benchmarkVersion: {
      languageTag: measurement.languageTag,
      task: measurement.task,
      domain: measurement.domain,
      dialect: measurement.dialect,
      modelProvider: measurement.modelProvider,
      modelVersion: measurement.modelVersion,
      benchmarkVersion: measurement.benchmarkVersion,
    },
  }
  const prior = await db.languageCapabilityStatus.findUnique({ where: statusWhere })
  const priorReviewIds = prior ? (JSON.parse(prior.contributingReviewIds) as string[]) : []
  const contributingReviewIds = JSON.stringify([...priorReviewIds, review.id])

  let status: LanguageStatusRow
  if (input.decision === 'APPROVED') {
    if (prior && (prior.status === 'REVOKED' || prior.status === 'SUPERSEDED')) {
      return { ok: false, status: 409, error: `this capability binding is ${prior.status} — a revoked or superseded binding cannot be re-approved implicitly; record a NEW measurement for the current model/benchmark and review that` }
    }
    status = await db.languageCapabilityStatus.upsert({
      where: statusWhere,
      update: { status: 'VERIFIED', basis: 'HUMAN_APPROVED', approvalCount: priorReviewIds.filter((id) => true).length + 1, contributingReviewIds, note: `VERIFIED by qualified bilingual review (${review.reviewerCode}); bound to measurement ${measurement.id} (provider ${measurement.modelProvider}, model ${measurement.modelVersion}, benchmark ${measurement.benchmarkVersion})` },
      create: {
        languageTag: measurement.languageTag,
        task: measurement.task,
        domain: measurement.domain,
        dialect: measurement.dialect,
        modelProvider: measurement.modelProvider,
        modelVersion: measurement.modelVersion,
        benchmarkVersion: measurement.benchmarkVersion,
        status: 'VERIFIED',
        basis: 'HUMAN_APPROVED',
        latestMeasurementId: measurement.id,
        approvalCount: 1,
        contributingReviewIds,
        note: `VERIFIED by qualified bilingual review (${review.reviewerCode}); bound to measurement ${measurement.id}`,
      },
    })
    // Regression protection: older VERIFIED bindings for the same
    // language/task/domain/dialect on OTHER model/benchmark versions are now
    // SUPERSEDED — a new model version must earn its own verification.
    const siblings = await db.languageCapabilityStatus.findMany({
      where: {
        languageTag: measurement.languageTag,
        task: measurement.task,
        status: 'VERIFIED',
        id: { not: status.id },
      },
    })
    for (const sibling of siblings) {
      if (sibling.domain !== measurement.domain || sibling.dialect !== measurement.dialect) continue
      await db.languageCapabilityStatus.update({
        where: { id: sibling.id },
        data: { status: 'SUPERSEDED', supersededBy: status.id, note: `${sibling.note} — superseded by ${status.id} (newer model/benchmark binding verified)` },
      })
    }
  } else {
    // REJECTED / CHANGES_REQUESTED — the objection is recorded; the binding
    // stays LIMITED-at-best (machine evidence) with the review referenced.
    status = await db.languageCapabilityStatus.upsert({
      where: statusWhere,
      update: { contributingReviewIds, note: `${prior?.note ?? 'measured capability'} — ${input.decision.toLowerCase()} recorded by ${review.reviewerCode}: ${input.rationale.slice(0, 160)}` },
      create: {
        languageTag: measurement.languageTag,
        task: measurement.task,
        domain: measurement.domain,
        dialect: measurement.dialect,
        modelProvider: measurement.modelProvider,
        modelVersion: measurement.modelVersion,
        benchmarkVersion: measurement.benchmarkVersion,
        status: 'LIMITED',
        basis: 'MEASUREMENT_ONLY',
        latestMeasurementId: measurement.id,
        approvalCount: 0,
        contributingReviewIds,
        note: `measured capability with a recorded ${input.decision.toLowerCase()} by ${review.reviewerCode}`,
      },
    })
  }
  return { ok: true, value: { review, status } }
}

// ─── Revocation (history preserved) ───────────────────────────────────────────

export async function revokeLanguageCapability(
  db: LanguageGovernanceDb,
  admin: { studentId: string; displayName: string },
  binding: { languageTag: string; task: string; domain?: string | null; dialect?: string | null; modelProvider?: string | null; modelVersion?: string | null; benchmarkVersion?: string | null },
  reason: string,
): Promise<LanguageGovernanceResult<LanguageStatusRow>> {
  if (!reason || reason.trim().length < 20) {
    return { ok: false, status: 400, error: 'revocation requires a reason (min 20 chars) — revocation is audited and the historical approval is preserved' }
  }
  const b = normaliseBinding(binding)
  const statusWhere = {
    languageTag_task_domain_dialect_modelProvider_modelVersion_benchmarkVersion: {
      languageTag: b.languageTag,
      task: b.task,
      domain: b.domain,
      dialect: b.dialect,
      modelProvider: b.modelProvider,
      modelVersion: b.modelVersion,
      benchmarkVersion: b.benchmarkVersion,
    },
  }
  const existing = await db.languageCapabilityStatus.findUnique({ where: statusWhere })
  if (!existing) {
    return { ok: false, status: 404, error: 'no capability status row exists for this binding — nothing to revoke' }
  }
  if (existing.status === 'REVOKED') {
    return { ok: false, status: 409, error: 'binding is already REVOKED' }
  }
  const updated = await db.languageCapabilityStatus.update({
    where: { id: existing.id },
    data: {
      status: 'REVOKED',
      basis: 'REVOKED',
      note: `${existing.note} — REVOKED by ${admin.displayName} (${admin.studentId}): ${reason}`,
    },
  })
  void updated
  return { ok: true, value: updated, note: 'revocation preserves the historical review rows and the prior approval record' }
}

// ─── Effective resolution (what every consumer should read) ───────────────────

export interface EffectiveCapability {
  languageTag: string
  task: string
  status: LanguageCapabilityStatusValue
  basis: string
  note: string
  binding: {
    statusRowId: string | null
    modelProvider: string | null
    modelVersion: string | null
    benchmarkVersion: string | null
    measurementId: string | null
  }
}

export interface ModelContext {
  modelProvider?: string
  modelVersion?: string
  benchmarkVersion?: string
}

/**
 * Resolve the effective capability for a language+task from PERSISTED state
 * (falls back to the honest catalogue defaults when no durable row exists).
 *
 * Without a model context (registry views): VERIFIED binding → best measured
 * LIMITED → REVOKED when nothing else stands → catalogue default.
 *
 * WITH a model context (the runtime gate): the binding matching the context
 * wins; if the matching row is not VERIFIED — or no binding exists for the
 * current model — the capability is at best LIMITED with an honest note.
 * A previously VERIFIED binding is never silently treated as valid for a new
 * model or benchmark version (CI-5H regression protection).
 */
export async function resolveEffectiveCapability(db: LanguageGovernanceDb, languageTag: string, task: Ci3LanguageTask, modelContext?: ModelContext): Promise<EffectiveCapability> {
  const tag = languageByTag(languageTag)?.tag ?? languageTag.toLowerCase()
  if (task === 'TRANSCRIPTION') {
    return {
      languageTag: tag,
      task,
      status: 'UNSUPPORTED',
      basis: 'STRUCTURAL',
      note: 'structural: the charter §9.2 consent/legal gate is not satisfied — no measurement, benchmark or human approval can change this',
      binding: { statusRowId: null, modelProvider: null, modelVersion: null, benchmarkVersion: null, measurementId: null },
    }
  }
  const rows = await db.languageCapabilityStatus.findMany({ where: { languageTag: tag, task }, orderBy: { updatedAt: 'desc' as const } })

  if (modelContext) {
    const matches = (r: LanguageStatusRow) =>
      (!modelContext.modelProvider || r.modelProvider === modelContext.modelProvider) &&
      (!modelContext.modelVersion || r.modelVersion === modelContext.modelVersion) &&
      (!modelContext.benchmarkVersion || r.benchmarkVersion === modelContext.benchmarkVersion)
    const exact = rows.find(matches)
    if (exact) {
      return {
        languageTag: tag,
        task,
        status: exact.status as LanguageCapabilityStatusValue,
        basis: exact.basis,
        note: exact.note,
        binding: { statusRowId: exact.id, modelProvider: exact.modelProvider, modelVersion: exact.modelVersion, benchmarkVersion: exact.benchmarkVersion, measurementId: exact.latestMeasurementId },
      }
    }
    // no binding for the current model: the best this capability can be is LIMITED
    const verifiedElsewhere = rows.find((r) => r.status === 'VERIFIED')
    const measuredElsewhere = rows.find((r) => r.status === 'LIMITED')
    const measuredId = measuredElsewhere?.latestMeasurementId ?? null
    const note = verifiedElsewhere
      ? `a VERIFIED binding exists for ${verifiedElsewhere.modelProvider}/${verifiedElsewhere.modelVersion ?? 'unversioned'} (benchmark ${verifiedElsewhere.benchmarkVersion ?? 'unversioned'}), but the CURRENT model ${modelContext.modelProvider ?? 'unknown'}/${modelContext.modelVersion ?? 'unknown'} is not verified for this task — machine-measured evidence only (LIMITED at best); a new qualified review is required`
      : `no durable binding exists for the current model ${modelContext.modelProvider ?? 'unknown'}/${modelContext.modelVersion ?? 'unknown'} — machine-measured evidence only (LIMITED at best)`
    return {
      languageTag: tag,
      task,
      status: 'LIMITED',
      basis: 'MEASUREMENT_ONLY',
      note,
      binding: { statusRowId: measuredElsewhere?.id ?? null, modelProvider: measuredElsewhere?.modelProvider ?? null, modelVersion: measuredElsewhere?.modelVersion ?? null, benchmarkVersion: measuredElsewhere?.benchmarkVersion ?? null, measurementId: measuredId },
    }
  }

  const verified = rows.find((r) => r.status === 'VERIFIED')
  if (verified) {
    return {
      languageTag: tag,
      task,
      status: 'VERIFIED',
      basis: verified.basis,
      note: verified.note,
      binding: { statusRowId: verified.id, modelProvider: verified.modelProvider, modelVersion: verified.modelVersion, benchmarkVersion: verified.benchmarkVersion, measurementId: verified.latestMeasurementId },
    }
  }
  const measured = rows.find((r) => r.status === 'LIMITED')
  if (measured) {
    return {
      languageTag: tag,
      task,
      status: 'LIMITED',
      basis: measured.basis,
      note: measured.note,
      binding: { statusRowId: measured.id, modelProvider: measured.modelProvider, modelVersion: measured.modelVersion, benchmarkVersion: measured.benchmarkVersion, measurementId: measured.latestMeasurementId },
    }
  }
  const revoked = rows.find((r) => r.status === 'REVOKED')
  if (revoked) {
    return {
      languageTag: tag,
      task,
      status: 'REVOKED',
      basis: revoked.basis,
      note: revoked.note,
      binding: { statusRowId: revoked.id, modelProvider: revoked.modelProvider, modelVersion: revoked.modelVersion, benchmarkVersion: revoked.benchmarkVersion, measurementId: revoked.latestMeasurementId },
    }
  }
  const defaultView = (await import('./language')).defaultLanguageCapabilities().find((c) => c.language === tag && c.task === task)
  return {
    languageTag: tag,
    task,
    status: (defaultView?.status as LanguageCapabilityStatusValue) ?? 'UNMEASURED',
    basis: 'DEFAULT_UNMEASURED',
    note: defaultView?.note ?? 'unmeasured — no durable measurement exists',
    binding: { statusRowId: null, modelProvider: null, modelVersion: null, benchmarkVersion: null, measurementId: null },
  }
}

export async function isCapabilityVerifiedDurable(db: LanguageGovernanceDb, languageTag: string, task: Ci3LanguageTask, modelContext?: ModelContext): Promise<boolean> {
  return (await resolveEffectiveCapability(db, languageTag, task, modelContext)).status === 'VERIFIED'
}

/** Refusal reason for consumers — null when the capability is cleared. */
export async function capabilityRefusalReasonDurable(db: LanguageGovernanceDb, languageTag: string, task: Ci3LanguageTask, modelContext?: ModelContext): Promise<string | null> {
  const eff = await resolveEffectiveCapability(db, languageTag, task, modelContext)
  if (eff.status === 'VERIFIED') return null
  if (eff.status === 'UNSUPPORTED' && task === 'TRANSCRIPTION') {
    return `${eff.languageTag}/${eff.task} is UNSUPPORTED: ${eff.note}`
  }
  return `${eff.languageTag}/${eff.task} is ${eff.status}: ${eff.note}`
}

/** Full durable view for UIs: catalogue defaults merged with persisted rows. */
export async function listDurableLanguageCapabilities(db: LanguageGovernanceDb): Promise<(EffectiveCapability & { dialect: string | null; domain: string | null })[]> {
  const out: (EffectiveCapability & { dialect: string | null; domain: string | null })[] = []
  for (const lang of CI3_LANGUAGES) {
    for (const task of CI3_LANGUAGE_TASKS) {
      const eff = await resolveEffectiveCapability(db, lang.tag, task)
      let dialect: string | null = null
      let domain: string | null = null
      if (eff.binding.statusRowId) {
        const row = await db.languageCapabilityStatus.findUnique({ where: { id: eff.binding.statusRowId } })
        dialect = row?.dialect ?? null
        domain = row?.domain ?? null
      }
      out.push({ ...eff, dialect, domain })
    }
  }
  return out
}
