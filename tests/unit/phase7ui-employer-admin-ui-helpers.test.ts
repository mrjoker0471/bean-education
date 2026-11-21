// ─── Phase 7 UI completion: employer & admin career UI helpers ───────────────
// Pure-logic proofs for the helpers behind career-employer-view.tsx,
// admin-organizations-view.tsx and admin-career-view.tsx:
//   • legalEmployerListingTransitions — exactly the employer PATCH route's map
//     from every OPPORTUNITY_STATUS (PUBLISHED/REJECTED never employer-settable).
//   • legalApplicationActions — mirrors EMPLOYER_APPLICATION_ACTIONS + the
//     status route's freeze rules (WITHDRAWN, SELECTED, REJECTED are frozen);
//     the current status itself is never offered (no-op).
//   • legalAdminVerificationActions — mirrors isLegalVerificationTransition.
//   • legalAdminModerationActions / legalAdminReportActions /
//     legalAdminEligibilityActions — mirror the admin career routes' maps.
//   • minReasonLength + reasonValidationError — the server's reason matrix
//     (10+ chars for org REJECT/SUSPEND, opportunity REJECT/PAUSE, report
//     RESOLVE/DISMISS/PAUSE_OPPORTUNITY, eligibility DENY).
//   • Pagination reuse — totalPages/clampPage re-exported from the shared
//     career-market helpers (same server page contracts).
//   • Consent truth — applicantContact surfaces the email ONLY when the DTO
//     carries it (toEmployerApplicationDTO: consent-gated), snapshot parsers
//     degrade safely on real snapshot shapes.

import { describe, it, expect } from 'bun:test'
import {
  ADMIN_REASON_MIN,
  EMPLOYER_APPLICATION_ACTIONS,
  EMPLOYER_LISTING_STATUSES,
  APPLICATION_STATUSES_ALL,
  applicantContact,
  applicantCredentials,
  applicantProjects,
  applicantSkills,
  applicationActionNeedsConfirmation,
  applicationActionsLocked,
  applicationLockedReason,
  applicationStatusBadgeClass,
  applicationStatusLabel,
  canSaveNotesOnly,
  clampPage,
  employerApplicationStatusBadgeClass,
  employerListingStatusBadgeClass,
  employerListingStatusLabel,
  employerListingTransitionLabel,
  employerListingTransitionNotice,
  humanizeStatus,
  isRateLimitError,
  legalAdminEligibilityActions,
  legalAdminModerationActions,
  legalAdminReportActions,
  legalAdminVerificationActions,
  legalApplicationActions,
  legalEmployerListingTransitions,
  listingModerationFeedback,
  minReasonLength,
  reasonValidationError,
  totalPages,
} from '@/lib/employer-ui'

// ─── Employer listing transitions (each current status) ──────────────────────

