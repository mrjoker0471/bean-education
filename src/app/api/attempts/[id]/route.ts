import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { safeParse, shuffle } from '@/lib/serialize'
import { isValidAnswerIndex } from '@/lib/answer-index'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const GRACE_MS = 120_000 // 2 minutes grace after the timer ends

function notFound() {
  return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
}

/** Load the questions behind an attempt — catalogue bank OR Riishe-generated. */
async function loadAttemptQuestions(attempt: { id: string; source: string; questionIdsJson: string }) {
  const ids = safeParse<string[]>(attempt.questionIdsJson, [])
  if (attempt.source === 'RIISHE') {
    const rows = await db.riisheQuestion.findMany({
      where: { id: { in: ids } },
      select: { id: true, text: true, optionsJson: true, topic: true, order: true },
    })
    const byId = new Map(rows.map(q => [q.id, q]))
    return ids.map(i => byId.get(i)).filter((q): q is NonNullable<typeof q> => !!q).map(q => ({
      id: q.id,
      text: q.text,
      options: safeParse<string[]>(q.optionsJson, []),
      topicName: q.topic ?? undefined,
    }))
  }
  const rows = await db.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, text: true, optionsJson: true, topic: { select: { name: true } } },
  })
  const byId = new Map(rows.map(q => [q.id, q]))
  return ids.map(i => byId.get(i)).filter((q): q is NonNullable<typeof q> => !!q).map(q => ({
    id: q.id,
    text: q.text,
    options: safeParse<string[]>(q.optionsJson, []),
    topicName: q.topic?.name,
  }))
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
    const untimed = config.durationMin <= 0
    const endsAt = untimed ? attempt.startedAt.getTime() + 365 * 24 * 3600_000 : attempt.startedAt.getTime() + config.durationMin * 60_000
    const answers = safeParse<Record<string, number>>(attempt.answersJson, {})

    // Auto-submit on timeout (server authoritative; untimed tests never time out)
    if (attempt.status === 'IN_PROGRESS' && !untimed && Date.now() > endsAt + GRACE_MS) {
      await scoreAttempt(attempt.id, answers, config.durationMin * 60, 'TIMED_OUT')
      return NextResponse.json({ redirect: 'result' })
    }

    if (attempt.status !== 'IN_PROGRESS') {
      return NextResponse.json({ redirect: 'result' })
    }

    const ordered = await loadAttemptQuestions(attempt)

    // answeredCount must count VALID answers only (per-question option range)
    const optionCounts = new Map(ordered.map(q => [q.id, q.options.length]))
    const answeredCount = Object.entries(answers)
      .filter(([qid, idx]) => isValidAnswerIndex(idx, optionCounts.get(qid) ?? 0)).length

    return NextResponse.json({
      id: attempt.id,
      title: attempt.title,
      examLabel: attempt.examLabel,
      status: attempt.status,
      source: attempt.source,
      documentId: attempt.documentId,
      riisheTestId: attempt.riisheTestId,
      config,
      serverNow: Date.now(),
      endsAt,
      answeredCount,
      savedAnswers: answers, // resume support — refresh-safe
      questions: ordered,
    })
  } catch (err) {
    console.error('[api/attempts GET]', err)
    return NextResponse.json({ error: 'Failed to load attempt' }, { status: 500 })
  }
}

// Transport-level sanity bound only. The AUTHORITATIVE validity range is each
// question's actual option count, enforced in scoreAttempt via isValidAnswerIndex.
const submitSchema = z.object({
  guestId: z.string().min(8).max(64),
  answers: z.record(z.string(), z.number().int().min(0).max(5)),
  timeSpentSec: z.number().int().min(0).max(60 * 60 * 6),
})

/** Number of options a stored question carries (0 when the row is malformed). */
function optionCountOf(optionsJson: string | null): number {
  const opts = safeParse<string[]>(optionsJson ?? '', [])
  return Array.isArray(opts) ? opts.length : 0
}

