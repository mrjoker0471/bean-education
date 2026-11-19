// ─── BEAN Teach (Phase 4A): shared constants, guards and mappers ─────────────
// Server-side source of truth for the teacher marketplace. Guards never trust
// client-supplied identity: the current user ALWAYS comes from the httpOnly
// session cookie (src/lib/auth.ts), and teacher capability is an APPROVED
// TeacherProfile — never a client-visible role field.

import { db } from '@/lib/db'
import { requireStudent, type AuthStudent } from '@/lib/auth'
import { hasRole } from '@/lib/roles'
import type { ClassBooking, ClassSession, TeacherProfile, TeachAuditEvent } from '@prisma/client'
import type {
  AdminTeachApplicationDTO,
  MyBookingDTO,
  PublicClassDTO,
  PublicTeacherDTO,
  TeachApplicationDTO,
} from '@/lib/types'

// ─── Domain constants (single source of truth for API + UI + docs) ───────────

export const TEACH_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const

export const CLASS_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const

export const BOOKING_STATUS = {
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  ATTENDED: 'ATTENDED',
  NO_SHOW: 'NO_SHOW',
} as const

export const AUDIT_ENTITY = {
  TEACHER_PROFILE: 'TEACHER_PROFILE',
  CLASS_SESSION: 'CLASS_SESSION',
  CLASS_BOOKING: 'CLASS_BOOKING',
} as const

export const AUDIT_ACTION = {
  SUBMIT: 'SUBMIT',
  RESUBMIT: 'RESUBMIT',
  EDIT_REVIEW: 'EDIT_REVIEW',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CLASS_CANCELLED: 'CLASS_CANCELLED',
  ATTENDANCE_MARKED: 'ATTENDANCE_MARKED',
} as const

/** Duration window: 60–360 minutes, 30-minute increments. */
export const DURATION_MIN = 60
export const DURATION_MAX = 360
export const DURATION_STEP = 30

/** Student capacity window. */
export const CAPACITY_MIN = 1
export const CAPACITY_MAX = 50

/** Anti-spam cap on a teacher's concurrently active (DRAFT + PUBLISHED) classes. */
export const MAX_ACTIVE_CLASSES_PER_TEACHER = 50

/** Bounded API page sizes. */
export const CLASSES_PAGE_SIZE_DEFAULT = 12
export const CLASSES_PAGE_SIZE_MAX = 48
export const TEACHERS_PAGE_SIZE_MAX = 48
export const ADMIN_PAGE_SIZE_DEFAULT = 20
export const ADMIN_PAGE_SIZE_MAX = 50
export const MAX_QUERY_LENGTH = 100

/** Education levels a teacher may serve (mirrors the onboarding LearningLevel set). */
export const TEACH_LEVELS = [
  'SCHOOL_6_8',
  'SCHOOL_9_10',
  'SCHOOL_11_12',
  'UNDERGRAD',
  'POSTGRAD',
  'PROFESSIONAL',
  'COMPETITIVE',
  'SKILL',
] as const

export const TEACH_LEVEL_LABELS: Record<string, string> = {
  SCHOOL_6_8: 'School 6–8',
  SCHOOL_9_10: 'School 9–10',
  SCHOOL_11_12: 'School 11–12',
  UNDERGRAD: 'Undergraduate',
  POSTGRAD: 'Postgraduate',
  PROFESSIONAL: 'Professional',
  COMPETITIVE: 'Competitive exams',
  SKILL: 'Skill learning',
}

export const FREE_PILOT_PRICE_LABEL = 'Planned regular price — not charged during the free pilot.'

// ─── JSON list helpers (schema stores JSON string[] in *Json columns) ────────

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

export function stringifyJsonArray(values: string[]): string {
  return JSON.stringify(values)
}

// ─── Guards ──────────────────────────────────────────────────────────────────

export type Guard<T> = { ok: true; student: AuthStudent; value: T } | { ok: false; status: 401 | 403; error: string }

/** Require any signed-in student (guests are refused with 401). */
export async function requireSignedIn(): Promise<Guard<null>> {
  const student = await requireStudent()
  if (!student) return { ok: false, status: 401, error: 'Sign in required' }
  return { ok: true, student, value: null }
}

