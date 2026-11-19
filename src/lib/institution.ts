// ─── BEAN Institution Workspace (Phase 7): domain constants, rules, guards ───
// Server-only source of truth for organizations, memberships, invitations and
// groups. Every authorization decision is made HERE against the session
// identity (httpOnly cookie) — client-supplied ids/roles are never trusted.
//
// Product rules enforced by this module (docs/PHASE7_DESIGN.md):
//   • A membership NEVER elevates Student.role — powers are organization-scoped.
//   • Organization approval is a deliberate human admin decision; email-domain
//     matching is never sufficient proof of organizational identity.
//   • "Verified" means identity reviewed by BEAN — never government recognition
//     or accreditation.
//   • Invitations cannot grant OWNER or ADMIN; only a hash of the invite token
//     is stored; the raw token is never persisted or logged.
//   • Suspended/left members lose NEW private-class access but historical
//     booking and attendance records are always retained.

import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import type { AuthStudent } from '@/lib/auth'

// ─── Statuses and enumerations ───────────────────────────────────────────────

export const ORG_TYPES = [
  'SCHOOL',
  'COLLEGE',
  'UNIVERSITY',
  'COACHING_CENTRE',
  'PROFESSIONAL_INSTITUTE',
  'SKILL_PROVIDER',
  'EMPLOYER',
  'OTHER',
] as const

export type OrgType = (typeof ORG_TYPES)[number]

export const ORG_VERIFICATION_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED',
} as const

export const ORG_ROLES = [
  'OWNER',
  'ADMIN',
  'INSTRUCTOR',
  'STAFF',
  'LEARNER',
  'CAREER_COORDINATOR',
  'RECRUITER',
] as const

export type OrgRole = (typeof ORG_ROLES)[number]

export const ORG_MEMBERSHIP_STATUS = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  LEFT: 'LEFT',
} as const

/** Roles that may manage the organization profile, members and invitations. */
export const ORG_ADMIN_ROLES: readonly string[] = ['OWNER', 'ADMIN'] as const

/** Roles that may create groups, publish assignments and manage group work. */
export const ORG_INSTRUCTOR_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'INSTRUCTOR'] as const

/** Roles allowed to issue credentials on behalf of an approved institution. */
export const ORG_CREDENTIAL_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'INSTRUCTOR'] as const

/** Employer-side roles allowed to manage opportunities and applications. */
export const ORG_EMPLOYER_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'RECRUITER', 'CAREER_COORDINATOR'] as const

/** Invitation-grantable roles — OWNER/ADMIN are always excluded. */
export const INVITABLE_ROLES: readonly string[] = [
  'INSTRUCTOR',
  'STAFF',
  'LEARNER',
  'CAREER_COORDINATOR',
  'RECRUITER',
] as const

export const GROUP_ENROLLMENT_STATE = {
  ACTIVE: 'ACTIVE',
  LEFT: 'LEFT',
} as const

export const ORG_AUDIENCE = {
  PUBLIC: 'PUBLIC',
  ORGANIZATION: 'ORGANIZATION',
  GROUP: 'GROUP',
} as const

export const ASSIGNMENT_STATUS = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const

export const SUBMISSION_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  RETURNED: 'RETURNED',
  GRADED: 'GRADED',
} as const

export const SUBMISSION_TYPES = ['TEXT', 'EXTERNAL_LINK', 'TEXT_AND_LINK'] as const

// ─── Bounds (documented in docs/PHASE7_ORGANIZATION_SECURITY.md) ─────────────

