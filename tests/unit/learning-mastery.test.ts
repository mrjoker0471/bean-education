import { describe, it, expect, mock } from 'bun:test'

// ─── Deterministic mastery mapping (Phase 3B, pure) ───────────────────────────
// Evidence is built ONLY from answered questions; the latest answer per
// question wins; small samples never earn a band; a recent collapse below
// 60% flags NEEDS_REVISION even when lifetime accuracy looks fine.

mock.module('@/lib/db', () => ({ db: {} }))

import { buildTopicEvidence, mapMasteryStatus, accuracyOf, MIN_EVIDENCE_QUESTIONS, STRONG_THRESHOLD, DEVELOPING_THRESHOLD, type AttemptForEvidence, type TopicEvidence } from '@/lib/learning/mastery'

function attempt(overrides: Partial<AttemptForEvidence> & { id: string; answers: Record<string, number> }): AttemptForEvidence {
  return {
    startedAt: new Date('2026-01-01T10:00:00Z'),
    submittedAt: new Date('2026-01-01T10:10:00Z'),
    questionIds: Object.keys(overrides.answers),
    questions: [],
    ...overrides,
  }
}

function q(id: string, topicId: string, correctIndex: number, optionCount = 4) {
  return { id, topicId, correctIndex, optionCount }
}

describe('buildTopicEvidence — distinct questions, latest answer wins', () => {
  it('counts distinct questions once and keeps the latest outcome per question', () => {
    const attempts = [
      attempt({ id: 'a1', answers: { q1: 0, q2: 1 }, questions: [q('q1', 't1', 0), q('q2', 't1', 2)] }),
      // q2 answered again, wrongly — the latest answer must replace the hit.
      attempt({ id: 'a2', answers: { q2: 3 }, questions: [q('q2', 't1', 2)] }),
    ]
    const ev = buildTopicEvidence(attempts)
    const t1 = ev.get('t1')!
    expect(t1.outcomes.size).toBe(2) // distinct questions, not 3 answers
    expect(t1.outcomes.get('q1')).toBe(true)
    expect(t1.outcomes.get('q2')).toBe(false) // latest wins
    expect(t1.attemptCount).toBe(2)
  })

  it('re-answering correctly replaces an earlier miss (no permanent penalty, no inflation)', () => {
    const attempts = [
      attempt({ id: 'a1', answers: { q1: 3 }, questions: [q('q1', 't1', 0)] }),
      attempt({ id: 'a2', answers: { q1: 0 }, questions: [q('q1', 't1', 0)] }),
    ]
    const { accuracy } = accuracyOf(buildTopicEvidence(attempts).get('t1')!)
    expect(accuracy).toBe(100)
  })

  it('repeating the same question many times can never inflate accuracy', () => {
    const attempts = [
      attempt({ id: 'a1', answers: { q1: 0 }, questions: [q('q1', 't1', 0)] }),
      attempt({ id: 'a2', answers: { q1: 0 }, questions: [q('q1', 't1', 0)] }),
      attempt({ id: 'a3', answers: { q1: 0 }, questions: [q('q1', 't1', 0)] }),
      attempt({ id: 'a4', answers: { q1: 0 }, questions: [q('q1', 't1', 0)] }),
    ]
    const t1 = buildTopicEvidence(attempts).get('t1')!
    expect(t1.outcomes.size).toBe(1)
    expect(accuracyOf(t1).accuracy).toBe(100)
    expect(mapMasteryStatus(t1, null).status).toBe('INSUFFICIENT_EVIDENCE') // 1 question ≠ mastery
  })

  it('treats out-of-range selections as skipped (no outcome), matching the scoring engine', () => {
    const attempts = [attempt({ id: 'a1', answers: { q1: 9, q2: 1 }, questions: [q('q1', 't1', 0), q('q2', 't1', 1)] })]
    const t1 = buildTopicEvidence(attempts).get('t1')!
    expect(t1.outcomes.has('q1')).toBe(false)
    expect(t1.outcomes.get('q2')).toBe(true)
    expect(t1.latestAttemptAccuracy).toBe(100) // 1/1 answered correctly
  })

  it('tracks latest-attempt accuracy per topic for the regression rule', () => {
    const attempts = [
      attempt({ id: 'a1', answers: { q1: 0, q2: 0 }, questions: [q('q1', 't1', 0), q('q2', 't1', 1)] }),
      attempt({ id: 'a2', answers: { q1: 1, q2: 2 }, questions: [q('q1', 't1', 0), q('q2', 't1', 1)] }),
    ]
    const t1 = buildTopicEvidence(attempts).get('t1')!
    expect(t1.latestAttemptAccuracy).toBe(0) // the most recent attempt missed both
    expect(t1.lastAttemptAt).toEqual(new Date('2026-01-01T10:10:00Z'))
  })

  it('ignores questions without a catalogue topic (Riishe t: topics are out of scope)', () => {
    const attempts = [attempt({ id: 'a1', answers: { q1: 0 }, questions: [q('q1', null!, 0)] })]
    expect(buildTopicEvidence(attempts).size).toBe(0)
  })
})

describe('mapMasteryStatus — documented bands and guards', () => {
  function evidence(correct: number, distinct: number, latestAccuracy: number | null = null): TopicEvidence {
    const outcomes = new Map<string, boolean>()
    for (let i = 0; i < correct; i++) outcomes.set(`c${i}`, true)
    for (let i = 0; i < distinct - correct; i++) outcomes.set(`w${i}`, false)
    return { topicId: 't1', attemptCount: 1, outcomes, latestAttemptAccuracy: latestAccuracy, lastAttemptAt: new Date() }
  }

  it('INSUFFICIENT_EVIDENCE below the minimum question count (small-sample guard)', () => {
    const { status } = mapMasteryStatus(evidence(4, 4), null)
    expect(status).toBe('INSUFFICIENT_EVIDENCE')
    expect(MIN_EVIDENCE_QUESTIONS).toBe(5)
  })

  it('LEARNING band below 60% with sufficient evidence', () => {
    expect(mapMasteryStatus(evidence(3, 8), null).status).toBe('LEARNING')
  })

  it('DEVELOPING band at 60-79%', () => {
    expect(mapMasteryStatus(evidence(5, 8), null).status).toBe('DEVELOPING')
    expect(DEVELOPING_THRESHOLD).toBe(60)
  })

  it('STRONG band at 80%+', () => {
    expect(mapMasteryStatus(evidence(7, 8), null).status).toBe('STRONG')
    expect(STRONG_THRESHOLD).toBe(80)
  })

  it('NEEDS_REVISION when a banded topic collapses in its most recent attempt', () => {
    const { status, statusReason } = mapMasteryStatus(evidence(7, 8, 40), 'STRONG')
    expect(status).toBe('NEEDS_REVISION')
    expect(statusReason).toContain('40%')
  })

  it('NEEDS_REVISION also applies from DEVELOPING, but never from INSUFFICIENT_EVIDENCE', () => {
    expect(mapMasteryStatus(evidence(5, 8, 50), 'DEVELOPING').status).toBe('NEEDS_REVISION')
    expect(mapMasteryStatus(evidence(3, 6, 20), 'INSUFFICIENT_EVIDENCE').status).toBe('LEARNING')
  })

  it('a fresh LEARNING topic is not flagged NEEDS_REVISION by a bad first attempt', () => {
    expect(mapMasteryStatus(evidence(2, 6, 0), null).status).toBe('LEARNING')
  })

  it('a good recent attempt does not regress a STRONG topic', () => {
    expect(mapMasteryStatus(evidence(7, 8, 90), 'STRONG').status).toBe('STRONG')
  })
})
