// ─── BEAN Teach (Phase 4A): seat-claim SQL verified against REAL SQLite ──────
// The route-level tests prove the transaction logic; this file proves the
// production SQL statement itself (SEAT_CLAIM_SQL / SEAT_RELEASE_SQL are the
// exact strings shipped in src/lib/teach-booking.ts) against a real in-memory
// SQLite engine (bun:sqlite). This is the ultimate concurrency guarantee:
// the conditional UPDATE ... WHERE bookedCount < capacity can only ever take
// capacity seats, no matter how many racers fire it.

import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { SEAT_CLAIM_SQL, SEAT_RELEASE_SQL } from '@/lib/teach-booking'

let db: Database

// Prisma stores SQLite DateTime as epoch-millis integers — the tests use the same representation.
const FUTURE = Date.now() + 7 * 24 * 3600_000
const NOW = Date.now()
const PAST = Date.now() - 3600_000

// Table definition mirrors the shipped migration (table name + column names).
beforeEach(() => {
  db = new Database(':memory:')
  db.run(`CREATE TABLE "ClassSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
  );`)
})

function insertClass(id: string, status: string, startsAt: string, capacity: number, bookedCount = 0) {
  db.run(`INSERT INTO "ClassSession" ("id", "status", "startsAt", "capacity", "bookedCount", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`, [id, status, startsAt, capacity, bookedCount, NOW])
}

function bookedCount(id: string): number {
  const row = db.query(`SELECT "bookedCount" FROM "ClassSession" WHERE "id" = ?`).get(id) as { bookedCount: number } | null
  return row?.bookedCount ?? -1
}

function runClaim(classId: string, now = NOW): number {
  // Param order matches the production call: (updatedAt, id, startsAtGuard).
  return db.run(SEAT_CLAIM_SQL, [now, classId, now]).changes
}

function runRelease(classId: string, now = NOW): number {
  return db.run(SEAT_RELEASE_SQL, [now, classId]).changes
}

describe('SEAT_CLAIM_SQL — real SQLite concurrency semantics', () => {
  it('claims a seat on a published future class with room left', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 3)
    expect(runClaim('c1')).toBe(1)
    expect(bookedCount('c1')).toBe(1)
  })

  it('refuses to claim beyond capacity — the last-seat race has exactly one winner', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 1)
    const first = runClaim('c1')
    const second = runClaim('c1') // the racing request, evaluated AFTER the winner
    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(bookedCount('c1')).toBe(1) // NEVER 2
  })

  it('sequential claims fill up to capacity and then stop', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 3)
    expect(runClaim('c1')).toBe(1)
    expect(runClaim('c1')).toBe(1)
    expect(runClaim('c1')).toBe(1)
    expect(runClaim('c1')).toBe(0)
    expect(bookedCount('c1')).toBe(3)
  })

  it('refuses to claim on a DRAFT class', () => {
    insertClass('c1', 'DRAFT', FUTURE, 5)
    expect(runClaim('c1')).toBe(0)
    expect(bookedCount('c1')).toBe(0)
  })

  it('refuses to claim on a CANCELLED class', () => {
    insertClass('c1', 'CANCELLED', FUTURE, 5)
    expect(runClaim('c1')).toBe(0)
  })

  it('refuses to claim after the class has started', () => {
    insertClass('c1', 'PUBLISHED', PAST, 5)
    expect(runClaim('c1')).toBe(0)
    expect(bookedCount('c1')).toBe(0)
  })

  it('refuses to claim a class that does not exist', () => {
    expect(runClaim('ghost')).toBe(0)
  })
})

describe('SEAT_RELEASE_SQL — release never corrupts counts', () => {
  it('releases a claimed seat', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 2, 1)
    expect(runRelease('c1')).toBe(1)
    expect(bookedCount('c1')).toBe(0)
  })

  it('a second release is a no-op (never negative)', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 2, 1)
    runRelease('c1')
    expect(runRelease('c1')).toBe(0)
    expect(bookedCount('c1')).toBe(0)
  })

  it('release then re-claim works — cancelled seats become bookable again', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 1)
    runClaim('c1')
    runRelease('c1')
    expect(runClaim('c1')).toBe(1)
    expect(bookedCount('c1')).toBe(1)
  })
})

describe('full cycle — claim/cancel/re-claim on a single-seat class', () => {
  it('student A books, cancels, student B books — all within capacity', () => {
    insertClass('c1', 'PUBLISHED', FUTURE, 1)
    expect(runClaim('c1')).toBe(1) // A books
    expect(runRelease('c1')).toBe(1) // A cancels
    expect(runClaim('c1')).toBe(1) // B books the freed seat
    expect(runClaim('c1')).toBe(0) // C is refused — capacity holds
    expect(bookedCount('c1')).toBe(1)
  })
})