export const ORG_NAME_MIN = 4
export const ORG_NAME_MAX = 120
export const ORG_DISPLAY_NAME_MAX = 120
export const ORG_DESC_MAX = 1500
export const ORG_SLUG_MAX = 60
export const ORG_CONTACT_MAX = 300
export const ORG_PAGE_SIZE_DEFAULT = 12
export const ORG_PAGE_SIZE_MAX = 48
export const INVITATION_TOKEN_BYTES = 32
export const INVITATION_DEFAULT_TTL_DAYS = 14
export const INVITATION_TTL_MAX_DAYS = 90
export const INVITATION_MAX_USES_MAX = 200
export const GROUP_NAME_MAX = 120
export const GROUP_CAPACITY_MAX = 2000
export const ASSIGNMENT_TITLE_MIN = 4
export const ASSIGNMENT_TITLE_MAX = 160
export const ASSIGNMENT_INSTRUCTIONS_MAX = 4000
export const SUBMISSION_TEXT_MAX = 8000
export const ANNOUNCEMENT_TITLE_MAX = 160
export const ANNOUNCEMENT_BODY_MAX = 5000
export const RESOURCE_TITLE_MAX = 160
export const RESOURCE_DESC_MAX = 600
export const VERIFICATION_DECISION_NOTE_MAX = 1000

/** Anti-spam caps per rolling 24 h window. */
export const RATE_LIMITS = {
  ORGS_PER_DAY: 3,
  INVITES_PER_DAY_PER_ORG: 30,
  INVITE_ACCEPTS_PER_DAY: 10,
  GROUPS_PER_DAY: 10,
  ASSIGNMENTS_PER_DAY: 20,
  SUBMISSION_EDITS_PER_DAY: 30,
} as const

// ─── Slug helpers (pure) ─────────────────────────────────────────────────────

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, ORG_SLUG_MAX)
  return base.length >= 3 ? base : `org-${base}`
}

export function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

// ─── Membership authorization (DB-backed guards) ─────────────────────────────

export interface MembershipGuardFailure {
  ok: false
  status: 401 | 403 | 404
  error: string
}

export interface ActiveMembership {
  ok: true
  membership: { id: string; organizationId: string; studentId: string; role: string; status: string }
  organization: { id: string; name: string; displayName: string | null; orgType: string; verificationStatus: string; isActive: boolean; slug: string }
}

/** Require an ACTIVE membership (any role) in the organization. */
export async function requireActiveMembership(
  studentId: string,
  organizationId: string,
): Promise<ActiveMembership | MembershipGuardFailure> {
  const membership = await db.organizationMembership.findUnique({
    where: { organizationId_studentId: { organizationId, studentId } },
    include: { organization: { select: { id: true, name: true, displayName: true, orgType: true, verificationStatus: true, isActive: true, slug: true } } },
  })
  if (!membership) return { ok: false, status: 403, error: 'You are not a member of this organization.' }
  if (membership.status !== ORG_MEMBERSHIP_STATUS.ACTIVE) {
    return { ok: false, status: 403, error: 'Your membership in this organization is not active.' }
  }
  return { ok: true, membership, organization: membership.organization }
}

/** Require an ACTIVE membership holding one of the allowed roles. */
export async function requireOrgRole(
  studentId: string,
  organizationId: string,
  allowedRoles: readonly string[],
): Promise<ActiveMembership | MembershipGuardFailure> {
  const result = await requireActiveMembership(studentId, organizationId)
  if (!result.ok) return result
  if (!(allowedRoles as readonly string[]).includes(result.membership.role)) {
    return { ok: false, status: 403, error: 'Your organization role does not permit this action.' }
  }
  return result
}

export async function requireOrgAdmin(
  studentId: string,
  organizationId: string,
): Promise<ActiveMembership | MembershipGuardFailure> {
  return requireOrgRole(studentId, organizationId, ORG_ADMIN_ROLES)
}

export async function requireOrgInstructor(
  studentId: string,
  organizationId: string,
): Promise<ActiveMembership | MembershipGuardFailure> {
  return requireOrgRole(studentId, organizationId, ORG_INSTRUCTOR_ROLES)
}

// ─── Private-class eligibility (pure — reused by book/live-token/start) ──────

