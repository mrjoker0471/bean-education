import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// GET — explanation status + payloads for a submitted Riishe attempt (owner only).
// Returns per-question status so the UI can poll while batches generate.
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const attempt = await db.attempt.findUnique({ where: { id } })
    if (!attempt || attempt.guestId !== guestId) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
    }
    if (attempt.source !== 'RIISHE') {
      return NextResponse.json({ error: 'No Riishe explanations for this attempt' }, { status: 409 })
    }
    if (!['SUBMITTED', 'TIMED_OUT'].includes(attempt.status)) {
      return NextResponse.json({ error: 'Submit the test first' }, { status: 409 })
    }

    const rows = await db.riisheExplanation.findMany({ where: { attemptId: id } })
    const explanations: Record<string, { status: string; payload: unknown }> = {}
    for (const r of rows) {
      explanations[r.questionId] = {
        status: r.status,
        payload: r.payloadJson ? safeJson(r.payloadJson) : null,
      }
    }

    // How many wrong answers exist (to know when generation is complete)
    const questionIds = safeParse<string[]>(attempt.questionIdsJson, [])
    const answers = safeParse<Record<string, number>>(attempt.answersJson ?? '{}', {})
    const questions = questionIds.length
      ? await db.riisheQuestion.findMany({ where: { id: { in: questionIds } }, select: { id: true, correctIndex: true } })
      : []
    const wrongCount = questions.filter(q => {
      const sel = answers[q.id]
      return sel !== undefined && sel >= 0 && sel !== q.correctIndex
    }).length

    const readyCount = rows.filter(r => r.status === 'READY').length
    const failedCount = rows.filter(r => r.status === 'FAILED').length

    return NextResponse.json({
      attemptId: id,
      wrongCount,
      readyCount,
      failedCount,
      pending: Math.max(0, wrongCount - readyCount - failedCount),
      explanations,
    })
  } catch (err) {
    console.error('[api/riishe/attempts/[id]/explanations GET]', err)
    return NextResponse.json({ error: 'Failed to load explanations' }, { status: 500 })
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