/**
 * Require an ADMIN. Admin review is the only path to teacher approval and no
 * public API can grant the ADMIN role (roles change only via the operator CLI).
 */
export async function requireAdmin(): Promise<Guard<null>> {
  const student = await requireStudent()
  if (!student) return { ok: false, status: 401, error: 'Sign in required' }
  if (!hasRole(student.role, ['ADMIN'])) {
    return { ok: false, status: 403, error: 'Teacher review is restricted to BEAN administrators.' }
  }
  return { ok: true, student, value: null }
}

/**
 * Require an APPROVED teacher profile. A pending or rejected applicant must
 * never be able to create or publish classes, and class ownership checks are
 * always done server-side against this profile.
 */
export async function requireApprovedTeacher(): Promise<
  { ok: true; student: AuthStudent; profile: TeacherProfile } | { ok: false; status: 401 | 403; error: string }
> {
  const student = await requireStudent()
  if (!student) return { ok: false, status: 401, error: 'Sign in required' }
  const profile = await db.teacherProfile.findUnique({ where: { studentId: student.id } })
  if (!profile) {
    return { ok: false, status: 403, error: 'You need an approved BEAN Teacher profile to do this.' }
  }
  if (profile.verificationStatus !== TEACH_STATUS.APPROVED) {
    return {
      ok: false,
      status: 403,
      error:
        profile.verificationStatus === TEACH_STATUS.PENDING
          ? 'Your teacher application is still under review.'
          : 'Your teacher application was not approved — update and resubmit your application first.',
    }
  }
  return { ok: true, student, profile }
}

/** Is `student` the owner of this profile? Pure ownership comparison. */
export function isProfileOwner(student: AuthStudent, profile: Pick<TeacherProfile, 'studentId'>): boolean {
  return profile.studentId === student.id
}

// ─── Audit helper (append-only — rows are never updated or deleted) ──────────

export function appendAudit(
  tx: { teachAuditEvent: { create: (args: { data: { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail?: string | null } }) => Promise<unknown> } },
  input: { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail?: string | null },
): Promise<unknown> {
  return tx.teachAuditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      detail: input.detail ?? null,
    },
  })
}

// ─── Mappers (Prisma rows → public DTOs; private fields are never mapped) ────

/** Public teacher DTO — no email, no review notes, no private account fields. */
export function toPublicTeacher(profile: TeacherProfile, upcomingClassCount: number): PublicTeacherDTO {
  return {
    id: profile.id,
    teachingName: profile.teachingName,
    headline: profile.headline,
    bio: profile.bio,
    subjects: parseJsonArray(profile.subjectsJson),
    levels: parseJsonArray(profile.levelsJson),
    languages: parseJsonArray(profile.languagesJson),
    experienceYears: profile.experienceYears,
    portfolioUrl: profile.portfolioUrl,
    classCount: upcomingClassCount,
    memberSince: profile.createdAt.toISOString(),
  }
}

/** The applicant's own view of their application — review history stays private. */
export function toApplicationDTO(profile: TeacherProfile, reviewEvents: TeachAuditEvent[]): TeachApplicationDTO {
  return {
    id: profile.id,
    status: profile.verificationStatus as TeachApplicationDTO['status'],
    isPublished: profile.isPublished,
    teachingName: profile.teachingName,
    headline: profile.headline,
    bio: profile.bio,
    subjects: parseJsonArray(profile.subjectsJson),
    levels: parseJsonArray(profile.levelsJson),
    languages: parseJsonArray(profile.languagesJson),
    qualificationsText: profile.qualificationsText,
    experienceYears: profile.experienceYears,
    portfolioUrl: profile.portfolioUrl,
    reviewNote: profile.reviewNote,
    reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
    history: reviewEvents.map(toAuditEventDTO),
    canCreateClasses: profile.verificationStatus === TEACH_STATUS.APPROVED,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  }
}

export function toAuditEventDTO(event: TeachAuditEvent): { id: string; action: string; detail: string | null; actorRole: string; createdAt: string } {
  return {
    id: event.id,
    action: event.action,
    detail: event.detail,
    actorRole: event.actorRole,
    createdAt: event.createdAt.toISOString(),
  }
}

/**
 * Public class DTO. `heldCount` counts bookings that currently hold a seat
 * (status != CANCELLED) so completed sessions keep their attendance history
 * without corrupting future capacity math.
 */
