import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { AttemptResultDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const attempt = await db.attempt.findUnique({ where: { id }, include: { exam: { select: { slug: true } } } })
    if (!attempt || attempt.guestId !== guestId) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
    }
    if (attempt.status === 'IN_PROGRESS') {
      return NextResponse.json({ error: 'Attempt still in progress', redirect: `#/test/${attempt.id}` }, { status: 409 })
    }

    const config = safeParse(attempt.configJson, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0 })
    const ids = safeParse<string[]>(attempt.questionIdsJson, [])
    const answers = safeParse<Record<string, number>>(attempt.answersJson, {})
    const perTopicMap = safeParse<Record<string, { name: string; correct: number; total: number }>>(attempt.perTopicJson, {})

    // Bank questions or Riishe's validated set — the result shape is shared,
    // Riishe questions additionally carry category/topic/page refs/evidence.
    interface Row {
      id: string; text: string; optionsJson: string; correctIndex: number; explanation: string
      topicId: string | null; topicName: string | null
      sourceType: string; sourcePaper: string | null; year: number | null
      category?: string; pageRefs?: number[]; evidence?: string | null; difficulty?: string
    }
    let rows: Row[] = []
    if (attempt.source === 'RIISHE') {
      const rq = await db.riisheQuestion.findMany({ where: { id: { in: ids } } })
      rows = rq.map(q => ({
        id: q.id,
        text: q.text,
        optionsJson: q.optionsJson,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        topicId: q.topic ? `t:${q.topic}` : null,
        topicName: q.topic,
        sourceType: 'ORIGINAL',
        sourcePaper: null,
        year: null,
        category: q.category,
        pageRefs: safeParse<number[]>(q.pageRefsJson ?? '[]', []),
        evidence: q.evidence,
        difficulty: q.difficulty,
      }))
    } else {
      const bq = await db.question.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, text: true, optionsJson: true, correctIndex: true, explanation: true,
          topicId: true,
          sourceType: true, sourcePaper: true, year: true,
          topic: { select: { name: true } },
        },
      })
      rows = bq.map(q => ({
        id: q.id,
        text: q.text,
        optionsJson: q.optionsJson,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        topicId: q.topicId,
        topicName: q.topic?.name ?? null,
        sourceType: q.sourceType,
        sourcePaper: q.sourcePaper,
        year: q.year,
      }))
    }
    const byId = new Map(rows.map(q => [q.id, q]))

    const dto: AttemptResultDTO = {
      id: attempt.id,
      title: attempt.title,
      examLabel: attempt.examLabel,
      examSlug: attempt.exam?.slug ?? null,
      source: attempt.source as AttemptResultDTO['source'],
      documentId: attempt.documentId,
      riisheTestId: attempt.riisheTestId,
      status: attempt.status as AttemptResultDTO['status'],
      config,
      score: attempt.score ?? 0,
      maxScore: attempt.maxScore ?? 0,
      correctCount: attempt.correctCount ?? 0,
      wrongCount: attempt.wrongCount ?? 0,
      skippedCount: attempt.skippedCount ?? 0,
      timeSpentSec: attempt.timeSpentSec ?? 0,
      perTopic: Object.entries(perTopicMap).map(([topicId, v]) => ({ topicId, ...v })),
      questions: ids.map(qid => {
        const q = byId.get(qid)
        const selected = answers[qid]
        const isAnswered = selected !== undefined && selected >= 0
        return {
          id: qid,
          text: q?.text ?? '',
          options: safeParse<string[]>(q?.optionsJson, []),
          topicName: q?.topicName ?? undefined,
          topicId: q?.topicId ?? null,
          selectedIndex: isAnswered ? selected : null,
          correctIndex: q?.correctIndex ?? 0,
          explanation: q?.explanation ?? '',
          isCorrect: isAnswered && selected === q?.correctIndex,
          sourceType: (q?.sourceType ?? 'ORIGINAL') as AttemptResultDTO['questions'][number]['sourceType'],
          sourcePaper: q?.sourcePaper ?? null,
          year: q?.year ?? null,
          category: q?.category as AttemptResultDTO['questions'][number]['category'],
          pageRefs: q?.pageRefs,
          evidence: q?.evidence ?? null,
        }
      }),
    }

    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/attempts/[id]/result]', err)
    return NextResponse.json({ error: 'Failed to load result' }, { status: 500 })
  }
}
