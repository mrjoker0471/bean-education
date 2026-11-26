// ─── BEAN Classroom Intelligence (CI-5B): expert reviewer identity & qualification ──
// Qualified human review is a FIRST-CLASS governance object, separate from BEAN
// administration:
//   • An ADMIN session (requireAdmin) is necessary to manage reviewers, but a
//     general administrator is NEVER automatically a qualified subject expert —
//     review privileges exist only through an APPROVED→ACTIVE reviewer profile
//     with explicit server-controlled scopes.
//   • Reviewer identity is resolved SERVER-SIDE from the session. Reviewer IDs,
//     display names, qualifications, scopes and statuses are never taken from
//     request bodies.
//   • Two reviewer categories with strict scope semantics:
//       DOMAIN_EXPERT      — approved for exact domainIds (pack registry).
//       BILINGUAL_LANGUAGE — approved for exact (tag, task, [domains]) scopes;
//         TRANSCRIPTION is refused at scope-write time (structural §9.2 rule).
//   • Qualification verification stores a MINIMAL verification result — never
//     original documents, government identity numbers or personal secrets.
//   • Every status transition is an append-only ExpertReviewerEvent naming a
//     real, server-resolved actor. A reviewer can never act on their own
//     qualification (self-approval refused).
//   • EXPIRED is applied lazily on read (deterministic, idempotent, SYSTEM actor)
//     so a stale qualification can never silently stay eligible.

import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { CI3_LANGUAGE_TASKS, languageByTag, type Ci3LanguageTask } from './language'
import { listDomainPacks } from './domain-packs'
import './packs/registry'

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const REVIEWER_STATUS = [
  'APPLICATION_PENDING',
  'QUALIFICATION_REVIEW',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'REVOKED',
  'REJECTED',
  // CI-6B (additive): applicant-initiated withdrawal. Terminal — a withdrawn
  // application never auto-reopens; the audit trail keeps the full history.
  'WITHDRAWN',
] as const
export type ReviewerStatus = (typeof REVIEWER_STATUS)[number]

export const REVIEWER_CATEGORY = ['DOMAIN_EXPERT', 'BILINGUAL_LANGUAGE'] as const
export type ReviewerCategory = (typeof REVIEWER_CATEGORY)[number]

export const REVIEWER_VERIFICATION = ['UNVERIFIED', 'DOCUMENT_REVIEWED', 'REFERENCED_VERIFIED'] as const
export type ReviewerVerification = (typeof REVIEWER_VERIFICATION)[number]

export const REVIEWER_EVENT_TYPES = [
  'APPLICATION_SUBMITTED',
  'QUALIFICATION_REVIEW_STARTED',
  'APPROVED',
  'ACTIVATED',
  'SUSPENDED',
  'REINSTATED',
  'EXPIRED',
  'REVOKED',
  'REJECTED',
  'SCOPE_UPDATED',
  'COI_DECLARED',
  // CI-6B (additive): application onboarding events — evidence lifecycle,
  // information-request loop, explicit consent, applicant withdrawal.
  'EVIDENCE_UPLOADED',
  'EVIDENCE_PURGED',
  'INFO_REQUESTED',
  'INFO_ANSWERED',
  'APPLICATION_WITHDRAWN',
  'CONSENT_RECORDED',
  // CI-6C (additive): a credential verification examination was recorded by an
  // authorised administrator (append-only ExpertVerificationRecord + event).
  'CREDENTIAL_VERIFICATION_RECORDED',
  // CI-6E (additive): the account claimed an expert invitation (advisory link
  // only — no privilege is granted by claiming).
  'INVITATION_CLAIMED',
] as const
export type ReviewerEventType = (typeof REVIEWER_EVENT_TYPES)[number]

/**
 * Strict transition table. Anything not listed is refused — no status change
 * is ever free-form. EXPIRED transitions are applied by the SYSTEM (lazy read)
 * and by admins (explicit renewal re-review path).
 */
