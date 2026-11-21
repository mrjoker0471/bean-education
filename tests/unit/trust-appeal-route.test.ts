// ─── BEAN Trust & Quality (Phase 6): appeal route tests ──────────────────────
// POST /api/teach/appeals (filing rules) and POST
// /api/admin/trust/appeals/:appealId/action (assign / decide) over a fake db:
//   • only eligible parties can file — complainant or the concerned teacher
//     (COMPLAINT_DECISION), the review author (REVIEW_MODERATION, hidden
//     reviews only), the restricted teacher (TRUST_ACTION);
//   • originalDecisionById is captured SERVER-SIDE from the audit trail;
//   • duplicate open appeals are rejected;
//   • DECIDE: only the assigned reviewer, never the original decision-maker
//     (self-review ban); UPHELD records the decision; OVERTURNED applies a
//     DOCUMENTED restoration (complaint re-opened with the original events
//     kept append-only, hidden review republished, trust action deactivated);
//   • ASSIGN requires an ADMIN reviewer;
//   • appeals never create payments or refunds (static verification);
//   • GET returns only the caller's own appeals (privacy-safe DTO).

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/** Read a repo source file relative to tests/unit (cwd-independent). */
const readSrc = (rel: string) => readFileSync(resolve(here, '..', '..', rel), 'utf8')

