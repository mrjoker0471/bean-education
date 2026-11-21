// ─── Phase 7 UI completion: institution workspace presentation helpers ───────
// Pure unit tests for src/lib/institution-ui.ts — the helpers behind the
// institution overview dashboard, invitations panel and classes management:
//   • invitation status derivation from real fields only,
//   • audit action humanization (with a safe fallback),
//   • honest class display states (ENDED derivation, COMPLETED never faked),
//   • booking/attendance counting, upcoming-class filtering,
//   • invite link building, audience validation, future-schedule validation.

import { describe, it, expect } from 'bun:test'
import {
  activeBookings,
  attendanceMarkedCount,
  buildInviteLink,
  classDisplayStatus,
  classStatusBadgeClass,
  deriveInvitationStatus,
  humanizeAuditAction,
  institutionClassAudienceError,
  invitationStatusBadgeClass,
  isFutureLocalSchedule,
  upcomingOrgClasses,
} from '@/lib/institution-ui'

const NOW = new Date('2026-03-10T12:00:00.000Z')
const iso = (s: string): string => new Date(s).toISOString()

describe('deriveInvitationStatus', () => {
  it('returns PENDING for a live, unaccepted, unrevoked invitation', () => {
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: iso('2026-03-20T00:00:00Z') }, NOW)).toBe('PENDING')
  })

  it('returns REVOKED even when also accepted or expired', () => {
    expect(deriveInvitationStatus({ acceptedAt: iso('2026-03-01T00:00:00Z'), revokedAt: iso('2026-03-02T00:00:00Z'), expiresAt: iso('2026-03-20T00:00:00Z') }, NOW)).toBe('REVOKED')
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: iso('2026-03-05T00:00:00Z'), expiresAt: iso('2026-03-01T00:00:00Z') }, NOW)).toBe('REVOKED')
  })

  it('returns ACCEPTED when accepted and not revoked, regardless of expiry', () => {
    expect(deriveInvitationStatus({ acceptedAt: iso('2026-03-01T00:00:00Z'), revokedAt: null, expiresAt: iso('2026-03-20T00:00:00Z') }, NOW)).toBe('ACCEPTED')
    expect(deriveInvitationStatus({ acceptedAt: iso('2026-03-01T00:00:00Z'), revokedAt: null, expiresAt: iso('2026-03-01T00:00:00Z') }, NOW)).toBe('ACCEPTED')
  })

  it('returns EXPIRED only when unaccepted, unrevoked and past expiry', () => {
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: iso('2026-03-09T23:59:59Z') }, NOW)).toBe('EXPIRED')
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: iso('2026-03-10T12:00:00Z') }, NOW)).toBe('EXPIRED')
  })

  it('still works with the current-time default', () => {
    const farFuture = new Date(Date.now() + 365 * 24 * 3600_000).toISOString()
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: farFuture })).toBe('PENDING')
  })
})

describe('invitationStatusBadgeClass', () => {
  it('maps each status to a distinct tone class', () => {
    expect(invitationStatusBadgeClass('PENDING')).toContain('text-gold')
    expect(invitationStatusBadgeClass('ACCEPTED')).toContain('text-success')
    expect(invitationStatusBadgeClass('EXPIRED')).toContain('text-muted-foreground')
    expect(invitationStatusBadgeClass('REVOKED')).toContain('text-destructive')
  })
})

describe('buildInviteLink', () => {
  it('wraps the raw token in the token= query format the join dialog parses', () => {
    expect(buildInviteLink('abc123def456ghi789')).toBe('bean://invite?token=abc123def456ghi789')
  })
})

describe('humanizeAuditAction', () => {
  it('translates known organization audit actions to labels', () => {
    expect(humanizeAuditAction('INVITATION_ACCEPTED')).toBe('Invitation accepted')
    expect(humanizeAuditAction('ASSIGNMENT_PUBLISHED')).toBe('Assignment published')
    expect(humanizeAuditAction('GROUP_MEMBER_REMOVED')).toBe('Group member removed')
  })

  it('falls back to Title Case for unknown server actions (never raw SCREAMING_SNAKE)', () => {
    expect(humanizeAuditAction('MEMBER_SUSPENDED')).toBe('Member suspended')
    expect(humanizeAuditAction('SOMETHING_NEW_FROM_SERVER')).toBe('Something New From Server')
  })

  it('returns the input untouched when there are no separators', () => {
    expect(humanizeAuditAction('')).toBe('')
    expect(humanizeAuditAction('CUSTOM')).toBe('Custom')
  })
})

describe('classDisplayStatus', () => {
  it('passes real non-published statuses through untouched', () => {
    expect(classDisplayStatus('DRAFT', iso('2026-03-01T00:00:00Z'), 60, NOW)).toBe('DRAFT')
    expect(classDisplayStatus('CANCELLED', iso('2026-03-01T00:00:00Z'), 60, NOW)).toBe('CANCELLED')
    expect(classDisplayStatus('COMPLETED', iso('2026-03-01T00:00:00Z'), 60, NOW)).toBe('COMPLETED')
  })

  it('keeps PUBLISHED for a published class that has not ended yet', () => {
    expect(classDisplayStatus('PUBLISHED', iso('2026-03-10T11:00:00Z'), 90, NOW)).toBe('PUBLISHED')
    expect(classDisplayStatus('PUBLISHED', iso('2026-03-10T12:00:00Z'), 60, NOW)).toBe('PUBLISHED')
  })

  it('derives ENDED for a published class whose end time has passed', () => {
    expect(classDisplayStatus('PUBLISHED', iso('2026-03-10T11:00:00Z'), 60, NOW)).toBe('ENDED')
    expect(classDisplayStatus('PUBLISHED', iso('2026-03-01T00:00:00Z'), 60, NOW)).toBe('ENDED')
  })

  it('maps unknown statuses conservatively to ENDED', () => {
    expect(classDisplayStatus('WEIRD', iso('2026-03-01T00:00:00Z'), 60, NOW)).toBe('ENDED')
  })
})