export const REVIEWER_TRANSITIONS: Readonly<Record<ReviewerStatus, readonly ReviewerStatus[]>> = {
  APPLICATION_PENDING: ['QUALIFICATION_REVIEW', 'REJECTED', 'WITHDRAWN'],
  QUALIFICATION_REVIEW: ['APPROVED', 'REJECTED', 'WITHDRAWN'],
  APPROVED: ['ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED'],
  ACTIVE: ['SUSPENDED', 'REVOKED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'REVOKED', 'EXPIRED'],
  EXPIRED: ['QUALIFICATION_REVIEW', 'REVOKED'],
  REVOKED: [],
  REJECTED: [],
  WITHDRAWN: [],
}

// Statuses from which an admin action route may administer the profile at all.
const ADMINISTERABLE: readonly ReviewerStatus[] = [
  'APPLICATION_PENDING',
  'QUALIFICATION_REVIEW',
  'APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
]

/** Assignment eligibility: only an ACTIVE reviewer takes new expert work. */
export function isReviewerAssignableStatus(status: string): boolean {
  return status === 'ACTIVE'
}

// ─── Structural DB view (real Prisma client and test fakes both satisfy) ─────

export interface ReviewerProfileRow {
  id: string
  studentId: string
  reviewerCode: string
  category: string
  status: string
  approvedDomains: string // JSON string[]
  approvedLanguages: string // JSON [{ tag, tasks, domains? }]
  qualificationCategory: string | null
  professionalExperience: string | null
  // CI-6B application detail (additive columns; advisory only).
  institutionAffiliation: string | null
  specialtiesJson: string
  applicationConsentAt: Date | null
  // UNVERIFIED | DOCUMENT_REVIEWED | REFERENCED_VERIFIED
  verificationStatus: string
  verificationNote: string | null
  issuingBody: string | null
  scopeNote: string | null
  expiresAt: Date | null
  conflictOfInterest: string
  suspendedReason: string | null
  revokedReason: string | null
  // CI-6D disclosure columns (additive; consent-gated public projection).
  profileVisibility: string
  disclosureConsentAt: Date | null
  publicDisplayName: string | null
  professionalSummary: string | null
  availabilityNote: string | null
  disclosedAffiliation: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ReviewerEventRow {
  id: string
  profileId: string
  eventType: string
  actorKind: string
  actorId: string
  rationale: string | null
  payload: string | null
  createdAt: Date
}

export interface ReviewerDb {
  expertReviewerProfile: {
    create(args: { data: Record<string, unknown> }): Promise<ReviewerProfileRow>
    findUnique(args: { where: Record<string, unknown> }): Promise<ReviewerProfileRow | null>
    findMany(args?: Record<string, unknown>): Promise<ReviewerProfileRow[]>
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<ReviewerProfileRow>
  }
  expertReviewerEvent: {
    create(args: { data: Record<string, unknown> }): Promise<ReviewerEventRow>
    findMany(args?: Record<string, unknown>): Promise<ReviewerEventRow[]>
  }
}

export function reviewerDbFromPrisma(client: unknown): ReviewerDb {
  return client as ReviewerDb
}

// ─── Server-resolved actors (never from a request body) ──────────────────────

export interface AdminActor {
  kind: 'ADMIN'
  studentId: string
  displayName: string
}
export interface ReviewerActor {
  kind: 'REVIEWER'
  studentId: string
  displayName: string
}
export interface SystemActor {
  kind: 'SYSTEM'
  studentId: string
  displayName: string
}
export type ReviewerLifecycleActor = AdminActor | ReviewerActor | SystemActor

export const SYSTEM_ACTOR: SystemActor = { kind: 'SYSTEM', studentId: 'system', displayName: 'BEAN system' }

// ─── Scope validation (server-controlled; TRANSCRIPTION structurally refused) ─

export interface LanguageReviewerScope {
  tag: string
  tasks: Ci3LanguageTask[]
  /** Domain-language scope: when present, the reviewer may only review these domains. */
  domains?: string[]
}

export function knownDomainIds(): string[] {
  return listDomainPacks().map((p) => p.pack.domainId)
}

export const domainScopeSchema = z
  .array(z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/))
  .min(1, 'a DOMAIN_EXPERT needs at least one approved domain')
  .refine((ids) => new Set(ids).size === ids.length, 'duplicate domains in scope')
export const languageScopeSchema = z
  .array(
    z
      .object({
        tag: z.string().min(2).max(12),
        tasks: z.array(z.enum(CI3_LANGUAGE_TASKS)).min(1, 'each language scope needs at least one task'),
        domains: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/)).max(20).optional(),
      })
      .strict(),
  )
  .min(1, 'a BILINGUAL_LANGUAGE reviewer needs at least one language scope')
