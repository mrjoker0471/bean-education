// ─── Mistake intelligence (Phase 3B) ─────────────────────────────────────────
// Records are created ONLY from real wrong answers at submit time. System
// categories are evidence-only:
//   • REPEAT_GAP    — this question (or this topic) has real prior misses
//   • CONCEPT       — a grounded Riishe explanation exists for this exact
//                     (attempt, question) and names a concept/misconception
//   • UNCLASSIFIED  — honest default; the system never guesses FACT/FORMULA/
//                     MISREAD without evidence
// Students may add a subjective self-tag (CONCEPT/FACT/FORMULA/MISREAD) and a
// short note — the UI prefers the self-tag and always labels it self-reported.
//
// Snapshots (question text, options, explanation) are captured at record time
// so review keeps working even if the underlying question row changes.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { MistakeItemDTO, MistakeStudentTag, MistakeSystemCategory } from './dto'

export interface WrongAnswerRow {
  questionId: string
  chosenIndex: number
  correctIndex: number
  topicId: string | null
  topicName: string | null
  source: 'BANK' | 'RIISHE'
  text: string
  options: string[]
  explanation: string | null
}

/** Pure classification — fully unit-tested. */
export function classifyMistake(ctx: {
  priorWrongSameQuestion: number
  priorWrongSameTopic: number
  groundedConcept: string | null
}): { category: MistakeSystemCategory; categoryReason: string | null } {
  if (ctx.groundedConcept) {
    return {
      category: 'CONCEPT',
      categoryReason: `A grounded Riishe explanation flagged this as a "${ctx.groundedConcept}" gap.`,
    }
  }
  if (ctx.priorWrongSameQuestion > 0 || ctx.priorWrongSameTopic >= 2) {
    const how = ctx.priorWrongSameQuestion > 0
      ? `you have missed this exact question ${ctx.priorWrongSameQuestion + 1} time${ctx.priorWrongSameQuestion === 0 ? '' : 's'} now`
      : `${ctx.priorWrongSameTopic + 1} misses now sit in this topic`
    return { category: 'REPEAT_GAP', categoryReason: `Repeat gap — ${how}.` }
  }
  return { category: 'UNCLASSIFIED', categoryReason: null }
}

const VALID_TAGS = new Set<MistakeStudentTag>(['CONCEPT', 'FACT', 'FORMULA', 'MISREAD'])

export function normalizeStudentTag(raw: unknown): MistakeStudentTag | null {
  return typeof raw === 'string' && VALID_TAGS.has(raw as MistakeStudentTag) ? (raw as MistakeStudentTag) : null
}

/**
 * Persist mistake records for one submitted attempt's wrong answers.
 * Called from the evidence hook AFTER scoring; idempotent per (attempt, question)
 * via the unique constraint, so duplicate hooks never double-count.
 */
