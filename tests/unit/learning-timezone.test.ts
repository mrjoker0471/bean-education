import { describe, it, expect } from 'bun:test'

// ─── Timezone correctness (Phase 3B release review) ───────────────────────────
// Day-keyed planning/revision state must be computed in an EXPLICIT learner
// timezone — never the accidental host/container zone. The documented product
// default is Asia/Kolkata (fixed +05:30, no DST). These tests pin the
// midnight and timezone boundaries: a day must begin and end at LOCAL
// midnight, so daily plans and overdue revision status never flip at the
// wrong hour (e.g. UTC midnight = 05:30 IST next morning).

import { PRODUCT_TIMEZONE, resolveLearnerTimezone, dateKeyOf, dateKeyStart, dateKeyEnd, shiftDateKey } from '@/lib/learning/scope'
import { dueStateOf, type RevisionItemLike } from '@/lib/learning/revision'

const IST = 'Asia/Kolkata'

function item(due: Date): RevisionItemLike {
  return {
    topicId: 't1',
    topicName: 'Topic',
    examLabel: null,
    intervalDays: 3,
    repetitions: 1,
    lapses: 0,
    lastOutcome: 'SUCCESS',
    lastReviewedAt: new Date(due.getTime() - 3 * 24 * 3600_000),
    nextDueAt: due,
    misconceptionFlag: false,
  }
}

describe('resolveLearnerTimezone — untrusted input falls back to the product default', () => {
  it('product default is Asia/Kolkata (documented, DST-free)', () => {
    expect(PRODUCT_TIMEZONE).toBe('Asia/Kolkata')
  })

  it('accepts real IANA zone ids', () => {
    expect(resolveLearnerTimezone('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(resolveLearnerTimezone('America/New_York')).toBe('America/New_York')
    expect(resolveLearnerTimezone('UTC')).toBe('UTC')
    expect(resolveLearnerTimezone('Europe/Berlin')).toBe('Europe/Berlin')
  })

  it('falls back on missing, malformed or unknown values (no path smuggling)', () => {
    expect(resolveLearnerTimezone(undefined)).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone(null)).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone('')).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone('../../etc/passwd')).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone('Not/AZone')).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone('Asia/Kolkata; drop table x')).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone('A'.repeat(200))).toBe(PRODUCT_TIMEZONE)
    expect(resolveLearnerTimezone('Asia/Kolkata Asia/Kolkata')).toBe(PRODUCT_TIMEZONE)
  })
})

describe('dateKeyOf — the IST day flips exactly at 00:00 IST (18:30 UTC)', () => {
  it('23:59:59.999 IST is still the old day', () => {
    expect(dateKeyOf(new Date('2026-01-15T18:29:59.999Z'), IST)).toBe('2026-01-15')
  })

  it('00:00:00.000 IST is already the new day', () => {
    expect(dateKeyOf(new Date('2026-01-15T18:30:00.000Z'), IST)).toBe('2026-01-16')
    expect(dateKeyOf(new Date('2026-01-15T19:00:00.000Z'), IST)).toBe('2026-01-16')
  })

  it('in UTC the same instant still belongs to the UTC day', () => {
    expect(dateKeyOf(new Date('2026-01-15T19:00:00.000Z'), 'UTC')).toBe('2026-01-15')
  })

  it('defaults to the product timezone, not the host zone', () => {
    // 19:00Z is 00:30 IST next day — the default key must NOT depend on the
    // container's timezone (the sandbox runs UTC, where it would be the 15th).
    expect(dateKeyOf(new Date('2026-01-15T19:00:00.000Z'))).toBe('2026-01-16')
  })
})

