// GET /api/learning/mistakes — the mistake ledger built from real wrong
// answers. Each row shows the original question snapshot, what was chosen,
// the correct answer, the explanation, the evidence-only system category and
// any self-reported tag. timesWrong counts DISTINCT attempts with a miss.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guestIdFromQuery } from '@/lib/learning/scope'
import { mistakeRowToDTO } from '@/lib/learning/mistakes'
import type { MistakesResponseDTO } from '@/lib/learning/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NOTE =
  'System categories only appear when real evidence supports them — CONCEPT needs a grounded Riishe explanation, REPEAT_GAP needs a genuine prior miss. Everything else stays UNCLASSIFIED, and your own tags are always shown as self-reported.'

export async function GET(req: NextRequest) {
  try {
    const guestId = guestIdFromQuery(req)
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const url = new URL(req.url)
    const topicId = url.searchParams.get('topicId')
    const limitRaw = Number(url.searchParams.get('limit') ?? '50')
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.round(limitRaw))) : 50

    const rows = await db.mistakeRecord.findMany({
      where: { guestId, ...(topicId ? { topicId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // timesWrong: distinct attempts with a miss per question (one batched groupBy).
    const questionIds = [...new Set(rows.map(r => r.questionId))]
    const grouped = questionIds.length > 0
      ? await db.mistakeRecord.groupBy({
          by: ['questionId'],
          where: { guestId, questionId: { in: questionIds } },
          _count: { _all: true },
        })
      : []
    const timesByQuestion = new Map(grouped.map(g => [g.questionId, g._count._all]))

    const mistakes = rows.map(row => mistakeRowToDTO(row, timesByQuestion.get(row.questionId) ?? 1))

    const dto: MistakesResponseDTO = {
      mistakes,
      repeatGapCount: rows.filter(r => r.category === 'REPEAT_GAP').length,
      unclassifiedCount: rows.filter(r => r.category === 'UNCLASSIFIED').length,
      note: NOTE,
    }
    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/learning/mistakes]', err)
    return NextResponse.json({ error: 'Failed to load your mistakes' }, { status: 500 })
  }
}
