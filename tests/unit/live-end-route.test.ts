// ─── BEAN Live Classroom (Phase 5): end route — single-use finalisation ───────
// Proven: only the owner teacher can end; students cannot; duplicate end does
// not double-finalise usage; open intervals are closed conservatively; the
// verified actual usage is recorded exactly once.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

interface FakeLive {
  id: string
  classSessionId: string
  roomName: string
  status: string
  startedAt: Date | null
  endedAt: Date | null
  startedById: string
  reservedParticipantMinutes: number
  actualParticipantMinutes: number | null
  usageFinalisedAt: Date | null
  usageMonthKey: string
  participants: { id: string; activeSince: Date | null; totalConnectedSeconds: number }[]
}

const state = {
  student: null as Record<string, unknown> | null,
  classes: new Map<string, { id: string; teacherProfileId: string }>(),
  lives: new Map<string, FakeLive>(),
  reconciles: [] as { reserved: number; actual: number; monthKey: string }[],
  roomsDeleted: [] as string[],
  audits: [] as { action: string }[],
}

const TEACHER = { id: 'teacher-1', email: 't1@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }
const OTHER_TEACHER = { id: 'teacher-2', email: 't2@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }

function resetState() {
  state.student = null
  state.classes.clear()
  state.lives.clear()
  state.reconciles = []
  state.roomsDeleted = []
  state.audits = []
  state.classes.set('c1', { id: 'c1', teacherProfileId: 'tp-owner' })
  state.lives.set('c1', {
    id: 'live-1',
    classSessionId: 'c1',
    roomName: 'bean-live-end-test',
    status: 'LIVE',
    startedAt: new Date(Date.now() - 20 * 60_000),
    endedAt: null,
    startedById: TEACHER.id,
    reservedParticipantMinutes: 120,
    actualParticipantMinutes: null,
    usageFinalisedAt: null,
    usageMonthKey: '2026-11',
    participants: [
      { id: 'p1', activeSince: new Date(Date.now() - 15 * 60_000), totalConnectedSeconds: 0 }, // still connected: open interval, nothing accumulated yet
      { id: 'p2', activeSince: null, totalConnectedSeconds: 300 }, // left earlier: closed interval
    ],
  })
}

const fakeDb = {
  classSession: {
    findUnique: async ({ where, select: _select }: { where: { id: string }; select?: unknown }) => {
      const cls = state.classes.get(where.id)
      if (!cls) return null
      return { ...cls, liveSession: state.lives.get(where.id) ?? null }
    },
  },
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string } }) => {
      if (!where?.studentId) return null
      if (where.studentId === TEACHER.id) return { id: 'tp-owner', studentId: TEACHER.id, verificationStatus: 'APPROVED' }
      if (where.studentId === OTHER_TEACHER.id) return { id: 'tp-other', studentId: OTHER_TEACHER.id, verificationStatus: 'APPROVED' }
      return null
    },
  },
  liveClassSession: {
    findUnique: async ({ where, select: _select }: { where: { id?: string; classSessionId?: string }; select?: unknown }) => {
      const row = where.id
        ? [...state.lives.values()].find((l) => l.id === where.id) ?? null
        : where.classSessionId
          ? state.lives.get(where.classSessionId) ?? null
          : null
      return row ? { ...row, participants: row.participants } : null
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.lives.get(where.id) ?? [...state.lives.values()].find((l) => l.id === where.id)
      if (!row) throw new Error('live not found')
      Object.assign(row, data)
      return row
    },
  },
  liveClassParticipant: {
    findMany: async () => {
      const live = [...state.lives.values()][0]
      return live ? live.participants : []
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const live = [...state.lives.values()][0]
      const p = live?.participants.find((p) => p.id === where.id)
      if (!p) throw new Error('participant not found')
      Object.assign(p, data)
      return p
    },
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.audits.push({ action: String(data.action) })
      return {}
    },
  },
  $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
    if (sql.includes('UPDATE "LiveUsageMonth" SET') && sql.includes('"usedParticipantMinutes"')) {
      state.reconciles.push({ reserved: Number(params[0]), actual: Number(params[1]), monthKey: String(params[3]) })
      return 1
    }
    throw new Error(`unexpected raw SQL: ${sql.slice(0, 60)}`)
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))
mock.module('@/lib/livekit/room', () => ({
  createRoomGuarded: async () => ({ ok: true as const }),
  deleteRoomGuarded: async (roomName: string) => {
    state.roomsDeleted.push(roomName)
    return { ok: true }
  },
  listParticipantsGuarded: async () => ({ ok: false as const, error: 'not_configured' as const }),
  muteParticipantAudioGuarded: async () => ({ ok: true as const }),
  removeParticipantGuarded: async () => ({ ok: true as const }),
}))

const endRoute = await import('@/app/api/teach/classes/[id]/live/end/route')

function endReq(classId: string): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/live/end`, { method: 'POST' }) as unknown as NextRequest
}

describe('POST /api/teach/classes/:id/live/end', () => {
  beforeEach(resetState)

  it('a guest cannot end (401) and a student cannot end (403)', async () => {
    const guest = await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(guest.status).toBe(401)
    state.student = STUDENT
    const student = await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(student.status).toBe(403)
    expect(state.reconciles.length).toBe(0)
  })

  it('a teacher cannot end another teacher’s class (403)', async () => {
    state.student = OTHER_TEACHER
    const res = await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('the owner ends the class: ENDED state, open interval closed, usage reconciled once', async () => {
    state.student = TEACHER
    const res = await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.live.status).toBe('ENDED')
    expect(body.alreadyEnded).toBe(false)
    const live = state.lives.get('c1')!
    expect(live.status).toBe('ENDED')
    expect(live.usageFinalisedAt).not.toBeNull()
    // Open interval (15 min = 900s) + closed 300s = 1200s → 20 minutes (ceil).
    expect(live.actualParticipantMinutes).toBe(20)
    expect(state.reconciles).toEqual([{ reserved: 120, actual: 20, monthKey: '2026-11' }])
    expect(live.participants[0].activeSince).toBeNull()
    expect(state.roomsDeleted).toEqual(['bean-live-end-test'])
    expect(state.audits.some((a) => a.action === 'LIVE_ENDED')).toBe(true)
  })

  it('duplicate end is safe — no second reconciliation, no second delete', async () => {
    state.student = TEACHER
    await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    const reconcilesAfterFirst = state.reconciles.length
    const res = await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyEnded).toBe(true)
    expect(state.reconciles.length).toBe(reconcilesAfterFirst)
    expect(state.roomsDeleted.length).toBe(1)
  })

  it('ending a class without a live session refuses politely (409)', async () => {
    state.student = TEACHER
    state.lives.clear()
    const res = await endRoute.POST(endReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })
})
