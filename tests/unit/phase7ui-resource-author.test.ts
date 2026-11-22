// ─── Phase 7 UI completion: resource/announcement author resolution ──────────
// Route-level proofs against the REAL handlers (routes imported after mocks):
//   • Resources + announcements GET resolve each row's authorMembershipId into
//     a display name via the organization's memberships (displayName only —
//     never an email), and every row carries authorMembershipId so the UI can
//     gate author-or-admin actions.
//   • Resources POST echoes the creating member's authorName.
//   • Guards are untouched: unsigned callers stay 401, non-members stay 403,
//     and learners still receive PUBLISHED non-expired announcements only.
// '@/lib/db' is a hand-rolled in-memory fake; '@/lib/auth' is stubbed to the
// session student — no DATABASE_URL needed.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  students: [] as Record<string, unknown>[],
  organizations: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  enrollments: [] as Record<string, unknown>[],
  resources: [] as Record<string, unknown>[],
  announcements: [] as Record<string, unknown>[],
  auditEvents: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.students = []
  state.organizations = []
  state.memberships = []
  state.groups = []
  state.enrollments = []
  state.resources = []
  state.announcements = []
  state.auditEvents = []
}

const fakeDb = {
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId?: { organizationId: string; studentId: string }; id?: string } }) => {
      const row = where.organizationId_studentId
        ? state.memberships.find(m => m.organizationId === where.organizationId_studentId!.organizationId && m.studentId === where.organizationId_studentId!.studentId)
        : state.memberships.find(m => m.id === where.id)
      if (!row) return null
      return { ...row, organization: state.organizations.find(o => o.id === row.organizationId) ?? null }
    },
    // Used by the author-name map: filter by organization + membership id list,
    // return the student display name only (never the email).
    findMany: async ({ where }: { where: { organizationId?: string; id?: { in?: string[] } } }) =>
      state.memberships
        .filter(m =>
          (!where.organizationId || m.organizationId === where.organizationId) &&
          (!where.id?.in || where.id.in.includes(m.id as string)))
        .map(m => {
          const student = state.students.find(s => s.id === m.studentId)
          return { id: m.id, student: { displayName: student ? (student.displayName as string | null) : null } }
        }),
  },
  organizationGroupMembership: {
    findMany: async ({ where }: { where: { membershipId?: string; enrollmentState?: string } }) =>
      state.enrollments.filter(e =>
        (!where.membershipId || e.membershipId === where.membershipId) &&
        (!where.enrollmentState || e.enrollmentState === where.enrollmentState)),
  },
  organizationResource: {
    findMany: async ({ where }: { where: { organizationId?: string; OR?: Record<string, unknown>[] } }) =>
      state.resources.filter(r => {
        if (where.organizationId && r.organizationId !== where.organizationId) return false
        if (where.OR) {
          const matches = where.OR.some(branch => {
            const b = branch as { groupId?: unknown }
            if (b.groupId === null) return r.groupId === null
            if (b.groupId && typeof b.groupId === 'object' && 'in' in (b.groupId as object)) {
              return r.groupId !== null && (b.groupId as { in: string[] }).in.includes(r.groupId as string)
            }
            return false
          })
          if (!matches) return false
        }
        return true
      }),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `res-${state.resources.length + 1}`, createdAt: new Date(), ...data }
      state.resources.push(row)
      return row
    },
  },
  organizationAnnouncement: {
    findMany: async ({ where, orderBy }: { where: { organizationId?: string; status?: string; OR?: Record<string, unknown>[] }; orderBy?: { createdAt?: string; publishedAt?: string } }) => {
      const rows = state.announcements.filter(a => {
        if (where.organizationId && a.organizationId !== where.organizationId) return false
        if (where.status && a.status !== where.status) return false
        if (where.OR) {
          const matches = where.OR.some(branch => {
            const b = branch as { groupId?: unknown }
            if (b.groupId === null) return a.groupId === null
            if (b.groupId && typeof b.groupId === 'object' && 'in' in (b.groupId as object)) {
              return a.groupId !== null && (b.groupId as { in: string[] }).in.includes(a.groupId as string)
            }
            return false
          })
          if (!matches) return false
        }
        return true
      })
      const key = orderBy?.createdAt ? 'createdAt' : orderBy?.publishedAt ? 'publishedAt' : null
      if (key === 'createdAt') rows.sort((x, y) => (y.createdAt as Date).getTime() - (x.createdAt as Date).getTime())
      if (key === 'publishedAt') rows.sort((x, y) => ((y.publishedAt as Date | null)?.getTime() ?? 0) - ((x.publishedAt as Date | null)?.getTime() ?? 0))
      return rows
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `ann-${state.announcements.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      state.announcements.push(row)
      return row
    },
  },
  organizationGroup: {
    findUnique: async ({ where }: { where: { id: string } }) => state.groups.find(g => g.id === where.id) ?? null,
  },
  organizationAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const e = { id: `audit-${state.auditEvents.length + 1}`, createdAt: new Date(), ...data }
      state.auditEvents.push(e)
      return e
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const resourcesRoute = await import('@/app/api/organizations/[id]/resources/route')
const announcementsRoute = await import('@/app/api/organizations/[id]/announcements/route')

function req(path: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as unknown as NextRequest
}

// ─── Seed helpers ───

function seedStandardOrg() {
  state.students.push(
    { id: 'student-staff', email: 'staff@bean.test', displayName: 'Ina Instructor', role: 'STUDENT' },
    { id: 'student-staff2', email: 'staff2@bean.test', displayName: 'Ivy Second', role: 'STUDENT' },
    { id: 'student-learner', email: 'learner@bean.test', displayName: 'Lea Learner', role: 'STUDENT' },
  )
  state.organizations.push({
    id: 'org1', name: 'org-one', displayName: 'Org One', orgType: 'COLLEGE', description: null,
    website: null, publicContact: null, country: null, state: null, city: null, slug: 'org-one',
    logoText: null, verificationStatus: 'APPROVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
  })
  state.memberships.push(
    { id: 'mem-staff', organizationId: 'org1', studentId: 'student-staff', role: 'INSTRUCTOR', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'mem-staff2', organizationId: 'org1', studentId: 'student-staff2', role: 'INSTRUCTOR', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'mem-learner', organizationId: 'org1', studentId: 'student-learner', role: 'LEARNER', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  )
  state.groups.push({
    id: 'g1', organizationId: 'org1', name: 'Cohort A', academicYear: null, programmeLabel: null, batchLabel: null,
    sectionLabel: null, trackLabel: null, startsAt: null, endsAt: null, capacity: 30, status: 'ACTIVE',
    createdByMembershipId: 'mem-staff', createdAt: new Date(), updatedAt: new Date(),
  })
  state.enrollments.push(
    { id: 'en1', groupId: 'g1', membershipId: 'mem-learner', enrollmentState: 'ACTIVE', joinedAt: new Date(), leftAt: null },
    { id: 'en2', groupId: 'g1', membershipId: 'mem-staff', enrollmentState: 'ACTIVE', joinedAt: new Date(), leftAt: null },
  )
}

function seedResource(overrides: Record<string, unknown> = {}) {
  state.resources.push({
    id: 'r1', organizationId: 'org1', groupId: null, authorMembershipId: 'mem-staff',
    title: 'Study guide', description: 'Week one reading', url: 'https://example.com/guide',
    createdAt: new Date(),
    ...overrides,
  })
}

function seedAnnouncements() {
  const ago = (ms: number) => new Date(Date.now() - ms)
  state.announcements.push(
    {
      id: 'ann1', organizationId: 'org1', groupId: null, authorMembershipId: 'mem-staff',
      title: 'Welcome to the term', body: 'Classes start on Monday morning.',
      status: 'PUBLISHED', publishedAt: ago(3600_000), expiresAt: null,
      createdAt: ago(3600_000), updatedAt: ago(3600_000),
    },
    {
      id: 'ann2', organizationId: 'org1', groupId: 'g1', authorMembershipId: 'mem-staff2',
      title: 'Cohort A field trip', body: 'Permission slips are due before Friday.',
      status: 'DRAFT', publishedAt: null, expiresAt: null,
      createdAt: ago(7200_000), updatedAt: ago(7200_000),
    },
    {
      id: 'ann3', organizationId: 'org1', groupId: null, authorMembershipId: 'mem-staff2',
      title: 'Old library notice', body: 'The library moved to the annex last year.',
      status: 'ARCHIVED', publishedAt: ago(90 * 24 * 3600_000), expiresAt: null,
      createdAt: ago(90 * 24 * 3600_000), updatedAt: ago(3600_000),
    },
    {
      id: 'ann4', organizationId: 'org1', groupId: null, authorMembershipId: 'mem-staff',
      title: 'Expired notice', body: 'This one quietly left the learner feed.',
      status: 'PUBLISHED', publishedAt: ago(48 * 3600_000), expiresAt: ago(24 * 3600_000),
      createdAt: ago(48 * 3600_000), updatedAt: ago(48 * 3600_000),
    },
  )
}

const staffSession = { id: 'student-staff', email: 'staff@bean.test', role: 'STUDENT' }
const staff2Session = { id: 'student-staff2', email: 'staff2@bean.test', role: 'STUDENT' }
const learnerSession = { id: 'student-learner', email: 'learner@bean.test', role: 'STUDENT' }

// ─── Resources: author resolution + untouched guards ───

describe('GET /api/organizations/[id]/resources — author fields', () => {
  beforeEach(resetState)

  it('resolves authorName through membership → student displayName on every row', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedResource({ id: 'r1', authorMembershipId: 'mem-staff' })
    seedResource({ id: 'r2', authorMembershipId: 'mem-staff2', groupId: 'g1', title: 'Cohort A lab kit' })

    const res = await resourcesRoute.GET(req('/api/organizations/org1/resources'), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resources).toHaveLength(2)
    const byId = new Map(body.resources.map((r: { id: string }) => [r.id, r]))
    expect(byId.get('r1').authorName).toBe('Ina Instructor')
    expect(byId.get('r1').authorMembershipId).toBe('mem-staff')
    expect(byId.get('r2').authorName).toBe('Ivy Second')
    expect(byId.get('r2').authorMembershipId).toBe('mem-staff2')
    // Display names only — emails never appear in the DTO.
    expect(JSON.stringify(body)).not.toContain('@bean.test')
  })

  it('keeps the guard untouched: unsigned callers are 401, non-members are 403', async () => {
    seedStandardOrg()
    seedResource()

    const anonymous = await resourcesRoute.GET(req('/api/organizations/org1/resources'), { params: Promise.resolve({ id: 'org1' }) })
    expect(anonymous.status).toBe(401)

    state.student = learnerSession
    state.memberships = state.memberships.filter(m => m.id !== 'mem-learner')
    const outsider = await resourcesRoute.GET(req('/api/organizations/org1/resources'), { params: Promise.resolve({ id: 'org1' }) })
    expect(outsider.status).toBe(403)
  })

  it('POST echoes the creating member as authorName', async () => {
    state.student = staff2Session
    seedStandardOrg()

    const res = await resourcesRoute.POST(req('/api/organizations/org1/resources', {
      method: 'POST',
      body: { title: 'Recording archive', url: 'https://example.com/recordings' },
    }), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.resource.authorMembershipId).toBe('mem-staff2')
    expect(body.resource.authorName).toBe('Ivy Second')
    expect(state.auditEvents.map(e => e.action)).toContain('RESOURCE_SHARED')
  })
})

// ─── Announcements: author resolution + visibility rules ───

describe('GET /api/organizations/[id]/announcements — author fields', () => {
  beforeEach(resetState)

  it('staff receive all statuses (includeAll) with resolved author names', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedAnnouncements()

    const res = await announcementsRoute.GET(req('/api/organizations/org1/announcements'), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.includeAll).toBe(true)
    expect(body.announcements).toHaveLength(4)
    const byId = new Map(body.announcements.map((a: { id: string }) => [a.id, a]))
    expect(byId.get('ann1').authorName).toBe('Ina Instructor')
    expect(byId.get('ann2').authorName).toBe('Ivy Second')
    expect(byId.get('ann2').status).toBe('DRAFT')
    expect(byId.get('ann3').authorName).toBe('Ivy Second')
    expect(byId.get('ann3').status).toBe('ARCHIVED')
    expect(JSON.stringify(body)).not.toContain('@bean.test')
  })

  it('learners keep PUBLISHED non-expired only, still with author fields', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedAnnouncements()

    const res = await announcementsRoute.GET(req('/api/organizations/org1/announcements'), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.includeAll).toBe(false)
    expect(body.announcements.map((a: { id: string }) => a.id)).toEqual(['ann1'])
    expect(body.announcements[0].authorName).toBe('Ina Instructor')
    expect(body.announcements[0].authorMembershipId).toBe('mem-staff')
  })
})