describe('dateKeyStart / dateKeyEnd — wall-clock midnight ⇄ instant round-trips', () => {
  it('IST midnight is 18:30 UTC the previous day', () => {
    expect(dateKeyStart('2026-03-01', IST)?.toISOString()).toBe('2026-02-28T18:30:00.000Z')
    expect(dateKeyEnd('2026-03-01', IST)?.toISOString()).toBe('2026-03-01T18:30:00.000Z')
  })

  it('round-trips across zones and dates', () => {
    for (const tz of [IST, 'UTC', 'America/New_York', 'Europe/Berlin', 'Pacific/Chatham']) {
      for (const key of ['2026-01-01', '2026-03-01', '2026-07-15', '2026-12-31']) {
        const start = dateKeyStart(key, tz)
        expect(start).not.toBeNull()
        expect(dateKeyOf(start!, tz)).toBe(key)
      }
    }
  })

  it('respects DST offsets (America/New_York: −5 winter, −4 summer)', () => {
    expect(dateKeyStart('2026-01-05', 'America/New_York')?.toISOString()).toBe('2026-01-05T05:00:00.000Z')
    expect(dateKeyStart('2026-07-01', 'America/New_York')?.toISOString()).toBe('2026-07-01T04:00:00.000Z')
  })

  it('rejects malformed calendar dates', () => {
    expect(dateKeyStart('2026-02-30')).toBeNull()
    expect(dateKeyStart('2026-13-01')).toBeNull()
    expect(dateKeyStart('2026-3-1')).toBeNull()
    expect(dateKeyStart('not-a-date')).toBeNull()
  })
})

describe('shiftDateKey — pure calendar arithmetic (no 24h-day assumptions)', () => {
  it('rolls over month and year boundaries', () => {
    expect(shiftDateKey('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('handles leap years', () => {
    expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29')
    expect(shiftDateKey('2024-02-29', 1)).toBe('2024-03-01')
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01') // 2026 is not a leap year
  })
})

describe('dueStateOf — overdue status flips at LOCAL midnight, not the host midnight', () => {
  it('a revision due during the IST day of Jan 15 is OVERDUE at 00:30 IST on Jan 16', () => {
    // Due 10:00Z Jan 15 (15:30 IST). Now: 19:00Z Jan 15 = 00:30 IST Jan 16.
    const now = new Date('2026-01-15T19:00:00.000Z')
    const { dueState } = dueStateOf(item(new Date('2026-01-15T10:00:00.000Z')), now, IST)
    expect(dueState).toBe('OVERDUE')
  })

  it('the same instant in UTC still reads DUE_TODAY — the difference IS the fix', () => {
    const now = new Date('2026-01-15T19:00:00.000Z')
    const { dueState } = dueStateOf(item(new Date('2026-01-15T10:00:00.000Z')), now, 'UTC')
    expect(dueState).toBe('DUE_TODAY')
  })

  it('a revision due later in the local day is DUE_TODAY — not wrongly overdue', () => {
    // Due 03:00Z Jan 16 (08:30 IST Jan 16). Now: 19:00Z Jan 15 = 00:30 IST Jan 16.
    const now = new Date('2026-01-15T19:00:00.000Z')
    const { dueState, daysUntilDue } = dueStateOf(item(new Date('2026-01-16T03:00:00.000Z')), now, IST)
    expect(dueState).toBe('DUE_TODAY')
    expect(daysUntilDue).toBe(0)
  })

  it('in UTC at that same instant the same revision is still UPCOMING', () => {
    const now = new Date('2026-01-15T19:00:00.000Z')
    const { dueState } = dueStateOf(item(new Date('2026-01-16T03:00:00.000Z')), now, 'UTC')
    expect(dueState).toBe('UPCOMING')
  })

  it('a due date deep inside the local day is DUE_TODAY and a future one UPCOMING', () => {
    const now = new Date('2026-01-15T04:00:00.000Z') // 09:30 IST Jan 15
    expect(dueStateOf(item(new Date('2026-01-15T13:00:00.000Z')), now, IST).dueState).toBe('DUE_TODAY') // 18:30 IST
    expect(dueStateOf(item(new Date('2026-01-16T09:00:00.000Z')), now, IST).dueState).toBe('UPCOMING') // next IST day
  })

  it('reports negative day counts for overdue items', () => {
    const now = new Date('2026-01-18T10:00:00.000Z')
    const { dueState, daysUntilDue } = dueStateOf(item(new Date('2026-01-15T10:00:00.000Z')), now, IST)
    expect(dueState).toBe('OVERDUE')
    expect(daysUntilDue).toBeLessThan(0)
  })
})
