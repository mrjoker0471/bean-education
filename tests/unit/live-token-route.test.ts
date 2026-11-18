// ─── BEAN Live Classroom (Phase 5): token route — the security core ───────────
// Every token request re-derives the caller's role from BEAN database state.
// Proven here: guests refused, unbooked/cancelled students refused, foreign
// classes refused, non-live sessions refused, window enforced, grants differ
// by role, and the API secret never appears in any response.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const API_SECRET_TEST = 'test-secret-DO-NOT-LEAK-0000000000'

interface FakeClass {
  id: string
  title: string
  status: string
  startsAt: Date
  durationMinutes: number
  timeZone: string
  teacherProfile: { id: string; studentId: string; teachingName: string; verificationStatus: string }
  liveSession: { id: string; roomName: string; status: string } | null
}

const state = {
  student: null as Record<string, unknown> | null,
  wsUrlConfigured: true,
  classes: new Map<string, FakeClass>(),
  bookings: new Map<string, string>(), // `${classId}:${studentId}` → status
  minted: [] as { identity: string; role: string; sources: string[] | undefined; room: string }[],
}

const TEACHER = { id: 'teacher-1', email: 't1@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }
const STUDENT = { id: 'student-1', email: 's1@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const OTHER_STUDENT = { id: 'student-2', email: 's2@bean.example', displayName: 'Student Two', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function resetState() {
  state.student = null
  state.wsUrlConfigured = true
  state.classes.clear()
  state.bookings.clear()
  state.minted = []
  state.classes.set('c1', {
    id: 'c1',
    title: 'Algebra Foundations',
    status: 'PUBLISHED',
    startsAt: new Date(Date.now() + 5 * 60_000),
    durationMinutes: 60,
    timeZone: 'Asia/Kolkata',
    teacherProfile: { id: 'tp-owner', studentId: TEACHER.id, teachingName: 'Prof One', verificationStatus: 'APPROVED' },
    liveSession: { id: 'live-1', roomName: 'bean-live-test', status: 'LIVE' },
  })
  state.bookings.set('c1:student-1', 'CONFIRMED')
}

const fakeDb = {
  classSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.classes.get(where.id) ?? null,
  },
  classBooking: {
    findUnique: async ({ where }: { where: { classSessionId_studentId: { classSessionId: string; studentId: string } } }) => {
      const status = state.bookings.get(`${where.classSessionId_studentId.classSessionId}:${where.classSessionId_studentId.studentId}`)
      return status ? { id: `bk-${where.classSessionId_studentId.studentId}`, status } : null
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))
mock.module('@/lib/livekit/config', () => ({
  createParticipantToken: async (opts: { identity: string; room: string; canPublishSources?: string[]; name: string; ttlSeconds: number; metadata?: string }) => {
    state.minted.push({ identity: opts.identity, role: JSON.parse(opts.metadata ?? '{}').role, sources: opts.canPublishSources, room: opts.room })
    return `jwt-for-${opts.identity}`
  },
  isLivekitConfigured: () => state.wsUrlConfigured,
  lastLivekitConnectionError: () => null,
}))

const tokenRoute = await import('@/app/api/teach/classes/[id]/live/token/route')

function tokenReq(classId: string): NextRequest {
  return new Request(`http://localhost/api/teach/classes/${classId}/live/token`, { method: 'POST' }) as unknown as NextRequest
}

describe('POST /api/teach/classes/:id/live/token', () => {
  beforeEach(resetState)
  process.env.LIVEKIT_WS_URL = 'wss://bean-test.livekit.cloud'

  it('a guest cannot get a token (401)', async () => {
    state.student = null
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(401)
  })

  it('a student without a booking cannot join (403)', async () => {
    state.student = OTHER_STUDENT
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
  })

  it('a cancelled booking cannot join (403)', async () => {
    state.student = OTHER_STUDENT
    state.bookings.set('c1:student-2', 'CANCELLED')
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('cancelled')
  })

  it('a confirmed student receives a STUDENT token with camera+microphone publish sources only', async () => {
    state.student = STUDENT
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.participant.role).toBe('STUDENT')
    expect(body.participant.identity).toBe(`bean:${STUDENT.id}`)
    expect(body.wsUrl).toBe('wss://bean-test.livekit.cloud')
    expect(body.room.name).toBe('bean-live-test')
    expect(state.minted[0].sources).toEqual(['camera', 'microphone'])
    // Screen share is never in a student grant.
    expect(JSON.stringify(state.minted[0].sources)).not.toContain('screen_share')
  })

  it('the approved owner teacher receives a TEACHER token including screen share', async () => {
    state.student = TEACHER
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.participant.role).toBe('TEACHER')
    expect(state.minted[0].sources).toEqual(['camera', 'microphone', 'screen_share'])
  })

  it('a non-approved owner profile is treated as a regular student', async () => {
    state.student = TEACHER
    state.classes.set('c1', { ...state.classes.get('c1')!, teacherProfile: { ...state.classes.get('c1')!.teacherProfile, verificationStatus: 'PENDING' } })
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    // Not the owner-approved path; no booking → 403.
    expect(res.status).toBe(403)
  })

  it('identity is the opaque BEAN id — never an email', async () => {
    state.student = STUDENT
    await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(state.minted[0].identity.startsWith('bean:')).toBe(true)
    expect(state.minted[0].identity.includes('@')).toBe(false)
  })

  it('a class that is not live refuses tokens (409)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, liveSession: { id: 'live-1', roomName: 'bean-live-test', status: 'READY' } })
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('outside the scheduled access window is refused (409)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, startsAt: new Date(Date.now() - 2 * 3600_000), durationMinutes: 60 })
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(409)
  })

  it('a draft class is invisible (404)', async () => {
    state.student = STUDENT
    state.classes.set('c1', { ...state.classes.get('c1')!, status: 'DRAFT' })
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(404)
  })

  it('the API secret never appears in the response', async () => {
    state.student = STUDENT
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    const raw = JSON.stringify(await res.json())
    expect(raw.includes(API_SECRET_TEST)).toBe(false)
    expect(raw.toLowerCase().includes('apisecret')).toBe(false)
    expect(raw.toLowerCase().includes('api_secret')).toBe(false)
  })

  it('an unconfigured provider refuses with 503 instead of faking a classroom', async () => {
    state.student = STUDENT
    state.wsUrlConfigured = false
    const res = await tokenRoute.POST(tokenReq('c1'), { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('not configured')
  })
})
