import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET — weak-topic analysis from THIS guest's actual Riishe attempt results.
// A topic is only flagged weak with enough evidence (≥3 attempted, <60% accuracy);
// one bad question never labels a topic weak.
export async function GET(req: NextRequest) {
  try {
    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const attempts = await db.attempt.findMany({
      where: { guestId, source: 'RIISHE', status: { in: ['SUBMITTED', 'TIMED_OUT'] } },
      select: { questionIdsJson: true, answersJson: true, riisheTestId: true, documentId: true, submittedAt: true },
      orderBy: { submittedAt: 'desc' },
      take: 40,
    })

    interface Agg { attempted: number; correct: number; documents: Map<string, string>; lastWrong: number }
    const byTopic = new Map<string, Agg>()

    for (const attempt of attempts) {
      const ids = safeParse<string[]>(attempt.questionIdsJson, [])
      const answers = safeParse<Record<string, number>>(attempt.answersJson ?? '{}', {})
      if (ids.length === 0) continue
      const questions = await db.riisheQuestion.findMany({
        where: { id: { in: ids } },
        select: { id: true, correctIndex: true, topic: true, documentId: true },
      })
      const docTitles = new Map<string, string>()
      const docIds = [...new Set(questions.map(q => q.documentId))]
      if (docIds.length > 0) {
        const docs = await db.studyDocument.findMany({ where: { id: { in: docIds } }, select: { id: true, title: true } })
        for (const d of docs) docTitles.set(d.id, d.title)
      }
      for (const q of questions) {
        const topic = (q.topic ?? 'General').trim() || 'General'
        const agg = byTopic.get(topic) ?? { attempted: 0, correct: 0, documents: new Map(), lastWrong: 0 }
        const sel = answers[q.id]
        const wasAnswered = sel !== undefined && sel >= 0
        if (!wasAnswered) continue // unanswered ≠ a topic signal
        agg.attempted++
        if (sel === q.correctIndex) agg.correct++
        else {
          agg.lastWrong = attempt.submittedAt?.getTime() ?? Date.now()
          if (docTitles.has(q.documentId)) agg.documents.set(q.documentId, docTitles.get(q.documentId)!)
        }
        byTopic.set(topic, agg)
      }
    }

    const weakTopics = [...byTopic.entries()]
      .filter(([, a]) => a.attempted >= 3 && a.correct / a.attempted < 0.6)
      .map(([topic, a]) => ({
        topic,
        attempted: a.attempted,
        correct: a.correct,
        accuracy: Math.round((a.correct / a.attempted) * 100),
        documentId: [...a.documents.keys()][0] ?? null,
        documentTitle: [...a.documents.values()][0] ?? null,
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 12)

    return NextResponse.json({ weakTopics })
  } catch (err) {
    console.error('[api/riishe/weak-topics]', err)
    return NextResponse.json({ error: 'Failed to analyse weak topics' }, { status: 500 })
  }
}
