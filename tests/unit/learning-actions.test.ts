import { describe, it, expect, mock } from 'bun:test'

// ─── Next-best-action ranking (Phase 3B, pure) ────────────────────────────────
// Deterministic priority = base + evidence boost + outcome boost; lifecycle
// suppression (dismiss 7 days, snooze until date, completed until new evidence).

mock.module('@/lib/db', () => ({ db: {} }))

import { rankActions, computeOutcomeBoost, ACTION_BASE_PRIORITY, MAX_ACTIONS, type ActionCandidate, type ActionLifecycle } from '@/lib/learning/actions'

const NOW = new Date('2026-04-01T12:00:00Z')
const DAY = 24 * 3600_000

function cand(over: Partial<ActionCandidate> & { actionKey: string; type: ActionCandidate['type'] }): ActionCandidate {
  return { title: 'T', reason: 'R', topicId: null, href: '#/learning', urgency: 0, ...over }
}

function ctx(over: { lifecycle?: Map<string, ActionLifecycle>; outcomeBoost?: Map<string, number>; topicLastActivity?: Map<string, Date>; lastMistakeAt?: Date | null } = {}) {
  return {
    now: NOW,
    lifecycle: over.lifecycle ?? new Map(),
    outcomeBoost: over.outcomeBoost ?? new Map(),
    evidence: { topicLastActivity: over.topicLastActivity ?? new Map(), lastMistakeAt: over.lastMistakeAt ?? null },
  }
}

describe('rankActions — ordering and caps', () => {
  it('orders by documented base priority and caps at MAX_ACTIONS', () => {
    const ranked = rankActions(
      [
        cand({ actionKey: 'CONTINUE_DOC:d1', type: 'CONTINUE_DOC' }),
        cand({ actionKey: 'REVIEW_DUE:t1', type: 'REVIEW_DUE', urgency: 2 }),
        cand({ actionKey: 'WEAK_TOPIC_PRACTICE:t2', type: 'WEAK_TOPIC_PRACTICE' }),
        cand({ actionKey: 'DIAGNOSTIC:t3', type: 'DIAGNOSTIC' }),
        cand({ actionKey: 'REVIEW_MISTAKES:open', type: 'REVIEW_MISTAKES', urgency: 3 }),
        cand({ actionKey: 'GOAL_WORK:g1', type: 'GOAL_WORK' }),
        cand({ actionKey: 'PLAN_TODAY:open', type: 'PLAN_TODAY' }),
      ],
      ctx(),
    )
    expect(ranked.length).toBe(MAX_ACTIONS)
    expect(ranked[0].type).toBe('REVIEW_DUE')
    expect(ranked[0].priority).toBe(ACTION_BASE_PRIORITY.REVIEW_DUE + 5) // overdue boost
    expect(ranked[1].type).toBe('WEAK_TOPIC_PRACTICE')
    expect(ranked.every(a => a.reason.length > 0 || a.title.length > 0)).toBeTrue()
  })

  it('REVIEW_MISTAKES gets its evidence boost only with real repeat volume', () => {
    const withVolume = rankActions([cand({ actionKey: 'REVIEW_MISTAKES:open', type: 'REVIEW_MISTAKES', urgency: 3 })], ctx())
    const quiet = rankActions([cand({ actionKey: 'REVIEW_MISTAKES:open', type: 'REVIEW_MISTAKES', urgency: 1 })], ctx())
    expect(withVolume[0].evidenceBoost).toBe(5)
    expect(quiet[0].evidenceBoost).toBe(0)
  })
})

