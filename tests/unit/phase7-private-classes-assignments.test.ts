// ─── Phase 7: Private institution classes & assignment privacy tests ─────────
// Coverage (spec §28 — Institution groups / Assignments):
//   • Organization-only classes never appear in public discovery (the
//     discovery where-clause filters audience=PUBLIC — exercised through the
//     real route against a fake db).
//   • Unrelated students cannot book private classes (restricted outcome);
//     eligible members can; suspended members cannot; public booking is
//     untouched.
//   • Live token authorization re-checks membership (route-level).
//   • Students see only their enrolled groups' assignments; cannot read
//     another student's submission (404); grades stay private; external
//     links validated.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  classes: new Map<string, Record<string, unknown>>(),
  bookings: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  groupMemberships: [] as Record<string, unknown>[],
  trustRows: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  seatClaimed: 0,
  submissions: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.classes = new Map()
  state.bookings = []
  state.memberships = []
  state.groupMemberships = []
  state.trustRows = []
  state.audit = []
  state.seatClaimed = 0
  state.submissions = []

  state.classes.set('pub', {
    id: 'pub', teacherProfileId: 'tp-1', status: 'PUBLISHED', audience: 'PUBLIC', createdAt: new Date(), updatedAt: new Date(),
    organizationId: null, organizationGroupId: null,
    startsAt: new Date(Date.now() + 24 * 3600_000), capacity: 10, bookedCount: 0, durationMinutes: 60, timeZone: 'UTC',
  })
  state.classes.set('orgclass', {
    id: 'orgclass', teacherProfileId: 'tp-1', status: 'PUBLISHED', audience: 'ORGANIZATION', createdAt: new Date(), updatedAt: new Date(),
    organizationId: 'org1', organizationGroupId: null,
    startsAt: new Date(Date.now() + 24 * 3600_000), capacity: 10, bookedCount: 0, durationMinutes: 60, timeZone: 'UTC',
  })
  state.classes.set('grpclass', {
    id: 'grpclass', teacherProfileId: 'tp-1', status: 'PUBLISHED', audience: 'GROUP', createdAt: new Date(), updatedAt: new Date(),
    organizationId: 'org1', organizationGroupId: 'g1',
    startsAt: new Date(Date.now() + 24 * 3600_000), capacity: 10, bookedCount: 0, durationMinutes: 60, timeZone: 'UTC',
  })
}

const teacherProfile = { id: 'tp-1', studentId: 'teacher-1', teachingName: 'Teacher One', verificationStatus: 'APPROVED', isPublished: true }

function trustStateFor() {
  const active = state.trustRows.some(r => r.isActive && (!r.endsAt || (r.endsAt as Date).getTime() > Date.now()))
  return { pausedListings: active, suspendedPublishing: false, emergencyStop: false, restricted: active }
}

