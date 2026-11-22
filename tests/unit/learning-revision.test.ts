import { describe, it, expect, mock } from 'bun:test'

// ─── Spaced revision ladder (Phase 3B, pure) ──────────────────────────────────
// Documented rules: 1→3→7→14→30→60 days on success, half-interval rebound on
// partial, full reset on failure, misconception pull-in capped at +1 day.

mock.module('@/lib/db', () => ({ db: {} }))

import { nextSchedule, outcomeFromAccuracy, dueStateOf, REVISION_LADDER } from '@/lib/learning/revision'

const NOW = new Date('2026-03-10T12:00:00Z')
const DAY = 24 * 3600_000

describe('outcomeFromAccuracy', () => {
  it('maps the documented thresholds', () => {
    expect(outcomeFromAccuracy(80)).toBe('SUCCESS')
    expect(outcomeFromAccuracy(95)).toBe('SUCCESS')
    expect(outcomeFromAccuracy(60)).toBe('PARTIAL')
    expect(outcomeFromAccuracy(79)).toBe('PARTIAL')
    expect(outcomeFromAccuracy(59)).toBe('FAILURE')
    expect(outcomeFromAccuracy(0)).toBe('FAILURE')
  })
})

describe('nextSchedule — the documented ladder', () => {
  it('walks up the ladder on successive successes', () => {
    // A freshly created schedule row starts at interval 1 / repetitions 0;
    // the first SUCCESS moves it to ladder[1] = 3 (ladder[min(rep, 5)]).
    let state = { intervalDays: 1, repetitions: 0, lapses: 0 }
    for (const expected of [3, 7, 14, 30, 60]) {
      const next = nextSchedule(state, 'SUCCESS', NOW)
      expect(next.intervalDays).toBe(expected)
      expect(next.nextDueAt.getTime()).toBe(NOW.getTime() + expected * DAY)
      state = { intervalDays: next.intervalDays, repetitions: next.repetitions, lapses: next.lapses }
    }
    // Capped at the last rung.
    const capped = nextSchedule(state, 'SUCCESS', NOW)
    expect(capped.intervalDays).toBe(60)
    expect(REVISION_LADDER[REVISION_LADDER.length - 1]).toBe(60)
  })

  it('PARTIAL keeps the interval but revisits sooner (max(2, ceil(interval/2)))', () => {
    const next = nextSchedule({ intervalDays: 7, repetitions: 2, lapses: 0 }, 'PARTIAL', NOW)
    expect(next.intervalDays).toBe(7)
    expect(next.repetitions).toBe(2)
    expect(next.nextDueAt.getTime()).toBe(NOW.getTime() + 4 * DAY)
    // Very short intervals still wait at least 2 days.
    const next2 = nextSchedule({ intervalDays: 1, repetitions: 0, lapses: 0 }, 'PARTIAL', NOW)
    expect(next2.nextDueAt.getTime()).toBe(NOW.getTime() + 2 * DAY)
  })

  it('FAILURE resets to the start of the ladder and counts a lapse', () => {
    const next = nextSchedule({ intervalDays: 30, repetitions: 4, lapses: 1 }, 'FAILURE', NOW)
    expect(next.intervalDays).toBe(1)
    expect(next.repetitions).toBe(0)
    expect(next.lapses).toBe(2)
    expect(next.nextDueAt.getTime()).toBe(NOW.getTime() + DAY)
  })
})

describe('dueStateOf — honest due classification', () => {
  it('marks overdue, due-today and upcoming relative to server-local today', () => {
    const yesterday = new Date(NOW.getTime() - DAY)
    const tomorrow = new Date(NOW.getTime() + DAY)
    const item = (nextDueAt: Date) => ({
      topicId: 't1',
      topicName: 'T',
      examLabel: null,
      intervalDays: 1,
      repetitions: 0,
      lapses: 0,
      lastOutcome: null,
      lastReviewedAt: null,
      nextDueAt,
      misconceptionFlag: false,
    })
    expect(dueStateOf(item(yesterday), NOW).dueState).toBe('OVERDUE')
    expect(dueStateOf(item(NOW), NOW).dueState).toBe('DUE_TODAY')
    expect(dueStateOf(item(tomorrow), NOW).dueState).toBe('UPCOMING')
    expect(dueStateOf(item(tomorrow), NOW).daysUntilDue).toBeGreaterThanOrEqual(0)
  })
})
