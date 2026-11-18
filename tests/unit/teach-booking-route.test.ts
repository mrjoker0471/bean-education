// ─── BEAN Teach (Phase 4A): booking, cancellation & attendance route tests ───
// The concurrency case (two students racing for the last seat) is exercised
// through the REAL route transaction: the fake db implements the exact
// conditional-claim semantics of SEAT_CLAIM_SQL atomically, and both bookings
// fire in parallel via Promise.all — exactly one must win.
// A separate real-SQLite test (teach-seat-sql.test.ts) proves the production
// SQL itself against an actual SQLite engine.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { SEAT_CLAIM_SQL, SEAT_RELEASE_SQL } from '@/lib/teach-booking'

interface FakeClass {
  id: string
  teacherProfileId: string
  teacherProfile: { studentId: string; teachingName: string }
  status: string
  startsAt: Date
  durationMinutes: number
  capacity: number
  bookedCount: number
}

interface FakeBooking {
  id: string
  classSessionId: string
  studentId: string
  status: string
  bookedAt: Date
  cancelledAt: Date | null
  attendanceMarkedAt: Date | null
}

const state = {
  student: null as Record<string, unknown> | null,
  classes: new Map<string, FakeClass>(),
  bookings: [] as FakeBooking[],
  nextBookingId: 1,
  auditEvents: [] as { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail: string | null }[],
}

function resetState() {
  state.student = null
  state.classes = new Map()
  state.bookings = []
  state.nextBookingId = 1
  state.auditEvents = []
  state.classes.set('c1', {
    id: 'c1',
    teacherProfileId: 'tp-owner',
    teacherProfile: { studentId: 'teacher-1', teachingName: 'Prof One' },
    status: 'PUBLISHED',
    startsAt: new Date(Date.now() + 7 * 24 * 3600_000),
    durationMinutes: 60,
    capacity: 1, // ONE seat — perfect for last-seat races
    bookedCount: 0,
  })
}

function bookingKey(classId: string, studentId: string) {
  return `${classId}:${studentId}`
}

// Atomic conditional seat claim — mirrors SEAT_CLAIM_SQL semantics exactly.
function claimSeat(classId: string, now: Date): number {
  const cls = state.classes.get(classId)
  if (!cls) return 0
  if (cls.status !== 'PUBLISHED') return 0
  if (cls.startsAt.getTime() <= now.getTime()) return 0
  if (cls.bookedCount >= cls.capacity) return 0
  cls.bookedCount += 1
  return 1
}

function releaseSeat(classId: string): number {
  const cls = state.classes.get(classId)
  if (!cls || cls.bookedCount <= 0) return 0
  cls.bookedCount -= 1
  return 1
}

const fakeDb = {
  classSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.classes.get(where.id) ?? null,
  },
  // Phase 5: live-session rows do not exist in Phase 4A booking scenarios —
  // the booking route checks this table inside its transaction (null = no
  // live session → bookings flow exactly as before).
  liveClassSession: {
    findUnique: async () => null,
  },
  // Phase 6: the booking route consults trust restrictions (trustStateFor).
  // No restriction rows exist in Phase 4A scenarios → bookings flow unchanged.
  trustAction: {
    findMany: async () => [],
  },
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string } }) => {
      if (!where?.studentId) return null
      // The owner teacher's profile (studentId → profile).
      if (where.studentId === 'teacher-1') return { id: 'tp-owner', studentId: 'teacher-1', teachingName: 'Prof One', verificationStatus: 'APPROVED' }
      if (where.studentId === 'teacher-2') return { id: 'tp-other', studentId: 'teacher-2', teachingName: 'Prof Two', verificationStatus: 'APPROVED' }
      return null
    },
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
  classBooking: {
    findUnique: async ({ where }: { where: { id?: string; classSessionId_studentId?: { classSessionId: string; studentId: string } } }) => {
      const row = where.id
        ? state.bookings.find(b => b.id === where.id)
        : where.classSessionId_studentId
          ? state.bookings.find(
              b =>
                bookingKey(b.classSessionId, b.studentId) ===
                bookingKey(where.classSessionId_studentId!.classSessionId, where.classSessionId_studentId!.studentId),
            )
          : undefined
      if (!row) return null
      // Attach the class (routes include classSession for schedule/ownership checks).
      return { ...row, classSession: state.classes.get(row.classSessionId) ?? null }
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeBooking = {
        id: `bk-${state.nextBookingId++}`,
        classSessionId: String(data.classSessionId),
        studentId: String(data.studentId),
        status: String(data.status ?? 'CONFIRMED'),
        bookedAt: (data.bookedAt as Date) ?? new Date(),
        cancelledAt: null,
        attendanceMarkedAt: null,
      }
      state.bookings.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.bookings.find(b => b.id === where.id)
      if (!row) throw new Error('booking not found')
      Object.assign(row, data)
      return row
    },
  },
  $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
    if (sql === SEAT_CLAIM_SQL) return claimSeat(String(params[1]), new Date(Number(params[0])))
    if (sql === SEAT_RELEASE_SQL) return releaseSeat(String(params[1]))
    throw new Error(`unexpected raw SQL in test: ${sql.slice(0, 60)}`)
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const bookRoute = await import('@/app/api/teach/classes/[id]/book/route')
const attendanceRoute = await import('@/app/api/teach/classes/[id]/attendance/route')

const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT2 = { id: 'student-2', email: 's2@bean.example', displayName: 'Student Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const OWNER = { id: 'teacher-1', email: 't1@bean.example', displayName: 'Teacher One', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function bookReq(classId: string, method: string): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/book`, { method }) as unknown as NextRequest
}