async function scoreAttempt(attemptId: string, answers: Record<string, number>, timeSpentSec: number, status: 'SUBMITTED' | 'TIMED_OUT') {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId } })
  if (!attempt) return
  const config = safeParse(attempt.configJson, { count: 0, durationMin: 0, marksPerQuestion: 1, negativeMark: 0 })
  const ids = safeParse<string[]>(attempt.questionIdsJson, [])

  // Questions come from the bank or from Riishe's validated set — same scoring
  interface ScoreRow { id: string; correctIndex: number; optionCount: number; topicId: string | null; topicName: string | null }
  let rows: ScoreRow[] = []
  if (attempt.source === 'RIISHE') {
    const rq = await db.riisheQuestion.findMany({
      where: { id: { in: ids } },
      select: { id: true, correctIndex: true, optionsJson: true, topic: true },
    })
    rows = rq.map(q => ({ id: q.id, correctIndex: q.correctIndex, optionCount: optionCountOf(q.optionsJson), topicId: q.topic ? `t:${q.topic}` : null, topicName: q.topic ?? null }))
  } else {
    const bq = await db.question.findMany({
      where: { id: { in: ids } },
      select: { id: true, correctIndex: true, optionsJson: true, topicId: true, topic: { select: { name: true } } },
    })
    rows = bq.map(q => ({ id: q.id, correctIndex: q.correctIndex, optionCount: optionCountOf(q.optionsJson), topicId: q.topicId, topicName: q.topic?.name ?? null }))
  }
  const byId = new Map(rows.map(q => [q.id, q]))

  let correct = 0, wrong = 0, skipped = 0
  const perTopic = new Map<string, { name: string; correct: number; total: number }>()

  for (const qid of ids) {
    const q = byId.get(qid)
    if (!q) continue
    const selected = answers[qid]
    // Phase 2A: the ONLY valid range is the question's actual option count.
    // An out-of-range index is a skipped question, never a wrong answer.
    const isAnswered = isValidAnswerIndex(selected, q.optionCount)
    if (!isAnswered) skipped++
    const isCorrect = isAnswered && selected === q.correctIndex
    if (isAnswered) {
      if (isCorrect) correct++
      else wrong++
    }
    if (q.topicId || q.topicName) {
      const key = q.topicId ?? `t:${q.topicName}`
      const entry = perTopic.get(key) ?? { name: q.topicName ?? 'Unknown topic', correct: 0, total: 0 }
      entry.total++
      if (isCorrect) entry.correct++
      perTopic.set(key, entry)
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
      timeSpentSec: Math.max(0, Math.min(timeSpentSec, config.durationMin > 0 ? config.durationMin * 60 + 120 : 6 * 3600)),
      perTopicJson: JSON.stringify(Object.fromEntries([...perTopic.entries()].map(([topicId, v]) => [topicId, v]))),
      submittedAt: new Date(),
    },
  })
}

const autosaveSchema = z.object({
  guestId: z.string().min(8).max(64),
  answers: z.record(z.string(), z.number().int().min(0).max(5)),
})

// PATCH — autosave answers while the test is running (refresh-safe).
// Only merges answers that belong to this attempt; never touches scoring state.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const parsed = autosaveSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid autosave' }, { status: 400 })

    const attempt = await db.attempt.findUnique({ where: { id } })
    if (!attempt || attempt.guestId !== parsed.data.guestId) return notFound()
    if (attempt.status !== 'IN_PROGRESS') {
      return NextResponse.json({ ok: false, reason: 'submitted' })
    }

    const allowedIds = new Set(safeParse<string[]>(attempt.questionIdsJson, []))
    const current = safeParse<Record<string, number>>(attempt.answersJson, {})
    const merged: Record<string, number> = { ...current }
    // Phase 2A: never persist an index outside a question's real option range —
    // invalid values would later count as answered/wrong in result rendering.
    const stored = await db.question.findMany({ where: { id: { in: [...allowedIds] } }, select: { id: true, optionsJson: true } })
    const riisheStored = attempt.source === 'RIISHE'
      ? await db.riisheQuestion.findMany({ where: { id: { in: [...allowedIds] } }, select: { id: true, optionsJson: true } })
      : []
    const counts = new Map<string, number>()
    for (const q of [...stored, ...riisheStored]) counts.set(q.id, optionCountOf(q.optionsJson))
    for (const [qid, idx] of Object.entries(parsed.data.answers)) {
      if (!allowedIds.has(qid)) continue
      if (!isValidAnswerIndex(idx, counts.get(qid) ?? 0)) continue
      merged[qid] = idx
    }
    await db.attempt.update({
      where: { id },
      data: { answersJson: JSON.stringify(merged) },
    })
    return NextResponse.json({ ok: true, savedCount: Object.keys(merged).length })
  } catch (err) {
    console.error('[api/attempts PATCH]', err)
    return NextResponse.json({ error: 'Autosave failed' }, { status: 500 })
  }
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
    const untimed = config.durationMin <= 0
    // Untimed tests never time out — a manual submit is always SUBMITTED and
    // elapsed time is honestly capped at 6 h.
    const endsAt = untimed ? Number.POSITIVE_INFINITY : attempt.startedAt.getTime() + config.durationMin * 60_000
    const timedOut = !untimed && Date.now() > endsAt + GRACE_MS
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
