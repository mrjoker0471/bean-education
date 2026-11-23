// ─── Privacy / grievance requests: owner-scoped and confidential ──────────────
// Route-level tests for /api/privacy-request (POST + GET):
//   • signed-in requests bind to the session student (owner-scoped GET)
//   • guest requests bind to the device guest identity
//   • rate limiting, validation bounds, no cross-user access

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/rate-limit'

const state = {
  student: { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: '2026-01-01', signupIntent: 'STUDENT' } as Record<string, unknown> | null,
  rows: [] as { id: string; studentId: string | null; guestId: string | null; category: string; message: string; status: string; createdAt: Date; updatedAt: Date }[],
  nextId: 1,
}

function resetState() {
  state.student = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: '2026-01-01', signupIntent: 'STUDENT' }
  state.rows = []
  state.nextId = 1
}

const fakeDb = {
  privacyRequest: {
    create: async ({ data }: { data: { studentId: string | null; guestId: string | null; category: string; message: string } }) => {
      const row = { id: `pr-${state.nextId++}`, ...data, status: 'OPEN', createdAt: new Date(), updatedAt: new Date() }
      state.rows.push(row)
      return { id: row.id, category: row.category, status: row.status, createdAt: row.createdAt }
    },
    findMany: async ({ where }: { where: { studentId?: string; guestId?: string } }) =>
      state.rows.filter(r => (where.studentId && r.studentId === where.studentId) || (where.guestId && r.guestId === where.guestId)),
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({ requireStudent: async () => state.student as never, getSessionStudent: async () => state.student as never }))

const route = await import('@/app/api/privacy-request/route')

function req(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/privacy-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const VALID = { category: 'ERASURE', message: 'Please erase all my study data from your systems.' }

describe('POST /api/privacy-request', () => {
  beforeEach(() => { resetState(); resetRateLimits() })

  it('records an owner-scoped request for a signed-in student', async () => {
    const res = await route.POST(req(VALID))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.request.category).toBe('ERASURE')
    expect(state.rows[0].studentId).toBe('me')
    expect(state.rows[0].guestId).toBeNull()
  })

  it('binds guest requests to the device guest identity', async () => {
    state.student = null
    const res = await route.POST(req({ ...VALID, guestId: 'guest-1234567890' }))
    expect(res.status).toBe(201)
    expect(state.rows[0].studentId).toBeNull()
    expect(state.rows[0].guestId).toBe('guest-1234567890')
  })

  it('rejects too-short messages', async () => {
    const res = await route.POST(req({ category: 'ACCESS', message: 'too short' }))
    expect(res.status).toBe(400)
  })

  it('rejects unknown categories', async () => {
    const res = await route.POST(req({ ...VALID, category: 'SHOUT' }))
    expect(res.status).toBe(400)
  })

  it('guest requests require a guest identity', async () => {
    state.student = null
    const res = await route.POST(req(VALID))
    expect(res.status).toBe(400)
  })

  it('rate limits after five requests per hour', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await route.POST(req({ ...VALID, message: `Message number ${i} that is long enough to pass validation.` }))
      expect(res.status).toBe(201)
    }
    const res = await route.POST(req(VALID))
    expect(res.status).toBe(429)
  })
})

describe('GET /api/privacy-request — owner-scoped listing', () => {
  beforeEach(() => { resetState(); resetRateLimits() })

  it('returns only the requester’s own tickets', async () => {
    state.rows.push({ id: 'r1', studentId: 'me', guestId: null, category: 'ACCESS', message: 'mine', status: 'OPEN', createdAt: new Date(), updatedAt: new Date() })
    state.rows.push({ id: 'r2', studentId: 'other-student', guestId: null, category: 'ACCESS', message: 'not mine', status: 'OPEN', createdAt: new Date(), updatedAt: new Date() })
    const res = await route.GET()
    const data = await res.json()
    expect(data.requests.length).toBe(1)
    expect(data.requests[0].id).toBe('r1')
  })

  it('guests receive an empty list (no session, nothing to expose)', async () => {
    state.student = null
    const res = await route.GET()
    expect((await res.json()).requests.length).toBe(0)
  })
})
