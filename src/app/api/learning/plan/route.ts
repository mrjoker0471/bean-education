// Personal day plan (Phase 3B).
//   GET  ?guestId=&date=YYYY-MM-DD — get-or-generate (idempotent; generation
//        happens once per day, then the plan is stable until acted on)
//   POST { guestId, date?, regenerate: true } — regenerate. Only PLANNED rows
//        are replaced; COMPLETED / SKIPPED / DEFERRED history is never touched.

import { NextRequest, NextResponse } from 'next/server'
import { sameOrigin } from '@/lib/auth'
import { guestIdFromQuery, guestIdSchema, dateKeyStart, todayKey, rateLimited, pruneRateLimits } from '@/lib/learning/scope'
import { getOrCreateDayPlan } from '@/lib/learning/plan-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function resolveDate(req: NextRequest): string | null {
  const raw = new URL(req.url).searchParams.get('date')
  if (!raw) return todayKey()
  return dateKeyStart(raw) ? raw : null
}

export async function GET(req: NextRequest) {
  try {
    const guestId = guestIdFromQuery(req)
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })
    const date = resolveDate(req)
    if (!date) return NextResponse.json({ error: 'Invalid date — use YYYY-MM-DD' }, { status: 400 })

    const plan = await getOrCreateDayPlan(guestId, date)
    return NextResponse.json(plan)
  } catch (err) {
    console.error('[api/learning/plan GET]', err)
    return NextResponse.json({ error: 'Failed to load your plan' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    pruneRateLimits()
    const body = await req.json().catch(() => null)
    const parsed = (body ?? {}) as Record<string, unknown>
    const guestId = typeof parsed.guestId === 'string' ? guestIdSchema.safeParse(parsed.guestId).data ?? null : null
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })
    if (rateLimited(`plan-regen:${guestId}`, 6, 3600_000)) {
      return NextResponse.json({ error: 'Plan regeneration is limited to 6 times per hour — adjust tasks instead.' }, { status: 429 })
    }
    const date = typeof parsed.date === 'string' && dateKeyStart(parsed.date) ? parsed.date : todayKey()

    const plan = await getOrCreateDayPlan(guestId, date, { regenerate: true })
    return NextResponse.json(plan)
  } catch (err) {
    console.error('[api/learning/plan POST]', err)
    return NextResponse.json({ error: 'Failed to regenerate your plan' }, { status: 500 })
  }
}
