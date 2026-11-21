// ─── BEAN Career Portfolio (Phase 7): request validation schemas ─────────────
// Plain-text only (no control characters), bounded fields, explicit consent
// flags. Client can never set verification labels, eligibility state,
// moderation decisions or application statuses.

import { z } from 'zod'
import {
  APPLICATION_NOTE_MAX,
  CAREER_HEADLINE_MAX,
  CAREER_SUMMARY_MAX,
  CREDENTIAL_NAME_MAX,
  CREDENTIAL_REF_MAX,
  EMPLOYER_NOTES_MAX,
  OPPORTUNITY_DESC_MAX,
  OPPORTUNITY_DESC_MIN,
  OPPORTUNITY_TITLE_MAX,
  OPPORTUNITY_TITLE_MIN,
  PROJECT_DESC_MAX,
  PROJECT_TITLE_MAX,
  PROJECT_TITLE_MIN,
  REPORT_DESC_MAX,
  REPORT_DESC_MIN,
  REPORT_SUBJECT_MAX,
  REPORT_SUBJECT_MIN,
  SAFETY_REPORT_CATEGORIES,
  SKILL_DESC_MAX,
  SKILL_NAME_MAX,
  SKILL_VERIFICATION_LABELS,
} from '@/lib/career'

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

const labelList = (maxItems: number, maxLabel: number) =>
  z.array(z.string().trim().min(1).max(maxLabel)).max(maxItems).optional()

// ─── Profile ───

export const careerProfileCreateSchema = z.object({
  headline: optionalText(CAREER_HEADLINE_MAX),
  summary: optionalText(CAREER_SUMMARY_MAX),
  preferredRoleTypes: labelList(20, 60),
  preferredSkills: labelList(30, 60),
  preferredLocations: labelList(20, 60),
  workModes: labelList(10, 30),
  publicSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{2,58}[a-z0-9])?$/, 'Use 4–60 lowercase letters, digits or hyphens')
    .optional()
    .nullable(),
})

export const careerProfileUpdateSchema = careerProfileCreateSchema.partial().extend({
  visibility: z.enum(['PRIVATE', 'DISCOVERABLE', 'PAUSED']).optional(),
})

// ─── Skills ───

export const skillCreateSchema = z.object({
  skillName: plainText(1, SKILL_NAME_MAX),
  proficiency: optionalText(40),
  description: optionalText(SKILL_DESC_MAX),
  // SELF_DECLARED is the only label a student can produce in Phase 7 — the
  // server rejects every other value (INSTITUTION_ISSUED comes from real
  // credential issuance; BEAN_ASSESSMENT_VERIFIED requires an assessment
  // process that does not exist yet).
  verificationLabel: z.literal('SELF_DECLARED').optional(),
  position: z.number().int().min(0).max(1000).optional(),
})

export const skillUpdateSchema = z.object({
  skillName: plainText(1, SKILL_NAME_MAX).optional(),
  proficiency: optionalText(40),
  description: optionalText(SKILL_DESC_MAX),
  position: z.number().int().min(0).max(1000).optional(),
})

// ─── Projects ───

export const projectCreateSchema = z.object({
  title: plainText(PROJECT_TITLE_MIN, PROJECT_TITLE_MAX),
  description: optionalText(PROJECT_DESC_MAX),
  category: z.enum(['ACADEMIC', 'PERSONAL', 'PRACTICAL', 'INTERNSHIP', 'RESEARCH', 'SKILL_DEMO']).optional().nullable(),
  skillsUsed: labelList(30, 60),
  projectUrl: z.string().trim().url().max(500).optional().nullable(),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  visibility: z.enum(['PRIVATE', 'SHARED']).optional().default('PRIVATE'),
})

export const projectUpdateSchema = z.object({
  title: plainText(PROJECT_TITLE_MIN, PROJECT_TITLE_MAX).optional(),
  description: optionalText(PROJECT_DESC_MAX),
  category: z.enum(['ACADEMIC', 'PERSONAL', 'PRACTICAL', 'INTERNSHIP', 'RESEARCH', 'SKILL_DEMO']).optional().nullable(),
  skillsUsed: labelList(30, 60),
  projectUrl: z.string().trim().url().max(500).optional().nullable(),
  startsAt: z.string().datetime({ offset: true }).optional().nullable(),
  endsAt: z.string().datetime({ offset: true }).optional().nullable(),
  visibility: z.enum(['PRIVATE', 'SHARED']).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
})

// ─── Credentials (student side: sharing toggle only) ───

export const credentialShareSchema = z.object({
  portfolioShared: z.boolean(),
})

// ─── Eligibility ───

export const eligibilityRequestSchema = z.object({
  acknowledge: z.literal(true),
})

// ─── Opportunities (employer) ───

export const opportunityCreateSchema = z.object({
  title: plainText(OPPORTUNITY_TITLE_MIN, OPPORTUNITY_TITLE_MAX),
  description: plainText(OPPORTUNITY_DESC_MIN, OPPORTUNITY_DESC_MAX),
  responsibilities: optionalText(4000),
  requiredSkills: labelList(30, 60),
  preferredSkills: labelList(30, 60),
  location: optionalText(120),
  workMode: optionalText(30),
  opportunityType: z.enum(['JOB', 'INTERNSHIP', 'APPRENTICESHIP', 'PROJECT']),
  compensationDescription: optionalText(600),
  applicationDeadline: z.string().datetime({ offset: true }).optional().nullable(),
  eligibilityDescription: optionalText(1200),
})

export const opportunityUpdateSchema = opportunityCreateSchema.partial().extend({
  status: z.enum(['DRAFT', 'PENDING_REVIEW', 'PAUSED', 'CLOSED']).optional(),
})

// ─── Applications ───

export const applicationCreateSchema = z.object({
  snapshot: z.record(z.string(), z.unknown()),
  contactSharingConsent: z.boolean(),
})

export const employerApplicationStatusSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED']),
  candidateVisibleStatusNote: optionalText(APPLICATION_NOTE_MAX),
  employerNotes: optionalText(EMPLOYER_NOTES_MAX),
})

// ─── Safety reports ───

export const safetyReportSchema = z.object({
  targetType: z.enum(['OPPORTUNITY', 'ORGANIZATION']),
  targetId: z.string().min(6).max(64),
  category: z.enum(SAFETY_REPORT_CATEGORIES),
  subject: plainText(REPORT_SUBJECT_MIN, REPORT_SUBJECT_MAX),
  description: plainText(REPORT_DESC_MIN, REPORT_DESC_MAX),
})
