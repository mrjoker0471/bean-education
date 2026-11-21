// GET /api/learning/mastery — evidence-based mastery rows for the owner.
// Topics with zero answered questions have NO row (NOT_ASSESSED is the honest
// absence, never a fabricated zero). Optional ?status= filter for the UI.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guestIdFromQuery } from '@/lib/learning/scope'
import { masteryRowToDTO, sortMasteryRows } from '@/lib/learning/mastery'
import { recomputeTopicMastery } from '@/lib/learning/mastery'
import type { TopicMasteryDTO } from '@/lib/learning/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VALID_STATUS = new Set(['INSUFFICIENT_EVIDENCE', 'LEARNING', 'DEVELOPING', 'STRONG', 'NEEDS_REVISION'])

export async function GET(req: NextRequest) {
  try {
    const guestId = guestIdFromQuery(req)
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const statusFilter = new URL(req.url).searchParams.get('status')
    if (statusFilter && !VALID_STATUS.has(statusFilter)) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 })
    }

    // Read-your-latest: recompute from real attempts before answering so the
    // payload always reflects submitted evidence (idempotent, bounded).
    await recomputeTopicMastery(guestId)

    const rows = await db.topicMastery.findMany({ where: { guestId, ...(statusFilter ? { status: statusFilter } : {}) } })
    const topics: TopicMasteryDTO[] = sortMasteryRows(rows.map(masteryRowToDTO))

    return NextResponse.json({
      topics,
      legend: {
        NOT_ASSESSED: 'no answered questions yet — nothing is claimed',
        INSUFFICIENT_EVIDENCE: 'fewer than 5 distinct questions answered — no band yet',
        LEARNING: 'below 60% over enough evidence',
        DEVELOPING: '60-79% over enough evidence',
        STRONG: '80%+ over enough evidence',
        NEEDS_REVISION: 'recent result dropped below 60% after being in a band',
      },
    })
  } catch (err) {
    console.error('[api/learning/mastery]', err)
    return NextResponse.json({ error: 'Failed to load mastery' }, { status: 500 })
  }
}