describe('classStatusBadgeClass', () => {
  it('gives each display state its tone', () => {
    expect(classStatusBadgeClass('DRAFT')).toContain('text-gold')
    expect(classStatusBadgeClass('PUBLISHED')).toContain('text-success')
    expect(classStatusBadgeClass('CANCELLED')).toContain('text-destructive')
    expect(classStatusBadgeClass('ENDED')).toContain('text-muted-foreground')
    expect(classStatusBadgeClass('COMPLETED')).toContain('text-muted-foreground')
  })
})

describe('activeBookings', () => {
  it('keeps everything that is not CANCELLED', () => {
    const bookings = [
      { id: '1', status: 'CONFIRMED' },
      { id: '2', status: 'CANCELLED' },
      { id: '3', status: 'ATTENDED' },
      { id: '4', status: 'NO_SHOW' },
    ]
    expect(activeBookings(bookings).map(b => b.id)).toEqual(['1', '3', '4'])
  })

  it('returns an empty array for an empty or fully cancelled list', () => {
    expect(activeBookings([])).toEqual([])
    expect(activeBookings([{ id: 'x', status: 'CANCELLED' }])).toEqual([])
  })
})

describe('attendanceMarkedCount', () => {
  it('counts bookings that carry attendance evidence', () => {
    const bookings = [
      { attendanceMarkedAt: iso('2026-03-01T10:00:00Z') },
      { attendanceMarkedAt: null },
      { attendanceMarkedAt: iso('2026-03-01T10:05:00Z') },
    ]
    expect(attendanceMarkedCount(bookings)).toBe(2)
  })

  it('counts nothing when no evidence exists', () => {
    expect(attendanceMarkedCount([{ attendanceMarkedAt: null }])).toBe(0)
    expect(attendanceMarkedCount([])).toBe(0)
  })
})

describe('upcomingOrgClasses', () => {
  const rows = [
    { id: 'past', title: 'Past class', startsAt: iso('2026-03-01T09:00:00Z'), status: 'PUBLISHED' },
    { id: 'draft', title: 'Draft class', startsAt: iso('2026-03-11T09:00:00Z'), status: 'DRAFT' },
    { id: 'later', title: 'Later class', startsAt: iso('2026-03-15T09:00:00Z'), status: 'PUBLISHED' },
    { id: 'soonest', title: 'Soonest class', startsAt: iso('2026-03-11T08:00:00Z'), status: 'PUBLISHED' },
    { id: 'middle', title: 'Middle class', startsAt: iso('2026-03-12T09:00:00Z'), status: 'PUBLISHED' },
    { id: 'boundary', title: 'Boundary class', startsAt: iso('2026-03-10T12:00:00Z'), status: 'PUBLISHED' },
  ]

  it('filters to future PUBLISHED rows only (drafts and past excluded)', () => {
    expect(upcomingOrgClasses(rows, NOW).map(r => r.id)).toEqual(['soonest', 'middle', 'later'])
  })

  it('sorts soonest first and respects the limit', () => {
    expect(upcomingOrgClasses(rows, NOW, 2).map(r => r.id)).toEqual(['soonest', 'middle'])
  })

  it('excludes classes whose start time equals "now" (must be strictly future)', () => {
    expect(upcomingOrgClasses(rows, NOW).some(r => r.id === 'boundary')).toBe(false)
  })

  it('returns an empty array when nothing is upcoming', () => {
    expect(upcomingOrgClasses([], NOW)).toEqual([])
    expect(upcomingOrgClasses([rows[0], rows[1]], NOW)).toEqual([])
  })
})

describe('institutionClassAudienceError', () => {
  it('accepts an organization audience without a group', () => {
    expect(institutionClassAudienceError('ORGANIZATION', null)).toBeNull()
  })

  it('accepts a group audience when a group is selected', () => {
    expect(institutionClassAudienceError('GROUP', 'group_123456')).toBeNull()
  })

  it('rejects a group audience without a group selection', () => {
    expect(institutionClassAudienceError('GROUP', null)).toBe('Pick the group this class is restricted to.')
    expect(institutionClassAudienceError('GROUP', '')).toBe('Pick the group this class is restricted to.')
  })
})

describe('isFutureLocalSchedule', () => {
  it('accepts a datetime-local value strictly in the future', () => {
    expect(isFutureLocalSchedule('2026-03-11T09:00', NOW)).toBe(true)
  })

  it('rejects past or exactly-now values', () => {
    expect(isFutureLocalSchedule('2026-03-09T09:00', NOW)).toBe(false)
    expect(isFutureLocalSchedule('2026-03-10T12:00', NOW)).toBe(false)
  })

  it('rejects empty or unparseable values', () => {
    expect(isFutureLocalSchedule('', NOW)).toBe(false)
    expect(isFutureLocalSchedule('not-a-date', NOW)).toBe(false)
  })
})
