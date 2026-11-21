// PATCH /api/learning/plan/[id] — task lifecycle. PLANNED tasks can be
// completed, skipped, deferred, rescheduled or resized. COMPLETED / SKIPPED /
// DEFERRED rows are history and reject every mutation (spec §6: never rewrite
// completed activities silently — or at all).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sameOrigin } from '@/lib/auth'
import { guestIdSchema, rateLimited, pruneRateLimits } from '@/lib/learning/scope'
import { applyTaskAction } from '@/lib/learning/plan-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: guestIdSchema,
  action: z.enum(['COMPLETE', 'SKIP', 'DEFER', 'RESCHEDULE', 'RESIZE']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minutes: z.number().int().min(5).max(180).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    pruneRateLimits()

    const { id } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if (rateLimited(`plan-task:${parsed.data.guestId}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Too many plan updates — slow down for a moment.' }, { status: 429 })
    }

    const result = await applyTaskAction(parsed.data.guestId, id, parsed.data.action, {
      date: parsed.data.date,
      minutes: parsed.data.minutes,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Could not update the task' }, { status: result.status ?? 400 })
    }
    return NextResponse.json({ task: result.task })
  } catch (err) {
    console.error('[api/learning/plan/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update the plan task' }, { status: 500 })
  }
}
