// ─── Authentication age clarity + legal consent alignment (signup-only gates) ─
// Two regression surfaces in one file:
//
//   1. ROUTE-LEVEL — the registration contract is audience-agnostic and
//      unchanged: every signup (password AND Google) requires an explicit age
//      declaration, the CURRENT legal versions, and the server-side under-18
//      fail-safe refuses UNDER_18 for EVERY intent. The teacher presentation
//      change is presentational only — the teacher flow maps its single
//      eligibility checkbox onto the same server-validated
//      `ageDeclaration: 'ADULT_18_PLUS'` contract and can never silently
//      bypass or fabricate it.
//
//   2. SOURCE-LEVEL — the CI-3 sign-in regression stays fixed (password
//      sign-in and Google sign-in render/require NO signup declarations), the
//      teacher presentation collects no DOB / numeric age / under-18 option,
//      the legal-consent rows keep the link OUTSIDE the label (activating a
//      link can never toggle a checkbox or submit the form), and the version
//      metadata is derived from the server config — never hardcoded.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/rate-limit'

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

// The real legal-config defaults are the "current" versions in tests
// (no BEAN_TERMS_VERSION/BEAN_PRIVACY_VERSION env in the test process).
const CURRENT_TERMS = '2026-11-23-draft.1'
const CURRENT_PRIVACY = '2026-11-23-draft.1'

// ─── Route-level state + mocks (per repo pattern) ─────────────────────────────
const state = {
  students: new Map<string, Record<string, unknown>>(),
  acceptances: [] as { studentId: string; document: string; version: string }[],
  identities: [] as { provider: string; subject: string; studentId: string }[],
  pendings: new Map<string, Record<string, unknown>>(),
  nextId: 1,
}

function resetState() {
  state.students.clear()
  state.acceptances.length = 0
  state.identities.length = 0
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
    create: async ({ data }: { data: Record<string, unknown> }) => {
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
      const la = data.legalAcceptances as { create?: { document: string; version: string }[] } | undefined
      for (const a of la?.create ?? []) {
        state.acceptances.push({ studentId: row.id, document: a.document, version: a.version })
      }
      return { id: row.id, email: row.email, displayName: row.displayName, learningLevel: row.learningLevel, role: row.role, onboardedAt: row.onboardedAt, signupIntent: row.signupIntent }
    },
  },
  oAuthPendingAuth: {
    findUnique: async ({ where }: { where: { id: string } }) => state.pendings.get(where.id) ?? null,
    delete: async ({ where }: { where: { id: string } }) => {
      state.pendings.delete(where.id)
      return undefined
    },
  },
  oAuthIdentity: {
    create: async ({ data }: { data: { provider: string; subject: string; studentId: string } }) => {
      state.identities.push(data)
      return data
    },
  },
  legalAcceptance: {
    createMany: async ({ data }: { data: { studentId: string; document: string; version: string }[] }) => {
      for (const a of data) state.acceptances.push({ studentId: a.studentId, document: a.document, version: a.version })
      return undefined
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock())

const registerRoute = await import('@/app/api/auth/register/route')
const googleCompleteRoute = await import('@/app/api/auth/google/complete/route')

function req(path: string, body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const REGISTER_BODY = {
  email: 'new.teacher@example.com',
  password: 'correct-horse-battery',
  acceptedTermsVersion: CURRENT_TERMS,
  privacyNoticeVersion: CURRENT_PRIVACY,
  ageDeclaration: 'ADULT_18_PLUS',
  intent: 'TEACHER',
}

function seedGooglePending(email = 'google.teacher@example.com'): string {
  const id = `pending-${state.nextId++}-xxxxxxxxx`
  state.pendings.set(id, {
    id,
    provider: 'google',
    subject: 'google-sub-teacher-1',
    email,
    displayName: 'Google Teacher',
    purpose: 'SIGNUP',
    expiresAt: new Date(Date.now() + 600_000),
  })
  return id
}

describe('POST /api/auth/register — teacher 18+ eligibility maps onto the unchanged contract', () => {
  beforeEach(() => {
    resetState()
    resetRateLimits()
  })

  it('creates a teacher-intent account ONLY with an explicit 18+ declaration (server sets the age band)', async () => {
    const res = await registerRoute.POST(req('/api/auth/register', REGISTER_BODY))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.role).toBe('STUDENT') // audience is navigation intent, never a role
    expect(data.student.signupIntent).toBe('TEACHER')
    const row = state.students.get(data.student.id)
    expect(row?.ageBand).toBe('ADULT_18_PLUS') // set server-side, never echoed from the client as-is
    const terms = state.acceptances.find(a => a.document === 'TERMS')
    const privacy = state.acceptances.find(a => a.document === 'PRIVACY')
    expect(terms?.version).toBe(CURRENT_TERMS)
    expect(privacy?.version).toBe(CURRENT_PRIVACY)
  })

  it('refuses a teacher-intent registration WITHOUT the declaration (cannot silently bypass)', async () => {
    const { ageDeclaration: _a, ...missing } = REGISTER_BODY
    const res = await registerRoute.POST(req('/api/auth/register', missing))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Please complete the age declaration.')
    expect(state.students.size).toBe(0)
    expect(state.acceptances.length).toBe(0)
  })

  it('refuses a teacher-intent UNDER_18 declaration — the backend under-18 guard is audience-independent', async () => {
    const res = await registerRoute.POST(req('/api/auth/register', { ...REGISTER_BODY, ageDeclaration: 'UNDER_18' }))
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.code).toBe('guardian_verification_unavailable')
    expect(state.students.size).toBe(0)
  })
})

