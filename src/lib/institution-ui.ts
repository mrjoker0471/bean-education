// ─── Phase 7 UI completion: institution workspace presentation helpers ───────
// Pure, client-safe helpers shared by the institution workspace views
// (institution-org-view.tsx). No React, no database, no server-only imports —
// every function is deterministic and unit-tested in
// tests/unit/phase7ui-institution-ui-helpers.test.ts.
//
// Integrity rules these helpers protect:
//   • Invitation states derive ONLY from real fields (acceptedAt/revokedAt/
//     expiresAt) — never guessed from counts.
//   • Class display states mirror the teacher dashboard's honest derivation:
//     a PUBLISHED class whose schedule has passed shows ENDED; COMPLETED is a
//     real server status, never synthesized.
//   • Dashboard/overview numbers come from API responses; these helpers only
//     filter/sort real rows (no invented statistics).

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'

export interface InvitationStatusFields {
  acceptedAt: string | null
  revokedAt: string | null
  expiresAt: string
}

/**
 * Derive an invitation's display status from its real fields, in priority
 * order: REVOKED > ACCEPTED > EXPIRED > PENDING (matches the accept route's
 * isInvitationRedeemable semantics: revoked/expired invitations cannot be
 * redeemed, and an accepted invitation keeps its acceptedAt forever).
 */
export function deriveInvitationStatus(invitation: InvitationStatusFields, now: Date = new Date()): InvitationStatus {
  if (invitation.revokedAt) return 'REVOKED'
  if (invitation.acceptedAt) return 'ACCEPTED'
  if (new Date(invitation.expiresAt).getTime() <= now.getTime()) return 'EXPIRED'
  return 'PENDING'
}

export function invitationStatusBadgeClass(status: InvitationStatus): string {
  switch (status) {
    case 'PENDING': return 'border-gold/40 bg-gold/10 text-gold'
    case 'ACCEPTED': return 'border-success/40 bg-success/10 text-success'
    case 'EXPIRED': return 'border-border bg-elevated text-muted-foreground'
    case 'REVOKED': return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
}

/** The invite link consumed by the Institutions page "Join with an invitation"
 *  dialog, which strips the `token=` query parameter (or accepts the bare raw
 *  token). The raw token exists only in the POST create response. */
export function buildInviteLink(rawToken: string): string {
  return `bean://invite?token=${rawToken}`
}

/** Curated human labels for the organization audit actions the server writes;
 *  unknown actions fall back to Title Case so new server actions never render
 *  as raw SCREAMING_SNAKE strings. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  ORGANIZATION_REGISTERED: 'Organization registered',
  ORGANIZATION_PROFILE_UPDATED: 'Profile updated',
  VERIFICATION_SUBMITTED: 'Submitted for verification',
  INVITATION_CREATED: 'Invitation created',
  INVITATION_ACCEPTED: 'Invitation accepted',
  MEMBER_ACTIVATED: 'Member approved',
  MEMBER_ROLE_CHANGED: 'Member role changed',
  MEMBER_SUSPENDED: 'Member suspended',
  MEMBER_REINSTATED: 'Member reinstated',
  MEMBER_REMOVED: 'Member removed',
  GROUP_CREATED: 'Group created',
  GROUP_UPDATED: 'Group updated',
  GROUP_ARCHIVED: 'Group archived',
  GROUP_RESTORED: 'Group restored',
  GROUP_ENROLLED: 'Member enrolled in group',
  GROUP_MEMBER_REMOVED: 'Group member removed',
  ASSIGNMENT_PUBLISHED: 'Assignment published',
  ASSIGNMENT_UPDATED: 'Assignment updated',
  ASSIGNMENT_CLOSED: 'Assignment closed',
  ASSIGNMENT_ARCHIVED: 'Assignment archived',
  ASSIGNMENT_RESTORED: 'Assignment restored',
  RESOURCE_SHARED: 'Resource shared',
  RESOURCE_UPDATED: 'Resource updated',
  RESOURCE_REMOVED: 'Resource removed',
  ANNOUNCEMENT_UPDATED: 'Announcement updated',
}

export function humanizeAuditAction(action: string): string {
  const known = AUDIT_ACTION_LABELS[action]
  if (known) return known
  const words = action.split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  return words.length > 0 ? words.join(' ') : action
}

export type ClassDisplayStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED' | 'ENDED'

/**
 * Honest display status for a class row. Real server statuses pass through;
 * a PUBLISHED class whose end time has passed shows ENDED (the same client-side
 * derivation the teacher dashboard uses for its Completed group). COMPLETED is
 * never synthesized.
 */
export function classDisplayStatus(status: string, startsAt: string, durationMinutes: number, now: Date = new Date()): ClassDisplayStatus {
  if (status === 'PUBLISHED') {
    const endMs = new Date(startsAt).getTime() + durationMinutes * 60_000
    return endMs <= now.getTime() ? 'ENDED' : 'PUBLISHED'
  }
  if (status === 'DRAFT' || status === 'CANCELLED' || status === 'COMPLETED') return status
  return 'ENDED'
}

export function classStatusBadgeClass(display: ClassDisplayStatus): string {
  switch (display) {
    case 'DRAFT': return 'border-gold/40 bg-gold/10 text-gold'
    case 'PUBLISHED': return 'border-success/40 bg-success/10 text-success'
    case 'ENDED':
    case 'COMPLETED': return 'border-border bg-elevated text-muted-foreground'
    case 'CANCELLED': return 'border-destructive/40 bg-destructive/10 text-destructive'
  }
}

/** Seat-holding bookings (everything that is not CANCELLED). */
export function activeBookings<T extends { status: string }>(bookings: readonly T[]): T[] {
  return bookings.filter(b => b.status !== 'CANCELLED')
}

/** How many bookings have attendance evidence recorded (attendanceMarkedAt). */
export function attendanceMarkedCount<T extends { attendanceMarkedAt: string | null }>(bookings: readonly T[]): number {
  return bookings.filter(b => b.attendanceMarkedAt !== null).length
}

export interface UpcomingClassRow {
  id: string
  title: string
  startsAt: string
  status: string
}

/** The next `limit` PUBLISHED classes that start in the future, soonest first
 *  (used by the overview "upcoming classes" list — pure filtering of real API
 *  rows, no invented data). */
export function upcomingOrgClasses<T extends UpcomingClassRow>(rows: readonly T[], now: Date = new Date(), limit = 3): T[] {
  const nowMs = now.getTime()
  return rows
    .filter(r => r.status === 'PUBLISHED' && new Date(r.startsAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .slice(0, limit)
}

export type InstitutionAudience = 'ORGANIZATION' | 'GROUP'

/** Client-side audience validation mirroring teachClassCreateSchema's private-
 *  class refinements: ORGANIZATION needs the owning org id (passed implicitly —
 *  this panel only schedules inside the workspace), GROUP needs a group. */
export function institutionClassAudienceError(audience: InstitutionAudience, organizationGroupId: string | null): string | null {
  if (audience === 'GROUP' && !organizationGroupId) return 'Pick the group this class is restricted to.'
  return null
}

/** A datetime-local input value ("2026-03-01T14:30") that parses and lies in
 *  the future — mirrors the server's "schedule must be a future date and time". */
export function isFutureLocalSchedule(value: string, now: Date = new Date()): boolean {
  if (!value) return false
  const t = new Date(value).getTime()
  return !Number.isNaN(t) && t > now.getTime()
}
