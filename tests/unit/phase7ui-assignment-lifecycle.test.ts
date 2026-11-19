// ─── Phase 7 UI completion: assignment lifecycle (PATCH) ─────────────────────
// Route-level proofs against the REAL handler (route imported after mocks):
//   • Org-instructor publishes a DRAFT (publishedAt set, ASSIGNMENT_PUBLISHED
//     audited), closes a PUBLISHED one, and restores an ARCHIVED one via
//     status 'ACTIVE' back to DRAFT (ASSIGNMENT_RESTORED).
//   • Content edits (title/maxScore) are DRAFT-only — PUBLISHED → 409.
//   • Illegal transitions (DRAFT → CLOSED) are 400 with the allowed list.
//   • A changed dueAt must stay in the future.
//   • Learners can never manage assignments (403); unknown ids are 404.
// '@/lib/db' is a hand-rolled in-memory fake; '@/lib/auth' is stubbed to the
// session student — no DATABASE_URL needed.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  students: [] as Record<string, unknown>[],
  organizations: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
  auditEvents: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.students = []
  state.organizations = []
  state.memberships = []
  state.assignments = []
  state.auditEvents = []
}

const fakeDb = {
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId?: { organizationId: string; studentId: string }; id?: string } }) => {
      const row = where.organizationId_studentId
        ? state.memberships.find(m => m.organizationId === where.organizationId_studentId!.organizationId && m.studentId === where.organizationId_studentId!.studentId)
        : state.memberships.find(m => m.id === where.id)
      if (!row) return null
      const student = state.students.find(s => s.id === row.studentId)
      return { ...row, student: { displayName: student ? student.displayName : null }, organization: state.organizations.find(o => o.id === row.organizationId) ?? null }
    },
  },
  organizationAssignment: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.assignments.find(a => a.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const a = state.assignments.find(x => x.id === where.id) as Record<string, unknown> | undefined
      if (!a) return null
      Object.assign(a, data, { updatedAt: new Date() })
      return a
    },
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
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const assignmentRoute = await import('@/app/api/organizations/assignments/[assignmentId]/route')

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
    { id: 'student-learner', email: 'learner@bean.test', displayName: 'Lea Learner', role: 'STUDENT' },
  )
  state.organizations.push({
    id: 'org1', name: 'org-one', displayName: 'Org One', orgType: 'COLLEGE', description: null,
    website: null, publicContact: null, country: null, state: null, city: null, slug: 'org-one',
    logoText: null, verificationStatus: 'APPROVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
  })
  state.memberships.push(
    { id: 'mem-staff', organizationId: 'org1', studentId: 'student-staff', role: 'INSTRUCTOR', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
    { id: 'mem-learner', organizationId: 'org1', studentId: 'student-learner', role: 'LEARNER', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
  )
}

function seedAssignment(overrides: Record<string, unknown> = {}) {
  state.assignments.push({
    id: 'a1', organizationId: 'org1', groupId: 'g1', createdByMembershipId: 'mem-staff',
    title: 'Original title', instructions: 'Do the work', subjectLabel: 'Mathematics',
    submissionType: 'TEXT_AND_LINK', status: 'DRAFT', publishedAt: null,
    dueAt: new Date(Date.now() + 7 * 24 * 3600_000), maxScore: 100,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  })
}

const instructorSession = { id: 'student-staff', email: 'staff@bean.test', role: 'STUDENT' }
const learnerSession = { id: 'student-learner', email: 'learner@bean.test', role: 'STUDENT' }

const patchParams = { params: Promise.resolve({ assignmentId: 'a1' }) }

// ─── Assignment lifecycle (PATCH) ───

describe('PATCH /api/organizations/assignments/[assignmentId]', () => {
  beforeEach(resetState)

  it('an org instructor publishes a DRAFT: 200, publishedAt set, ASSIGNMENT_PUBLISHED audited', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment()

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { status: 'PUBLISHED' },
    }), patchParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assignment.status).toBe('PUBLISHED')
    expect(body.assignment.publishedAt).not.toBeNull()
    const audit = state.auditEvents.find(e => e.action === 'ASSIGNMENT_PUBLISHED')
    expect(audit).toBeDefined()
    expect(audit!.entityType).toBe('ASSIGNMENT')
    expect(audit!.entityId).toBe('a1')
    expect(audit!.actorId).toBe('student-staff')
    // Content is untouched by a status-only PATCH.
    expect(state.assignments[0].title).toBe('Original title')
  })

  it('DRAFT → CLOSED directly is 400 and lists the allowed transitions', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment()

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { status: 'CLOSED' },
    }), patchParams)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Allowed from DRAFT: PUBLISHED, ARCHIVED')
    expect(state.assignments[0].status).toBe('DRAFT')
    expect(state.auditEvents).toHaveLength(0)
  })

  it('PUBLISHED → CLOSED succeeds and is audited (ASSIGNMENT_CLOSED)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment({ status: 'PUBLISHED', publishedAt: new Date(Date.now() - 3600_000) })

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { status: 'CLOSED' },
    }), patchParams)
    expect(res.status).toBe(200)
    expect((await res.json()).assignment.status).toBe('CLOSED')
    expect(state.auditEvents.map(e => e.action)).toContain('ASSIGNMENT_CLOSED')
    // publishedAt survives closing — history is not rewritten.
    expect(state.assignments[0].publishedAt).not.toBeNull()
  })

  it('content edits on a PUBLISHED assignment are rejected with 409', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment({ status: 'PUBLISHED', publishedAt: new Date() })

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { title: 'Renamed after publish' },
    }), patchParams)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Only draft assignments can be edited.')
    expect(state.assignments[0].title).toBe('Original title')
    expect(state.auditEvents).toHaveLength(0)
  })

  it('content edits on a DRAFT assignment succeed and are audited (ASSIGNMENT_UPDATED)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment()

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { title: 'Renamed draft', maxScore: 50 },
    }), patchParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assignment.title).toBe('Renamed draft')
    expect(body.assignment.maxScore).toBe(50)
    expect(body.assignment.status).toBe('DRAFT')
    const audit = state.auditEvents.find(e => e.action === 'ASSIGNMENT_UPDATED')
    expect(audit).toBeDefined()
    expect(audit!.detail).toBe('fields=title,maxScore')
  })

  it('ARCHIVED → ACTIVE restores the assignment to DRAFT (ASSIGNMENT_RESTORED)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment({ status: 'ARCHIVED', publishedAt: new Date(Date.now() - 3600_000) })

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { status: 'ACTIVE' },
    }), patchParams)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assignment.status).toBe('DRAFT')
    expect(body.assignment.publishedAt).toBeNull()
    expect(state.auditEvents.map(e => e.action)).toContain('ASSIGNMENT_RESTORED')
  })

  it('a changed dueAt must be in the future (400 otherwise)', async () => {
    state.student = instructorSession
    seedStandardOrg()
    seedAssignment()

    const past = new Date(Date.now() - 24 * 3600_000).toISOString()
    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { dueAt: past },
    }), patchParams)
    expect(res.status).toBe(400)
    expect(state.assignments[0].dueAt).not.toBeNull()
    expect(state.auditEvents).toHaveLength(0)
  })

  it('a LEARNER can never manage assignments (403)', async () => {
    state.student = learnerSession
    seedStandardOrg()
    seedAssignment()

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/a1', {
      method: 'PATCH', body: { status: 'PUBLISHED' },
    }), patchParams)
    expect(res.status).toBe(403)
    expect(state.assignments[0].status).toBe('DRAFT')
    expect(state.auditEvents).toHaveLength(0)
  })

  it('an unknown assignment id is 404', async () => {
    state.student = instructorSession
    seedStandardOrg()

    const res = await assignmentRoute.PATCH(req('/api/organizations/assignments/missing', {
      method: 'PATCH', body: { status: 'PUBLISHED' },
    }), { params: Promise.resolve({ assignmentId: 'missing' }) })
    expect(res.status).toBe(404)
  })
})
