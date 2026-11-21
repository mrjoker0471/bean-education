// ─── Personalized day planner (Phase 3B) ─────────────────────────────────────
// Deterministic, evidence-cited plan generation. Every candidate cites the
// real numbers behind it; ordering rules are documented and unit-tested.
//
// Candidate priority (1 = highest):
//   1. REVISE_TOPIC      — spaced-revision item due today or overdue
//   1. PRACTICE_TOPIC    — mastery NEEDS_REVISION (regression signal)
//   2. DIAGNOSTIC        — INSUFFICIENT_EVIDENCE topic with a real bank
//   2. PRACTICE_TOPIC    — mastery LEARNING (weakest accuracy first)
//   2. REVIEW_MISTAKES   — repeat-gap mistakes exist (max one per day)
//   2. GOAL_WORK         — ACTIVE goal nearing its target date
//   3. CONTINUE_DOC      — an analysis still in progress (max one per day)
//
// Capacity: candidates fill the learner's available minutes (their stated
// dailyMinutes preference, min 15, max 180) in priority order; a candidate
// that no longer fits is skipped, never truncated dishonestly.
//
// History rule (spec §6): COMPLETED / SKIPPED / DEFERRED rows are immutable
// history. Regeneration deletes ONLY PLANNED rows for that date, then rebuilds.
// Deferring or rescheduling never rewrites a completed activity.

import type { PlanTaskKind } from './dto'

export interface PlanCandidate {
  kind: PlanTaskKind
  title: string
  topicId: string | null
  topicName: string | null
  examLabel: string | null
  estimatedMinutes: number
  priority: number
  rationale: string
  evidence: Record<string, unknown>
}

export const TASK_MINUTES = {
  REVISE_TOPIC: 10,
  PRACTICE_TOPIC: 20,
  DIAGNOSTIC: 15,
  REVIEW_MISTAKES: 10,
  GOAL_WORK: 20,
  CONTINUE_DOC: 15,
} as const

export const MIN_AVAILABLE_MINUTES = 15
export const MAX_AVAILABLE_MINUTES = 180

export function clampAvailableMinutes(raw: number | null | undefined): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 0
  if (n < MIN_AVAILABLE_MINUTES) return MIN_AVAILABLE_MINUTES
  return Math.min(n, MAX_AVAILABLE_MINUTES)
}

export interface PlannerInputs {
  dueRevisions: {
    topicId: string
    topicName: string
    examLabel: string | null
    daysOverdue: number
    lastOutcome: string | null
    misconceptionFlag: boolean
  }[]
  needsRevision: { topicId: string; topicName: string; examLabel: string | null; accuracy: number; evidenceQuestions: number; statusReason: string | null }[]
  insufficient: { topicId: string; topicName: string; examLabel: string | null; evidenceQuestions: number; questionBank: number }[]
  weakTopics: { topicId: string; topicName: string; examLabel: string | null; accuracy: number; evidenceQuestions: number; attemptCount: number }[]
  repeatGapMistakes: number
  goalsNearTarget: { id: string; title: string; topicId: string | null; topicName: string | null; daysLeft: number }[]
  inProgressDocs: { id: string; title: string }[]
  /** topicIds that already have a PLANNED task today (dedupe). */
  plannedTopicIds: Set<string>
  /** true when a REVISE/PRACTICE slot already exists for a topic today. */
}

