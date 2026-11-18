// ─── BEAN Trust & Quality (Phase 6): domain constants, rules and helpers ─────
// Server-only source of truth for reviews, complaints, trust actions and
// appeals. All eligibility/authorisation decisions are made HERE against the
// session identity (httpOnly cookie) — client-supplied ids/roles are never
// trusted. Pure functions are unit-testable without a database (tests/unit/
// trust-quality.test.ts); DB access lives in the route handlers.
//
// Product rules enforced by this module (docs/PHASE6_REVIEW_POLICY.md):
//   • A review exists only for one real ATTENDED booking after the class ended.
//   • A negative review NEVER triggers a refund, suspension, rejection,
//     booking cancellation or auto-hidden review. Adverse decisions follow
//     documented investigation only.
//   • Complaints are private; they never change ratings, reviews or bookings.
//   • Trust restrictions are explicit admin records with reasons — filing a
//     complaint never creates one automatically.

import { db } from '@/lib/db'
import type { AuthStudent } from '@/lib/auth'

// ─── Statuses and enumerations ───────────────────────────────────────────────

export const REVIEW_STATUS = {
  PUBLISHED: 'PUBLISHED',
  FLAGGED: 'FLAGGED',
  HIDDEN: 'HIDDEN',
} as const

export const COMPLAINT_CATEGORIES = [
  'TEACHING_QUALITY',
  'MISLEADING_CLASS_DESCRIPTION',
  'TEACHER_CONDUCT',
  'STUDENT_CONDUCT',
  'SAFEGUARDING',
  'HARASSMENT',
  'DISCRIMINATION',
  'CLASS_CANCELLATION',
  'TECHNICAL_PROBLEM',
  'ATTENDANCE_DISPUTE',
  'OTHER',
] as const

export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number]

/** Restricted-visibility categories — ADMIN-only access, elevated severity. */
export const SENSITIVE_CATEGORIES: readonly ComplaintCategory[] = [
  'SAFEGUARDING',
  'HARASSMENT',
  'DISCRIMINATION',
] as const

export function isSensitiveCategory(category: string): boolean {
  return (SENSITIVE_CATEGORIES as readonly string[]).includes(category)
}

export const COMPLAINT_SEVERITY = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const

export const COMPLAINT_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  WAITING_FOR_INFORMATION: 'WAITING_FOR_INFORMATION',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const

/** Complaint statuses that count as "open" (not yet decided). */
export const OPEN_COMPLAINT_STATUSES: readonly string[] = [
  COMPLAINT_STATUS.OPEN,
  COMPLAINT_STATUS.ACKNOWLEDGED,
  COMPLAINT_STATUS.UNDER_REVIEW,
  COMPLAINT_STATUS.WAITING_FOR_INFORMATION,
] as const

export const TRUST_ACTION = {
  NOTICE: 'NOTICE',
  WARNING: 'WARNING',
  PAUSE_LISTINGS: 'PAUSE_LISTINGS',
  SUSPEND_PUBLISHING: 'SUSPEND_PUBLISHING',
  EMERGENCY_STOP: 'EMERGENCY_STOP',
  REINSTATE: 'REINSTATE',
} as const

export type TrustActionKind = (typeof TRUST_ACTION)[keyof typeof TRUST_ACTION]

/** Actions with server-side enforcement (NOTICE/WARNING are records only). */
export const ENFORCING_ACTIONS: readonly string[] = [
  TRUST_ACTION.PAUSE_LISTINGS,
  TRUST_ACTION.SUSPEND_PUBLISHING,
  TRUST_ACTION.EMERGENCY_STOP,
] as const

export const APPEAL_TARGET = {
  COMPLAINT_DECISION: 'COMPLAINT_DECISION',
  REVIEW_MODERATION: 'REVIEW_MODERATION',
  TRUST_ACTION: 'TRUST_ACTION',
} as const

export const APPEAL_STATUS = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  UPHELD: 'UPHELD',
  OVERTURNED: 'OVERTURNED',
  CLOSED: 'CLOSED',
} as const

