// ─── Phase 7: Institution UI route tests (invitation / group / assignment /
// credential mutations) ───────────────────────────────────────────────────────
// Route-level coverage for the Phase 7 workspace mutations added for the
// institution UI, using the same fake-db pattern as phase7-org-access.test.ts:
//   • Invitation revoke: admin ok (200 + audited), already-revoked 409,
//     non-admin 403, accepted invitation 409.
//   • Assignment PATCH: DRAFT→PUBLISHED ok (+audit), illegal transition 409,
//     non-instructor 403, invalid body 400.
//   • Group PATCH: field update ok, archive ok (+audit), invalid status 400.
//   • Credential revoke: issuer-staff ok, already-revoked 409, wrong org 403,
//     short reason 400.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  orgs: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  invitations: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  groupEnrollments: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  credentials: [] as Record<string, unknown>[],
  orgAudit: [] as Record<string, unknown>[],
  careerAudit: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.orgs = [org1Row]
  state.memberships = [
    { id: 'm-owner', organizationId: 'org1', studentId: 'owner-1', role: 'OWNER', status: 'ACTIVE', createdAt: new Date() },
    { id: 'm-inst', organizationId: 'org1', studentId: 'inst-1', role: 'INSTRUCTOR', status: 'ACTIVE', createdAt: new Date() },
    { id: 'm-learn', organizationId: 'org1', studentId: 'learn-1', role: 'LEARNER', status: 'ACTIVE', createdAt: new Date() },
  ]
  state.invitations = []
  state.groups = []
  state.groupEnrollments = []
  state.assignments = []
  state.credentials = []
  state.orgAudit = []
  state.careerAudit = []
}

const org1Row = {
  id: 'org1', name: 'Test Institution', displayName: 'Test Institution', orgType: 'SCHOOL',
  verificationStatus: 'APPROVED', isActive: true, slug: 'test-institution', createdAt: new Date(),
}

const orgForGuard = {
  id: 'org1', name: 'Test Institution', displayName: 'Test Institution', orgType: 'SCHOOL',
  verificationStatus: 'APPROVED', isActive: true, slug: 'test-institution',
}

function seedInvitation(extra: Record<string, unknown> = {}) {
  const row = {
    id: 'inv-1', organizationId: 'org1', email: null, intendedRole: 'LEARNER', tokenHash: 'deadbeef',
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000), maxUses: null, useCount: 0,
    acceptedAt: null, revokedAt: null, createdAt: new Date(), ...extra,
  }
  state.invitations.push(row)
  return row
}

function seedGroup(extra: Record<string, unknown> = {}) {
  const row = {
    id: 'g1', organizationId: 'org1', name: 'Batch A', academicYear: null, programmeLabel: null,
    batchLabel: null, sectionLabel: null, trackLabel: null, startsAt: null, endsAt: null,
    capacity: null, status: 'ACTIVE', createdAt: new Date(), ...extra,
  }
  state.groups.push(row)
  return row
}

function seedAssignment(extra: Record<string, unknown> = {}) {
  const row = {
    id: 'as-1', organizationId: 'org1', groupId: 'g1', createdByMembershipId: 'm-inst',
    title: 'Week 1 worksheet', instructions: null, subjectLabel: null, submissionType: 'TEXT_AND_LINK',
    status: 'DRAFT', publishedAt: null, dueAt: null, maxScore: 10, createdAt: new Date(), ...extra,
  }
  state.assignments.push(row)
  return row
}

function seedCredential(extra: Record<string, unknown> = {}) {
  const row = {
    id: 'cred-1', studentId: 'learn-1', issuerOrganizationId: 'org1', credentialName: 'Certificate of Merit',
    credentialDescription: null, issuedDate: new Date(), expiryDate: null, credentialReference: null,
    status: 'ISSUED', issuedByMembershipId: 'm-inst', portfolioShared: false,
    verifiedAt: new Date(), revokedAt: null, revokedByMembershipId: null, createdAt: new Date(), ...extra,
  }
  state.credentials.push(row)
  return row
}