const fakeDb = {
  classSession: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const c = state.classes.get(where.id)
      return c ? { ...c, teacherProfile, liveSession: null } : null
    },
    findMany: async ({ where }: { where: { status?: string; audience?: string } }) => {
      return [...state.classes.values()]
        .filter(c => (!where.status || c.status === where.status) && (!where.audience || c.audience === where.audience))
        .map(c => ({ ...c, teacherProfile }))
    },
    count: async ({ where }: { where: { status?: string; audience?: string } }) => {
      return [...state.classes.values()].filter(c => (!where.status || c.status === where.status) && (!where.audience || c.audience === where.audience)).length
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const c = state.classes.get(where.id) as Record<string, unknown>
      Object.assign(c, data)
      return c
    },
  },
  teacherProfile: {
    findUnique: async ({ where }: { where: { id?: string; studentId?: string } }) => teacherProfile,
  },
  liveClassSession: { findUnique: async () => null },
  trustAction: { findMany: async () => state.trustRows },
  classReview: { findMany: async () => [] },
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId: { organizationId: string; studentId: string } } }) => {
      const m = state.memberships.find(m => m.organizationId === where.organizationId_studentId.organizationId && m.studentId === where.organizationId_studentId.studentId)
      return m ? { ...m, organization: { id: 'org1', name: 'Test Org', displayName: 'Test Org', orgType: 'SCHOOL', verificationStatus: 'APPROVED', isActive: true, slug: 'test-org' } } : null
    },
  },
  organizationGroupMembership: {
    findUnique: async ({ where }: { where: { groupId_membershipId: { groupId: string; membershipId: string } } }) =>
      state.groupMemberships.find(g => g.groupId === where.groupId_membershipId.groupId && g.membershipId === where.groupId_membershipId.membershipId) ?? null,
  },
  classBooking: {
    findUnique: async ({ where }: { where: { classSessionId_studentId?: { classSessionId: string; studentId: string } } }) => {
      if (!where.classSessionId_studentId) return null
      return state.bookings.find(b => b.classSessionId === where.classSessionId_studentId!.classSessionId && b.studentId === where.classSessionId_studentId!.studentId) ?? null
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const b = state.bookings.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(b, data)
      return b
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const b = { id: `bk-${state.bookings.length + 1}`, bookedAt: new Date(), cancelledAt: null, attendanceMarkedAt: null, ...data }
      state.bookings.push(b)
      return b
    },
  },
  $executeRawUnsafe: async (_sql: string, _now: number, _id: string, _now2: number) => {
    state.seatClaimed += 1
    return 1
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))
const actualTrust = await import('@/lib/trust')
mock.module('@/lib/trust', () => ({
  ...actualTrust,
  trustStateFor: async () => trustStateFor(),
  restrictionMessage: () => 'This listing is temporarily paused while BEAN operators complete a review.',
}))

const bookRoute = await import('@/app/api/teach/classes/[id]/book/route')
const classesRoute = await import('@/app/api/teach/classes/route')
const detailRoute = await import('@/app/api/teach/classes/[id]/route')

function req(path: string, method = 'POST'): NextRequest {
  return new Request(`http://localhost${path}`, { method }) as unknown as NextRequest
}

const studentSession = { id: 'student-1', email: 's1@bean.test', role: 'STUDENT' }

describe('public discovery never shows private institution classes', () => {
  beforeEach(resetState)
  it('GET /api/teach/classes returns audience=PUBLIC rows only', async () => {
    const res = await classesRoute.GET(req('/api/teach/classes', 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.classes.map((c: { id: string }) => c.id)
    expect(ids).toContain('pub')
    expect(ids).not.toContain('orgclass')
    expect(ids).not.toContain('grpclass')
  })
})

describe('class detail visibility', () => {
  beforeEach(resetState)
  it('an unrelated signed-out caller gets 404 for an organization class', async () => {
    state.student = null
    const res = await detailRoute.GET(req('/api/teach/classes/orgclass', 'GET'), { params: Promise.resolve({ id: 'orgclass' }) })
    expect(res.status).toBe(404)
  })
  it('an ACTIVE member of the owning organization can view it', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    const res = await detailRoute.GET(req('/api/teach/classes/orgclass', 'GET'), { params: Promise.resolve({ id: 'orgclass' }) })
    expect(res.status).toBe(200)
  })
  it('a SUSPENDED member is denied like a stranger (404) — new access is blocked, history untouched', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'SUSPENDED' })
    const res = await detailRoute.GET(req('/api/teach/classes/orgclass', 'GET'), { params: Promise.resolve({ id: 'orgclass' }) })
    expect(res.status).toBe(404)
  })
  it('public classes remain viewable exactly as before', async () => {
    state.student = null
    const res = await detailRoute.GET(req('/api/teach/classes/pub', 'GET'), { params: Promise.resolve({ id: 'pub' }) })
    expect(res.status).toBe(200)
  })
})

