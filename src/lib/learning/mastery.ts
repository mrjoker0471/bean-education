// ─── Deterministic topic mastery (Phase 3B) ──────────────────────────────────
// Mastery is computed ONLY from real submitted attempts. No LLM ever sets a
// score; no client input can write these rows; reading documents or notes
// never counts as evidence — only answered questions do.
//
// Evidence window: ALL submitted attempts of the owner, processed in
// deterministic oldest→newest order via cursor pagination (bounded memory —
// never a take-limited slice and never an undocumented rolling window; see
// recomputeTopicMastery).
//
// Documented status mapping (docs/PHASE3B_PERSONAL_LEARNING_INTELLIGENCE.md):
//   • NOT_ASSESSED          — zero evidence (no row is persisted for this case)
//   • INSUFFICIENT_EVIDENCE — fewer than MIN_EVIDENCE_QUESTIONS distinct
//                             answered questions (small samples never earn a band)
//   • LEARNING / DEVELOPING / STRONG — accuracy bands over DISTINCT questions
//                             (latest answer per question wins, so repeating
//                             the same question can never inflate accuracy)
//   • NEEDS_REVISION        — the topic was DEVELOPING/STRONG and the most
//                             recent attempt covering it scored below the
//                             DEVELOPING threshold (a real regression signal)
//
// Anti-gaming rules (all deterministic):
//   • evidence = DISTINCT questions; a question answered five times counts once
//   • the LATEST outcome per question wins — re-answering correctly replaces
//     an earlier miss, re-answering wrongly replaces an earlier hit
//   • unanswered / out-of-range selections are skipped (no outcome), matching
//     the authoritative scoring engine
//   • "single question correct ≠ mastered": MIN_EVIDENCE_QUESTIONS guard

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { isValidAnswerIndex } from '@/lib/answer-index'
import type { MasteryStatus, TopicMasteryDTO } from './dto'

export const MIN_EVIDENCE_QUESTIONS = 5
export const STRONG_THRESHOLD = 80
export const DEVELOPING_THRESHOLD = 60

/** Resolved per-question facts the evidence builder needs (bank topics only). */
export interface ScoredQuestionMeta {
  id: string
  topicId: string | null
  correctIndex: number
  optionCount: number
}

export interface AttemptForEvidence {
  id: string
  startedAt: Date
  submittedAt: Date | null
  questionIds: string[]
  answers: Record<string, number>
  questions: ScoredQuestionMeta[]
}

export interface TopicEvidence {
  topicId: string
  attemptCount: number
  /** qid → latest outcome (true = latest answer was correct). */
  outcomes: Map<string, boolean>
  /** Accuracy (0-100) of the MOST RECENT attempt covering this topic. */
  latestAttemptAccuracy: number | null
  lastAttemptAt: Date | null
}

export interface MasteryComputation {
  topicId: string
  status: MasteryStatus
  statusReason: string | null
  accuracy: number
  evidenceQuestions: number
  attemptCount: number
  correctDistinct: number
  lastActivityAt: Date | null
}

// ─── Pure evidence builder ─────────────────────────────────────────────────────
// `attempts` MUST be ordered oldest → newest so later attempts overwrite
// earlier outcomes per question ("latest answer wins").

/**
 * Fold one oldest→newest batch of attempts into an existing evidence map.
 * Exported so DB orchestration can feed paginated pages incrementally while
 * keeping the exact same per-question semantics as the one-shot builder.
 */
