// POST /api/learning/diagnostic — start (or resume) a diagnostic assessment
// for one topic. Reuses the authoritative test engine: questions are selected
// server-side from VERIFIED bank rows only, answers are never exposed before
// submission, and the client simply opens the existing test runner on the
// returned attemptId. Rate-limited (12 starts/hour/owner).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sameOrigin } from '@/lib/auth'
import { guestIdSchema, rateLimited, pruneRateLimits } from '@/lib/learning/scope'
import { startDiagnostic } from '@/lib/learning/diagnostics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: guestIdSchema,
  topicId: z.string().min(6).max(64),
})

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    pruneRateLimits()

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, topicId } = parsed.data
    if (rateLimited(`diagnostic:${guestId}`, 12, 3600_000)) {
      return NextResponse.json({ error: 'Diagnostic limit reached for this hour — try again later.' }, { status: 429 })
    }

    const result = await startDiagnostic(guestId, topicId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ attemptId: result.attemptId, resumed: result.resumed, count: result.count })
  } catch (err) {
    console.error('[api/learning/diagnostic]', err)
    return NextResponse.json({ error: 'Could not start the diagnostic' }, { status: 500 })
  }
}
