import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { SESSION_COOKIE, createSession, sameOrigin } from '@/lib/auth'
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '@/lib/legal-config'
import { clientKey, rateLimited } from '@/lib/rate-limit'
import { SIGNUP_INTENTS } from '@/lib/teacher-intent'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  pendingId: z.string().min(8).max(64),
  // Legal acceptance — versions are validated SERVER-side against the current
  // constants; browser-supplied versions are never trusted.
  acceptedTermsVersion: z.string().min(1).max(64),
  privacyNoticeVersion: z.string().min(1).max(64),
  // Minimal age self-declaration. Under-18 accounts are refused (fail-safe)
  // until verifiable parental consent ships — never silently accepted.
  ageDeclaration: z.enum(['ADULT_18_PLUS', 'UNDER_18']),
  // Onboarding/navigation intent — NEVER an authorization role. Same shared
  // vocabulary as password registration (STUDENT | TEACHER | INSTITUTION);
  // INSTITUTION creates no privilege and approves no organization.
  intent: z.enum(SIGNUP_INTENTS).default('STUDENT'),
})

// POST — finish a first-time Google SIGNUP with the exact same acceptance and
// consent requirements as normal registration: current Terms version, current
// Privacy Notice version, honest age declaration. Creates a STUDENT account
// (no client path can set a role), links the Google identity, records the
// versioned legal acceptances server-side and issues the BEAN session cookie.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  if (rateLimited(clientKey(req, 'google-complete'), 10, 5 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment and try again.' }, { status: 429 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const { pendingId, acceptedTermsVersion, privacyNoticeVersion, ageDeclaration, intent } = parsed.data

  if (ageDeclaration === 'UNDER_18') {
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
    return NextResponse.json({ error: 'The legal documents have changed — please review the current versions.', code: 'stale_legal_version', details: versionErrors }, { status: 400 })
  }

  try {
    const pending = await db.oAuthPendingAuth.findUnique({ where: { id: pendingId } })
    if (!pending || pending.provider !== 'google' || pending.purpose !== 'SIGNUP') {
      return NextResponse.json({ error: 'This Google sign-up attempt has expired — please try again.', code: 'pending_expired' }, { status: 400 })
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await db.oAuthPendingAuth.delete({ where: { id: pending.id } }).catch(() => undefined)
      return NextResponse.json({ error: 'This Google sign-up attempt has expired — please try again.', code: 'pending_expired' }, { status: 400 })
    }

    const email = pending.email.toLowerCase()

    // A password account with this email may have appeared while the pending
    // record sat open — then linking needs the ownership flow, not a signup.
    const existing = await db.student.findUnique({ where: { email } })
    if (existing) {
      if (existing.passwordHash) {
        return NextResponse.json(
          { error: 'An account with this email already exists — sign in with your password and link Google from there.', code: 'account_exists' },
          { status: 409 },
        )
      }
      // Password-less account raced in — link instead of creating a duplicate.
      const linked = await db.oAuthIdentity.create({
        data: { provider: 'google', subject: pending.subject, studentId: existing.id },
      }).catch(() => null)
      if (!linked) {
        return NextResponse.json({ error: 'This Google account is already linked to another BEAN account.', code: 'subject_taken' }, { status: 409 })
      }
      await db.legalAcceptance.createMany({
        data: [
          { studentId: existing.id, document: 'TERMS', version: CURRENT_TERMS_VERSION },
          { studentId: existing.id, document: 'PRIVACY', version: CURRENT_PRIVACY_VERSION },
        ],
      })
      await db.oAuthPendingAuth.delete({ where: { id: pending.id } }).catch(() => undefined)
      const { token, expiresAt } = await createSession(existing.id)
      const res = NextResponse.json({
        student: {
          id: existing.id, email: existing.email, displayName: existing.displayName,
          learningLevel: existing.learningLevel, role: existing.role,
          onboardedAt: existing.onboardedAt ? existing.onboardedAt.toISOString() : null,
          signupIntent: existing.signupIntent,
        },
      })
      res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt, path: '/' })
      return res
    }

    // The single transactional creation — role is hardcoded STUDENT, the
    // passwordHash stays null (Google-only account).
    const created = await db.student.create({
      data: {
        email,
        passwordHash: null,
        displayName: pending.displayName ?? null,
        role: 'STUDENT',
        signupIntent: intent,
        ageBand: 'ADULT_18_PLUS',
      },
      select: { id: true, email: true, displayName: true, learningLevel: true, role: true, onboardedAt: true, signupIntent: true },
    })

    await db.oAuthIdentity.create({ data: { provider: 'google', subject: pending.subject, studentId: created.id } })
    await db.legalAcceptance.createMany({
      data: [
        { studentId: created.id, document: 'TERMS', version: CURRENT_TERMS_VERSION },
        { studentId: created.id, document: 'PRIVACY', version: CURRENT_PRIVACY_VERSION },
      ],
    })
    await db.oAuthPendingAuth.delete({ where: { id: pending.id } }).catch(() => undefined)

    const { token, expiresAt } = await createSession(created.id)
    const res = NextResponse.json({
      student: {
        id: created.id,
        email: created.email,
        displayName: created.displayName,
        learningLevel: created.learningLevel,
        role: created.role,
        onboardedAt: created.onboardedAt ? created.onboardedAt.toISOString() : null,
        signupIntent: created.signupIntent,
      },
    })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
      path: '/',
    })
    return res
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This Google account is already linked to another BEAN account.', code: 'subject_taken' }, { status: 409 })
    }
    console.error('[api/auth/google/complete]', (err as Error).name)
    return NextResponse.json({ error: 'Could not complete your Google sign-up — please try again.' }, { status: 500 })
  }
}