const fakeDb = {
  organization: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.orgs.find(o => o.id === where.id) ?? null,
  },
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId?: { organizationId: string; studentId: string }; id?: string } }) => {
      if (where.organizationId_studentId) {
        const m = state.memberships.find(
          m => m.organizationId === where.organizationId_studentId!.organizationId && m.studentId === where.organizationId_studentId!.studentId,
        )
        return m ? { ...m, organization: orgForGuard } : null
      }
      return state.memberships.find(m => m.id === where.id) ?? null
    },
  },
  organizationInvitation: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.invitations.find(i => i.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      // Prisma returns a fresh row (never mutates the found object in place).
      const idx = state.invitations.findIndex(i => i.id === where.id)
      const updated = { ...state.invitations[idx], ...data }
      state.invitations[idx] = updated
      return updated
    },
  },
  organizationGroup: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.groups.find(g => g.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const idx = state.groups.findIndex(g => g.id === where.id)
      const updated = { ...state.groups[idx], ...data }
      state.groups[idx] = updated
      return updated
    },
  },
  organizationGroupMembership: {
    count: async ({ where }: { where: { groupId: string; enrollmentState: string } }) =>
      state.groupEnrollments.filter(e => e.groupId === where.groupId && e.enrollmentState === where.enrollmentState).length,
  },
  organizationAssignment: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.assignments.find(a => a.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const idx = state.assignments.findIndex(a => a.id === where.id)
      const updated = { ...state.assignments[idx], ...data }
      state.assignments[idx] = updated
      return updated
    },
  },
  careerCredential: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.credentials.find(c => c.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const idx = state.credentials.findIndex(c => c.id === where.id)
      const updated = { ...state.credentials[idx], ...data }
      state.credentials[idx] = updated
      return updated
    },
  },
  organizationAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.orgAudit.push(data)
      return { id: `audit-${state.orgAudit.length}`, ...data }
    },
  },
  careerAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.careerAudit.push(data)
      return { id: `caudit-${state.careerAudit.length}`, ...data }
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const revokeInvitationRoute = await import('@/app/api/organizations/[id]/invitations/[invitationId]/revoke/route')
const groupRoute = await import('@/app/api/organizations/[id]/groups/[groupId]/route')
const assignmentRoute = await import('@/app/api/organizations/assignments/[assignmentId]/route')
const credentialRevokeRoute = await import('@/app/api/career/credentials/[credentialId]/revoke/route')

