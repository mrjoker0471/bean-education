// GET /api/learning/revision — spaced-revision schedule state. `due` contains
// overdue + due-today items (what the planner acts on), `upcoming` the rest.
// The note states plainly that the ladder is a documented heuristic, not a
// scientific memory model.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guestIdFromQuery, resolveLearnerTimezone, assertLearningOwner } from '@/lib/learning/scope'
import { dueStateOf } from '@/lib/learning/revision'
import type { RevisionItemDTO, RevisionResponseDTO } from '@/lib/learning/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NOTE =
  'Revision timing follows a fixed, documented interval ladder (1 → 3 → 7 → 14 → 30 → 60 days) moved by your own results — a practical pattern, not a scientific prediction of memory.'

export async function GET(req: NextRequest) {
  try {
    const guestId = guestIdFromQuery(req)
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })
    const owner = await assertLearningOwner(guestId)
    if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

    const tz = resolveLearnerTimezone(new URL(req.url).searchParams.get('tz'))
    const now = new Date()
    const items = await db.revisionScheduleItem.findMany({
      where: { guestId },
      orderBy: { nextDueAt: 'asc' },
      take: 100,
    })

    const mapped: RevisionItemDTO[] = items.map(item => {
      const { dueState, daysUntilDue } = dueStateOf(item, now, tz)
      return {
        topicId: item.topicId,
        topicName: item.topicName,
        examLabel: item.examLabel,
        intervalDays: item.intervalDays,
        repetitions: item.repetitions,
        lapses: item.lapses,
        lastOutcome: (item.lastOutcome as RevisionItemDTO['lastOutcome']) ?? null,
        lastReviewedAt: item.lastReviewedAt ? item.lastReviewedAt.toISOString() : null,
        nextDueAt: item.nextDueAt.toISOString(),
        dueState,
        daysUntilDue,
        misconceptionFlag: item.misconceptionFlag,
      }
    })

    const dto: RevisionResponseDTO = {
      due: mapped.filter(i => i.dueState !== 'UPCOMING'),
      upcoming: mapped.filter(i => i.dueState === 'UPCOMING').slice(0, 10),
      note: NOTE,
    }
    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/learning/revision]', err)
    return NextResponse.json({ error: 'Failed to load your revision schedule' }, { status: 500 })
  }
}