export function accumulateTopicEvidence(
  byTopic: Map<string, TopicEvidence>,
  attempts: AttemptForEvidence[],
): void {
  for (const attempt of attempts) {
    const qById = new Map(attempt.questions.map(q => [q.id, q]))
    // Per-topic accuracy of THIS attempt (answered questions only).
    const tally = new Map<string, { correct: number; total: number }>()

    for (const qid of attempt.questionIds) {
      const q = qById.get(qid)
      if (!q || !q.topicId) continue
      const selected = attempt.answers[qid]
      // Same validity rule as the scoring engine: out-of-range = skipped.
      if (!isValidAnswerIndex(selected, q.optionCount)) continue

      const entry = tally.get(q.topicId) ?? { correct: 0, total: 0 }
      entry.total++
      if (selected === q.correctIndex) entry.correct++
      tally.set(q.topicId, entry)

      let ev = byTopic.get(q.topicId)
      if (!ev) {
        ev = { topicId: q.topicId, attemptCount: 0, outcomes: new Map(), latestAttemptAccuracy: null, lastAttemptAt: null }
        byTopic.set(q.topicId, ev)
      }
      ev.outcomes.set(q.id, selected === q.correctIndex)
    }

    for (const [topicId, t] of tally) {
      const ev = byTopic.get(topicId)
      if (!ev) continue
      ev.attemptCount++
      ev.latestAttemptAccuracy = t.total > 0 ? Math.round((t.correct / t.total) * 100) : null
      ev.lastAttemptAt = attempt.submittedAt ?? attempt.startedAt
    }
  }
}

export function buildTopicEvidence(attempts: AttemptForEvidence[]): Map<string, TopicEvidence> {
  const byTopic = new Map<string, TopicEvidence>()
  accumulateTopicEvidence(byTopic, attempts)
  return byTopic
}

// ─── Pure status mapping ───────────────────────────────────────────────────────

export function accuracyOf(evidence: TopicEvidence): { accuracy: number; correctDistinct: number; distinct: number } {
  const distinct = evidence.outcomes.size
  let correctDistinct = 0
  for (const correct of evidence.outcomes.values()) if (correct) correctDistinct++
  const accuracy = distinct > 0 ? Math.round((correctDistinct / distinct) * 100) : 0
  return { accuracy, correctDistinct, distinct }
}

export function mapMasteryStatus(
  evidence: TopicEvidence,
  previousStatus: string | null,
): { status: MasteryStatus; statusReason: string } {
  const { accuracy, correctDistinct, distinct } = accuracyOf(evidence)

  if (distinct < MIN_EVIDENCE_QUESTIONS) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      statusReason: `Only ${distinct} distinct question${distinct === 1 ? '' : 's'} answered so far — ${accuracy}% correct. A diagnostic or more practice will establish a reliable baseline.`,
    }
  }

  // Regression signal: a topic that used to sit in a real band and whose most
  // recent attempt fell below the DEVELOPING line needs attention now — even
  // when lifetime distinct-question accuracy still looks healthy.
  const wasBanded = previousStatus === 'STRONG' || previousStatus === 'DEVELOPING' || previousStatus === 'NEEDS_REVISION'
  if (wasBanded && evidence.latestAttemptAccuracy !== null && evidence.latestAttemptAccuracy < DEVELOPING_THRESHOLD) {
    return {
      status: 'NEEDS_REVISION',
      statusReason: `Your latest attempt scored ${evidence.latestAttemptAccuracy}% here (lifetime evidence: ${correctDistinct}/${distinct} distinct questions correct, ${accuracy}%). Time to revisit before continuing.`,
    }
  }

  if (accuracy >= STRONG_THRESHOLD) {
    return {
      status: 'STRONG',
      statusReason: `${accuracy}% over ${distinct} distinct questions (latest ${correctDistinct}/${distinct}). Keep it warm with spaced revision.`,
    }
  }
  if (accuracy >= DEVELOPING_THRESHOLD) {
    return {
      status: 'DEVELOPING',
      statusReason: `${accuracy}% over ${distinct} distinct questions — solid progress, ${STRONG_THRESHOLD - accuracy} points from strong.`,
    }
  }
  return {
    status: 'LEARNING',
    statusReason: `${accuracy}% over ${distinct} distinct questions — targeted practice will move this fastest.`,
  }
}

// ─── DB orchestration ──────────────────────────────────────────────────────────

