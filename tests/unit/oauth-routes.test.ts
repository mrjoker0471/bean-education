// ─── Google OAuth routes: configuration honesty, state validation, linking ────
// Route-level tests. The real crypto verification lives in
// tests/unit/oauth-google.test.ts; here the Google protocol library is mocked
// so every branch of the callback/link/complete state machine is exercised:
//   • status/start honestly refuse without credentials (no fake login)
//   • callback validates state, routes identity → session / link / signup
//   • link requires password proof for password accounts
//   • complete enforces the same legal acceptance as normal registration
//   • OAuth can never change a role; duplicate subjects are refused

import { describe, it, expect, mock, beforeEach, beforeAll, afterAll } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/rate-limit'
// Real module namespace, bound BEFORE the mock registration below (static
// imports evaluate first). Used by the afterAll restore so later test files
// in the same combined bun process get the genuine crypto implementation.
import * as realOauthGoogle from '@/lib/oauth-google'

const state = {
  envConfigured: false as boolean,
  verifyError: null as string | null,
  passwordOk: false,
  identities: new Map<string, { provider: string; subject: string; studentId: string; id: string }>(),
  pendings: new Map<string, { id: string; provider: string; subject: string; email: string; displayName: string | null; purpose: string; expiresAt: Date }>(),
  students: new Map<string, Record<string, unknown>>(),
  acceptances: [] as { studentId: string; document: string; version: string }[],
  sessionsCreated: [] as string[],
  nextId: 1,
}

function resetState() {
  state.envConfigured = false
  state.verifyError = null
  state.passwordOk = false
  state.identities.clear()
  state.pendings.clear()
  state.students.clear()
  state.acceptances = []
  state.sessionsCreated = []
  state.nextId = 1
}

function addStudent(partial: Partial<Record<string, unknown>> & { email: string }): Record<string, unknown> {
  const row = {
    id: `s-${state.nextId++}`,
    email: partial.email,
    passwordHash: (partial.passwordHash as string | null) ?? null,
    displayName: (partial.displayName as string | null) ?? null,
    learningLevel: null,
    role: (partial.role as string) ?? 'STUDENT',
    onboardedAt: null,
    signupIntent: (partial.signupIntent as string | null) ?? null,
  }
  state.students.set(row.id as string, row)
  return row
}

const fakeDb = {
  oAuthIdentity: {
    findUnique: async ({ where }: { where: { provider_subject: { provider: string; subject: string } } }) =>
      [...state.identities.values()].find(i => i.provider === where.provider_subject.provider && i.subject === where.provider_subject.subject) ?? null,
    create: async ({ data }: { data: { provider: string; subject: string; studentId: string } }) => {
      const collision = [...state.identities.values()].find(i => i.provider === data.provider && i.subject === data.subject)
      if (collision) {
        const err = new Error('unique constraint') as Error & { code?: string }
        err.code = 'P2002'
        throw err
      }
      const row = { id: `oi-${state.nextId++}`, provider: data.provider, subject: data.subject, studentId: data.studentId }
      state.identities.set(row.id, row)
      return row
    },
  },
  oAuthPendingAuth: {
    findUnique: async ({ where }: { where: { id: string } }) => state.pendings.get(where.id) ?? null,
    create: async ({ data }: { data: Omit<{ id: string; provider: string; subject: string; email: string; displayName: string | null; purpose: string; expiresAt: Date }, 'id'> }) => {
      const row = { id: `op-${state.nextId++}`, ...data }
      state.pendings.set(row.id, row)
      return row
    },
    delete: async ({ where }: { where: { id: string } }) => { state.pendings.delete(where.id) },
    deleteMany: async ({ where }: { where: { provider?: string; subject?: string } }) => {
      for (const [id, p] of state.pendings) {
        if ((!where.provider || p.provider === where.provider) && (!where.subject || p.subject === where.subject)) state.pendings.delete(id)
      }
    },
  },
  student: {
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) return [...state.students.values()].find(s => s.email === where.email) ?? null
      if (where.id) return state.students.get(where.id) ?? null
      return null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const existing = [...state.students.values()].find(s => s.email === data.email)
      if (existing) {
        const err = new Error('unique constraint') as Error & { code?: string }
        err.code = 'P2002'
        throw err
      }
      const row = addStudent({
        email: String(data.email),
        passwordHash: (data.passwordHash as string | null) ?? null,
        displayName: (data.displayName as string | null) ?? null,
        signupIntent: (data.signupIntent as string | null) ?? null,
      })
      return { id: row.id, email: row.email, displayName: row.displayName, learningLevel: null, role: row.role, onboardedAt: null, signupIntent: row.signupIntent }
    },
  },
  legalAcceptance: {
    createMany: async ({ data }: { data: { studentId: string; document: string; version: string }[] }) => {
      state.acceptances.push(...data)
    },
  },
}

