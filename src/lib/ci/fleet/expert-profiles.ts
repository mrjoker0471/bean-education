// ─── BEAN Classroom Intelligence (CI-6D): expert profiles & capability states ──
// The public expert directory + the applicant's own disclosure settings.
//
// FIVE DISTINCT STATES, each derived from its OWN authoritative ledger — no
// state is ever inferred from another (charter §6):
//   1. APPLICANT          → ExpertReviewerProfile.status is
//                           APPLICATION_PENDING / QUALIFICATION_REVIEW.
//   2. CREDENTIAL-VERIFIED → ExpertVerificationRecord (CI-6C append-only
//                           records; resolveVerificationState).
//   3. REVIEWER-ELIGIBLE  → profile.status === 'ACTIVE' with a non-empty
//                           server-controlled scope (lazy expiry applied).
//   4. DOMAIN APPROVAL    → ClassroomPackReview APPROVED rows (CI-4C/CI-5D
//                           append-only authority) attributed to this
//                           reviewer's server-resolved account id.
//   5. LANGUAGE VERIFIED  → LanguageCapabilityReview APPROVED rows (CI-5E
//                           append-only authority) attributed to this reviewer.
//
// Privacy: the public projection exposes ONLY consented fields (LISTED +
// disclosureConsentAt), never the account email/id, conflict-of-interest text,
// verification reasons/notes, evidence files or internal audit data.

import { z } from 'zod'
import type { ReviewerProfileRow } from './reviewers'

// ─── Structural DB view ────────────────────────────────────────────────────────

export interface ExpertProfilesDb {
  expertReviewerProfile: {
    findUnique(args: { where: Record<string, unknown> }): Promise<ReviewerProfileRow | null>
    findMany(args?: Record<string, unknown>): Promise<ReviewerProfileRow[]>
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<ReviewerProfileRow>
  }
  expertReviewerEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>
  }
  expertVerificationRecord: {
    findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; profileId: string; credentialType: string; qualificationScope: string; decision: string; expiresAt: Date | null; createdAt: Date }>>
  }
  classroomPackReview: {
    findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; packId: string; packVersion: string; decision: string; reviewerStudentId: string; createdAt: Date }>>
  }
  languageCapabilityReview: {
    findMany(args?: Record<string, unknown>): Promise<Array<{ id: string; languageTag: string; task: string; decision: string; reviewerStudentId: string; createdAt: Date }>>
  }
}

export function expertProfilesDbFromPrisma(client: unknown): ExpertProfilesDb {
  return client as ExpertProfilesDb
}

export type ProfileOpResult<T = undefined> =
  | { ok: true; profile: ReviewerProfileRow; value?: T }
  | { ok: false; status: number; error: string }

// ─── Disclosure settings (the expert's own consent) ────────────────────────────

export const PROFILE_VISIBILITY = ['PRIVATE', 'LISTED'] as const

const disclosureSchema = z.object({
  profileVisibility: z.enum(PROFILE_VISIBILITY).optional(),
  publicDisplayName: z.string().max(120).optional(),
  professionalSummary: z.string().max(1000).optional(),
  availabilityNote: z.string().max(200).optional(),
  disclosedAffiliation: z.boolean().optional(),
}).strict()

/**
 * Update the expert's own disclosure settings. LISTED requires explicit
 * consent (disclosureConsentAt recorded on first listing). These settings
 * NEVER change qualification/eligibility state — they only control what the
 * public directory may show for a profile that is already legitimately in a
 * visible state.
 */
export async function updateDisclosureSettings(
  db: ExpertProfilesDb,
  actor: { studentId: string; displayName: string },
  input: unknown,
): Promise<ProfileOpResult> {
  const parsed = disclosureSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid disclosure update: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const profile = await db.expertReviewerProfile.findUnique({ where: { studentId: actor.studentId } })
  if (!profile) return { ok: false, status: 404, error: 'no expert application exists for this account' }
  const data = parsed.data
  const listing = data.profileVisibility === 'LISTED'
  const updated = await db.expertReviewerProfile.update({
    where: { id: profile.id },
    data: {
      profileVisibility: data.profileVisibility ?? profile.profileVisibility,
      publicDisplayName: data.publicDisplayName !== undefined ? data.publicDisplayName : profile.publicDisplayName,
      professionalSummary: data.professionalSummary !== undefined ? data.professionalSummary : profile.professionalSummary,
      availabilityNote: data.availabilityNote !== undefined ? data.availabilityNote : profile.availabilityNote,
      disclosedAffiliation: data.disclosedAffiliation !== undefined ? data.disclosedAffiliation : profile.disclosedAffiliation,
      disclosureConsentAt: listing && !profile.disclosureConsentAt ? new Date() : profile.disclosureConsentAt,
    },
  })
  if (listing && !profile.disclosureConsentAt) {
    await db.expertReviewerEvent.create({
      data: {
        profileId: profile.id,
        eventType: 'CONSENT_RECORDED',
        actorKind: 'REVIEWER',
        actorId: actor.studentId,
        rationale: 'expert consented to public profile listing (disclosure settings)',
      },
    })
  }
  return { ok: true, profile: updated }
}

