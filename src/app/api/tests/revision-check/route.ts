import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { RevisionCheckDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Counts questions this guest answered WRONGLY in submitted attempts for this exam.
// Powers the honest "Revision test — from my mistakes" card (ready when count >= 4).
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const examId = url.searchParams.get('examId')
    const guestId = url.searchParams.get('guestId')
    if (!examId || !guestId) {
      return NextResponse.json({ error: 'examId and guestId required' }, { status: 400 })
    }

    // Only this guest's own attempts — no cross-account access
    const attempts = await db.attempt.findMany({
      where: { guestId, examId, status: { in: ['SUBMITTED', 'TIMED_OUT'] } },
      select: { questionIdsJson: true, answersJson: true },
    })

    // Every question-id this guest answered (with the selected option) across those attempts
    const answered = new Map<string, number>()
    for (const attempt of attempts) {
      const ids = safeParse<string[]>(attempt.questionIdsJson, [])
      const answers = safeParse<Record<string, number>>(attempt.answersJson, {})
      for (const qid of ids) {
        const selected = answers[qid]
        if (selected === undefined || selected < 0) continue // unanswered ≠ wrong
        answered.set(qid, selected)
      }
    }

    let count = 0
    if (answered.size > 0) {
      const rows = await db.question.findMany({
        where: { id: { in: [...answered.keys()] }, examId },
        select: { id: true, correctIndex: true },
      })
      for (const row of rows) {
        if (answered.get(row.id) !== row.correctIndex) count++
      }
    }

    const dto: RevisionCheckDTO = { count, ready: count >= 4 }
    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/tests/revision-check]', err)
    return NextResponse.json({ error: 'Failed to check revision availability' }, { status: 500 })
  }
}
