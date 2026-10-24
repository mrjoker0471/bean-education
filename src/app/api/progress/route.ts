import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { ProgressDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const attempts = await db.attempt.findMany({
      where: { guestId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    })

    const submitted = attempts.filter(a => a.status === 'SUBMITTED' || a.status === 'TIMED_OUT')

    // Aggregate weak topics from real per-topic scoring
    const topicAgg = new Map<string, { name: string; correct: number; total: number; examId: string | null; examName: string; examSlug: string | null }>()
    for (const a of submitted) {
      const perTopic = safeParse<Record<string, { name: string; correct: number; total: number }>>(a.perTopicJson, {})
      for (const [topicId, v] of Object.entries(perTopic)) {
        const entry = topicAgg.get(topicId) ?? {
          name: v.name, correct: 0, total: 0,
          examId: a.examId, examName: a.examLabel, examSlug: null,
        }
        entry.correct += v.correct
        entry.total += v.total
        topicAgg.set(topicId, entry)
      }
    }
    for (const a of submitted) {
      if (!a.examId) continue
      const exam = await db.exam.findUnique({ where: { id: a.examId }, select: { slug: true } })
      if (exam) {
        for (const entry of topicAgg.values()) {
          if (entry.examId === a.examId) entry.examSlug = exam.slug
        }
      }
    }

    const weakTopics = [...topicAgg.entries()]
      .map(([topicId, v]) => ({
        topicId,
        name: v.name,
        examSlug: v.examSlug,
        examName: v.examName,
        attempts: 1,
        total: v.total,
        accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      }))
      .filter(t => t.total >= 2 && t.accuracy < 60)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 10)

    const questionsAnswered = submitted.reduce((sum, a) => sum + (a.correctCount ?? 0) + (a.wrongCount ?? 0), 0)
    const correctTotal = submitted.reduce((sum, a) => sum + (a.correctCount ?? 0), 0)
    const timeSpentMin = Math.round(submitted.reduce((sum, a) => sum + (a.timeSpentSec ?? 0), 0) / 60)

    const dto: ProgressDTO = {
      totals: {
        attempts: submitted.length,
        questionsAnswered,
        accuracy: questionsAnswered > 0 ? Math.round((correctTotal / questionsAnswered) * 100) : 0,
        timeSpentMin,
      },
      weakTopics,
      attempts: attempts.slice(0, 50).map(a => ({
        id: a.id,
        title: a.title,
        examLabel: a.examLabel,
        status: a.status,
        score: a.score,
        maxScore: a.maxScore,
        correctCount: a.correctCount,
        total: safeParse<string[]>(a.questionIdsJson, []).length,
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt?.toISOString() ?? null,
      })),
    }

    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/progress]', err)
    return NextResponse.json({ error: 'Failed to load progress' }, { status: 500 })
  }
}
