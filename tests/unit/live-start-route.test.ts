// ─── BEAN Live Classroom (Phase 5): start route — authorisation & lifecycle ───
// Route-level tests over the fake db: role/ownership matrix, schedule window,
// booking requirement, budget rejection, duplicate-start safety, and the
// room-creation failure path (reservation released, FAILED state). The
// budget SQL itself is proven against real SQLite in live-usage.test.ts.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

interface FakeClass {
  id: string
  teacherProfileId: string
  status: string
  startsAt: Date
  durationMinutes: number
  bookings: { id: string }[]
}

interface FakeLive {
  id: string
  classSessionId: string
  roomName: string
  status: string
  startedAt: Date | null
  startedById: string
  reservedParticipantMinutes: number
  usageMonthKey: string
  usageFinalisedAt: Date | null
}

const state = {
  student: null as Record<string, unknown> | null,
  classes: new Map<string, FakeClass>(),
  lives: new Map<string, FakeLive>(), // by classSessionId
  nextLiveId: 1,
  audits: [] as { action: string; entityId: string; actorId: string }[],
  roomCreated: null as { name: string; maxParticipants: number } | null,
  roomCreationFails: false,
  reservedResult: 1, // fake reserve predicate result
  reservedSum: 0,
  monthBudget: 4000,
  released: [] as number[],
}

const TEACHER = { id: 'teacher-1', email: 't1@bean.example', displayName: 'Teacher One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const OTHER_TEACHER = { id: 'teacher-2', email: 't2@bean.example', displayName: 'Teacher Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const PENDING_TEACHER = { id: 'teacher-3', email: 't3@bean.example', displayName: 'Pending', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function resetState() {
  state.student = null
  state.classes.clear()
  state.lives.clear()
  state.nextLiveId = 1
  state.audits = []
  state.roomCreated = null
  state.roomCreationFails = false
  state.reservedResult = 1
  state.reservedSum = 0
  state.monthBudget = 4000
  state.released = []
  state.classes.set('c1', {
    id: 'c1',
    teacherProfileId: 'tp-owner',
    status: 'PUBLISHED',
    startsAt: new Date(Date.now() + 10 * 60_000), // 10 min ahead — inside the 15-min window
    durationMinutes: 60,
    bookings: [{ id: 'b1' }],
  })
}

const fakeDb = {
  classSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.classes.get(where.id) ?? null,
  },
  // Phase 6: the start route consults trust restrictions (trustStateFor →
  // EMERGENCY_STOP blocking). No restriction rows exist in these scenarios →
  // start flow unchanged.
  trustAction: {
    findMany: async () => [],
  },
  liveClassSession: {
    findUnique: async ({ where }: { where: { classSessionId?: string; id?: string } }) => {
      let row: FakeLive | null = null
      if (where.classSessionId) row = state.lives.get(where.classSessionId) ?? null
      else if (where.id) row = [...state.lives.values()].find((l) => l.id === where.id) ?? null
      if (!row) return null
      // Include the class the way the route's include does.
      return { ...row, classSession: state.classes.get(row.classSessionId) ?? null }
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeLive = {
        id: `live-${state.nextLiveId++}`,
        classSessionId: String(data.classSessionId),
        roomName: String(data.roomName),
        status: String(data.status ?? 'READY'),
        startedAt: (data.startedAt as Date) ?? null,
        startedById: String(data.startedById),
        reservedParticipantMinutes: Number(data.reservedParticipantMinutes ?? 0),
        usageMonthKey: String(data.usageMonthKey),
        usageFinalisedAt: null,
      }
      state.lives.set(row.classSessionId, row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...state.lives.values()].find((l) => l.id === where.id)
      if (!row) throw new Error('live not found')
      Object.assign(row, data)
      return row
    },
  },
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string } }) => {
      if (!where?.studentId) return null
      if (where.studentId === TEACHER.id) return { id: 'tp-owner', studentId: TEACHER.id, verificationStatus: 'APPROVED' }
      if (where.studentId === OTHER_TEACHER.id) return { id: 'tp-other', studentId: OTHER_TEACHER.id, verificationStatus: 'APPROVED' }
      if (where.studentId === PENDING_TEACHER.id) return { id: 'tp-pending', studentId: PENDING_TEACHER.id, verificationStatus: 'PENDING' }
      return null
    },
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.audits.push({ action: String(data.action), entityId: String(data.entityId), actorId: String(data.actorId) })
      return {}
    },
  },
  $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
    if (sql.includes('INSERT INTO "LiveUsageMonth"')) return 1
    if (sql.includes('UPDATE "LiveUsageMonth" SET "reservedParticipantMinutes" = "reservedParticipantMinutes" + ?')) {
      // USAGE_RESERVE_SQL — the conditional predicate is faked atomically.
      if (state.reservedResult !== 1) return 0
      const minutes = Number(params[0])
      if (state.reservedSum + minutes > state.monthBudget) return 0
      state.reservedSum += minutes
      return 1
    }
    if (sql.includes('MAX("reservedParticipantMinutes" - ?')) {
      state.released.push(Number(params[0]))
      return 1
    }
    throw new Error(`unexpected raw SQL in test: ${sql.slice(0, 60)}`)
  },
  liveUsageMonth: {
    findUnique: async ({ where }: { where: { monthKey: string } }) => ({
      monthKey: where.monthKey,
      budgetParticipantMinutes: state.monthBudget,
      reservedParticipantMinutes: state.reservedSum,
      usedParticipantMinutes: 0,
    }),
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

// NOTE: '@/lib/teach' is NOT mocked — the REAL requireApprovedTeacher runs
// against the fake db (teacherProfile rows below), which keeps bun's global
// mock registry compatible with the Phase 4A suites in the same process.
mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))
mock.module('@/lib/livekit/room', () => ({
  createRoomGuarded: async (name: string, maxParticipants: number) => {
    if (state.roomCreationFails) return { ok: false as const, error: 'room_creation_failed' }
    state.roomCreated = { name, maxParticipants }
    return { ok: true as const }
  },
  deleteRoomGuarded: async () => ({ ok: true }),
  listParticipantsGuarded: async () => ({ ok: false as const, error: 'not_configured' as const }),
  muteParticipantAudioGuarded: async () => ({ ok: true as const }),
  removeParticipantGuarded: async () => ({ ok: true as const }),
}))

