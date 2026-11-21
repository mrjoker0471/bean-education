// ─── BEAN Live Classroom (Phase 5): whiteboard persistence rules ──────────────
// Teacher-only writes (server-checked ownership), participant reads, strict
// protocol validation, size caps and late-join restore.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  classes: new Map<string, { id: string; teacherProfileId: string; status: string }>(),
  lives: new Map<string, { id: string; classSessionId: string; status: string }>(),
  boards: new Map<string, { snapshotJson: string; version: number; updatedById: string }>(),
  bookings: new Map<string, string>(), // classId:studentId → status
}

const TEACHER = { id: 'teacher-1', email: 't1@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }
const OUTSIDER = { id: 'student-2', email: 's2@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }

function validSnapshot(strokes = 2) {
  return {
    v: 1 as const,
    strokes: Array.from({ length: strokes }, (_, i) => ({
      id: `s-${i}`,
      mode: 'pen' as const,
      color: '#d4af37',
      size: 3,
      points: [[0.1, 0.1], [0.5, 0.5]] as [number, number][],
    })),
  }
}

function resetState() {
  state.student = null
  state.classes.clear()
  state.lives.clear()
  state.boards.clear()
  state.bookings.clear()
  state.classes.set('c1', { id: 'c1', teacherProfileId: 'tp-owner', status: 'PUBLISHED' })
  state.lives.set('c1', { id: 'live-1', classSessionId: 'c1', status: 'LIVE' })
  state.bookings.set('c1:student-1', 'CONFIRMED')
}

const fakeDb = {
  classSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.classes.get(where.id) ?? null,
  },
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string } }) => {
      if (!where?.studentId) return null
      if (where.studentId === TEACHER.id) return { id: 'tp-owner', studentId: TEACHER.id, verificationStatus: 'APPROVED' }
      return null
    },
  },
  classBooking: {
    findUnique: async ({ where }: { where: { classSessionId_studentId: { classSessionId: string; studentId: string } } }) => {
      const status = state.bookings.get(`${where.classSessionId_studentId.classSessionId}:${where.classSessionId_studentId.studentId}`)
      return status ? { id: 'bk', status } : null
    },
  },
  liveClassSession: {
    findUnique: async ({ where }: { where: { classSessionId: string } }) => {
      const live = state.lives.get(where.classSessionId)
      if (!live) return null
      const board = state.boards.get(live.id)
      const cls = state.classes.get(live.classSessionId)!
      return {
        ...live,
        whiteboard: board ? { ...board, updatedAt: new Date() } : null,
        classSession: { id: cls.id, teacherProfileId: cls.teacherProfileId, teacherProfile: { studentId: cls.teacherProfileId === 'tp-owner' ? TEACHER.id : 'unknown-student' } },
      }
    },
  },
  liveWhiteboardState: {
    upsert: async ({ where, create, update }: { where: { liveClassSessionId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = state.boards.get(where.liveClassSessionId)
      if (existing) {
        existing.snapshotJson = String(update.snapshotJson)
        existing.version = Number((update.version as { increment: number }).increment) + existing.version
        existing.updatedById = String(update.updatedById)
        return existing
      }
      const row = { snapshotJson: String(create.snapshotJson), version: Number(create.version), updatedById: String(create.updatedById) }
      state.boards.set(where.liveClassSessionId, row)
      return row
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))
const wbRoute = await import('@/app/api/teach/classes/[id]/live/whiteboard/route')

function getReq(classId: string): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/live/whiteboard`) as unknown as NextRequest
}
function postReq(classId: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/live/whiteboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('whiteboard snapshot API', () => {
  beforeEach(resetState)

  it('a guest cannot read (401)', async () => {
    const res = await wbRoute.GET(getReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(401)
  })

  it('a student without a confirmed booking cannot read the board (403)', async () => {
    state.student = OUTSIDER
    const res = await wbRoute.GET(getReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('a confirmed student can read the saved snapshot (late-join restore)', async () => {
    state.student = STUDENT
    state.boards.set('live-1', { snapshotJson: JSON.stringify(validSnapshot(3)), version: 2, updatedById: TEACHER.id })
    const res = await wbRoute.GET(getReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.snapshot.strokes.length).toBe(3)
    expect(body.version).toBe(2)
  })

  it('a student can NEVER save a snapshot (403) — only the owner teacher writes', async () => {
    state.student = STUDENT
    const res = await wbRoute.POST(postReq('c1', validSnapshot()), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
    expect(state.boards.size).toBe(0)
  })

  it('the owner teacher saves a snapshot (version increments on re-save)', async () => {
    state.student = TEACHER
    const first = await wbRoute.POST(postReq('c1', validSnapshot()), { params: Promise.resolve({ id: 'c1' }) })
    expect(first.status).toBe(200)
    const second = await wbRoute.POST(postReq('c1', validSnapshot(4)), { params: Promise.resolve({ id: 'c1' }) })
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body.version).toBe(2)
    const saved = state.boards.get('live-1')!
    expect(JSON.parse(saved.snapshotJson).strokes.length).toBe(4)
    expect(saved.updatedById).toBe(TEACHER.id)
  })

  it('an invalid drawing payload is rejected (400)', async () => {
    state.student = TEACHER
    const invalid = {
      v: 1,
      strokes: [{ id: 's', mode: 'pen', color: '#d4af37', size: 3, points: [[0.5, 0.5]] }], // single point — invalid
    }
    const res = await wbRoute.POST(postReq('c1', invalid), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
  })

  it('an out-of-palette colour is rejected (400) — no arbitrary payloads', async () => {
    state.student = TEACHER
    const invalid = {
      v: 1,
      strokes: [{ id: 's', mode: 'pen', color: '<script>alert(1)</script>', size: 3, points: [[0.1, 0.1], [0.5, 0.5]] }],
    }
    const res = await wbRoute.POST(postReq('c1', invalid), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
  })

  it('coordinates outside 0..1 are rejected (400)', async () => {
    state.student = TEACHER
    const invalid = {
      v: 1,
      strokes: [{ id: 's', mode: 'pen', color: '#d4af37', size: 3, points: [[0.1, 0.1], [5, 0.5]] }],
    }
    const res = await wbRoute.POST(postReq('c1', invalid), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
  })

  it('an oversized snapshot is rejected (400)', async () => {
    state.student = TEACHER
    const big = validSnapshot(500) // 500 strokes at the cap — with long strokes to exceed 200KB
    big.strokes = big.strokes.map((s, i) => ({ ...s, id: `stroke-${i}-${'x'.repeat(120)}`, points: Array.from({ length: 400 }, (_, j) => [j / 400, (j % 100) / 100] as [number, number]) }))
    const res = await wbRoute.POST(postReq('c1', big), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
    expect(state.boards.size).toBe(0)
  })

  it('saving is refused when the classroom is not live (409)', async () => {
    state.student = TEACHER
    state.lives.set('c1', { id: 'live-1', classSessionId: 'c1', status: 'ENDED' })
    const res = await wbRoute.POST(postReq('c1', validSnapshot()), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })
})
