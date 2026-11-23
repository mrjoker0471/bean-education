import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { SESSION_COOKIE, createSession, sameOrigin, verifyPassword } from '@/lib/auth'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  pendingId: z.string().min(8).max(64),
  // Required only when the target account has a password (proof of ownership).
  password: z.string().min(1).max(200).optional(),
})

// POST — finish a Google LINK that requires proof of account ownership.
// The verified Google identity is parked server-side (OAuthPendingAuth, 10 min);
// the visitor proves they own the existing password account by supplying the
// password. Google-only (password-less) accounts link without a password —
// there is no other credential to prove against and no password is touched.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  if (rateLimited(clientKey(req, 'google-link'), 10, 5 * 60_000)) {
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

  try {
    const pending = await db.oAuthPendingAuth.findUnique({ where: { id: parsed.data.pendingId } })
    if (!pending || pending.provider !== 'google' || pending.purpose !== 'LINK') {
      return NextResponse.json({ error: 'This Google sign-in attempt has expired — please try again.', code: 'pending_expired' }, { status: 400 })
    }
    if (pending.expiresAt.getTime() < Date.now()) {
      await db.oAuthPendingAuth.delete({ where: { id: pending.id } }).catch(() => undefined)
      return NextResponse.json({ error: 'This Google sign-in attempt has expired — please try again.', code: 'pending_expired' }, { status: 400 })
    }

    const account = await db.student.findUnique({ where: { email: pending.email } })
    if (!account) {
      return NextResponse.json({ error: 'This Google sign-in attempt has expired — please try again.', code: 'pending_expired' }, { status: 400 })
    }

    if (account.passwordHash) {
      if (!parsed.data.password) {
        return NextResponse.json({ error: 'Enter your BEAN password to link your Google account.', code: 'password_required' }, { status: 400 })
      }
      const ok = await verifyPassword(parsed.data.password, account.passwordHash)
      if (!ok) {
        // Same honest message as login; no enumeration, no password logging.
        return NextResponse.json({ error: 'That password does not match this account.', code: 'invalid_password' }, { status: 401 })
      }
    }

    // One Google subject maps to at most one BEAN account (provider+subject unique).
    const existing = await db.oAuthIdentity.findUnique({
      where: { provider_subject: { provider: 'google', subject: pending.subject } },
    })
    if (existing && existing.studentId !== account.id) {
      return NextResponse.json({ error: 'This Google account is already linked to another BEAN account.', code: 'subject_taken' }, { status: 409 })
    }
    if (!existing) {
      await db.oAuthIdentity.create({ data: { provider: 'google', subject: pending.subject, studentId: account.id } })
    }

    await db.oAuthPendingAuth.delete({ where: { id: pending.id } }).catch(() => undefined)

    const { token, expiresAt } = await createSession(account.id)
    const res = NextResponse.json({
      student: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        learningLevel: account.learningLevel,
        role: account.role,
        onboardedAt: account.onboardedAt ? account.onboardedAt.toISOString() : null,
        signupIntent: account.signupIntent,
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
    console.error('[api/auth/google/link]', (err as Error).name)
    return NextResponse.json({ error: 'Could not link your Google account — please try again.' }, { status: 500 })
  }
}