export interface PrivateClassAccessInput {
  /** The class row (audience/organizationId/organizationGroupId) or null. */
  classSession: { audience: string | null; organizationId: string | null; organizationGroupId: string | null } | null
  /** The caller's membership in the owning organization, or null. */
  membership: { role: string; status: string } | null
  /** The caller's enrollment in the owning group, or null. */
  groupEnrollment: { enrollmentState: string } | null
}

export type PrivateClassAccess =
  | { ok: true }
  | { ok: false; status: 403; error: string }

/**
 * Pure: may this caller see/book/join this class?
 * PUBLIC classes pass trivially; ORGANIZATION classes need an ACTIVE
 * membership; GROUP classes additionally need an ACTIVE enrollment in the
 * owning group. SUSPENDED/LEFT states never grant new access.
 */
export function evaluatePrivateClassAccess(input: PrivateClassAccessInput): PrivateClassAccess {
  const { classSession, membership, groupEnrollment } = input
  if (!classSession) return { ok: false, status: 403, error: 'Class not found.' }
  const audience = classSession.audience ?? ORG_AUDIENCE.PUBLIC
  if (audience === ORG_AUDIENCE.PUBLIC) return { ok: true }
  if (!membership || membership.status !== ORG_MEMBERSHIP_STATUS.ACTIVE) {
    return { ok: false, status: 403, error: 'This class is restricted to active members of its institution.' }
  }
  if (audience === ORG_AUDIENCE.ORGANIZATION) return { ok: true }
  if (!groupEnrollment || groupEnrollment.enrollmentState !== GROUP_ENROLLMENT_STATE.ACTIVE) {
    return { ok: false, status: 403, error: 'This class is restricted to enrolled members of its group.' }
  }
  return { ok: true }
}

// ─── Organization verification state machine (pure transitions) ──────────────

export interface VerificationDecision {
  action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE'
}

/**
 * Pure: is `from -> to` a legal verification transition? The state machine is
 * DRAFT → PENDING_REVIEW → APPROVED | REJECTED; APPROVED ⇄ SUSPENDED;
 * REJECTED → PENDING_REVIEW (reapplication). Every admin transition is audited.
 */
export function isLegalVerificationTransition(from: string, to: string): boolean {
  switch (to) {
    case ORG_VERIFICATION_STATUS.PENDING_REVIEW:
      return from === ORG_VERIFICATION_STATUS.DRAFT || from === ORG_VERIFICATION_STATUS.REJECTED
    case ORG_VERIFICATION_STATUS.APPROVED:
      return from === ORG_VERIFICATION_STATUS.PENDING_REVIEW
    case ORG_VERIFICATION_STATUS.REJECTED:
      return from === ORG_VERIFICATION_STATUS.PENDING_REVIEW
    case ORG_VERIFICATION_STATUS.SUSPENDED:
      return from === ORG_VERIFICATION_STATUS.APPROVED
    default:
      return false
  }
}

/** Only APPROVED + active organizations may run institution functions. */
export function isOperationalOrg(org: { verificationStatus: string; isActive: boolean }): boolean {
  return org.verificationStatus === ORG_VERIFICATION_STATUS.APPROVED && org.isActive
}

/** Employer organizations may publish opportunities only when approved. */
export function isApprovedEmployerOrg(org: { orgType: string; verificationStatus: string; isActive: boolean }): boolean {
  return org.orgType === 'EMPLOYER' && isOperationalOrg(org)
}

// ─── Organization audit helper (append-only — inside the state-change tx) ────

export function appendOrgAudit(
  tx: { organizationAuditEvent: { create: (args: { data: { organizationId: string; entityType: string; entityId: string; actorId?: string | null; actorRole?: string | null; action: string; detail?: string | null } }) => Promise<unknown> } },
  input: { organizationId: string; entityType: string; entityId: string; actorId?: string | null; actorRole?: string | null; action: string; detail?: string | null },
): Promise<unknown> {
  return tx.organizationAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      detail: input.detail ?? null,
    },
  })
}

