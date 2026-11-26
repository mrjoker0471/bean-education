// ─── BEAN Classroom Intelligence (CI-6C): independent credential verification ──
// The administrator workbench record: one append-only ExpertVerificationRecord
// per human credential examination. Hard separation of concerns, preserving
// CI-5's authority boundaries:
//   • VERIFICATION ≠ QUALIFICATION: a verification record documents that a
//     real authorised administrator examined a real credential (documents,
//     issuing body or published registry). It NEVER by itself changes the
//     reviewer lifecycle — status changes remain exclusively the CI-5B strict
//     transition table (decideReviewerQualification/activateReviewer/...), and
//     profile.verificationStatus is still written only there.
//   • No self-dealing: the administrator acting on a profile cannot be the
//     profile's own account (same rule as CI-5B's selfReviewGuard).
//   • Nothing is trusted from the client: the actor is requireAdmin-resolved,
//     the applicant is resolved by profileId from the server DB, and the
//     strict schema refuses forged privileged fields outright.
//   • Honest methods only: DOCUMENT_EXAMINATION requires at least one evidence
//     document that exists and belongs to the profile; ISSUING_BODY_REFERENCE
//     and PUBLISHED_REGISTRY require a recorded reference detail. No
//     third-party verification result is ever invented.
//   • Possession of an uploaded document is never treated as proof of its
//     authenticity — the record names the METHOD and the human decision.

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ReviewerProfileRow } from './reviewers'

// ─── Vocabularies ──────────────────────────────────────────────────────────────

export const CREDENTIAL_TYPES = [
  'DEGREE',
  'CERTIFICATION',
  'LICENCE',
  'EMPLOYMENT',
  'PUBLICATION',
  'REFERENCE',
  'OTHER',
] as const
export type CredentialType = (typeof CREDENTIAL_TYPES)[number]

/**
 * Honest verification methods. There is deliberately no "API" or "automatic"
 * method: every verification is a documented human examination.
 */
export const VERIFICATION_METHODS = [
  'DOCUMENT_EXAMINATION',
  'ISSUING_BODY_REFERENCE',
  'PUBLISHED_REGISTRY',
] as const
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

export const VERIFICATION_DECISIONS = [
  'VERIFIED',
  'REJECTED',
  'NEEDS_MORE_EVIDENCE',
  'SUPERSEDED',
] as const
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number]

/** Profile states in which verification records may be added. */
const VERIFIABLE_STATUSES = [
  'APPLICATION_PENDING',
  'QUALIFICATION_REVIEW',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
] as const

// ─── Structural DB view ────────────────────────────────────────────────────────

export interface VerificationRecordRow {
  id: string
  profileId: string
  credentialType: string
  issuingInstitution: string
  qualificationScope: string
  evidenceIds: string
  verificationMethod: string
  referenceDetail: string | null
  decision: string
  reason: string
  expiresAt: Date | null
  verifiedByAdminId: string
  verifiedAt: Date
  createdAt: Date
}

export interface VerificationDb {
  expertReviewerProfile: {
    findUnique(args: { where: Record<string, unknown> }): Promise<ReviewerProfileRow | null>
  }
  expertReviewerEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
  expertCredentialEvidence: {
    findUnique(args: { where: Record<string, unknown> }): Promise<{ id: string; profileId: string; retentionState: string } | null>
  }
  expertVerificationRecord: {
    create(args: { data: Record<string, unknown> }): Promise<VerificationRecordRow>
    findUnique(args: { where: Record<string, unknown> }): Promise<VerificationRecordRow | null>
    findMany(args?: Record<string, unknown>): Promise<VerificationRecordRow[]>
  }
}

export function verificationDbFromPrisma(client: unknown): VerificationDb {
  return client as VerificationDb
}

export type VerificationOpResult<T = undefined> =
  | { ok: true; record: VerificationRecordRow; value?: T }
  | { ok: false; status: number; error: string }

// ─── Record a verification examination ────────────────────────────────────────

const verificationInputSchema = z.object({
  credentialType: z.enum(CREDENTIAL_TYPES),
  issuingInstitution: z.string().min(2, 'issuing institution required').max(200),
  qualificationScope: z.string().min(4, 'the scope this credential covers is required (domain ids and/or language tags)').max(500),
  evidenceIds: z.array(z.string().min(1)).max(20).optional(),
  verificationMethod: z.enum(VERIFICATION_METHODS),
  referenceDetail: z.string().max(500).optional(),
  decision: z.enum(VERIFICATION_DECISIONS),
  reason: z.string().min(20, 'a documented reason is required for every verification decision (especially adverse ones)').max(2000),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict()

function parseEvidenceIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : []
  } catch {
    return []
  }
}

/**
 * Record one credential verification examination. Append-only: corrections are
 * NEW records (SUPERSEDED), never edits. The profile's status, scope and
 * verificationStatus are deliberately untouched by this function.
 */