function attendanceReq(classId: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/attendance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('POST /api/teach/classes/:id/book — booking rules', () => {
  beforeEach(resetState)

  it('a guest cannot book (401)', async () => {
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(401)
  })

  it('a signed-in student can book a free seat (201)', async () => {
    state.student = STUDENT
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.booking.status).toBe('CONFIRMED')
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
  })

  it('a duplicate booking is prevented (409)', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('a student cannot book their own class (403)', async () => {
    state.student = OWNER
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('a full class refuses new bookings (409) and bookedCount never exceeds capacity', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    state.student = STUDENT2
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
  })

  it('a draft class is invisible to students (404)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, status: 'DRAFT' })
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
  })

  it('a cancelled class cannot take bookings (409)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, status: 'CANCELLED' })
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('a started class cannot take bookings (409)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() - 60_000) })
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })
})

describe('CONCURRENT last-seat booking — capacity can never be exceeded', () => {
  beforeEach(resetState)

  it('exactly one of two parallel bookings for the last seat wins', async () => {
    state.student = STUDENT
    const p1 = bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    state.student = STUDENT2
    const p2 = bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    const [r1, r2] = await Promise.all([p1, p2])
    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual([201, 409])
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
    expect(state.bookings).toHaveLength(1)
  })

  it('one winner among three parallel bookings when capacity is one', async () => {
    state.classes.set('c1', { ...state.classes.get('c1')!, capacity: 1 })
    const students = [STUDENT, STUDENT2, { id: 'student-3', email: 's3@bean.example', displayName: 'S3', learningLevel: null, role: 'STUDENT', onboardedAt: null }]
    const results = await Promise.all(
      students.map(s => {
        state.student = s
        return bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
      }),
    )
    const ok = results.filter(r => r.status === 201).length
    expect(ok).toBe(1)
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
  })
})

describe('DELETE /api/teach/classes/:id/book — cancellation rules', () => {
  beforeEach(resetState)

  it('the owner can cancel inside the window and the seat is released', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
    const res = await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect(state.classes.get('c1')!.bookedCount).toBe(0)
    expect(state.bookings[0].status).toBe('CANCELLED')
    expect(state.bookings[0].cancelledAt).not.toBeNull()
  })

  it('a student without a booking gets 404', async () => {
    state.student = STUDENT
    const res = await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
  })

  it('cancelling twice is refused (404) — no double release, bookedCount intact', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    const second = await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    expect(second.status).toBe(404)
    expect(state.classes.get('c1')!.bookedCount).toBe(0)
  })

  it('another student cannot cancel someone else\u2019s booking — lookup is scoped to the caller', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    state.student = STUDENT2
    const res = await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
    expect(state.bookings[0].status).toBe('CONFIRMED')
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
  })

  it('cancellation after the class started is refused — window closed (409)', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() - 60_000) })
    const res = await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
    expect(state.bookings[0].status).toBe('CONFIRMED')
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
  })

  it('rebooking after cancellation re-activates the SAME record (no duplicates, seat re-claimed)', async () => {
    state.student = STUDENT
    await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    await bookRoute.DELETE(bookReq('c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) })
    const res = await bookRoute.POST(bookReq('c1', 'POST'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(201)
    expect(state.bookings).toHaveLength(1) // same row, re-activated
    expect(state.bookings[0].status).toBe('CONFIRMED')
    expect(state.classes.get('c1')!.bookedCount).toBe(1)
  })
})

describe('POST /api/teach/classes/:id/attendance — attendance rules', () => {
  beforeEach(resetState)

  it('a guest cannot mark attendance (401) — no teacher profile', async () => {
    const res = await attendanceRoute.POST(attendanceReq('c1', { bookingId: 'bk-1', status: 'ATTENDED' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(401)
  })

  it('attendance cannot be marked before the class ends (409)', async () => {
    state.student = OWNER
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() + 3600_000) })
    state.bookings.push({ id: 'bk-1', classSessionId: 'c1', studentId: 'student-1', status: 'CONFIRMED', bookedAt: new Date(), cancelledAt: null, attendanceMarkedAt: null })
    const res = await attendanceRoute.POST(attendanceReq('c1', { bookingId: 'bk-1', status: 'ATTENDED' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('the owner can mark ATTENDED after the class ends; an audit event is appended', async () => {
    state.student = OWNER
    const started = Date.now() - 2 * 3600_000
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(started), durationMinutes: 60 })
    state.bookings.push({ id: 'bk-1', classSessionId: 'c1', studentId: 'student-1', status: 'CONFIRMED', bookedAt: new Date(), cancelledAt: null, attendanceMarkedAt: null })
    const res = await attendanceRoute.POST(attendanceReq('c1', { bookingId: 'bk-1', status: 'ATTENDED' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.booking.status).toBe('ATTENDED')
    expect(state.bookings[0].attendanceMarkedAt).not.toBeNull()
    expect(state.auditEvents.some(e => e.action === 'ATTENDANCE_MARKED' && e.detail === 'CONFIRMED → ATTENDED (class c1)')).toBe(true)
  })

  it('an unrelated teacher cannot mark attendance on someone else\u2019s class (404)', async () => {
    state.student = { ...OWNER, id: 'teacher-2' }
    const started = Date.now() - 2 * 3600_000
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(started), durationMinutes: 60 })
    state.bookings.push({ id: 'bk-1', classSessionId: 'c1', studentId: 'student-1', status: 'CONFIRMED', bookedAt: new Date(), cancelledAt: null, attendanceMarkedAt: null })
    const res = await attendanceRoute.POST(attendanceReq('c1', { bookingId: 'bk-1', status: 'ATTENDED' }), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
    expect(state.bookings[0].status).toBe('CONFIRMED')
  })
})