describe('legalEmployerListingTransitions — mirrors the employer PATCH route', () => {
  it('DRAFT can submit for review or close', () => {
    expect(legalEmployerListingTransitions('DRAFT')).toEqual(['PENDING_REVIEW', 'CLOSED'])
  })
  it('PENDING_REVIEW can only be closed by the employer', () => {
    expect(legalEmployerListingTransitions('PENDING_REVIEW')).toEqual(['CLOSED'])
  })
  it('PUBLISHED can pause or close (never self-reject/self-publish)', () => {
    expect(legalEmployerListingTransitions('PUBLISHED')).toEqual(['PAUSED', 'CLOSED'])
  })
  it('PAUSED resumes via submit-for-review or closes', () => {
    expect(legalEmployerListingTransitions('PAUSED')).toEqual(['PENDING_REVIEW', 'CLOSED'])
  })
  it('REJECTED resubmits via submit-for-review or closes', () => {
    expect(legalEmployerListingTransitions('REJECTED')).toEqual(['PENDING_REVIEW', 'CLOSED'])
  })
  it('CLOSED is terminal for employers', () => {
    expect(legalEmployerListingTransitions('CLOSED')).toEqual([])
  })
  it('unknown statuses offer nothing and every real status is covered', () => {
    expect(legalEmployerListingTransitions('SOMETHING_ELSE')).toEqual([])
    expect(EMPLOYER_LISTING_STATUSES).toEqual(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'CLOSED', 'REJECTED'])
  })
  it('PUBLISHED and REJECTED are never legal employer targets (admin-only outcomes)', () => {
    for (const from of EMPLOYER_LISTING_STATUSES) {
      expect(legalEmployerListingTransitions(from)).not.toContain('PUBLISHED')
      expect(legalEmployerListingTransitions(from)).not.toContain('REJECTED')
    }
  })
  it('labels phrase the transition from the current status', () => {
    expect(employerListingTransitionLabel('PENDING_REVIEW', 'DRAFT')).toBe('Submit for review')
    expect(employerListingTransitionLabel('PENDING_REVIEW', 'PAUSED')).toBe('Resume (submit for review)')
    expect(employerListingTransitionLabel('PENDING_REVIEW', 'REJECTED')).toBe('Edit & resubmit')
    expect(employerListingTransitionLabel('PAUSED', 'PUBLISHED')).toBe('Pause listing')
    expect(employerListingTransitionLabel('CLOSED', 'PUBLISHED')).toBe('Close listing')
  })
  it('close always warns that applications can no longer be submitted', () => {
    expect(employerListingTransitionNotice('CLOSED', 'PUBLISHED')).toContain('Applications can no longer be submitted')
    expect(employerListingTransitionNotice('PENDING_REVIEW', 'DRAFT')).toContain('moderator')
  })
  it('every real status has a label and a distinct badge treatment', () => {
    const classes = EMPLOYER_LISTING_STATUSES.map(s => employerListingStatusBadgeClass(s))
    expect(new Set(classes).size).toBe(EMPLOYER_LISTING_STATUSES.length)
    expect(employerListingStatusLabel('PENDING_REVIEW')).toBe('Pending review')
    expect(employerListingStatusLabel('UNKNOWN_X')).toBe('unknown x')
  })
  it('moderation feedback surfaces rejection/pause copy when the server provides it', () => {
    expect(listingModerationFeedback({ status: 'DRAFT' })).toEqual({ kind: null, reason: null, note: null })
    const rejected = listingModerationFeedback({ status: 'REJECTED', rejectionReason: 'Misleading title', moderationNote: 'fix it' })
    expect(rejected.kind).toBe('REJECTED')
    expect(rejected.reason).toBe('Misleading title')
    expect(rejected.note).toBe('fix it')
    const paused = listingModerationFeedback({ status: 'PAUSED', moderationNote: 'under safety review' })
    expect(paused.kind).toBe('PAUSED')
    expect(paused.reason).toBeNull()
    // Blank strings and non-strings stay null (honest "not provided" copy in UI).
    expect(listingModerationFeedback({ status: 'REJECTED', rejectionReason: '   ' }).reason).toBeNull()
    expect(listingModerationFeedback({ status: 'REJECTED', rejectionReason: 42 }).reason).toBeNull()
  })
})

// ─── Employer application actions (each current status) ──────────────────────