export async function recordVerification(
  db: VerificationDb,
  admin: { studentId: string; displayName: string },
  profileId: string,
  input: unknown,
): Promise<VerificationOpResult> {
  const parsed = verificationInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid verification record: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'expert application not found' }
  // No self-dealing — the acting administrator cannot be the applicant.
  if (admin.studentId === profile.studentId) {
    return { ok: false, status: 403, error: 'an administrator cannot verify their own credential application — verification requires a different authorised administrator' }
  }
  if (!VERIFIABLE_STATUSES.includes(profile.status as (typeof VERIFIABLE_STATUSES)[number])) {
    return { ok: false, status: 409, error: `application is ${profile.status} — verification records apply to non-terminal applications` }
  }
  const data = parsed.data

  // Honest-method requirements: document examination must reference real,
  // ACTIVE evidence of THIS profile; external checks must record the reference.
  let evidenceIds: string[] = []
  if (data.verificationMethod === 'DOCUMENT_EXAMINATION') {
    evidenceIds = data.evidenceIds ?? []
    if (evidenceIds.length === 0) {
      return { ok: false, status: 400, error: 'DOCUMENT_EXAMINATION requires at least one evidence document reference — possession claims without examined documents are refused' }
    }
    for (const evidenceId of evidenceIds) {
      const evidence = await db.expertCredentialEvidence.findUnique({ where: { id: evidenceId } })
      if (!evidence || evidence.profileId !== profile.id) {
        return { ok: false, status: 400, error: `evidence ${evidenceId} does not exist for this application` }
      }
      if (evidence.retentionState !== 'ACTIVE') {
        return { ok: false, status: 409, error: `evidence ${evidenceId} is purged — purged documents cannot back a verification decision` }
      }
    }
  } else {
    evidenceIds = data.evidenceIds ?? []
    for (const evidenceId of evidenceIds) {
      const evidence = await db.expertCredentialEvidence.findUnique({ where: { id: evidenceId } })
      if (!evidence || evidence.profileId !== profile.id) {
        return { ok: false, status: 400, error: `evidence ${evidenceId} does not exist for this application` }
      }
    }
    if (!data.referenceDetail || data.referenceDetail.trim().length < 4) {
      return { ok: false, status: 400, error: `${data.verificationMethod} requires a recorded reference detail (registry entry or issuing-body contact) — unverifiable external claims are refused` }
    }
  }

  const created = await db.expertVerificationRecord.create({
    data: {
      profileId: profile.id,
      credentialType: data.credentialType,
      issuingInstitution: data.issuingInstitution,
      qualificationScope: data.qualificationScope,
      evidenceIds: JSON.stringify(evidenceIds),
      verificationMethod: data.verificationMethod,
      referenceDetail: data.referenceDetail ?? null,
      decision: data.decision,
      reason: data.reason,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      verifiedByAdminId: admin.studentId,
      verifiedAt: new Date(),
    },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'CREDENTIAL_VERIFICATION_RECORDED',
      actorKind: 'ADMIN',
      actorId: admin.studentId,
      rationale: `credential verification recorded: ${data.credentialType} (${data.verificationMethod}) → ${data.decision}`,
      payload: JSON.stringify({
        recordId: created.id,
        decision: data.decision,
        method: data.verificationMethod,
        evidenceCount: evidenceIds.length,
        expiresAt: data.expiresAt ?? null,
      }),
    },
  })
  return { ok: true, record: created }
}

export async function listVerificationRecords(db: VerificationDb, profileId: string): Promise<VerificationRecordRow[]> {
  return db.expertVerificationRecord.findMany({ where: { profileId }, orderBy: { createdAt: 'asc' } }) as Promise<VerificationRecordRow[]>
}

/**
 * The server-computed verification state for one profile, derived ONLY from
 * the append-only records (never a client-supplied flag). Semantics: for each
 * credentialType the LATEST record governs — VERIFIED and unexpired counts as
 * verified for that type; SUPERSEDED/REJECTED/NEEDS_MORE_EVIDENCE do not.
 * Corrections are new rows, so the newest human decision is the truth.
 */
export function resolveVerificationState(
  records: VerificationRecordRow[],
  now: Date = new Date(),
): { verified: boolean; latestDecision: string | null; verifiedRecordIds: string[] } {
  const byType = new Map<string, VerificationRecordRow[]>()
  for (const r of records) {
    const list = byType.get(r.credentialType) ?? []
    list.push(r)
    byType.set(r.credentialType, list)
  }
  const verifiedRecordIds: string[] = []
  for (const list of byType.values()) {
    const sorted = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const latest = sorted[sorted.length - 1]
    if (latest.decision === 'VERIFIED' && (!latest.expiresAt || latest.expiresAt.getTime() >= now.getTime())) {
      verifiedRecordIds.push(latest.id)
    }
  }
  return {
    verified: verifiedRecordIds.length > 0,
    latestDecision: records.length > 0 ? records[records.length - 1].decision : null,
    verifiedRecordIds,
  }
}

// Test helper (never used in production paths).
export function newVerificationId(): string {
  return `vr_${randomUUID().replace(/-/g, '')}`
}
