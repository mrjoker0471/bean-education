import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse, shuffle } from '@/lib/serialize'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const GRACE_MS = 120_000 // 2 minutes grace after the timer ends

function notFound() {
  return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
}

// GET — current attempt state for the runner (questions without answers)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const guestId = new URL(req.url).searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const attempt = await db.attempt.findUnique({ where: { id } })
    if (!attempt || attempt.guestId !== guestId) return notFound()

    const config = safeParse(attempt.configJson, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0 })
    const endsAt = attempt.startedAt.getTime() + config.durationMin * 60_000
    const answers = safeParse<Record<string, number>>(attempt.answersJson, {})

    // Auto-submit on timeout (server authoritative)
    if (attempt.status === 'IN_PROGRESS' && Date.now() > endsAt + GRACE_MS) {
      await scoreAttempt(attempt.id, answers, config.durationMin * 60, 'TIMED_OUT')
      return NextResponse.json({ redirect: 'result' })
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return NextResponse.json({ redirect: 'result' })
    }

    const ids = safeParse<string[]>(attempt.questionIdsJson, [])
    const questions = await db.question.findMany({
      where: { id: { in: ids } },
      select: { id: true, text: true, optionsJson: true, topic: { select: { name: true } } },
    })
    const byId = new Map(questions.map(q => [q.id, q]))
    const ordered = ids.map(i => byId.get(i)).filter(Boolean)

    return NextResponse.json({
      id: attempt.id,
      title: attempt.title,
      examLabel: attempt.examLabel,
      status: attempt.status,
      config,
      serverNow: Date.now(),
      endsAt,
      answeredCount: Object.keys(answers).length,
      questions: ordered.map(q => ({
        id: q!.id,
        text: q!.text,
        options: safeParse<string[]>(q!.optionsJson, []),
        topicName: q!.topic?.name,
      })),
    })
  } catch (err) {
    console.error('[api/attempts GET]', err)
    return NextResponse.json({ error: 'Failed to load attempt' }, { status: 500 })
  }
}

const submitSchema = z.object({
  guestId: z.string().min(8).max(64),
  answers: z.record(z.string(), z.number().int().min(0).max(5)),
  timeSpentSec: z.number().int().min(0).max(60 * 60 * 6),
})

async function scoreAttempt(attemptId: string, answers: Record<string, number>, timeSpentSec: number, status: 'SUBMITTED' | 'TIMED_OUT') {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId } })
  if (!attempt) return
  const config = safeParse(attempt.configJson, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0 })
  const ids = safeParse<string[]>(attempt.questionIdsJson, [])

  const questions = await db.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, correctIndex: true, topicId: true, topic: { select: { name: true } } },
  })
  const byId = new Map(questions.map(q => [q.id, q]))

  let correct = 0, wrong = 0, skipped = 0
  const perTopic = new Map<string, { name: string; correct: number; total: number }>()

  for (const qid of ids) {
    const q = byId.get(qid)
    if (!q) continue
    const selected = answers[qid]
    const isAnswered = selected !== undefined && selected >= 0 && selected <= 3
    if (!isAnswered) skipped++
    const isCorrect = isAnswered && selected === q.correctIndex
    if (isAnswered) {
      if (isCorrect) correct++
      else wrong++
    }
    if (q.topicId) {
      const entry = perTopic.get(q.topicId) ?? { name: q.topic?.name ?? 'Unknown topic', correct: 0, total: 0 }
      entry.total++
      if (isCorrect) entry.correct++
      perTopic.set(q.topicId, entry)
    }
  }

  const score = correct * config.marksPerQuestion - wrong * config.negativeMark
  const maxScore = ids.length * config.marksPerQuestion

  await db.attempt.update({
    where: { id: attemptId },
    data: {
      answersJson: JSON.stringify(answers),
      status,
      score,
      maxScore,
      correctCount: correct,
      wrongCount: wrong,
      skippedCount: skipped,
      timeSpentSec: Math.max(0, Math.min(timeSpentSec, config.durationMin * 60 + 120)),
      perTopicJson: JSON.stringify(Object.fromEntries([...perTopic.entries()].map(([topicId, v]) => [topicId, v]))),
      submittedAt: new Date(),
    },
  })
}

// POST — submit answers; server-side scoring only
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const parsed = submitSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })

    const attempt = await db.attempt.findUnique({ where: { id } })
    if (!attempt || attempt.guestId !== parsed.data.guestId) return notFound()

    if (attempt.status !== 'IN_PROGRESS') {
      // Idempotent duplicate submission — return the existing result
      return NextResponse.json({ resultUrl: `#/result/${attempt.id}`, duplicate: true })
    }

    const config = safeParse(attempt.configJson, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0 })
    const endsAt = attempt.startedAt.getTime() + config.durationMin * 60_000
    const timedOut = Date.now() > endsAt + GRACE_MS
    const allowedIds = new Set(safeParse<string[]>(attempt.questionIdsJson, []))
    // Ignore any answer targeting a question outside this attempt (client cannot inject)
    const answers: Record<string, number> = {}
    for (const [qid, idx] of Object.entries(parsed.data.answers)) {
      if (allowedIds.has(qid)) answers[qid] = idx
    }

    await scoreAttempt(attempt.id, answers, parsed.data.timeSpentSec, timedOut ? 'TIMED_OUT' : 'SUBMITTED')
    return NextResponse.json({ resultUrl: `#/result/${attempt.id}` })
  } catch (err) {
    console.error('[api/attempts POST]', err)
    return NextResponse.json({ error: 'Failed to submit attempt' }, { status: 500 })
  }
}

export const revalidate = 0
export const runtime = 'nodejs'
void shuffle