export const reviewerScopeSchema = z.object({
  approvedDomains: domainScopeSchema.optional(),
  approvedLanguages: languageScopeSchema.optional(),
}).strict()
export type ReviewerScopeInput = z.infer<typeof reviewerScopeSchema>

export function validateReviewerScope(
  category: string,
  scope: ReviewerScopeInput,
): { ok: true } | { ok: false; error: string } {
  const known = knownDomainIds()
  if (category === 'DOMAIN_EXPERT') {
    if (!scope.approvedDomains?.length) return { ok: false, error: 'a DOMAIN_EXPERT scope must list approved domains' }
    if (scope.approvedLanguages?.length) return { ok: false, error: 'a DOMAIN_EXPERT cannot carry language scopes — use the BILINGUAL_LANGUAGE category' }
    const unknown = scope.approvedDomains.filter((d) => !known.includes(d))
    if (unknown.length) return { ok: false, error: `unknown domainId(s) in scope: ${unknown.join(', ')}` }
    return { ok: true }
  }
  if (category === 'BILINGUAL_LANGUAGE') {
    if (!scope.approvedLanguages?.length) return { ok: false, error: 'a BILINGUAL_LANGUAGE scope must list language scopes' }
    if (scope.approvedDomains?.length) return { ok: false, error: 'a BILINGUAL_LANGUAGE reviewer is scoped per-language — not by domain list' }
    for (const entry of scope.approvedLanguages) {
      if (!languageByTag(entry.tag)) return { ok: false, error: `language "${entry.tag}" is outside the BEAN catalogue` }
      if (entry.tasks.includes('TRANSCRIPTION')) {
        return { ok: false, error: 'TRANSCRIPTION is structurally UNSUPPORTED (§9.2) — it can never enter a reviewer scope' }
      }
      const unknown = (entry.domains ?? []).filter((d) => !known.includes(d))
      if (unknown.length) return { ok: false, error: `unknown domainId(s) in language scope: ${unknown.join(', ')}` }
    }
    return { ok: true }
  }
  return { ok: false, error: `unknown reviewer category: ${category}` }
}

// ─── Pure scope matchers (CI-5C/5D/5E gates) ──────────────────────────────────

export interface ResolvedReviewerScope {
  approvedDomains: string[]
  approvedLanguages: LanguageReviewerScope[]
}

export function parseReviewerScope(profile: Pick<ReviewerProfileRow, 'approvedDomains' | 'approvedLanguages'>): ResolvedReviewerScope {
  const safeJson = <T,>(raw: string, fallback: T): T => {
    try {
      const v = JSON.parse(raw) as T
      return v ?? fallback
    } catch {
      return fallback
    }
  }
  return {
    approvedDomains: safeJson<string[]>(profile.approvedDomains, []),
    approvedLanguages: safeJson<LanguageReviewerScope[]>(profile.approvedLanguages, []),
  }
}

/**
 * Can this profile (already resolved + expiry-checked) review domainId?
 * A reviewer approved for Mathematics cannot approve Engineering unless
 * Engineering is also in their authorised scope.
 */
export function reviewerCanReviewDomain(profile: ReviewerProfileRow, domainId: string): boolean {
  if (profile.category !== 'DOMAIN_EXPERT') return false
  if (!isReviewerAssignableStatus(profile.status)) return false
  return parseReviewerScope(profile).approvedDomains.includes(domainId)
}

/**
 * Can this profile review language tag + task (+ domain when specialised)?
 * A Hindi reviewer cannot approve Tamil; a general bilingual reviewer cannot
 * approve a domain-language capability outside their recorded domain scope.
 * TRANSCRIPTION is structurally never reviewable.
 */
export function reviewerCanReviewLanguage(
  profile: ReviewerProfileRow,
  tag: string,
  task: Ci3LanguageTask,
  domain?: string | null,
): boolean {
  if (task === 'TRANSCRIPTION') return false
  if (profile.category !== 'BILINGUAL_LANGUAGE') return false
  if (!isReviewerAssignableStatus(profile.status)) return false
  const resolved = parseReviewerScope(profile)
  return resolved.approvedLanguages.some((entry) => {
    if (languageByTag(entry.tag)?.tag !== languageByTag(tag)?.tag) return false
    if (!entry.tasks.includes(task)) return false
    if (entry.domains && entry.domains.length > 0) {
      if (!domain || !entry.domains.includes(domain)) return false
    }
    return true
  })
}

