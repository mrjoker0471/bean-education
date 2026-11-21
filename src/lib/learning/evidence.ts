// ─── Evidence hook (Phase 3B) ────────────────────────────────────────────────
// One orchestrator called from POST /api/attempts/[id] right after the
// authoritative scoring completes. It:
//   1. recomputes deterministic mastery for the catalogue topics this attempt
//      touched (evidence built from ALL submitted attempts — latest outcome
//      per question wins),
//   2. records immutable mistake rows for this attempt's wrong answers,
//   3. moves the spaced-revision ladder per topic outcome and pulls topics
//      forward when a grounded explanation flags a misconception.
//
// The hook NEVER throws and NEVER blocks or corrupts the test flow: scoring
// truth stays in the Attempt row; learning state is derived, re-derivable and
// every function here is idempotent per (attempt, question).

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { recomputeTopicMastery } from './mastery'
import { recordMistakes } from './mistakes'
import { applyRevisionOutcome } from './revision'

export interface EvidenceResult {
  masteryTopics: number
  mistakes: number
  revisionUpdates: number
  skippedReason?: string
}

function isCatalogueTopicId(topicId: string): boolean {
  return !topicId.startsWith('t:')
}

export async function recordAttemptEvidence(attemptId: string): Promise<EvidenceResult> {
  const result: EvidenceResult = { masteryTopics: 0, mistakes: 0, revisionUpdates: 0 }
  try {
    const attempt = await db.attempt.findUnique({ where: { id: attemptId } })
    if (!attempt) return { ...result, skippedReason: 'attempt-missing' }
    if (attempt.status !== 'SUBMITTED' && attempt.status !== 'TIMED_OUT') {
      return { ...result, skippedReason: 'not-scored' }
    }
    if (!attempt.guestId) return { ...result, skippedReason: 'no-owner' }

    const perTopic = safeParse<Record<string, { name: string; correct: number; total: number }>>(attempt.perTopicJson ?? '{}', {})
    const answers = safeParse<Record<string, number>>(attempt.answersJson ?? '{}', {})

    // ── 1. Mastery recompute (catalogue topics only) ──
    const touchedTopicIds = Object.keys(perTopic).filter(isCatalogueTopicId)
    if (touchedTopicIds.length > 0) {
      const mastery = await recomputeTopicMastery(attempt.guestId, touchedTopicIds)
      result.masteryTopics = mastery.updated
    }

    // ── 2. Mistake records (bank + Riishe wrong answers) ──
    result.mistakes = await recordMistakes({
      id: attempt.id,
      guestId: attempt.guestId,
      studentId: attempt.studentId,
      source: attempt.source,
      submittedAt: attempt.submittedAt,
    })

    // ── 3. Revision ladder movement ──
    // Weakness-signal rule: a REPEAT_GAP mistake recorded by step 2 (a real
    // prior miss of the same question or topic) pulls that topic's next
    // revision to at most +1 day until a SUCCESS clears the flag. A grounded
    // Riishe misconception explanation would set the same flag — Riishe
    // topics are `t:`-scoped today, so the repeat-gap path is the live one.
    const signalTopicIds = new Set<string>(
      touchedTopicIds.length > 0 && result.mistakes > 0
        ? (
            await db.mistakeRecord.findMany({
              where: { attemptId: attempt.id, topicId: { in: touchedTopicIds }, category: 'REPEAT_GAP' },
              select: { topicId: true },
            })
          ).map(m => m.topicId).filter((id): id is string => !!id)
        : [],
    )

    for (const [topicId, t] of Object.entries(perTopic)) {
      if (!isCatalogueTopicId(topicId)) continue
      if (t.total <= 0) continue
      const misconception = signalTopicIds.has(topicId)
      const accuracy = Math.round((t.correct / t.total) * 100)
      const topic = await db.topic.findUnique({ where: { id: topicId }, select: { name: true, unit: { select: { subject: { select: { stage: { select: { exam: { select: { shortName: true, name: true } } } } } } } } } })
      if (!topic) continue
      const outcome = await applyRevisionOutcome({
        guestId: attempt.guestId,
        topicId,
        topicName: topic.name,
        examLabel: topic.unit.subject.stage.exam.shortName ?? topic.unit.subject.stage.exam.name,
        accuracy,
        answeredCount: t.total,
        attemptedAt: attempt.submittedAt ?? attempt.startedAt,
        misconception,
      })
      if (outcome !== 'SKIPPED') result.revisionUpdates++
    }

    return result
  } catch (err) {
    // Learning state is derived — a failure here must never break the test flow.
    console.error('[learning/evidence] recordAttemptEvidence failed (non-fatal)', err)
    return result
  }
}
