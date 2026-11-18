# Phase 5 — Live classroom: verification results

Every number below comes from a command actually executed on the feature branch (`feat/bean-live-classroom-phase-5`) during this milestone. Nothing is claimed that was not run.

## Automated tests

`bun test` (executed 2026-11-18, final tree):

```
238 pass
0 fail
566 expect() calls
Ran 238 tests across 22 files.
```

- 158 pre-existing Phase 2A/2B/4A tests — all still passing (regression intact, including the concurrent last-seat suite and the real-SQLite seat-claim suite).
- 80 new Phase 5 tests across 7 suites:

| Suite | Tests | Proves |
|---|---|---|
| `live-usage.test.ts` | 10 | The shipped reserve/reconcile/release SQL against REAL in-memory SQLite: no oversubscription under serialised concurrency, no negative reservations, used-minutes never double-counted, month rollover isolation, budget-config upsert |
| `live-start-route.test.ts` | 16 | Guest/pending/other-teacher refusal; role from server only; opaque room names (`^bean-live-[0-9a-f]{32}$`); duplicate start safe (one room, one reservation); draft/cancelled/out-of-window/no-bookings refusals; 429 on exhausted allowance (no room created); failed room creation releases the reservation; FAILED retry reuses the row; ENDED never restarts |
| `live-token-route.test.ts` | 12 | Guests 401; unbooked/cancelled 403; role-specific grants (STUDENT = camera+microphone only, TEACHER adds screen_share); opaque `bean:<id>` identity (never email); not-live/out-of-window 409; draft 404; API secret absent from every response; 503 when unconfigured (no fake classroom) |
| `live-end-route.test.ts` | 5 | Owner-only ending; open intervals closed conservatively; actual usage computed and reconciled exactly once; duplicate end a no-op (no second reconcile/delete); student/foreign-teacher refusal |
| `live-webhook-route.test.ts` | 12 | REAL signature verification (signed AccessToken + sha256 body binding, Bearer and raw forms); tampered body rejected; missing header rejected; duplicate event id ignored; duplicate join/left no-ops; reconnection accumulates + counts; out-of-order clamps; room_finished finalises exactly once; unknown room SKIPPED without mutating other sessions; foreign identity shapes dropped |
| `live-whiteboard-route.test.ts` | 10 | Teacher-only writes (student 403); participant reads; late-join restore; invalid payload / out-of-palette colour / out-of-range coordinates / oversized snapshot all rejected; save only while LIVE |
| `live-attendance-evidence.test.ts` | 15 | Interval idempotency; clamped (never negative) durations; reconnect counting; effective connected time; the documented 60% suggestion threshold; evidence mapped per enrolled booking (foreign students never appear); window + identity rules |

## Static checks (all executed on the final tree)

- `bunx tsc --noEmit` — clean (0 errors).
- `bun run lint` — clean (0 errors, 0 warnings).
- `bun run db:status` — `6 migrations found … Database schema is up to date!` (the additive migration `20261118040000_phase5_live_classroom` was applied to the dev DB via `prisma db push` and baselined with `prisma migrate resolve --applied`; row counts verified before/after — data preserved).
- Secrets scan over the staged diff — no credentials; `.env.example` contains placeholders only; `.env*` remains gitignored with `!.env.example`.

## Browser E2E (agent-browser, real dev server on port 3000)

Executed flows, all against the real app + real SQLite:

- **Guest:** home loads clean; `#/classes` marketplace renders (filters, tabs); class detail renders; `#/classroom/:id` shows the sign-in gate ("Guests can browse classes freely, but a live classroom requires a signed-in account with a confirmed reservation").
- **Teacher journey:** account created → onboarding completed → teacher application submitted via `#/teach/apply` (PENDING "Under review").
- **Admin journey:** second account created; ADMIN granted via the operator CLI (`scripts/grant-role.ts` — the only sanctioned path); after session refresh, `#/teach/review` lists the pending application; approved via the UI ("Teacher approved — profile is now public").
- **Class journey:** teacher dashboard → Create class dialog → draft saved (validation caught a missing schedule and surfaced "Pick a date and time for the class." honestly) → explicit Publish → class appears under "Upcoming published classes" with the live-state control.
- **Student journey:** account created → class found in the marketplace → free seat reserved ("Your seat is reserved") → My Bookings shows the booking with the "Scheduled" live badge → `#/classroom/:id` shows the honest gate.
- **Honest unconfigured state:** with no LiveKit credentials in this sandbox, the classroom gate renders "Live classroom not configured yet — BEAN operators still need to add LiveKit credentials — this class runs as scheduled and nothing is recorded." The teacher dashboard badge explains "Live rooms need LiveKit credentials". No fake video surfaces anywhere.
- **Server guards:** unauthenticated `POST …/live/start` → 401. The status endpoint re-derives everything from the session cookie.
- **Regressions:** dashboard renders; Settings renders including the On-device AI card (WebGPU detection honest message); Riishe view loads; footer sticks to the viewport bottom on short pages (`footerBottom == viewportHeight == 800`) and is pushed naturally on long pages (Riishe `docH 1190 > viewport 800`); mobile 390×844 viewport renders marketplace and class detail correctly; no page errors / console errors on any visited view.

Two real defects were found by the browser run and fixed during the milestone:
1. `live/status` and `live/attendance` mixed `select` + `include` on the nested `liveSession` relation → `PrismaClientValidationError` (Prisma 6 forbids the combination). Both rewritten with pure `select`; endpoint then returned 200 with the full safe status payload.
2. A stale dev-server process predated the schema change (missing `liveClassSession` client model) — restarted; the API group then worked end to end.

## Explicitly NOT verified in this sandbox (honest gaps)

- **Live media transport**: no LiveKit Cloud credentials exist here, so no real room was started; camera/microphone/screen-share flows inside a live room, live whiteboard data-channel sync and raise-hand could not be exercised in a browser. The pieces around them (authorisation, tokens' grant matrix, lifecycle, budget, whiteboard protocol validation, persistence) are covered by the automated suites above using the real SDK verification code and real SQL.
- **Provider webhook deliveries**: signature verification is proven with real signed tokens in tests; end-to-end delivery from LiveKit Cloud requires the owner's registered webhook (see `docs/PHASE5_LIVEKIT_SETUP.md`).
- **Production build**: this sandbox forbids running `next build` (dev server only on port 3000); build status is "not run here" — `tsc --noEmit` + ESLint are the executed static gates.