/** Appeal statuses that count as open (block duplicates). */
export const OPEN_APPEAL_STATUSES: readonly string[] = [
  APPEAL_STATUS.SUBMITTED,
  APPEAL_STATUS.UNDER_REVIEW,
] as const

// ─── Tunable policy constants (documented in docs/PHASE6_SECURITY.md) ────────

export const REVIEW_EDIT_WINDOW_DAYS = 7
export const RESPONSE_EDIT_WINDOW_DAYS = 7
export const REVIEW_TITLE_MAX = 120
export const REVIEW_TEXT_MIN = 20
export const REVIEW_TEXT_MAX = 2000
export const RESPONSE_TEXT_MIN = 20
export const RESPONSE_TEXT_MAX = 1000
export const COMPLAINT_SUBJECT_MIN = 8
export const COMPLAINT_SUBJECT_MAX = 120
export const COMPLAINT_DESC_MIN = 30
export const COMPLAINT_DESC_MAX = 4000
export const APPEAL_REASON_MIN = 30
export const APPEAL_REASON_MAX = 2000
export const TRUST_REASON_MIN = 20
export const TRUST_REASON_MAX = 1000
export const MODERATION_REASON_MIN = 10
export const MODERATION_REASON_MAX = 600

/**
 * Minimum verified-review sample before a numeric average is shown publicly.
 * Below this the UI shows "New teacher — not enough reviews yet" (never a
 * fabricated zero-star score).
 */
export const QUALITY_MIN_SAMPLE = 3

/** Anti-spam caps per rolling 24 h window (enforced by row counts). */
export const RATE_LIMITS = {
  REVIEWS_PER_DAY: 10,
  COMPLAINTS_PER_DAY: 10,
  APPEALS_PER_DAY: 5,
  FLAGS_PER_DAY: 20,
} as const

/** Deadline display for safeguarding guidance — BEAN never invents numbers. */
export const SAFEGUARDING_GUIDANCE =
  'If anyone is in immediate danger, contact your local emergency services or a trusted adult right away. BEAN operators review safeguarding reports as a priority, but BEAN is not an emergency service.'

// ─── Review eligibility (pure) ───────────────────────────────────────────────

export interface ReviewEligibilityInput {
  /** The authenticated student (session identity — never a client-supplied id). */
  studentId: string
  /** The booking row for (classSessionId, studentId) or null. */
  booking: { id: string; studentId: string; classSessionId: string; status: string } | null
  /** The class the review targets. */
  classSession: { id: string; teacherProfileId: string; startsAt: Date; durationMinutes: number; status: string } | null
  /** An existing review for the same booking, if any. */
  existingReview: { id: string } | null
  now: Date
}

export type ReviewEligibility =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string }

/** Pure: may this student write a review for this class right now? */
export function evaluateReviewEligibility(input: ReviewEligibilityInput): ReviewEligibility {
  const { studentId, booking, classSession, existingReview, now } = input
  if (!classSession) return { ok: false, status: 404, error: 'Class not found' }
  if (classSession.status === 'DRAFT') return { ok: false, status: 404, error: 'Class not found' }
  if (!booking || booking.studentId !== studentId) {
    return { ok: false, status: 403, error: 'Only students who attended this class can review it.' }
  }
  if (booking.classSessionId !== classSession.id) {
    return { ok: false, status: 403, error: 'This booking does not belong to the stated class.' }
  }
  if (booking.status === 'CANCELLED') {
    return { ok: false, status: 403, error: 'Cancelled reservations cannot be reviewed.' }
  }
  if (booking.status === 'NO_SHOW') {
    return { ok: false, status: 403, error: 'Classes you did not attend cannot be reviewed.' }
  }
  if (booking.status !== 'ATTENDED') {
    return { ok: false, status: 403, error: 'Reviews open once the teacher confirms your attendance.' }
  }
  const endedAt = classSession.startsAt.getTime() + classSession.durationMinutes * 60_000
  if (endedAt > now.getTime()) {
    return { ok: false, status: 403, error: 'Reviews open after the class has ended.' }
  }
  if (existingReview) {
    return { ok: false, status: 409, error: 'You have already reviewed this class.' }
  }
  return { ok: true }
}

