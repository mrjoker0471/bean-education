# Phase 4A — Results (BEAN Teach marketplace foundation)

Every number below was actually executed during this milestone. Nothing is projected or assumed.

## Definition of done — shipped with evidence

| Milestone item | Done | Evidence |
|---|---|---|
| Teacher application lifecycle (apply → PENDING → APPROVED/REJECTED, resubmission, no DOB/bank/ID) | ✅ | `/api/teach/application` GET/POST/PATCH + `#/teach/apply`; 11 tests in `teach-application-route.test.ts` |
| Admin review (ADMIN-only queues, search, full dialog, approve/reject, self-review block, audit) | ✅ | `/api/admin/teach/applications[/id/review]` + `#/teach/review`; 10 tests in `teach-review-route.test.ts` |
| Teacher capability = approved `TeacherProfile`, not a new role | ✅ | `requireApprovedTeacher()` in `src/lib/teach.ts`; `Student.role` untouched (schema diff is additive); ADR-017 |
| Teacher dashboard (profile edit w/ re-review rule, class lifecycle, publishing, attendance) | ✅ | `/api/teach/classes/*`, `/api/teach/my-classes`, `/api/teach/application PATCH` + `#/teach/dashboard`; 20 tests in `teach-classes-route.test.ts` + attendance tests in `teach-booking-route.test.ts` |
| Student marketplace (guest+student discovery, filters, free bookings, My bookings) | ✅ | `/api/teach/classes` GET + `/api/teach/my-bookings` + `#/classes`, `#/classes/:id`; browser E2E below |
| Seat integrity (atomic last-seat claim, release, reconciliation) | ✅ | `src/lib/teach-booking.ts` conditional SQL; 11 tests in `teach-seat-sql.test.ts` against real in-memory SQLite; live-server race below |
| Attendance only after class end, audited; enrollment shows display names only | ✅ | server-side `endsAt` check in the attendance route; audit event per change; 20 tests in `teach-booking-route.test.ts` |
| Navigation (Classes for guests+students, Teacher Review for ADMIN; nothing else moved) | ✅ | `src/components/bean/header.tsx` diff; guest nav keeps original entries + Classes |
| Typed API client + DTOs; 14 new route files (19 handlers) | ✅ | `src/lib/api.ts` (19 teach methods), `src/lib/types.ts`, `src/app/api/teach/**` + `src/app/api/admin/teach/**` |
| Free pilot pricing (metadata only, never charged) | ✅ | `plannedPricePaise` stored/displayed as planned price; no order/payment code exists (grep-verifiable; ADR-019) |
| Additive migration + baselining (no data touched, no reset) | ✅ | `prisma/migrations/20261118030000_bean_teach_marketplace/migration.sql` (CREATE TABLE/INDEX only); `migrate resolve --applied` baselining; `db:status` below |
| Documentation suite | ✅ | 4 new BEAN_TEACH_* docs + README/CHANGELOG/ARCHITECTURE/DEVELOPMENT/DEVELOPMENT_ROADMAP/DECISIONS updates |

## Automated tests — `bun test` (bun 1.3.x)

**158 tests, 0 failures, 359 expect() calls** across 15 files in `tests/unit/` (observed output: `158 pass / 0 fail / 359 expect() calls / Ran 158 tests across 15 files`).

72 of those are the 5 new Phase 4A suites (route-level tests with mocked db/auth — the established pattern; the SQL suite runs against a real in-memory SQLite engine):

| Suite | Count | What it proves |
|---|---|---|
| `teach-application-route.test.ts` | 11 | Application lifecycle: guest 401; SUBMIT/RESUBMIT transitions; duplicate submit 409 (unique studentId); POST refused while PENDING/APPROVED; rejection → resubmission reuses the SAME row and appends RESUBMIT to history; PATCH verification-relevant edit by an APPROVED teacher → EDIT_REVIEW event + profile back to PENDING + unpublished; `isPublished` toggle refused to non-approved |
| `teach-classes-route.test.ts` | 20 | Class rules/permissions: guest 401; non-approved 403; duration/capacity/minimum/schedule/time-zone validation (400); >50 active classes 409; public discovery returns only PUBLISHED upcoming classes of approved+published teachers with correct seat counts; PATCH ownership (foreign class 404), CANCELLED/COMPLETED immutable, capacity below held seats 409 |
| `teach-booking-route.test.ts` | 20 | Booking: guest 401; self-booking 403; draft/cancelled/unknown 404/409; started 409; full 409 with `bookedCount` never exceeding capacity; **CONCURRENT last-seat races (2 and 3 parallel bookings) produce exactly one winner**; owner cancellation releases the seat; double-cancel refused; foreign booking unreachable; window closed after start 409; rebooking re-activates the SAME record; attendance 401/409-before-end/owner-only/unrelated-teacher-404/audit appended |
| `teach-review-route.test.ts` | 10 | Admin review: guest 401; student 403; approve → APPROVED + published + reviewer recorded; reject requires a ≥10-char reason (400 otherwise); self-review 403; unknown id 404; already-approved 409; audit events appended per decision |
| `teach-seat-sql.test.ts` | 11 | The EXACT production SQL (`SEAT_CLAIM_SQL` / `SEAT_RELEASE_SQL`) executed against a real in-memory SQLite engine: only PUBLISHED+future+below-capacity rows match; loser of the race matches zero rows; release never produces negative counts or double-release; full claim→cancel→re-claim cycle stays consistent |

