import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { createSession, sameOrigin, setSessionCookie, verifyPassword } from '@/lib/auth'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(200),
})

// A syntactically valid scrypt hash used ONLY to equalize timing when the email
// is unknown — unknown-email and wrong-password take the same code path and
// produce the same response, so account existence cannot be probed by timing.
const DUMMY_HASH = ['scrypt$16384$8$1$', 'A'.repeat(22), '==', 'A'.repeat(86), '=='].join('')

// POST — sign in. Unknown email and wrong password return the SAME 401 message
// (no account enumeration). Success issues a fresh session cookie.
export async function POST(req: NextRequest) {
  // CSRF-lite: browsers always send Origin on cross-site POSTs; reject mismatches.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  if (rateLimited(clientKey(req, 'login'), 10, 5 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a moment and try again.' }, { status: 429 })
  }

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }

  // Emails are always stored normalized (trim + lowercase) — do the same here.
  const candidate = (raw ?? {}) as Record<string, unknown>
  const email = typeof candidate.email === 'string' ? candidate.email.trim().toLowerCase() : undefined

  const parsed = bodySchema.safeParse({
    email,
    password: typeof candidate.password === 'string' ? candidate.password : undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  try {
    const student = await db.student.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, displayName: true, learningLevel: true, role: true, onboardedAt: true, signupIntent: true, passwordHash: true },
    })

    const ok = await verifyPassword(parsed.data.password, student?.passwordHash ?? DUMMY_HASH)
    if (!student || !ok) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const { token, expiresAt } = await createSession(student.id)
    await setSessionCookie(token, expiresAt)

    return NextResponse.json({
      student: {
        id: student.id,
        email: student.email,
        displayName: student.displayName,
        learningLevel: student.learningLevel,
        role: student.role,
        onboardedAt: student.onboardedAt ? student.onboardedAt.toISOString() : null,
        signupIntent: student.signupIntent,
      },
    })
  } catch (err) {
    console.error('[api/auth/login]', err)
    return NextResponse.json({ error: 'Could not sign you in — please try again.' }, { status: 500 })
  }
}
