// ─── Phase 7 UI: capability ↔ server-guard role matrix equivalence ───────────
// Proves that the client-safe capability evaluator (src/lib/capabilities.ts)
// EXACTLY mirrors the server authorization constants in
// src/lib/institution.ts for every organization role:
//   • every role the UI enables a capability for IS in the server role set;
//   • every role in the server role set DOES get the UI capability;
//   • operational gating tracks isOperationalOrg across every verification
//     status × active combination;
//   • any non-ACTIVE membership yields ALL-false capabilities.
// '@/lib/db' is mocked before importing institution.ts (which imports it for
// its DB-backed guards); these tests only exercise pure code paths.

import { describe, it, expect, mock } from 'bun:test'

// institution.ts imports { db } from '@/lib/db' — stub it before the import.
const unusedDbStub = {
  organization: {},
  organizationMembership: {},
  organizationGroup: {},
  organizationAuditEvent: {},
}
mock.module('@/lib/db', () => ({ db: unusedDbStub }))

const caps = await import('@/lib/capabilities')
const inst = await import('@/lib/institution')

const ALL_ROLES = ['OWNER', 'ADMIN', 'INSTRUCTOR', 'STAFF', 'LEARNER', 'CAREER_COORDINATOR', 'RECRUITER'] as const

const ALL_CAP_KEYS = [
  'canViewWorkspace',
  'canManageMembers',
  'canInviteMembers',
  'canManageOrganizationProfile',
  'canSubmitVerification',
  'canCreateGroups',
  'canEnrollGroupMembers',
  'canEditGroups',
  'canArchiveGroups',
  'canViewGroupRosters',
  'canCreateAssignments',
  'canPublishAssignments',
  'canCloseAssignments',
  'canArchiveAssignments',
  'canGradeSubmissions',
  'canShareResources',
  'canModerateResources',
  'canPublishAnnouncements',
  'canModerateAnnouncements',
  'canIssueCredentials',
  'canManageClasses',
  'canViewOperationalMetrics',
  'canUseEmployerTools',
] as const

/** Capabilities gated on the server's ORG_ADMIN_ROLES set. */
const ADMIN_GATED_CAPS = [
  'canManageMembers',
  'canManageOrganizationProfile',
  'canSubmitVerification',
  'canModerateResources',
  'canModerateAnnouncements',
] as const

/** Capabilities gated on ORG_INSTRUCTOR_ROLES + operational org. */
const INSTRUCTOR_OPERATIONAL_CAPS = [
  'canCreateGroups',
  'canEnrollGroupMembers',
  'canEditGroups',
  'canArchiveGroups',
  'canCreateAssignments',
  'canPublishAssignments',
  'canCloseAssignments',
  'canArchiveAssignments',
  'canShareResources',
  'canPublishAnnouncements',
  'canIssueCredentials',
] as const

/** Capabilities gated on ORG_INSTRUCTOR_ROLES alone (no operational gate). */
const INSTRUCTOR_PLAIN_CAPS = ['canGradeSubmissions', 'canManageClasses'] as const

/** Capabilities gated on the server's ORG_EMPLOYER_ROLES set. */
const EMPLOYER_GATED_CAPS = ['canUseEmployerTools'] as const

/** Capabilities every ACTIVE member gets regardless of role. */
const MEMBER_CAPS = ['canViewWorkspace', 'canViewGroupRosters', 'canViewOperationalMetrics'] as const

function capsFor(role: string, overrides: Record<string, unknown> = {}): caps.OrgCapabilities {
  return caps.evaluateOrgCapabilities({
    role: role as caps.OrgRole,
    membershipStatus: 'ACTIVE',
    verificationStatus: 'APPROVED',
    organizationActive: true,
    ...overrides,
  } as caps.OrgCapabilityInput)
}

describe('role helper predicates mirror server sets', () => {
  it('isAdminRole === ORG_ADMIN_ROLES membership (both directions)', () => {
    for (const role of ALL_ROLES) {
      expect(caps.isAdminRole(role)).toBe((inst.ORG_ADMIN_ROLES as readonly string[]).includes(role))
    }
  })
  it('isInstructorRole === ORG_INSTRUCTOR_ROLES membership (both directions)', () => {
    for (const role of ALL_ROLES) {
      expect(caps.isInstructorRole(role)).toBe((inst.ORG_INSTRUCTOR_ROLES as readonly string[]).includes(role))
    }
  })
  it('isEmployerRole === ORG_EMPLOYER_ROLES membership (both directions)', () => {
    for (const role of ALL_ROLES) {
      expect(caps.isEmployerRole(role)).toBe((inst.ORG_EMPLOYER_ROLES as readonly string[]).includes(role))
    }
  })
})

