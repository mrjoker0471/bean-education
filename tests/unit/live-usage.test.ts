// ─── BEAN Live Classroom (Phase 5): usage-budget SQL against REAL SQLite ──────
// Proves the production accounting statements (the exact strings shipped in
// src/lib/livekit/usage.ts) against a real in-memory SQLite engine:
//   • the conditional reserve can never oversubscribe — concurrent starts are
//     serialised by SQLite and the loser matches zero rows
//   • reconciliation releases the reservation and records verified usage once
//   • the reserved amount can never go negative (MAX floor)
//   • month rollover: separate rows, separate allowances

import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { USAGE_MONTH_UPSERT_SQL, USAGE_RELEASE_SQL, USAGE_RESERVE_SQL, USAGE_RECONCILE_SQL, estimateParticipantMinutes, usageMonthKey } from '@/lib/livekit/usage'

let db: Database
const NOW = Date.now()

beforeEach(() => {
  db = new Database(':memory:')
  db.run(`CREATE TABLE "LiveUsageMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "monthKey" TEXT NOT NULL UNIQUE,
    "budgetParticipantMinutes" INTEGER NOT NULL,
    "reservedParticipantMinutes" INTEGER NOT NULL DEFAULT 0,
    "usedParticipantMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
  );`)
})

function row(monthKey: string) {
  return db.query(
    `SELECT "budgetParticipantMinutes" as budget, "reservedParticipantMinutes" as reserved, "usedParticipantMinutes" as used FROM "LiveUsageMonth" WHERE "monthKey" = ?`,
  ).get(monthKey) as { budget: number; reserved: number; used: number } | null
}

function ensureMonth(monthKey: string, budget = 4000) {
  // Param order matches production: (monthKey, budget, now, now)
  db.run(USAGE_MONTH_UPSERT_SQL, [monthKey, budget, NOW, NOW])
}

function reserve(monthKey: string, minutes: number, _budget = 4000): number {
  // Param order matches production: (minutes, now, monthKey, minutes) — the
  // budget lives on the month ROW, so it is never a bind parameter here.
  return db.run(USAGE_RESERVE_SQL, [minutes, NOW, monthKey, minutes]).changes
}

function release(monthKey: string, minutes: number): number {
  return db.run(USAGE_RELEASE_SQL, [minutes, NOW, monthKey]).changes
}

function reconcile(monthKey: string, reserved: number, actual: number): number {
  return db.run(USAGE_RECONCILE_SQL, [reserved, actual, NOW, monthKey]).changes
}

describe('USAGE_RESERVE_SQL — atomic, non-oversubscribing reservations', () => {
  it('reserves when the allowance can cover the estimate', () => {
    ensureMonth('2026-11', 4000)
    expect(reserve('2026-11', 1200)).toBe(1)
    expect(row('2026-11')!.reserved).toBe(1200)
  })

  it('refuses a reservation beyond the budget (no partial state)', () => {
    ensureMonth('2026-11', 1000)
    expect(reserve('2026-11', 900)).toBe(1)
    expect(reserve('2026-11', 200)).toBe(0) // 900 + 200 > 1000
    expect(row('2026-11')!.reserved).toBe(900)
  })

  it('accounts for USED minutes too — spent usage is never double-counted as available', () => {
    ensureMonth('2026-11', 500)
    expect(reserve('2026-11', 400)).toBe(1)
    // Finalise: release the 400 reservation, record 400 used.
    reconcile('2026-11', 400, 400)
    expect(row('2026-11')).toEqual({ budget: 500, reserved: 0, used: 400 })
    // Only 100 truly available now.
    expect(reserve('2026-11', 200)).toBe(0)
    expect(reserve('2026-11', 100)).toBe(1)
  })

  it('concurrent room starts cannot oversubscribe the monthly quota', () => {
    ensureMonth('2026-11', 2000)
    const estimate = 900 // two racers want 1800 total — both may fit; add a third
    // Serialised writes: exactly the requests whose predicate still matches win.
    const results = [
      reserve('2026-11', estimate),
      reserve('2026-11', estimate),
      reserve('2026-11', estimate), // third cannot fit (1800 + 900 > 2000)
    ]
    expect(results).toEqual([1, 1, 0])
    expect(row('2026-11')!.reserved).toBe(1800)
  })
  it('releasing never drives the reservation negative', () => {
    ensureMonth('2026-11', 1000)
    reserve('2026-11', 300)
    release('2026-11', 500) // over-release on purpose
    expect(row('2026-11')!.reserved).toBe(0)
  })

  it('reconcile releases reservation and records verified usage exactly once per call', () => {
    ensureMonth('2026-11', 1000)
    reserve('2026-11', 800)
    reconcile('2026-11', 800, 350)
    expect(row('2026-11')).toEqual({ budget: 1000, reserved: 0, used: 350 })
    // An overtime overrun reduces availability honestly (used > released).
    reserve('2026-11', 600)
    reconcile('2026-11', 600, 700)
    expect(row('2026-11')).toEqual({ budget: 1000, reserved: 0, used: 1050 })
    expect(reserve('2026-11', 1)).toBe(0)
  })

  it('month rollover uses separate rows and separate allowances', () => {
    ensureMonth('2026-11', 100)
    ensureMonth('2026-12', 100)
    expect(reserve('2026-11', 100)).toBe(1)
    expect(reserve('2026-12', 100)).toBe(1)
    expect(reserve('2026-11', 1)).toBe(0)
    expect(reserve('2026-12', 1)).toBe(0)
    expect(row('2026-11')!.reserved).toBe(100)
    expect(row('2026-12')!.reserved).toBe(100)
  })

  it('budget config changes apply to an existing month via the upsert', () => {
    ensureMonth('2026-11', 500)
    ensureMonth('2026-11', 900) // operator raised the cap mid-month
    expect(row('2026-11')!.budget).toBe(900)
  })
})

describe('estimateParticipantMinutes + usageMonthKey', () => {
  it('estimates confirmed attendees + teacher over the full duration', () => {
    expect(estimateParticipantMinutes(12, 90)).toBe(13 * 90)
    expect(estimateParticipantMinutes(0, 60)).toBe(60)
    expect(estimateParticipantMinutes(5, 0)).toBe(0) // zero duration → zero minutes
  })

  it('formats a UTC month key', () => {
    expect(usageMonthKey(new Date(Date.UTC(2026, 10, 3)))).toBe('2026-11')
    expect(usageMonthKey(new Date(Date.UTC(2027, 0, 1)))).toBe('2027-01')
  })
})
