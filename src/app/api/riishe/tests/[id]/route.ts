import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recoverStaleTests } from '@/lib/riishe/jobs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// GET — poll a Riishe test's generation status (owner only)
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    await recoverStaleTests([id])

    const test = await db.riisheTest.findUnique({ where: { id }, include: { document: true } })
    if (!test || test.guestId !== guestId) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }

    const questions = await db.riisheQuestion.findMany({
      where: { testId: id },
      orderBy: { order: 'asc' },
      select: { id: true, order: true, text: true, difficulty: true, category: true, topic: true, status: true, pageRefsJson: true },
    })

    return NextResponse.json({
      id: test.id,
      documentId: test.documentId,
      documentTitle: test.document.title,
      title: test.title,
      status: test.status,
      statusDetail: test.statusDetail,
      focusTopics: safeArr(test.focusTopicsJson),
      weakFocus: test.weakFocus,
      requestedCount: test.requestedCount,
      config: safeCfg(test.configJson),
      stats: safeStats(test.statsJson),
      questionCount: test.questionIdsJson ? safeArr(test.questionIdsJson).length : questions.filter(q => q.status === 'VALIDATED').length,
      questions, // no answers/explanations before an attempt exists — this is a summary, not the runner feed
      createdAt: test.createdAt.toISOString(),
      updatedAt: test.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/riishe/tests/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to load test' }, { status: 500 })
  }
}

function safeArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : [] } catch { return [] }
}
function safeCfg(json: string) {
  try { return JSON.parse(json) } catch { return { timed: true, durationMin: 50, marksPerQuestion: 1, negativeMark: 0 } }
}
function safeStats(json: string | null) {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}