describe('rankActions — lifecycle suppression', () => {
  it('SNOOZED hides until the snooze date, then re-offers', () => {
    const snoozed = new Map<string, ActionLifecycle>([
      ['REVIEW_DUE:t1', { actionKey: 'REVIEW_DUE:t1', status: 'SNOOZED', snoozedUntil: new Date(NOW.getTime() + DAY), resolvedAt: NOW }],
    ])
    expect(rankActions([cand({ actionKey: 'REVIEW_DUE:t1', type: 'REVIEW_DUE' })], ctx({ lifecycle: snoozed })).length).toBe(0)
    const expired = new Map(snoozed)
    expired.set('REVIEW_DUE:t1', { actionKey: 'REVIEW_DUE:t1', status: 'SNOOZED', snoozedUntil: new Date(NOW.getTime() - DAY), resolvedAt: NOW })
    expect(rankActions([cand({ actionKey: 'REVIEW_DUE:t1', type: 'REVIEW_DUE' })], ctx({ lifecycle: expired })).length).toBe(1)
  })

  it('DISMISSED hides for 7 days then re-offers (evidence persists)', () => {
    const life = new Map<string, ActionLifecycle>([
      ['WEAK_TOPIC_PRACTICE:t1', { actionKey: 'WEAK_TOPIC_PRACTICE:t1', status: 'DISMISSED', snoozedUntil: null, resolvedAt: new Date(NOW.getTime() - 3 * DAY) }],
    ])
    expect(rankActions([cand({ actionKey: 'WEAK_TOPIC_PRACTICE:t1', type: 'WEAK_TOPIC_PRACTICE', topicId: 't1' })], ctx({ lifecycle: life })).length).toBe(0)
    const old = new Map(life)
    old.set('WEAK_TOPIC_PRACTICE:t1', { actionKey: 'WEAK_TOPIC_PRACTICE:t1', status: 'DISMISSED', snoozedUntil: null, resolvedAt: new Date(NOW.getTime() - 8 * DAY) })
    expect(rankActions([cand({ actionKey: 'WEAK_TOPIC_PRACTICE:t1', type: 'WEAK_TOPIC_PRACTICE', topicId: 't1' })], ctx({ lifecycle: old })).length).toBe(1)
  })

  it('COMPLETED topic actions stay hidden until NEW evidence lands on that topic', () => {
    const life = new Map<string, ActionLifecycle>([
      ['WEAK_TOPIC_PRACTICE:t1', { actionKey: 'WEAK_TOPIC_PRACTICE:t1', status: 'COMPLETED', snoozedUntil: null, resolvedAt: NOW }],
    ])
    const c = [cand({ actionKey: 'WEAK_TOPIC_PRACTICE:t1', type: 'WEAK_TOPIC_PRACTICE', topicId: 't1' })]
    // No newer attempt → still hidden.
    expect(rankActions(c, ctx({ lifecycle: life, topicLastActivity: new Map([['t1', NOW]]) })).length).toBe(0)
    // A newer submitted attempt after completion → re-offers.
    const newer = new Map([['t1', new Date(NOW.getTime() + DAY)]])
    expect(rankActions(c, ctx({ lifecycle: life, topicLastActivity: newer })).length).toBe(1)
  })

  it('COMPLETED day-scoped actions re-offer only the next day', () => {
    const life = new Map<string, ActionLifecycle>([
      ['PLAN_TODAY:open', { actionKey: 'PLAN_TODAY:open', status: 'COMPLETED', snoozedUntil: null, resolvedAt: NOW }],
    ])
    expect(rankActions([cand({ actionKey: 'PLAN_TODAY:open', type: 'PLAN_TODAY' })], ctx({ lifecycle: life })).length).toBe(0)
    const laterCtx = ctx({ lifecycle: life })
    laterCtx.now = new Date(NOW.getTime() + 2 * DAY)
    expect(rankActions([cand({ actionKey: 'PLAN_TODAY:open', type: 'PLAN_TODAY' })], laterCtx).length).toBe(1)
  })
})

describe('computeOutcomeBoost — deterministic, improvement-gated', () => {
  it('boosts only types whose topic measurably improved (+5 points)', () => {
    const boost = computeOutcomeBoost(
      [
        { type: 'WEAK_TOPIC_PRACTICE', topicId: 't1', accuracySnapshot: 40, resolvedAt: NOW },
        { type: 'REVIEW_DUE', topicId: 't2', accuracySnapshot: 70, resolvedAt: NOW },
      ],
      new Map([['t1', 55], ['t2', 72]]), // t1 +15 → boost; t2 +2 → no boost
    )
    expect(boost.get('WEAK_TOPIC_PRACTICE')).toBe(10)
    expect(boost.has('REVIEW_DUE')).toBeFalse()
  })

  it('never boosts without a measurable snapshot', () => {
    const boost = computeOutcomeBoost([{ type: 'PLAN_TODAY', topicId: null, accuracySnapshot: null, resolvedAt: NOW }], new Map())
    expect(boost.size).toBe(0)
  })
})
