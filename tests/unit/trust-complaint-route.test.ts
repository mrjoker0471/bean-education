// ─── BEAN Trust & Quality (Phase 6): complaint route tests ───────────────────
// Coverage (spec §15 — Complaints):
//   • POST /api/teach/complaints — guests 401; only booked students or the
//     class's own teacher may file a class-linked report (403 otherwise);
//     sensitivity/severity are SERVER-derived from the category; platform-level
//     reports (no class) are allowed only for SAFEGUARDING/HARASSMENT/OTHER.
//   • GET  /api/teach/complaints + /:id — complainant view only; another
//     student's complaint and a missing complaint return the SAME "not found"
//     answer; admin NOTE_ADDED details are redacted, the reporter's own
//     INFO_PROVIDED text is visible.
//   • PATCH /api/teach/complaints/:id — complainant-only INFO_PROVIDED events.
//   • Static guarantees — the teacher trust dashboard exposes an anonymous
//     open-complaint count only, and no teacher-facing route can read complaint
//     rows or change complaint status.
//   • POST /api/admin/trust/complaints/:id/action — ADMIN investigation:
//     ACKNOWLEDGE / RESOLVE / DISMISS / ASSIGN with exactly one event per
//     action, audit mirrors only for decisive steps, idempotent repeats.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface FakeEvent {
  id: string
  complaintId: string
  actorId: string
  actorRole: string
  action: string
  detail: string | null
  createdAt: Date
}

interface FakeComplaint {
  id: string
  complainantId: string
  classSessionId: string | null
  classBookingId: string | null
  teacherProfileId: string | null
  category: string
  severity: string
  isSensitive: boolean
  subject: string
  description: string
  status: string
  assignedAdminId: string | null
  resolvedAt: Date | null
  createdAt: Date
  updatedAt: Date
  events: FakeEvent[]
}

interface FakeClass {
  id: string
  title: string
  teacherProfileId: string
  status: string
}

/** The slice of the Prisma transaction client the complaint routes actually touch. */
interface ComplaintTx {
  teachComplaint: {
    findUnique(args: { where: { id: string } }): Promise<unknown>
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
  }
  complaintEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
  teachAuditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> }
}

const state = {
  student: null as Record<string, unknown> | null,
  admin: { id: 'admin-1', email: 'admin@bean.example', displayName: 'Admin', learningLevel: null, role: 'ADMIN', onboardedAt: null },
  classes: new Map<string, FakeClass>(),
  bookings: [] as { id: string; classSessionId: string; studentId: string; status: string }[],
  complaints: [] as FakeComplaint[],
  complaintEvents: [] as FakeEvent[],
  auditEvents: [] as { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail: string | null }[],
  // studentId → role (used by the admin ASSIGN target check)
  people: new Map<string, string>(),
  nextComplaintId: 1,
  nextEventId: 1,
}

function resetState() {
  state.student = null
  state.classes = new Map()
  state.bookings = []
  state.complaints = []
  state.complaintEvents = []
  state.auditEvents = []
  state.people = new Map([
    ['student-1', 'STUDENT'],
    ['student-2', 'STUDENT'],
    ['teacher-1', 'STUDENT'],
    ['admin-1', 'ADMIN'],
    ['admin-2', 'ADMIN'],
  ])
  state.nextComplaintId = 1
  state.nextEventId = 1
  state.classes.set('c1', { id: 'c1', title: 'Class One', teacherProfileId: 'tp-1', status: 'PUBLISHED' })
  state.bookings.push({ id: 'bk-1', classSessionId: 'c1', studentId: 'student-1', status: 'ATTENDED' })
}