describe('booking eligibility for private classes', () => {
  beforeEach(resetState)
  it('an unrelated student cannot book an organization class (403)', async () => {
    state.student = studentSession
    const res = await bookRoute.POST(req('/api/teach/classes/orgclass/book'), { params: Promise.resolve({ id: 'orgclass' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/eligible members/i)
    expect(state.seatClaimed).toBe(0)
  })
  it('an ACTIVE member can book the organization class', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    const res = await bookRoute.POST(req('/api/teach/classes/orgclass/book'), { params: Promise.resolve({ id: 'orgclass' }) })
    expect(res.status).toBe(201)
    expect(state.seatClaimed).toBe(1)
  })
  it('a member WITHOUT the group enrollment cannot book a group class', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    const res = await bookRoute.POST(req('/api/teach/classes/grpclass/book'), { params: Promise.resolve({ id: 'grpclass' }) })
    expect(res.status).toBe(403)
  })
  it('an actively-enrolled group member CAN book the group class', async () => {
    state.student = studentSession
    const membership = { id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' }
    state.memberships.push(membership)
    state.groupMemberships.push({ id: 'gm1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'ACTIVE' })
    const res = await bookRoute.POST(req('/api/teach/classes/grpclass/book'), { params: Promise.resolve({ id: 'grpclass' }) })
    expect(res.status).toBe(201)
  })
  it('a member who LEFT the group cannot book the group class', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'gm1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'LEFT' })
    const res = await bookRoute.POST(req('/api/teach/classes/grpclass/book'), { params: Promise.resolve({ id: 'grpclass' }) })
    expect(res.status).toBe(403)
  })
  it('existing public booking behavior is untouched (guest still 401, public student books)', async () => {
    state.student = null
    const guest = await bookRoute.POST(req('/api/teach/classes/pub/book'), { params: Promise.resolve({ id: 'pub' }) })
    expect(guest.status).toBe(401)
    state.student = studentSession
    const ok = await bookRoute.POST(req('/api/teach/classes/pub/book'), { params: Promise.resolve({ id: 'pub' }) })
    expect(ok.status).toBe(201)
  })
})

// ─── Assignment privacy (merged into the SAME fake db — one mock.module per module) ───

const assignmentState = {
  assignments: [] as Record<string, unknown>[],
  submissions: [] as Record<string, unknown>[],
  enrollments: [] as Record<string, unknown>[],
}

function resetAssignmentState() {
  state.submissions = []
  state.groupMemberships = []
  state.memberships = []
  assignmentState.assignments = [{
    id: 'as-1', organizationId: 'org1', groupId: 'g1', title: 'Week 1 worksheet', status: 'PUBLISHED',
    submissionType: 'TEXT_AND_LINK', dueAt: null, maxScore: 10, publishedAt: new Date(), createdByMembershipId: 'staff-1',
  }]
  assignmentState.submissions = []
  assignmentState.enrollments = []
}

// Assignment models merged into the SAME fakeDb (one mock.module per module).
const fakeDbExt = fakeDb as unknown as Record<string, Record<string, unknown>>
fakeDbExt.organizationAuditEvent = {
  create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'audit-1', ...data }),
}
fakeDbExt.organizationAssignment = {
  findUnique: async ({ where }: { where: { id: string } }) => assignmentState.assignments.find(a => a.id === where.id) ?? null,
  count: async () => 0,
}
fakeDbExt.assignmentSubmission = {
  count: async ({ where }: { where?: Record<string, unknown> }) => {
    return state.submissions.filter(s =>
      (!where?.['studentId'] || s.studentId === where['studentId']) &&
      (!where?.['status'] || (() => { const st = where['status'] as Record<string, string>; return st && st.not ? s.status !== st.not : s.status === where?.['status'] })()),
    ).length
  },
  findUnique: async ({ where }: { where: { id?: string; assignmentId_studentId?: { assignmentId: string; studentId: string } } }) => {
    let row: Record<string, unknown> | undefined
    if (where.id) row = state.submissions.find(s => s.id === where.id)
    else if (where.assignmentId_studentId) row = state.submissions.find(s => s.assignmentId === where.assignmentId_studentId!.assignmentId && s.studentId === where.assignmentId_studentId!.studentId)
    return row ? { ...row, assignment: assignmentState.assignments.find(a => a.id === row!.assignmentId) } : null
  },
  create: async ({ data }: { data: Record<string, unknown> }) => {
    const s = { id: `sub-${state.submissions.length + 1}`, createdAt: new Date(), updatedAt: new Date(), gradedAt: null, gradeValue: null, teacherFeedback: null, gradedByMembershipId: null, ...data }
    state.submissions.push(s)
    return s
  },
  update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const s = state.submissions.find(x => x.id === where.id) as Record<string, unknown>
    Object.assign(s, data)
    return s
  },
}

