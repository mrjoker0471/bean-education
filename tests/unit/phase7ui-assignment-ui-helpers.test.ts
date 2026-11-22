// ─── Phase 7 UI completion: assignment/resource/announcement UI helpers ──────
// Pure-logic proofs for the helpers the institution workspace views rely on:
//   • assignmentLifecycleActions — UI action sets mirror the server's PATCH
//     transition machine exactly (no invented transitions).
//   • assignmentIsOverdue — only PUBLISHED assignments past dueAt count.
//   • filterAssignmentsByGroup — client-side group filter for the panel.
//   • submissionDraftError / httpsUrlError — client mirror of the submission
//     and resource URL validation (server re-validates everything).
//   • announcementExpiryState / expiryFromDays / localInputValue — honest
//     expiry signaling and datetime-local round-trips for edit dialogs.

import { describe, it, expect } from 'bun:test'
import {
  announcementExpiryState,
  assignmentIsOverdue,
  assignmentLifecycleActions,
  assignmentStatusBadgeClass,
  expiryFromDays,
  filterAssignmentsByGroup,
  httpsUrlError,
  localInputValue,
  submissionDraftError,
  submissionStatusBadgeClass,
} from '@/lib/institution-ui'

const NOW = new Date('2026-03-10T12:00:00.000Z')
const HOUR = 3600_000

describe('assignmentLifecycleActions', () => {
  it('DRAFT offers publish, archive and draft-only content edit', () => {
    expect(assignmentLifecycleActions('DRAFT')).toEqual(['PUBLISH', 'ARCHIVE', 'EDIT'])
  })

  it('PUBLISHED offers close and archive (no edits — content freezes)', () => {
    expect(assignmentLifecycleActions('PUBLISHED')).toEqual(['CLOSE', 'ARCHIVE'])
  })

  it('CLOSED only offers archive and ARCHIVED only offers restore', () => {
    expect(assignmentLifecycleActions('CLOSED')).toEqual(['ARCHIVE'])
    expect(assignmentLifecycleActions('ARCHIVED')).toEqual(['RESTORE'])
  })

  it('unknown statuses yield no actions (the UI never invents a transition)', () => {
    expect(assignmentLifecycleActions('MYSTERY')).toEqual([])
    expect(assignmentLifecycleActions('')).toEqual([])
  })
})

describe('assignmentIsOverdue', () => {
  const pastDue = new Date(NOW.getTime() - 2 * HOUR).toISOString()
  const futureDue = new Date(NOW.getTime() + 2 * HOUR).toISOString()

  it('a PUBLISHED assignment past its due date is overdue', () => {
    expect(assignmentIsOverdue(pastDue, 'PUBLISHED', NOW)).toBe(true)
  })

  it('a PUBLISHED assignment before its due date is not', () => {
    expect(assignmentIsOverdue(futureDue, 'PUBLISHED', NOW)).toBe(false)
  })

  it('terminal and unpublished states never render overdue styling', () => {
    expect(assignmentIsOverdue(pastDue, 'CLOSED', NOW)).toBe(false)
    expect(assignmentIsOverdue(pastDue, 'ARCHIVED', NOW)).toBe(false)
    expect(assignmentIsOverdue(pastDue, 'DRAFT', NOW)).toBe(false)
  })

  it('missing or unparseable due dates are not overdue', () => {
    expect(assignmentIsOverdue(null, 'PUBLISHED', NOW)).toBe(false)
    expect(assignmentIsOverdue(undefined, 'PUBLISHED', NOW)).toBe(false)
    expect(assignmentIsOverdue('not-a-date', 'PUBLISHED', NOW)).toBe(false)
  })
})

describe('filterAssignmentsByGroup', () => {
  const rows = [
    { id: 'a1', groupId: 'g1' },
    { id: 'a2', groupId: 'g2' },
    { id: 'a3', groupId: 'g1' },
  ]

  it('a null filter returns every assignment', () => {
    expect(filterAssignmentsByGroup(rows, null)).toHaveLength(3)
    expect(filterAssignmentsByGroup(rows, null)).toEqual(rows)
  })

  it('a group filter keeps only that group\'s assignments', () => {
    expect(filterAssignmentsByGroup(rows, 'g1').map(r => r.id)).toEqual(['a1', 'a3'])
    expect(filterAssignmentsByGroup(rows, 'g2').map(r => r.id)).toEqual(['a2'])
    expect(filterAssignmentsByGroup(rows, 'missing')).toEqual([])
  })
})