/**
 * Evidence pagination: attempts are processed in fixed-size pages of
 * EVIDENCE_PAGE_SIZE, oldest → newest, until the owner's history is exhausted.
 *
 * • The cursor is the attempt's UNIQUE id while the ordering is the composite
 *   (startedAt, id) — a total, deterministic order. A non-unique startedAt
 *   cursor alone could silently skip every row sharing the boundary
 *   timestamp; the composite seek cannot.
 * • Memory stays bounded: only one page of attempt rows (plus that page's
 *   question metadata) is loaded at a time; the growing evidence map is the
 *   RESULT, not the raw history.
 * • There is no rolling window: every submitted attempt of the owner is
 *   folded into the evidence, so a topic that first appears after any number
 *   of earlier attempts still receives its row, and a re-answer beyond the
 *   first page still replaces the older outcome of the same question.
 */
export const EVIDENCE_PAGE_SIZE = 200
const QUESTION_CHUNK = 500

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

interface SubmittedAttemptRow {
  id: string
  startedAt: Date
  submittedAt: Date | null
  questionIdsJson: string
  answersJson: string | null
  source: string
}

/**
 * Recompute TopicMastery rows for the given owner across ALL submitted
 * attempts (evidence only grows). Attempts stream through in deterministic
 * oldest→newest pages (see EVIDENCE_PAGE_SIZE) so the latest outcome per
 * question always wins, no matter how large the history grows.
 * When `topicIds` is provided, only those topics are rewritten (but evidence
 * is still built from every attempt, so per-question latest outcomes stay
 * globally correct).
 */
export async function recomputeTopicMastery(
  guestId: string,
  topicIds?: string[],
): Promise<{ updated: number }> {
  const evidence = new Map<string, TopicEvidence>()

  // ── Stream every submitted attempt of this owner, oldest → newest ──
  let cursorId: string | undefined
  for (;;) {
    const page: SubmittedAttemptRow[] = await db.attempt.findMany({
      where: { guestId, status: { in: ['SUBMITTED', 'TIMED_OUT'] } },
      select: { id: true, startedAt: true, submittedAt: true, questionIdsJson: true, answersJson: true, source: true },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: EVIDENCE_PAGE_SIZE,
    })
    if (page.length === 0) break

    // Resolve bank question metadata for THIS page only (bounded per page).
    // Mastery covers catalogue topics only — Riishe `t:` topics stay with the
    // existing weak-areas system.
    const pageBankIds = new Set<string>()
    for (const a of page) {
      if (a.source !== 'BANK') continue
      for (const id of safeParse<string[]>(a.questionIdsJson, [])) pageBankIds.add(id)
    }
    const metaById = new Map<string, ScoredQuestionMeta>()
    for (const ids of chunk([...pageBankIds], QUESTION_CHUNK)) {
      const rows = await db.question.findMany({
        where: { id: { in: ids } },
        select: { id: true, topicId: true, correctIndex: true, optionsJson: true },
      })
      for (const r of rows) {
        metaById.set(r.id, {
          id: r.id,
          topicId: r.topicId,
          correctIndex: r.correctIndex,
          optionCount: safeParse<string[]>(r.optionsJson ?? '', []).length,
        })
      }
    }

    const evidenceAttempts: AttemptForEvidence[] = page.map(a => ({
      id: a.id,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      questionIds: safeParse<string[]>(a.questionIdsJson, []),
      answers: safeParse<Record<string, number>>(a.answersJson ?? '{}', {}),
      questions: safeParse<string[]>(a.questionIdsJson, [])
        .map(id => metaById.get(id))
        .filter((q): q is ScoredQuestionMeta => !!q && !!q.topicId),
    }))
    accumulateTopicEvidence(evidence, evidenceAttempts)

    cursorId = page[page.length - 1].id
    if (page.length < EVIDENCE_PAGE_SIZE) break
  }

  const targets = topicIds ? [...evidence.entries()].filter(([topicId]) => topicIds.includes(topicId)) : [...evidence.entries()]
  if (targets.length === 0) return { updated: 0 }

  const targetIds = targets.map(([topicId]) => topicId)
  const [topics, prevRows] = await Promise.all([
    db.topic.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, name: true, unit: { select: { subject: { select: { stage: { select: { exam: { select: { shortName: true, name: true } } } } } } } } },
    }),
    db.topicMastery.findMany({ where: { guestId, topicId: { in: targetIds } }, select: { topicId: true, status: true } }),
  ])
  const topicById = new Map(topics.map(t => [t.id, t]))
  const prevByTopic = new Map(prevRows.map(r => [r.topicId, r.status]))

  let updated = 0
  for (const [topicId, ev] of targets) {
    const topic = topicById.get(topicId)
    if (!topic) continue // catalogue topic vanished — nothing to label
    const { accuracy, correctDistinct, distinct } = accuracyOf(ev)
    const prev = prevByTopic.get(topicId) ?? null
    const { status, statusReason } = mapMasteryStatus(ev, prev)
    const data = {
      topicName: topic.name,
      examLabel: topic.unit.subject.stage.exam.shortName ?? topic.unit.subject.stage.exam.name,
      status,
      statusReason,
      accuracy,
      evidenceQuestions: distinct,
      attemptCount: ev.attemptCount,
      correctDistinct,
      lastActivityAt: ev.lastAttemptAt,
    }
    await db.topicMastery.upsert({
      where: { guestId_topicId: { guestId, topicId } },
      create: { guestId, topicId, ...data },
      update: data,
    })
    updated++
  }
  return { updated }
}