interface ComplaintRow {
  id: string
  complainantId: string
  teacherProfileId: string | null
  classSessionId: string | null
  classBookingId: string | null
  category: string
  severity: string
  isSensitive: boolean
  subject: string
  description: string
  status: string
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface ComplaintEventRow {
  id: string
  complaintId: string
  actorId: string
  actorRole: string
  action: string
  detail: string | null
  createdAt: Date
}

interface ReviewRow {
  id: string
  classSessionId: string
  studentId: string
  rating: number
  title: string | null
  reviewText: string
  status: string
  isVerified: boolean
  moderatedAt: Date | null
  moderationReason: string | null
  createdAt: Date
}

interface TrustActionRow {
  id: string
  teacherProfileId: string
  action: string
  reason: string
  startsAt: Date
  endsAt: Date | null
  isActive: boolean
  createdByAdminId: string
  endedAt: Date | null
  endedById: string | null
  createdAt: Date
}

interface AppealRow {
  id: string
  appellantId: string
  targetType: string
  targetId: string
  reason: string
  status: string
  originalDecisionById: string | null
  assignedReviewerId: string | null
  decision: string | null
  decisionNote: string | null
  decidedAt: Date | null
  createdAt: Date
}

interface AppealEventRow {
  id: string
  appealId: string
  actorId: string
  actorRole: string
  action: string
  detail: string | null
  createdAt: Date
}

interface AuditRow {
  entityType: string
  entityId: string
  actorId: string
  actorRole: string
  action: string
  detail: string | null
  createdAt: Date
}

const STUDENT1 = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT2 = { id: 'student-2', email: 's2@bean.example', displayName: 'Student Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const TEACHER1 = { id: 'teacher-1', email: 't1@bean.example', displayName: 'Teacher One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const TEACHER2 = { id: 'teacher-2', email: 't2@bean.example', displayName: 'Teacher Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const ADMIN1 = { id: 'admin-1', email: 'admin1@bean.example', displayName: 'Admin One', learningLevel: null, role: 'ADMIN', onboardedAt: null }
const ADMIN2 = { id: 'admin-2', email: 'admin2@bean.example', displayName: 'Admin Two', learningLevel: null, role: 'ADMIN', onboardedAt: null }

const APPEAL_REASON = 'The decision ignored the evidence I provided and I want it reviewed again.'
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600_000)

const state = {
  student: null as Record<string, unknown> | null,
  // actor for the requireAdmin mock (admin action route); null → 401.
  adminActor: null as Record<string, unknown> | null,
  students: new Map<string, { id: string; role: string }>(),
  teacherProfiles: new Map<string, { id: string; studentId: string; verificationStatus: string }>(),
  complaints: new Map<string, ComplaintRow>(),
  complaintEvents: [] as ComplaintEventRow[],
  reviews: new Map<string, ReviewRow>(),
  trustActions: new Map<string, TrustActionRow>(),
  appeals: [] as AppealRow[],
  appealEvents: [] as AppealEventRow[],
  auditEvents: [] as AuditRow[],
  nextComplaintEventId: 1,
  nextAppealId: 1,
  nextAppealEventId: 1,
  nextAuditId: 1,
  nextSeedId: 1,
}

function resetState() {
  state.student = null
  state.adminActor = null
  state.students = new Map()
  for (const s of [STUDENT1, STUDENT2, TEACHER1, TEACHER2, ADMIN1, ADMIN2]) {
    state.students.set(s.id, { id: s.id, role: s.role })
  }
  state.teacherProfiles = new Map()
  state.teacherProfiles.set('tp-1', { id: 'tp-1', studentId: 'teacher-1', verificationStatus: 'APPROVED' })
  state.teacherProfiles.set('tp-2', { id: 'tp-2', studentId: 'teacher-2', verificationStatus: 'APPROVED' })
  state.complaints = new Map()
  state.complaints.set('comp-1', {
    id: 'comp-1',
    complainantId: 'student-1',
    teacherProfileId: 'tp-1',
    classSessionId: 'c1',
    classBookingId: 'bk-1',
    category: 'TEACHER_CONDUCT',
    severity: 'HIGH',
    isSensitive: false,
    subject: 'Conduct concern during the live class',
    description: 'The teacher ended the class early and spoke dismissively to several students during the session.',
    status: 'RESOLVED',
    resolvedAt: daysAgo(1),
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
  })
  state.complaints.set('comp-2', {
    id: 'comp-2',
    complainantId: 'student-1',
    teacherProfileId: 'tp-1',
    classSessionId: 'c1',
    classBookingId: 'bk-1',
    category: 'TEACHING_QUALITY',
    severity: 'NORMAL',
    isSensitive: false,
    subject: 'Class did not match the outline',
    description: 'Most of the session was spent on unrelated topics and the promised materials were never shared.',
    status: 'OPEN',
    resolvedAt: null,
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
  })
  state.complaintEvents = [
    {
      id: 'ce-seed-1',
      complaintId: 'comp-1',
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      action: 'RESOLVED',
      detail: 'Conduct review completed — decision recorded.',
      createdAt: daysAgo(1),
    },
  ]
  state.reviews = new Map()
  state.reviews.set('rv-own', {
    id: 'rv-own',
    classSessionId: 'c1',
    studentId: 'student-1',
    rating: 2,
    title: 'Not as described',
    reviewText: 'The class covered far less than the outline promised and felt unprepared throughout.',
    status: 'HIDDEN',
    isVerified: true,
    moderatedAt: daysAgo(1),
    moderationReason: 'Hidden during moderation review',
    createdAt: daysAgo(2),
  })
  state.reviews.set('rv-other', {
    id: 'rv-other',
    classSessionId: 'c1',
    studentId: 'student-2',
    rating: 1,
    title: 'Poor experience',
    reviewText: 'The session never covered the advertised subject matter at any point during the hour.',
    status: 'HIDDEN',
    isVerified: true,
    moderatedAt: daysAgo(1),
    moderationReason: 'Hidden during moderation review',
    createdAt: daysAgo(2),
  })
  state.reviews.set('rv-public', {
    id: 'rv-public',
    classSessionId: 'c1',
    studentId: 'student-1',
    rating: 5,
    title: 'Great class',
    reviewText: 'Clear explanations, useful exercises and the teacher answered every question patiently.',
    status: 'PUBLISHED',
    isVerified: true,
    moderatedAt: null,
    moderationReason: null,
    createdAt: daysAgo(3),
  })
  state.trustActions = new Map()
  state.trustActions.set('ta-1', {
    id: 'ta-1',
    teacherProfileId: 'tp-1',
    action: 'SUSPEND_PUBLISHING',
    reason: 'Investigation ongoing after conduct review',
    startsAt: daysAgo(1),
    endsAt: null,
    isActive: true,
    createdByAdminId: 'admin-1',
    endedAt: null,
    endedById: null,
    createdAt: daysAgo(1),
  })
  state.appeals = []
  state.appealEvents = []
  state.auditEvents = [
    // The admin who hid each hidden review (server-captured decision trail).
    { id: 'au-seed-1', entityType: 'CLASS_REVIEW', entityId: 'rv-own', actorId: 'admin-9', actorRole: 'ADMIN', action: 'REVIEW_HIDDEN', detail: 'Moderation hiding decision', createdAt: daysAgo(1) },
    { id: 'au-seed-2', entityType: 'CLASS_REVIEW', entityId: 'rv-other', actorId: 'admin-9', actorRole: 'ADMIN', action: 'REVIEW_HIDDEN', detail: 'Moderation hiding decision', createdAt: daysAgo(1) },
  ]
  state.nextComplaintEventId = 1
  state.nextAppealId = 1
  state.nextAppealEventId = 1
  state.nextAuditId = 1
  state.nextSeedId = 1
}

/** Point the session identity at an admin actor (role 'ADMIN') — or null. */
function setAdminActor(actor: Record<string, unknown> | null) {
  state.adminActor = actor
}

function sortDesc(rows: { createdAt: Date }[]): void {
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

const fakeDb = {
  teacherProfile: {
    findUnique: async ({ where }: { where: { id?: string; studentId?: string } }) => {
      if (where?.id !== undefined) return state.teacherProfiles.get(where.id) ?? null
      if (where?.studentId !== undefined) {
        for (const p of state.teacherProfiles.values()) if (p.studentId === where.studentId) return p
        return null
      }
      return null
    },
  },
  student: {
    findUnique: async ({ where }: { where: { id: string } }) => state.students.get(where.id) ?? null,
  },
  teachComplaint: {
    findUnique: async ({ where }: { where: { id: string } }) => state.complaints.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.complaints.get(where.id)
      if (!row) throw new Error('complaint not found')
      Object.assign(row, data)
      return row
    },
  },
  complaintEvent: {
    findFirst: async ({ where, orderBy }: { where: { complaintId?: string; action?: { in?: string[] } | string }; orderBy?: { createdAt?: string } }) => {
      const rows = state.complaintEvents.filter((e) => {
        if (where.complaintId !== undefined && e.complaintId !== where.complaintId) return false
        if (where.action) {
          const allowed = typeof where.action === 'string' ? [where.action] : where.action.in ?? []
          if (!allowed.includes(e.action)) return false
        }
        return true
      })
      if (orderBy?.createdAt === 'desc') sortDesc(rows)
      return rows[0] ?? null
    },
    findMany: async ({ where }: { where: { complaintId?: string } }) =>
      state.complaintEvents
        .filter((e) => where?.complaintId === undefined || e.complaintId === where.complaintId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: ComplaintEventRow = {
        id: `ce-${state.nextComplaintEventId++}`,
        complaintId: String(data.complaintId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.complaintEvents.push(row)
      return row
    },
  },
  classReview: {
    findUnique: async ({ where }: { where: { id: string } }) => state.reviews.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.reviews.get(where.id)
      if (!row) throw new Error('review not found')
      Object.assign(row, data)
      return row
    },
  },
  trustAction: {
    findUnique: async ({ where }: { where: { id: string } }) => state.trustActions.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.trustActions.get(where.id)
      if (!row) throw new Error('trust action not found')
      Object.assign(row, data)
      return row
    },
  },
  teachAuditEvent: {
    findFirst: async ({ where, orderBy }: { where: { entityType?: string; entityId?: string; action?: string }; orderBy?: { createdAt?: string } }) => {
      const rows = state.auditEvents.filter((e) => {
        if (where.entityType !== undefined && e.entityType !== where.entityType) return false
        if (where.entityId !== undefined && e.entityId !== where.entityId) return false
        if (where.action !== undefined && e.action !== where.action) return false
        return true
      })
      if (orderBy?.createdAt === 'desc') sortDesc(rows)
      return rows[0] ?? null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: AuditRow = {
        id: `au-${state.nextAuditId++}`,
        entityType: String(data.entityType),
        entityId: String(data.entityId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.auditEvents.push(row)
      return row
    },
  },
  teachAppeal: {
    findUnique: async ({ where }: { where: { id: string } }) => state.appeals.find((a) => a.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { appellantId?: string; targetType?: string; targetId?: string; status?: { in?: string[] } | string } }) => {
      const rows = state.appeals.filter((a) => {
        if (where.appellantId !== undefined && a.appellantId !== where.appellantId) return false
        if (where.targetType !== undefined && a.targetType !== where.targetType) return false
        if (where.targetId !== undefined && a.targetId !== where.targetId) return false
        if (where.status) {
          const allowed = typeof where.status === 'string' ? [where.status] : where.status.in ?? []
          if (!allowed.includes(a.status)) return false
        }
        return true
      })
      sortDesc(rows)
      return rows[0] ?? null
    },
    findMany: async ({ where, take }: { where?: { appellantId?: string }; take?: number }) => {
      const rows = state.appeals.filter((a) => !where?.appellantId || a.appellantId === where.appellantId)
      sortDesc(rows)
      const limited = take ? rows.slice(0, take) : rows
      return limited.map((a) => ({
        ...a,
        events: state.appealEvents
          .filter((e) => e.appealId === a.id)
          .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime()),
      }))
    },
    count: async ({ where }: { where: { appellantId?: string; createdAt?: { gt: Date } } }) =>
      state.appeals.filter((a) => {
        if (where.appellantId !== undefined && a.appellantId !== where.appellantId) return false
        if (where.createdAt?.gt && a.createdAt.getTime() <= where.createdAt.gt.getTime()) return false
        return true
      }).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: AppealRow = {
        id: `ap-${state.nextAppealId++}`,
        appellantId: String(data.appellantId),
        targetType: String(data.targetType),
        targetId: String(data.targetId),
        reason: String(data.reason),
        status: String(data.status),
        originalDecisionById: (data.originalDecisionById as string | null | undefined) ?? null,
        assignedReviewerId: (data.assignedReviewerId as string | null | undefined) ?? null,
        decision: (data.decision as string | null | undefined) ?? null,
        decisionNote: (data.decisionNote as string | null | undefined) ?? null,
        decidedAt: (data.decidedAt as Date | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.appeals.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.appeals.find((a) => a.id === where.id)
      if (!row) throw new Error('appeal not found')
      Object.assign(row, data)
      return row
    },
  },
  appealEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: AppealEventRow = {
        id: `ae-${state.nextAppealEventId++}`,
        appealId: String(data.appealId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.appealEvents.push(row)
      return row
    },
    findMany: async ({ where }: { where: { appealId?: string } }) =>
      state.appealEvents
        .filter((e) => where?.appealId === undefined || e.appealId === where.appealId)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  },
  // Not touched by these routes in the tested flows — present for surface parity.
  classSession: {
    findUnique: async () => null,
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  // The session identity: state.student for student routes; the admin action
  // route flows through the SAME requireStudent via the REAL requireAdmin
  // (role-driven) — setAdminActor(ACTOR) simply repoints this identity.
  requireStudent: async () => state.adminActor ?? state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.adminActor ?? state.student,
}))
// NOTE: '@/lib/teach' is NOT mocked — the real requireAdmin (role-based) and
// the real appendAudit (writes through the fake db) keep the shared-module
// contract intact across bun's single-process test run.
// The admin actor must carry role 'ADMIN' for the real guard to accept it.

const appealsRoute = await import('@/app/api/teach/appeals/route')
const adminActionRoute = await import('@/app/api/admin/trust/appeals/[appealId]/action/route')

function appealReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/teach/appeals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function adminActionReq(appealId: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/trust/appeals/${appealId}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function seedAppeal(overrides: Partial<AppealRow> = {}): AppealRow {
  const row: AppealRow = {
    id: `ap-seed-${state.nextSeedId++}`,
    appellantId: 'student-1',
    targetType: 'COMPLAINT_DECISION',
    targetId: 'comp-1',
    reason: APPEAL_REASON,
    status: 'SUBMITTED',
    originalDecisionById: 'admin-1',
    assignedReviewerId: null,
    decision: null,
    decisionNote: null,
    decidedAt: null,
    createdAt: daysAgo(2),
  }
  Object.assign(row, overrides)
  state.appeals.push(row)
  return row
}

function seedAppealEvent(appealId: string, action: string, actorId: string): AppealEventRow {
  const row: AppealEventRow = {
    id: `ae-seed-${state.nextAppealEventId++}`,
    appealId,
    actorId,
    actorRole: actorId.startsWith('admin') ? 'ADMIN' : 'STUDENT',
    action,
    detail: null,
    createdAt: daysAgo(2),
  }
  state.appealEvents.push(row)
  return row
}

describe('POST /api/teach/appeals — COMPLAINT_DECISION filing rules', () => {
  beforeEach(resetState)

  it('an eligible complainant can appeal a decided complaint — original decision captured server-side (201)', async () => {
    state.student = STUDENT1
    const res = await appealsRoute.POST(appealReq({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-1', reason: APPEAL_REASON }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.appeal.status).toBe('SUBMITTED')
    expect(body.appeal.id).toBeTruthy()

    expect(state.appeals).toHaveLength(1)
    const row = state.appeals[0]
    expect(row.appellantId).toBe('student-1')
    expect(row.targetType).toBe('COMPLAINT_DECISION')
    expect(row.targetId).toBe('comp-1')
    // Server-captured from the RESOLVED complaintEvent — never client-supplied.
    expect(row.originalDecisionById).toBe('admin-1')
    expect(row.status).toBe('SUBMITTED')

    const event = state.appealEvents.find((e) => e.appealId === row.id)
    expect(event).toBeDefined()
    expect(event!.action).toBe('SUBMITTED')
    expect(event!.actorId).toBe('student-1')
  })

  it('an unrelated student cannot appeal someone else\u2019s complaint decision (403)', async () => {
    state.student = STUDENT2
    const res = await appealsRoute.POST(appealReq({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-1', reason: APPEAL_REASON }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('You can only appeal decisions that concern you.')
    expect(state.appeals).toHaveLength(0)
    expect(state.appealEvents).toHaveLength(0)
  })

  it('the concerned teacher party CAN appeal a complaint that concerns their profile (201)', async () => {
    state.student = TEACHER1 // owns tp-1, which comp-1 concerns
    const res = await appealsRoute.POST(appealReq({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-1', reason: APPEAL_REASON }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.appeal.status).toBe('SUBMITTED')
    expect(state.appeals).toHaveLength(1)
    expect(state.appeals[0].appellantId).toBe('teacher-1')
    expect(state.appeals[0].originalDecisionById).toBe('admin-1')
  })

  it('a complaint that has not been decided yet cannot be appealed (409)', async () => {
    state.student = STUDENT1
    const res = await appealsRoute.POST(appealReq({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-2', reason: APPEAL_REASON }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('This case has not been decided yet.')
    expect(state.appeals).toHaveLength(0)
  })

  it('a duplicate open appeal for the same decision is rejected (409)', async () => {
    state.student = STUDENT1
    const first = await appealsRoute.POST(appealReq({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-1', reason: APPEAL_REASON }))
    expect(first.status).toBe(201)
    const second = await appealsRoute.POST(appealReq({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-1', reason: APPEAL_REASON }))
    expect(second.status).toBe(409)
    const body = await second.json()
    expect(body.error).toBe('An appeal for this decision is already open.')
    expect(state.appeals).toHaveLength(1)
  })
})

describe('POST /api/teach/appeals — REVIEW_MODERATION filing rules', () => {
  beforeEach(resetState)

  it('the review author can appeal a hidden review — hider captured from the audit trail (201)', async () => {
    state.student = STUDENT1
    const res = await appealsRoute.POST(appealReq({ targetType: 'REVIEW_MODERATION', targetId: 'rv-own', reason: APPEAL_REASON }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.appeal.status).toBe('SUBMITTED')
    expect(state.appeals).toHaveLength(1)
    // originalDecisionById comes from the latest REVIEW_HIDDEN TeachAuditEvent.
    expect(state.appeals[0].originalDecisionById).toBe('admin-9')
    expect(state.appeals[0].targetId).toBe('rv-own')
    expect(state.appeals[0].status).toBe('SUBMITTED')
    expect(state.appealEvents.some((e) => e.action === 'SUBMITTED' && e.appealId === state.appeals[0].id)).toBe(true)
  })

  it('a non-author cannot appeal someone else\u2019s review moderation (403)', async () => {
    state.student = STUDENT1 // rv-other belongs to student-2
    const res = await appealsRoute.POST(appealReq({ targetType: 'REVIEW_MODERATION', targetId: 'rv-other', reason: APPEAL_REASON }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('You can only appeal moderation of your own review.')
    expect(state.appeals).toHaveLength(0)
  })

  it('a review that is not hidden cannot be appealed (409)', async () => {
    state.student = STUDENT1 // rv-public is PUBLISHED
    const res = await appealsRoute.POST(appealReq({ targetType: 'REVIEW_MODERATION', targetId: 'rv-public', reason: APPEAL_REASON }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Only hidden reviews can be appealed.')
    expect(state.appeals).toHaveLength(0)
  })
})

describe('POST /api/teach/appeals — TRUST_ACTION filing rules', () => {
  beforeEach(resetState)

  it('the restricted teacher can appeal their own restriction — decision-maker captured (201)', async () => {
    state.student = TEACHER1 // owns tp-1, which ta-1 restricts
    const res = await appealsRoute.POST(appealReq({ targetType: 'TRUST_ACTION', targetId: 'ta-1', reason: APPEAL_REASON }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.appeal.status).toBe('SUBMITTED')
    expect(state.appeals).toHaveLength(1)
    // Server-captured from the TrustAction row's createdByAdminId.
    expect(state.appeals[0].originalDecisionById).toBe('admin-1')
    expect(state.appealEvents.some((e) => e.action === 'SUBMITTED')).toBe(true)
  })

  it('another teacher cannot appeal someone else\u2019s restriction (403)', async () => {
    state.student = TEACHER2 // owns tp-2, ta-1 targets tp-1
    const res = await appealsRoute.POST(appealReq({ targetType: 'TRUST_ACTION', targetId: 'ta-1', reason: APPEAL_REASON }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('You can only appeal trust actions on your own profile.')
    expect(state.appeals).toHaveLength(0)
  })
})

describe('GET /api/teach/appeals — own appeals only, privacy-safe DTO', () => {
  beforeEach(resetState)

  it('returns only the caller\u2019s own appeals with the status timeline', async () => {
    const own = seedAppeal({ appellantId: 'student-1' })
    seedAppealEvent(own.id, 'SUBMITTED', 'student-1')
    seedAppeal({ appellantId: 'student-2' })

    state.student = STUDENT1
    const res = await appealsRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.appeals).toHaveLength(1)
    expect(body.appeals[0].id).toBe(own.id)
    expect(body.appeals[0].status).toBe('SUBMITTED')
    expect(body.appeals[0].events).toHaveLength(1)
    expect(body.appeals[0].events[0].action).toBe('SUBMITTED')
    // The own-appeal DTO never exposes reviewer bookkeeping fields.
    expect(body.appeals[0]).not.toHaveProperty('originalDecisionById')
    expect(body.appeals[0]).not.toHaveProperty('assignedReviewerId')

    state.student = STUDENT2
    const res2 = await appealsRoute.GET()
    const body2 = await res2.json()
    expect(body2.appeals).toHaveLength(1)
    expect(body2.appeals[0].id).not.toBe(own.id)
  })
})

describe('Appeals never create payments or refunds (static)', () => {
  /** Strip // and /* *\/ comments so prose in headers is not mistaken for logic. */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
  }

  it('neither the filing route nor the admin action route contains refund/payment logic or imports', () => {
    for (const rel of [
      'src/app/api/teach/appeals/route.ts',
      'src/app/api/admin/trust/appeals/[appealId]/action/route.ts',
    ]) {
      const text = readSrc(rel)
      const code = stripComments(text)
      expect(/refund/i.test(code)).toBe(false)
      expect(/payment/i.test(code)).toBe(false)
      // No import from any payment/billing/charging module — not even attempted.
      expect(text).not.toMatch(/from\s*['"][^'"]*(pay|billing|charge|stripe|checkout)/i)
    }
  })
})

describe('POST /api/admin/trust/appeals/:id/action — DECIDE authorisation rules', () => {
  beforeEach(resetState)

  it('the admin who made the original decision cannot decide the appeal — self-review ban (403)', async () => {
    const appeal = seedAppeal({ originalDecisionById: 'admin-1', assignedReviewerId: 'admin-1' })
    setAdminActor(ADMIN1)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'UPHELD', decisionNote: 'The original decision stands.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('original decision')
    // Nothing was written — the appeal stays open and undecided.
    expect(appeal.status).toBe('SUBMITTED')
    expect(appeal.decision).toBeNull()
    expect(appeal.decidedAt).toBeNull()
    expect(state.appealEvents.some((e) => e.action === 'DECIDED')).toBe(false)
  })

  it('an admin who is not the assigned reviewer cannot decide (403)', async () => {
    const appeal = seedAppeal({ originalDecisionById: 'admin-1', assignedReviewerId: 'admin-2' })
    setAdminActor(ADMIN1) // signed in, but not the reviewer
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'UPHELD', decisionNote: 'Trying to decide anyway.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('Only the assigned reviewer')
    expect(appeal.status).toBe('SUBMITTED')
    expect(state.appealEvents.some((e) => e.action === 'DECIDED')).toBe(false)
  })

  it('deciding without an assigned reviewer is refused (409)', async () => {
    const appeal = seedAppeal({ assignedReviewerId: null })
    setAdminActor(ADMIN2)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'UPHELD', decisionNote: 'No reviewer assigned yet.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Assign a reviewer before deciding.')
  })

  it('the assigned reviewer decides UPHELD — decision recorded on the appeal and audited (200)', async () => {
    const appeal = seedAppeal({ originalDecisionById: 'admin-1', assignedReviewerId: 'admin-2' })
    seedAppealEvent(appeal.id, 'SUBMITTED', 'student-1')
    setAdminActor(ADMIN2)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'UPHELD', decisionNote: 'Reviewed in full; the original decision was correct.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.decision).toBe('UPHELD')

    expect(appeal.status).toBe('UPHELD')
    expect(appeal.decision).toBe('UPHELD')
    expect(appeal.decisionNote).toBe('Reviewed in full; the original decision was correct.')
    expect(appeal.decidedAt).not.toBeNull()

    const decided = state.appealEvents.find((e) => e.appealId === appeal.id && e.action === 'DECIDED')
    expect(decided).toBeDefined()
    expect(decided!.actorId).toBe('admin-2')
    expect(decided!.actorRole).toBe('ADMIN')
    expect(decided!.detail).toContain('UPHELD')
  })
})

describe('POST /api/admin/trust/appeals/:id/action — OVERTURNED applies a documented restoration', () => {
  beforeEach(resetState)

  it('OVERTURNED on COMPLAINT_DECISION re-opens the complaint while the original RESOLVED event remains (append-only)', async () => {
    const appeal = seedAppeal({ targetType: 'COMPLAINT_DECISION', targetId: 'comp-1', originalDecisionById: 'admin-1', assignedReviewerId: 'admin-2' })
    setAdminActor(ADMIN2)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'OVERTURNED', decisionNote: 'New evidence supports the complainant.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.decision).toBe('OVERTURNED')

    const complaint = state.complaints.get('comp-1')!
    expect(complaint.status).toBe('UNDER_REVIEW')
    expect(complaint.resolvedAt).toBeNull()

    // Append-only history: the ORIGINAL decision event is still there…
    const original = state.complaintEvents.find((e) => e.id === 'ce-seed-1')
    expect(original).toBeDefined()
    expect(original!.action).toBe('RESOLVED')
    expect(original!.actorId).toBe('admin-1')
    // …and a NEW re-open event was appended, referencing the appeal.
    const reOpened = state.complaintEvents.filter((e) => e.action === 'UNDER_REVIEW')
    expect(reOpened).toHaveLength(1)
    expect(reOpened[0].detail).toContain(appeal.id)
    expect(reOpened[0].actorId).toBe('admin-2')

    expect(appeal.status).toBe('OVERTURNED')
    expect(state.appealEvents.some((e) => e.appealId === appeal.id && e.action === 'DECIDED')).toBe(true)
  })

  it('OVERTURNED on REVIEW_MODERATION republishes the hidden review and audits REVIEW_RESTORED with the appeal id', async () => {
    const appeal = seedAppeal({ targetType: 'REVIEW_MODERATION', targetId: 'rv-own', originalDecisionById: 'admin-9', assignedReviewerId: 'admin-2' })
    setAdminActor(ADMIN2)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'OVERTURNED', decisionNote: 'The review did not breach the guidelines.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(200)

    const review = state.reviews.get('rv-own')!
    expect(review.status).toBe('PUBLISHED')
    expect(review.moderatedAt).not.toBeNull()
    expect(review.moderationReason).toContain(appeal.id)

    const audit = state.auditEvents.find((e) => e.action === 'REVIEW_RESTORED')
    expect(audit).toBeDefined()
    expect(audit!.entityType).toBe('CLASS_REVIEW')
    expect(audit!.entityId).toBe('rv-own')
    expect(audit!.actorId).toBe('admin-2')
    expect(audit!.detail).toContain(appeal.id)

    expect(appeal.status).toBe('OVERTURNED')
  })

  it('OVERTURNED on TRUST_ACTION deactivates the restriction row and audits TRUST_REINSTATE', async () => {
    const appeal = seedAppeal({ targetType: 'TRUST_ACTION', targetId: 'ta-1', originalDecisionById: 'admin-1', assignedReviewerId: 'admin-2' })
    setAdminActor(ADMIN2)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'DECIDE', decision: 'OVERTURNED', decisionNote: 'The restriction was disproportionate.' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(200)

    const actionRow = state.trustActions.get('ta-1')!
    expect(actionRow.isActive).toBe(false)
    expect(actionRow.endedById).toBe('admin-2')
    expect(actionRow.endedAt).not.toBeNull()

    const audit = state.auditEvents.find((e) => e.action === 'TRUST_REINSTATE')
    expect(audit).toBeDefined()
    expect(audit!.entityType).toBe('TRUST_ACTION')
    expect(audit!.entityId).toBe('ta-1')
    expect(audit!.detail).toContain(appeal.id)

    expect(appeal.status).toBe('OVERTURNED')
  })
})

describe('POST /api/admin/trust/appeals/:id/action — ASSIGN', () => {
  beforeEach(resetState)

  it('a non-ADMIN reviewer id is refused (400)', async () => {
    const appeal = seedAppeal()
    setAdminActor(ADMIN1)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'ASSIGN', reviewerId: 'student-2' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Appeals can only be assigned to BEAN administrators.')
    expect(appeal.assignedReviewerId).toBeNull()
    expect(state.appealEvents.some((e) => e.action === 'ASSIGNED')).toBe(false)
  })

  it('ASSIGN to an ADMIN sets the reviewer, appends the ASSIGNED event, and moves SUBMITTED → UNDER_REVIEW', async () => {
    const appeal = seedAppeal({ status: 'SUBMITTED', assignedReviewerId: null })
    setAdminActor(ADMIN1)
    const res = await adminActionRoute.POST(
      adminActionReq(appeal.id, { action: 'ASSIGN', reviewerId: 'admin-2' }),
      { params: Promise.resolve({ appealId: appeal.id }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    expect(appeal.assignedReviewerId).toBe('admin-2')
    expect(appeal.status).toBe('UNDER_REVIEW')

    const event = state.appealEvents.find((e) => e.appealId === appeal.id && e.action === 'ASSIGNED')
    expect(event).toBeDefined()
    expect(event!.actorId).toBe('admin-1')
    expect(event!.detail).toContain('admin-2')
  })
})
