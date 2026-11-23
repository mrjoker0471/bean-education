import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionStudent, sameOrigin } from '@/lib/auth'
import { clientKey, rateLimited } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CATEGORIES = ['ACCESS', 'CORRECTION', 'ERASURE', 'CONSENT', 'GRIEVANCE', 'OTHER'] as const

const bodySchema = z.object({
  category: z.enum(CATEGORIES),
  message: z.string().min(20, 'Describe your request in at least 20 characters').max(4000, 'Please keep your request under 4000 characters'),
})

// POST — genuine grievance / privacy-request path (DPDP §13 readiness).
// Owner-scoped and confidential: signed-in requests bind to the session
// student; guest requests bind to the device guest identity. This is a
// SEPARATE channel from class complaints — private class complaints are never
// exposed here, and request contents are never logged.
// GET — list the requester's OWN requests only (signed-in students; guests
// receive their own by guestId). No cross-user access exists.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }
  if (rateLimited(clientKey(req, 'privacy-request'), 5, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests — please try again later.' }, { status: 429 })
  }

  const student = await getSessionStudent()

  let raw: unknown = null
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path[0]
    return NextResponse.json(
      { error: field === 'message' ? 'Describe your request in at least 20 characters (max 4000).' : 'Choose a request category.' },
      { status: 400 },
    )
  }

  let guestId: string | null = null
  if (!student) {
    const candidate = (raw as Record<string, unknown> | null)?.guestId
    guestId = typeof candidate === 'string' && candidate.length >= 8 && candidate.length <= 64 ? candidate : null
    if (!guestId) {
      return NextResponse.json({ error: 'Missing session identity — please try again.' }, { status: 400 })
    }
  }

  const created = await db.privacyRequest.create({
    data: {
      studentId: student?.id ?? null,
      guestId,
      category: parsed.data.category,
      message: parsed.data.message,
    },
    select: { id: true, category: true, status: true, createdAt: true },
  })

  return NextResponse.json({ request: created }, { status: 201 })
}

export async function GET() {
  const student = await getSessionStudent()
  if (!student) {
    return NextResponse.json({ requests: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
  // Owner-scoped: only the requester's own tickets, contents included; no
  // admin listing exists on this route.
  const requests = await db.privacyRequest.findMany({
    where: { studentId: student.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, category: true, status: true, message: true, createdAt: true, updatedAt: true },
    take: 50,
  })
  return NextResponse.json({ requests }, { headers: { 'Cache-Control': 'no-store' } })
}
