// Next-best actions (Phase 3B).
//   GET  ?guestId= — the deterministic, evidence-ranked open set (max 5),
//                    overlaid with dismiss/snooze/complete lifecycle state.
//   POST { guestId, actionKey, decision, snoozeDays? } — record a decision.
//                    COMPLETED captures the current topic accuracy as the
//                    outcome snapshot so ranking can learn what helped.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { guestIdFromQuery, guestIdSchema, rateLimited, pruneRateLimits, resolveLearnerTimezone, assertLearningOwner } from '@/lib/learning/scope'
import { buildVisibleActions, applyActionDecision } from '@/lib/learning/actions-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: guestIdSchema,
  actionKey: z.string().min(3).max(120),
  decision: z.enum(['DISMISS', 'SNOOZE', 'COMPLETE']),
  snoozeDays: z.number().int().min(1).max(14).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const guestId = guestIdFromQuery(req)
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })
    const owner = await assertLearningOwner(guestId)
    if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

    const tz = resolveLearnerTimezone(new URL(req.url).searchParams.get('tz'))
    const result = await buildVisibleActions(guestId, new Date(), tz)
    return NextResponse.json({ actions: result.actions.map(a => ({
      actionKey: a.actionKey,
      type: a.type,
      title: a.title,
      reason: a.reason,
      topicId: a.topicId,
      href: a.href,
      priority: a.priority,
    })), note: result.note })
  } catch (err) {
    console.error('[api/learning/actions GET]', err)
    return NextResponse.json({ error: 'Failed to load next steps' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    pruneRateLimits()

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, actionKey, decision, snoozeDays } = parsed.data
    const owner = await assertLearningOwner(guestId)
    if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })
    if (rateLimited(`action-decision:${guestId}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many updates — slow down for a moment.' }, { status: 429 })
    }

    // Outcome snapshot for COMPLETE: the topic's CURRENT computed mastery
    // accuracy, so a later ranking pass can detect real improvement.
    let accuracySnapshot: number | null = null
    const topicMatch = actionKey.match(/^[A-Z_]+:([A-Za-z0-9_-]+)$/)
    if (decision === 'COMPLETE' && topicMatch && !actionKey.endsWith(':open')) {
      const topicId = topicMatch[1]
      const mastery = await db.topicMastery.findUnique({ where: { guestId_topicId: { guestId, topicId } } })
      if (mastery) accuracySnapshot = mastery.accuracy
    }

    const result = await applyActionDecision(guestId, actionKey, decision, { snoozeDays, accuracySnapshot })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Could not record the decision' }, { status: result.status ?? 400 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/learning/actions POST]', err)
    return NextResponse.json({ error: 'Failed to record the decision' }, { status: 500 })
  }
}
