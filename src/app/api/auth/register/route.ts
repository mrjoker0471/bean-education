import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { createSession, hashPassword, sameOrigin, setSessionCookie } from '@/lib/auth'

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
})

/** The role every new account gets — there is no code path that can change this. */
export const REGISTRATION_ROLE = 'STUDENT' as const

// POST — create an account. Passwords are scrypt-hashed (see lib/auth); the
// plaintext and the hash are never logged or returned. On success the student
// is signed in immediately (session cookie issued here).
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
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
            : 'Enter a valid email address and a password of at least 8 characters.'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { password } = parsed.data

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
      data: { email, passwordHash, displayName: parsed.data.displayName ?? null, role: REGISTRATION_ROLE },
      select: { id: true, email: true, displayName: true, learningLevel: true, role: true, onboardedAt: true },
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
