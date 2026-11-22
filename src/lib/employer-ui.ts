// ─── Phase 7 UI completion — employer & admin career presentation helpers ────
// Pure, client-safe helpers (no React, no db, no server imports) mirroring the
// SERVER's legality maps so the UI only ever offers transitions the API will
// accept. Sources of truth (read-only mirrors — never edited here):
//   • src/lib/career.ts  EMPLOYER_APPLICATION_ACTIONS / APPLICATION_STATUS /
//     OPPORTUNITY_STATUS / isLegalEmployerStatusChange
//   • src/app/api/career/employer/opportunities/[id] PATCH legal map (employer
//     listing transitions; PUBLISHED and REJECTED stay admin-only)
//   • src/app/api/career/employer/applications/[id]/status PATCH freeze rules
//     (WITHDRAWN 409 — candidate-withdrawn; SELECTED/REJECTED 409 — final)
//   • src/lib/institution.ts isLegalVerificationTransition (admin org decisions)
//   • src/app/api/admin/career/opportunities/[id]/moderation POST legal map
//   • src/app/api/admin/career/reports/[id]/action POST (note rules)
//   • src/app/api/admin/career/eligibility/[id]/decision POST (DENY reason)
//   • src/lib/career-dto.ts toEmployerApplicationDTO (consent-truth: contact
//     email surfaces ONLY when the applicant consented at submission time)

import { applicationStatusLabel, clampPage, totalPages } from './career-market-ui'

// Pagination math is reused from the marketplace helpers (same server page
// contracts); re-exported here so employer/admin views share one source.
export { applicationStatusLabel, applicationStatusBadgeClass, clampPage, totalPages } from './career-market-ui'

// ─── Employer listing statuses ───────────────────────────────────────────────

export const EMPLOYER_LISTING_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'CLOSED', 'REJECTED'] as const

/** Human labels for the six real OPPORTUNITY_STATUS values. */
export function employerListingStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT': return 'Draft'
    case 'PENDING_REVIEW': return 'Pending review'
    case 'PUBLISHED': return 'Published'
    case 'PAUSED': return 'Paused'
    case 'CLOSED': return 'Closed'
    case 'REJECTED': return 'Rejected'
    default: return status.replace(/_/g, ' ').toLowerCase()
  }
}

/** Distinct treatment per status — no two statuses share a look. */
export function employerListingStatusBadgeClass(status: string): string {
  switch (status) {
    case 'DRAFT': return 'border-border bg-elevated text-muted-foreground'
    case 'PENDING_REVIEW': return 'border-gold/40 bg-gold/10 text-gold'
    case 'PUBLISHED': return 'border-success/40 bg-success/10 text-success'
    case 'PAUSED': return 'border-gold/60 bg-gold/5 text-gold'
    case 'CLOSED': return 'border-border bg-elevated text-muted-foreground line-through'
    case 'REJECTED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    default: return 'border-border text-muted-foreground'
  }
}

/**
 * Employer-legal listing status transitions, mirroring the employer PATCH
 * route's map exactly:
 *   to PENDING_REVIEW from DRAFT | PAUSED | REJECTED (submit / resume / resubmit)
 *   to PAUSED         from PUBLISHED (employer pause)
 *   to CLOSED         from DRAFT | PENDING_REVIEW | PUBLISHED | PAUSED
 *   PUBLISHED and REJECTED are moderation outcomes — never employer-settable.
 */
export type EmployerListingTransition = 'PENDING_REVIEW' | 'PAUSED' | 'CLOSED'

const EMPLOYER_LISTING_TRANSITIONS: Record<string, readonly EmployerListingTransition[]> = {
  DRAFT: ['PENDING_REVIEW', 'CLOSED'],
  PENDING_REVIEW: ['CLOSED'],
  PUBLISHED: ['PAUSED', 'CLOSED'],
  PAUSED: ['PENDING_REVIEW', 'CLOSED'],
  REJECTED: ['PENDING_REVIEW', 'CLOSED'],
  CLOSED: [],
}