const startRoute = await import('@/app/api/teach/classes/[id]/live/start/route')

function startReq(classId: string): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/live/start`, { method: 'POST' }) as unknown as NextRequest
}

describe('POST /api/teach/classes/:id/live/start', () => {
  beforeEach(resetState)

  it('a guest cannot start (401)', async () => {
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(401)
  })

  it('a pending teacher cannot start (403)', async () => {
    state.student = PENDING_TEACHER
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('a student without an approved teacher profile cannot start (403)', async () => {
    state.student = STUDENT
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('a teacher cannot start another teacher’s class (403)', async () => {
    state.student = OTHER_TEACHER
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('role and ownership come from the server — no client fields are read', async () => {
    // The request carries NO body at all; identity flows only from the cookie.
    state.student = TEACHER
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
  })

  it('an approved owner teacher starts the room (200) and a room is created once', async () => {
    state.student = TEACHER
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.live.status).toBe('LIVE')
    expect(state.roomCreated).not.toBeNull()
    // maxParticipants = confirmed bookings (1) + teacher (1)
    expect(state.roomCreated!.maxParticipants).toBe(2)
    expect(state.lives.get('c1')!.status).toBe('LIVE')
    expect(state.audits.some((a) => a.action === 'LIVE_STARTED')).toBe(true)
  })

  it('room names are opaque server-generated identifiers', async () => {
    state.student = TEACHER
    await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    // The name is an unguessable opaque id — never an email, class id or title.
    expect(state.roomCreated!.name.startsWith('bean-live-')).toBe(true)
    expect(state.roomCreated!.name.includes('@')).toBe(false)
    expect(state.roomCreated!.name).toMatch(/^bean-live-[0-9a-f]{32}$/)
  })

  it('duplicate start is safe — one room, no second reservation, 200 with existing session', async () => {
    state.student = TEACHER
    await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    const firstReserve = state.reservedSum
    const created = state.roomCreated
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyLive).toBe(true)
    expect(state.roomCreated).toBe(created) // no second createRoom call
    expect(state.reservedSum).toBe(firstReserve)
  })

  it('a draft class cannot start (404)', async () => {
    state.student = TEACHER
    state.classes.set('c1', { ...state.classes.get('c1')!, status: 'DRAFT' })
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
  })

  it('a cancelled class cannot start (409)', async () => {
    state.student = TEACHER
    state.classes.set('c1', { ...state.classes.get('c1')!, status: 'CANCELLED' })
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('starting outside the window is rejected (409) — too early and window closed', async () => {
    state.student = TEACHER
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() + 2 * 3600_000) })
    const early = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(early.status).toBe(409)

    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() - 90 * 60_000), durationMinutes: 60 })
    const late = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(late.status).toBe(409)
  })

  it('a class without confirmed bookings cannot start (409)', async () => {
    state.student = TEACHER
    state.classes.set('c1', { ...state.classes.get('c1')!, bookings: [] })
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('insufficient allowance rejects the start (429) and creates no room', async () => {
    state.student = TEACHER
    state.monthBudget = 30 // (1 booking + 1 teacher) × 60min = 120 > 30
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toContain('free pilot allowance')
    expect(state.roomCreated).toBeNull()
    expect(state.lives.size).toBe(0)
  })

  it('a failed room creation releases the reservation and marks the session FAILED', async () => {
    state.student = TEACHER
    state.roomCreationFails = true
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('could not be created')
    expect(state.lives.get('c1')!.status).toBe('FAILED')
    expect(state.released).toEqual([120]) // (1+1) × 60min released
  })

  it('a FAILED session can be retried — the same row resumes, no duplicate rows', async () => {
    state.student = TEACHER
    state.roomCreationFails = true
    await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    state.roomCreationFails = false
    state.reservedSum = 0
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect([...state.lives.values()].length).toBe(1)
    expect(state.lives.get('c1')!.status).toBe('LIVE')
  })

  it('an ENDED session can never restart (409)', async () => {
    state.student = TEACHER
    state.lives.set('c1', {
      id: 'live-1', classSessionId: 'c1', roomName: 'bean-live-x', status: 'ENDED',
      startedAt: new Date(Date.now() - 3600_000), startedById: TEACHER.id,
      reservedParticipantMinutes: 120, usageMonthKey: '2026-11', usageFinalisedAt: new Date(),
    })
    const res = await startRoute.POST(startReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })
})