// ─── Lazy expiry (deterministic; SYSTEM-attributed; idempotent) ───────────────

function isExpired(profile: ReviewerProfileRow, now: Date): boolean {
  return (
    (profile.status === 'APPROVED' || profile.status === 'ACTIVE') &&
    !!profile.expiresAt &&
    profile.expiresAt.getTime() < now.getTime()
  )
}

async function expireProfile(db: ReviewerDb, profile: ReviewerProfileRow, now: Date): Promise<ReviewerProfileRow> {
  await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'EXPIRED',
      actorKind: 'SYSTEM',
      actorId: SYSTEM_ACTOR.studentId,
      rationale: `qualification validity ended at ${profile.expiresAt!.toISOString()} — reviewer no longer assignable until an admin re-reviews`,
      payload: JSON.stringify({ previousStatus: profile.status }),
    },
  })
  return db.expertReviewerProfile.update({
    where: { id: profile.id },
    data: { status: 'EXPIRED' },
  })
}

/**
 * Resolve a reviewer profile by BEAN account id, applying lazy EXPIRED so a
 * stale qualification can never silently stay eligible. Returns null when the
 * account has no reviewer profile.
 */
export async function resolveReviewerProfile(
  db: ReviewerDb,
  studentId: string,
  now: Date = new Date(),
): Promise<ReviewerProfileRow | null> {
  const profile = await db.expertReviewerProfile.findUnique({ where: { studentId } })
  if (!profile) return null
  if (isExpired(profile, now)) return expireProfile(db, profile, now)
  return profile
}

/** Resolve by profile id (admin registry picks), applying the same lazy expiry. */
export async function resolveReviewerProfileById(
  db: ReviewerDb,
  profileId: string,
  now: Date = new Date(),
): Promise<ReviewerProfileRow | null> {
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return null
  if (isExpired(profile, now)) return expireProfile(db, profile, now)
  return profile
}

// ─── Lifecycle operations (the only status-write paths) ──────────────────────

export type ReviewerOpResult<T = undefined> =
  | { ok: true; profile: ReviewerProfileRow; value?: T }
  | { ok: false; status: number; error: string }

function selfReviewGuard(admin: AdminActor, profile: ReviewerProfileRow): { ok: false; status: number; error: string } | null {
  if (admin.studentId === profile.studentId) {
    return { ok: false, status: 403, error: 'a reviewer can never act on their own qualification — qualification review requires a different authorised administrator' }
  }
  return null
}

async function transitionGuarded(
  db: ReviewerDb,
  admin: AdminActor,
  profile: ReviewerProfileRow,
  to: ReviewerStatus,
  eventType: ReviewerEventType,
  rationale: string | null,
  payload: Record<string, unknown> | null,
  extra: Record<string, unknown> = {},
): Promise<ReviewerOpResult> {
  if (!ADMINISTERABLE.includes(profile.status as ReviewerStatus)) {
    return { ok: false, status: 409, error: `profile is ${profile.status} — no administration path exists for a terminal state` }
  }
  const allowed = REVIEWER_TRANSITIONS[profile.status as ReviewerStatus] ?? []
  if (!allowed.includes(to)) {
    return { ok: false, status: 409, error: `illegal transition ${profile.status} → ${to} (allowed: ${allowed.join(', ') || 'none'})` }
  }
  const updated = await db.expertReviewerProfile.update({
    where: { id: profile.id },
    data: { status: to, ...extra },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType,
      actorKind: 'ADMIN',
      actorId: admin.studentId,
      rationale,
      payload: payload ? JSON.stringify(payload) : null,
    },
  })
  return { ok: true, profile: updated }
}

