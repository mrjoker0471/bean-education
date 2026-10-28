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
      select: { id: true, order: true, text: true, difficulty: true, category: true, topic: true, status: true, pageRefsJson: true, documentId: true },
    })

    // Every source document behind this set (multi-document practice) —
    // primary first, then the additional ones in the recorded order.
    const sourceDocIds = [test.documentId, ...jsonIdArr(test.sourceDocIdsJson).filter(x => x !== test.documentId)]
    const sourceDocs = await db.studyDocument.findMany({
      where: { id: { in: sourceDocIds } },
      select: { id: true, title: true, pageCount: true },
    })
    const sourceDocuments = sourceDocIds
      .map(docId => {
        const d = sourceDocs.find(x => x.id === docId)
        return d ? { id: d.id, title: d.title, pageCount: d.pageCount } : null
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)

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
      sourceDocuments,
      stats: safeStats(test.statsJson),
      questionCount: test.questionIdsJson ? safeArr(test.questionIdsJson).length : questions.filter(q => q.status === 'VALIDATED').length,
      questions: questions.map(q => ({
        id: q.id,
        order: q.order,
        text: q.text,
        difficulty: q.difficulty,
        category: q.category,
        topic: q.topic,
        status: q.status,
        pageRefs: safePageRefs(q.pageRefsJson),
        documentId: q.documentId,
      })), // no answers/explanations before an attempt exists — this is a summary, not the runner feed
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
function jsonIdArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}
function safePageRefs(json: string | null): number[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((n: unknown) => typeof n === 'number' && Number.isFinite(n)) : []
  } catch { return [] }
}
