// ─── Phase 7 UI completion: resource + announcement lifecycle, admin audit ───
// Route-level proofs against the REAL handlers (routes imported after mocks):
//   • Resources: author or org admins may PATCH/DELETE; non-author instructors
//     get 403; URLs stay HTTPS-only; foreign groupIds are 404; DELETE is a
//     hard delete audited with title + url; wrong-org resources are 404.
//   • Announcements: staff GET includes DRAFT + ARCHIVED (includeAll: true);
//     learners keep PUBLISHED non-expired only; archive/restore is
//     author-or-admin; content edits are instructor-only while not archived;
//     POST supports DRAFT (no publishedAt) and validates expiry/group.
//   • Admin audit: BEAN admins read the last 50 events with actor display
//     names; non-admins 403; unknown orgs 404.
// '@/lib/db' is a hand-rolled in-memory fake; '@/lib/auth' and '@/lib/teach'
// are stubbed to the session student / admin guard — no DATABASE_URL needed.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  adminGuard: null as { ok: boolean; status?: number; error?: string; student?: Record<string, unknown>; value?: null } | null,
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
  state.adminGuard = null
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
      const student = state.students.find(s => s.id === row.studentId)
      return { ...row, student: { displayName: student ? student.displayName : null }, organization: state.organizations.find(o => o.id === row.organizationId) ?? null }
    },
    findMany: async ({ where }: { where: { organizationId?: string; studentId?: { in?: string[] } } }) =>
      state.memberships
        .filter(m =>
          (!where.organizationId || m.organizationId === where.organizationId) &&
          (!where.studentId?.in || where.studentId.in.includes(m.studentId as string)))
        .map(m => {
          const student = state.students.find(s => s.id === m.studentId)
          return { studentId: m.studentId, student: { displayName: student ? (student.displayName as string | null) : null } }
        }),
  },
  organizationGroup: {
    findUnique: async ({ where }: { where: { id: string } }) => state.groups.find(g => g.id === where.id) ?? null,
  },
  organizationGroupMembership: {
    findMany: async ({ where }: { where: { membershipId?: string; enrollmentState?: string } }) =>
      state.enrollments.filter(e =>
        (!where.membershipId || e.membershipId === where.membershipId) &&
        (!where.enrollmentState || e.enrollmentState === where.enrollmentState)),
  },
  organizationResource: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.resources.find(r => r.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = state.resources.find(x => x.id === where.id) as Record<string, unknown> | undefined
      if (!r) return null
      Object.assign(r, data)
      return r
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const idx = state.resources.findIndex(r => r.id === where.id)
      if (idx === -1) return null
      const [row] = state.resources.splice(idx, 1)
      return row
    },
  },
  organizationAnnouncement: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.announcements.find(a => a.id === where.id) ?? null,
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
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const a = state.announcements.find(x => x.id === where.id) as Record<string, unknown> | undefined
      if (!a) return null
      Object.assign(a, data, { updatedAt: new Date() })
      return a
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const a = { id: `ann-${state.announcements.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      state.announcements.push(a)
      return a
    },
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
mock.module('@/lib/teach', () => ({
  requireAdmin: async () => state.adminGuard,
}))

const resourceItemRoute = await import('@/app/api/organizations/[id]/resources/[resourceId]/route')
const announcementsRoute = await import('@/app/api/organizations/[id]/announcements/route')
const announcementItemRoute = await import('@/app/api/organizations/[id]/announcements/[announcementId]/route')
const adminAuditRoute = await import('@/app/api/admin/organizations/[orgId]/audit/route')

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
    { id: 'student-staff2', email: 'staff2@bean.test', displayName: 'Ivy Second', role: 'STUDENT' },
    { id: 'student-admin', email: 'admin@bean.test', displayName: 'Ora Admin', role: 'STUDENT' },
    { id: 'student-learner', email: 'learner@bean.test', displayName: 'Lea Learner', role: 'STUDENT' },
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

function seedMembership(id: string, studentId: string, role: string, status = 'ACTIVE', organizationId = 'org1') {
  state.memberships.push({ id, organizationId, studentId, role, status, createdAt: new Date(), updatedAt: new Date() })
}

function seedGroup(id: string, organizationId = 'org1') {
  state.groups.push({
    id, organizationId, name: `Group ${id}`, academicYear: null, programmeLabel: null, batchLabel: null,
    sectionLabel: null, trackLabel: null, startsAt: null, endsAt: null, capacity: 30, status: 'ACTIVE',
    createdByMembershipId: 'mem-owner', createdAt: new Date(), updatedAt: new Date(),
  })
}

function seedEnrollment(id: string, groupId: string, membershipId: string, enrollmentState = 'ACTIVE') {
  state.enrollments.push({ id, groupId, membershipId, enrollmentState, joinedAt: new Date(), leftAt: null })
}

function seedStandardOrg() {
  seedStudents()
  seedOrg()
  seedMembership('mem-owner', 'student-owner', 'OWNER')
  seedMembership('mem-staff', 'student-staff', 'INSTRUCTOR')
  seedMembership('mem-staff2', 'student-staff2', 'INSTRUCTOR')
  seedMembership('mem-admin', 'student-admin', 'ADMIN')
  seedMembership('mem-learner', 'student-learner', 'LEARNER')
}

const staffSession = { id: 'student-staff', email: 'staff@bean.test', role: 'STUDENT' }
const staff2Session = { id: 'student-staff2', email: 'staff2@bean.test', role: 'STUDENT' }
const adminSession = { id: 'student-admin', email: 'admin@bean.test', role: 'STUDENT' }
const learnerSession = { id: 'student-learner', email: 'learner@bean.test', role: 'STUDENT' }
const beanAdminSession = { id: 'student-bean-admin', email: 'bean-admin@bean.test', role: 'ADMIN' }

const adminGuardOk = { ok: true, student: beanAdminSession, value: null }
const adminGuardDenied = { ok: false, status: 403, error: 'Teacher review is restricted to BEAN administrators.' }

function seedResource(overrides: Record<string, unknown> = {}) {
  state.resources.push({
    id: 'r1', organizationId: 'org1', groupId: null, authorMembershipId: 'mem-staff',
    title: 'Study guide', description: 'Week one reading', url: 'https://example.com/guide',
    createdAt: new Date(),
    ...overrides,
  })
}

function seedForeignOrg() {
  state.organizations.push({
    id: 'org2', name: 'org-two', displayName: 'Org Two', orgType: 'SCHOOL', description: null,
    website: null, publicContact: null, country: null, state: null, city: null, slug: 'org-two',
    logoText: null, verificationStatus: 'APPROVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
  })
}

function seedAnnouncement(overrides: Record<string, unknown> = {}) {
  state.announcements.push({
    id: 'ann1', organizationId: 'org1', groupId: null, authorMembershipId: 'mem-staff',
    title: 'Welcome to the term', body: 'Classes start on Monday morning.',
    status: 'PUBLISHED', publishedAt: new Date(Date.now() - 3600_000), expiresAt: null,
    createdAt: new Date(Date.now() - 3600_000), updatedAt: new Date(),
    ...overrides,
  })
}

// ─── Resource lifecycle (PATCH / DELETE) ───

describe('PATCH/DELETE /api/organizations/[id]/resources/[resourceId]', () => {
  beforeEach(resetState)

  it('the author can edit a resource (RESOURCE_UPDATED audited)', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedResource()

    const res = await resourceItemRoute.PATCH(req('/api/organizations/org1/resources/r1', {
      method: 'PATCH', body: { title: 'Updated guide', description: null },
    }), { params: Promise.resolve({ id: 'org1', resourceId: 'r1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resource.title).toBe('Updated guide')
    expect(body.resource.description).toBeNull()
    expect(body.resource.url).toBe('https://example.com/guide') // untouched
    const audit = state.auditEvents.find(e => e.action === 'RESOURCE_UPDATED')
    expect(audit).toBeDefined()
    expect(audit!.detail).toBe('fields=title,description')
    expect(audit!.entityId).toBe('r1')
  })

  it('an org admin can edit a resource they did not author', async () => {
    state.student = adminSession
    seedStandardOrg()
    seedResource()

    const res = await resourceItemRoute.PATCH(req('/api/organizations/org1/resources/r1', {
      method: 'PATCH', body: { url: 'https://example.com/replacement' },
    }), { params: Promise.resolve({ id: 'org1', resourceId: 'r1' }) })
    expect(res.status).toBe(200)
    expect(state.resources[0].url).toBe('https://example.com/replacement')
  })

  it('a non-author instructor gets 403 and nothing changes', async () => {
    state.student = staff2Session
    seedStandardOrg()
    seedResource() // authored by mem-staff

    const res = await resourceItemRoute.PATCH(req('/api/organizations/org1/resources/r1', {
      method: 'PATCH', body: { title: 'Hijacked title' },
    }), { params: Promise.resolve({ id: 'org1', resourceId: 'r1' }) })
    expect(res.status).toBe(403)
    expect(state.resources[0].title).toBe('Study guide')
    expect(state.auditEvents).toHaveLength(0)
  })

  it('an http (non-https) url is rejected with 400', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedResource()

    const res = await resourceItemRoute.PATCH(req('/api/organizations/org1/resources/r1', {
      method: 'PATCH', body: { url: 'http://example.com/insecure' },
    }), { params: Promise.resolve({ id: 'org1', resourceId: 'r1' }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Resource links must be valid HTTPS URLs.')
    expect(state.resources[0].url).toBe('https://example.com/guide')
    expect(state.auditEvents).toHaveLength(0)
  })

  it('the author deletes a resource: audited with title + url, row gone', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedResource()

    const res = await resourceItemRoute.DELETE(req('/api/organizations/org1/resources/r1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'org1', resourceId: 'r1' }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(state.resources).toHaveLength(0) // hard delete — nothing references resources by FK
    const audit = state.auditEvents.find(e => e.action === 'RESOURCE_REMOVED')
    expect(audit).toBeDefined()
    expect(String(audit!.detail)).toContain('title=Study guide')
    expect(String(audit!.detail)).toContain('url=https://example.com/guide')
  })

  it('a resource from another organization is 404 (no existence oracle)', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedForeignOrg()
    seedResource({ id: 'r-foreign', organizationId: 'org2', authorMembershipId: 'mem-staff' })

    const res = await resourceItemRoute.PATCH(req('/api/organizations/org1/resources/r-foreign', {
      method: 'PATCH', body: { title: 'Cross-org attempt' },
    }), { params: Promise.resolve({ id: 'org1', resourceId: 'r-foreign' }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Resource not found')
  })

  it('a groupId from another organization is rejected (404)', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedForeignOrg()
    seedResource()
    seedGroup('g-foreign', 'org2')

    const res = await resourceItemRoute.PATCH(req('/api/organizations/org1/resources/r1', {
      method: 'PATCH', body: { groupId: 'g-foreign' },
    }), { params: Promise.resolve({ id: 'org1', resourceId: 'r1' }) })
    expect(res.status).toBe(404)
    expect(state.resources[0].groupId).toBeNull()
    expect(state.auditEvents).toHaveLength(0)
  })
})

// ─── Announcement lifecycle (GET list / POST / PATCH) ───

describe('GET/POST/PATCH announcements (lifecycle)', () => {
  beforeEach(resetState)

  it('org staff GET includes DRAFT and ARCHIVED items (includeAll: true)', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedAnnouncement({ id: 'ann-published' })
    seedAnnouncement({ id: 'ann-draft', status: 'DRAFT', publishedAt: null })
    seedAnnouncement({ id: 'ann-archived', status: 'ARCHIVED' })
    seedAnnouncement({ id: 'ann-expired', expiresAt: new Date(Date.now() - 1000) })

    const res = await announcementsRoute.GET(req('/api/organizations/org1/announcements'), {
      params: Promise.resolve({ id: 'org1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.includeAll).toBe(true)
    expect(body.announcements).toHaveLength(4)
    const statuses = body.announcements.map((a: { status: string }) => a.status)
    expect(statuses).toContain('DRAFT')
    expect(statuses).toContain('ARCHIVED')
  })

  it('a learner GET sees only PUBLISHED non-expired announcements (includeAll: false)', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedGroup('g1')
    seedGroup('g2')
    seedEnrollment('e1', 'g1', 'mem-learner')
    seedAnnouncement({ id: 'ann-published' })
    seedAnnouncement({ id: 'ann-group', groupId: 'g1' })
    seedAnnouncement({ id: 'ann-othergroup', groupId: 'g2' })
    seedAnnouncement({ id: 'ann-draft', status: 'DRAFT', publishedAt: null })
    seedAnnouncement({ id: 'ann-archived', status: 'ARCHIVED' })
    seedAnnouncement({ id: 'ann-expired', expiresAt: new Date(Date.now() - 1000) })

    const res = await announcementsRoute.GET(req('/api/organizations/org1/announcements'), {
      params: Promise.resolve({ id: 'org1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.includeAll).toBe(false)
    expect(body.announcements.map((a: { id: string }) => a.id).sort()).toEqual(['ann-group', 'ann-published'])
  })

  it('the author archives a PUBLISHED announcement (ANNOUNCEMENT_ARCHIVED)', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedAnnouncement()

    const res = await announcementItemRoute.PATCH(req('/api/organizations/org1/announcements/ann1', {
      method: 'PATCH', body: { status: 'ARCHIVED' },
    }), { params: Promise.resolve({ id: 'org1', announcementId: 'ann1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.announcement.status).toBe('ARCHIVED')
    const audit = state.auditEvents.find(e => e.action === 'ANNOUNCEMENT_ARCHIVED')
    expect(audit).toBeDefined()
    expect(audit!.detail).toBe('from=PUBLISHED')
  })

  it('an org admin archives and restores (ANNOUNCEMENT_RESTORED re-publishes)', async () => {
    state.student = adminSession
    seedStandardOrg()
    seedAnnouncement()

    const archive = await announcementItemRoute.PATCH(req('/api/organizations/org1/announcements/ann1', {
      method: 'PATCH', body: { status: 'ARCHIVED' },
    }), { params: Promise.resolve({ id: 'org1', announcementId: 'ann1' }) })
    expect(archive.status).toBe(200)
    expect(state.announcements[0].status).toBe('ARCHIVED')

    const restore = await announcementItemRoute.PATCH(req('/api/organizations/org1/announcements/ann1', {
      method: 'PATCH', body: { status: 'ACTIVE' },
    }), { params: Promise.resolve({ id: 'org1', announcementId: 'ann1' }) })
    expect(restore.status).toBe(200)
    const body = await restore.json()
    expect(body.announcement.status).toBe('PUBLISHED')
    expect(body.announcement.publishedAt).not.toBeNull()
    const actions = state.auditEvents.map(e => e.action)
    expect(actions).toContain('ANNOUNCEMENT_ARCHIVED')
    expect(actions).toContain('ANNOUNCEMENT_RESTORED')
  })

  it('a non-author instructor cannot archive (403) but can edit content (200)', async () => {
    state.student = staff2Session
    seedStandardOrg()
    seedAnnouncement() // authored by mem-staff

    const archive = await announcementItemRoute.PATCH(req('/api/organizations/org1/announcements/ann1', {
      method: 'PATCH', body: { status: 'ARCHIVED' },
    }), { params: Promise.resolve({ id: 'org1', announcementId: 'ann1' }) })
    expect(archive.status).toBe(403)
    expect(state.announcements[0].status).toBe('PUBLISHED')

    const edit = await announcementItemRoute.PATCH(req('/api/organizations/org1/announcements/ann1', {
      method: 'PATCH', body: { body: 'Edited body by staff instructor.' },
    }), { params: Promise.resolve({ id: 'org1', announcementId: 'ann1' }) })
    expect(edit.status).toBe(200)
    expect(state.announcements[0].body).toBe('Edited body by staff instructor.')
    expect(state.auditEvents.map(e => e.action)).toContain('ANNOUNCEMENT_UPDATED')
    expect(state.auditEvents.map(e => e.action)).not.toContain('ANNOUNCEMENT_ARCHIVED')
  })

  it('POST with status DRAFT stores a DRAFT announcement without publishedAt', async () => {
    state.student = staffSession
    seedStandardOrg()

    const res = await announcementsRoute.POST(req('/api/organizations/org1/announcements', {
      method: 'POST', body: { title: 'Heads up', body: 'Draft announcement for review.', status: 'DRAFT' },
    }), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.announcement.status).toBe('DRAFT')
    expect(body.announcement.publishedAt).toBeNull()
    expect(state.auditEvents.map(e => e.action)).toContain('ANNOUNCEMENT_DRAFTED')
  })

  it('POST with a groupId from another organization is rejected (404)', async () => {
    state.student = staffSession
    seedStandardOrg()
    seedForeignOrg()
    seedGroup('g-foreign', 'org2')

    const res = await announcementsRoute.POST(req('/api/organizations/org1/announcements', {
      method: 'POST', body: { groupId: 'g-foreign', title: 'Scoped notice', body: 'Targeted at a foreign group.' },
    }), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(404)
    expect(state.announcements).toHaveLength(0)
    expect(state.auditEvents).toHaveLength(0)
  })

  it('POST with a past expiresAt is rejected (400)', async () => {
    state.student = staffSession
    seedStandardOrg()

    const past = new Date(Date.now() - 24 * 3600_000).toISOString()
    const res = await announcementsRoute.POST(req('/api/organizations/org1/announcements', {
      method: 'POST', body: { title: 'Too late', body: 'This expiry is already in the past.', expiresAt: past },
    }), { params: Promise.resolve({ id: 'org1' }) })
    expect(res.status).toBe(400)
    expect(state.announcements).toHaveLength(0)
    expect(state.auditEvents).toHaveLength(0)
  })
})

// ─── Admin audit read (GET /api/admin/organizations/[orgId]/audit) ───

describe('GET /api/admin/organizations/[orgId]/audit', () => {
  beforeEach(resetState)

  it('a BEAN admin reads the org audit trail with actor display names, newest first', async () => {
    state.adminGuard = adminGuardOk
    seedStandardOrg()
    state.auditEvents.push(
      { id: 'audit-old', organizationId: 'org1', entityType: 'ASSIGNMENT', entityId: 'a1', actorId: 'student-staff', actorRole: 'STUDENT', action: 'ASSIGNMENT_PUBLISHED', detail: null, createdAt: new Date('2025-01-01T00:00:00Z') },
      { id: 'audit-new', organizationId: 'org1', entityType: 'RESOURCE', entityId: 'r1', actorId: 'student-unknown', actorRole: null, action: 'RESOURCE_SHARED', detail: null, createdAt: new Date('2025-02-01T00:00:00Z') },
    )

    const res = await adminAuditRoute.GET(req('/api/admin/organizations/org1/audit'), {
      params: Promise.resolve({ orgId: 'org1' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.organization).toEqual({ id: 'org1', name: 'org-one', verificationStatus: 'APPROVED' })
    expect(body.audit).toHaveLength(2)
    expect(body.audit[0].id).toBe('audit-new') // newest first
    expect(body.audit[0].actorDisplayName).toBeNull() // actor never was a member
    expect(body.audit[1].actorDisplayName).toBe('Ina Instructor')
    expect(JSON.stringify(body)).not.toContain('@')
  })

  it('a non-admin gets 403', async () => {
    state.adminGuard = adminGuardDenied
    seedStandardOrg()

    const res = await adminAuditRoute.GET(req('/api/admin/organizations/org1/audit'), {
      params: Promise.resolve({ orgId: 'org1' }),
    })
    expect(res.status).toBe(403)
  })

  it('an unknown organization is 404', async () => {
    state.adminGuard = adminGuardOk
    seedStandardOrg()

    const res = await adminAuditRoute.GET(req('/api/admin/organizations/org-missing/audit'), {
      params: Promise.resolve({ orgId: 'org-missing' }),
    })
    expect(res.status).toBe(404)
  })
})
