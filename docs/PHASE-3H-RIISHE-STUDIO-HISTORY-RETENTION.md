# Phase 3H — Riishe Studio History & Retention Intelligence

**Base:** `origin/main` `3534f41451c2ed0eccb5f92a665b5c7db27f4435` (verified via `git ls-remote` before the first commit)
**Branch:** `feat/bean-riishe-phase3h-history-retention`
**Ledger id:** `phase3h-studio-history-retention`

---

## 1. Scope decision (roadmap evidence)

The repository documents no explicit Phase 3H spec. Following the Phase 3G precedent (scope taken from a
documented next step), this milestone implements the two Phase 3F §11 limitations that name its territory
verbatim:

> **2. History is bounded** (most recent 50 for the list + evidence roll-up). Older records remain queryable
> by id but are not summarised in the strip.
>
> **3. Deletion is manual** — no automatic retention window exists yet. The schema keeps timestamps
> (`createdAt`, `updatedAt`, `lastAccessedAt`) so a retention policy can be added later without a
> destructive migration.

(docs/PHASE-3F-RIISHE-LEARNING-CONTINUITY.md §11.2–3)

Approved scope, in three parts:

- **A — Complete Studio history discovery:** server-side cursor pagination, stable ordering with a
  deterministic tie-breaker, search (topic / document title) and kind/status filters, load-more navigation
  in the existing Studio UI, accurate history counts and evidence summaries.