export async function recordMistakes(attempt: {
  id: string
  guestId: string
  studentId: string | null
  source: string
  submittedAt: Date | null
}): Promise<number> {
  const attemptRow = await db.attempt.findUnique({
    where: { id: attempt.id },
    select: { questionIdsJson: true, answersJson: true, source: true },
  })
  if (!attemptRow) return 0

  const ids = safeParse<string[]>(attemptRow.questionIdsJson, [])
  const answers = safeParse<Record<string, number>>(attemptRow.answersJson ?? '{}', {})
  if (ids.length === 0) return 0

  interface Loaded { questionId: string; chosenIndex: number; correctIndex: number; topicId: string | null; topicName: string | null; text: string; options: string[]; explanation: string | null }
  let wrongs: Loaded[] = []

  if (attemptRow.source === 'RIISHE') {
    const rows = await db.riisheQuestion.findMany({
      where: { id: { in: ids } },
      select: { id: true, correctIndex: true, optionsJson: true, topic: true, text: true, explanation: true },
    })
    const byId = new Map(rows.map(r => [r.id, r]))
    wrongs = ids
      .map(id => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(r => ({ questionId: r.id, chosenIndex: answers[r.id] ?? -1, correctIndex: r.correctIndex, topicId: null, topicName: r.topic ?? null, text: r.text, options: safeParse<string[]>(r.optionsJson, []), explanation: r.explanation || null }))
      .filter(w => w.chosenIndex !== w.correctIndex && w.chosenIndex >= 0)
  } else {
    const rows = await db.question.findMany({
      where: { id: { in: ids } },
      select: { id: true, correctIndex: true, optionsJson: true, topicId: true, topic: { select: { name: true } }, text: true, explanation: true },
    })
    const byId = new Map(rows.map(r => [r.id, r]))
    wrongs = ids
      .map(id => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(r => ({ questionId: r.id, chosenIndex: answers[r.id] ?? -1, correctIndex: r.correctIndex, topicId: r.topicId, topicName: r.topic?.name ?? null, text: r.text, options: safeParse<string[]>(r.optionsJson, []), explanation: r.explanation || null }))
      .filter(w => w.chosenIndex !== w.correctIndex && w.chosenIndex >= 0)
  }
  if (wrongs.length === 0) return 0

  // Prior evidence BEFORE inserting this attempt's rows (REPEAT_GAP is honest).
  const priorQuestion = new Map<string, number>()
  const priorTopic = new Map<string, number>()
  for (const w of wrongs) {
    priorQuestion.set(w.questionId, await db.mistakeRecord.count({ where: { guestId: attempt.guestId, questionId: w.questionId } }))
    if (w.topicId) priorTopic.set(w.topicId, await db.mistakeRecord.count({ where: { guestId: attempt.guestId, topicId: w.topicId } }))
  }

  // Grounded concepts, when a Riishe explanation exists for this exact
  // attempt+question. The payload is JSON (RiisheExplanationPayloadDTO).
  const explanationRows = attemptRow.source === 'RIISHE'
    ? await db.riisheExplanation.findMany({
        where: { attemptId: attempt.id, questionId: { in: wrongs.map(w => w.questionId) }, status: 'READY' },
        select: { questionId: true, payloadJson: true },
      })
    : []
  const conceptByQuestion = new Map<string, string>()
  for (const e of explanationRows) {
    const payload = safeParse<{ concept?: string; misconception?: string | null; revisionTopic?: string } | null>(e.payloadJson, null)
    if (!payload) continue
    const concept = payload.concept || payload.misconception || payload.revisionTopic || null
    if (concept) conceptByQuestion.set(e.questionId, concept)
  }

  let created = 0
  for (const w of wrongs) {
    const { category, categoryReason } = classifyMistake({
      priorWrongSameQuestion: priorQuestion.get(w.questionId) ?? 0,
      priorWrongSameTopic: priorTopic.get(w.topicId ?? '') ?? 0,
      groundedConcept: conceptByQuestion.get(w.questionId) ?? null,
    })
    const snapshot = { text: w.text, options: w.options, explanation: w.explanation }
    const result = await db.mistakeRecord.upsert({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId: w.questionId } },
      create: {
        guestId: attempt.guestId,
        studentId: attempt.studentId,
        attemptId: attempt.id,
        questionId: w.questionId,
        source: attemptRow.source === 'RIISHE' ? 'RIISHE' : 'BANK',
        topicId: w.topicId,
        topicName: w.topicName,
        chosenIndex: w.chosenIndex,
        correctIndex: w.correctIndex,
        snapshotJson: JSON.stringify(snapshot),
        category,
        categoryReason,
      },
      update: {}, // a recorded mistake is immutable history — re-hooks never rewrite it
    })
    if (result) created++
  }
  return created
}

// ─── Read side ─────────────────────────────────────────────────────────────────

export function mistakeRowToDTO(
  row: {
    id: string
    attemptId: string
    questionId: string
    source: string
    topicId: string | null
    topicName: string | null
    chosenIndex: number
    correctIndex: number
    snapshotJson: string
    category: string
    categoryReason: string | null
    studentTag: string | null
    note: string | null
    createdAt: Date
  },
  timesWrong: number,
): MistakeItemDTO {
  const snapshot = safeParse<{ text?: string; options?: string[]; explanation?: string | null }>(row.snapshotJson, {})
  return {
    id: row.id,
    attemptId: row.attemptId,
    source: row.source as 'BANK' | 'RIISHE',
    questionId: row.questionId,
    topicId: row.topicId,
    topicName: row.topicName,
    text: snapshot.text ?? 'Question snapshot unavailable',
    options: Array.isArray(snapshot.options) ? snapshot.options : [],
    chosenIndex: row.chosenIndex,
    correctIndex: row.correctIndex,
    explanation: snapshot.explanation ?? null,
    category: row.category as MistakeSystemCategory,
    categoryReason: row.categoryReason,
    studentTag: normalizeStudentTag(row.studentTag),
    note: row.note,
    timesWrong,
    createdAt: row.createdAt.toISOString(),
  }
}