const applicationInputSchema = z.object({
  category: z.enum(REVIEWER_CATEGORY),
  qualificationCategory: z.string().max(160).optional(),
  professionalExperience: z.string().max(2000).optional(),
  issuingBody: z.string().max(160).optional(),
  // CI-6B (additive, optional): institution/professional affiliation where
  // applicable and the applicant's selected specialties within their proposed
  // domains. Advisory — the admin-approved scope stays authoritative.
  institutionAffiliation: z.string().max(200).optional(),
  specialties: z.array(z.string().min(1).max(80)).max(12).optional(),
  /**
   * CI-6B explicit consent: the applicant reviewed the exact information being
   * submitted and its intended use (credential verification + reviewer
   * process) and consents to it. Must be literal true when present; the
   * CONSENT_RECORDED event + applicationConsentAt timestamp prove it.
   */
  consentGranted: z.literal(true).optional(),
  /**
   * CI-6E (optional): an expert invitation CLAIMED by THIS account. Linked as
   * provenance only — claiming never grants any privilege, and the server
   * re-validates the claim binding (invitation.claimedByStudentId === actor).
   */
  invitationId: z.string().min(4).max(64).optional(),
  /** Explicit conflict-of-interest declaration — "none declared" must be explicit. */
  conflictOfInterest: z.string().min(4, 'conflict-of-interest declaration required (explicitly state "none declared" if none)').max(2000),
  /** PROPOSED scope — advisory only; the admin-approved scope is authoritative. */
  proposedDomains: z.array(z.string()).max(20).optional(),
  proposedLanguages: z.array(z.object({ tag: z.string(), tasks: z.array(z.string()).max(8), domains: z.array(z.string()).max(20).optional() }).strict()).max(10).optional(),
}).strict()

/**
 * Submit a reviewer application. Any signed-in BEAN account may apply; the
 * account identity comes from the session (requireStudent at the route), never
 * from the body. Application status starts at APPLICATION_PENDING.
 */
