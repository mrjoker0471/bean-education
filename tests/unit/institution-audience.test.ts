// ─── Institution-audience milestone: intent, routing, privilege separation ───
// Covers the "Institution as third auth audience" milestone rules:
//   A1  registration accepts intent STUDENT | TEACHER | INSTITUTION and rejects
//       everything else (shared SIGNUP_INTENTS vocabulary, both paths)
//   A2  an INSTITUTION intent creates NO privileged access: role stays STUDENT,
//       no OrganizationMembership row appears, nothing is auto-approved
//   A3  the account-level under-18 guard is untouched and still enforced for
//       every intent (INSTITUTION included)
//   A4  Google completion persists the INSTITUTION intent like password signup
//   A5  routing: institution lands in the real organization workspace through
//       postAuthDestination / postOnboardingDestination; onboarding first when
//       needed; teacher lifecycle untouched
//   A6  teacher application schema collects no DOB/age/bank/identity fields —
//       and extra personal fields in a submission never reach the server data
//   A7  resolvePostAuthRoute handles the INSTITUTION intent override (Google
//       sign-in must not lose the audience choice)

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/rate-limit'

const CURRENT_TERMS = '2026-11-23-draft.1'
const CURRENT_PRIVACY = '2026-11-23-draft.1'

const state = {
  students: new Map<string, Record<string, unknown>>(),
  acceptances: [] as { studentId: string; document: string; version: string }[],
  memberships: [] as { organizationId: string; studentId: string; role: string }[],
  pendings: new Map<string, { id: string; provider: string; subject: string; email: string; displayName: string | null; purpose: string; expiresAt: Date }>(),
  nextId: 1,
}

function resetState() {
  state.students.clear()
  state.acceptances = []
  state.memberships = []
  state.pendings.clear()
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
      }
      state.students.set(row.id, row)
      for (const a of data.legalAcceptances?.create ?? []) {
        state.acceptances.push({ studentId: row.id, document: a.document, version: a.version })
      }
      return { id: row.id, email: row.email, displayName: row.displayName, learningLevel: row.learningLevel, role: row.role, onboardedAt: row.onboardedAt, signupIntent: row.signupIntent }
    },
  },
  oAuthPendingAuth: {
    findUnique: async ({ where }: { where: { id: string } }) => state.pendings.get(where.id) ?? null,
    delete: async ({ where }: { where: { id: string } }) => { state.pendings.delete(where.id) },
  },
  oAuthIdentity: {
    create: async ({ data }: { data: { provider: string; subject: string; studentId: string } }) => {
      const existing = [...state.pendings.values()].find(p => p.subject === data.subject && p.purpose === 'LINK')
      if (existing) {
        const err = new Error('unique constraint') as Error & { code?: string }
        err.code = 'P2002'
        throw err
      }
      return { id: `oi-${state.nextId++}`, ...data }
    },
  },
  legalAcceptance: {
    createMany: async ({ data }: { data: { studentId: string; document: string; version: string }[] }) => {
      state.acceptances.push(...data)
    },
  },
  organizationMembership: {
    findMany: async () => state.memberships,
    create: async ({ data }: { data: { organizationId: string; studentId: string; role: string } }) => {
      state.memberships.push(data)
      return data
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock())

const registerRoute = await import('@/app/api/auth/register/route')
const completeRoute = await import('@/app/api/auth/google/complete/route')
const teachSchema = await import('@/lib/teach-schema')
const intent = await import('@/lib/teacher-intent')

function req(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const VALID_BODY = {
  email: 'institution.admin@example.org',
  password: 'correct-horse-battery',
  acceptedTermsVersion: CURRENT_TERMS,
  privacyNoticeVersion: CURRENT_PRIVACY,
  ageDeclaration: 'ADULT_18_PLUS',
  intent: 'INSTITUTION',
}

beforeEach(() => {
  resetState()
  resetRateLimits()
})

// ─── A1 intent vocabulary ─────────────────────────────────────────────────────

describe('registration intent vocabulary (STUDENT | TEACHER | INSTITUTION)', () => {
  it('A1.1 accepts the INSTITUTION intent and records it on the account', async () => {
    const res = await registerRoute.POST(req(VALID_BODY))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.signupIntent).toBe('INSTITUTION')
  })

  it('A1.2 every account still gets the server-controlled STUDENT role', async () => {
    for (const intentValue of ['STUDENT', 'TEACHER', 'INSTITUTION']) {
      const res = await registerRoute.POST(req({ ...VALID_BODY, email: `${intentValue.toLowerCase()}.@example.com`, intent: intentValue }))
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.student.role).toBe('STUDENT')
    }
  })

  it('A1.3 rejects an unknown intent (vocabulary cannot drift client-side)', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, intent: 'ORGANIZATION_OWNER' }))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })

  it('A1.4 rejects client-supplied roles even with an INSTITUTION intent', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, role: 'ADMIN' }))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })

  it('A1.5 the shared vocabulary exports exactly the three intents', () => {
    expect([...intent.SIGNUP_INTENTS]).toEqual(['STUDENT', 'TEACHER', 'INSTITUTION'])
  })
})