describe('legalApplicationActions — mirrors EMPLOYER_APPLICATION_ACTIONS + freeze rules', () => {
  it('the action whitelist is exactly the server constant', () => {
    expect(EMPLOYER_APPLICATION_ACTIONS).toEqual(['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'])
  })
  it('SUBMITTED offers every action (a SUBMITTED row cannot self-target)', () => {
    expect(legalApplicationActions('SUBMITTED')).toEqual(['UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'])
  })
  it('UNDER_REVIEW offers all other actions', () => {
    expect(legalApplicationActions('UNDER_REVIEW')).toEqual(['SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED'])
  })
  it('SHORTLISTED and INTERVIEW can go backwards (server allows pipeline moves)', () => {
    expect(legalApplicationActions('SHORTLISTED')).toContain('UNDER_REVIEW')
    expect(legalApplicationActions('INTERVIEW')).toContain('UNDER_REVIEW')
  })
  it('terminal and withdrawn statuses are frozen with honest reasons', () => {
    for (const frozen of ['SELECTED', 'REJECTED', 'WITHDRAWN']) {
      expect(legalApplicationActions(frozen)).toEqual([])
      expect(applicationActionsLocked(frozen)).toBe(true)
      expect(applicationLockedReason(frozen)).not.toBe('')
    }
    for (const open of APPLICATION_STATUSES_ALL.filter(s => !applicationActionsLocked(s))) {
      expect(applicationLockedReason(open)).toBe('')
    }
  })
  it('the current status is never offered (no-op changes are not shown)', () => {
    expect(legalApplicationActions('UNDER_REVIEW')).not.toContain('UNDER_REVIEW')
    expect(legalApplicationActions('INTERVIEW')).not.toContain('INTERVIEW')
  })
  it('notes-only saving is possible exactly when the status is itself an action', () => {
    expect(canSaveNotesOnly('UNDER_REVIEW')).toBe(true)
    expect(canSaveNotesOnly('SHORTLISTED')).toBe(true)
    expect(canSaveNotesOnly('SUBMITTED')).toBe(false)
    expect(canSaveNotesOnly('SELECTED')).toBe(false)
    expect(canSaveNotesOnly('WITHDRAWN')).toBe(false)
  })
  it('shortlist/select/reject require confirmation; review steps do not', () => {
    expect(applicationActionNeedsConfirmation('SHORTLISTED')).toBe(true)
    expect(applicationActionNeedsConfirmation('SELECTED')).toBe(true)
    expect(applicationActionNeedsConfirmation('REJECTED')).toBe(true)
    expect(applicationActionNeedsConfirmation('UNDER_REVIEW')).toBe(false)
    expect(applicationActionNeedsConfirmation('INTERVIEW')).toBe(false)
  })
  it('every real application status has a label and a distinct badge treatment', () => {
    expect(APPLICATION_STATUSES_ALL).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'SELECTED', 'REJECTED', 'WITHDRAWN'])
    const mine = APPLICATION_STATUSES_ALL.map(s => employerApplicationStatusBadgeClass(s))
    expect(new Set(mine).size).toBe(APPLICATION_STATUSES_ALL.length)
    expect(applicationStatusLabel('UNDER_REVIEW')).toBe('under review')
    // The re-exported marketplace badge map agrees with all seven statuses.
    expect(applicationStatusBadgeClass('WITHDRAWN')).toBeTruthy()
  })
})

// ─── Applicant snapshot + consent truth ──────────────────────────────────────

describe('applicant snapshot parsing — mirrors toEmployerApplicationDTO truth', () => {
  const SKILL = { skillName: 'Statistics', verificationLabel: 'BEAN_ASSESSMENT_VERIFIED', proficiency: 'advanced' }
  const PROJECT = { title: 'Census cleanup', description: 'd', projectUrl: 'https://x', category: 'RESEARCH' }
  const CREDENTIAL = { credentialName: 'Excel I', issuer: 'Bean Academy', issuedDate: '2026-01-15T00:00:00.000Z' }

  it('parses real snapshot shapes and drops junk safely', () => {
    expect(applicantSkills([SKILL, { skillName: '' }, 'junk'])).toEqual([
      { name: 'Statistics', verification: 'BEAN_ASSESSMENT_VERIFIED', proficiency: 'advanced' },
    ])
    expect(applicantSkills(undefined)).toEqual([])
    expect(applicantProjects([PROJECT, { title: '   ' }])).toEqual([
      { title: 'Census cleanup', description: 'd', url: 'https://x', category: 'RESEARCH' },
    ])
    expect(applicantCredentials([CREDENTIAL])).toEqual([
      { name: 'Excel I', issuer: 'Bean Academy', issuedDate: '2026-01-15T00:00:00.000Z' },
    ])
  })

  it('contact email surfaces ONLY when the DTO carries the consented contact', () => {
    expect(applicantContact({ contact: { email: 'a@b.c' } })).toEqual({ consented: true, email: 'a@b.c' })
    expect(applicantContact({ contact: null })).toEqual({ consented: false, email: null })
    expect(applicantContact({ contact: {} })).toEqual({ consented: false, email: null })
    expect(applicantContact({ contact: { email: '   ' } })).toEqual({ consented: false, email: null })
  })
})

