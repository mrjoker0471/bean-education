# Phase 6 — Trust & Quality: verification results

Every number below comes from a command actually executed against the Phase 6 tree (branch `feat/bean-trust-quality-phase-6`; the same commits are present in the current working tree). Nothing is claimed that was not run.

## Automated tests

`bun test` (executed on the final tree):

```
349 pass
0 fail
1100 expect() calls
Ran 349 tests across 28 files. [688.00ms]
```

- 238 pre-existing Phase 2A/2B/4A/5 tests — all still passing (regression intact, including the real-SQLite seat-claim and usage-budget suites).
- 111 new Phase 6 tests across 6 new suites (per-suite `bun test tests/unit/<file>` runs):

| Suite | Tests | Proves |
|---|---|---|
| `trust-quality.test.ts` | 23 | The pure policy math: the review eligibility matrix (ATTENDED-after-end, cancelled/no-show/unmarked refusals, duplicate 409, foreign booking 403, DRAFT 404), quality metrics ("never fabricate a zero-star score", sample threshold 3, completionRate null-denominator, FLAGGED/HIDDEN exclusion), 7-day edit-window math, rating bounds, complaint severity derivation (sensitive → HIGH, minor-context → CRITICAL, conduct → HIGH), rate-limit thresholds |
| `free-pilot-protection.test.ts` | 9 | Static regression guards: no payment provider in package.json, no payment vars in .env.example, no payment/checkout/order/refund/wallet route paths, no payment/refund tokens in Phase 6 code (comments stripped), moderation never mutates bookings/classes, complaint actions never mutate bookings/classes/reviews, filing a complaint never creates a trust action, a negative review never suspends a teacher, no public complaint endpoints |
| `trust-review-route.test.ts` | 19 | Booking-verified creation (eligibility server-side, identity from session, teacher attribution from the class row, P2002 → 409 racing duplicate), privacy-mapped public list (PUBLISHED+FLAGGED + own-any-state, "Verified student", consent-gated displayName, author-only moderation block), author self-edit within 7 days (HIDDEN 409, window-closed 409, foreign author 403, REVIEW_EDITED audit) |
| `trust-complaint-route.test.ts` | 20 | Filing rules (server-derived severity/sensitivity, legitimate-relationship 403, platform-level only for SAFEGUARDING/HARASSMENT/OTHER, 429 cap), own-list privacy (admin notes redacted), own case file (bare 404 for non-owners), INFO_PROVIDED append, static privacy guarantees (teachers never see complaint content or status levers), admin workflow (acknowledge/review/info/note/assign/escalate/resolve/dismiss incl. no-op idempotency and mandatory notes) |
| `trust-action-route.test.ts` | 19 | ADMIN-only authorization, issuing restrictions (audited rows, optional expiry validation), REINSTATE (deactivates enforcing rows individually, records itself inactive), static enforcement wiring (create/publish/book/detail/live checks present in the Phase 4A/5 routes), `evaluateTrustState` expiry semantics (past endsAt stops biting; non-enforcing rows ignored), filing a complaint alone does not suspend a teacher |
| `trust-appeal-route.test.ts` | 21 | Filing rules per target (COMPLAINT_DECISION party + decided precondition, REVIEW_MODERATION author + HIDDEN precondition, TRUST_ACTION restricted teacher), server-captured `originalDecisionById`, duplicate open appeal 409, own-appeals privacy DTO, appeals never create payments/refunds (static), DECIDE authorization (assign-first 409, only-assigned-reviewer 403, self-review ban 403), OVERTURNED documented restorations (review → PUBLISHED + REVIEW_RESTORED; trust action → deactivated + TRUST_REINSTATE; complaint → UNDER_REVIEW re-open with original events preserved), ASSIGN validation |

## Static checks (all executed on the final tree)

- `bunx tsc --noEmit` — clean (exit 0, no errors).
- `bun run lint` — clean (exit 0, ESLint reports nothing).
- Production build: this sandbox forbids running `next build` (dev server only on port 3000); build status is "not run here" — tsc + ESLint are the executed static gates (same policy as Phase 5 results).

## Migration status

- Migration `prisma/migrations/20261119050000_phase6_trust_quality/migration.sql` ships with the milestone: 7 CREATE TABLE (`ClassReview`, `TeacherReviewResponse`, `TeachComplaint`, `ComplaintEvent`, `TrustAction`, `TeachAppeal`, `AppealEvent`), 2 unique indexes (`ClassReview_bookingId_key`, `TeacherReviewResponse_reviewId_key`) and 11 lookup indexes. Purely additive — zero columns added to existing tables, no existing index changed, no row touched.
- Applied to the runtime DB via `prisma db push` (the established workflow for this dev environment; the schema and migration were verified consistent).
- **`bun run db:status` quirk (recorded honestly)**: the script runs `prisma migrate status`, which exits code 1 reporting all 7 migrations as "not yet been applied" — even though the runtime DB contains the full Phase 6 schema (built with `prisma db push`). This is a pre-existing CLI/bookkeeping quirk of the `db push`-first workflow, not a schema problem: the API surface works end-to-end against the runtime DB, and Phase 5 previously baselined its migration the same way. Operators applying migrations fresh should use `bun run db:deploy` (documented in README quick start) rather than trusting `db:status` output in this environment.

## Browser E2E (agent-browser, real dev server on port 3000)