function req(path: string, method = 'POST', body?: unknown): NextRequest {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const ownerSession = { id: 'owner-1', email: 'o@bean.test', role: 'STUDENT' }
const instructorSession = { id: 'inst-1', email: 'i@bean.test', role: 'STUDENT' }
const learnerSession = { id: 'learn-1', email: 'l@bean.test', role: 'STUDENT' }

// ─── Invitation revoke ────────────────────────────────────────────────────────

describe('POST /api/organizations/:id/invitations/:invitationId/revoke', () => {
  beforeEach(resetState)

  it('an org admin revokes a pending invitation (200, audited, link dead)', async () => {
    state.student = ownerSession
    seedInvitation()
    const res = await revokeInvitationRoute.POST(
      req('/api/organizations/org1/invitations/inv-1/revoke'),
      { params: Promise.resolve({ id: 'org1', invitationId: 'inv-1' }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(state.invitations[0].revokedAt).not.toBeNull()
    expect(state.orgAudit.some(a => a.action === 'INVITATION_REVOKED')).toBe(true)
  })

  it('an already-revoked invitation cannot be revoked again (409)', async () => {
    state.student = ownerSession
    seedInvitation({ revokedAt: new Date() })
    const res = await revokeInvitationRoute.POST(
      req('/api/organizations/org1/invitations/inv-1/revoke'),
      { params: Promise.resolve({ id: 'org1', invitationId: 'inv-1' }) },
    )
    expect(res.status).toBe(409)
  })

  it('an accepted invitation cannot be revoked (409) — remove the membership instead', async () => {
    state.student = ownerSession
    seedInvitation({ acceptedAt: new Date() })
    const res = await revokeInvitationRoute.POST(
      req('/api/organizations/org1/invitations/inv-1/revoke'),
      { params: Promise.resolve({ id: 'org1', invitationId: 'inv-1' }) },
    )
    expect(res.status).toBe(409)
  })

  it('a non-admin (instructor) cannot revoke invitations (403)', async () => {
    state.student = instructorSession
    seedInvitation()
    const res = await revokeInvitationRoute.POST(
      req('/api/organizations/org1/invitations/inv-1/revoke'),
      { params: Promise.resolve({ id: 'org1', invitationId: 'inv-1' }) },
    )
    expect(res.status).toBe(403)
    expect(state.invitations[0].revokedAt).toBeNull()
  })

  it('an invitation of another organization is 404 (never leaked)', async () => {
    state.student = ownerSession
    seedInvitation({ organizationId: 'org-other' })
    const res = await revokeInvitationRoute.POST(
      req('/api/organizations/org1/invitations/inv-1/revoke'),
      { params: Promise.resolve({ id: 'org1', invitationId: 'inv-1' }) },
    )
    expect(res.status).toBe(404)
  })
})

// ─── Assignment PATCH ─────────────────────────────────────────────────────────

describe('PATCH /api/organizations/assignments/:assignmentId', () => {
  beforeEach(resetState)

  it('an instructor publishes a DRAFT assignment (200, publishedAt set, audited)', async () => {
    state.student = instructorSession
    seedAssignment()
    const res = await assignmentRoute.PATCH(
      req('/api/organizations/assignments/as-1', 'PATCH', { status: 'PUBLISHED' }),
      { params: Promise.resolve({ assignmentId: 'as-1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assignment.status).toBe('PUBLISHED')
    expect(body.assignment.groupId).toBe('g1')
    expect(state.assignments[0].publishedAt).not.toBeNull()
    expect(state.orgAudit.some(a => a.action === 'ASSIGNMENT_PUBLISHED')).toBe(true)
  })

  it('an illegal transition is rejected with 409 (DRAFT cannot jump to ARCHIVED)', async () => {
    state.student = instructorSession
    seedAssignment()
    const res = await assignmentRoute.PATCH(
      req('/api/organizations/assignments/as-1', 'PATCH', { status: 'ARCHIVED' }),
      { params: Promise.resolve({ assignmentId: 'as-1' }) },
    )
    expect(res.status).toBe(409)
    expect(state.assignments[0].status).toBe('DRAFT')
  })

  it('a non-instructor (learner) cannot update an assignment (403)', async () => {
    state.student = learnerSession
    seedAssignment()
    const res = await assignmentRoute.PATCH(
      req('/api/organizations/assignments/as-1', 'PATCH', { status: 'PUBLISHED' }),
      { params: Promise.resolve({ assignmentId: 'as-1' }) },
    )
    expect(res.status).toBe(403)
    expect(state.assignments[0].status).toBe('DRAFT')
  })

  it('an invalid body is rejected with 400', async () => {
    state.student = instructorSession
    seedAssignment()
    const res = await assignmentRoute.PATCH(
      req('/api/organizations/assignments/as-1', 'PATCH', { status: 'NOT_A_STATUS' }),
      { params: Promise.resolve({ assignmentId: 'as-1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('field edits work on a DRAFT (title + maxScore persist)', async () => {
    state.student = instructorSession
    seedAssignment()
    const res = await assignmentRoute.PATCH(
      req('/api/organizations/assignments/as-1', 'PATCH', { title: 'Week 1 — algebra worksheet', maxScore: 20 }),
      { params: Promise.resolve({ assignmentId: 'as-1' }) },
    )
    expect(res.status).toBe(200)
    expect(state.assignments[0].title).toBe('Week 1 — algebra worksheet')
    expect(state.assignments[0].maxScore).toBe(20)
  })

  it('a guest is 401', async () => {
    state.student = null
    seedAssignment()
    const res = await assignmentRoute.PATCH(
      req('/api/organizations/assignments/as-1', 'PATCH', { status: 'PUBLISHED' }),
      { params: Promise.resolve({ assignmentId: 'as-1' }) },
    )
    expect(res.status).toBe(401)
  })
})

// ─── Group PATCH ──────────────────────────────────────────────────────────────

describe('PATCH /api/organizations/:id/groups/:groupId', () => {
  beforeEach(resetState)

  it('an instructor updates group fields (200, DTO shape preserved, audited)', async () => {
    state.student = instructorSession
    seedGroup()
    state.groupEnrollments.push({ groupId: 'g1', enrollmentState: 'ACTIVE' })
    const res = await groupRoute.PATCH(
      req('/api/organizations/org1/groups/g1', 'PATCH', { name: 'Batch A — renamed', capacity: 30 }),
      { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.group.name).toBe('Batch A — renamed')
    expect(body.group.capacity).toBe(30)
    expect(body.group.activeEnrollmentCount).toBe(1)
    expect(state.orgAudit.some(a => a.action === 'GROUP_UPDATED')).toBe(true)
  })

  it('an instructor archives a group (200, audited, enrollments untouched)', async () => {
    state.student = instructorSession
    seedGroup()
    state.groupEnrollments.push({ groupId: 'g1', enrollmentState: 'ACTIVE' })
    const res = await groupRoute.PATCH(
      req('/api/organizations/org1/groups/g1', 'PATCH', { status: 'ARCHIVED' }),
      { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).group.status).toBe('ARCHIVED')
    expect(state.orgAudit.some(a => a.action === 'GROUP_ARCHIVED')).toBe(true)
    expect(state.groupEnrollments.length).toBe(1)
  })

  it('an invalid status value is rejected with 400', async () => {
    state.student = instructorSession
    seedGroup()
    const res = await groupRoute.PATCH(
      req('/api/organizations/org1/groups/g1', 'PATCH', { status: 'DELETED' }),
      { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) },
    )
    expect(res.status).toBe(400)
    expect(state.groups[0].status).toBe('ACTIVE')
  })

  it('an end date before the start date is rejected with 400', async () => {
    state.student = instructorSession
    seedGroup()
    const res = await groupRoute.PATCH(
      req('/api/organizations/org1/groups/g1', 'PATCH', {
        startsAt: new Date(Date.now() + 10 * 24 * 3600_000).toISOString(),
        endsAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
      }),
      { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) },
    )
    expect(res.status).toBe(400)
  })

  it('a group of another organization is 404', async () => {
    state.student = instructorSession
    seedGroup({ organizationId: 'org-other' })
    const res = await groupRoute.PATCH(
      req('/api/organizations/org1/groups/g1', 'PATCH', { name: 'Hijack' }),
      { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) },
    )
    expect(res.status).toBe(404)
  })
})

// ─── Credential revoke ────────────────────────────────────────────────────────

describe('POST /api/career/credentials/:credentialId/revoke', () => {
  beforeEach(resetState)

  it('issuer-org staff revoke an ISSUED credential (200, audited in both ledgers)', async () => {
    state.student = instructorSession
    seedCredential()
    const res = await credentialRevokeRoute.POST(
      req('/api/career/credentials/cred-1/revoke', 'POST', { reason: 'Issued in error — duplicate record for the same batch.' }),
      { params: Promise.resolve({ credentialId: 'cred-1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.credential.status).toBe('REVOKED')
    expect(body.credential.revokedAt).toBeTruthy()
    expect(state.credentials[0].status).toBe('REVOKED')
    expect(state.credentials[0].revokedByMembershipId).toBe('m-inst')
    expect(state.orgAudit.some(a => a.action === 'CREDENTIAL_REVOKED')).toBe(true)
    expect(state.careerAudit.some(a => a.action === 'CREDENTIAL_REVOKED')).toBe(true)
  })

  it('an already-revoked credential cannot be revoked again (409)', async () => {
    state.student = instructorSession
    seedCredential({ status: 'REVOKED', revokedAt: new Date(), revokedByMembershipId: 'm-inst' })
    const res = await credentialRevokeRoute.POST(
      req('/api/career/credentials/cred-1/revoke', 'POST', { reason: 'Trying to revoke a second time.' }),
      { params: Promise.resolve({ credentialId: 'cred-1' }) },
    )
    expect(res.status).toBe(409)
  })

  it('staff of a different organization cannot revoke (403)', async () => {
    // learn-1 only holds a membership in org1; the credential was issued by org2.
    state.student = learnerSession
    seedCredential({ issuerOrganizationId: 'org2' })
    const res = await credentialRevokeRoute.POST(
      req('/api/career/credentials/cred-1/revoke', 'POST', { reason: 'Not my organization — should be blocked.' }),
      { params: Promise.resolve({ credentialId: 'cred-1' }) },
    )
    expect(res.status).toBe(403)
    expect(state.credentials[0].status).toBe('ISSUED')
  })

  it('a reason shorter than 10 characters is rejected with 400', async () => {
    state.student = instructorSession
    seedCredential()
    const res = await credentialRevokeRoute.POST(
      req('/api/career/credentials/cred-1/revoke', 'POST', { reason: 'too short' }),
      { params: Promise.resolve({ credentialId: 'cred-1' }) },
    )
    expect(res.status).toBe(400)
    expect(state.credentials[0].status).toBe('ISSUED')
  })

  it('a guest is 401', async () => {
    state.student = null
    seedCredential()
    const res = await credentialRevokeRoute.POST(
      req('/api/career/credentials/cred-1/revoke', 'POST', { reason: 'Whatever reason, long enough.' }),
      { params: Promise.resolve({ credentialId: 'cred-1' }) },
    )
    expect(res.status).toBe(401)
  })
})
