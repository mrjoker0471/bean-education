// ─── BEAN Trust & Quality (Phase 6): privacy-safe DTO mappers ────────────────
// Every Phase 6 API response is shaped here. Rules:
//   • Public review data NEVER includes emails, account ids, phone numbers or
//     complaint information. The reviewer is "Verified student" plus (only
//     with explicit consent) their optional displayName.
//   • Complaint details, reporter identity and investigation notes never
//     appear in teacher-facing or public DTOs. Teachers see an anonymous
//     open-complaint count only.
//   • Moderation reasons are visible to admins and the affected author only.

import type {
  AppealEvent,
  ClassReview,
  ComplaintEvent,
  TeachAppeal,
  TeachComplaint,
  TeacherReviewResponse,
  TrustAction,
} from '@prisma/client'
import type { TeacherQualityMetrics } from '@/lib/trust'
import { isWithinEditWindow, REVIEW_EDIT_WINDOW_DAYS, RESPONSE_EDIT_WINDOW_DAYS } from '@/lib/trust'

export interface PublicReviewDTO {
  id: string
  rating: number
  title: string | null
  reviewText: string
  createdAt: string
  editedAt: string | null
  reviewer: { label: string; displayName: string | null }
  response: { responseText: string; createdAt: string; editedAt: string | null } | null
  /** Author-only: their review's moderation state + reason. */
  ownStatus?: 'PUBLISHED' | 'FLAGGED' | 'HIDDEN'
  ownModerationReason?: string | null
  canEdit?: boolean
}

/**
 * Public review mapper. `viewerStudentId` unlocks the author-only block
 * (moderation status/reason) for the review's own author — never for anyone
 * else. `now` gates the edit-window flag.
 */
export function toPublicReview(
  review: ClassReview & { response: TeacherReviewResponse | null; student: { displayName: string | null } },
  viewerStudentId: string | null | undefined,
  now: Date,
): PublicReviewDTO {
  const isAuthor = !!viewerStudentId && viewerStudentId === review.studentId
  const dto: PublicReviewDTO = {
    id: review.id,
    rating: review.rating,
    title: review.title,
    reviewText: review.reviewText,
    createdAt: review.createdAt.toISOString(),
    editedAt: review.editedAt ? review.editedAt.toISOString() : null,
    reviewer: {
      label: 'Verified student',
      // Consent-gated displayName — never email/account id/full name otherwise.
      displayName: review.showDisplayName ? (review.student.displayName ?? null) : null,
    },
    response: review.response
      ? {
          responseText: review.response.responseText,
          createdAt: review.response.createdAt.toISOString(),
          editedAt: review.response.editedAt ? review.response.editedAt.toISOString() : null,
        }
      : null,
  }
  if (isAuthor) {
    dto.ownStatus = review.status as PublicReviewDTO['ownStatus']
    dto.ownModerationReason = review.moderationReason
    dto.canEdit =
      review.status !== 'HIDDEN' &&
      isWithinEditWindow(review.createdAt, now, REVIEW_EDIT_WINDOW_DAYS)
  }
  return dto
}

/** Teacher quality block for public teacher APIs. */
export interface PublicQualityDTO {
  averageRating: number | null
  reviewCount: number
  completedClasses: number
  completionRate: number | null
  publishedClasses: number
  /** false → UI shows "New teacher — not enough reviews yet" instead of a score. */
  sampleSufficient: boolean
}

export function toPublicQuality(metrics: TeacherQualityMetrics): PublicQualityDTO {
  return {
    averageRating: metrics.averageRating,
    reviewCount: metrics.reviewCount,
    completedClasses: metrics.completedClasses,
    completionRate: metrics.completionRate,
    publishedClasses: metrics.publishedClasses,
    sampleSufficient: metrics.sampleSufficient,
  }
}

// ─── Complaints (complainant's own view — no admin-note details leaked) ──────

export interface ComplaintEventDTO {
  id: string
  action: string
  /** Admin-added internal notes are redacted for the complainant. */
  detail: string | null
  actorRole: string
  createdAt: string
}

const COMPLAINANT_REDACTED_ACTIONS = new Set(['NOTE_ADDED'])