- **B — User-controlled retention preferences:** an explicit, server-validated retention choice riding the
  repository's existing account settings architecture (`Student.preferencesJson` via `PATCH
  /api/student/profile`). Default keeps existing history forever; nothing is silently changed for existing
  users and nothing is deleted automatically.
- **C — Safe history cleanup:** a user-initiated cleanup workflow with preview → explicit confirmation,
  a fixed honest scope, bounded server-side batches, repeat/concurrency safety and truthful results.

Out of scope (unchanged by design): anything touching `TopicMastery`, `Attempt`, revision schedules,
mistake records or learning actions; any mastery contribution from Studio evidence; any background
scheduler or automatic deletion; graded-recall thresholds; activity lifecycle semantics.

## 2. Baseline audit (what was inspected before designing)

- `src/lib/riishe/studio-store.ts` — the Phase 3F store: `listStudioActivities(guestId, take = 50)` with a
  single `orderBy: { updatedAt: 'desc' }` (no tie-breaker), no pagination/filter/count surface;
  row-scoped `{ id, guestId }` access on every mutation; terminal lifecycle states.
- `src/app/api/riishe/studio/route.ts` + `[id]/route.ts` — `assertLearningOwner(guestId)` BEFORE any
  database read; sameOrigin on mutating verbs; zod validation; generic error bodies.
- `src/components/bean/riishe-studio.tsx` — history loaded in one shot; resume strip (≤3 in-progress);
  EvidenceStrip computed from the loaded rows only.
- `src/lib/api.ts` — `riisheStudioHistory(guestId)` client wrapper; `api.studentProfile()` /
  `api.updateStudentProfile()` for the preferences merge.
- `prisma/schema.prisma` — `RiisheStudioActivity` (indexes `[guestId, status, updatedAt]`,
  `[studentId, status]`, `[guestId, kind]`); `Student.preferencesJson` JSON preference column.
- Privacy surfaces — claim-guest stamps `studentId` (guestId kept), account export includes
  `studioActivities`, account delete + guest purge delete studio rows; all keep working unchanged.
- Phase 3F/3G docs + ledger — contracts to preserve (below) and the §11 limitations above.
- Tests — `riishe-phase3f-studio-{store,routes}.test.ts`, `riishe-phase3g-graded-recall.test.ts`,
  `learning-compat.test.ts`, the migration-test pattern, and `tests/helpers/auth-mock.ts`.

## 3. Contracts preserved (Phase 3F/3G)

- Studio evidence stays separate from exam mastery — zero code path into
  `Attempt`/`TopicMastery`/`RevisionScheduleItem`/`MistakeRecord`/`LearningAction`.
- Server-owned lifecycle: `IN_PROGRESS → COMPLETED` (idempotent) / `IN_PROGRESS → ABANDONED`; client
  never sends a status; 409 on invalid transitions; completed records reopen in review mode.
- Graded-recall thresholds, verdict semantics and the server-side recompute are untouched.
- Single-record deletion (`DELETE /api/riishe/studio/[id]`) keeps its row-scoped `{ id, guestId }`
  404-without-leak contract.
- Fail-closed ownership (`assertLearningOwner` before ANY read; 403 foreign claimant, 503 thrown session,
  guest-bearer preserved) applies to the new and extended endpoints alike.

## 4. Architecture and API contracts

### 4.1 History list — `GET /api/riishe/studio`

Query parameters (all optional, all server-validated by zod; anything invalid → `400 Invalid request`):

| Param | Type | Meaning |
|---|---|---|
| `guestId` | string 8..64 | owner scope (unchanged) |
| `cursor` | string ≤256 | opaque page cursor from the previous `nextCursor` |
| `limit` | int 1..100 | page size (default 50 — the Phase 3F bound) |
| `kind` | enum | filter by activity kind |
| `status` | enum | filter by lifecycle status |
| `search` | string ≤120 | case-insensitive substring match on topic or document title |

Response (additive over Phase 3F): `{ items, evidence, nextCursor, totalMatching }`

- `items` — ONE page of `StudioHistoryItemDTO`.
- `nextCursor` — opaque cursor for the next page, `null` on the last page.
- `totalMatching` — EXACT SQL count of the owner's records matching the current filters.
- `evidence` — whole-history roll-up (below).

The browser never receives the whole history; each page is fetched from the server by cursor.

### 4.2 Pagination and ordering

- Ordering is `[(updatedAt desc), (id desc)]` — deterministic even when timestamps collide.
- The cursor is base64url JSON `{ u: updatedAtISO, i: id }`, validated on decode (shape, ISO datetime,
  id length); a hostile cursor can never inject query fragments (400).
- Continuation condition: rows with `updatedAt < u`, plus rows with `updatedAt == u` and
  `id < i` — the exact remainder of the composite ordering. A deleted cursor row is harmless: the cursor
  pins a position, not a live row.
- Next-page detection fetches `limit + 1` rows and drops the extra — no full-history scan.

### 4.3 Evidence summary — accurate, bounded, honest

Phase 3F computed the evidence strip from the ≤50 loaded rows. Phase 3H makes it describe the WHOLE
history:

- `total`, `inProgress`, `completed`, `abandoned` — exact SQL `count` per status (always exact).
- `miniTestsCompleted`, `miniTestPercentAvg`, `cardsReviewed`, `cardsRecalled` — computed server-side from
  a bounded scan (`EVIDENCE_SCAN_CAP = 200`) of the most recent result-carrying mini-test/flashcard rows,
  selecting only `status/kind/resultJson`. The rows never leave the server.
- `truncated` (new optional field) — `true` when result-carrying rows exist beyond the scan cap; the UI
  then says the practice aggregates reflect the most recent records.
- The evidence summary always describes the unfiltered whole history — filtering the list never redefines
  "Studio practice so far".

### 4.4 Retention preference — `PATCH /api/student/profile` (existing settings architecture)

`preferences.studioRetentionDays` — one of `30 | 90 | 180 | 365 | null`.

- Server-validated by the profile PATCH zod schema (added key); `null` clears the key.
- Stored in `Student.preferencesJson` via the established merge semantics (unrelated keys preserved) —
  **no migration**.
- Default (key absent) = keep history forever. Existing users' behavior is untouched — the preference
  never deletes anything by itself; it feeds only the explicit cleanup workflow.
- Why the account-bound setting only: the existing settings architecture (`Student.preferencesJson`) is
  signed-in-only. Guests have no durable server-side identity, and binding an ongoing deletion policy to a
  bearer guestId would hand destructive power to whoever holds the token. Guests therefore get the same
  cleanup tool (per-use, preview + confirm) without a stored policy — the smallest safe additive design,
  documented here per the approved-scope escape clause.
- Scope note: after guest claiming, studio rows keep their original guestId (the same ownership model as
  every learning surface). The cleanup therefore always acts on the current device's learning profile
  (guestId scope) — the preview shows exactly how many records of that scope match before anything is
  deleted.

### 4.5 Cleanup — `POST /api/riishe/studio/cleanup`

Body: `{ guestId, olderThanDays: 30|90|180|365, confirm?: 'CLEANUP' }`

- Without `confirm` (or with anything else) → **preview only**:
  `{ preview: true, olderThanDays, cutoff, affected, scopeNote, batchMax }` — `affected` is the exact
  count of records the confirmed cleanup would remove; `cutoff` is the ISO timestamp actually used.
  No deletion path runs.
- With `confirm: 'CLEANUP'` → **confirmed cleanup**:
  `{ ok: true, deleted, remaining, olderThanDays, cutoff, scopeNote, batchMax }`.
- Fixed scope (stated in every preview): rows owned by THIS guestId, status `COMPLETED` or `ABANDONED`,
  `updatedAt` strictly before the cutoff. `IN_PROGRESS` is NEVER cleaned up. No other user's records can
  ever match.
- Bounded operation: at most `CLEANUP_BATCH_MAX = 500` rows per request. The batch ids are selected first
  (small columns), and the `deleteMany` RE-ASSERTS the full scope (id list AND guestId AND status AND
  cutoff) in its WHERE clause — neither a repeated request nor a concurrent request can delete out-of-scope
  rows, and every row is deleted at most once. `remaining` reports what is left; repeating drains the
  scope deliberately instead of one unbounded bulk delete.
- Truthful results: a failed delete surfaces as an error response; the store never returns a success with
  guessed counts. A thrown session lookup fails closed with 503.
- Guards: sameOrigin (403), `assertLearningOwner` before any read (403/503), zod validation (400),
  in-memory rate limit 6/10min per owner (429) — the same stack as every mutating Studio route.
- No scheduler, no cron, no automatic enforcement anywhere. The default remains preservation.

## 5. UI changes (existing Riishe Studio dialog only)

- **Search + filters** row above the history list: debounced (300ms) search input, activity-type select,
  status select. Server-side; the dialog never loads the whole history.
- **Accurate counts line**: "Showing X of Y activities" (with a `clear` affordance when filters are
  active), `aria-live="polite"`.
- **Load more**: `Show older activities (N more)` button fed by `nextCursor`; pages APPEND to the visible
  list; in-flight responses can never interleave (the fetch effect drops stale answers); distinct
  loading, empty (no history at all), no-match (filters active) and error/retry states for both the first
  page and subsequent pages.
- **Keep & clean up panel**: the effective retention policy is always visible ("Your Studio history is
  kept until you delete it…"); signed-in students get a retention select persisted via the existing
  profile PATCH (Keep forever default); everyone gets the cleanup button opening a preview dialog with
  cutoff, exact affected count, the fixed scope note, batch guidance for large scopes, an explicit
  destructive button labelled with the count, and a truthful deleted/remaining result. Guests see the
  same cleanup tool with keep-forever semantics and a sign-in note for preferences.
- Existing generation, concept maps, steps, formula walkthroughs, flashcards, mini-tests, resume, review,
  self-marked recall, graded recall, multilingual and responsive behaviors are untouched.

## 6. Ownership, privacy and security

- `assertLearningOwner(guestId)` runs BEFORE any database read on the extended GET, on cleanup, and on
  every pre-existing endpoint (verified by tests that assert zero `riisheStudioActivity` calls on 403).
- Row access stays scoped by `guestId`; unknown and foreign ids are indistinguishable (404, no existence
  leak). The cleanup scope can never match another owner's rows (asserted by tests with foreign rows
  present).
- All mutations are sameOrigin-guarded (403 `Cross-origin request blocked`).
- Claim / export / deletion / purge surfaces are untouched: claim-guest stamps `studentId` exactly as
  before; account export keeps exporting studio activities; account deletion and guest purge keep removing
  studio rows. The retention preference is account-level JSON inside `preferencesJson`, so it is exported
  with the student profile (`preferences`) and removed with the account — no new privacy surface is
  introduced.
- Error responses carry only generic text — no activity data, counts of other users, or scope details leak.

## 7. Database and migration policy

**No migration is required.** The retention preference lives in the existing `Student.preferencesJson`
column; pagination, filters and cleanup use existing columns and the existing
`RiisheStudioActivity_guestId_status_updatedAt_idx` index. Verified with a real-Prisma drift check on an
isolated migrated database: `prisma migrate diff --from-url <temp> --to-schema-datamodel prisma/schema.prisma
--exit-code` → "No difference detected." No `db push --accept-data-loss`, no destructive statements, no
default retention that deletes anything.

Search semantics note (verified against a real migrated SQLite database): Prisma `contains` on SQLite is
case-insensitive for ASCII characters — the tests' evaluator mirrors this behavior.

## 8. Tests (all executed — see §9 for results)

New file `tests/unit/riishe-phase3h-studio-history.test.ts` (31 tests) with a recursive Prisma-where
evaluator fake exercising the exact condition shapes the store emits:

- History: first page (50, exact `totalMatching`, `nextCursor`), a full 70-record walk (no overlap/dup),
  same-`updatedAt` tie-break by id desc across a page boundary, invalid cursor / oversized limit / unknown
  kind → 400, empty history, guest scoping.
- Search/filters: topic + document-title case-insensitive match, kind/status/combined filters, filters
  composed with cursor pagination, filtered counts.
- Evidence: exact status counts beyond the page (62 records, page of 10), bounded per-kind aggregates with
  truthful `truncated` (210 result rows → 200 scanned), evidence describes the whole history under filters.
- Retention: set + clear (merge preserves other keys), invalid values → 400, guests 401, cross-origin 403,
  existing users without the key keep keep-forever.
- Cleanup: preview exactness (mixed statuses/ages/owners), exclusive cutoff boundary, invalid days → 400
  before any read, absent confirm → preview only, confirmed scope discipline (foreign rows + in-progress
  + fresh rows survive), repeated requests drain to zero, 505-record scope bounded to 500+5 with honest
  `remaining`, concurrent confirms cannot over-delete, delete re-asserts scope, failed delete → truthful
  500 with nothing claimed deleted, CSRF 403, foreign claimant 403 before any read, thrown session → 503,
  rate limit 429.
- Compatibility: single-record deletion keeps its 404-no-leak contract.

Existing tests updated in lock-step ONLY where the store's query surface legitimately changed:
`riishe-phase3f-studio-routes.test.ts` and `riishe-phase3f-studio-store.test.ts` fakes gained a `count`
method and composite-`orderBy` sort support (no assertion was weakened, changed or deleted).

## 9. Verification results (this milestone, all actually executed)

- `bun test` (full suite): **1160 pass, 0 fail** (78 files; baseline 1129 at `3534f414` + 31 new).
- `bunx tsc --noEmit`: clean.
- `bun run lint` (ESLint): clean.
- `bunx prisma validate`: valid; `migrate deploy` on an isolated temp DB + `migrate diff --exit-code`:
  "No difference detected." (drift check).
- `bun run build`: completed successfully (production build; executed after freeing sandbox memory).
- Browser verification at 390/768/1280 px against a locally served build: history list, search, filters,
  load-more, counts, retention panel and cleanup preview/confirm dialog render without overflow or overlap;
  see the milestone report for the exact screenshots and console state.

## 10. Known limitations

1. **Evidence aggregates are bounded at 200 rows** (mini-test/flashcard per-kind aggregates only — status
   counts and totals are always exact). The UI states when aggregates reflect "most recent records".
2. **Case-insensitive search is ASCII-exact** (SQLite LIKE semantics) — non-ASCII casing is matched
   case-sensitively; verified and documented rather than papered over.
3. **Cleanup is scoped to the current device's learning profile (guestId)** — the same ownership scope
   every Studio endpoint uses. A student who studied under several guest profiles cleans them one at a
   time; the preview always shows the exact count for the scope being acted on.
4. **No automatic enforcement.** The retention preference does not delete anything by itself; cleanup runs
   only when a user confirms it. A future opt-in automatic policy would need its own explicit milestone.
5. **`updatedAt` is the retention clock** — interacting with an activity refreshes it, so actively-used
   records stay young. This is the same timestamp the history ordering uses, keeping one consistent story.
6. Guests cannot store a retention preference (no durable server-side identity to bind it to); they retain
   full per-use cleanup with preview and confirmation.
