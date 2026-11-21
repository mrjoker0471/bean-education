// ─── Research follow-up route (Phase 3A) ─────────────────────────────────────
// Thin wrapper over answerResearchFollowUp (the core lives in the lib with an
// injectable chat seam so tests never mock the AI module).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { answerResearchFollowUp } from '@/lib/riishe/research-followup'
import type { RiisheChatSourceDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RATE = { windowMs: 10 * 60_000, max: 15 }
const rateMap = new Map<string, number[]>()
function rateLimited(guestId: string): boolean {
  const now = Date.now()
  const arr = (rateMap.get(guestId) ?? []).filter(t => now - t < RATE.windowMs)
  if (arr.length >= RATE.max) return true
  arr.push(now)
  rateMap.set(guestId, arr)
  return false
}

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  content: z.string().min(1).max(3000),
})
const querySchema = z.object({ guestId: z.string().min(8).max(64) })

function parseJson<T>(raw: string | null, fallback: T): T {
  try {
    return JSON.parse(raw ?? '') as T
  } catch {
    return fallback
  }
}

// GET — persisted follow-up thread (owner only, newest last)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!q.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId } = q.data

    const session = await db.researchSession.findFirst({ where: { id, guestId }, select: { id: true } })
    if (!session) return NextResponse.json({ error: 'Research session not found' }, { status: 404 })

    const turns = await db.riisheChatTurn.findMany({
      where: { researchSessionId: id, guestId },
      orderBy: { createdAt: 'asc' },
      take: 30,
    })
    return NextResponse.json({
      turns: turns.map(t => ({
        id: t.id,
        role: t.role,
        content: t.content,
        grounding: t.grounding,
        sources: parseJson<RiisheChatSourceDTO[]>(t.sourcesJson, []),
        createdAt: t.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[api/riishe/research/[id]/followup GET]', err)
    return NextResponse.json({ error: 'Could not load the follow-up thread.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, content } = parsed.data

    if (rateLimited(guestId)) {
      return NextResponse.json(
        { error: 'You are sending follow-up questions very quickly — please wait a few minutes.' },
        { status: 429 },
      )
    }

    const result = await answerResearchFollowUp(id, guestId, content)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({
      reply: result.reply,
      turnId: result.turnId,
      grounding: result.grounding,
      sources: result.sources,
    })
  } catch (err) {
    console.error('[api/riishe/research/[id]/followup POST]', err)
    return NextResponse.json({ error: 'Could not process the follow-up question.' }, { status: 500 })
  }
}
