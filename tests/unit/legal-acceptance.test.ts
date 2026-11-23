// ─── Signup legal acceptance, age fail-safe and consent rules ─────────────────
// Route-level tests for POST /api/auth/register (mocked db/auth per repo
// pattern). The server validates CURRENT versions itself — a stale or
// browser-asserted version can never create an account, and under-18
// registrations are refused outright (fail-safe, nothing stored).

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/rate-limit'

// The real legal-config defaults are the "current" versions in tests
// (no BEAN_TERMS_VERSION/BEAN_PRIVACY_VERSION env in the test process).
const CURRENT_TERMS = '2026-11-23-draft.1'
const CURRENT_PRIVACY = '2026-11-23-draft.1'

const state = {
  students: new Map<string, Record<string, unknown>>(),
  acceptances: [] as { studentId: string; document: string; version: string }[],
  nextId: 1,
}

function resetState() {
  state.students.clear()
  state.acceptances = []
  state.nextId = 1
}

const fakeDb = {
  student: {
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) return [...state.students.values()].find(s => s.email === where.email) ?? null
      if (where.id) return state.students.get(where.id) ?? null
      return null
    },
    create: async ({ data }: { data: Record<string, unknown> & { legalAcceptances?: { create: { document: string; version: string }[] } } }) => {
      const row = {
        id: `s-${state.nextId++}`,
        email: String(data.email),
        displayName: (data.displayName as string | null) ?? null,
        learningLevel: null,
        role: String(data.role ?? 'STUDENT'),
        onboardedAt: null,
        signupIntent: (data.signupIntent as string | null) ?? null,
        ageBand: (data.ageBand as string | null) ?? null,
        passwordHash: (data.passwordHash as string | null) ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      state.students.set(row.id, row)
      for (const a of data.legalAcceptances?.create ?? []) {
        state.acceptances.push({ studentId: row.id, document: a.document, version: a.version })
      }
      return { id: row.id, email: row.email, displayName: row.displayName, learningLevel: row.learningLevel, role: row.role, onboardedAt: row.onboardedAt, signupIntent: row.signupIntent }
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock())

const registerRoute = await import('@/app/api/auth/register/route')

function req(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const VALID_BODY = {
  email: 'new.learner@example.com',
  password: 'correct-horse-battery',
  acceptedTermsVersion: CURRENT_TERMS,
  privacyNoticeVersion: CURRENT_PRIVACY,
  ageDeclaration: 'ADULT_18_PLUS',
  intent: 'STUDENT',
}

describe('POST /api/auth/register — legal acceptance gating', () => {
  beforeEach(() => {
    resetState()
    resetRateLimits()
  })

  it('rejects a stale Terms version and creates nothing', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, acceptedTermsVersion: '1999-01-01-old' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('stale_legal_version')
    expect(state.students.size).toBe(0)
  })

  it('rejects a stale Privacy Notice version and creates nothing', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, privacyNoticeVersion: '0.0.1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('stale_legal_version')
    expect(state.students.size).toBe(0)
  })

  it('rejects registration without acceptance fields entirely', async () => {
    const { acceptedTermsVersion: _t, privacyNoticeVersion: _p, ...missing } = VALID_BODY
    const res = await registerRoute.POST(req(missing))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })

  it('refuses under-18 registrations (fail-safe, nothing stored)', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, ageDeclaration: 'UNDER_18' }))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.code).toBe('guardian_verification_unavailable')
    expect(state.students.size).toBe(0)
    expect(state.acceptances.length).toBe(0)
  })

  it('still refuses client-supplied roles (no escalation path)', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, role: 'ADMIN' }))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })

  it('records versioned acceptance for a valid signup', async () => {
    const res = await registerRoute.POST(req(VALID_BODY))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.role).toBe('STUDENT')
    const terms = state.acceptances.find(a => a.document === 'TERMS')
    const privacy = state.acceptances.find(a => a.document === 'PRIVACY')
    expect(terms?.version).toBe(CURRENT_TERMS)
    expect(privacy?.version).toBe(CURRENT_PRIVACY)
  })

  it('records the audience intent and age band without granting any role', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, intent: 'TEACHER' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.role).toBe('STUDENT')
    expect(data.student.signupIntent).toBe('TEACHER')
    const student = state.students.get(data.student.id)
    expect(student?.ageBand).toBe('ADULT_18_PLUS')
    expect(student?.passwordHash).toBeDefined()
  })
})
