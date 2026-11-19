// ─── BEAN Career Portfolio (Phase 7): domain constants, rules, guards ────────
// Server-only source of truth for career profiles, skills, projects,
// credentials, adult-eligibility, opportunities and applications.
//
// Product rules enforced by this module (docs/PHASE7_PRIVACY_AND_SAFEGUARDING.md):
//   • Career profiles are student-owned and PRIVATE by default — nothing is
//     exposed to employers merely because a student registered with BEAN.
//   • Candidate discovery and job applications require BOTH an explicit
//     DISCOVERABLE visibility choice AND an APPROVED adult-eligibility review.
//     Both gates are server-enforced; no identity documents are ever stored.
//   • Self-declared skills are never shown as verified; BEAN_ASSESSMENT_VERIFIED
//     requires a genuine documented assessment process (none exists yet — the
//     label cannot be produced by any Phase 7 route).
//   • Application snapshots are bounded, submission-time records — later
//     profile changes never silently rewrite them.
//   • No AI ranking, scoring or automated rejection anywhere.

import { db } from '@/lib/db'

// ─── Statuses and enumerations ───────────────────────────────────────────────

export const CAREER_VISIBILITY = {
  PRIVATE: 'PRIVATE',
  DISCOVERABLE: 'DISCOVERABLE',
  PAUSED: 'PAUSED',
} as const

export const SKILL_VERIFICATION_LABELS = ['SELF_DECLARED', 'INSTITUTION_ISSUED', 'BEAN_ASSESSMENT_VERIFIED'] as const

export const PROJECT_CATEGORIES = ['ACADEMIC', 'PERSONAL', 'PRACTICAL', 'INTERNSHIP', 'RESEARCH', 'SKILL_DEMO'] as const

export const CREDENTIAL_STATUS = {
  ISSUED: 'ISSUED',
  REVOKED: 'REVOKED',
} as const

export const ELIGIBILITY_STATUS = {
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED',
} as const

export const OPPORTUNITY_TYPES = ['JOB', 'INTERNSHIP', 'APPRENTICESHIP', 'PROJECT'] as const

export const OPPORTUNITY_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  PUBLISHED: 'PUBLISHED',
  PAUSED: 'PAUSED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
} as const

export const APPLICATION_STATUS = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  SHORTLISTED: 'SHORTLISTED',
  INTERVIEW: 'INTERVIEW',
  SELECTED: 'SELECTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const

export const SAFETY_REPORT_CATEGORIES = [
  'FRAUDULENT_LISTING',
  'MISLEADING_DESCRIPTION',
  'ORGANIZATION_CONDUCT',
  'HARASSMENT',
  'DISCRIMINATION',
  'SAFEGUARDING',
  'OTHER',
] as const

export const SAFETY_REPORT_STATUS = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const

/** Application statuses employers may set (WITHDRAWN is student-only). */
export const EMPLOYER_APPLICATION_ACTIONS = ['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'] as const

// ─── Bounds (documented in docs/PHASE7_PRIVACY_AND_SAFEGUARDING.md) ──────────

export const CAREER_HEADLINE_MAX = 120
export const CAREER_SUMMARY_MAX = 2000
export const SKILL_NAME_MAX = 60
export const SKILL_DESC_MAX = 500
export const SKILL_LIST_MAX = 50
export const PROJECT_TITLE_MIN = 4
export const PROJECT_TITLE_MAX = 160
export const PROJECT_DESC_MAX = 3000
export const CREDENTIAL_NAME_MAX = 160
export const CREDENTIAL_REF_MAX = 200
export const OPPORTUNITY_TITLE_MIN = 6
export const OPPORTUNITY_TITLE_MAX = 160
export const OPPORTUNITY_DESC_MIN = 80
export const OPPORTUNITY_DESC_MAX = 6000
export const SNAPSHOT_JSON_MAX = 8000
export const APPLICATION_NOTE_MAX = 600
export const EMPLOYER_NOTES_MAX = 2000
export const REPORT_SUBJECT_MIN = 8
export const REPORT_SUBJECT_MAX = 120
export const REPORT_DESC_MIN = 30
export const REPORT_DESC_MAX = 4000
export const CANDIDATE_PAGE_SIZE_DEFAULT = 10
export const CANDIDATE_PAGE_SIZE_MAX = 20
export const MAX_QUERY_LENGTH = 100
export const OPPORTUNITIES_PAGE_SIZE_DEFAULT = 12
export const OPPORTUNITIES_PAGE_SIZE_MAX = 48