// ─── A2 privilege separation ──────────────────────────────────────────────────

describe('institution intent grants no organization privilege', () => {
  it('A2.1 registering with INSTITUTION creates no OrganizationMembership and approves nothing', async () => {
    const res = await registerRoute.POST(req(VALID_BODY))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.role).toBe('STUDENT')
    expect(state.memberships.length).toBe(0)
    // Nothing in the registration path touched organization state.
    expect(JSON.stringify(data)).not.toContain('organization')
  })

  it('A2.2 INSTITUTION intent with UNDER_18 declaration is still refused (guard unchanged)', async () => {
    const res = await registerRoute.POST(req({ ...VALID_BODY, ageDeclaration: 'UNDER_18' }))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.code).toBe('guardian_verification_unavailable')
    expect(state.students.size).toBe(0)
  })
})

// ─── A4 Google completion persists the institution intent ────────────────────

describe('Google signup completion with INSTITUTION intent', () => {
  it('A4.1 completes a first-time Google signup with intent INSTITUTION', async () => {
    state.pendings.set('pending-inst-1', {
      id: 'pending-inst-1',
      provider: 'google',
      subject: 'google-sub-inst-1',
      email: 'inst.founder@example.org',
      displayName: 'Inst Founder',
      purpose: 'SIGNUP',
      expiresAt: new Date(Date.now() + 5 * 60_000),
    })
    const res = await completeRoute.POST(req({
      pendingId: 'pending-inst-1',
      acceptedTermsVersion: CURRENT_TERMS,
      privacyNoticeVersion: CURRENT_PRIVACY,
      ageDeclaration: 'ADULT_18_PLUS',
      intent: 'INSTITUTION',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.role).toBe('STUDENT')
    expect(data.student.signupIntent).toBe('INSTITUTION')
    expect(state.memberships.length).toBe(0)
  })

  it('A4.2 refuses an unknown intent on the Google path too', async () => {
    state.pendings.set('pending-inst-2', {
      id: 'pending-inst-2',
      provider: 'google',
      subject: 'google-sub-inst-2',
      email: 'inst2@example.org',
      displayName: null,
      purpose: 'SIGNUP',
      expiresAt: new Date(Date.now() + 5 * 60_000),
    })
    const res = await completeRoute.POST(req({
      pendingId: 'pending-inst-2',
      acceptedTermsVersion: CURRENT_TERMS,
      privacyNoticeVersion: CURRENT_PRIVACY,
      ageDeclaration: 'ADULT_18_PLUS',
      intent: 'SUPERUSER',
    }))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })
})

// ─── A5/A7 routing ────────────────────────────────────────────────────────────

describe('institution routing — real workspace, no invented stops', () => {
  it('A5.1 onboarded INSTITUTION intent lands in the institution hub', () => {
    const dest = intent.postAuthDestination({ intent: 'INSTITUTION', onboardedAt: '2026-11-24', applicationStatus: null })
    expect(dest.view).toBe('institution')
  })

  it('A5.2 a new INSTITUTION registration completes onboarding first', () => {
    const dest = intent.postAuthDestination({ intent: 'INSTITUTION', onboardedAt: null, applicationStatus: null })
    expect(dest.view).toBe('onboarding')
  })

  it('A5.3 onboarding hands off INSTITUTION to the organization hub', () => {
    expect(intent.postOnboardingDestination('INSTITUTION').view).toBe('institution')
    expect(intent.postOnboardingDestination('TEACHER').view).toBe('teach-apply')
    expect(intent.postOnboardingDestination('STUDENT').view).toBe('dashboard')
    expect(intent.postOnboardingDestination(null).view).toBe('dashboard')
  })

  it('A5.4 an audience change never changes authorization — teacher matrix intact', () => {
    expect(intent.postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: 'APPROVED' }).view).toBe('teach-dashboard')
    expect(intent.postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: 'PENDING' }).view).toBe('teach-apply')
    expect(intent.postAuthDestination({ intent: 'TEACHER', onboardedAt: '2026-01-01', applicationStatus: 'REJECTED' }).view).toBe('teach-apply')
    // An institution-member account choosing STUDENT keeps student routing.
    expect(intent.postAuthDestination({ intent: 'STUDENT', onboardedAt: '2026-01-01', applicationStatus: null }).view).toBe('dashboard')
  })

  it('A7.1 resolvePostAuthRoute honours the INSTITUTION intent override (Google sign-in restoration)', async () => {
    const dest = await intent.resolvePostAuthRoute(
      { signupIntent: 'STUDENT', onboardedAt: '2026-01-01' },
      'INSTITUTION',
    )
    expect(dest.view).toBe('institution')
  })

  it('A7.2 resolvePostAuthRoute falls back to the recorded signupIntent', async () => {
    const dest = await intent.resolvePostAuthRoute({ signupIntent: 'INSTITUTION', onboardedAt: '2026-01-01' })
    expect(dest.view).toBe('institution')
  })
})

