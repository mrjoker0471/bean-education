import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { queueOnce, checkHourlyQuota } from '@/lib/riishe/jobs'
import { explainAttemptJob, EXPLAIN_HOURLY_LIMIT } from '@/lib/riishe/explain'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const bodySchema = z.object({ guestId: z.string().min(8).max(64) })

// POST — request Riishe explanations for a submitted attempt's wrong answers.
// The attempt is never touched by generation failures — explanations are
// separate rows and can be retried any time.
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId } = parsed.data

    const attempt = await db.attempt.findUnique({ where: { id } })
    if (!attempt || attempt.guestId !== guestId) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
    }
    if (attempt.source !== 'RIISHE') {
      return NextResponse.json({ error: 'Riishe explanations are only available for Riishe tests.' }, { status: 409 })
    }
    if (!['SUBMITTED', 'TIMED_OUT'].includes(attempt.status)) {
      return NextResponse.json({ error: 'Submit the test before requesting explanations.' }, { status: 409 })
    }

    try {
      checkHourlyQuota(guestId, 'explain', EXPLAIN_HOURLY_LIMIT)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Rate limit' }, { status: 429 })
    }

    const existing = await db.riisheExplanation.findMany({
      where: { attemptId: id, status: 'READY' },
      select: { questionId: true },
    })
    if (existing.length > 0) {
      // Resume/retry only what is missing
      void queueOnce(guestId, `explain:${id}`, () => explainAttemptJob(id, guestId))
      return NextResponse.json({ started: true, alreadyReady: existing.length })
    }

    void queueOnce(guestId, `explain:${id}`, () => explainAttemptJob(id, guestId))
    return NextResponse.json({ started: true, alreadyReady: 0 })
  } catch (err) {
    console.error('[api/riishe/attempts/[id]/explain]', err)
    return NextResponse.json({ error: 'Could not start explanation generation' }, { status: 500 })
  }
}