// ─── Invitation token helpers ────────────────────────────────────────────────
// The raw token is returned ONCE to the admin creating the invitation and is
// never stored or logged; only its SHA-256 hash is persisted.

export function newInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url')
}

export function hashInvitationToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Pure: is an invitation row currently redeemable? */
export function isInvitationRedeemable(
  invitation: { revokedAt: Date | null; expiresAt: Date; useCount: number; maxUses: number | null },
  now: Date,
): { ok: true } | { ok: false; error: string } {
  if (invitation.revokedAt) return { ok: false, error: 'This invitation was revoked.' }
  if (invitation.expiresAt.getTime() <= now.getTime()) return { ok: false, error: 'This invitation has expired.' }
  if (invitation.maxUses !== null && invitation.useCount >= invitation.maxUses) {
    return { ok: false, error: 'This invitation has reached its usage limit.' }
  }
  return { ok: true }
}

/** Pure: can this intended role be granted through an invitation? */
export function isInvitableRole(role: string): boolean {
  return (INVITABLE_ROLES as readonly string[]).includes(role)
}

// ─── Last-owner protection (pure) ────────────────────────────────────────────

/**
 * Pure: may `actingRole` perform `action` on `targetRole` without orphaning
 * the organization? Owners cannot be managed by non-owners; the last active
 * owner can never be removed, suspended or demoted.
 */
export function evaluateMemberAction(
  actingRole: string,
  targetRole: string,
  action: 'APPOINT_ADMIN' | 'SET_ROLE' | 'SUSPEND' | 'REINSTATE' | 'REMOVE' | 'APPROVE_OWNER',
  targetActiveOwners: number,
): { ok: true } | { ok: false; error: string } {
  if (targetRole === 'OWNER' && actingRole !== 'OWNER') {
    return { ok: false, error: 'Only an organization owner can manage another owner.' }
  }
  if ((action === 'SUSPEND' || action === 'REMOVE' || action === 'SET_ROLE') && targetRole === 'OWNER' && targetActiveOwners <= 1) {
    return { ok: false, error: 'The last active owner cannot be removed or demoted.' }
  }
  if (action === 'SET_ROLE' && targetRole === 'OWNER') {
    return { ok: false, error: 'Ownership is transferred by BEAN administrators, not by role edits.' }
  }
  return { ok: true }
}

// ─── Rate limiting (durable, stateless — 24 h rolling window) ────────────────

export async function countRecentOrg(
  kind: 'org' | 'invite' | 'inviteAccept' | 'group' | 'assignment' | 'submissionEdit',
  studentId: string,
  organizationId: string | null,
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - 24 * 3600_000)
  switch (kind) {
    case 'org':
      return db.organization.count({ where: { memberships: { some: { studentId } }, createdAt: { gt: since } } })
    case 'invite':
      return db.organizationInvitation.count({
        where: { organizationId: organizationId ?? '', createdAt: { gt: since } },
      })
    case 'inviteAccept':
      return db.organizationMembership.count({
        where: { studentId, activatedAt: { gt: since }, status: ORG_MEMBERSHIP_STATUS.ACTIVE },
      })
    case 'group':
      return db.organizationGroup.count({
        where: { organizationId: organizationId ?? '', createdAt: { gt: since } },
      })
    case 'assignment':
      return db.organizationAssignment.count({
        where: { organizationId: organizationId ?? '', createdAt: { gt: since } },
      })
    case 'submissionEdit':
      return db.assignmentSubmission.count({
        where: { studentId, updatedAt: { gt: since }, status: { not: SUBMISSION_STATUS.DRAFT } },
      })
  }
}

export function orgRateLimited(kind: keyof typeof RATE_LIMITS, count: number): boolean {
  return count >= RATE_LIMITS[kind]
}