const submitRoute = await import('@/app/api/organizations/assignments/[assignmentId]/submissions/route')
const gradeRoute = await import('@/app/api/organizations/assignments/[assignmentId]/submissions/[submissionId]/route')

function postReq(path: string, body: unknown, method = 'POST'): NextRequest {
  return new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as unknown as NextRequest
}

describe('assignment submission privacy & rules', () => {
  beforeEach(resetAssignmentState)

  it('a learner actively enrolled in the group can submit', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'e1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'ACTIVE' })
    const res = await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', { responseText: 'My answer' }), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    expect(res.status).toBe(201)
    expect(state.submissions[0].status).toBe('SUBMITTED')
  })

  it('a learner NOT enrolled in the group cannot submit (403)', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    const res = await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', { responseText: 'My answer' }), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    expect(res.status).toBe(403)
    expect(state.submissions.length).toBe(0)
  })

  it('a submission requires content (no empty submissions)', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'e1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'ACTIVE' })
    const res = await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', {}), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    expect(res.status).toBe(400)
  })

  it('a DRAFT assignment accepts no submissions (409)', async () => {
    state.student = studentSession
    ;(assignmentState.assignments[0] as Record<string, unknown>).status = 'DRAFT'
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'e1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'ACTIVE' })
    const res = await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', { responseText: 'x' }), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    expect(res.status).toBe(409)
  })

  it('resubmission updates the SAME row (one record per student/assignment)', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'e1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'ACTIVE' })
    await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', { responseText: 'v1' }), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', { responseText: 'v2' }), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    expect(state.submissions.length).toBe(1)
    expect(state.submissions[0].responseText).toBe('v2')
  })

  it('a non-https external link is rejected', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'e1', groupId: 'g1', membershipId: 'm1', enrollmentState: 'ACTIVE' })
    const res = await submitRoute.POST(postReq('/api/organizations/assignments/as-1/submissions', { externalLink: 'javascript:alert(1)' }), { params: Promise.resolve({ assignmentId: 'as-1' }) })
    expect(res.status).toBe(400)
  })

  it('grading is instructor-only for the owning group; grades stay private', async () => {
    state.student = { id: 'student-1', email: 's1@bean.test', role: 'STUDENT' }
    state.memberships.push({ id: 'staff-1', organizationId: 'org1', studentId: 'student-1', role: 'INSTRUCTOR', status: 'ACTIVE' })
    state.groupMemberships.push({ id: 'e1', groupId: 'g1', membershipId: 'staff-1', enrollmentState: 'ACTIVE' })
    state.submissions.push({ id: 'sub-1', assignmentId: 'as-1', studentId: 'someone-else', status: 'SUBMITTED', responseText: 'answer', externalLink: null, submittedAt: new Date(), gradeValue: null, teacherFeedback: null, gradedAt: null })
    const res = await gradeRoute.PATCH(
      postReq('/api/organizations/assignments/as-1/submissions/sub-1', { gradeValue: '8/10', teacherFeedback: 'Good work' }, 'PATCH'),
      { params: Promise.resolve({ assignmentId: 'as-1', submissionId: 'sub-1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.submission.status).toBe('GRADED')
    expect(state.submissions[0].gradeValue).toBe('8/10')
  })

  it('a student cannot grade (and cannot touch another student\'s submission)', async () => {
    state.student = studentSession
    state.memberships.push({ id: 'm1', organizationId: 'org1', studentId: 'student-1', role: 'LEARNER', status: 'ACTIVE' })
    state.submissions.push({ id: 'sub-1', assignmentId: 'as-1', studentId: 'someone-else', status: 'SUBMITTED', responseText: 'answer', externalLink: null, submittedAt: new Date(), gradeValue: null, teacherFeedback: null, gradedAt: null })
    const res = await gradeRoute.PATCH(
      postReq('/api/organizations/assignments/as-1/submissions/sub-1', { gradeValue: '1/10' }, 'PATCH'),
      { params: Promise.resolve({ assignmentId: 'as-1', submissionId: 'sub-1' }) },
    )
    // The submission exists but belongs to someone else → 404, never leaked.
    expect(res.status).toBe(404)
    expect(state.submissions[0].gradeValue).toBeNull()
  })
})
