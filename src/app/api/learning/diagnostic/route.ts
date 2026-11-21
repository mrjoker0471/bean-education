// POST /api/learning/diagnostic — start (or resume) a diagnostic assessment.
// Scope: one topic (legacy `topicId` form), one unit, one subject or one whole
// exam/syllabus area (`scopeType` + `scopeId`). Reuses the authoritative test
// engine: questions are selected server-side from VERIFIED bank rows only,
// answers are never exposed before submission, and the client simply opens the
// existing test runner on the returned attemptId. Insufficient verified
// coverage is an honest 409 — coverage is never fabricated. Rate-limited
// (12 starts/hour/owner).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sameOrigin } from '@/lib/auth'
import { guestIdSchema, rateLimited, pruneRateLimits, assertLearningOwner } from '@/lib/learning/scope'
import { startDiagnostic } from '@/lib/learning/diagnostics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z
  .object({
    guestId: guestIdSchema,
    /** Legacy single-topic form (kept for existing clients). */
    topicId: z.string().min(6).max(64).optional(),
    /** Explicit scope form: one of TOPIC | UNIT | SUBJECT | EXAM. */
    scopeType: z.enum(['TOPIC', 'UNIT', 'SUBJECT', 'EXAM']).optional(),
    scopeId: z.string().min(6).max(64).optional(),
  })
  .refine(body => !(body.topicId && (body.scopeType || body.scopeId)), {
    message: 'Send either topicId (topic scope) or scopeType+scopeId — not both.',
  })

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    pruneRateLimits()

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, topicId, scopeType, scopeId } = parsed.data
    const owner = await assertLearningOwner(guestId)
    if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })
    if (rateLimited(`diagnostic:${guestId}`, 12, 3600_000)) {
      return NextResponse.json({ error: 'Diagnostic limit reached for this hour — try again later.' }, { status: 429 })
    }

    // Normalize to a scope: legacy topicId → TOPIC; scopeType requires scopeId.
    const scope = topicId
      ? { scopeType: 'TOPIC' as const, scopeId: topicId }
      : scopeType && scopeId
        ? { scopeType, scopeId }
        : null
    if (!scope) return NextResponse.json({ error: 'A diagnostic needs a topicId, or scopeType together with scopeId.' }, { status: 400 })

    const result = await startDiagnostic(guestId, scope)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ attemptId: result.attemptId, resumed: result.resumed, count: result.count })
  } catch (err) {
    console.error('[api/learning/diagnostic]', err)
    return NextResponse.json({ error: 'Could not start the diagnostic' }, { status: 500 })
  }
}
