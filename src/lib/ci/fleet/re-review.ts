// ─── BEAN Classroom Intelligence (CI-5H): re-review lifecycle ─────────────────
// Expert validation is not permanent by assumption. This module records and
// resolves renewal DEMANDS triggered by real change events:
//   • a domain pack changes (new version / checksum) — approvals are already
//     checksum-bound, so the old approval cannot silently apply; the demand
//     makes the re-review requirement explicit and trackable;
//   • a source is revoked or its licence changes (the CI-4A ingestion gate
//     re-checks licences at query time; the demand marks the affected pack);
//   • a benchmark is updated or a model version changes materially (CI-5E
//     already isolates bindings; the demand tracks the re-assessment);
//   • a reviewer qualification expires or a safety policy changes;
//   • a confirmed material error is reported.
//
// Hard rules: previous approvals are NEVER erased (the audit trail survives);
// the demand marks current status via the ledger semantics that already exist;
// resolution is a reasoned admin action; regression protection is proven in
// tests (a previously verified capability is not silently treated as valid
// for a new model or pack version).

import { z } from 'zod'

export interface RenewalDemandRow {
  id: string
  subjectType: string
  subjectKey: string
  trigger: string
  detail: string
  demandedBy: string
  status: string
  resolution: string | null
  resolvedBy: string | null
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface RenewalDb {
  expertReviewRenewalDemand: {
    create(args: { data: Record<string, unknown> }): Promise<RenewalDemandRow>
    findFirst(args?: Record<string, unknown>): Promise<RenewalDemandRow | null>
    findMany(args?: Record<string, unknown>): Promise<RenewalDemandRow[]>
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<RenewalDemandRow>
  }
}

export function renewalDbFromPrisma(client: unknown): RenewalDb {
  return client as RenewalDb
}

export const RENEWAL_TRIGGERS = [
  'PACK_CHANGED',
  'SOURCE_REVOKED',
  'LICENCE_CHANGED',
  'BENCHMARK_UPDATED',
  'MODEL_CHANGED',
  'QUALIFICATION_EXPIRED',
  'SAFETY_POLICY_CHANGED',
  'MATERIAL_ERROR',
] as const
export type RenewalTrigger = (typeof RENEWAL_TRIGGERS)[number]

const demandSchema = z.object({
  subjectType: z.enum(['DOMAIN_PACK', 'LANGUAGE_CAPABILITY', 'CLASSROOM_REPORT']),
  subjectKey: z.string().min(3).max(160),
  trigger: z.enum(RENEWAL_TRIGGERS),
  detail: z.string().min(20).max(2000),
}).strict()

const resolveSchema = z.object({
  resolution: z.string().min(20).max(2000),
}).strict()

export type RenewalResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string }

export async function recordRenewalDemand(
  db: RenewalDb,
  actor: { studentId: string; displayName: string },
  input: unknown,
): Promise<RenewalResult<RenewalDemandRow>> {
  const parsed = demandSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid renewal demand: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const data = parsed.data
  const open = await db.expertReviewRenewalDemand.findFirst({ where: { subjectType: data.subjectType, subjectKey: data.subjectKey, trigger: data.trigger, status: 'OPEN' } })
  if (open) {
    return { ok: false, status: 409, error: `an OPEN ${data.trigger} demand already exists for ${data.subjectKey} (${open.id}) — resolve it or reference it; duplicate demands would bury the queue` }
  }
  const created = await db.expertReviewRenewalDemand.create({
    data: {
      subjectType: data.subjectType,
      subjectKey: data.subjectKey,
      trigger: data.trigger,
      detail: data.detail,
      demandedBy: actor.studentId,
      status: 'OPEN',
    },
  })
  return { ok: true, value: created }
}

export async function resolveRenewalDemand(
  db: RenewalDb,
  admin: { studentId: string; displayName: string },
  demandId: string,
  input: unknown,
): Promise<RenewalResult<RenewalDemandRow>> {
  const parsed = resolveSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid resolution: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const demand = await db.expertReviewRenewalDemand.findFirst({ where: { id: demandId } })
  if (!demand) return { ok: false, status: 404, error: 'renewal demand not found' }
  if (demand.status !== 'OPEN') return { ok: false, status: 409, error: `demand is ${demand.status} — resolutions apply to OPEN demands` }
  const updated = await db.expertReviewRenewalDemand.update({
    where: { id: demand.id },
    data: {
      status: 'RESOLVED',
      resolution: parsed.data.resolution,
      resolvedBy: admin.studentId,
      resolvedAt: new Date(),
    },
  })
  return { ok: true, value: updated }
}

export async function listRenewalDemands(db: RenewalDb, filter: { status?: string; subjectKey?: string } = {}): Promise<RenewalDemandRow[]> {
  const where: Record<string, unknown> = {}
  if (filter.status) where.status = filter.status
  if (filter.subjectKey) where.subjectKey = filter.subjectKey
  return db.expertReviewRenewalDemand.findMany({ where, orderBy: { createdAt: 'asc' as const } })
}

/**
 * Pure trigger evaluator: given the observable change facts, which renewal
 * demands SHOULD exist? Used by CI-5H reliability tests to prove the mapping
 * from real change events to demands is complete and honest.
 */