describe('capability ↔ server role-set equivalence (operational org, ACTIVE member)', () => {
  it('admin-gated capabilities match ORG_ADMIN_ROLES for every role', () => {
    for (const role of ALL_ROLES) {
      const c = capsFor(role)
      for (const key of ADMIN_GATED_CAPS) {
        expect(`${role}:${key}=${c[key]}`).toBe(`${role}:${key}=${(inst.ORG_ADMIN_ROLES as readonly string[]).includes(role)}`)
      }
    }
  })
  it('instructor-operational capabilities match ORG_INSTRUCTOR_ROLES for every role', () => {
    for (const role of ALL_ROLES) {
      const c = capsFor(role)
      for (const key of INSTRUCTOR_OPERATIONAL_CAPS) {
        expect(`${role}:${key}=${c[key]}`).toBe(`${role}:${key}=${(inst.ORG_INSTRUCTOR_ROLES as readonly string[]).includes(role)}`)
      }
    }
  })
  it('plain instructor capabilities (grading, classes) match ORG_INSTRUCTOR_ROLES for every role', () => {
    for (const role of ALL_ROLES) {
      const c = capsFor(role)
      for (const key of INSTRUCTOR_PLAIN_CAPS) {
        expect(`${role}:${key}=${c[key]}`).toBe(`${role}:${key}=${(inst.ORG_INSTRUCTOR_ROLES as readonly string[]).includes(role)}`)
      }
    }
  })
  it('employer tools match ORG_EMPLOYER_ROLES for every role', () => {
    for (const role of ALL_ROLES) {
      expect(capsFor(role).canUseEmployerTools).toBe((inst.ORG_EMPLOYER_ROLES as readonly string[]).includes(role))
    }
  })
  it('every ACTIVE member gets the member-only capabilities (rosters, metrics, workspace)', () => {
    for (const role of ALL_ROLES) {
      const c = capsFor(role)
      for (const key of MEMBER_CAPS) expect(c[key]).toBe(true)
    }
  })
})

describe('set-direction equivalence for the headline capabilities', () => {
  it('canCreateGroups enabled roles === ORG_INSTRUCTOR_ROLES (both directions)', () => {
    const enabled = ALL_ROLES.filter(r => capsFor(r).canCreateGroups)
    expect([...enabled].sort()).toEqual([...inst.ORG_INSTRUCTOR_ROLES].sort())
  })
  it('canManageMembers enabled roles === ORG_ADMIN_ROLES (both directions)', () => {
    const enabled = ALL_ROLES.filter(r => capsFor(r).canManageMembers)
    expect([...enabled].sort()).toEqual([...inst.ORG_ADMIN_ROLES].sort())
  })
  it('canUseEmployerTools enabled roles === ORG_EMPLOYER_ROLES (both directions)', () => {
    const enabled = ALL_ROLES.filter(r => capsFor(r).canUseEmployerTools)
    expect([...enabled].sort()).toEqual([...inst.ORG_EMPLOYER_ROLES].sort())
  })
  it('canGradeSubmissions enabled roles === ORG_INSTRUCTOR_ROLES (both directions)', () => {
    const enabled = ALL_ROLES.filter(r => capsFor(r).canGradeSubmissions)
    expect([...enabled].sort()).toEqual([...inst.ORG_INSTRUCTOR_ROLES].sort())
  })
})

describe('invitation-grantable roles never hold admin capabilities', () => {
  it('every INVITABLE_ROLES member is excluded from admin-gated capabilities', () => {
    expect((inst.INVITABLE_ROLES as readonly string[]).some(r => (inst.ORG_ADMIN_ROLES as readonly string[]).includes(r))).toBe(false)
    for (const role of inst.INVITABLE_ROLES) {
      const c = capsFor(role)
      for (const key of ADMIN_GATED_CAPS) expect(c[key]).toBe(false)
      expect(c.canInviteMembers).toBe(false)
    }
  })
})

describe('operational gating matches isOperationalOrg exactly', () => {
  const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const
  it('INSTRUCTOR: each operational capability === isOperationalOrg across 5 statuses × active true/false', () => {
    for (const verificationStatus of STATUSES) {
      for (const organizationActive of [true, false]) {
        const c = capsFor('INSTRUCTOR', { verificationStatus, organizationActive })
        const operational = inst.isOperationalOrg({ verificationStatus, isActive: organizationActive })
        for (const key of INSTRUCTOR_OPERATIONAL_CAPS) expect(c[key]).toBe(operational)
        // Non-operational gates stay driven by role alone.
        expect(c.canGradeSubmissions).toBe(true)
        expect(c.canManageClasses).toBe(true)
        expect(c.canViewWorkspace).toBe(true)
      }
    }
  })
  it('ADMIN: canInviteMembers === operational (admin role + org gate), moderation stays role-only', () => {
    for (const verificationStatus of STATUSES) {
      for (const organizationActive of [true, false]) {
        const c = capsFor('ADMIN', { verificationStatus, organizationActive })
        const operational = inst.isOperationalOrg({ verificationStatus, isActive: organizationActive })
        expect(c.canInviteMembers).toBe(operational)
        expect(c.canManageMembers).toBe(true)
        expect(c.canModerateResources).toBe(true)
        expect(c.canModerateAnnouncements).toBe(true)
        expect(c.canSubmitVerification).toBe(true)
        expect(c.canCreateGroups).toBe(operational)
      }
    }
  })
  it('omitted verification/active fields default to APPROVED + active like the server defaults', () => {
    const c = caps.evaluateOrgCapabilities({ role: 'INSTRUCTOR', membershipStatus: 'ACTIVE' })
    expect(c.canCreateGroups).toBe(true)
    expect(c.canInviteMembers).toBe(false) // INSTRUCTOR is not an admin
    const owner = caps.evaluateOrgCapabilities({ role: 'OWNER', membershipStatus: 'ACTIVE' })
    expect(owner.canInviteMembers).toBe(true)
  })
})

describe('non-ACTIVE membership yields ALL-false capabilities', () => {
  it('INVITED, SUSPENDED and LEFT members can do nothing in the UI, for every role', () => {
    for (const membershipStatus of ['INVITED', 'SUSPENDED', 'LEFT'] as const) {
      for (const role of ALL_ROLES) {
        const c = caps.evaluateOrgCapabilities({
          role,
          membershipStatus,
          verificationStatus: 'APPROVED',
          organizationActive: true,
        })
        for (const key of ALL_CAP_KEYS) expect(c[key]).toBe(false)
      }
    }
  })
})