/** Pure: build the ordered candidate list from real evidence. */
export function buildPlanCandidates(inputs: PlannerInputs): PlanCandidate[] {
  const candidates: PlanCandidate[] = []
  const usedTopics = new Set<string>(inputs.plannedTopicIds)

  const take = (topicId: string | null): boolean => {
    if (!topicId) return true
    if (usedTopics.has(topicId)) return false
    usedTopics.add(topicId)
    return true
  }

  // 1. Due revisions (overdue first, misconception-flagged first within a tie).
  for (const r of [...inputs.dueRevisions].sort((a, b) => (b.daysOverdue - a.daysOverdue))) {
    if (!take(r.topicId)) continue
    const when = r.daysOverdue > 0 ? `${r.daysOverdue} day${r.daysOverdue === 1 ? '' : 's'} overdue` : 'due today'
    candidates.push({
      kind: 'REVISE_TOPIC',
      title: `Revise: ${r.topicName}`,
      topicId: r.topicId,
      topicName: r.topicName,
      examLabel: r.examLabel,
      estimatedMinutes: TASK_MINUTES.REVISE_TOPIC,
      priority: 1,
      rationale: `Spaced revision is ${when} (last result: ${r.lastOutcome ?? 'not scored'}).${r.misconceptionFlag ? ' A flagged misconception pulls this forward.' : ''}`,
      evidence: { topicId: r.topicId, daysOverdue: r.daysOverdue, lastOutcome: r.lastOutcome },
    })
  }

  // 1. Regression topics — NEEDS_REVISION.
  for (const t of inputs.needsRevision) {
    if (!take(t.topicId)) continue
    candidates.push({
      kind: 'PRACTICE_TOPIC',
      title: `Rebuild: ${t.topicName}`,
      topicId: t.topicId,
      topicName: t.topicName,
      examLabel: t.examLabel,
      estimatedMinutes: TASK_MINUTES.PRACTICE_TOPIC,
      priority: 1,
      rationale: t.statusReason ?? `Your latest result here dropped below the 60% line (lifetime evidence: ${t.evidenceQuestions} distinct questions at ${t.accuracy}%).`,
      evidence: { topicId: t.topicId, accuracy: t.accuracy, evidenceQuestions: t.evidenceQuestions, status: 'NEEDS_REVISION' },
    })
  }

  // 2. Diagnostics for thin evidence — one per day, best bank first.
  let diagnostics = 0
  for (const t of [...inputs.insufficient].sort((a, b) => b.questionBank - a.questionBank)) {
    if (diagnostics >= 1) break
    if (!take(t.topicId)) continue
    diagnostics++
    candidates.push({
      kind: 'DIAGNOSTIC',
      title: `Diagnostic: ${t.topicName}`,
      topicId: t.topicId,
      topicName: t.topicName,
      examLabel: t.examLabel,
      estimatedMinutes: TASK_MINUTES.DIAGNOSTIC,
      priority: 2,
      rationale: `Only ${t.evidenceQuestions} distinct question${t.evidenceQuestions === 1 ? '' : 's'} answered so far — a ${Math.min(10, Math.max(t.questionBank, 0))}-question diagnostic gives this topic a real baseline.`,
      evidence: { topicId: t.topicId, evidenceQuestions: t.evidenceQuestions, questionBank: t.questionBank },
    })
  }

  // 2. Weak topics — LEARNING, lowest accuracy first.
  for (const t of [...inputs.weakTopics].sort((a, b) => a.accuracy - b.accuracy)) {
    if (!take(t.topicId)) continue
    candidates.push({
      kind: 'PRACTICE_TOPIC',
      title: `Practice: ${t.topicName}`,
      topicId: t.topicId,
      topicName: t.topicName,
      examLabel: t.examLabel,
      estimatedMinutes: TASK_MINUTES.PRACTICE_TOPIC,
      priority: 2,
      rationale: `${t.accuracy}% over ${t.evidenceQuestions} distinct questions across ${t.attemptCount} attempt${t.attemptCount === 1 ? '' : 's'} — targeted practice moves this fastest.`,
      evidence: { topicId: t.topicId, accuracy: t.accuracy, evidenceQuestions: t.evidenceQuestions, attemptCount: t.attemptCount },
    })
  }

  // 2. Mistake review — one slot per day when repeat gaps exist.
  if (inputs.repeatGapMistakes > 0) {
    candidates.push({
      kind: 'REVIEW_MISTAKES',
      title: 'Review repeat mistakes',
      topicId: null,
      topicName: null,
      examLabel: null,
      estimatedMinutes: TASK_MINUTES.REVIEW_MISTAKES,
      priority: 2,
      rationale: `${inputs.repeatGapMistakes} repeat-gap mistake${inputs.repeatGapMistakes === 1 ? '' : 's'} — questions you have missed more than once. Ten focused minutes here beats ten new questions.`,
      evidence: { repeatGapMistakes: inputs.repeatGapMistakes },
    })
  }

  // 2. Goals nearing their target date.
  for (const g of [...inputs.goalsNearTarget].sort((a, b) => a.daysLeft - b.daysLeft)) {
    if (!take(g.topicId)) continue
    const days = g.daysLeft
    candidates.push({
      kind: 'GOAL_WORK',
      title: `Work toward: ${g.title}`,
      topicId: g.topicId,
      topicName: g.topicName,
      examLabel: null,
      estimatedMinutes: TASK_MINUTES.GOAL_WORK,
      priority: 2,
      rationale: `Your goal "${g.title}" ${days >= 0 ? `is due in ${days} day${days === 1 ? '' : 's'}` : `was due ${-days} day${days === 1 ? '' : 's'} ago`} — ${g.topicName ? `progress here moves it directly.` : 'steady practice moves it forward.'}`,
      evidence: { goalId: g.id, daysLeft: days, topicId: g.topicId },
    })
  }

  // 3. Continue an in-progress analysis — one slot.
  if (inputs.inProgressDocs.length > 0) {
    const doc = inputs.inProgressDocs[0]
    candidates.push({
      kind: 'CONTINUE_DOC',
      title: `Continue: ${doc.title}`,
      topicId: null,
      topicName: null,
      examLabel: null,
      estimatedMinutes: TASK_MINUTES.CONTINUE_DOC,
      priority: 3,
      rationale: `"${doc.title}" is still being processed — checking it keeps your materials flowing into practice.`,
      evidence: { documentId: doc.id },
    })
  }

  return candidates
}

/** Pure: fill the available minutes in priority order; never exceeds capacity. */
export function fillPlan(candidates: PlanCandidate[], availableMinutes: number): PlanCandidate[] {
  const picked: PlanCandidate[] = []
  let remaining = availableMinutes
  for (const c of candidates) {
    if (c.estimatedMinutes <= remaining) {
      picked.push(c)
      remaining -= c.estimatedMinutes
    }
  }
  return picked
}

export function plannedMinutesOf(picked: PlanCandidate[]): number {
  return picked.reduce((sum, c) => sum + c.estimatedMinutes, 0)
}