export function evaluateReReviewTriggers(facts: {
  packChecksumChanged?: { domainId: string; oldChecksum: string; newChecksum: string }
  sourceRevoked?: { sourceId: string; affectedDomains: string[] }
  licenceChanged?: { sourceId: string; oldLicence: string; newLicence: string; affectedDomains: string[] }
  benchmarkUpdated?: { benchmarkVersion: string; affectedLanguageTags: string[] }
  modelChanged?: { provider: string; oldVersion: string; newVersion: string; affectedLanguageTags: string[] }
  qualificationExpired?: { reviewerCode: string; heldScopes: string[] }
  safetyPolicyChanged?: { policyArea: string; affectedDomains: string[] }
  materialError?: { subjectKey: string; subjectType: 'DOMAIN_PACK' | 'LANGUAGE_CAPABILITY' | 'CLASSROOM_REPORT'; description: string }
}): { subjectType: string; subjectKey: string; trigger: RenewalTrigger; detail: string }[] {
  const demands: { subjectType: string; subjectKey: string; trigger: RenewalTrigger; detail: string }[] = []
  if (facts.packChecksumChanged) {
    demands.push({ subjectType: 'DOMAIN_PACK', subjectKey: facts.packChecksumChanged.domainId, trigger: 'PACK_CHANGED', detail: `pack content changed (checksum ${facts.packChecksumChanged.oldChecksum.slice(0, 12)}… → ${facts.packChecksumChanged.newChecksum.slice(0, 12)}…) — the checksum-bound approvals no longer bind; qualified re-review required for the new version` })
  }
  for (const domain of facts.sourceRevoked?.affectedDomains ?? []) {
    demands.push({ subjectType: 'DOMAIN_PACK', subjectKey: domain, trigger: 'SOURCE_REVOKED', detail: `source ${facts.sourceRevoked!.sourceId} was revoked — the affected pack's provenance must be re-reviewed` })
  }
  for (const domain of facts.licenceChanged?.affectedDomains ?? []) {
    demands.push({ subjectType: 'DOMAIN_PACK', subjectKey: domain, trigger: 'LICENCE_CHANGED', detail: `licence for ${facts.licenceChanged!.sourceId} changed (${facts.licenceChanged!.oldLicence} → ${facts.licenceChanged!.newLicence}) — ingestion and citations must be re-reviewed against the new terms` })
  }
  for (const tag of facts.benchmarkUpdated?.affectedLanguageTags ?? []) {
    demands.push({ subjectType: 'LANGUAGE_CAPABILITY', subjectKey: `${tag}:ALL`, trigger: 'BENCHMARK_UPDATED', detail: `benchmark updated to ${facts.benchmarkUpdated!.benchmarkVersion} — existing LIMITED/VERIFIED bindings are bound to the older benchmark; re-measure before any further promotion` })
  }
  for (const tag of facts.modelChanged?.affectedLanguageTags ?? []) {
    demands.push({ subjectType: 'LANGUAGE_CAPABILITY', subjectKey: `${tag}:ALL`, trigger: 'MODEL_CHANGED', detail: `model changed (${facts.modelChanged!.oldVersion} → ${facts.modelChanged!.newVersion}) — a previously verified capability is NOT silently treated as valid for the new model version; new measurement + qualified review required` })
  }
  if (facts.qualificationExpired) {
    demands.push({ subjectType: 'DOMAIN_PACK', subjectKey: facts.qualificationExpired.heldScopes.join(', ') || 'none', trigger: 'QUALIFICATION_EXPIRED', detail: `reviewer ${facts.qualificationExpired.reviewerCode} qualification expired — assignments relying on this reviewer need re-assignment or renewal` })
  }
  for (const domain of facts.safetyPolicyChanged?.affectedDomains ?? []) {
    demands.push({ subjectType: 'DOMAIN_PACK', subjectKey: domain, trigger: 'SAFETY_POLICY_CHANGED', detail: `safety policy changed (${facts.safetyPolicyChanged!.policyArea}) — the pack's safety section requires expert re-review` })
  }
  if (facts.materialError) {
    demands.push({ subjectType: facts.materialError.subjectType, subjectKey: facts.materialError.subjectKey, trigger: 'MATERIAL_ERROR', detail: `confirmed material error: ${facts.materialError.description} — current approvals must not be treated as valid until resolved` })
  }
  return demands
}

// ─── Audit-history export (append-only trail, machine-readable) ──────────────

export interface AuditExport {
  exportedAt: string
  reviewerEvents: unknown[]
  reviewerProfiles: unknown[]
  assignments: unknown[]
  assignmentEvents: unknown[]
  packReviews: unknown[]
  languageMeasurements: unknown[]
  languageReviews: unknown[]
  languageStatuses: unknown[]
  reportAudits: unknown[]
  renewalDemands: unknown[]
}

/** Full audit export across every CI-5 ledger. Read-only; ordering stable. */
export function buildAuditExport(
  rows: {
    reviewerEvents: unknown[]
    reviewerProfiles: unknown[]
    assignments: unknown[]
    assignmentEvents: unknown[]
    packReviews: unknown[]
    languageMeasurements: unknown[]
    languageReviews: unknown[]
    languageStatuses: unknown[]
    reportAudits: unknown[]
    renewalDemands: unknown[]
  },
): AuditExport {
  return {
    exportedAt: new Date().toISOString(),
    reviewerEvents: rows.reviewerEvents,
    reviewerProfiles: rows.reviewerProfiles,
    assignments: rows.assignments,
    assignmentEvents: rows.assignmentEvents,
    packReviews: rows.packReviews,
    languageMeasurements: rows.languageMeasurements,
    languageReviews: rows.languageReviews,
    languageStatuses: rows.languageStatuses,
    reportAudits: rows.reportAudits,
    renewalDemands: rows.renewalDemands,
  }
}