Executed during the milestone against the real app + real SQLite:

- **Accounts**: teacher, student and admin accounts registered through the real flows; ADMIN granted via the operator CLI (`scripts/grant-role.ts` — the only sanctioned path); teacher application approved via the Phase 4A review view.
- **Class journey**: teacher created a class and published it; the student booked a free seat; after the scheduled end, the teacher marked attendance ATTENDED.
- **Verified review via UI**: the student submitted a review through the composer — it rendered with the **"Verified student"** label; the teacher-side quality line showed **"New teacher — not enough verified reviews yet"** (sample below 3 — no fabricated zero-star score).
- **Sensitive report**: a SAFEGUARDING-category report was filed through the dialog — the exact safeguarding guidance text rendered in the composer ("…BEAN is not an emergency service.").
- **My reports**: `#/my-reports` rendered the restricted complaint with its status trail; admin notes stayed hidden from the complainant view.
- **Trust Center**: `#/admin/trust` overview counters went live (new complaint counted; open sensitive case counted; flagged-review counter incremented after the flag below).
- **PAUSE_LISTINGS**: after issuing the restriction, the teacher's class disappeared from browse (`#/classes` → 0 results for the teacher); the seat-holder still got HTTP 200 on the class detail; a guest got 404; after REINSTATE, browse discovery was restored.
- **Review moderation roundtrip**: the teacher flagged the review with a reason → the review remained publicly visible while FLAGGED → the admin decided KEEP_PUBLISHED → back to PUBLISHED, audited.
- **Appeal cycle (trust action NOTICE)**: duplicate appeal for the same target → 409; the admin who issued the NOTICE attempting to decide → 403 (self-review ban); a different non-assigned admin attempting to decide → 403 (only the assigned reviewer may decide); the assigned second admin decided OVERTURNED → the NOTICE row was deactivated in the DB (verified directly in SQLite: `isActive=false`, `endedById` set) with the TRUST_REINSTATE audit event.
- **Regressions / responsive**: mobile 390 px and desktop screenshots verified on the trust surfaces; no console errors on any visited view after the fixes applied during the run.

One real defect was found and fixed during the E2E run: the my-reports view initially fetched appeals through a mixed response shape — the API client was split into typed per-endpoint methods so `#/my-reports` loads complaints and appeals from their own endpoints (commit history: "fix(ui): phase 6 - my-reports loads appeals from its own endpoint").

## Definition of done — honest checklist

| Item | Status | Evidence |
|---|---|---|
| 7 additive tables + migration file | ✓ | migration.sql; schema.prisma Phase 6 section |
| Verified reviews (eligibility, one-per-booking, edit window) | ✓ | 19 route tests + 23 pure-rule tests |
| Review moderation (flag/hide/restore, reasons, audit) | ✓ | route tests + E2E roundtrip |
| Teacher responses (one per review, 7-day edit) | ✓ | route tests; schema unique FK |
| Quality metrics (PUBLISHED+verified only, sample gate, no zero-star fabrication) | ✓ | pure-rule tests; UI shows the not-enough-reviews line |
| Complaints (11 categories, server severity, relationship rule, append-only events) | ✓ | 20 route tests |
| Restricted sensitive handling (ADMIN-only, guidance text) | ✓ | static privacy tests; E2E sensitive filing |
| Trust actions + enforcement in class/book/publish/live routes | ✓ | 19 route tests incl. static wiring scans; E2E PAUSE_LISTINGS + live-block via EMERGENCY_STOP rows |
| Appeals (self-review ban, assigned reviewer, OVERTURNED restorations) | ✓ | 21 route tests; E2E appeal cycle incl. DB verification |
| Privacy DTOs (no identity leaks; anonymous teacher count) | ✓ | trust-dto rules + static tests |
| Free-pilot protection (no payments/refunds) | ✓ | 9 static tests pass |
| `bun test` 349/0 · `tsc` clean · `lint` clean | ✓ | executed this milestone |
| Browser E2E incl. mobile viewport | ✓ | log above |
| Notification emails / attachments for complaints | ✗ (not built — documented limitation) | in-app status only |
| Refund rules | ✗ (deferred to Phase 8 per roadmap) | free-pilot protection tests guard the absence |
| Admin directory picker for appeal reviewer assignment | partial (admin-id input works; no picker) | Trust Center UI |
| Background sweeper for expired trust rows | partial (not needed for correctness — enforcement is expiry-aware; stored `isActive` flags lag until touched) | `evaluateTrustState` semantics |

## Known limitations (honest)

- Attendance is still teacher-marked; Phase 5 live evidence assists but does not auto-mark — review eligibility waits for the teacher's ATTENDED confirmation.
- No automated sentiment analysis (deliberate): moderation and investigation are human-only.
- FLAGGED reviews are excluded from aggregates while under moderation — a documented trade-off (docs/PHASE6_REVIEW_POLICY.md).
- Trust-state expiry is evaluated at enforcement time: expired temporary rows keep `isActive=true` until touched by REINSTATE or the next evaluation; enforcement is always correct because every check is expiry-aware.
- The trust-action admin route has no rate limit (admin-only; every student-facing write path is capped).
- Appeal reviewer assignment is an admin-id input in the Trust Center (no directory picker yet).
- Complaints have no file attachments; no notification emails exist — parties follow updates in-app (My reports / Trust Center).
- `bun run db:status` exit-code-1 quirk (above).