export function legalEmployerListingTransitions(from: string): EmployerListingTransition[] {
  return [...(EMPLOYER_LISTING_TRANSITIONS[from] ?? [])]
}

/** Human button label for a listing transition, phrased from the current status. */
export function employerListingTransitionLabel(to: EmployerListingTransition, from: string): string {
  if (to === 'PENDING_REVIEW') {
    if (from === 'PAUSED') return 'Resume (submit for review)'
    if (from === 'REJECTED') return 'Edit & resubmit'
    return 'Submit for review'
  }
  if (to === 'PAUSED') return 'Pause listing'
  return 'Close listing'
}

/** Honest one-line consequence shown inside the confirmation dialog. */
export function employerListingTransitionNotice(to: EmployerListingTransition, from: string): string {
  switch (to) {
    case 'PENDING_REVIEW':
      return from === 'REJECTED'
        ? 'The updated listing goes back to BEAN moderation — it stays invisible to candidates until a moderator approves it.'
        : 'A BEAN moderator reviews the listing before it goes live. Candidates cannot see it until approval.'
    case 'PAUSED':
      return 'The listing is hidden from candidate search and applications while paused. Resuming sends it back through moderation.'
    case 'CLOSED':
      return 'Applications can no longer be submitted. This listing cannot be reopened — create a new one if you hire again.'
  }
}

/**
 * Moderation feedback on the employer's OWN listing. The employer-facing DTO
 * (PublicOpportunityClientDTO) does not declare rejectionReason /
 * moderationNote — if the server starts returning them they are shown
 * verbatim; otherwise the UI falls back to honest generic copy.
 */
export function listingModerationFeedback(opportunity: {
  status: string
  rejectionReason?: unknown
  moderationNote?: unknown
}): { kind: 'REJECTED' | 'PAUSED' | null; reason: string | null; note: string | null } {
  const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
  if (opportunity.status === 'REJECTED') {
    return { kind: 'REJECTED', reason: asText(opportunity.rejectionReason), note: asText(opportunity.moderationNote) }
  }
  if (opportunity.status === 'PAUSED') {
    return { kind: 'PAUSED', reason: asText(opportunity.rejectionReason), note: asText(opportunity.moderationNote) }
  }
  return { kind: null, reason: null, note: null }
}

// ─── Employer application pipeline ───────────────────────────────────────────

/** Application statuses employers may set — mirrors career.ts EMPLOYER_APPLICATION_ACTIONS. */
export const EMPLOYER_APPLICATION_ACTIONS = ['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'] as const
export type EmployerApplicationAction = (typeof EMPLOYER_APPLICATION_ACTIONS)[number]

export const APPLICATION_STATUSES_ALL = ['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN'] as const

export function applicationActionsLocked(status: string): boolean {
  return status === 'SELECTED' || status === 'REJECTED' || status === 'WITHDRAWN'
}

/** Honest reason shown when the pipeline controls are frozen. */
export function applicationLockedReason(status: string): string {
  switch (status) {
    case 'SELECTED':
    case 'REJECTED':
      return 'A final decision was already recorded for this application — the pipeline is frozen.'
    case 'WITHDRAWN':
      return 'The candidate withdrew this application — it is frozen and read-only.'
    default:
      return ''
  }
}

/**
 * Legal next actions from the current status, mirroring the status route:
 * any EMPLOYER_APPLICATION_ACTION is accepted while the application is not
 * terminal (SELECTED/REJECTED) or WITHDRAWN. The current status itself is
 * excluded (a no-op change is never offered); "save notes only" reuses the
 * same rule (send the unchanged status).
 */
export function legalApplicationActions(from: string): EmployerApplicationAction[] {
  if (applicationActionsLocked(from)) return []
  return (EMPLOYER_APPLICATION_ACTIONS as readonly string[]).filter(a => a !== from) as EmployerApplicationAction[]
}