function sortedEvents(row: FakeComplaint): FakeEvent[] {
  return [...row.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
}

const fakeDb = {
  classSession: {
    // The complaints route includes teacherProfile for the relationship check —
    // return the superset row with the relation attached.
    findUnique: async ({ where }: { where: { id: string } }) => {
      const cls = state.classes.get(where.id)
      if (!cls) return null
      return {
        ...cls,
        teacherProfile: { id: cls.teacherProfileId, studentId: cls.teacherProfileId === 'tp-1' ? 'teacher-1' : 'teacher-other' },
      }
    },
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      [...state.classes.values()].filter(c => where.id.in.includes(c.id)),
  },
  classBooking: {
    findUnique: async ({ where }: { where: { id?: string; classSessionId_studentId?: { classSessionId: string; studentId: string } } }) => {
      const k = where.classSessionId_studentId
      const row = k
        ? state.bookings.find(b => b.classSessionId === k.classSessionId && b.studentId === k.studentId)
        : where.id
          ? state.bookings.find(b => b.id === where.id)
          : undefined
      return row ?? null
    },
  },
  student: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const role = state.people.get(where.id)
      return role ? { id: where.id, role } : null
    },
  },
  teachComplaint: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = state.complaints.find(c => c.id === where.id)
      return row ? { ...row, events: sortedEvents(row) } : null
    },
    findMany: async (args: { where?: { complainantId?: string }; orderBy?: unknown; take?: number }) => {
      let rows = [...state.complaints]
      if (args.where?.complainantId) rows = rows.filter(c => c.complainantId === args.where!.complainantId)
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      if (args.take !== undefined) rows = rows.slice(0, args.take)
      return rows.map(row => ({ ...row, events: sortedEvents(row) }))
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date()
      const row: FakeComplaint = {
        id: `cmp-${state.nextComplaintId++}`,
        complainantId: String(data.complainantId),
        classSessionId: (data.classSessionId as string | null | undefined) ?? null,
        classBookingId: (data.classBookingId as string | null | undefined) ?? null,
        teacherProfileId: (data.teacherProfileId as string | null | undefined) ?? null,
        category: String(data.category),
        severity: String(data.severity ?? 'NORMAL'),
        isSensitive: Boolean(data.isSensitive ?? false),
        subject: String(data.subject),
        description: String(data.description),
        status: String(data.status ?? 'OPEN'),
        assignedAdminId: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
        events: [],
      }
      state.complaints.push(row)
      return { ...row, events: [] }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.complaints.find(c => c.id === where.id)
      if (!row) throw new Error('complaint not found')
      Object.assign(row, data)
      return { ...row, events: sortedEvents(row) }
    },
    count: async ({ where }: { where?: { complainantId?: string; createdAt?: { gt: Date } } }) => {
      const w = where ?? {}
      return state.complaints.filter(
        c =>
          (!w.complainantId || c.complainantId === w.complainantId) &&
          (!w.createdAt?.gt || c.createdAt.getTime() > w.createdAt.gt.getTime()),
      ).length
    },
  },
  complaintEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeEvent = {
        id: `evt-${state.nextEventId++}`,
        complaintId: String(data.complaintId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null | undefined) ?? null,
        createdAt: new Date(),
      }
      state.complaintEvents.push(row)
      const owner = state.complaints.find(c => c.id === row.complaintId)
      if (owner) owner.events.push(row)
      return row
    },
    findMany: async ({ where }: { where: { complaintId?: string } }) =>
      state.complaintEvents.filter(e => !where.complaintId || e.complaintId === where.complaintId),
    findFirst: async ({ where }: { where: { complaintId?: string; action?: string } }) =>
      state.complaintEvents.find(
        e =>
          (!where.complaintId || e.complaintId === where.complaintId) &&
          (!where.action || e.action === where.action),
      ) ?? null,
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.auditEvents.push({
        entityType: String(data.entityType),
        entityId: String(data.entityId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null) ?? null,
      })
      return {}
    },
  },
  $transaction: async (fn: (tx: ComplaintTx) => Promise<unknown>) => fn(fakeDb as unknown as ComplaintTx),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))
