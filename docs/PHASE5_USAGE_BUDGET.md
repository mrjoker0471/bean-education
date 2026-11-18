# Live classroom usage budget (Phase 5)

The free-pilot protection layer for the LiveKit Cloud allowance. The goal is simple: **BEAN never starts a room it cannot pay for with its current allowance, and never oversubscribes under concurrency.**

## What the numbers are (and are not)

The configuration values below are **BEAN product safety caps** — not LiveKit provider quotas, and not claims about what LiveKit grants. LiveKit's own free-tier allowances are separate and hard-capped by the provider; BEAN deliberately stays below them with a buffer. Nothing here moves BEAN onto a paid plan or requests a credit card.

| Env var | Default | Meaning |
|---|---|---|
| `BEAN_LIVEKIT_MONTHLY_BUDGET_MINUTES` | `4000` | Monthly participant-minute allowance across ALL rooms |
| `BEAN_LIVEKIT_MAX_CONCURRENT_PARTICIPANTS` | `80` | Global ceiling on simultaneously connected participants |
| `BEAN_LIVEKIT_MAX_ROOM_PARTICIPANTS` | `51` | Per-room ceiling (room = confirmed bookings + teacher, capped here) |

All three are configurable via env; the code reads them at call time (`src/lib/livekit/config.ts`).

## Participant-minutes

`participant-minutes` = each connected participant counted per minute of connection. A class with 12 confirmed students + 1 teacher scheduled for 90 minutes reserves `(12 + 1) × 90 = 1170` participant-minutes. Verified actual usage is recorded from signed webhook evidence after the session.

## The reservation flow (teacher presses Start)

1. Validate ownership, PUBLISHED status, the scheduled window and ≥1 confirmed booking.
2. Estimate the need: `(confirmed bookings + 1) × durationMinutes` — deliberately conservative.
3. Ensure the month row exists (`LiveUsageMonth`, monthKey `"YYYY-MM"` UTC).
4. **Atomically reserve** with a single conditional SQL statement:
   ```sql
   UPDATE "LiveUsageMonth"
      SET "reservedParticipantMinutes" = "reservedParticipantMinutes" + ?
    WHERE "monthKey" = ?
      AND "reservedParticipantMinutes" + "usedParticipantMinutes" + ? <= "budgetParticipantMinutes"
   ```
   Availability is always `budget − reserved − used`. SQLite serialises writes, so two teachers pressing Start in the same instant re-evaluate the predicate against the already-incremented row — the loser matches zero rows, gets an honest 429 ("live classroom capacity has reached its current free pilot allowance…"), and NO room is created. Proven against real SQLite in `tests/unit/live-usage.test.ts`.
5. Only after the reservation succeeds is the LiveKit room created. **If room creation fails, the reservation is released immediately** and the session is marked FAILED (retry reuses the row).

## Finalisation (end of class)

- Teacher "End class" is the primary path; the provider `room_finished` webhook reconciles sessions whose room closed unexpectedly (status INTERRUPTED).
- A single-use guard (`LiveClassSession.usageFinalisedAt`, conditional transition) makes finalisation **exactly once** per session:
  1. open connection intervals are closed conservatively,
  2. verified actual participant-minutes are computed from webhook evidence,
  3. the reservation is released (`MAX(..., 0)` floor — never negative) and actual usage is added to `usedParticipantMinutes` in one statement.
- Overtime beyond the reservation is accounted honestly: `used` grows more than the released reservation, so future availability shrinks. Unused reservation time is released in full — never decremented twice, never double-counted.
- Duplicate end calls and duplicate webhooks are no-ops (guarded transition + provider-event dedupe).

## Month rollover

A reservation made in month M reconciles against month M's row (the session stores `usageMonthKey`), even if the class ends after midnight into M+1. Each month gets its own row on first touch, with the current env budget applied by the upsert — raising the cap mid-month takes effect on the running month.

## Where the numbers surface

- `GET /live/status` → `configurationStatus`: `NOT_CONFIGURED` / `AVAILABLE` / `CONFIGURED` (allowance fully reserved) / `CONNECTION_ERROR` (transient provider failure flag). No credentials, no internal values.
- 429 responses include a human explanation and the remaining allowance for the month.
- `docs/PHASE5_RESULTS.md` records the executed concurrency evidence.