describe('POST /api/auth/register — student and institution safeguards remain intact', () => {
  beforeEach(() => {
    resetState()
    resetRateLimits()
  })

  it('refuses a student-intent UNDER_18 declaration (fail-safe, nothing stored)', async () => {
    const res = await registerRoute.POST(req('/api/auth/register', { ...REGISTER_BODY, email: 'kid@example.com', intent: 'STUDENT', ageDeclaration: 'UNDER_18' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_verification_unavailable')
    expect(state.students.size).toBe(0)
    expect(state.acceptances.length).toBe(0)
  })

  it('refuses a student-intent registration without any declaration', async () => {
    const { ageDeclaration: _a, ...missing } = REGISTER_BODY
    const res = await registerRoute.POST(req('/api/auth/register', { ...missing, email: 'kid2@example.com', intent: 'STUDENT' }))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })

  it('creates an institution-intent account with the explicit declaration; refuses UNDER_18', async () => {
    const ok = await registerRoute.POST(req('/api/auth/register', { ...REGISTER_BODY, email: 'inst@example.com', intent: 'INSTITUTION' }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).student.signupIntent).toBe('INSTITUTION')
    resetState()
    const refused = await registerRoute.POST(req('/api/auth/register', { ...REGISTER_BODY, email: 'inst2@example.com', intent: 'INSTITUTION', ageDeclaration: 'UNDER_18' }))
    expect(refused.status).toBe(403)
    expect(state.students.size).toBe(0)
  })

  it('still enforces the CURRENT legal versions and refuses client-set roles (consent + escalation regressions)', async () => {
    const stale = await registerRoute.POST(req('/api/auth/register', { ...REGISTER_BODY, acceptedTermsVersion: '1999-01-01-old' }))
    expect(stale.status).toBe(400)
    expect((await stale.json()).code).toBe('stale_legal_version')
    const role = await registerRoute.POST(req('/api/auth/register', { ...REGISTER_BODY, email: 'role@example.com', role: 'ADMIN' }))
    expect(role.status).toBe(400)
    expect(state.students.size).toBe(0)
  })
})

describe('POST /api/auth/google/complete — Google signup keeps every eligibility check', () => {
  beforeEach(() => {
    resetState()
    resetRateLimits()
  })

  it('completes a teacher-intent Google signup with the explicit 18+ declaration', async () => {
    const pendingId = seedGooglePending()
    const res = await googleCompleteRoute.POST(req('/api/auth/google/complete', {
      pendingId,
      acceptedTermsVersion: CURRENT_TERMS,
      privacyNoticeVersion: CURRENT_PRIVACY,
      ageDeclaration: 'ADULT_18_PLUS',
      intent: 'TEACHER',
    }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.student.signupIntent).toBe('TEACHER')
    expect(data.student.role).toBe('STUDENT')
    const row = state.students.get(data.student.id)
    expect(row?.ageBand).toBe('ADULT_18_PLUS')
    expect(state.identities).toEqual([{ provider: 'google', subject: 'google-sub-teacher-1', studentId: data.student.id }])
  })

  it('refuses a Google signup with an UNDER_18 declaration (fail-safe, nothing created)', async () => {
    const pendingId = seedGooglePending('google-kid@example.com')
    const res = await googleCompleteRoute.POST(req('/api/auth/google/complete', {
      pendingId,
      acceptedTermsVersion: CURRENT_TERMS,
      privacyNoticeVersion: CURRENT_PRIVACY,
      ageDeclaration: 'UNDER_18',
      intent: 'STUDENT',
    }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('guardian_verification_unavailable')
    expect(state.students.size).toBe(0)
  })

  it('refuses a Google signup without any age declaration', async () => {
    const pendingId = seedGooglePending('google-nodecl@example.com')
    const res = await googleCompleteRoute.POST(req('/api/auth/google/complete', {
      pendingId,
      acceptedTermsVersion: CURRENT_TERMS,
      privacyNoticeVersion: CURRENT_PRIVACY,
      intent: 'STUDENT',
    }))
    expect(res.status).toBe(400)
    expect(state.students.size).toBe(0)
  })
})

// ─── Source-level regression guards ────────────────────────────────────────────
const authView = stripComments(readFileSync('src/components/bean/auth-view.tsx', 'utf8'))
const consentRow = stripComments(readFileSync('src/components/bean/legal-consent-row.tsx', 'utf8'))
const loginRoute = stripComments(readFileSync('src/app/api/auth/login/route.ts', 'utf8'))
const teachSchema = stripComments(readFileSync('src/lib/teach-schema.ts', 'utf8'))
const teachSchemaRaw = readFileSync('src/lib/teach-schema.ts', 'utf8')

describe('auth-view — teacher presentation is a single eligibility confirmation', () => {
  const TEACHER_SENTENCE = 'I confirm that I am 18 or older and eligible to create a BEAN Teacher account.'

  it('renders the exact single-checkbox confirmation sentence for the teacher audience', () => {
    expect(authView).toContain(TEACHER_SENTENCE)
    expect(authView).toContain('id="bean-teacher-adult"')
    expect(authView).toContain('htmlFor="bean-teacher-adult"')
  })

  it('the teacher fieldset contains no under-18 option, no bean-age radios, no DOB and no numeric age input', () => {
    const teacherStart = authView.indexOf("props.audience === 'TEACHER'")
    const noteEnd = authView.indexOf('BEAN Teach application.', teacherStart)
    expect(teacherStart).toBeGreaterThan(-1)
    expect(noteEnd).toBeGreaterThan(teacherStart)
    const teacherBlock = authView.slice(teacherStart, noteEnd + 'BEAN Teach application.'.length)
    expect(teacherBlock).toContain(TEACHER_SENTENCE)
    expect(teacherBlock).not.toContain('bean-age')
    expect(teacherBlock).not.toContain('I am under 18')
    expect(teacherBlock).not.toContain('type="date"')
    expect(teacherBlock).not.toContain('inputMode="numeric"')
    expect(teacherBlock).not.toContain('type="number"')
  })

  it('the whole signup collects no date of birth anywhere; the teach application schema still collects none', () => {
    expect(authView).not.toContain('type="date"')
    expect(authView.toLowerCase()).not.toContain('date of birth')
    expect(authView.toLowerCase()).not.toContain('dateofbirth')
    // The teacher professional profile (teach application) deliberately collects
    // no date of birth — the documenting comment is part of the contract.
    expect(teachSchemaRaw).toContain('does NOT collect date of birth')
    expect(teachSchema).not.toMatch(/\b(dob|dateOfBirth|birthDate)\b/i)
    expect(teachSchema).not.toContain("type: 'age'")
  })

  it('explains the confirmation is BEAN account eligibility, not a teaching qualification', () => {
    expect(authView).toContain('not a teaching')
    expect(authView).toContain('account-eligibility requirement')
    expect(authView).toContain('BEAN Teach application')
  })

  it('the student/institution two-option declaration and its safeguarding explanation are preserved', () => {
    expect(authView).toContain('name="bean-age"')
    expect((authView.match(/name="bean-age"/g) ?? []).length).toBe(2)
    expect(authView).toContain('I am 18 or older')
    expect(authView).toContain('I am under 18')
    expect(authView).toContain('guardian verification that is not available yet')
  })

  it('switching audience resets the declaration (no cross-presentation carry-over)', () => {
    const idx = authView.indexOf('const chooseAudience')
    const body = authView.slice(idx, authView.indexOf('}', idx) + 1)
    expect(body).toContain('setAgeBand(null)')
  })
})

describe('auth-view — signup-only gating (CI-3 sign-in regression stays fixed)', () => {
  it('the legal acceptance block renders ONLY on the signup panel (password sign-in never shows declarations)', () => {
    const rendered = (authView.match(/<LegalAcceptanceFields/g) ?? []).length
    expect(rendered).toBe(2) // password signup panel + Google signup panel
    expect(authView).toMatch(/panel === 'signup' && \(\s*<LegalAcceptanceFields/)
    expect(authView).not.toMatch(/panel === 'signin'[^}]*<LegalAcceptanceFields/)
  })

  it('the declaration gates run under `panel === signup` only; sign-in submits without any declaration check', () => {
    const submitIdx = authView.indexOf('const submit = async')
    const submitBody = authView.slice(submitIdx, authView.indexOf('const submitLink', submitIdx))
    expect(submitBody).toContain("if (panel === 'signup')")
    // The declaration checks live INSIDE the signup branch...
    const signupBranch = submitBody.slice(submitBody.indexOf("if (panel === 'signup')"), submitBody.indexOf("setBusy(true)"))
    expect(signupBranch).toContain("audience === 'TEACHER'")
    expect(signupBranch).toContain('UNDER_18')
    // ...and the sign-in branch performs no declaration/version gating.
    const signinBranch = submitBody.slice(submitBody.indexOf("if (panel === 'signin')"), submitBody.indexOf('if (declaredAge === null)'))
    expect(signinBranch).not.toContain('ageBand')
    expect(signinBranch).not.toContain('acceptTerms')
    expect(signinBranch).not.toContain('ackPrivacy')
    expect(signinBranch).not.toContain('declaredAge')
  })

  it('the password login API requires only email+password — no age or legal validation', () => {
    expect(loginRoute).not.toContain('ageDeclaration')
    expect(loginRoute).not.toContain('acceptedTermsVersion')
    expect(loginRoute).not.toContain('UNDER_18')
    expect(loginRoute).not.toContain('legal-config')
  })

  it('Google sign-IN is never blocked by signup-only UI state (start has no declaration dependency)', () => {
    const startIdx = authView.indexOf('const startGoogle')
    const startBody = authView.slice(startIdx, authView.indexOf('const audienceTitle', startIdx))
    expect(startBody).not.toContain('ageBand')
    expect(startBody).not.toContain('acceptTerms')
    expect(startBody).not.toContain('ackPrivacy')
    const buttonIdx = authView.indexOf('Continue with Google')
    const buttonBlock = authView.slice(buttonIdx - 400, buttonIdx + 200)
    expect(buttonBlock).toMatch(/disabled=\{googleConfigured === false \|\| busy\}/)
  })

  it('Google SIGN-UP keeps the full eligibility gate and the declaration passthrough', () => {
    const gIdx = authView.indexOf('const submitGoogleSignup')
    const gBody = authView.slice(gIdx, authView.indexOf('const startGoogle', gIdx))
    expect(gBody).toContain("audience === 'TEACHER'")
    expect(gBody).toContain('UNDER_18')
    expect(gBody).toContain('ageDeclaration: ageBand')
    expect(gBody).toContain('acceptedTermsVersion')
    expect(gBody).toContain('privacyNoticeVersion')
  })

  it('both signup paths fabricate nothing: the payload carries the explicit ADULT_18_PLUS declaration only', () => {
    // The single declaration constant flows from the guarded state — the only
    // literal in the component is the checkbox mapping (explicit user action).
    expect(authView).toContain("v === true ? 'ADULT_18_PLUS' : null")
    expect((authView.match(/ageDeclaration: declaredAge|ageDeclaration: ageBand/g) ?? []).length).toBe(2)
  })
})

describe('legal-consent rows — alignment, link safety and honest version metadata', () => {
  it('uses a fixed checkbox column and a flexible text column that cannot overflow', () => {
    expect(consentRow).toContain('grid-cols-[auto_minmax(0,1fr)]')
    expect(consentRow).toContain('items-start')
    expect(consentRow).toContain('min-w-0')
  })

  it('the document link is a SIBLING of the label — never nested inside it', () => {
    const labelStart = consentRow.indexOf('<Label')
    const labelEnd = consentRow.indexOf('</Label>', labelStart)
    const linkStart = consentRow.indexOf('<a', labelEnd)
    expect(labelStart).toBeGreaterThan(-1)
    expect(labelEnd).toBeGreaterThan(labelStart)
    expect(linkStart).toBeGreaterThan(labelEnd) // link renders after the label closes
    const labelBlock = consentRow.slice(labelStart, labelEnd)
    expect(labelBlock).not.toContain('href') // no interactive element inside the label
  })

  it('the link opens in a new tab with safe rel attributes (form state survives reading the document)', () => {
    expect(consentRow).toContain('target="_blank"')
    expect(consentRow).toContain('rel="noreferrer"')
  })

  it('version metadata occupies its own muted line and derives from the server config', () => {
    expect(consentRow).toContain('Draft · Version')
    expect(consentRow).toContain('Effective ${effectiveDate} · Version ${version}')
    expect(consentRow).toContain('Version not published yet')
    // Effective is shown ONLY when the owner actually configured a date:
    expect(consentRow).toContain("draft === false && effectiveDate")
    // No fabricated versions or dates anywhere in the component or the view:
    expect(consentRow).not.toContain('2026-11-23')
    expect(authView).not.toContain('2026-11-23-draft.1')
  })

  it('the rows target the EXISTING Terms and Privacy routes with equal, separated surfaces', () => {
    expect(authView).toContain('linkHref="#/terms"')
    expect(authView).toContain('linkHref="#/privacy"')
    expect(authView).toContain('I agree to the Terms & Conditions.')
    expect(authView).toContain('I acknowledge the Privacy Policy and understand how my information is used.')
    expect(authView).toContain('divide-y divide-hairline')
    expect((authView.match(/<LegalConsentRow/g) ?? []).length).toBe(2)
  })

  it('the server contract is untouched: the register schema still owns the declaration vocabulary', () => {
    const registerRoute = stripComments(readFileSync('src/app/api/auth/register/route.ts', 'utf8'))
    expect(registerRoute).toContain("ageDeclaration: z.enum(['ADULT_18_PLUS', 'UNDER_18'])")
    expect(registerRoute).toContain("ageBand: 'ADULT_18_PLUS'")
    expect(registerRoute).not.toContain('candidate.ageBand') // never echoed from the client
  })
})
