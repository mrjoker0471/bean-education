// ─── BEAN Live Classroom (Phase 5): monthly usage budget ──────────────────────
// Free-pilot protection for the LiveKit Cloud allowance. BEAN reserves an
// estimate of participant-minutes BEFORE a room starts and reconciles it
// against verified usage AFTER the room ends.
//
// Guarantee: concurrent room starts can NEVER oversubscribe the monthly
// budget. Like the Phase 4A seat engine (src/lib/teach-booking.ts), the
// reservation is a single conditional SQL statement —
//   UPDATE ... SET reserved = reserved + ? WHERE monthKey = ? AND reserved + used + ? <= budget
// — executed inside the start transaction. SQLite serialises writes, so two
// simultaneous starts each re-evaluate the predicate against the already-
// incremented row; the loser matches zero rows and the room never starts.
//
// Availability is defined as budget − reserved − used:
//   • reserved  holds conservative in-flight estimates (released on finalise)
//   • used      grows only from verified evidence (webhooks/finalisation)
// Overtime beyond a reservation reduces availability honestly (used grows more
// than the released reservation); unused reservation time is released in full.
//
// IMPORTANT (same Prisma/SQLite caveat as Phase 4A): DateTime columns are
// INTEGER epoch-milliseconds. All raw SQL binds epoch-ms numbers.

import { db } from '@/lib/db'
import { liveBudgetConfig } from './config'

/**
 * UTC month key for a point in time, e.g. "2026-11". Rollover happens
 * naturally: a reservation made in month M reconciles against month M's row
 * (usageMonthKey stored on the live session), even if the class ends in M+1.
 */
export function usageMonthKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * SQL: get-or-create the month row. Run inside the same transaction as the
 * conditional reserve so the row always exists when the reserve runs.
 */
export const USAGE_MONTH_UPSERT_SQL =
  `INSERT INTO "LiveUsageMonth" ("id","monthKey","budgetParticipantMinutes","reservedParticipantMinutes","usedParticipantMinutes","createdAt","updatedAt") ` +
  `VALUES (substr(hex(randomblob(16)),1,25), ?, ?, 0, 0, ?, ?) ` +
  `ON CONFLICT("monthKey") DO UPDATE SET "updatedAt" = excluded."updatedAt", ` +
  `"budgetParticipantMinutes" = excluded."budgetParticipantMinutes"`

/**
 * SQL: atomically reserve participant-minutes.
 * Params (bound, in order): minutes, monthKey, budgetMinutes, now(epoch ms)
 * Returns 1 when reserved, 0 when the allowance cannot safely cover it.
 * The WHERE clause re-checks the budget against the row as it is at commit
 * time — this is the anti-oversubscription guard.
 */
export const USAGE_RESERVE_SQL =
  `UPDATE "LiveUsageMonth" SET "reservedParticipantMinutes" = "reservedParticipantMinutes" + ?, "updatedAt" = ? ` +
  `WHERE "monthKey" = ? AND "reservedParticipantMinutes" + "usedParticipantMinutes" + ? <= "budgetParticipantMinutes"`

/**
 * SQL: release a reservation (failed room creation). Idempotent-style floor at
 * zero protects against desynchronisation; bounded by the session's own
 * reservation in the caller's guarded transition.
 * Params (bound, in order): minutes, monthKey, now(epoch ms)
 */
export const USAGE_RELEASE_SQL =
  `UPDATE "LiveUsageMonth" SET "reservedParticipantMinutes" = MAX("reservedParticipantMinutes" - ?, 0), "updatedAt" = ? ` +
  `WHERE "monthKey" = ?`

/**
 * SQL: reconcile a finished session — release its reservation and record
 * verified actual usage in one statement. The caller guards single-use with
 * LiveClassSession.usageFinalisedAt (conditional transition), so this runs at
 * most once per session.
 * Params (bound, in order): reservedMinutes, actualMinutes, monthKey, now(epoch ms)
 */
export const USAGE_RECONCILE_SQL =
  `UPDATE "LiveUsageMonth" SET ` +
  `"reservedParticipantMinutes" = MAX("reservedParticipantMinutes" - ?, 0), ` +
  `"usedParticipantMinutes" = "usedParticipantMinutes" + ?, ` +
  `"updatedAt" = ? ` +
  `WHERE "monthKey" = ?`

export interface UsageSnapshot {
  monthKey: string
  budgetParticipantMinutes: number
  reservedParticipantMinutes: number
  usedParticipantMinutes: number
  /** budget − reserved − used, floored at 0 for display. */
  availableParticipantMinutes: number
}

/** Read-only snapshot of a month's allowance (never negative display value). */
export async function usageSnapshot(monthKey = usageMonthKey()): Promise<UsageSnapshot> {
  const budget = liveBudgetConfig().monthlyBudgetMinutes
  const row = await db.liveUsageMonth.findUnique({ where: { monthKey } })
  const reserved = row?.reservedParticipantMinutes ?? 0
  const used = row?.usedParticipantMinutes ?? 0
  return {
    monthKey,
    budgetParticipantMinutes: row?.budgetParticipantMinutes ?? budget,
    reservedParticipantMinutes: reserved,
    usedParticipantMinutes: used,
    availableParticipantMinutes: Math.max(0, (row?.budgetParticipantMinutes ?? budget) - reserved - used),
  }
}

/**
 * Estimate the participant-minutes a room needs: every confirmed booking plus
 * the teacher, for the full scheduled duration. Deliberately conservative —
 * reconciliation releases what was not actually used.
 */
export function estimateParticipantMinutes(confirmedBookings: number, durationMinutes: number): number {
  return (Math.max(0, confirmedBookings) + 1) * Math.max(0, durationMinutes)
}

/**
 * Insufficient-budget explanation shown to the teacher (honest, actionable,
 * no fake retry promises).
 */
export function budgetRejectionMessage(snapshot: UsageSnapshot, neededMinutes: number): string {
  return (
    `Live classroom capacity has reached its current free pilot allowance. ` +
    `This class needs about ${neededMinutes} participant-minutes but only ${snapshot.availableParticipantMinutes} remain for ${snapshot.monthKey}. ` +
    `Try starting closer to the scheduled time (the reservation shrinks with confirmed attendance) or contact BEAN operators.`
  )
}
