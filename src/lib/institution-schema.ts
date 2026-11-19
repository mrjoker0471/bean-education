// ─── BEAN Institution Workspace (Phase 7): request validation schemas ────────
// Zod schemas for every Phase 7 institution mutating endpoint. Plain-text
// only: control characters are rejected and content is trimmed + bounded —
// React renders it as text (no HTML injection surface), and no raw markup is
// ever stored. Organization role/verification state are NEVER client inputs.

import { z } from 'zod'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  ASSIGNMENT_INSTRUCTIONS_MAX,
  ASSIGNMENT_TITLE_MAX,
  ASSIGNMENT_TITLE_MIN,
  GROUP_CAPACITY_MAX,
  GROUP_NAME_MAX,
  INVITATION_DEFAULT_TTL_DAYS,
  INVITATION_MAX_USES_MAX,
  INVITATION_TTL_MAX_DAYS,
  ORG_CONTACT_MAX,
  ORG_DESC_MAX,
  ORG_DISPLAY_NAME_MAX,
  ORG_NAME_MAX,
  ORG_NAME_MIN,
  ORG_TYPES,
  RESOURCE_DESC_MAX,
  RESOURCE_TITLE_MAX,
  SUBMISSION_TEXT_MAX,
  VERIFICATION_DECISION_NOTE_MAX,
} from '@/lib/institution'

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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v), {
      message: 'Text contains unsupported control characters',
    })
    .nullable()
    .optional()

/** Bounded list of short labels (skills, role types, locations, work modes). */
const labelList = (maxItems: number, maxLabel: number) =>
  z.array(z.string().trim().min(1).max(maxLabel)).max(maxItems).optional()

export const organizationCreateSchema = z.object({
  name: plainText(ORG_NAME_MIN, ORG_NAME_MAX),
  displayName: optionalText(ORG_DISPLAY_NAME_MAX),
  orgType: z.enum(ORG_TYPES),
  description: optionalText(ORG_DESC_MAX),
  website: z.string().trim().url().max(300).optional().nullable(),
  publicContact: optionalText(ORG_CONTACT_MAX),
  country: optionalText(80),
  state: optionalText(80),
  city: optionalText(80),
  logoText: z.string().trim().max(8).optional().nullable(),
})

export const organizationUpdateSchema = z.object({
  displayName: optionalText(ORG_DISPLAY_NAME_MAX),
  description: optionalText(ORG_DESC_MAX),
  website: z.string().trim().url().max(300).optional().nullable(),
  publicContact: optionalText(ORG_CONTACT_MAX),
  country: optionalText(80),
  state: optionalText(80),
  city: optionalText(80),
  logoText: z.string().trim().max(8).optional().nullable(),
})

export const invitationCreateSchema = z.object({
  email: z.string().trim().email().max(200).optional().nullable(),
  intendedRole: z.enum(['INSTRUCTOR', 'STAFF', 'LEARNER', 'CAREER_COORDINATOR', 'RECRUITER']),
  ttlDays: z.number().int().min(1).max(INVITATION_TTL_MAX_DAYS).optional().default(INVITATION_DEFAULT_TTL_DAYS),
  maxUses: z.number().int().min(1).max(INVITATION_MAX_USES_MAX).optional().nullable(),
})

export const invitationAcceptSchema = z.object({
  token: z.string().trim().min(20).max(200),
})

export const memberActionSchema = z.object({
  action: z.enum(['APPROVE_OWNER', 'APPOINT_ADMIN', 'SET_ROLE', 'SUSPEND', 'REINSTATE', 'REMOVE']),
  role: z.enum(['INSTRUCTOR', 'STAFF', 'LEARNER', 'CAREER_COORDINATOR', 'RECRUITER']).optional(),
  note: optionalText(VERIFICATION_DECISION_NOTE_MAX),
})

export const groupCreateSchema = z.object({
  name: plainText(2, GROUP_NAME_MAX),
  academicYear: optionalText(40),
  programmeLabel: optionalText(80),
  batchLabel: optionalText(80),
  sectionLabel: optionalText(80),
  trackLabel: optionalText(80),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  capacity: z.number().int().min(1).max(GROUP_CAPACITY_MAX).optional().nullable(),
})

export const enrollmentActionSchema = z.object({
  membershipId: z.string().min(6).max(64),
})

export const assignmentCreateSchema = z.object({
  groupId: z.string().min(6).max(64),
  title: plainText(ASSIGNMENT_TITLE_MIN, ASSIGNMENT_TITLE_MAX),
  instructions: optionalText(ASSIGNMENT_INSTRUCTIONS_MAX),
  subjectLabel: optionalText(80),
  submissionType: z.enum(['TEXT', 'EXTERNAL_LINK', 'TEXT_AND_LINK']).optional().default('TEXT_AND_LINK'),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  maxScore: z.number().int().min(1).max(1000).optional().nullable(),
  publish: z.boolean().optional().default(false),
})

export const assignmentUpdateSchema = z.object({
  title: plainText(ASSIGNMENT_TITLE_MIN, ASSIGNMENT_TITLE_MAX).optional(),
  instructions: optionalText(ASSIGNMENT_INSTRUCTIONS_MAX),
  subjectLabel: optionalText(80),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  maxScore: z.number().int().min(1).max(1000).optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED']).optional(),
})

export const submissionCreateSchema = z
  .object({
    responseText: optionalText(SUBMISSION_TEXT_MAX),
    externalLink: z.string().trim().url().max(500).optional().nullable(),
    submit: z.boolean().optional().default(true),
  })
  .refine(
    (v) => (v.responseText && v.responseText.length > 0) || (v.externalLink && v.externalLink.length > 0),
    { message: 'Provide a text response or an external project link.' },
  )

export const gradeSubmissionSchema = z.object({
  gradeValue: optionalText(40),
  teacherFeedback: optionalText(2000),
  markReturned: z.boolean().optional().default(false),
})

/**
 * PATCH /api/organizations/:id/groups/:groupId — any subset of the editable
 * group fields. Status flips are limited to ACTIVE ⇄ ARCHIVED (archived groups
 * simply stop appearing in "active" surfaces; their history is never deleted).
 */
export const groupUpdateSchema = z.object({
  name: plainText(2, GROUP_NAME_MAX).optional(),
  academicYear: optionalText(40),
  programmeLabel: optionalText(80),
  batchLabel: optionalText(80),
  sectionLabel: optionalText(80),
  trackLabel: optionalText(80),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  capacity: z.number().int().min(1).max(GROUP_CAPACITY_MAX).optional().nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
})

export const announcementCreateSchema = z.object({
  groupId: z.string().min(6).max(64).optional().nullable(),
  title: plainText(4, ANNOUNCEMENT_TITLE_MAX),
  body: plainText(10, ANNOUNCEMENT_BODY_MAX),
  expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
})

export const resourceCreateSchema = z.object({
  groupId: z.string().min(6).max(64).optional().nullable(),
  title: plainText(4, RESOURCE_TITLE_MAX),
  description: optionalText(RESOURCE_DESC_MAX),
  url: z.string().trim().url().max(500),
})
