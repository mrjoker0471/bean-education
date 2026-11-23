import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { createSession, hashPassword, sameOrigin, setSessionCookie } from '@/lib/auth'
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@/lib/legal-config'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Normalized (lowercased) email shape — deliberately conservative. Normalization
// happens BEFORE validation so the stored email is always canonical.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

const bodySchema = z.object({
  email: z.string().regex(EMAIL_RE, 'Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200, 'Password must be 200 characters or fewer'),
  displayName: z.string().max(80, 'Display name must be 80 characters or fewer').optional(),
  // SECURITY (Phase 2B): role is NEVER client-settable. The field is parsed
  // only to detect and refuse attempts; every created account is STUDENT.
  // Promotion to PYQ_CURATOR/ADMIN happens exclusively via the operator CLI
  // (scripts/grant-role.ts) with direct server-side DB access.
  role: z.unknown().optional(),
  // Legal acceptance (public-experience milestone): the CURRENT versions are
  // validated SERVER-side — the browser cannot assert a version of its own.
  acceptedTermsVersion: z.string().min(1).max(64),
  privacyNoticeVersion: z.string().min(1).max(64),
  // Minimal age self-declaration. Under-18 personal-data accounts are refused
  // (fail-safe) until verifiable parental consent is live; no DOB is collected.
  ageDeclaration: z.enum(['ADULT_18_PLUS', 'UNDER_18']),
  // Onboarding/navigation intent — never an authorization role.
  intent: z.enum(['STUDENT', 'TEACHER']).default('STUDENT'),
})

/** The role every new account gets — there is no code path that can change this. */
export const REGISTRATION_ROLE = 'STUDENT' as const

// POST — create an account. Passwords are scrypt-hashed (see lib/auth); the
// plaintext and the hash are never logged or returned. On success the student
// is signed in immediately (session cookie issued here). Signup REQUIRES the
// current Terms acceptance and Privacy acknowledgement and an honest age
// declaration; optional consents are purpose-specific and none are preselected.
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  if (rateLimited(clientKey(req, 'register'), 8, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment and try again.' }, { status: 429 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }

  // Normalize first: trim + lowercase the email, trim displayName, drop empty names.
  const candidate = (raw ?? {}) as Record<string, unknown>
  const email = typeof candidate.email === 'string' ? candidate.email.trim().toLowerCase() : undefined
  const displayName =
    typeof candidate.displayName === 'string' && candidate.displayName.trim().length > 0
      ? candidate.displayName.trim()
      : undefined

  const parsed = bodySchema.safeParse({
    email,
    password: typeof candidate.password === 'string' ? candidate.password : undefined,
    displayName,
    acceptedTermsVersion: typeof candidate.acceptedTermsVersion === 'string' ? candidate.acceptedTermsVersion : undefined,
    privacyNoticeVersion: typeof candidate.privacyNoticeVersion === 'string' ? candidate.privacyNoticeVersion : undefined,
    ageDeclaration: typeof candidate.ageDeclaration === 'string' ? candidate.ageDeclaration : undefined,
    intent: typeof candidate.intent === 'string' ? candidate.intent : undefined,
  })
  if (!parsed.success || !email) {
    // Rule-based messages (never raw validator output).
    const first = parsed.success ? null : parsed.error.issues[0]?.path[0]
    const message =
      first === 'email'
        ? 'Enter a valid email address.'
        : first === 'password'
          ? 'Your password must be at least 8 characters and at most 200.'
          : first === 'displayName'
            ? 'Your display name must be 80 characters or fewer.'
            : first === 'acceptedTermsVersion' || first === 'privacyNoticeVersion'
              ? 'Please review and accept the current Terms and Privacy Notice to continue.'
              : first === 'ageDeclaration'
                ? 'Please complete the age declaration.'
                : 'Enter a valid email address and a password of at least 8 characters.'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { password, acceptedTermsVersion, privacyNoticeVersion, ageDeclaration, intent } = parsed.data

  if (ageDeclaration === 'UNDER_18') {
    // Fail-safe for children's personal-data accounts (DPDP §9 readiness):
    // no verifiable parental consent mechanism exists yet, so no under-18
    // account can be created and nothing about a child is stored.
    return NextResponse.json(
      {
        error: 'Guardian-verified accounts are not available yet. BEAN does not create personal-data accounts for under-18 users until verifiable parental consent is live. You can keep using guest mode — it stores no account data.',
        code: 'guardian_verification_unavailable',
      },
      { status: 403 },
    )
  }

  const versionErrors: Record<string, string> = {}
  if (acceptedTermsVersion !== CURRENT_TERMS_VERSION) versionErrors.terms = 'Please review and accept the current Terms and Conditions to continue.'
  if (privacyNoticeVersion !== CURRENT_PRIVACY_VERSION) versionErrors.privacy = 'Please review the current Privacy Notice to continue.'
  if (Object.keys(versionErrors).length > 0) {
    return NextResponse.json(
      { error: 'The legal documents have changed — please review the current versions.', code: 'stale_legal_version', details: versionErrors },
      { status: 400 },
    )
  }

  try {
    // Pre-check for a friendlier message, then rely on the unique index for races.
    const existing = await db.student.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists — try signing in instead.' },
        { status: 409 },
      )
    }

    // Refuse any request that tries to set a role (defense in depth — the zod
    // schema already strips it, this keeps the refusal explicit and auditable).
    if (candidate.role !== undefined) {
      return NextResponse.json(
        { error: 'Roles cannot be set through registration. Every new account starts as a STUDENT.' },
        { status: 400 },
      )
    }

    const passwordHash = await hashPassword(password)
    const student = await db.student.create({
      data: {
        email,
        passwordHash,
        displayName: parsed.data.displayName ?? null,
        role: REGISTRATION_ROLE,
        signupIntent: intent,
        ageBand: 'ADULT_18_PLUS',
        legalAcceptances: {
          create: [
            { document: 'TERMS', version: CURRENT_TERMS_VERSION },
            { document: 'PRIVACY', version: CURRENT_PRIVACY_VERSION },
          ],
        },
      },
      select: { id: true, email: true, displayName: true, learningLevel: true, role: true, onboardedAt: true, signupIntent: true },
    })

    const { token, expiresAt } = await createSession(student.id)
    await setSessionCookie(token, expiresAt)

    return NextResponse.json({
      student: {
        ...student,
        onboardedAt: student.onboardedAt ? student.onboardedAt.toISOString() : null,
      },
    })
  } catch (err) {
    // Unique-index race (or rare DB failure) — same honest message either way.
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'An account with this email already exists — try signing in instead.' },
        { status: 409 },
      )
    }
    console.error('[api/auth/register]', err)
    return NextResponse.json({ error: 'Could not create your account — please try again.' }, { status: 500 })
  }
}
