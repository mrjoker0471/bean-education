// ─── BEAN Trust & Quality (Phase 6): request validation schemas ──────────────
// Zod schemas for every Phase 6 mutating endpoint. Plain-text only: control
// characters are rejected and content is trimmed + bounded — React renders it
// as text (no HTML injection surface), and no raw markup is ever stored.

import { z } from 'zod'
import {
  APPEAL_REASON_MAX,
  APPEAL_REASON_MIN,
  COMPLAINT_CATEGORIES,
  COMPLAINT_DESC_MAX,
  COMPLAINT_DESC_MIN,
  COMPLAINT_SUBJECT_MAX,
  COMPLAINT_SUBJECT_MIN,
  MODERATION_REASON_MAX,
  MODERATION_REASON_MIN,
  RESPONSE_TEXT_MAX,
  RESPONSE_TEXT_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TEXT_MIN,
  REVIEW_TITLE_MAX,
  TRUST_REASON_MAX,
  TRUST_REASON_MIN,
} from '@/lib/trust'

/** Plain printable text: no control characters (XSS/zero-width hardening). */
const plainText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), {
      message: 'Text contains unsupported control characters',
    })

export const reviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(REVIEW_TITLE_MAX).optional(),
  reviewText: plainText(REVIEW_TEXT_MIN, REVIEW_TEXT_MAX),
  // Explicit consent only — the checkbox in the composer sets this flag.
  showDisplayName: z.boolean().optional().default(false),
})

export const reviewEditSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().trim().max(REVIEW_TITLE_MAX).nullable().optional(),
  reviewText: plainText(REVIEW_TEXT_MIN, REVIEW_TEXT_MAX).optional(),
  showDisplayName: z.boolean().optional(),
})

export const reviewResponseCreateSchema = z.object({
  responseText: plainText(RESPONSE_TEXT_MIN, RESPONSE_TEXT_MAX),
})

export const reviewResponseEditSchema = z.object({
  responseText: plainText(RESPONSE_TEXT_MIN, RESPONSE_TEXT_MAX),
})

export const reviewFlagSchema = z.object({
  reason: plainText(MODERATION_REASON_MIN, MODERATION_REASON_MAX),
})

export const complaintCreateSchema = z
  .object({
    category: z.enum(COMPLAINT_CATEGORIES),
    classSessionId: z.string().min(1).max(64).optional(),
    subject: plainText(COMPLAINT_SUBJECT_MIN, COMPLAINT_SUBJECT_MAX),
    description: plainText(COMPLAINT_DESC_MIN, COMPLAINT_DESC_MAX),
  })
  .refine(
    (v) =>
      !!v.classSessionId ||
      v.category === 'SAFEGUARDING' ||
      v.category === 'HARASSMENT' ||
      v.category === 'OTHER',
    {
      message:
        'This report needs the class it concerns — pick the class from your bookings, or use a safeguarding category for a platform-level concern.',
      path: ['classSessionId'],
    },
  )

export const complaintInfoSchema = z.object({
  detail: plainText(MODERATION_REASON_MIN, COMPLAINT_DESC_MAX),
})

export const adminComplaintActionSchema = z
  .object({
    action: z.enum([
      'ACKNOWLEDGE',
      'START_REVIEW',
      'REQUEST_INFO',
      'NOTE',
      'ASSIGN',
      'ESCALATE',
      'RESOLVE',
      'DISMISS',
    ]),
    note: z.string().trim().max(MODERATION_REASON_MAX).optional(),
    assignedAdminId: z.string().min(1).max(64).optional(),
  })
  .refine((v) => (v.action === 'RESOLVE' || v.action === 'DISMISS' ? !!v.note : true), {
    message: 'Resolving or dismissing a case requires a written reason.',
    path: ['note'],
  })
  .refine((v) => (v.action === 'ASSIGN' ? !!v.assignedAdminId : true), {
    message: 'Assigning a case requires an administrator id.',
    path: ['assignedAdminId'],
  })

export const adminTrustActionSchema = z
  .object({
    action: z.enum([
      'NOTICE',
      'WARNING',
      'PAUSE_LISTINGS',
      'SUSPEND_PUBLISHING',
      'EMERGENCY_STOP',
      'REINSTATE',
    ]),
    reason: plainText(TRUST_REASON_MIN, TRUST_REASON_MAX),
    // Optional expiry for temporary restrictions. REINSTATE never carries one.
    endsAt: z
      .string()
      .min(10)
      .max(40)
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid expiry timestamp' })
      .optional(),
  })
  .refine((v) => v.action === 'REINSTATE' || !v.endsAt || Date.parse(v.endsAt) > Date.now(), {
    message: 'The expiry must be in the future.',
    path: ['endsAt'],
  })

export const appealCreateSchema = z.object({
  targetType: z.enum(['COMPLAINT_DECISION', 'REVIEW_MODERATION', 'TRUST_ACTION']),
  targetId: z.string().min(1).max(64),
  reason: plainText(APPEAL_REASON_MIN, APPEAL_REASON_MAX),
})

export const adminAppealActionSchema = z
  .object({
    action: z.enum(['ASSIGN', 'DECIDE', 'CLOSE_WITHOUT_DECISION']),
    reviewerId: z.string().min(1).max(64).optional(),
    decision: z.enum(['UPHELD', 'OVERTURNED']).optional(),
    decisionNote: z.string().trim().max(MODERATION_REASON_MAX).optional(),
  })
  .refine((v) => (v.action === 'ASSIGN' ? !!v.reviewerId : true), {
    message: 'Assigning an appeal requires a reviewer id.',
    path: ['reviewerId'],
  })
  .refine((v) => (v.action === 'DECIDE' ? !!v.decision && !!v.decisionNote : true), {
    message: 'A decision requires UPHELD or OVERTURNED plus a written explanation.', path: ['decision'] },
  )

export const adminReviewModerationSchema = z.object({
  action: z.enum(['KEEP_PUBLISHED', 'HIDE', 'RESTORE']),
  reason: plainText(MODERATION_REASON_MIN, MODERATION_REASON_MAX),
})
