// ─── BEAN Phase 7 UI: centralized organization capability evaluator ──────────
// Pure, client-safe mirror of the server guards in src/lib/institution.ts:
// NO database import, no server-only code — the role sets are redefined
// locally so client bundles never pull in the Prisma-backed institution
// module. The UI MUST call this evaluator (never ad-hoc role string checks)
// so that capability gating stays consistent across every workspace screen.
//
// IMPORTANT: these capabilities only hide or disable UI affordances. A hidden
// button is NOT a substitute for server security — every API route
// independently re-checks the same rules server-side against the httpOnly
// session identity (see src/lib/institution.ts). Client capabilities exist
// purely so the workspace UI and the server never disagree about what a
// member may do.

export type OrgRole =
  | 'OWNER'
  | 'ADMIN'
  | 'INSTRUCTOR'
  | 'STAFF'
  | 'LEARNER'
  | 'CAREER_COORDINATOR'
  | 'RECRUITER'

export type OrgMembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'LEFT'

export type OrgVerificationStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'

/** Mirror of ORG_ADMIN_ROLES in src/lib/institution.ts. */
const ADMIN_ROLES: readonly string[] = ['OWNER', 'ADMIN'] as const

/** Mirror of ORG_INSTRUCTOR_ROLES in src/lib/institution.ts. */
const INSTRUCTOR_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'INSTRUCTOR'] as const

/** Mirror of ORG_EMPLOYER_ROLES in src/lib/institution.ts. */
const EMPLOYER_ROLES: readonly string[] = ['OWNER', 'ADMIN', 'RECRUITER', 'CAREER_COORDINATOR'] as const

export function isAdminRole(role: string): boolean {
  return ADMIN_ROLES.includes(role)
}

export function isInstructorRole(role: string): boolean {
  return INSTRUCTOR_ROLES.includes(role)
}

export function isEmployerRole(role: string): boolean {
  return EMPLOYER_ROLES.includes(role)
}

export interface OrgCapabilityInput {
  role: OrgRole
  membershipStatus: OrgMembershipStatus
  verificationStatus?: OrgVerificationStatus
  organizationActive?: boolean
}

export interface OrgCapabilities {
  canViewWorkspace: boolean
  canManageMembers: boolean
  canInviteMembers: boolean
  canManageOrganizationProfile: boolean
  canSubmitVerification: boolean
  canCreateGroups: boolean
  canEnrollGroupMembers: boolean
  canEditGroups: boolean
  canArchiveGroups: boolean
  canViewGroupRosters: boolean
  canCreateAssignments: boolean
  canPublishAssignments: boolean
  canCloseAssignments: boolean
  canArchiveAssignments: boolean
  canGradeSubmissions: boolean
  canShareResources: boolean
  canModerateResources: boolean
  canPublishAnnouncements: boolean
  canModerateAnnouncements: boolean
  canIssueCredentials: boolean
  canManageClasses: boolean
  canViewOperationalMetrics: boolean
  canUseEmployerTools: boolean
}

/**
 * Pure: which workspace affordances should the UI show for this member?
 * Defaults mirror the server: an omitted verificationStatus/organizationActive
 * is treated as an APPROVED + active organization. Operational gates
 * (group/assignment/credential work) require APPROVED + active like
 * isOperationalOrg; membership lifecycle powers (grading, classes, moderation)
 * only require an ACTIVE membership, exactly like the route guards.
 */
export function evaluateOrgCapabilities(input: OrgCapabilityInput): OrgCapabilities {
  const active = input.membershipStatus === 'ACTIVE'
  const admin = active && isAdminRole(input.role)
  const staff = active && isInstructorRole(input.role)
  const employer = active && isEmployerRole(input.role)
  const operational =
    (input.verificationStatus ?? 'APPROVED') === 'APPROVED' && (input.organizationActive ?? true)
  const groupManager = staff && operational
  return {
    canViewWorkspace: active,
    canManageMembers: admin,
    canInviteMembers: admin && operational,
    canManageOrganizationProfile: admin,
    canSubmitVerification: admin,
    canCreateGroups: groupManager,
    canEnrollGroupMembers: groupManager,
    canEditGroups: groupManager,
    canArchiveGroups: groupManager,
    canViewGroupRosters: active,
    canCreateAssignments: groupManager,
    canPublishAssignments: groupManager,
    canCloseAssignments: groupManager,
    canArchiveAssignments: groupManager,
    canGradeSubmissions: staff,
    canShareResources: groupManager,
    canModerateResources: admin,
    canPublishAnnouncements: groupManager,
    canModerateAnnouncements: admin,
    canIssueCredentials: groupManager,
    canManageClasses: staff,
    canViewOperationalMetrics: active,
    canUseEmployerTools: employer,
  }
}
