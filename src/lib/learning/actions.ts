// ─── Explainable next-best actions (Phase 3B) ────────────────────────────────
// Deterministic candidate ranking over real evidence. Every action carries a
// reason that cites the underlying records. No randomness, no fake urgency,
// no paid APIs, no unexplained AI decisions.
//
// Priority = BASE[type] + evidenceBoost + outcomeBoost, sorted descending.
//   BASE:        REVIEW_DUE 90 · NEEDS_REVISION 85 · WEAK_TOPIC 80 · DIAGNOSTIC 70
//                · REVIEW_MISTAKES 65 · GOAL_WORK 60 · PLAN_TODAY 55 · CONTINUE_DOC 50
//   evidenceBoost: +5 when the evidence is overdue / a repeat gap, documented
//                  per candidate below.
//   outcomeBoost: +10 for action types whose past completions measurably
//                 improved the underlying topic (accuracy snapshot taken at
//                 completion vs. current computed accuracy, ≥ +5 points).
//                 Deterministic and documented — never a learned black box.
//
// Suppression (lifecycle rows, one per actionKey):
//   • DISMISSED — hidden for 7 days, then re-offers if the evidence persists
//   • SNOOZED   — hidden until snoozedUntil
//   • COMPLETED — hidden while the underlying evidence has not moved since
//                 completion (a newer attempt on the topic, a later mistake,
//                 or simply the next day for day-scoped actions)

import type { ActionType, LearningActionDTO } from './dto'

export const ACTION_BASE_PRIORITY: Record<ActionType, number> = {
  REVIEW_DUE: 90,
  NEEDS_REVISION_PRACTICE: 85,
  WEAK_TOPIC_PRACTICE: 80,
  DIAGNOSTIC: 70,
  REVIEW_MISTAKES: 65,
  GOAL_WORK: 60,
  PLAN_TODAY: 55,
  CONTINUE_DOC: 50,
}

export const DISMISS_HIDE_DAYS = 7
export const MAX_ACTIONS = 5

export interface ActionCandidate {
  actionKey: string
  type: ActionType
  title: string
  reason: string
  topicId: string | null
  href: string
  /** Optional evidence tie-break: larger = more urgent (overdue days, etc.). */
  urgency: number
}

export interface ActionLifecycle {
  actionKey: string
  status: string // DISMISSED | SNOOZED | COMPLETED
  snoozedUntil: Date | null
  resolvedAt: Date | null
}

export interface ActionOutcomeRecord {
  type: string
  topicId: string | null
  /** Mastery accuracy captured when the action was completed. */
  accuracySnapshot: number | null
  resolvedAt: Date
}

export interface ActionEvidenceState {
  /** Latest submitted-attempt timestamp per topic (evidence movement). */
  topicLastActivity: Map<string, Date>
  /** Latest mistake-record timestamp (any topic). */
  lastMistakeAt: Date | null
}

export interface RankedAction extends LearningActionDTO {
  base: number
  evidenceBoost: number
  outcomeBoost: number
}

/** Pure: compute the outcome boost per type from completion records + current accuracy. */
export function computeOutcomeBoost(
  outcomes: ActionOutcomeRecord[],
  currentTopicAccuracy: Map<string, number>,
): Map<string, number> {
  const boost = new Map<string, number>()
  for (const o of outcomes) {
    if (o.topicId && o.accuracySnapshot !== null) {
      const current = currentTopicAccuracy.get(o.topicId)
      if (current !== undefined && current - o.accuracySnapshot >= 5) {
        boost.set(o.type, 10)
      }
    }
  }
  return boost
}

export interface RankContext {
  now: Date
  lifecycle: Map<string, ActionLifecycle>
  outcomeBoost: Map<string, number>
  evidence: ActionEvidenceState
}

/** Pure: suppression + ranking, fully unit-tested. */
export function rankActions(candidates: ActionCandidate[], ctx: RankContext): RankedAction[] {
  const visible: RankedAction[] = []
  for (const c of candidates) {
    const life = ctx.lifecycle.get(c.actionKey)
    if (life) {
      if (life.status === 'SNOOZED' && life.snoozedUntil && ctx.now.getTime() < life.snoozedUntil.getTime()) continue
      if (life.status === 'DISMISSED' && life.resolvedAt) {
        const hideUntil = life.resolvedAt.getTime() + DISMISS_HIDE_DAYS * 24 * 3600_000
        if (ctx.now.getTime() < hideUntil) continue
      }
      if (life.status === 'COMPLETED' && life.resolvedAt) {
        const resolved = life.resolvedAt.getTime()
        if (c.topicId) {
          const last = ctx.evidence.topicLastActivity.get(c.topicId)
          // Hidden until NEW evidence lands on this topic after completion.
          if (!last || last.getTime() <= resolved) continue
        } else if (c.type === 'REVIEW_MISTAKES') {
          if (!ctx.evidence.lastMistakeAt || ctx.evidence.lastMistakeAt.getTime() <= resolved) continue
        } else {
          // Day-scoped actions (PLAN_TODAY, CONTINUE_DOC, GOAL_WORK without a topic)
          // re-offer the next day if still evidence-backed.
          const startOfResolvedDay = new Date(life.resolvedAt.getFullYear(), life.resolvedAt.getMonth(), life.resolvedAt.getDate()).getTime()
          const startOfNowDay = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), ctx.now.getDate()).getTime()
          if (startOfNowDay <= startOfResolvedDay) continue
        }
      }
    }

    let evidenceBoost = 0
    if (c.type === 'REVIEW_DUE' && c.urgency > 0) evidenceBoost = 5
    if (c.type === 'REVIEW_MISTAKES' && c.urgency >= 3) evidenceBoost = 5
    const outcomeBoost = ctx.outcomeBoost.get(c.type) ?? 0
    visible.push({
      actionKey: c.actionKey,
      type: c.type,
      title: c.title,
      reason: c.reason,
      topicId: c.topicId,
      href: c.href,
      priority: ACTION_BASE_PRIORITY[c.type] + evidenceBoost + outcomeBoost,
      base: ACTION_BASE_PRIORITY[c.type],
      evidenceBoost,
      outcomeBoost,
    })
  }
  return visible
    .sort((a, b) => b.priority - a.priority || a.actionKey.localeCompare(b.actionKey))
    .slice(0, MAX_ACTIONS)
}

/** Pure actionKey builders — stable across reads so lifecycle rows attach. */
export const actionKeys = {
  reviewDue: (topicId: string) => `REVIEW_DUE:${topicId}`,
  needsRevision: (topicId: string) => `NEEDS_REVISION_PRACTICE:${topicId}`,
  weakTopic: (topicId: string) => `WEAK_TOPIC_PRACTICE:${topicId}`,
  diagnostic: (topicId: string) => `DIAGNOSTIC:${topicId}`,
  reviewMistakes: () => 'REVIEW_MISTAKES:open',
  goalWork: (goalId: string) => `GOAL_WORK:${goalId}`,
  planToday: () => 'PLAN_TODAY:open',
  continueDoc: (docId: string) => `CONTINUE_DOC:${docId}`,
}