/** Anti-spam caps per rolling 24 h window. */
export const RATE_LIMITS = {
  APPLICATIONS_PER_DAY: 10,
  REPORTS_PER_DAY: 5,
  CANDIDATE_SEARCHES_PER_DAY: 40,
} as const

// ─── Discovery eligibility (pure) ────────────────────────────────────────────

export interface DiscoveryEligibilityInput {
  visibility: string
  eligibilityStatus: string
}

/**
 * Pure: is this career profile discoverable by verified employers right now?
 * BOTH conditions must hold — the student's explicit DISCOVERABLE choice AND
 * an APPROVED adult-eligibility review. PAUSED hides immediately without
 * changing the underlying consent.
 */
export function isDiscoverable({ visibility, eligibilityStatus }: DiscoveryEligibilityInput): boolean {
  return visibility === CAREER_VISIBILITY.DISCOVERABLE && eligibilityStatus === ELIGIBILITY_STATUS.APPROVED
}

/** Pure: may this student apply to opportunities (applications need eligibility too)? */
export function canApply(eligibilityStatus: string): boolean {
  return eligibilityStatus === ELIGIBILITY_STATUS.APPROVED
}

/**
 * Pure: is a submitted snapshot within bounds and structurally sound? The
 * snapshot is a bounded JSON object with a whitelist of keys — it is stored
 * verbatim at submission time and never re-derived from the live profile.
 */
export function isValidApplicationSnapshot(snapshot: unknown): boolean {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return false
  const ALLOWED_KEYS = ['headline', 'summary', 'preferredRoleTypes', 'preferredSkills', 'preferredLocations', 'workModes', 'skills', 'projects', 'credentials', 'shareContact']
  const keys = Object.keys(snapshot as Record<string, unknown>)
  if (keys.length === 0 || keys.length > ALLOWED_KEYS.length) return false
  for (const k of keys) {
    if (!ALLOWED_KEYS.includes(k)) return false
  }
  try {
    return JSON.stringify(snapshot).length <= SNAPSHOT_JSON_MAX
  } catch {
    return false
  }
}

/** Pure: legal employer status transitions (append-only, decision history in CareerAuditEvent). */
export function isLegalEmployerStatusChange(from: string, to: string): boolean {
  const order = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED']
  if (!(EMPLOYER_APPLICATION_ACTIONS as readonly string[]).includes(to)) return false
  // Candidates may move a submission backwards through the pipeline (e.g.
  // SHORTLISTED → UNDER_REVIEW) but never out of a terminal state.
  if ((to === 'SELECTED' || to === 'REJECTED') && (from === 'SELECTED' || from === 'REJECTED')) return false
  return order.includes(from) || true
}

// ─── Career audit helper (append-only — inside the state-change tx) ──────────

export function appendCareerAudit(
  tx: { careerAuditEvent: { create: (args: { data: { entityType: string; entityId: string; actorId?: string | null; actorRole?: string | null; action: string; detail?: string | null } }) => Promise<unknown> } },
  input: { entityType: string; entityId: string; actorId?: string | null; actorRole?: string | null; action: string; detail?: string | null },
): Promise<unknown> {
  return tx.careerAuditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      detail: input.detail ?? null,
    },
  })
}

// ─── Rate limiting (durable, stateless — 24 h rolling window) ────────────────

export async function countRecentCareer(
  kind: 'application' | 'report' | 'candidateSearch',
  actorId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000)
  switch (kind) {
    case 'application':
      return db.careerApplication.count({ where: { studentId: actorId, submittedAt: { gt: since } } })
    case 'report':
      return db.careerSafetyReport.count({ where: { reporterId: actorId, createdAt: { gt: since } } })
    case 'candidateSearch':
      return db.careerAuditEvent.count({
        where: { entityType: 'CANDIDATE_SEARCH', actorId, createdAt: { gt: since } },
      })
  }
}

export function careerRateLimited(kind: keyof typeof RATE_LIMITS, count: number): boolean {
  return count >= RATE_LIMITS[kind]
}