export function toPublicClass(
  session: ClassSession,
  teacher: Pick<TeacherProfile, 'id' | 'teachingName' | 'headline'>,
): PublicClassDTO {
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    subject: session.subject,
    targetLevel: session.targetLevel,
    language: session.language,
    durationMinutes: session.durationMinutes,
    startsAt: session.startsAt.toISOString(),
    timeZone: session.timeZone,
    capacity: session.capacity,
    bookedCount: session.bookedCount,
    availableSeats: Math.max(0, session.capacity - session.bookedCount),
    minimumStudents: session.minimumStudents,
    plannedPricePaise: session.plannedPricePaise,
    status: session.status as PublicClassDTO['status'],
    audience: session.audience ?? 'PUBLIC',
    teacher: { id: teacher.id, teachingName: teacher.teachingName, headline: teacher.headline },
    createdAt: session.createdAt.toISOString(),
  }
}

/** The student's own booking view — other students' bookings are never exposed. */
export function toMyBookingDTO(
  booking: ClassBooking,
  session: Pick<ClassSession, 'id' | 'title' | 'subject' | 'startsAt' | 'durationMinutes' | 'timeZone' | 'language' | 'targetLevel' | 'status'>,
  teacherName: string,
): MyBookingDTO {
  return {
    id: booking.id,
    status: booking.status as MyBookingDTO['status'],
    bookedAt: booking.bookedAt.toISOString(),
    cancelledAt: booking.cancelledAt ? booking.cancelledAt.toISOString() : null,
    attendanceMarkedAt: booking.attendanceMarkedAt ? booking.attendanceMarkedAt.toISOString() : null,
    classSession: {
      id: session.id,
      title: session.title,
      subject: session.subject,
      startsAt: session.startsAt.toISOString(),
      durationMinutes: session.durationMinutes,
      timeZone: session.timeZone,
      language: session.language,
      targetLevel: session.targetLevel,
      status: session.status as MyBookingDTO['classSession']['status'],
      teacherName,
    },
  }
}

/** Admin application view — full details plus the applicant's account basics. */
export function toAdminApplicationDTO(
  profile: TeacherProfile,
  applicant: { displayName: string | null; email: string; learningLevel: string | null },
  history: TeachAuditEvent[],
): AdminTeachApplicationDTO {
  return {
    id: profile.id,
    verificationStatus: profile.verificationStatus as AdminTeachApplicationDTO['verificationStatus'],
    isPublished: profile.isPublished,
    teachingName: profile.teachingName,
    headline: profile.headline,
    bio: profile.bio,
    subjects: parseJsonArray(profile.subjectsJson),
    levels: parseJsonArray(profile.levelsJson),
    languages: parseJsonArray(profile.languagesJson),
    qualificationsText: profile.qualificationsText,
    experienceYears: profile.experienceYears,
    portfolioUrl: profile.portfolioUrl,
    reviewNote: profile.reviewNote,
    reviewedAt: profile.reviewedAt ? profile.reviewedAt.toISOString() : null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    applicant,
    history: history.map(toAuditEventDTO),
  }
}

// ─── Misc helpers ────────────────────────────────────────────────────────────

/** Validate an IANA time zone (server-side — client input is never trusted). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Safe bounded URL check for portfolio links (empty/null allowed). */
export function isValidOptionalUrl(url: string | null | undefined): boolean {
  if (!url) return true
  if (url.length > 300) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 60–360 minutes in 30-minute steps. */
export function isValidDuration(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= DURATION_MIN &&
    minutes <= DURATION_MAX &&
    minutes % DURATION_STEP === 0
  )
}

/** Hours-and-minutes display, e.g. "2h 30m" / "1h". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * Verification-relevant fields: editing any of these by an APPROVED teacher
 * invalidates the previous review, so the profile returns to PENDING and the
 * public marketplace hides it (and its classes) until an admin re-approves.
 */
export const VERIFICATION_RELEVANT_FIELDS = [
  'teachingName',
  'bio',
  'subjects',
  'levels',
  'languages',
  'qualificationsText',
  'experienceYears',
  'portfolioUrl',
] as const

export type VerificationRelevantField = (typeof VERIFICATION_RELEVANT_FIELDS)[number]