export async function submitReviewerApplication(
  db: ReviewerDb,
  actor: { studentId: string; displayName: string },
  input: unknown,
  options: { invitationLink?: { id: string } } = {},
): Promise<ReviewerOpResult> {
  const parsed = applicationInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid application: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const existing = await db.expertReviewerProfile.findUnique({ where: { studentId: actor.studentId } })
  if (existing) {
    return { ok: false, status: 409, error: `a reviewer profile already exists for this account (${existing.status}) — one profile per account; REJECTED/REVOKED decisions stand` }
  }
  const data = parsed.data
  const created = await db.expertReviewerProfile.create({
    data: {
      studentId: actor.studentId,
      reviewerCode: `BR-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      category: data.category,
      status: 'APPLICATION_PENDING',
      conflictOfInterest: data.conflictOfInterest,
      qualificationCategory: data.qualificationCategory ?? null,
      professionalExperience: data.professionalExperience ?? null,
      issuingBody: data.issuingBody ?? null,
      // CI-6B additive application detail. No qualification/verification/scope
      // state is writable here — those remain admin-only paths.
      institutionAffiliation: data.institutionAffiliation ?? null,
      specialtiesJson: JSON.stringify(data.specialties ?? []),
      applicationConsentAt: data.consentGranted === true ? new Date() : null,
    },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: created.id,
      eventType: 'APPLICATION_SUBMITTED',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: `reviewer application submitted (${data.category})${options.invitationLink ? ` via claimed invitation ${options.invitationLink.id}` : ''}`,
      payload: JSON.stringify({
        proposedDomains: data.proposedDomains ?? [],
        proposedLanguages: data.proposedLanguages ?? [],
        qualificationCategory: data.qualificationCategory ?? null,
        issuingBody: data.issuingBody ?? null,
        // CI-6B: the exact information the applicant reviewed before consent.
        institutionAffiliation: data.institutionAffiliation ?? null,
        specialties: data.specialties ?? [],
        consentGranted: data.consentGranted === true,
        // CI-6E: invitation provenance (validated by the caller — claimed by
        // this account). Provenance only; claiming never grants privileges.
        invitationId: options.invitationLink?.id ?? null,
      }),
    },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: created.id,
      eventType: 'COI_DECLARED',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: data.conflictOfInterest.slice(0, 2000),
    },
  })
  if (data.consentGranted === true) {
    await db.expertReviewerEvent.create({
      data: {
        profileId: created.id,
        eventType: 'CONSENT_RECORDED',
        actorKind: 'REVIEWER',
        actorId: actor.studentId,
        rationale: 'applicant reviewed the exact submitted information and its intended use (credential verification + reviewer process) and consented',
      },
    })
  }
  return { ok: true, profile: created }
}

const qualificationDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rationale: z.string().min(20, 'qualification decision rationale required (min 20 chars)').max(2000),
  verificationStatus: z.enum(REVIEWER_VERIFICATION).optional(),
  verificationNote: z.string().max(2000).optional(),
  issuingBody: z.string().max(160).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  scope: reviewerScopeSchema.optional(),
}).strict()

/**
 * Admin qualification decision. The admin actor is server-resolved; a reviewer
 * can never approve their own qualification (self-review guard). APPROVED
 * requires a minimal verification RESULT (never UNVERIFIED), stated
 * qualifications, and a valid scope for the profile's category.
 */
export async function decideReviewerQualification(
  db: ReviewerDb,
  admin: AdminActor,
  profileId: string,
  input: unknown,
): Promise<ReviewerOpResult> {
  const parsed = qualificationDecisionSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid qualification decision: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  const data = parsed.data

  if (data.decision === 'REJECTED') {
    return transitionGuarded(db, admin, profile, 'REJECTED', 'REJECTED', data.rationale, null)
  }

  // APPROVED path — the qualification evidence must be complete and honest.
  if (!data.scope) {
    return { ok: false, status: 400, error: 'APPROVED requires the authorised scope (server-controlled; the reviewer-proposed scope is advisory only)' }
  }
  if (!data.verificationStatus || data.verificationStatus === 'UNVERIFIED') {
    return { ok: false, status: 400, error: 'APPROVED requires a verification result (DOCUMENT_REVIEWED or REFERENCED_VERIFIED) — a reviewer is never approved UNVERIFIED' }
  }
  if (!profile.qualificationCategory && !data.verificationNote) {
    return { ok: false, status: 400, error: 'APPROVED requires stated qualifications (qualificationCategory on the profile or a verification note)' }
  }
  const scopeCheck = validateReviewerScope(profile.category, data.scope)
  if (!scopeCheck.ok) return { ok: false, status: 400, error: scopeCheck.error }
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { ok: false, status: 400, error: 'invalid expiresAt' }
  }

  const updated = await db.expertReviewerProfile.update({
    where: { id: profile.id },
    data: {
      status: 'APPROVED',
      approvedDomains: JSON.stringify(data.scope.approvedDomains ?? []),
      approvedLanguages: JSON.stringify(data.scope.approvedLanguages ?? []),
      verificationStatus: data.verificationStatus,
      verificationNote: data.verificationNote ?? profile.verificationNote,
      issuingBody: data.issuingBody ?? profile.issuingBody,
      expiresAt,
      qualificationCategory: profile.qualificationCategory ?? null,
    },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'APPROVED',
      actorKind: 'ADMIN',
      actorId: admin.studentId,
      rationale: data.rationale,
      payload: JSON.stringify({
        scope: data.scope,
        verificationStatus: data.verificationStatus,
        issuingBody: data.issuingBody ?? profile.issuingBody,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      }),
    },
  })
  return { ok: true, profile: updated }
}

export async function beginQualificationReview(
  db: ReviewerDb,
  admin: AdminActor,
  profileId: string,
  rationale: string | null,
): Promise<ReviewerOpResult> {
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  return transitionGuarded(db, admin, profile, 'QUALIFICATION_REVIEW', 'QUALIFICATION_REVIEW_STARTED', rationale, null)
}

export async function activateReviewer(db: ReviewerDb, admin: AdminActor, profileId: string): Promise<ReviewerOpResult> {
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  return transitionGuarded(db, admin, profile, 'ACTIVE', 'ACTIVATED', 'reviewer activated into the assignment rotation', null)
}

export async function suspendReviewer(db: ReviewerDb, admin: AdminActor, profileId: string, reason: string): Promise<ReviewerOpResult> {
  if (!reason || reason.trim().length < 10) return { ok: false, status: 400, error: 'suspension requires a reason (min 10 chars)' }
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  return transitionGuarded(db, admin, profile, 'SUSPENDED', 'SUSPENDED', reason, null, { suspendedReason: reason })
}

export async function reinstateReviewer(db: ReviewerDb, admin: AdminActor, profileId: string, reason: string): Promise<ReviewerOpResult> {
  if (!reason || reason.trim().length < 10) return { ok: false, status: 400, error: 'reinstatement requires a reason (min 10 chars)' }
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  return transitionGuarded(db, admin, profile, 'ACTIVE', 'REINSTATED', reason, null, { suspendedReason: null })
}

export async function revokeReviewer(db: ReviewerDb, admin: AdminActor, profileId: string, reason: string): Promise<ReviewerOpResult> {
  if (!reason || reason.trim().length < 20) return { ok: false, status: 400, error: 'revocation requires a reason (min 20 chars) — revocation is terminal and audited' }
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  return transitionGuarded(db, admin, profile, 'REVOKED', 'REVOKED', reason, null, { revokedReason: reason })
}

const scopeUpdateSchema = z.object({
  scope: reviewerScopeSchema,
  rationale: z.string().min(10).max(2000),
}).strict()

export async function updateReviewerScope(db: ReviewerDb, admin: AdminActor, profileId: string, input: unknown): Promise<ReviewerOpResult> {
  const parsed = scopeUpdateSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid scope update: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
  if (!profile) return { ok: false, status: 404, error: 'reviewer profile not found' }
  const self = selfReviewGuard(admin, profile)
  if (self) return self
  const scopeCheck = validateReviewerScope(profile.category, parsed.data.scope)
  if (!scopeCheck.ok) return { ok: false, status: 400, error: scopeCheck.error }
  const updated = await db.expertReviewerProfile.update({
    where: { id: profile.id },
    data: {
      approvedDomains: JSON.stringify(parsed.data.scope.approvedDomains ?? []),
      approvedLanguages: JSON.stringify(parsed.data.scope.approvedLanguages ?? []),
    },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'SCOPE_UPDATED',
      actorKind: 'ADMIN',
      actorId: admin.studentId,
      rationale: parsed.data.rationale,
      payload: JSON.stringify({
        previous: parseReviewerScope(profile),
        updated: parsed.data.scope,
      }),
    },
  })
  return { ok: true, profile: updated }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function listReviewerProfiles(
  db: ReviewerDb,
  filter: { status?: string; category?: string } = {},
  now: Date = new Date(),
): Promise<ReviewerProfileRow[]> {
  const where: Record<string, unknown> = {}
  if (filter.status) where.status = filter.status
  if (filter.category) where.category = filter.category
  const rows = await db.expertReviewerProfile.findMany({ where, orderBy: { createdAt: 'asc' as const } })
  // Lazy expiry surfaces consistently in listings too.
  const out: ReviewerProfileRow[] = []
  for (const row of rows) {
    if (isExpired(row, now)) out.push(await expireProfile(db, row, now))
    else out.push(row)
  }
  return out
}

export async function listReviewerEvents(db: ReviewerDb, profileId: string): Promise<ReviewerEventRow[]> {
  return db.expertReviewerEvent.findMany({ where: { profileId }, orderBy: { createdAt: 'asc' as const } })
}

/**
 * Server-computed set of BEAN account ids that hold an ACTIVE reviewer profile
 * authorised for `domainId`. This is the qualification evidence the pack
 * approval path requires: an APPROVED decision may only be recorded when the
 * reviewer's account id is in this set (CI-5D — a general administrator without
 * the required reviewer qualification cannot substitute for an expert).
 */
export async function qualifyingApproverIdsForDomain(db: ReviewerDb, domainId: string, now: Date = new Date()): Promise<Set<string>> {
  const active = await listReviewerProfiles(db, { status: 'ACTIVE' }, now)
  const qualified = new Set<string>()
  for (const profile of active) {
    if (reviewerCanReviewDomain(profile, domainId)) qualified.add(profile.studentId)
  }
  return qualified
}

/**
 * Same for language capabilities: account ids holding an ACTIVE bilingual
 * profile authorised for the exact tag/task/domain scope.
 */
export async function qualifyingApproverIdsForLanguage(db: ReviewerDb, tag: string, task: Ci3LanguageTask, domain: string | null, now: Date = new Date()): Promise<Set<string>> {
  const active = await listReviewerProfiles(db, { status: 'ACTIVE' }, now)
  const qualified = new Set<string>()
  for (const profile of active) {
    if (reviewerCanReviewLanguage(profile, tag, task, domain)) qualified.add(profile.studentId)
  }
  return qualified
}