// ─── A6 teacher application stays free of personal identity data ──────────────

describe('teacher application — no DOB/age/bank/identity fields', () => {
  it('A6.1 the application schema collects only professional eligibility data', () => {
    const keys = Object.keys(teachSchema.teachApplicationSchema.shape ?? teachSchema.teachApplicationSchema)
    expect(keys).toEqual([
      'teachingName',
      'headline',
      'bio',
      'subjects',
      'levels',
      'languages',
      'qualificationsText',
      'experienceYears',
      'portfolioUrl',
    ])
    const forbidden = /dateofbirth|\bdob\b|\bage\b|ageband|bank|aadhaar|pan|passport|identity|nationalid/i
    for (const key of keys) expect(forbidden.test(key)).toBe(false)
  })

  it('A6.2 a submission carrying extra personal fields never persists them (Zod strips unknowns)', () => {
    const parsed = teachSchema.teachApplicationSchema.safeParse({
      teachingName: 'Sarala Devi',
      headline: 'Mathematics teacher for classes 9-12',
      bio: 'Fifteen years teaching secondary mathematics across state and CBSE syllabi with a focus on conceptual clarity.',
      subjects: ['Mathematics'],
      levels: ['SCHOOL_9_10'],
      languages: ['English'],
      qualificationsText: 'M.Sc. Mathematics; B.Ed.; CTET qualified.',
      experienceYears: 15,
      dateOfBirth: '1988-04-01',
      bankAccount: 'XXXX0000',
      aadhaar: '0000 0000 0000',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>
      expect('dateOfBirth' in data).toBe(false)
      expect('bankAccount' in data).toBe(false)
      expect('aadhaar' in data).toBe(false)
    }
  })

  it('A6.3 the PATCH schema offers no path to add personal identity data either', () => {
    const parsed = teachSchema.teachApplicationPatchSchema.safeParse({ dateOfBirth: '1988-04-01', ageBand: 'ADULT_18_PLUS' })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const data = parsed.data as Record<string, unknown>
      expect('dateOfBirth' in data).toBe(false)
      expect('ageBand' in data).toBe(false)
    }
  })
})