export function toComplaintEventDTO(event: ComplaintEvent, complainantId: string | null): ComplaintEventDTO {
  const isAdminNote = COMPLAINANT_REDACTED_ACTIONS.has(event.action) && event.actorId !== complainantId
  return {
    id: event.id,
    action: event.action,
    detail: isAdminNote ? null : event.detail,
    actorRole: event.actorRole,
    createdAt: event.createdAt.toISOString(),
  }
}

export interface OwnComplaintDTO {
  id: string
  category: string
  severity: string
  isSensitive: boolean
  subject: string
  description: string
  status: string
  classSessionId: string | null
  classTitle: string | null
  createdAt: string
  resolvedAt: string | null
  events: ComplaintEventDTO[]
}

/** The complainant's own case file — their words plus the status timeline. */
export function toOwnComplaint(
  complaint: TeachComplaint & { events: ComplaintEvent[]; classSession?: { title: string } | null },
): OwnComplaintDTO {
  return {
    id: complaint.id,
    category: complaint.category,
    severity: complaint.severity,
    isSensitive: complaint.isSensitive,
    subject: complaint.subject,
    description: complaint.description,
    status: complaint.status,
    classSessionId: complaint.classSessionId,
    classTitle: complaint.classSession?.title ?? null,
    createdAt: complaint.createdAt.toISOString(),
    resolvedAt: complaint.resolvedAt ? complaint.resolvedAt.toISOString() : null,
    events: complaint.events.map((e) => toComplaintEventDTO(e, complaint.complainantId)),
  }
}

// ─── Admin views (ADMIN-guarded routes only) ─────────────────────────────────

export interface AdminComplaintDTO extends OwnComplaintDTO {
  /** Investigator identity — admins may need to follow up with the reporter. */
  complainant: { id: string; displayName: string | null; email: string }
  assignedAdminId: string | null
  teacherProfileId: string | null
  classBookingId: string | null
  /** Full notes — the admin view keeps detail text on every event. */
  events: (ComplaintEventDTO & { detailFull: string | null })[]
}