/** Pure: is a review still inside its self-edit window? */
export function isWithinEditWindow(createdAt: Date, now: Date, windowDays: number): boolean {
  return now.getTime() - createdAt.getTime() <= windowDays * 24 * 3600_000
}

/** Pure: rating bounds (integer 1–5). */
export function isValidRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5
}

// ─── Teacher quality indicators (pure, complaint-free by construction) ───────
// The metrics take ONLY review rows and class counts — no complaint data is
// ever an input, so complaint volume can never influence public ratings.

export interface QualityReviewRow {
  rating: number
  status: string
  isVerified: boolean
}

export interface TeacherQualityMetrics {
  /** Mean rating over published verified reviews, rounded to 1 decimal; null when no sample. */
  averageRating: number | null
  /** Count of published verified reviews. */
  reviewCount: number
  /** ClassSession rows that reached COMPLETED status. */
  completedClasses: number
  /** completed / (completed + cancelled) — null when the denominator is 0. */
  completionRate: number | null
  /** ClassSession rows currently PUBLISHED on the marketplace. */
  publishedClasses: number
  /** True when reviewCount >= QUALITY_MIN_SAMPLE — gates the numeric average. */
  sampleSufficient: boolean
}

export function computeTeacherQuality(
  reviews: QualityReviewRow[],
  classCounts: { completedClasses: number; cancelledClasses: number; publishedClasses: number },
): TeacherQualityMetrics {
  const publishedVerified = reviews.filter(
    (r) => r.status === REVIEW_STATUS.PUBLISHED && r.isVerified,
  )
  const reviewCount = publishedVerified.length
  const averageRating =
    reviewCount === 0
      ? null
      : Math.round(
          (publishedVerified.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10,
        ) / 10
  const denominator = classCounts.completedClasses + classCounts.cancelledClasses
  return {
    averageRating,
    reviewCount,
    completedClasses: classCounts.completedClasses,
    completionRate:
      denominator === 0
        ? null
        : Math.round((classCounts.completedClasses / denominator) * 100) / 100,
    publishedClasses: classCounts.publishedClasses,
    sampleSufficient: reviewCount >= QUALITY_MIN_SAMPLE,
  }
}

// ─── Trust restriction state (pure evaluation) ───────────────────────────────

export interface TrustActionRow {
  action: string
  isActive: boolean
  startsAt: Date
  endsAt: Date | null
}

export interface TrustRestrictionState {
  /** Current listings hidden from the marketplace; new bookings blocked. */
  pausedListings: boolean
  /** New class creation/publishing blocked. */
  suspendedPublishing: boolean
  /** EMERGENCY_STOP: live classroom start/token blocked immediately. */
  emergencyStop: boolean
  /** Any active enforcing restriction exists. */
  restricted: boolean
}

/**
 * Pure: evaluate which restrictions currently bite. A row is active when
 * isActive=true AND (endsAt is null OR endsAt > now) — expiry is evaluated at
 * enforcement time, so a temporary restriction ends predictably without any
 * background job. REINSTATE rows deactivate prior rows at write time and are
 * themselves never enforcing.
 */
export function evaluateTrustState(rows: TrustActionRow[], now: Date): TrustRestrictionState {
  const active = new Set<string>()
  for (const row of rows) {
    if (!(ENFORCING_ACTIONS as readonly string[]).includes(row.action)) continue
    if (!row.isActive) continue
    if (row.endsAt && row.endsAt.getTime() <= now.getTime()) continue
    active.add(row.action)
  }
  return {
    pausedListings: active.has(TRUST_ACTION.PAUSE_LISTINGS),
    suspendedPublishing: active.has(TRUST_ACTION.SUSPEND_PUBLISHING),
    emergencyStop: active.has(TRUST_ACTION.EMERGENCY_STOP),
    restricted: active.size > 0,
  }
}

/** DB fetch: currently-biting restriction rows for a teacher profile. */
export async function activeTrustActions(
  teacherProfileId: string,
  now: Date,
): Promise<TrustActionRow[]> {
  return db.trustAction.findMany({
    where: { teacherProfileId, isActive: true, action: { in: [...ENFORCING_ACTIONS] } },
    select: { action: true, isActive: true, startsAt: true, endsAt: true },
  })
}

export async function trustStateFor(
  teacherProfileId: string,
  now: Date,
): Promise<TrustRestrictionState> {
  const rows = await activeTrustActions(teacherProfileId, now)
  return evaluateTrustState(rows, now)
}

/** Human-readable explanation used in API errors and teacher-facing UI. */
export function restrictionMessage(state: TrustRestrictionState): string {
  if (state.emergencyStop) {
    return 'This classroom is temporarily unavailable while BEAN operators review a serious safety concern. Confirmed students are not losing their seats — please contact support.'
  }
  if (state.suspendedPublishing) {
    return 'New class publishing is temporarily suspended for this teacher while BEAN operators complete a review.'
  }
  if (state.pausedListings) {
    return 'This listing is temporarily paused while BEAN operators complete a review. Existing reservations are unaffected.'
  }
  return 'This action is temporarily restricted while BEAN operators complete a review.'
}

// ─── Anti-spam rate limiting (durable, stateless — 24 h rolling window) ──────

export async function countRecent(
  model: 'classReview' | 'teachComplaint' | 'teachAppeal' | 'trustFlag',
  actorId: string,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000)
  switch (model) {
    case 'classReview':
      return db.classReview.count({ where: { studentId: actorId, createdAt: { gt: since } } })
    case 'teachComplaint':
      return db.teachComplaint.count({ where: { complainantId: actorId, createdAt: { gt: since } } })
    case 'teachAppeal':
      return db.teachAppeal.count({ where: { appellantId: actorId, createdAt: { gt: since } } })
    case 'trustFlag':
      // Flags are audit events (TeachAuditEvent, entityType CLASS_REVIEW,
      // action REVIEW_FLAGGED) — counted by actor + action in the window.
      return db.teachAuditEvent.count({
        where: { actorId, entityType: 'CLASS_REVIEW', action: 'REVIEW_FLAGGED', createdAt: { gt: since } },
      })
  }
}

