// ─── Phase 7 UI completion: group detail/update, enrollment enforcement, dashboard ───
// Route-level proofs against the REAL handlers (routes imported after mocks):
//   • GET group detail: full roster (ACTIVE + LEFT) with display names only,
//     counts { activeCount, capacity, totalEnrolled }, org-scoped 404s.
//   • PATCH group: instructor-only, operational org only, capacity can never
//     drop below active enrollment, archive/restore transitions audited.
//   • POST enrollments: archived groups reject new enrollments (409).
//   • DELETE enrollments: self-leave unchanged; instructor removal flips the
//     row to LEFT (never deleted) and audits GROUP_MEMBER_REMOVED; learners
//     cannot remove others.
//   • Dashboard: real counts, role echo, isStaff/isAdmin split, recent audit
//     activity with display-name-only actors.
// '@/lib/db' is a hand-rolled in-memory fake; '@/lib/auth' is stubbed to the
// session student — no DATABASE_URL needed.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  students: [] as Record<string, unknown>[],
  organizations: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  enrollments: [] as Record<string, unknown>[],
  auditEvents: [] as Record<string, unknown>[],
  classSessions: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  submissions: [] as Record<string, unknown>[],
  resources: [] as Record<string, unknown>[],
  announcements: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.students = []
  state.organizations = []
  state.memberships = []
  state.groups = []
  state.enrollments = []
  state.auditEvents = []
  state.classSessions = []
  state.assignments = []
  state.submissions = []
  state.resources = []
  state.announcements = []
}

function withStudent(m: Record<string, unknown>): Record<string, unknown> {
  const student = state.students.find(s => s.id === m.studentId)
  return { ...m, student: { displayName: student ? student.displayName : null } }
}