/** Can the employer save notes without moving the status (send current status back)?
 *  Only while the row is not frozen — terminal/withdrawn rows reject the whole PATCH. */
export function canSaveNotesOnly(from: string): boolean {
  return !applicationActionsLocked(from) && (EMPLOYER_APPLICATION_ACTIONS as readonly string[]).includes(from)
}

/** Actions the UI must confirm before sending (consequential decisions). */
export function applicationActionNeedsConfirmation(to: string): boolean {
  return to === 'SHORTLISTED' || to === 'SELECTED' || to === 'REJECTED'
}

/** Honest confirmation copy per consequential action. */
export function applicationActionConfirmation(to: string): string {
  switch (to) {
    case 'SHORTLISTED':
      return 'The candidate sees "shortlisted" on their applications tracker.'
    case 'SELECTED':
      return 'This records a final decision — the candidate sees it and the pipeline freezes.'
    case 'REJECTED':
      return 'This records a final decision — the candidate sees it and the pipeline freezes.'
    case 'INTERVIEW':
      return 'The candidate sees the interview stage on their applications tracker.'
    default:
      return 'The candidate sees this status update on their applications tracker.'
  }
}

/** Distinct treatment per application status (7 real values + safe fallback). */
export function employerApplicationStatusBadgeClass(status: string): string {
  switch (status) {
    case 'SUBMITTED': return 'border-gold/40 bg-gold/10 text-gold'
    case 'UNDER_REVIEW': return 'border-gold/60 bg-gold/5 text-gold'
    case 'SHORTLISTED': return 'border-success/40 bg-success/10 text-success'
    case 'INTERVIEW': return 'border-success/60 bg-success/5 text-success'
    case 'SELECTED': return 'border-success bg-success/15 text-success font-medium'
    case 'REJECTED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    case 'WITHDRAWN': return 'border-border bg-elevated text-muted-foreground'
    default: return 'border-border text-muted-foreground'
  }
}

// ─── Applicant snapshot parsing (mirror career-dto consent truth) ────────────

export interface ApplicantSkillItem {
  name: string
  verification: string | null
  proficiency: string | null
}

export interface ApplicantProjectItem {
  title: string
  description: string | null
  url: string | null
  category: string | null
}

export interface ApplicantCredentialItem {
  name: string
  issuer: string | null
  issuedDate: string | null
}

function snapshotItems(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
}

const asTextOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Skills exactly as the candidate shared them at application time. */
export function applicantSkills(raw: unknown): ApplicantSkillItem[] {
  return snapshotItems(raw)
    .map(x => ({
      name: asTextOrNull(x['skillName']) ?? '',
      verification: asTextOrNull(x['verificationLabel']),
      proficiency: asTextOrNull(x['proficiency']),
    }))
    .filter(x => x.name)
}

export function applicantProjects(raw: unknown): ApplicantProjectItem[] {
  return snapshotItems(raw)
    .map(x => ({
      title: asTextOrNull(x['title']) ?? '',
      description: asTextOrNull(x['description']),
      url: asTextOrNull(x['projectUrl']),
      category: asTextOrNull(x['category']),
    }))
    .filter(x => x.title)
}

export function applicantCredentials(raw: unknown): ApplicantCredentialItem[] {
  return snapshotItems(raw)
    .map(x => ({
      name: asTextOrNull(x['credentialName']) ?? '',
      issuer: asTextOrNull(x['issuer']),
      issuedDate: asTextOrNull(x['issuedDate']),
    }))
    .filter(x => x.name)
}

/**
 * Consent truth (mirrors toEmployerApplicationDTO): the DTO's `contact` object
 * exists ONLY when the applicant consented AND the snapshot carries
 * shareContact — so showing contact?.email is exactly the consented truth.
 */
export function applicantContact(
  app: { contact: { email?: string } | null },
): { consented: boolean; email: string | null } {
  const email = asTextOrNull(app.contact?.email)
  return { consented: email !== null, email }
}