// ── Google protocol mock (configurable per test) ──
const googleMock = {
  googleOAuthConfig: () => ({
    clientId: 'bean-client-id',
    clientSecret: 'bean-secret',
    redirectUri: 'http://localhost:3000/api/auth/google/callback',
    configured: state.envConfigured,
  }),
  isValidRedirectUri: () => true,
  buildGoogleAuthUrl: (opts: { state: string }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${opts.state}`,
  createPkcePair: () => ({ verifier: 'v'.repeat(64), challenge: 'c'.repeat(43), method: 'S256' as const }),
  newOpaqueToken: () => 'opaque-token',
  safeEqual: (a: string, b: string) => a === b,
  exchangeAuthorizationCode: async () => ({ id_token: 'mock-id-token' }),
  fetchGoogleJwks: async () => ({ keys: [], fetchedAt: 0, maxAgeMs: 0 }),
  verifyGoogleIdToken: async () => {
    if (state.verifyError) {
      const err = new Error(state.verifyError) as Error & { code?: string }
      err.code = state.verifyError
      throw err
    }
    return { iss: 'https://accounts.google.com', aud: 'bean-client-id', sub: 'google-sub-1', exp: 9999999999, email: 'g.learner@example.com', email_verified: true, name: 'G Learner' }
  },
  GoogleOAuthError: class GoogleOAuthError extends Error { constructor(public code: string, message: string) { super(message); this.name = 'GoogleOAuthError' } },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  verifyPassword: async (_password: string, stored: string) => state.passwordOk && Boolean(stored),
  createSession: async (studentId: string) => {
    state.sessionsCreated.push(studentId)
    return { token: 'token-1', expiresAt: new Date(Date.now() + 86_400_000) }
  },
}))
// The Google protocol mock MUST be registered lazily (in beforeAll), not at
// module scope: bun pre-registers every test file's modules before running
// tests, so a module-scope mock.module here would poison the static import of
// the real @/lib/oauth-google in oauth-google.test.ts (and any other file),
// regardless of execution order — the fake would replace genuine crypto for
// the whole combined run. Registering in beforeAll keeps the mock strictly
// scoped to this file's own test execution; the routes under test are also
// imported here so they capture the mock.
let OAUTH_STATE_COOKIE = ''
let OAUTH_VERIFIER_COOKIE = ''
let OAUTH_NONCE_COOKIE = ''
let statusRoute: typeof import('@/app/api/auth/google/status/route')
let startRoute: typeof import('@/app/api/auth/google/start/route')
let callbackRoute: typeof import('@/app/api/auth/google/callback/route')
let linkRoute: typeof import('@/app/api/auth/google/link/route')
let completeRoute: typeof import('@/app/api/auth/google/complete/route')

beforeAll(async () => {
  mock.module('@/lib/oauth-google', () => googleMock)
  ;({ OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_NONCE_COOKIE } = await import('@/app/api/auth/google/start/route'))
  statusRoute = await import('@/app/api/auth/google/status/route')
  startRoute = await import('@/app/api/auth/google/start/route')
  callbackRoute = await import('@/app/api/auth/google/callback/route')
  linkRoute = await import('@/app/api/auth/google/link/route')
  completeRoute = await import('@/app/api/auth/google/complete/route')
})

// Defensive: restore the genuine module after this file's tests so any later
// runtime importer in the same combined process resolves the real crypto.
afterAll(() => {
  mock.module('@/lib/oauth-google', () => realOauthGoogle)
})

const CURRENT_TERMS = '2026-11-23-draft.1'
const CURRENT_PRIVACY = '2026-11-23-draft.1'

function getReq(url: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new Request(url, { method: 'GET' }) as unknown as NextRequest
  const map = new Map(Object.entries(cookies))
  Object.defineProperty(req, 'cookies', { value: { get: (name: string) => map.has(name) ? { name, value: map.get(name) } : undefined } })
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req
}

function postReq(url: string, body: Record<string, unknown>): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function redirectMarker(res: Response): string {
  return res.headers.get('location') ?? ''
}

describe('GET /api/auth/google/status + start — honest configuration', () => {
  beforeEach(() => { resetState(); resetRateLimits() })

  it('status reports unconfigured when credentials are absent', async () => {
    const res = await statusRoute.GET()
    expect(res.status).toBe(200)
    expect((await res.json()).configured).toBe(false)
  })

  it('status reports configured once credentials exist', async () => {
    state.envConfigured = true
    const res = await statusRoute.GET()
    expect((await res.json()).configured).toBe(true)
  })

  it('start refuses unconfigured OAuth with a truthful error — never a fake login', async () => {
    const res = await startRoute.GET(getReq('http://localhost/api/auth/google/start'))
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.code).toBe('google_not_configured')
    expect(data.error).toContain('not configured')
  })
})

describe('GET /api/auth/google/callback — state machine', () => {
  beforeEach(() => { resetState(); resetRateLimits(); state.envConfigured = true })

  it('rejects a missing/expired state cookie', async () => {
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=s1'))
    expect(res.status).toBe(307)
    expect(redirectMarker(res)).toContain('google_error=expired')
  })

  it('rejects a state mismatch (CSRF), timing-safe', async () => {
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=attacker', {
      [OAUTH_STATE_COOKIE]: 's1', [OAUTH_VERIFIER_COOKIE]: 'v', [OAUTH_NONCE_COOKIE]: 'n',
    }))
    expect(redirectMarker(res)).toContain('google_error=invalid_state')
    expect(state.sessionsCreated.length).toBe(0)
  })

  it('known Google subject → session + google_done redirect', async () => {
    const student = addStudent({ email: 'g.learner@example.com' })
    state.identities.set('oi-1', { id: 'oi-1', provider: 'google', subject: 'google-sub-1', studentId: student.id as string })
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=s1', {
      [OAUTH_STATE_COOKIE]: 's1', [OAUTH_VERIFIER_COOKIE]: 'v', [OAUTH_NONCE_COOKIE]: 'n',
    }))
    expect(redirectMarker(res)).toContain('google_done=1')
    expect(state.sessionsCreated).toContain(student.id)
  })

  it('email match + password account → pending LINK (proof of ownership required)', async () => {
    addStudent({ email: 'g.learner@example.com', passwordHash: 'scrypt$...' })
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=s1', {
      [OAUTH_STATE_COOKIE]: 's1', [OAUTH_VERIFIER_COOKIE]: 'v', [OAUTH_NONCE_COOKIE]: 'n',
    }))
    const marker = redirectMarker(res)
    expect(marker).toContain('google_link=')
    expect(state.sessionsCreated.length).toBe(0)
    expect(state.identities.size).toBe(0)
    const pending = [...state.pendings.values()][0]
    expect(pending.purpose).toBe('LINK')
  })

  it('email match + password-less account → direct link and sign-in (no password touched)', async () => {
    const student = addStudent({ email: 'g.learner@example.com', passwordHash: null })
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=s1', {
      [OAUTH_STATE_COOKIE]: 's1', [OAUTH_VERIFIER_COOKIE]: 'v', [OAUTH_NONCE_COOKIE]: 'n',
    }))
    expect(redirectMarker(res)).toContain('google_done=1')
    expect(state.sessionsCreated).toContain(student.id)
    expect(state.identities.size).toBe(1)
  })

  it('no account → pending SIGNUP (legal acceptance happens client-side next)', async () => {
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=s1', {
      [OAUTH_STATE_COOKIE]: 's1', [OAUTH_VERIFIER_COOKIE]: 'v', [OAUTH_NONCE_COOKIE]: 'n',
    }))
    const marker = redirectMarker(res)
    expect(marker).toContain('google_signup=')
    expect(state.sessionsCreated.length).toBe(0)
  })

  it('verification failure (e.g. invalid signature) → honest error marker, no session', async () => {
    state.verifyError = 'id_token_bad_signature'
    const res = await callbackRoute.GET(getReq('http://localhost/api/auth/google/callback?code=c&state=s1', {
      [OAUTH_STATE_COOKIE]: 's1', [OAUTH_VERIFIER_COOKIE]: 'v', [OAUTH_NONCE_COOKIE]: 'n',
    }))
    expect(redirectMarker(res)).toContain('google_error=invalid_signature')
    expect(state.sessionsCreated.length).toBe(0)
  })
})

describe('POST /api/auth/google/link — proof of ownership', () => {
  beforeEach(() => { resetState(); resetRateLimits() })

  it('requires the account password when one exists (wrong password → 401)', async () => {
    const student = addStudent({ email: 'pw@example.com', passwordHash: 'scrypt$...' })
    state.passwordOk = false
    const pending = { id: 'pending-p1-xxxxx', provider: 'google', subject: 'sub-1', email: 'pw@example.com', displayName: null, purpose: 'LINK', expiresAt: new Date(Date.now() + 60_000) }
    state.pendings.set('pending-p1-xxxxx', pending)
    const res = await linkRoute.POST(postReq('http://localhost/api/auth/google/link', { pendingId: 'pending-p1-xxxxx', password: 'wrong-one' }))
    expect(res.status).toBe(401)
    expect(state.identities.size).toBe(0)
    void student
  })

  it('links without a password for Google-only (password-less) accounts', async () => {
    const student = addStudent({ email: 'gonly@example.com', passwordHash: null })
    const pending = { id: 'pending-p2-xxxxx', provider: 'google', subject: 'sub-2', email: 'gonly@example.com', displayName: null, purpose: 'LINK', expiresAt: new Date(Date.now() + 60_000) }
    state.pendings.set('pending-p2-xxxxx', pending)
    const res = await linkRoute.POST(postReq('http://localhost/api/auth/google/link', { pendingId: 'pending-p2-xxxxx' }))
    expect(res.status).toBe(200)
    expect(state.sessionsCreated).toContain(student.id)
    expect(state.identities.size).toBe(1)
  })

  it('correct password links a password account', async () => {
    const student = addStudent({ email: 'pw2@example.com', passwordHash: 'scrypt$...' })
    state.passwordOk = true
    const pending = { id: 'pending-p3-xxxxx', provider: 'google', subject: 'sub-3', email: 'pw2@example.com', displayName: null, purpose: 'LINK', expiresAt: new Date(Date.now() + 60_000) }
    state.pendings.set('pending-p3-xxxxx', pending)
    const res = await linkRoute.POST(postReq('http://localhost/api/auth/google/link', { pendingId: 'pending-p3-xxxxx', password: 'right' }))
    expect(res.status).toBe(200)
    expect(state.sessionsCreated).toContain(student.id)
  })

  it('expired pending records are refused', async () => {
    const pending = { id: 'pending-p4-xxxxx', provider: 'google', subject: 'sub-4', email: 'x@example.com', displayName: null, purpose: 'LINK', expiresAt: new Date(Date.now() - 1000) }
    state.pendings.set('pending-p4-xxxxx', pending)
    const res = await linkRoute.POST(postReq('http://localhost/api/auth/google/link', { pendingId: 'pending-p4-xxxxx' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('pending_expired')
  })

  it('refuses linking a subject that already belongs to another account', async () => {
    addStudent({ email: 'pw3@example.com', passwordHash: null })
    const other = addStudent({ email: 'other@example.com', passwordHash: null })
    state.identities.set('oi-9', { id: 'oi-9', provider: 'google', subject: 'sub-taken', studentId: other.id as string })
    const pending = { id: 'pending-p5-xxxxx', provider: 'google', subject: 'sub-taken', email: 'pw3@example.com', displayName: null, purpose: 'LINK', expiresAt: new Date(Date.now() + 60_000) }
    state.pendings.set('pending-p5-xxxxx', pending)
    const res = await linkRoute.POST(postReq('http://localhost/api/auth/google/link', { pendingId: 'pending-p5-xxxxx' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('subject_taken')
  })
})

describe('POST /api/auth/google/complete — first-time signup', () => {
  beforeEach(() => { resetState(); resetRateLimits() })

  function makePending(): string {
    const pending = { id: 'pending-c1-xxxxx', provider: 'google', subject: 'sub-new', email: 'newg@example.com', displayName: 'New G', purpose: 'SIGNUP', expiresAt: new Date(Date.now() + 60_000) }
    state.pendings.set('pending-c1-xxxxx', pending)
    return 'pending-c1-xxxxx'
  }

  it('refuses stale legal versions (same rule as password signup)', async () => {
    makePending()
    const res = await completeRoute.POST(postReq('http://localhost/api/auth/google/complete', {
      pendingId: 'pending-c1-xxxxx', acceptedTermsVersion: 'old', privacyNoticeVersion: CURRENT_PRIVACY, ageDeclaration: 'ADULT_18_PLUS', intent: 'STUDENT',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('stale_legal_version')
    expect(state.students.size).toBe(0)
  })

  it('refuses under-18 signups — nothing is created', async () => {
    makePending()
    const res = await completeRoute.POST(postReq('http://localhost/api/auth/google/complete', {
      pendingId: 'pending-c1-xxxxx', acceptedTermsVersion: CURRENT_TERMS, privacyNoticeVersion: CURRENT_PRIVACY, ageDeclaration: 'UNDER_18', intent: 'STUDENT',
    }))
    expect(res.status).toBe(403)
    expect(state.students.size).toBe(0)
    expect(state.pendings.size).toBe(1)
  })

  it('creates a Google-only STUDENT account with acceptance records and a session', async () => {
    makePending()
    const res = await completeRoute.POST(postReq('http://localhost/api/auth/google/complete', {
      pendingId: 'pending-c1-xxxxx', acceptedTermsVersion: CURRENT_TERMS, privacyNoticeVersion: CURRENT_PRIVACY, ageDeclaration: 'ADULT_18_PLUS', intent: 'TEACHER',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.role).toBe('STUDENT')
    expect(data.student.signupIntent).toBe('TEACHER')
    expect(state.sessionsCreated.length).toBe(1)
    expect(state.identities.size).toBe(1)
    const created = state.students.get(data.student.id)
    expect(created?.passwordHash).toBeNull()
    expect(state.acceptances.some(a => a.document === 'TERMS')).toBe(true)
    expect(state.acceptances.some(a => a.document === 'PRIVACY')).toBe(true)
    expect(state.pendings.size).toBe(0)
  })

  it('never creates a duplicate account when the email already exists with a password', async () => {
    makePending()
    addStudent({ email: 'newg@example.com', passwordHash: 'scrypt$...' })
    const res = await completeRoute.POST(postReq('http://localhost/api/auth/google/complete', {
      pendingId: 'pending-c1-xxxxx', acceptedTermsVersion: CURRENT_TERMS, privacyNoticeVersion: CURRENT_PRIVACY, ageDeclaration: 'ADULT_18_PLUS', intent: 'STUDENT',
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('account_exists')
  })

  it('refuses a duplicate Google subject (one subject → one account)', async () => {
    makePending()
    const existing = addStudent({ email: 'other2@example.com', passwordHash: null })
    state.identities.set('oi-8', { id: 'oi-8', provider: 'google', subject: 'sub-new', studentId: existing.id as string })
    const res = await completeRoute.POST(postReq('http://localhost/api/auth/google/complete', {
      pendingId: 'pending-c1-xxxxx', acceptedTermsVersion: CURRENT_TERMS, privacyNoticeVersion: CURRENT_PRIVACY, ageDeclaration: 'ADULT_18_PLUS', intent: 'STUDENT',
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('subject_taken')
  })

  it('expired pending signups are refused', async () => {
    const pending = { id: 'pending-c9-xxxxx', provider: 'google', subject: 'sub-exp', email: 'exp@example.com', displayName: null, purpose: 'SIGNUP', expiresAt: new Date(Date.now() - 1000) }
    state.pendings.set('pending-c9-xxxxx', pending)
    const res = await completeRoute.POST(postReq('http://localhost/api/auth/google/complete', {
      pendingId: 'pending-c9-xxxxx', acceptedTermsVersion: CURRENT_TERMS, privacyNoticeVersion: CURRENT_PRIVACY, ageDeclaration: 'ADULT_18_PLUS', intent: 'STUDENT',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('pending_expired')
  })
})