// ─── Read helpers ──────────────────────────────────────────────────────────────

export function masteryRowToDTO(row: {
  topicId: string
  topicName: string
  examLabel: string | null
  status: string
  accuracy: number
  evidenceQuestions: number
  attemptCount: number
  statusReason: string | null
  lastActivityAt: Date | null
}): TopicMasteryDTO {
  return {
    topicId: row.topicId,
    topicName: row.topicName,
    examLabel: row.examLabel,
    status: row.status as MasteryStatus,
    accuracy: row.accuracy,
    evidenceQuestions: row.evidenceQuestions,
    attemptCount: row.attemptCount,
    statusReason: row.statusReason,
    lastActivityAt: row.lastActivityAt ? row.lastActivityAt.toISOString() : null,
  }
}

const STATUS_ORDER: Record<string, number> = {
  NEEDS_REVISION: 0,
  LEARNING: 1,
  INSUFFICIENT_EVIDENCE: 2,
  DEVELOPING: 3,
  STRONG: 4,
}

export function sortMasteryRows<T extends { status: string; accuracy: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const oa = STATUS_ORDER[a.status] ?? 5
    const ob = STATUS_ORDER[b.status] ?? 5
    if (oa !== ob) return oa - ob
    return a.accuracy - b.accuracy
  })
}

export function summarizeMastery(rows: TopicMasteryDTO[]): {
  counts: { strong: number; developing: number; learning: number; needsRevision: number; insufficientEvidence: number }
  weakest: TopicMasteryDTO[]
  strongest: TopicMasteryDTO[]
  totalTracked: number
} {
  const counts = { strong: 0, developing: 0, learning: 0, needsRevision: 0, insufficientEvidence: 0 }
  for (const r of rows) {
    if (r.status === 'STRONG') counts.strong++
    else if (r.status === 'DEVELOPING') counts.developing++
    else if (r.status === 'LEARNING') counts.learning++
    else if (r.status === 'NEEDS_REVISION') counts.needsRevision++
    else if (r.status === 'INSUFFICIENT_EVIDENCE') counts.insufficientEvidence++
  }
  const weakest = sortMasteryRows(rows.filter(r => r.status !== 'STRONG')).slice(0, 5)
  const strongest = [...rows]
    .filter(r => r.status === 'STRONG' || r.status === 'DEVELOPING')
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 3)
  return { counts, weakest, strongest, totalTracked: rows.length }
}