export function rateLimited(model: keyof typeof RATE_LIMITS, count: number): boolean {
  return count >= RATE_LIMITS[model]
}

// ─── Complaint severity derivation (server decides — clients never assert) ──

export function deriveComplaintSeverity(category: string, studentIsMinorContext: boolean): string {
  if (isSensitiveCategory(category)) {
    return studentIsMinorContext ? COMPLAINT_SEVERITY.CRITICAL : COMPLAINT_SEVERITY.HIGH
  }
  if (category === 'TEACHER_CONDUCT' || category === 'STUDENT_CONDUCT') {
    return COMPLAINT_SEVERITY.HIGH
  }
  return COMPLAINT_SEVERITY.NORMAL
}

// ─── Shared guards for Phase 6 routes ────────────────────────────────────────

export interface TrustGuardFailure {
  ok: false
  status: 401 | 403 | 404
  error: string
}

/**
 * Require an authenticated student with an APPROVED teacher profile, plus the
 * profile id — used by review-response, flag and trust-dashboard endpoints.
 */
export async function requireOwnTeacherProfile(
  student: AuthStudent,
): Promise<{ ok: true; profileId: string } | TrustGuardFailure> {
  const profile = await db.teacherProfile.findUnique({
    where: { studentId: student.id },
    select: { id: true, verificationStatus: true },
  })
  if (!profile || profile.verificationStatus !== 'APPROVED') {
    return { ok: false, status: 403, error: 'You need an approved BEAN Teacher profile to do this.' }
  }
  return { ok: true, profileId: profile.id }
}