const fakeDb = {
  organization: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.organizations.find(o => o.id === where.id) ?? null,
  },
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId?: { organizationId: string; studentId: string }; id?: string } }) => {
      const row = where.organizationId_studentId
        ? state.memberships.find(m => m.organizationId === where.organizationId_studentId!.organizationId && m.studentId === where.organizationId_studentId!.studentId)
        : state.memberships.find(m => m.id === where.id)
      if (!row) return null
      return { ...withStudent(row), organization: state.organizations.find(o => o.id === row.organizationId) ?? null }
    },
    findMany: async ({ where }: { where: { organizationId?: string; studentId?: { in?: string[] } } }) =>
      state.memberships
        .filter(m =>
          (!where.organizationId || m.organizationId === where.organizationId) &&
          (!where.studentId?.in || where.studentId.in.includes(m.studentId as string)))
        .map(withStudent),
    count: async ({ where }: { where: { organizationId?: string; status?: string } }) =>
      state.memberships.filter(m =>
        (!where.organizationId || m.organizationId === where.organizationId) &&
        (!where.status || m.status === where.status)).length,
  },
  organizationGroup: {
    findUnique: async ({ where }: { where: { id: string } }) => state.groups.find(g => g.id === where.id) ?? null,
    count: async ({ where }: { where: { organizationId?: string; status?: string } }) =>
      state.groups.filter(g =>
        (!where.organizationId || g.organizationId === where.organizationId) &&
        (!where.status || g.status === where.status)).length,
    update: async ({ where, data, include }: { where: { id: string }; data: Record<string, unknown>; include?: Record<string, { select?: { enrollments?: { where?: { enrollmentState?: string } } } }> }) => {
      const g = state.groups.find(x => x.id === where.id) as Record<string, unknown> | undefined
      if (!g) return null
      Object.assign(g, data, { updatedAt: new Date() })
      const enrollWhere = include?._count?.select?.enrollments?.where
      if (enrollWhere) {
        return { ...g, _count: { enrollments: state.enrollments.filter(e => e.groupId === g.id && e.enrollmentState === enrollWhere.enrollmentState).length } }
      }
      return g
    },
  },
  organizationGroupMembership: {
    findUnique: async ({ where }: { where: { groupId_membershipId: { groupId: string; membershipId: string } } }) =>
      state.enrollments.find(e => e.groupId === where.groupId_membershipId.groupId && e.membershipId === where.groupId_membershipId.membershipId) ?? null,
    findMany: async ({ where, orderBy }: { where: { groupId?: string }; orderBy?: { joinedAt?: string } }) => {
      const rows = state.enrollments.filter(e => !where.groupId || e.groupId === where.groupId)
      if (orderBy?.joinedAt === 'asc') {
        rows.sort((a, b) => (a.joinedAt as Date).getTime() - (b.joinedAt as Date).getTime())
      }
      return rows.map(e => ({ ...e, membership: withStudent(state.memberships.find(m => m.id === e.membershipId) ?? { id: e.membershipId }) }))
    },
    count: async ({ where }: { where: { groupId?: string; enrollmentState?: string } }) =>
      state.enrollments.filter(e =>
        (!where.groupId || e.groupId === where.groupId) &&
        (!where.enrollmentState || e.enrollmentState === where.enrollmentState)).length,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const e = state.enrollments.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(e, data)
      return e
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const e = { id: `enr-${state.enrollments.length + 1}`, joinedAt: new Date(), leftAt: null, ...data }
      state.enrollments.push(e)
      return e
    },
  },
  classSession: {
    count: async ({ where }: { where: { organizationId?: string; status?: string; startsAt?: { gt: Date } } }) =>
      state.classSessions.filter(c =>
        (!where.organizationId || c.organizationId === where.organizationId) &&
        (!where.status || c.status === where.status) &&
        (!where.startsAt || (c.startsAt as Date).getTime() > where.startsAt.gt.getTime())).length,
  },
  organizationAssignment: {
    count: async ({ where }: { where: { organizationId?: string; status?: string } }) =>
      state.assignments.filter(a =>
        (!where.organizationId || a.organizationId === where.organizationId) &&
        (!where.status || a.status === where.status)).length,
  },
  assignmentSubmission: {
    count: async ({ where }: { where: { assignment?: { organizationId?: string }; status?: string } }) => {
      const assignmentIds = new Set(
        state.assignments
          .filter(a => !where.assignment?.organizationId || a.organizationId === where.assignment!.organizationId)
          .map(a => a.id as string),
      )
      return state.submissions.filter(s =>
        (!where.assignment?.organizationId || assignmentIds.has(s.assignmentId as string)) &&
        (!where.status || s.status === where.status)).length
    },
  },
  organizationResource: {
    count: async ({ where }: { where: { organizationId?: string } }) =>
      state.resources.filter(r => !where.organizationId || r.organizationId === where.organizationId).length,
  },
  organizationAnnouncement: {
    count: async ({ where }: { where: { organizationId?: string; status?: string; OR?: Record<string, unknown>[] } }) =>
      state.announcements.filter(a => {
        if (where.organizationId && a.organizationId !== where.organizationId) return false
        if (where.status && a.status !== where.status) return false
        if (where.OR) {
          const exp = a.expiresAt as Date | null
          const matches = where.OR.some(branch => {
            const b = branch as { expiresAt?: unknown }
            if (b.expiresAt === null) return exp === null
            if (b.expiresAt && typeof b.expiresAt === 'object' && 'gt' in (b.expiresAt as object)) {
              const gt = (b.expiresAt as { gt: Date }).gt
              return exp !== null && exp.getTime() > gt.getTime()
            }
            return false
          })
          if (!matches) return false
        }
        return true
      }).length,
  },
  organizationAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const e = { id: `audit-${state.auditEvents.length + 1}`, createdAt: new Date(), ...data }
      state.auditEvents.push(e)
      return e
    },
    findMany: async ({ where, orderBy, take }: { where: { organizationId?: string }; orderBy?: { createdAt?: string }; take?: number }) => {
      const rows = state.auditEvents.filter(e => !where.organizationId || e.organizationId === where.organizationId)
      if (orderBy?.createdAt === 'desc') {
        rows.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
      }
      return take ? rows.slice(0, take) : rows
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

const dashboardRoute = await import('@/app/api/organizations/[id]/dashboard/route')
const groupDetailRoute = await import('@/app/api/organizations/[id]/groups/[groupId]/route')
const enrollmentsRoute = await import('@/app/api/organizations/[id]/groups/[groupId]/enrollments/route')

function req(path: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as unknown as NextRequest
}

// ─── Seed helpers ───

function seedStudents() {
  state.students.push(
    { id: 'student-owner', email: 'owner@bean.test', displayName: 'Owa Owner', role: 'STUDENT' },
    { id: 'student-staff', email: 'staff@bean.test', displayName: 'Ina Instructor', role: 'STUDENT' },
    { id: 'student-learner', email: 'learner@bean.test', displayName: 'Lea Learner', role: 'STUDENT' },
    { id: 'student-invited', email: 'invited@bean.test', displayName: 'Ivy Invited', role: 'STUDENT' },
  )
}

function seedOrg(overrides: Record<string, unknown> = {}) {
  state.organizations.push({
    id: 'org1', name: 'org-one', displayName: 'Org One', orgType: 'COLLEGE', description: null,
    website: null, publicContact: null, country: null, state: null, city: null, slug: 'org-one',
    logoText: null, verificationStatus: 'APPROVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  })
}

function seedMembership(id: string, studentId: string, role: string, status: string, organizationId = 'org1') {
  state.memberships.push({ id, organizationId, studentId, role, status, createdAt: new Date(), updatedAt: new Date() })
}

function seedGroup(id: string, overrides: Record<string, unknown> = {}) {
  state.groups.push({
    id, organizationId: 'org1', name: `Group ${id}`, academicYear: '2025', programmeLabel: null,
    batchLabel: null, sectionLabel: null, trackLabel: null, startsAt: null, endsAt: null,
    capacity: 30, status: 'ACTIVE', createdByMembershipId: 'mem-owner', createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  })
}

function seedEnrollment(id: string, groupId: string, membershipId: string, enrollmentState: string, joinedAt: Date) {
  state.enrollments.push({ id, groupId, membershipId, enrollmentState, joinedAt, leftAt: null })
}

function seedStandardOrg() {
  seedStudents()
  seedOrg()
  seedMembership('mem-owner', 'student-owner', 'OWNER', 'ACTIVE')
  seedMembership('mem-staff', 'student-staff', 'INSTRUCTOR', 'ACTIVE')
  seedMembership('mem-learner', 'student-learner', 'LEARNER', 'ACTIVE')
}

const instructorSession = { id: 'student-staff', email: 'staff@bean.test', role: 'STUDENT' }
const learnerSession = { id: 'student-learner', email: 'learner@bean.test', role: 'STUDENT' }
const invitedSession = { id: 'student-invited', email: 'invited@bean.test', role: 'STUDENT' }

// ─── Group detail (GET) ───

describe('GET /api/organizations/[id]/groups/[groupId]', () => {
  beforeEach(resetState)

  it('an active member sees the full roster (ACTIVE + LEFT) with display names and counts', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedGroup('g1')
    seedEnrollment('e1', 'g1', 'mem-owner', 'ACTIVE', new Date('2025-01-01T00:00:00Z'))
    seedEnrollment('e2', 'g1', 'mem-staff', 'ACTIVE', new Date('2025-01-02T00:00:00Z'))
    seedEnrollment('e3', 'g1', 'mem-learner', 'LEFT', new Date('2025-01-03T00:00:00Z'))

    const res = await groupDetailRoute.GET(req('/api/organizations/org1/groups/g1'), {
      params: Promise.resolve({ id: 'org1', groupId: 'g1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.group.id).toBe('g1')
    expect(body.roster).toHaveLength(3)
    expect(body.roster.map((r: { member: { displayName: string } }) => r.member.displayName).sort())
      .toEqual(['Ina Instructor', 'Lea Learner', 'Owa Owner'])
    expect(body.roster.filter((r: { enrollmentState: string }) => r.enrollmentState === 'ACTIVE')).toHaveLength(2)
    expect(body.roster.some((r: { enrollmentState: string }) => r.enrollmentState === 'LEFT')).toBe(true)
    expect(typeof body.roster[0].joinedAt).toBe('string')
    expect(body.counts).toEqual({ activeCount: 2, capacity: 30, totalEnrolled: 3 })
    // Privacy: display names only — never emails.
    expect(JSON.stringify(body)).not.toContain('@')
  })

  it('a non-member of the organization gets 403', async () => {
    state.student = { id: 'student-outsider', email: 'out@bean.test', role: 'STUDENT' }
    seedStudents()
    seedOrg()
    seedGroup('g1')
    const res = await groupDetailRoute.GET(req('/api/organizations/org1/groups/g1'), {
      params: Promise.resolve({ id: 'org1', groupId: 'g1' }),
    })
    expect(res.status).toBe(403)
  })

  it('a group belonging to another organization is 404 (never leaks across orgs)', async () => {
    state.student = learnerSession
    seedStandardOrg()
    state.organizations.push({
      id: 'org2', name: 'org-two', displayName: 'Org Two', orgType: 'SCHOOL', description: null,
      website: null, publicContact: null, country: null, state: null, city: null, slug: 'org-two',
      logoText: null, verificationStatus: 'APPROVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
    })
    seedGroup('g-foreign', { organizationId: 'org2' })
    const res = await groupDetailRoute.GET(req('/api/organizations/org1/groups/g-foreign'), {
      params: Promise.resolve({ id: 'org1', groupId: 'g-foreign' }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Group not found')
  })
})

// ─── Group update (PATCH) ───

describe('PATCH /api/organizations/[id]/groups/[groupId]', () => {
  beforeEach(resetState)

  it('an instructor edits labels and capacity and the edit is audited (GROUP_UPDATED)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedGroup('g1')
    seedEnrollment('e1', 'g1', 'mem-owner', 'ACTIVE', new Date())
    seedEnrollment('e2', 'g1', 'mem-staff', 'ACTIVE', new Date())

    const res = await groupDetailRoute.PATCH(req('/api/organizations/org1/groups/g1', {
      method: 'PATCH',
      body: { programmeLabel: 'B.Com', batchLabel: '2025-A', capacity: 25 },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.group.programmeLabel).toBe('B.Com')
    expect(body.group.batchLabel).toBe('2025-A')
    expect(body.group.capacity).toBe(25)
    expect(body.group.activeEnrollmentCount).toBe(2)
    expect(state.groups[0].status).toBe('ACTIVE') // untouched field stays
    const actions = state.auditEvents.map(e => e.action)
    expect(actions).toContain('GROUP_UPDATED')
    expect(actions).not.toContain('GROUP_ARCHIVED')
    expect(actions).not.toContain('GROUP_RESTORED')
  })

  it('capacity below the current active enrollment is rejected (400) and nothing changes', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedGroup('g1')
    seedEnrollment('e1', 'g1', 'mem-owner', 'ACTIVE', new Date())
    seedEnrollment('e2', 'g1', 'mem-learner', 'ACTIVE', new Date())

    const res = await groupDetailRoute.PATCH(req('/api/organizations/org1/groups/g1', {
      method: 'PATCH',
      body: { capacity: 1 },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(400)
    expect(state.groups[0].capacity).toBe(30)
    expect(state.auditEvents).toHaveLength(0)
  })

  it('archiving an ACTIVE group is audited (GROUP_ARCHIVED)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedGroup('g1')
    const res = await groupDetailRoute.PATCH(req('/api/organizations/org1/groups/g1', {
      method: 'PATCH',
      body: { status: 'ARCHIVED' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).group.status).toBe('ARCHIVED')
    expect(state.groups[0].status).toBe('ARCHIVED')
    expect(state.auditEvents.map(e => e.action)).toEqual(['GROUP_ARCHIVED'])
  })

  it('restoring an ARCHIVED group is audited (GROUP_RESTORED)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedGroup('g1', { status: 'ARCHIVED' })
    const res = await groupDetailRoute.PATCH(req('/api/organizations/org1/groups/g1', {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(200)
    expect(state.groups[0].status).toBe('ACTIVE')
    expect(state.auditEvents.map(e => e.action)).toEqual(['GROUP_RESTORED'])
  })

  it('a LEARNER cannot update a group (403) and no audit row is written', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedGroup('g1')
    const res = await groupDetailRoute.PATCH(req('/api/organizations/org1/groups/g1', {
      method: 'PATCH',
      body: { name: 'Hijacked Name' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(403)
    expect(state.groups[0].name).toBe('Group g1')
    expect(state.auditEvents).toHaveLength(0)
  })

  it('an INVITED membership cannot update a group (403 — membership not active)', async () => {
    state.student = invitedSession
    seedStandardOrg()
    seedMembership('mem-invited', 'student-invited', 'STAFF', 'INVITED')
    seedGroup('g1')
    const res = await groupDetailRoute.PATCH(req('/api/organizations/org1/groups/g1', {
      method: 'PATCH',
      body: { name: 'Renamed Group' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(403)
    expect(state.auditEvents).toHaveLength(0)
  })
})

// ─── Enrollment enforcement ───

describe('POST /api/organizations/[id]/groups/[groupId]/enrollments — archived group', () => {
  beforeEach(resetState)

  it('rejects new enrollments into an ARCHIVED group with 409 "Group is archived."', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedGroup('g1', { status: 'ARCHIVED' })
    const res = await enrollmentsRoute.POST(req('/api/organizations/org1/groups/g1/enrollments', {
      method: 'POST',
      body: { membershipId: 'mem-learner' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Group is archived.')
    expect(state.enrollments).toHaveLength(0)
    expect(state.auditEvents).toHaveLength(0)
  })
})

describe('DELETE /api/organizations/[id]/groups/[groupId]/enrollments — leave vs removal', () => {
  beforeEach(resetState)

  it('self-leave is unchanged: own row flips to LEFT, row kept, audited as GROUP_LEFT', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedGroup('g1')
    seedEnrollment('e1', 'g1', 'mem-learner', 'ACTIVE', new Date())

    const res = await enrollmentsRoute.DELETE(req('/api/organizations/org1/groups/g1/enrollments', {
      method: 'DELETE',
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(state.enrollments).toHaveLength(1) // row kept — never deleted
    expect(state.enrollments[0].enrollmentState).toBe('LEFT')
    expect(state.enrollments[0].leftAt).not.toBeNull()
    const audit = state.auditEvents[0] as Record<string, unknown>
    expect(audit.action).toBe('GROUP_LEFT')
    expect(audit.actorId).toBe('student-learner')
  })

  it('an instructor removing another member flips the row to LEFT, keeps it, and audits GROUP_MEMBER_REMOVED (actor + target)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedGroup('g1')
    seedEnrollment('e1', 'g1', 'mem-learner', 'ACTIVE', new Date())

    const res = await enrollmentsRoute.DELETE(req('/api/organizations/org1/groups/g1/enrollments', {
      method: 'DELETE',
      body: { membershipId: 'mem-learner' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(200)
    expect(state.enrollments).toHaveLength(1)
    expect(state.enrollments[0].enrollmentState).toBe('LEFT')
    expect(state.enrollments[0].membershipId).toBe('mem-learner')
    expect(state.enrollments[0].leftAt).not.toBeNull()
    const audit = state.auditEvents[0] as Record<string, unknown>
    expect(audit.action).toBe('GROUP_MEMBER_REMOVED')
    expect(audit.actorId).toBe('student-staff') // actor
    expect(String(audit.detail)).toContain('membershipId=mem-learner') // target
  })

  it('a LEARNER cannot remove another member (403) and the enrollment stays ACTIVE', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedGroup('g1')
    seedEnrollment('e1', 'g1', 'mem-learner', 'ACTIVE', new Date())
    seedEnrollment('e2', 'g1', 'mem-staff', 'ACTIVE', new Date())

    const res = await enrollmentsRoute.DELETE(req('/api/organizations/org1/groups/g1/enrollments', {
      method: 'DELETE',
      body: { membershipId: 'mem-staff' },
    }), { params: Promise.resolve({ id: 'org1', groupId: 'g1' }) })
    expect(res.status).toBe(403)
    expect(state.enrollments.find(e => e.id === 'e2')!.enrollmentState).toBe('ACTIVE')
    expect(state.auditEvents).toHaveLength(0)
  })
})

// ─── Dashboard aggregates ───

function seedRichDashboardOrg() {
  seedStudents()
  seedOrg()
  seedMembership('mem-owner', 'student-owner', 'OWNER', 'ACTIVE')
  seedMembership('mem-staff', 'student-staff', 'INSTRUCTOR', 'ACTIVE')
  seedMembership('mem-learner', 'student-learner', 'LEARNER', 'ACTIVE')
  seedMembership('mem-invited', 'student-invited', 'STAFF', 'INVITED')

  seedGroup('g1')
  seedGroup('g2')
  seedGroup('g3', { status: 'ARCHIVED' })

  const day = 24 * 3600 * 1000
  const now = Date.now()
  state.classSessions.push(
    { id: 'cs1', organizationId: 'org1', status: 'PUBLISHED', startsAt: new Date(now + 1 * day) },
    { id: 'cs2', organizationId: 'org1', status: 'PUBLISHED', startsAt: new Date(now + 2 * day) },
    { id: 'cs3', organizationId: 'org1', status: 'CANCELLED', startsAt: new Date(now + 3 * day) },
    { id: 'cs4', organizationId: 'org1', status: 'COMPLETED', startsAt: new Date(now - 1 * day) },
    { id: 'cs5', organizationId: 'org1', status: 'DRAFT', startsAt: new Date(now + 4 * day) },
  )
  state.assignments.push(
    { id: 'as1', organizationId: 'org1', groupId: 'g1', status: 'PUBLISHED' },
    { id: 'as2', organizationId: 'org1', groupId: 'g1', status: 'CLOSED' },
    { id: 'as3', organizationId: 'org1', groupId: 'g2', status: 'DRAFT' },
    { id: 'as-other', organizationId: 'org2', groupId: 'gX', status: 'PUBLISHED' },
  )
  state.submissions.push(
    { id: 'sub1', assignmentId: 'as1', status: 'SUBMITTED' },
    { id: 'sub2', assignmentId: 'as1', status: 'SUBMITTED' },
    { id: 'sub3', assignmentId: 'as2', status: 'GRADED' },
    { id: 'sub4', assignmentId: 'as1', status: 'GRADED' },
    { id: 'sub5', assignmentId: 'as2', status: 'GRADED' },
    { id: 'sub6', assignmentId: 'as1', status: 'DRAFT' },
    { id: 'sub-other', assignmentId: 'as-other', status: 'SUBMITTED' }, // other org — must not count
  )
  state.resources.push(
    { id: 'r1', organizationId: 'org1', title: 'Syllabus' },
    { id: 'r2', organizationId: 'org1', title: 'Reading list' },
  )
  const past = new Date(now - 1 * day)
  state.announcements.push(
    { id: 'an1', organizationId: 'org1', status: 'PUBLISHED', expiresAt: null },
    { id: 'an2', organizationId: 'org1', status: 'PUBLISHED', expiresAt: past },
    { id: 'an3', organizationId: 'org1', status: 'ARCHIVED', expiresAt: null },
  )
  for (let i = 0; i < 12; i++) {
    state.auditEvents.push({
      id: `audit-${i + 1}`,
      organizationId: 'org1',
      entityType: 'GROUP',
      entityId: 'g1',
      actorId: i === 5 ? null : i === 7 ? 'student-ghost' : i % 2 === 0 ? 'student-owner' : 'student-staff',
      actorRole: 'STUDENT',
      action: i % 2 === 0 ? 'GROUP_UPDATED' : 'GROUP_ENROLLED',
      detail: `event ${i}`,
      createdAt: new Date(now - i * 1000), // audit-1 is the NEWEST
    })
  }
}

describe('GET /api/organizations/[id]/dashboard — Phase 7 UI aggregates', () => {
  beforeEach(resetState)

  it('an INSTRUCTOR gets 200 with real counts, isStaff=true, isAdmin=false and recent activity', async () => {
    state.student = instructorSession
    seedRichDashboardOrg()
    const res = await dashboardRoute.GET(req('/api/organizations/org1/dashboard'), {
      params: Promise.resolve({ id: 'org1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Backward-compatible fields are intact.
    expect(body.membership.role).toBe('INSTRUCTOR')
    expect(body.isAdmin).toBe(false)
    expect(body.verification).toEqual({ status: 'APPROVED', operational: true })
    // New role echo + staff flag.
    expect(body.role).toBe('INSTRUCTOR')
    expect(body.isStaff).toBe(true)
    // Real counts.
    expect(body.overview.activeMembers).toBe(3)
    expect(body.overview.pendingMembers).toBe(1)
    expect(body.overview.activeGroups).toBe(2)
    expect(body.overview.archivedGroups).toBe(1)
    expect(body.overview.upcomingClasses).toBe(2) // PUBLISHED + future only; cancelled/draft/past excluded
    expect(body.overview.publishedAssignments).toBe(1)
    expect(body.overview.closedAssignments).toBe(1)
    expect(body.overview.draftAssignments).toBe(1)
    expect(body.overview.submissionsAwaitingGrading).toBe(2)
    expect(body.overview.openSubmissions).toBe(2)
    expect(body.overview.submissionsGraded).toBe(3)
    expect(body.overview.resourcesTotal).toBe(2)
    expect(body.overview.activeAnnouncements).toBe(1)
    expect(body.overview.announcementsActive).toBe(1)
    // Recent activity: newest-first, capped at 10, actors resolved to display names.
    expect(body.overview.recentActivity).toHaveLength(10)
    expect(body.overview.recentActivity[0].id).toBe('audit-1')
    expect(body.overview.recentActivity[0].actorDisplayName).toBe('Owa Owner')
    expect(body.overview.recentActivity[0].summary).toBe('event 0')
    const ghost = body.overview.recentActivity.find((e: { id: string }) => e.id === 'audit-8')
    expect(ghost.actorDisplayName).toBeNull() // actor was never a member of this org
    const anonymous = body.overview.recentActivity.find((e: { id: string }) => e.id === 'audit-6')
    expect(anonymous.actorDisplayName).toBeNull() // no actor recorded
    expect(JSON.stringify(body.overview.recentActivity)).not.toContain('@')
  })

  it('a LEARNER gets 200 with isStaff=false and isAdmin=false', async () => {
    state.student = learnerSession
    seedRichDashboardOrg()
    const res = await dashboardRoute.GET(req('/api/organizations/org1/dashboard'), {
      params: Promise.resolve({ id: 'org1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('LEARNER')
    expect(body.isStaff).toBe(false)
    expect(body.isAdmin).toBe(false)
    expect(body.overview.activeGroups).toBe(2)
  })

  it('an INVITED membership gets 403 (dashboard is for active members)', async () => {
    state.student = invitedSession
    seedRichDashboardOrg()
    const res = await dashboardRoute.GET(req('/api/organizations/org1/dashboard'), {
      params: Promise.resolve({ id: 'org1' }),
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Your membership in this organization is not active.')
  })
})