// ─── Admin: verification / moderation / reports / eligibility legality ───────

describe('legalAdminVerificationActions — mirrors isLegalVerificationTransition', () => {
  it('pending review can approve or reject', () => {
    expect(legalAdminVerificationActions('PENDING_REVIEW')).toEqual(['APPROVE', 'REJECT'])
  })
  it('approved can only suspend', () => {
    expect(legalAdminVerificationActions('APPROVED')).toEqual(['SUSPEND'])
  })
  it('suspended can only reinstate', () => {
    expect(legalAdminVerificationActions('SUSPENDED')).toEqual(['REINSTATE'])
  })
  it('draft and rejected offer nothing (admins act on the queue)', () => {
    expect(legalAdminVerificationActions('DRAFT')).toEqual([])
    expect(legalAdminVerificationActions('REJECTED')).toEqual([])
  })
})

describe('legalAdminModerationActions — mirrors the moderation route legal map', () => {
  it('pending review can approve (or resume→published), reject, or close', () => {
    const actions = legalAdminModerationActions('PENDING_REVIEW')
    expect(actions).toContain('APPROVE')
    expect(actions).toContain('RESUME')
    expect(actions).toContain('REJECT')
    expect(actions).toContain('CLOSE')
    expect(actions).not.toContain('PAUSE')
  })
  it('published can pause or close (and resume is redundant-but-legal → offered)', () => {
    const actions = legalAdminModerationActions('PUBLISHED')
    expect(actions).toContain('PAUSE')
    expect(actions).toContain('CLOSE')
    expect(actions).not.toContain('APPROVE')
    expect(actions).not.toContain('REJECT')
  })
  it('paused can approve/resume (back to published) or close', () => {
    const actions = legalAdminModerationActions('PAUSED')
    expect(actions).toContain('APPROVE')
    expect(actions).toContain('RESUME')
    expect(actions).toContain('CLOSE')
    expect(actions).not.toContain('PAUSE')
  })
  it('closed and rejected offer nothing; drafts can only close', () => {
    expect(legalAdminModerationActions('CLOSED')).toEqual([])
    expect(legalAdminModerationActions('REJECTED')).toEqual([])
    expect(legalAdminModerationActions('DRAFT')).toEqual(['CLOSE'])
  })
})

describe('legalAdminReportActions — mirrors the report action route', () => {
  it('OPEN reports can be acknowledged, investigated, resolved, dismissed (and pause opportunity listings)', () => {
    expect(legalAdminReportActions('OPEN', 'OPPORTUNITY')).toEqual(['ACKNOWLEDGE', 'INVESTIGATE', 'RESOLVE', 'DISMISS', 'PAUSE_OPPORTUNITY'])
  })
  it('UNDER_REVIEW reports can resolve/dismiss/pause but not restart review', () => {
    expect(legalAdminReportActions('UNDER_REVIEW', 'OPPORTUNITY')).toEqual(['RESOLVE', 'DISMISS', 'PAUSE_OPPORTUNITY'])
  })
  it('non-opportunity targets never offer pause', () => {
    expect(legalAdminReportActions('OPEN', 'ORGANIZATION')).not.toContain('PAUSE_OPPORTUNITY')
    expect(legalAdminReportActions('UNDER_REVIEW', 'ORGANIZATION')).toEqual(['RESOLVE', 'DISMISS'])
  })
  it('terminal reports offer nothing', () => {
    expect(legalAdminReportActions('RESOLVED', 'OPPORTUNITY')).toEqual([])
    expect(legalAdminReportActions('DISMISSED', 'OPPORTUNITY')).toEqual([])
  })
})