// ─── CI-6F: availability / workload control ────────────────────────────────────

export const AVAILABILITY_STATES = ['AVAILABLE', 'PAUSED'] as const

const availabilitySchema = z.object({
  availability: z.enum(AVAILABILITY_STATES),
}).strict()

/**
 * Reviewer-controlled availability. PAUSED reviewers receive no new
 * assignments (server-side gate in createAssignment); in-flight work is
 * unaffected. Admins see the state in the registry. Never changes
 * qualification or eligibility — workload control only.
 */
export async function setReviewerAvailability(
  db: ExpertProfilesDb,
  actor: { studentId: string; displayName: string },
  input: unknown,
): Promise<ProfileOpResult> {
  const parsed = availabilitySchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid availability update: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const profile = await db.expertReviewerProfile.findUnique({ where: { studentId: actor.studentId } })
  if (!profile) return { ok: false, status: 404, error: 'no expert application exists for this account' }
  if (profile.availability === parsed.data.availability) {
    return { ok: true, profile }
  }
  const updated = await db.expertReviewerProfile.update({
    where: { id: profile.id },
    data: { availability: parsed.data.availability },
  })
  await db.expertReviewerEvent.create({
    data: {
      profileId: profile.id,
      eventType: 'AVAILABILITY_CHANGED',
      actorKind: 'REVIEWER',
      actorId: actor.studentId,
      rationale: `availability set to ${parsed.data.availability} — ${parsed.data.availability === 'PAUSED' ? 'no new assignments will be received until resumed' : 'eligible for new scoped assignments again'}`,
    },
  })
  return { ok: true, profile: updated }
}

// ─── Public directory (five distinct states; consent-gated projection) ─────────

export interface PublicExpert {
  profileId: string
  displayName: string
  category: string
  status: string
  applicant: boolean
  credentialVerified: boolean
  reviewerEligible: boolean
  domainApprovals: number
  languageVerified: number
  verifiedAreas: string[]
  specialties: string[]
  professionalSummary: string | null
  availabilityNote: string | null
  affiliation: string | null
}

function safeJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : []
  } catch {
    return []
  }
}

/**
 * Build the consented public projection for LISTED profiles. The five states
 * come from five different ledgers; eligibility automatically respects lazy
 * expiry (the caller resolves profiles through the expiry-aware resolver).
 */
export async function listPublicExpertProfiles(db: ExpertProfilesDb, now: Date = new Date()): Promise<PublicExpert[]> {
  const listed = await db.expertReviewerProfile.findMany({ where: { profileVisibility: 'LISTED' } })
  const visible = listed.filter((p) => p.profileVisibility === 'LISTED' && p.disclosureConsentAt)
  if (visible.length === 0) return []
  const ids = visible.map((p) => p.id)
  const studentIds = visible.map((p) => p.studentId)
  const [verificationRecords, packApprovals, languageApprovals] = await Promise.all([
    db.expertVerificationRecord.findMany({ where: { profileId: { in: ids } } }),
    db.classroomPackReview.findMany({ where: { reviewerStudentId: { in: studentIds }, decision: 'APPROVED' } }),
    db.languageCapabilityReview.findMany({ where: { reviewerStudentId: { in: studentIds }, decision: 'APPROVED' } }),
  ])
  return visible.map((p) => {
    const verification = verificationRecords.filter((r) => r.profileId === p.id)
    const verifiedAreas = Array.from(
      new Set(
        verification
          .filter((r) => r.decision === 'VERIFIED' && (!r.expiresAt || r.expiresAt.getTime() >= now.getTime()))
          .flatMap((r) => r.qualificationScope.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)),
      ),
    )
    const scopeDomains = safeJsonArray(p.approvedDomains)
    const scopeLanguages = safeJsonArray(p.approvedLanguages)
    const hasScope = scopeDomains.length > 0 || scopeLanguages.length > 0
    // Eligibility mirrors CI-5's lazy-expiry rule WITHOUT writing: an ACTIVE
    // profile past its expiresAt is not eligible (read-only projection).
    const lapsed = (p.status === 'ACTIVE' || p.status === 'APPROVED') && !!p.expiresAt && p.expiresAt.getTime() < now.getTime()
    return {
      profileId: p.id,
      displayName: p.publicDisplayName?.trim() || p.reviewerCode,
      category: p.category,
      status: lapsed ? 'EXPIRED' : p.status,
      applicant: !lapsed && (p.status === 'APPLICATION_PENDING' || p.status === 'QUALIFICATION_REVIEW'),
      credentialVerified: verifiedAreas.length > 0,
      reviewerEligible: !lapsed && p.status === 'ACTIVE' && hasScope,
      domainApprovals: packApprovals.filter((r) => r.reviewerStudentId === p.studentId).length,
      languageVerified: languageApprovals.filter((r) => r.reviewerStudentId === p.studentId).length,
      verifiedAreas,
      specialties: safeJsonArray(p.specialtiesJson),
      professionalSummary: p.professionalSummary,
      availabilityNote: p.availabilityNote,
      affiliation: p.disclosedAffiliation ? p.institutionAffiliation : null,
    }
  })
}