// ─── Candidate discovery ─────────────────────────────────────────────────────

export const EMPLOYER_LIST_PAGE_SIZE = 20 // mirrors server EMPLOYER_PAGE_SIZE_DEFAULT
export const EMPLOYER_APPS_PAGE_SIZE = 20 // mirrors server EMPLOYER_PAGE_SIZE_DEFAULT
export const CANDIDATE_PAGE_SIZE = 10 // mirrors server CANDIDATE_PAGE_SIZE_DEFAULT

/** Honest 429 detection — the search route returns a "limit reached" message. */
export function isRateLimitError(message: string | null | undefined): boolean {
  return typeof message === 'string' && /limit reached/i.test(message)
}

export const CANDIDATE_RATE_LIMIT_COPY =
  'Search limit reached, try later. Discovery searches are rate-limited per recruiter (rolling 24 h) to keep candidate data safe.'

// ─── Admin — organization verification decisions ─────────────────────────────

export type AdminVerificationAction = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE'

/**
 * Mirrors isLegalVerificationTransition (src/lib/institution.ts):
 *   APPROVE   from PENDING_REVIEW
 *   REJECT    from PENDING_REVIEW
 *   SUSPEND   from APPROVED
 *   REINSTATE from SUSPENDED (→ APPROVED)
 */
export function legalAdminVerificationActions(from: string): AdminVerificationAction[] {
  switch (from) {
    case 'PENDING_REVIEW': return ['APPROVE', 'REJECT']
    case 'APPROVED': return ['SUSPEND']
    case 'SUSPENDED': return ['REINSTATE']
    default: return []
  }
}

export function adminVerificationActionLabel(action: AdminVerificationAction): string {
  switch (action) {
    case 'APPROVE': return 'Approve'
    case 'REJECT': return 'Reject'
    case 'SUSPEND': return 'Suspend'
    case 'REINSTATE': return 'Reinstate'
  }
}

// ─── Admin — opportunity moderation ──────────────────────────────────────────

export type AdminModerationAction = 'APPROVE' | 'REJECT' | 'PAUSE' | 'CLOSE' | 'RESUME'

/** Mirrors the moderation route's legal map (target status → allowed sources). */
export function legalAdminModerationActions(from: string): AdminModerationAction[] {
  const can = (to: 'PUBLISHED' | 'REJECTED' | 'PAUSED' | 'CLOSED'): boolean => {
    switch (to) {
      case 'PUBLISHED': return from === 'PENDING_REVIEW' || from === 'PAUSED'
      case 'REJECTED': return from === 'PENDING_REVIEW'
      case 'PAUSED': return from === 'PUBLISHED'
      case 'CLOSED': return from === 'PUBLISHED' || from === 'PENDING_REVIEW' || from === 'DRAFT' || from === 'PAUSED'
    }
  }
  const out: AdminModerationAction[] = []
  if (can('PUBLISHED')) out.push('APPROVE', 'RESUME')
  if (can('REJECTED')) out.push('REJECT')
  if (can('PAUSED')) out.push('PAUSE')
  if (can('CLOSED')) out.push('CLOSE')
  return out
}

// ─── Admin — safety report actions ───────────────────────────────────────────

export type AdminReportAction = 'ACKNOWLEDGE' | 'INVESTIGATE' | 'RESOLVE' | 'DISMISS' | 'PAUSE_OPPORTUNITY'

/**
 * Actions legal per report status (mirrors the report action route):
 * OPEN → acknowledge/investigate/resolve/dismiss (+ pause the linked
 * OPPORTUNITY); UNDER_REVIEW → resolve/dismiss (+ pause). Terminal statuses
 * (RESOLVED/DISMISSED) offer nothing. PAUSE_OPPORTUNITY applies only to
 * reports targeting an OPPORTUNITY.
 */