describe('legalAdminEligibilityActions — only pending reviews are decidable', () => {
  it('pending review can approve or deny', () => {
    expect(legalAdminEligibilityActions('PENDING_REVIEW')).toEqual(['APPROVE', 'DENY'])
  })
  it('final statuses offer nothing', () => {
    for (const s of ['APPROVED', 'DENIED', 'NOT_ELIGIBLE']) {
      expect(legalAdminEligibilityActions(s)).toEqual([])
    }
  })
})

// ─── Reason-required matrix (server 400s below 10 chars) ─────────────────────

describe('minReasonLength + reasonValidationError — the server reason matrix', () => {
  it('requires 10+ characters exactly where the server demands them', () => {
    expect(ADMIN_REASON_MIN).toBe(10)
    // Organization verification: REJECT / SUSPEND.
    expect(minReasonLength('verification', 'REJECT')).toBe(10)
    expect(minReasonLength('verification', 'SUSPEND')).toBe(10)
    expect(minReasonLength('verification', 'APPROVE')).toBe(0)
    expect(minReasonLength('verification', 'REINSTATE')).toBe(0)
    // Opportunity moderation: REJECT / PAUSE.
    expect(minReasonLength('moderation', 'REJECT')).toBe(10)
    expect(minReasonLength('moderation', 'PAUSE')).toBe(10)
    expect(minReasonLength('moderation', 'APPROVE')).toBe(0)
    expect(minReasonLength('moderation', 'CLOSE')).toBe(0)
    expect(minReasonLength('moderation', 'RESUME')).toBe(0)
    // Reports: RESOLVE / DISMISS / PAUSE_OPPORTUNITY.
    expect(minReasonLength('report', 'RESOLVE')).toBe(10)
    expect(minReasonLength('report', 'DISMISS')).toBe(10)
    expect(minReasonLength('report', 'PAUSE_OPPORTUNITY')).toBe(10)
    expect(minReasonLength('report', 'ACKNOWLEDGE')).toBe(0)
    expect(minReasonLength('report', 'INVESTIGATE')).toBe(0)
    // Eligibility: DENY.
    expect(minReasonLength('eligibility', 'DENY')).toBe(10)
    expect(minReasonLength('eligibility', 'APPROVE')).toBe(0)
  })
  it('validation errors guide to exactly 10+ trimmed characters', () => {
    expect(reasonValidationError(10, '')).toContain('10+ characters')
    expect(reasonValidationError(10, 'short')).toContain('5 more')
    expect(reasonValidationError(10, '   adequate reason here   ')).toBeNull()
    expect(reasonValidationError(10, 'exactly ten')).toBeNull()
    expect(reasonValidationError(10, 'short one')).not.toBeNull()
    expect(reasonValidationError(0, '')).toBeNull()
  })
})

// ─── Pagination reuse + rate-limit honesty + shared labels ───────────────────

describe('pagination reuse (career-market helpers) + honest 429 copy', () => {
  it('totalPages and clampPage behave on the shared server page contract', () => {
    expect(totalPages(0, 20)).toBe(1) // never fewer than 1 — empty states handled separately
    expect(totalPages(1, 20)).toBe(1)
    expect(totalPages(21, 20)).toBe(2)
    expect(clampPage(-3, 5)).toBe(1)
    expect(clampPage(9, 5)).toBe(5)
    expect(clampPage(2, 0)).toBe(1)
  })
  it('rate-limit errors are detected from the real server message', () => {
    expect(isRateLimitError('Discovery search limit reached for today — please try again tomorrow.')).toBe(true)
    expect(isRateLimitError('Could not search candidates.')).toBe(false)
    expect(isRateLimitError(null)).toBe(false)
  })
  it('humanizeStatus keeps queue filters readable', () => {
    expect(humanizeStatus('PENDING_REVIEW')).toBe('pending review')
    expect(humanizeStatus('ORG_MEMBER:OWNER')).toBe('org member:owner')
  })
})