The remaining 86 tests across the 10 pre-existing suites (roles, PYQ routes, profile, dashboard, goals, helpers, answer-index, fence, route-parse) still pass — no regressions.

## Static checks

- `bunx tsc --noEmit` — **0 errors** (exit 0, no output)
- `bun run lint` (eslint 9, next config) — **0 errors, 0 warnings**
- `bun run db:status` — **"Database schema is up to date!"** with **5 migrations found** (baseline, 2A foundation, 2A job payload, 2B roles+review-audit, 4A bean_teach_marketplace); all 5 recorded in `_prisma_migrations` on the live DB
- `db/backups/custom-20261118-060309.db` — pre-migration backup (verified to contain the 23 pre-4A tables and NO `TeacherProfile`, i.e. taken before the schema change)
- Production build: **not run in this sandbox** — the environment provides only a dev server on port 3000 and explicitly forbids `bun run build` here. Mitigation: typecheck + lint + the route-level test matrix (which compiles every touched route module) provide the strongest available signal; the build must be re-run in CI/staging before deploy. Reported honestly as a limitation, same as Phase 2B.

## Live-server end-to-end evidence (real dev server on :3000, real SQLite DB)

- **Concurrent last-seat race**: two sessions booking the last seat of a capacity-1 published class simultaneously → **exactly one `201 Created` and one `409`** ("All seats are taken — check back if someone cancels."), with `bookedCount` frozen at capacity (1) and only ONE booking row created. The conditional `UPDATE … WHERE bookedCount < capacity` under SQLite write serialisation is the only place a seat is handed out.
- **Cancel → release → rebook**: the booking owner cancelled before the class start → seat released (`bookedCount` back to **0**), then rebooked → **201**, with NO duplicate booking row (the `@@unique([classSessionId, studentId])` row was re-activated — status CONFIRMED again, history intact).
- **Class cancellation**: the owner teacher cancelled a class with a reservation → class CANCELLED, the reservation flipped to CANCELLED (visible in the student's My bookings), `bookedCount` reset to 0, and a **CLASS_CANCELLED audit event** appended to `TeachAuditEvent` (actor id + role + "1 reservation(s) were released…" detail).
- Post-run DB state (verified via direct read of the live DB): 1 TeacherProfile, 3 ClassSessions, 3 ClassBookings, 3 TeachAuditEvents from the verification journeys — no schema drift, 5 migrations recorded.

## Browser end-to-end verification (headless Chromium, localhost:3000)

All flows exercised in a real browser session against the dev server:

1. **Guest browse** — `#/classes` lists published classes for signed-out visitors; class detail renders schedule (in the class time zone), teacher identity, seats left, and the honest Phase 5 note instead of fake video controls.
2. **Sign-up → apply** — new account signed up (always STUDENT), `#/teach/apply` submitted ("Become a BEAN Teacher"); PENDING state and empty history rendered.
3. **Admin approve** — operator granted ADMIN via `scripts/grant-role.ts --yes` (CLI only); the account's header gained **Teacher Review**; `#/teach/review` showed the pending queue with live counts, the full application dialog (fields + append-only history), and **Approve** flipped the profile to APPROVED + published.
4. **Teacher dashboard** — approved teacher opened `#/teach/dashboard`: profile editor, class create dialog (duration/capacity/minimum/time-zone/price-metadata fields), created a class, **Publish** made it appear in `#/classes`; the enrollment view lists the booked student by display name only.
5. **Student books** — a second student account reserved a seat from the class detail page (free); reservation confirmed with seats-left decrementing.
6. **My bookings** — `#/classes?tab=bookings` showed the reservation under Upcoming; cancelling moved it to Cancelled and released the seat; rebooking re-confirmed it.
7. **Teacher enrollment view** — the teacher's dashboard class card showed the enrolled student (display name) and per-booking states; attendance controls only offered marking after the class end time (server-enforced 409 before end).

Guest regression: guest navigation identical to Phase 2B except the added Classes entry; all pre-existing routes/links unchanged.

## Limitations & known risks (honest)

1. **Free pilot only** — the planned price is metadata, never charged; no orders, payments, wallets, payouts or commission exist. Monetisation stays Phase 8 (ADR-006/019).
2. **No notifications system** — students discover cancellations via My bookings; teachers get no alerting either. No email service exists in the product yet.
3. **No class completion automation** — COMPLETED is derived from the schedule for display; the stored status stays PUBLISHED until the teacher acts or the class is cancelled. Drafts cannot be cancelled or deleted.
4. **Attendance re-marking is allowed** (every change audited) — there is no lock-in window after the class ends.
5. **In-platform video classroom is Phase 5** — the class detail page says so honestly; nothing streams in this milestone.
6. **SQLite single-writer** — booking transactions serialise; the conditional seat-claim UPDATE is the correctness mechanism (ADR-018). A multi-process deployment would need re-evaluation before scale-out.
7. **Verification is human review only** — admins read qualifications text; no document upload or third-party verification exists.
8. **Production build not runnable in this sandbox** — see Static checks; re-verify in CI/staging.
