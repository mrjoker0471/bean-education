// ─── BEAN Teach (Phase 4A): atomic seat accounting ───────────────────────────
// Seat integrity is a product guarantee: capacity can NEVER be exceeded, even
// when two students race for the last seat. Prisma's query builder cannot
// compare two columns in a WHERE clause on SQLite, so the seat claim and
// release are single conditional SQL statements executed INSIDE the booking
// transaction (see src/app/api/teach/classes/[id]/book/route.ts).
//
// Why a conditional update instead of "count, then insert":
//   UPDATE ... WHERE bookedCount < capacity — SQLite serialises writes, so the
//   second racer re-evaluates the predicate against the ALREADY incremented
//   row and matches zero rows. The loser never creates a booking; the winner
//   is unique. The same statement re-checks status/schedule so a class that
//   was just cancelled, unpublished or started can no longer hand out seats.
//
// IMPORTANT: Prisma 6 stores SQLite DateTime columns as INTEGER milliseconds
// since the epoch (NOT ISO text). The `startsAt` / `updatedAt` guards below
// therefore bind epoch-millisecond numbers — binding an ISO string would make
// the comparison silently false (numbers always sort before text in SQLite).
//
// The constants below are exported so tests execute the EXACT production SQL
// (tests/unit/teach-seat-sql.test.ts) against a real in-memory SQLite engine.

/**
 * Atomically claim one seat. Params (bound, in order):
 *   1. now (epoch millis) → used for updatedAt and the "startsAt must be future" guard
 *   2. classId
 * Returns 1 when a seat was claimed, 0 when the class is not PUBLISHED, has
 * already started, or bookedCount has reached capacity.
 */
export const SEAT_CLAIM_SQL =
  `UPDATE "ClassSession" SET "bookedCount" = "bookedCount" + 1, "updatedAt" = ? ` +
  `WHERE "id" = ? AND "status" = 'PUBLISHED' AND "startsAt" > ? AND "bookedCount" < "capacity"`

/**
 * Atomically release one seat (booking cancellation). Params (bound, in order):
 *   1. now (epoch millis)
 *   2. classId
 * The MAX() floor keeps bookedCount non-negative even if a stray manual edit
 * ever desynchronised it; the WHERE bookedCount > 0 guard makes double-release
 * a no-op instead of a negative count.
 */
export const SEAT_RELEASE_SQL =
  `UPDATE "ClassSession" SET "bookedCount" = MAX("bookedCount" - 1, 0), "updatedAt" = ? ` +
  `WHERE "id" = ? AND "bookedCount" > 0`