export function legalAdminReportActions(status: string, targetType: string): AdminReportAction[] {
  if (status !== 'OPEN' && status !== 'UNDER_REVIEW') return []
  const out: AdminReportAction[] = []
  if (status === 'OPEN') out.push('ACKNOWLEDGE', 'INVESTIGATE')
  out.push('RESOLVE', 'DISMISS')
  if (targetType === 'OPPORTUNITY') out.push('PAUSE_OPPORTUNITY')
  return out
}

// ─── Admin — adult-eligibility decisions ─────────────────────────────────────

export type AdminEligibilityAction = 'APPROVE' | 'DENY'

/** Only a PENDING_REVIEW request is decidable; APPROVED/DENIED are final. */
export function legalAdminEligibilityActions(status: string): AdminEligibilityAction[] {
  return status === 'PENDING_REVIEW' ? ['APPROVE', 'DENY'] : []
}

// ─── Reason-required matrix (server rejects shorter input with 400) ──────────

export const ADMIN_REASON_MIN = 10

/** Minimum characters the server requires for this admin action (0 = optional). */
export function minReasonLength(scope: 'verification' | 'moderation' | 'report' | 'eligibility', action: string): number {
  switch (scope) {
    case 'verification':
      return action === 'REJECT' || action === 'SUSPEND' ? ADMIN_REASON_MIN : 0
    case 'moderation':
      return action === 'REJECT' || action === 'PAUSE' ? ADMIN_REASON_MIN : 0
    case 'report':
      return action === 'RESOLVE' || action === 'DISMISS' || action === 'PAUSE_OPPORTUNITY' ? ADMIN_REASON_MIN : 0
    case 'eligibility':
      return action === 'DENY' ? ADMIN_REASON_MIN : 0
    default:
      return 0
  }
}

/** Live-validation helper: null when acceptable, else the honest error line. */
export function reasonValidationError(minLength: number, value: string): string | null {
  const trimmed = value.trim()
  if (minLength <= 0) return null
  if (trimmed.length === 0) return `A written reason (${minLength}+ characters) is required for this decision.`
  if (trimmed.length < minLength) return `The reason needs at least ${minLength} characters — ${minLength - trimmed.length} more.`
  return null
}

// ─── Shared presentation ─────────────────────────────────────────────────────

export function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase()
}

export function auditActionLabel(action: string): string {
  const map: Record<string, string> = {
    VERIFICATION_APPROVE: 'Verification approved',
    VERIFICATION_REJECT: 'Verification rejected',
    VERIFICATION_SUSPEND: 'Organization suspended',
    VERIFICATION_REINSTATE: 'Organization reinstated',
    ORG_CREATED: 'Organization registered',
    ORG_SUBMITTED: 'Submitted for verification',
    ORG_UPDATED: 'Organization profile updated',
    MEMBER_ADDED: 'Member joined',
    MEMBER_REMOVED: 'Member removed',
    MEMBER_ROLE_CHANGED: 'Member role changed',
    MEMBER_STATUS_CHANGED: 'Member status changed',
    OPPORTUNITY_CREATED: 'Listing created',
    OPPORTUNITY_EDITED: 'Listing edited',
    OPPORTUNITY_DRAFT: 'Listing moved to draft',
    OPPORTUNITY_PENDING_REVIEW: 'Listing submitted for review',
    OPPORTUNITY_PUBLISHED: 'Listing published',
    OPPORTUNITY_PAUSED: 'Listing paused',
    OPPORTUNITY_CLOSED: 'Listing closed',
    OPPORTUNITY_REJECTED: 'Listing rejected',
    APPLICATION_STATUS_CHANGED: 'Application status changed',
    APPLICATION_SUBMITTED: 'Application received',
    CANDIDATE_SEARCH: 'Candidate discovery search',
  }
  if (map[action]) return map[action]
  const humanized = action.replace(/_/g, ' ').toLowerCase()
  return humanized.charAt(0).toUpperCase() + humanized.slice(1)
}
