// ─── BEAN Teach (Phase 4A): request validation schemas ───────────────────────
// Zod schemas shared by the teach/admin route handlers. Every mutating
// endpoint validates its body here before any database access. Privacy rule:
// the application deliberately does NOT collect date of birth, bank details,
// government IDs (Aadhaar/PAN) or any sensitive identity information.

import { z } from 'zod'
import { CAPACITY_MAX, CAPACITY_MIN, DURATION_MAX, DURATION_MIN, TEACH_LEVELS } from '@/lib/teach'

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)

/** A list of 1–8 short free-text tags (subjects / languages). */
const tagList = (itemMin: number, itemMax: number, maxItems: number) =>
  z
    .array(z.string().trim().min(itemMin).max(itemMax))
    .min(1)
    .max(maxItems)

export const teachApplicationSchema = z.object({
  teachingName: trimmed(2, 60),
  headline: trimmed(10, 120),
  bio: trimmed(50, 2000),
  subjects: tagList(2, 40, 8),
  levels: z.array(z.enum(TEACH_LEVELS)).min(1).max(TEACH_LEVELS.length),
  languages: tagList(2, 30, 6),
  qualificationsText: trimmed(20, 2000),
  experienceYears: z.number().int().min(0).max(60),
  portfolioUrl: z.string().trim().max(300).optional().nullable(),
})

/**
 * PATCH: any subset of the application fields. Editing verification-relevant
 * fields by an APPROVED teacher returns the profile to PENDING (re-review).
 */
export const teachApplicationPatchSchema = teachApplicationSchema.partial().extend({
  // Approved teachers may also control their marketplace visibility.
  isPublished: z.boolean().optional(),
})

export const teachClassCreateSchema = z
  .object({
    title: trimmed(8, 120),
    description: trimmed(50, 4000),
    subject: trimmed(2, 60),
    targetLevel: z.enum(TEACH_LEVELS),
    language: trimmed(2, 30),
    durationMinutes: z.number().int().min(DURATION_MIN).max(DURATION_MAX),
    // ISO timestamp; must parse and be strictly in the future (checked server-side
    // at creation AND again at publish time).
    startsAt: z.string().min(10).max(40),
    timeZone: z.string().trim().min(1).max(60),
    capacity: z.number().int().min(CAPACITY_MIN).max(CAPACITY_MAX),
    minimumStudents: z.number().int().min(1).max(CAPACITY_MAX),
    // Optional future regular price in PAISE — metadata only during the free
    // pilot; no order or payment is ever created from this value.
    plannedPricePaise: z.number().int().min(0).max(10_000_000).optional(),
    // Phase 7 — private institution classes. Absent ⇒ PUBLIC (existing
    // behavior unchanged). ORGANIZATION/GROUP audiences require the creator to
    // hold an active instructor/admin/owner membership in the owning
    // organization; eligibility is re-checked on booking and live entry.
    audience: z.enum(['PUBLIC', 'ORGANIZATION', 'GROUP']).optional(),
    organizationId: z.string().min(6).max(64).optional(),
    organizationGroupId: z.string().min(6).max(64).optional(),
  })
  .refine((v) => v.minimumStudents <= v.capacity, {
    message: 'Minimum enrolment cannot exceed capacity',
    path: ['minimumStudents'],
  })
  .refine((v) => (v.audience && v.audience !== 'PUBLIC' ? Boolean(v.organizationId) : true), {
    message: 'A private class requires its owning organization',
    path: ['organizationId'],
  })
  .refine((v) => (v.audience === 'GROUP' ? Boolean(v.organizationGroupId) : true), {
    message: 'A group class requires its owning group',
    path: ['organizationGroupId'],
  })

export const teachClassPatchSchema = z.object({
  title: trimmed(8, 120).optional(),
  description: trimmed(50, 4000).optional(),
  subject: trimmed(2, 60).optional(),
  targetLevel: z.enum(TEACH_LEVELS).optional(),
  language: trimmed(2, 30).optional(),
  durationMinutes: z.number().int().min(DURATION_MIN).max(DURATION_MAX).optional(),
  startsAt: z.string().min(10).max(40).optional(),
  timeZone: z.string().trim().min(1).max(60).optional(),
  capacity: z.number().int().min(CAPACITY_MIN).max(CAPACITY_MAX).optional(),
  minimumStudents: z.number().int().min(1).max(CAPACITY_MAX).optional(),
  plannedPricePaise: z.number().int().min(0).max(10_000_000).optional(),
})

export const teachAttendanceSchema = z.object({
  bookingId: z.string().min(1),
  status: z.enum(['ATTENDED', 'NO_SHOW']),
})

export const adminTeachReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  // Rejection REQUIRES a written reason (10..400 chars) so the applicant can
  // correct and resubmit; approval may carry an optional decision note.
  note: z.string().trim().max(400).optional(),
})