export function toAdminComplaint(
  complaint: TeachComplaint & {
    events: ComplaintEvent[]
    classSession?: { title: string } | null
    complainant: { id: string; displayName: string | null; email: string }
  },
): AdminComplaintDTO {
  return {
    id: complaint.id,
    category: complaint.category,
    severity: complaint.severity,
    isSensitive: complaint.isSensitive,
    subject: complaint.subject,
    description: complaint.description,
    status: complaint.status,
    classSessionId: complaint.classSessionId,
    classTitle: complaint.classSession?.title ?? null,
    createdAt: complaint.createdAt.toISOString(),
    resolvedAt: complaint.resolvedAt ? complaint.resolvedAt.toISOString() : null,
    complainant: complaint.complainant,
    assignedAdminId: complaint.assignedAdminId,
    teacherProfileId: complaint.teacherProfileId,
    classBookingId: complaint.classBookingId,
    events: complaint.events.map((e) => ({
      id: e.id,
      action: e.action,
      detail: e.detail,
      detailFull: e.detail,
      actorRole: e.actorRole,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

export interface AdminReviewDTO {
  id: string
  rating: number
  title: string | null
  reviewText: string
  status: 'PUBLISHED' | 'FLAGGED' | 'HIDDEN'
  createdAt: string
  moderatedAt: string | null
  moderationReason: string | null
  classSession: { id: string; title: string } | null
  teacher: { id: string; teachingName: string } | null
  /** Reviewer identity for investigation — admin-only DTO, never public. */
  reviewer: { id: string; displayName: string | null; email: string }
  response: { responseText: string } | null
}

export function toAdminReview(
  review: ClassReview & {
    student: { id: string; displayName: string | null; email: string }
    classSession?: { id: string; title: string } | null
    teacherProfile?: { id: string; teachingName: string } | null
    response?: { responseText: string } | null
  },
): AdminReviewDTO {
  return {
    id: review.id,
    rating: review.rating,
    title: review.title,
    reviewText: review.reviewText,
    status: review.status as AdminReviewDTO['status'],
    createdAt: review.createdAt.toISOString(),
    moderatedAt: review.moderatedAt ? review.moderatedAt.toISOString() : null,
    moderationReason: review.moderationReason,
    classSession: review.classSession ?? null,
    teacher: review.teacherProfile ?? null,
    reviewer: { id: review.student.id, displayName: review.student.displayName, email: review.student.email },
    response: review.response ? { responseText: review.response.responseText } : null,
  }
}

// ─── Trust actions ───────────────────────────────────────────────────────────

export interface TrustActionDTO {
  id: string
  action: string
  reason: string
  startsAt: string
  endsAt: string | null
  isActive: boolean
  /** Effective enforcement state (expiry evaluated at read time). */
  currentlyEnforced: boolean
}

export function toTrustActionDTO(action: TrustAction, now: Date): TrustActionDTO {
  const enforced =
    action.isActive &&
    (action.endsAt === null || action.endsAt.getTime() > now.getTime())
  return {
    id: action.id,
    action: action.action,
    reason: action.reason,
    startsAt: action.startsAt.toISOString(),
    endsAt: action.endsAt ? action.endsAt.toISOString() : null,
    isActive: action.isActive,
    currentlyEnforced: enforced,
  }
}

export interface AdminTrustActionDTO extends TrustActionDTO {
  teacherProfileId: string
  teachingName: string | null
  createdByAdminId: string
  endedById: string | null
}

export function toAdminTrustAction(
  action: TrustAction & { teacherProfile?: { teachingName: string } | null },
  now: Date,
): AdminTrustActionDTO {
  return {
    ...toTrustActionDTO(action, now),
    teacherProfileId: action.teacherProfileId,
    teachingName: action.teacherProfile?.teachingName ?? null,
    createdByAdminId: action.createdByAdminId,
    endedById: action.endedById,
  }
}

// ─── Appeals ─────────────────────────────────────────────────────────────────

export interface AppealEventDTO {
  id: string
  action: string
  detail: string | null
  actorRole: string
  createdAt: string
}

export function toAppealEventDTO(event: AppealEvent): AppealEventDTO {
  return {
    id: event.id,
    action: event.action,
    detail: event.detail,
    actorRole: event.actorRole,
    createdAt: event.createdAt.toISOString(),
  }
}

export interface OwnAppealDTO {
  id: string
  targetType: string
  targetId: string
  reason: string
  status: string
  decision: string | null
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
  events: AppealEventDTO[]
}

export function toOwnAppeal(appeal: TeachAppeal & { events: AppealEvent[] }): OwnAppealDTO {
  return {
    id: appeal.id,
    targetType: appeal.targetType,
    targetId: appeal.targetId,
    reason: appeal.reason,
    status: appeal.status,
    decision: appeal.decision,
    decisionNote: appeal.decisionNote,
    decidedAt: appeal.decidedAt ? appeal.decidedAt.toISOString() : null,
    createdAt: appeal.createdAt.toISOString(),
    events: appeal.events.map(toAppealEventDTO),
  }
}

export interface AdminAppealDTO extends OwnAppealDTO {
  appellant: { id: string; displayName: string | null; email: string }
  originalDecisionById: string | null
  assignedReviewerId: string | null
}

export function toAdminAppeal(
  appeal: TeachAppeal & { events: AppealEvent[]; appellant: { id: string; displayName: string | null; email: string } },
): AdminAppealDTO {
  return {
    ...toOwnAppeal(appeal),
    appellant: appeal.appellant,
    originalDecisionById: appeal.originalDecisionById,
    assignedReviewerId: appeal.assignedReviewerId,
  }
}

// ─── Teacher trust dashboard ─────────────────────────────────────────────────

export interface TeacherTrustSummaryDTO {
  quality: PublicQualityDTO
  recentReviews: PublicReviewDTO[]
  responses: { id: string; reviewId: string; responseText: string; createdAt: string; editedAt: string | null }[]
  /** Anonymous count only — never complaint details or reporter identity. */
  openComplaintCount: number
  restrictions: TrustActionDTO[]
  appealStatus: 'NONE' | 'SUBMITTED' | 'UNDER_REVIEW' | 'UPHELD' | 'OVERTURNED' | 'CLOSED'
}

export function toResponseDTO(response: TeacherReviewResponse) {
  return {
    id: response.id,
    reviewId: response.reviewId,
    responseText: response.responseText,
    createdAt: response.createdAt.toISOString(),
    editedAt: response.editedAt ? response.editedAt.toISOString() : null,
  }
}

export function responseEditable(response: TeacherReviewResponse, now: Date): boolean {
  return isWithinEditWindow(response.createdAt, now, RESPONSE_EDIT_WINDOW_DAYS)
}