describe('submissionDraftError', () => {
  it('requires a written response for TEXT assignments', () => {
    expect(submissionDraftError({ responseText: '', externalLink: '', submissionType: 'TEXT' })).toBe(
      'This assignment requires a written response.',
    )
    expect(submissionDraftError({ responseText: '  prose  ', externalLink: '', submissionType: 'TEXT' })).toBeNull()
  })

  it('requires an HTTPS link for EXTERNAL_LINK assignments', () => {
    expect(submissionDraftError({ responseText: '', externalLink: '', submissionType: 'EXTERNAL_LINK' })).toBe(
      'This assignment requires an external project link.',
    )
    expect(submissionDraftError({ responseText: '', externalLink: 'http://example.com/x', submissionType: 'EXTERNAL_LINK' })).toBe(
      'Links must be valid HTTPS URLs.',
    )
    expect(submissionDraftError({ responseText: '', externalLink: 'https://example.com/x', submissionType: 'EXTERNAL_LINK' })).toBeNull()
  })

  it('TEXT_AND_LINK accepts either channel but rejects empty drafts', () => {
    expect(submissionDraftError({ responseText: '', externalLink: '', submissionType: 'TEXT_AND_LINK' })).toBe(
      'Add a written response or an external project link before submitting.',
    )
    expect(submissionDraftError({ responseText: 'answer', externalLink: '', submissionType: 'TEXT_AND_LINK' })).toBeNull()
    expect(submissionDraftError({ responseText: '', externalLink: 'https://example.com', submissionType: 'TEXT_AND_LINK' })).toBeNull()
  })

  it('a present link is validated even when text is provided', () => {
    expect(submissionDraftError({ responseText: 'answer', externalLink: 'ftp://bad', submissionType: 'TEXT_AND_LINK' })).toBe(
      'Links must be valid HTTPS URLs.',
    )
  })
})

describe('httpsUrlError', () => {
  it('accepts real HTTPS URLs', () => {
    expect(httpsUrlError('https://example.com/guide')).toBeNull()
    expect(httpsUrlError('  https://example.com  ')).toBeNull()
  })

  it('rejects non-HTTPS schemes, malformed values and empty input', () => {
    expect(httpsUrlError('http://example.com')).toBe('Links must be valid HTTPS URLs.')
    expect(httpsUrlError('not a url')).toBe('Links must be valid HTTPS URLs.')
    expect(httpsUrlError('')).toBe('A link is required.')
    expect(httpsUrlError('   ')).toBe('A link is required.')
  })
})

describe('announcementExpiryState', () => {
  it('no expiry means no warning', () => {
    expect(announcementExpiryState(null, NOW)).toBeNull()
    expect(announcementExpiryState(undefined, NOW)).toBeNull()
    expect(announcementExpiryState('not-a-date', NOW)).toBeNull()
  })

  it('a past expiry is EXPIRED regardless of distance', () => {
    expect(announcementExpiryState(new Date(NOW.getTime() - HOUR).toISOString(), NOW)).toBe('EXPIRED')
    expect(announcementExpiryState(new Date(NOW.getTime() - 30 * 24 * HOUR).toISOString(), NOW)).toBe('EXPIRED')
  })

  it('an expiry within 72 hours is SOON', () => {
    expect(announcementExpiryState(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe('SOON')
    expect(announcementExpiryState(new Date(NOW.getTime() + 71 * HOUR).toISOString(), NOW)).toBe('SOON')
  })

  it('a far-future expiry raises no warning', () => {
    expect(announcementExpiryState(new Date(NOW.getTime() + 73 * HOUR).toISOString(), NOW)).toBeNull()
    expect(announcementExpiryState(new Date(NOW.getTime() + 30 * 24 * HOUR).toISOString(), NOW)).toBeNull()
  })
})

describe('expiryFromDays', () => {
  it('zero/negative/invalid day counts mean "never"', () => {
    expect(expiryFromDays(0, NOW)).toBeNull()
    expect(expiryFromDays(-3, NOW)).toBeNull()
    expect(expiryFromDays(Number.NaN, NOW)).toBeNull()
  })

  it('positive day counts produce a future ISO timestamp', () => {
    const iso = expiryFromDays(7, NOW)
    expect(iso).toBe(new Date(NOW.getTime() + 7 * 24 * HOUR).toISOString())
    expect(expiryFromDays(1, NOW)).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString())
    expect(expiryFromDays(30, NOW)).toBe(new Date(NOW.getTime() + 30 * 24 * HOUR).toISOString())
  })
})

describe('localInputValue', () => {
  it('converts an ISO timestamp into a datetime-local input value', () => {
    // Deterministic when the run zone is UTC (CI/sandbox); the format is what matters.
    expect(localInputValue('2026-03-10T12:30:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  })

  it('round-trips through Date without losing the minute', () => {
    const input = localInputValue('2026-03-10T12:30:00.000Z')
    expect(new Date(input).getTime()).toBe(new Date('2026-03-10T12:30:00.000Z').getTime())
  })

  it('missing and invalid values map to an empty input', () => {
    expect(localInputValue(null)).toBe('')
    expect(localInputValue(undefined)).toBe('')
    expect(localInputValue('garbage')).toBe('')
  })
})

describe('status badge classes', () => {
  it('assignment statuses map to distinct treatments', () => {
    expect(assignmentStatusBadgeClass('DRAFT')).toContain('text-gold')
    expect(assignmentStatusBadgeClass('PUBLISHED')).toContain('text-success')
    expect(assignmentStatusBadgeClass('CLOSED')).toContain('text-muted-foreground')
    expect(assignmentStatusBadgeClass('ARCHIVED')).toContain('text-muted-foreground')
  })

  it('submission statuses map to distinct treatments', () => {
    expect(submissionStatusBadgeClass('SUBMITTED')).toContain('text-gold')
    expect(submissionStatusBadgeClass('GRADED')).toContain('text-success')
    expect(submissionStatusBadgeClass('RETURNED')).toContain('text-destructive')
    expect(submissionStatusBadgeClass('DRAFT')).toContain('text-muted-foreground')
    expect(submissionStatusBadgeClass('UNKNOWN')).toContain('text-muted-foreground')
  })
})