// NOTE: '@/lib/teach' is NOT mocked — the admin action route flows through the
// REAL requireAdmin (role-driven, reads the mocked auth) and the REAL
// appendAudit (writes through the fake db's teachAuditEvent.create). Keeping
// the module unmocked preserves the shared-module contract across bun's
// single-process test run. Admin tests sign in via the admin-acting beforeEach.
const complaintsRoute = await import('@/app/api/teach/complaints/route')
const detailRoute = await import('@/app/api/teach/complaints/[id]/route')
const actionRoute = await import('@/app/api/admin/trust/complaints/[id]/action/route')

const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT2 = { id: 'student-2', email: 's2@bean.example', displayName: 'Student Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const TEACHER = { id: 'teacher-1', email: 't1@bean.example', displayName: 'Teacher One', learningLevel: null, role: 'STUDENT', onboardedAt: null }

const SUBJECT = 'The class description was misleading'
const DESCRIPTION = 'The teacher arrived twenty minutes late and skipped most of the advertised practical exercises.'

function complaintReq(body: unknown): NextRequest {
  return new Request('http://localhost/api/teach/complaints', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function listReq(): NextRequest {
  return new Request('http://localhost/api/teach/complaints', { method: 'GET' }) as unknown as NextRequest
}

function detailReq(id: string): NextRequest {
  return new Request(`http://localhost/api/teach/complaints/${id}`, { method: 'GET' }) as unknown as NextRequest
}

function detailPatchReq(id: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/teach/complaints/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function actionReq(id: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/trust/complaints/${id}/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function seedComplaint(overrides: Partial<FakeComplaint> = {}): FakeComplaint {
  const now = new Date()
  const row: FakeComplaint = {
    id: `cmp-seed-${state.nextComplaintId++}`,
    complainantId: 'student-1',
    classSessionId: null,
    classBookingId: null,
    teacherProfileId: null,
    category: 'TEACHING_QUALITY',
    severity: 'NORMAL',
    isSensitive: false,
    subject: 'Seeded report subject line',
    description: 'Seeded description body used by this test case, long enough for the schema.',
    status: 'OPEN',
    assignedAdminId: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    events: [],
  }
  Object.assign(row, overrides)
  state.complaints.push(row)
  return row
}

function seedEvent(complaint: FakeComplaint, action: string, actorId: string, actorRole: string, detail: string | null): FakeEvent {
  const row: FakeEvent = {
    id: `evt-${state.nextEventId++}`,
    complaintId: complaint.id,
    actorId,
    actorRole,
    action,
    detail,
    createdAt: new Date(),
  }
  state.complaintEvents.push(row)
  complaint.events.push(row)
  return row
}

describe('POST /api/teach/complaints — filing a private report', () => {
  beforeEach(resetState)

  it('a guest cannot complain (401)', async () => {
    const res = await complaintsRoute.POST(
      complaintReq({ category: 'TEACHING_QUALITY', classSessionId: 'c1', subject: SUBJECT, description: DESCRIPTION }),
    )
    expect(res.status).toBe(401)
    expect(state.complaints).toHaveLength(0)
  })

  it('an unrelated user cannot report a class they neither booked nor taught (403)', async () => {
    state.student = STUDENT2 // has no booking in c1 and is not its teacher
    const res = await complaintsRoute.POST(
      complaintReq({ category: 'TEACHING_QUALITY', classSessionId: 'c1', subject: SUBJECT, description: DESCRIPTION }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('You can only report classes you booked or taught.')
    expect(state.complaints).toHaveLength(0)
  })

  it('a booked student CAN report (201) — server-derived fields, CREATED event appended', async () => {
    state.student = STUDENT
    const res = await complaintsRoute.POST(
      complaintReq({
        category: 'TEACHING_QUALITY',
        classSessionId: 'c1',
        subject: SUBJECT,
        description: DESCRIPTION,
        // Client attempts to assert sensitivity/severity/status are ignored:
        isSensitive: true,
        severity: 'LOW',
        status: 'RESOLVED',
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.complaint.id).toBeDefined()
    expect(body.complaint.status).toBe('OPEN')
    expect(body.complaint.isSensitive).toBe(false)

    const row = state.complaints.find(c => c.id === body.complaint.id)!
    expect(row.complainantId).toBe('student-1')
    expect(row.classSessionId).toBe('c1')
    expect(row.classBookingId).toBe('bk-1')
    expect(row.teacherProfileId).toBe('tp-1')
    expect(row.category).toBe('TEACHING_QUALITY')
    expect(row.severity).toBe('NORMAL') // server-derived for TEACHING_QUALITY
    expect(row.isSensitive).toBe(false) // client assertion ignored
    expect(row.status).toBe('OPEN') // client assertion ignored
    expect(row.resolvedAt).toBeNull()

    const events = state.complaintEvents.filter(e => e.complaintId === row.id)
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('CREATED')
    expect(events[0].actorId).toBe('student-1')
    expect(events[0].actorRole).toBe('STUDENT')
    expect(events[0].detail).toBeNull()
  })

  it('the class\u2019s own teacher can report their class (201)', async () => {
    state.student = TEACHER // no booking, but the c1 teacherProfile owner
    const res = await complaintsRoute.POST(
      complaintReq({ category: 'STUDENT_CONDUCT', classSessionId: 'c1', subject: SUBJECT, description: DESCRIPTION }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    const row = state.complaints.find(c => c.id === body.complaint.id)!
    expect(row.complainantId).toBe('teacher-1')
    expect(row.classBookingId).toBeNull() // the teacher holds no booking
  })

  it('sensitivity and severity are server-derived; platform-level reports need a sensitive category', async () => {
    state.student = STUDENT
    // A non-sensitive category WITHOUT a class is rejected by the schema (400):
    const noClass = await complaintsRoute.POST(
      complaintReq({ category: 'TEACHING_QUALITY', subject: SUBJECT, description: DESCRIPTION }),
    )
    expect(noClass.status).toBe(400)

    // SAFEGUARDING is allowed platform-level (no classSessionId) and is
    // automatically sensitive + HIGH severity:
    const safeguarding = await complaintsRoute.POST(
      complaintReq({ category: 'SAFEGUARDING', subject: 'Someone asked me to keep our chats secret', description: DESCRIPTION }),
    )
    expect(safeguarding.status).toBe(201)
    const sBody = await safeguarding.json()
    expect(sBody.complaint.isSensitive).toBe(true)
    const sRow = state.complaints.find(c => c.id === sBody.complaint.id)!
    expect(sRow.severity).toBe('HIGH')
    expect(sRow.isSensitive).toBe(true)
    expect(sRow.classSessionId).toBeNull()
    expect(sRow.teacherProfileId).toBeNull()

    // HARASSMENT is platform-reportable too:
    const harassment = await complaintsRoute.POST(
      complaintReq({ category: 'HARASSMENT', subject: 'Repeated unwanted messages after class', description: DESCRIPTION }),
    )
    expect(harassment.status).toBe(201)
    const hRow = state.complaints.find(c => c.category === 'HARASSMENT')!
    expect(hRow.isSensitive).toBe(true)
    expect(hRow.severity).toBe('HIGH')
  })
})

describe('GET /api/teach/complaints — complainant\u2019s own list', () => {
  beforeEach(resetState)

  it('a guest cannot list reports (401)', async () => {
    const res = await complaintsRoute.GET()
    expect(res.status).toBe(401)
  })

  it('lists only the caller\u2019s own reports with class titles — never anyone else\u2019s', async () => {
    state.student = STUDENT
    const mine = seedComplaint({ classSessionId: 'c1', classBookingId: 'bk-1', teacherProfileId: 'tp-1' })
    seedEvent(mine, 'CREATED', 'student-1', 'STUDENT', null)
    const other = seedComplaint({ complainantId: 'student-2' })
    seedEvent(other, 'CREATED', 'student-2', 'STUDENT', null)

    const res = await complaintsRoute.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.complaints).toHaveLength(1)
    expect(body.complaints[0].id).toBe(mine.id)
    expect(body.complaints[0].classTitle).toBe('Class One')
    expect(body.complaints[0].status).toBe('OPEN')
    expect(JSON.stringify(body)).not.toContain(other.id)
    expect(JSON.stringify(body)).not.toContain('student-2')
  })
})

describe('GET /api/teach/complaints/:id — own case file', () => {
  beforeEach(resetState)

  it('a student cannot view another user\u2019s complaint — identical answer as a missing one (404, no existence leak)', async () => {
    state.student = STUDENT
    const other = seedComplaint({ complainantId: 'student-2' })
    seedEvent(other, 'CREATED', 'student-2', 'STUDENT', null)

    const resOther = await detailRoute.GET(detailReq(other.id), { params: Promise.resolve({ id: other.id }) })
    const resMissing = await detailRoute.GET(detailReq('cmp-none'), { params: Promise.resolve({ id: 'cmp-none' }) })
    expect(resOther.status).toBe(404)
    expect(resMissing.status).toBe(404)
    const bodyOther = await resOther.json()
    const bodyMissing = await resMissing.json()
    expect(bodyOther.error).toBe('Report not found')
    expect(bodyOther.error).toBe(bodyMissing.error)
  })

  it('the complainant sees their own case file — admin notes redacted, own information visible', async () => {
    state.student = STUDENT
    const cmp = seedComplaint({ classSessionId: 'c1', subject: 'Teacher repeatedly changed the schedule' })
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)
    seedEvent(cmp, 'NOTE_ADDED', 'admin-1', 'ADMIN', 'Internal investigation note for operators')
    seedEvent(cmp, 'INFO_PROVIDED', 'student-1', 'STUDENT', 'This happens every Tuesday session.')

    const res = await detailRoute.GET(detailReq(cmp.id), { params: Promise.resolve({ id: cmp.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.complaint.id).toBe(cmp.id)
    expect(body.complaint.status).toBe('OPEN')
    expect(body.complaint.classTitle).toBe('Class One')
    const events = body.complaint.events.map((e: { action: string }) => e.action)
    expect(events).toEqual(['CREATED', 'NOTE_ADDED', 'INFO_PROVIDED'])
    const note = body.complaint.events.find((e: { action: string }) => e.action === 'NOTE_ADDED')
    expect(note.detail).toBeNull() // redacted for the complainant
    expect(note.actorRole).toBe('ADMIN') // the action itself stays visible
    const info = body.complaint.events.find((e: { action: string }) => e.action === 'INFO_PROVIDED')
    expect(info.detail).toBe('This happens every Tuesday session.')
    expect(JSON.stringify(body)).not.toContain('Internal investigation note for operators')
    expect(JSON.stringify(body)).not.toContain('admin@bean.example')
  })
})

describe('PATCH /api/teach/complaints/:id — complainant adds information', () => {
  beforeEach(resetState)

  it('the complainant can supply information (INFO_PROVIDED event appended)', async () => {
    state.student = STUDENT
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)
    const before = state.complaintEvents.length

    const res = await detailRoute.PATCH(
      detailPatchReq(cmp.id, { detail: 'Attended three sessions; the issue repeats every week.' }),
      { params: Promise.resolve({ id: cmp.id }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(state.complaintEvents.length).toBe(before + 1)
    const evt = state.complaintEvents[state.complaintEvents.length - 1]
    expect(evt.action).toBe('INFO_PROVIDED')
    expect(evt.complaintId).toBe(cmp.id)
    expect(evt.actorId).toBe('student-1')
    expect(evt.actorRole).toBe('STUDENT')
    expect(evt.detail).toBe('Attended three sessions; the issue repeats every week.')
    // The complaint status is NOT changed by supplying information:
    expect(cmp.status).toBe('OPEN')
  })

  it('a student cannot add information to someone else\u2019s complaint (404, nothing appended)', async () => {
    state.student = STUDENT2
    const cmp = seedComplaint({ complainantId: 'student-1' })
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)
    const before = state.complaintEvents.length

    const res = await detailRoute.PATCH(
      detailPatchReq(cmp.id, { detail: 'Trying to append to another user\u2019s case.' }),
      { params: Promise.resolve({ id: cmp.id }) },
    )
    expect(res.status).toBe(404)
    expect(state.complaintEvents.length).toBe(before)
  })
})

describe('static privacy guarantees — teachers never see complaint content or status levers', () => {
  it('the teacher trust dashboard exposes only an anonymous open-complaint count', () => {
    const text = readFileSync(join(import.meta.dir, '..', '..', 'src', 'app', 'api', 'teach', 'trust', 'route.ts'), 'utf8')
    expect(text).toContain('openComplaintCount')
    // No DTO is ever built from complaint rows — count only:
    expect(text).not.toContain('toOwnComplaint(')
    expect(text).not.toContain('teachComplaint.findMany(')
  })

  it('the complaint detail route only exports GET and PATCH; PATCH only appends INFO_PROVIDED (never decides)', () => {
    const text = readFileSync(join(import.meta.dir, '..', '..', 'src', 'app', 'api', 'teach', 'complaints', '[id]', 'route.ts'), 'utf8')
    const handlers = [...text.matchAll(/export async function (\w+)/g)].map(m => m[1]).sort()
    expect(handlers).toEqual(['GET', 'PATCH'])
    expect(text).toContain('INFO_PROVIDED')
    // No decision status can be written by this route:
    expect(text).not.toContain('RESOLVED')
    expect(text).not.toContain('DISMISSED')
  })
})

describe('POST /api/admin/trust/complaints/:id/action — admin investigation workflow', () => {
  beforeEach(resetState)
  // The REAL requireAdmin reads the session identity — admin tests act as the
  // ADMIN-role account (state.admin carries role 'ADMIN').
  beforeEach(() => {
    state.student = state.admin
  })

  it('a missing complaint gets 404', async () => {
    const res = await actionRoute.POST(actionReq('cmp-none', { action: 'ACKNOWLEDGE' }), {
      params: Promise.resolve({ id: 'cmp-none' }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Complaint not found')
  })

  it('ACKNOWLEDGE moves OPEN → ACKNOWLEDGED with exactly one event and no automatic consequences', async () => {
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)
    const before = state.complaintEvents.length

    const res = await actionRoute.POST(actionReq(cmp.id, { action: 'ACKNOWLEDGE' }), {
      params: Promise.resolve({ id: cmp.id }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.status).toBe('ACKNOWLEDGED')

    expect(cmp.status).toBe('ACKNOWLEDGED')
    expect(cmp.resolvedAt).toBeNull() // acknowledging never decides the case

    expect(state.complaintEvents.length).toBe(before + 1)
    const ack = state.complaintEvents[state.complaintEvents.length - 1]
    expect(ack.action).toBe('ACKNOWLEDGED')
    expect(ack.actorId).toBe('admin-1')
    expect(ack.actorRole).toBe('ADMIN')

    // Only decisive steps (RESOLVED / DISMISSED / ESCALATE) are mirrored into
    // the BEAN Teach audit trail — acknowledging is not.
    expect(state.auditEvents.filter(e => e.entityType === 'COMPLAINT')).toHaveLength(0)
  })

  it('RESOLVE records the decision: status, resolvedAt, event and the COMPLAINT audit mirror', async () => {
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)
    const before = state.complaintEvents.length

    const res = await actionRoute.POST(
      actionReq(cmp.id, { action: 'RESOLVE', note: 'Investigated with both sides; the class description was corrected.' }),
      { params: Promise.resolve({ id: cmp.id }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('RESOLVED')

    expect(cmp.status).toBe('RESOLVED')
    expect(cmp.resolvedAt).not.toBeNull()
    expect(state.complaintEvents.length).toBe(before + 1)
    expect(state.complaintEvents[state.complaintEvents.length - 1].action).toBe('RESOLVED')

    const audit = state.auditEvents.find(e => e.entityType === 'COMPLAINT' && e.entityId === cmp.id)
    expect(audit).toBeDefined()
    expect(audit!.action).toBe('RESOLVED')
    expect(audit!.actorId).toBe('admin-1')
    expect(audit!.actorRole).toBe('ADMIN')
  })

  it('DISMISS without a written reason is rejected (400) — the schema requires a note', async () => {
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)
    const before = state.complaintEvents.length

    const res = await actionRoute.POST(actionReq(cmp.id, { action: 'DISMISS' }), {
      params: Promise.resolve({ id: cmp.id }),
    })
    expect(res.status).toBe(400)
    expect(cmp.status).toBe('OPEN') // untouched
    expect(cmp.resolvedAt).toBeNull()
    expect(state.complaintEvents.length).toBe(before) // no events appended
    expect(state.auditEvents).toHaveLength(0)
  })

  it('ASSIGN routes the case to an administrator and appends an assignment event', async () => {
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)

    const res = await actionRoute.POST(actionReq(cmp.id, { action: 'ASSIGN', assignedAdminId: 'admin-2' }), {
      params: Promise.resolve({ id: cmp.id }),
    })
    expect(res.status).toBe(200)
    expect(cmp.assignedAdminId).toBe('admin-2')
    expect(state.complaintEvents.filter(e => e.complaintId === cmp.id).map(e => e.action)).toEqual([
      'CREATED',
      'ASSIGNMENT_CHANGED',
    ])
  })

  it('repeating ACKNOWLEDGE does not duplicate events — the case is left unchanged', async () => {
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)

    const first = await actionRoute.POST(actionReq(cmp.id, { action: 'ACKNOWLEDGE' }), {
      params: Promise.resolve({ id: cmp.id }),
    })
    expect(first.status).toBe(200)
    expect(((await first.json()) as { status?: string }).status).toBe('ACKNOWLEDGED')
    const eventsAfterFirst = state.complaintEvents.length

    const second = await actionRoute.POST(actionReq(cmp.id, { action: 'ACKNOWLEDGE' }), {
      params: Promise.resolve({ id: cmp.id }),
    })
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { ok?: boolean; unchanged?: boolean; status?: string }
    expect(secondBody.ok).toBe(true)
    // A repeat ACKNOWLEDGE maps to a null event in plan() — no duplicate rows
    // are written (the explicit `unchanged: true` no-op payload is reserved for
    // the RESOLVE/DISMISS/ASSIGN/ESCALATE repeats in the route file).
    expect(state.complaintEvents.length).toBe(eventsAfterFirst)
    expect(state.complaintEvents.filter(e => e.action === 'ACKNOWLEDGED')).toHaveLength(1)
    expect(cmp.status).toBe('ACKNOWLEDGED')
  })

  it('repeating RESOLVE is an explicit no-op — unchanged: true, no extra events or audits', async () => {
    const cmp = seedComplaint()
    seedEvent(cmp, 'CREATED', 'student-1', 'STUDENT', null)

    const first = await actionRoute.POST(
      actionReq(cmp.id, { action: 'RESOLVE', note: 'Investigated with both sides; the class description was corrected.' }),
      { params: Promise.resolve({ id: cmp.id }) },
    )
    expect(first.status).toBe(200)
    const eventsAfterFirst = state.complaintEvents.length
    const auditsAfterFirst = state.auditEvents.length

    const second = await actionRoute.POST(
      actionReq(cmp.id, { action: 'RESOLVE', note: 'Investigated with both sides; the class description was corrected.' }),
      { params: Promise.resolve({ id: cmp.id }) },
    )
    expect(second.status).toBe(200)
    const body = (await second.json()) as { ok?: boolean; unchanged?: boolean }
    expect(body.ok).toBe(true)
    expect(body.unchanged).toBe(true)
    expect(state.complaintEvents.length).toBe(eventsAfterFirst)
    expect(state.auditEvents.length).toBe(auditsAfterFirst)
    expect(state.complaintEvents.filter(e => e.action === 'RESOLVED')).toHaveLength(1)
  })
})
