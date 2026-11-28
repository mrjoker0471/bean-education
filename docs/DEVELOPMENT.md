# BEAN Education — Development Guide

## Prerequisites

- Bun (runtime + package manager)
- The dev environment is Linux; the app runs on port 3000 only (platform gateway forwards other ports explicitly).

## Setup

```bash
bun install
cp .env.example .env        # then fill values (DATABASE_URL points at ./db/custom.db)
bun run db:generate         # generate the Prisma client
bun run db:deploy           # apply the FULL migration chain (prisma migrate deploy)
bun prisma/seed.ts          # idempotent catalogue seed (safe to re-run; no users are created)
bun run dev                 # start dev server (background: logs go to dev.log)
```

The server starts the durable-queue workers eagerly at boot (src/instrumentation.ts) and
exposes real readiness at `GET /api/healthz` (database probe + worker-loop registration).
Schema deployment uses `prisma migrate deploy` — never `prisma db push`.

## Verification

```bash
bun run lint                # ESLint
bun x tsc --noEmit          # TypeScript
bun test --isolate          # unit tests (file isolation, same as CI)
bun run build               # production standalone build
```

Feature verification additionally uses the live dev server plus the E2E scripts in
`scripts/e2e-*.ts` (they require the dev server on :3000). E2E fixture PDFs live in
`upload/` (local-only, never committed).

## Environment variables

`.env` is git-ignored. Required today: `DATABASE_URL` only. AI credentials are injected by the platform into the server runtime (`z-ai-web-dev-sdk`) — never placed in `.env`, never in client code. `.env.example` documents variable names with placeholders.

## Repository conventions

- Remote: `https://github.com/mrjoker0471/bean-education.git`, branch `main`. Pushes use SSH configured in the dev sandbox (see DECISIONS ADR-008).
- Completed milestones are committed and pushed automatically (Conventional Commits style). Never force-push; never commit failing work without a clear WIP label.
- NEVER commit: `.env*` (except `.env.example`), `*.db`/`*.sqlite*`, `/db/` (database + user uploads), `/upload/`, `/download/`, `/tool-results/`, `/agent-ctx/`, logs, `node_modules`, build output.
- Commit granularity: one coherent verified milestone per push; separate pushes for independent milestones.

## Code conventions

- TypeScript strict typing; all API calls go through `src/lib/api.ts` (no raw fetch in components).
- `z-ai-web-dev-sdk` is server-only — never import it in client components.
- shadcn/ui components from `src/components/ui` are preferred over custom UI.
- Prisma schema lives in `prisma/schema.prisma`; the SQLite file lives under `db/`.
- Prisma primitive list columns are stored as JSON strings (`*Json` fields).

## Known caveats (pre-Phase 2)

- `next.config.ts` has `typescript.ignoreBuildErrors: true` and `reactStrictMode: false`; `tsconfig` has `noImplicitAny: false` — slated for tightening (roadmap Phase 2).
- `prisma db push` script passes `--accept-data-loss` — use deliberately.
- `src/lib/db.ts` logs every SQL query; expect verbose `dev.log` output.
- In-process job state resets on server restart; failed Riishe jobs offer explicit retry.

## Phase 2A additions

- Tests: `bun test` (focused unit suites in tests/unit/).
- Migrations: `bun run db:backup` → edit schema → `bun run db:migrate` → `bun run db:status`. Never edit applied migrations; never reset the real DB (see docs/PHASE2A_DATABASE_MIGRATIONS.md).
- Env: `DATABASE_URL` plus optional `DB_QUERY_LOG=1` (SQL diagnostics), `TESSERACT_BIN`/`POPPLER_BIN`/`TESSDATA_PREFIX` (OCR binary/tessdata overrides).
- Identity: student sessions use the `bean_session` httpOnly cookie; auth mutations enforce same-origin; see docs/PHASE2A_IDENTITY.md.
- PYQ import: see docs/PHASE2A_PYQ_INGESTION.md (format spec + review workflow + CLI).

## Phase 2B additions

- Roles: normal registration is always STUDENT. Grant/revoke via the operator CLI only: `bun scripts/grant-role.ts --email=<email> --role=<STUDENT|PYQ_CURATOR|ADMIN> [--yes]` (dry-run default, last-ADMIN protection; see docs/PHASE2B_SECURITY.md for provisioning + recovery).
- PYQ curation: `/api/pyq/import`, `/api/pyq/batches`, `/api/pyq/questions`, `/api/pyq/review` are curator/admin-only (guest import path removed in 2B). Curator handbook: docs/PHASE2B_PYQ_CURATOR.md.
- E2E verification scripts (run in one session; the sandbox dev server is session-scoped):
  - `scripts/verify-phase2b.sh` — API end-to-end (student/curator/guest journeys, 37 checks)
  - `scripts/verify-browser.sh` + `verify-browser2/3.sh` — real-browser flows (onboarding → dashboard → goals → studio provenance)
  - `scripts/seed-demo-catalogue.ts` — clearly-labelled QA exam for fresh environments (DELETE after QA; not real content)
- Import CLI now authenticates as a curator: `PYQ_COOKIE='bean_session=<token>' bun scripts/pyq-import.ts <file.json>` (see the script header for how to copy the httpOnly cookie).

## Testing BEAN Teach flows (Phase 4A)

Full happy path against the dev server on :3000 (guide with exact contracts: docs/BEAN_TEACH_IMPLEMENTATION.md):

1. **Student applies** — register or sign in (registration is always STUDENT), open `#/teach/apply`, submit "Become a BEAN Teacher" (teaching name, headline, bio, subjects/levels/languages, qualifications, experience). The profile lands PENDING; the applicant can watch state and review history under `GET /api/teach/application` (the `#/teach/apply` view shows it).
2. **Operator grants ADMIN** — there is no promote endpoint; use the operator CLI only: `bun scripts/grant-role.ts --email=<email> --role=ADMIN` (dry-run preview; add `--yes` to apply; see docs/PHASE2B_SECURITY.md). Sign in as that account → the header now shows **Teacher Review** → open `#/teach/review`, inspect the application (full dialog incl. append-only history), then **Approve** (optional note) or **Reject** (mandatory 10–400 char reason). Approval publishes the profile to the marketplace; rejection shows the applicant the reason and lets them resubmit.
3. **Teacher creates and publishes** — as the approved teacher, `#/teach/dashboard`: edit the public profile (verification-relevant edits send the profile back to PENDING), create a class (duration 60–360 min in 30-min steps, capacity 1–50, minimum enrolment ≤ capacity, future schedule, IANA time zone), then **Publish**. The class is discoverable at `#/classes` for guests and students.
4. **Student books** — a second account opens `#/classes` → class detail → reserve a seat (always free during the pilot; guests are asked to sign in only at reservation time). The booking appears in **My bookings** (`#/classes?tab=bookings`); cancelling before the class starts releases the seat.
5. **Teacher marks attendance** — after `startsAt + durationMinutes` has passed, the teacher's enrollment list offers ATTENDED / NO_SHOW per booking (the server refuses marking before the class ends; every change appends an audit event).

Suites: `bun test` — the teach coverage lives in `tests/unit/teach-*.test.ts` (application lifecycle; class creation/edit/publish/discovery rules; booking incl. concurrent last-seat, cancellation window, attendance timing; admin review; and the seat-claim SQL executed verbatim against a real in-memory SQLite engine). Route-level tests mock db/auth — the established pattern in this repo.

Operator notes: role changes happen ONLY through `scripts/grant-role.ts`; teacher approval/rejection happens in the app at `#/teach/review`; both surfaces write append-only audit rows (PyqReviewEvent / TeachAuditEvent).

## Testing the live classroom (Phase 5)

Setup and full operator guide: docs/PHASE5_LIVEKIT_SETUP.md (LiveKit Cloud credentials in `.env`, optional webhook registration). Without credentials the classroom is honestly "not configured" — every other BEAN feature keeps working.

1. **Enable LiveKit** — create a free LiveKit Cloud project, put `LIVEKIT_WS_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env` (placeholders documented in `.env.example`; never commit the real file). Restart `bun run dev`.
2. **Run the Phase 4A journey first** — a teacher needs an APPROVED profile, a PUBLISHED class and ≥1 CONFIRMED booking before "Start Live Class" appears (see the BEAN Teach section above).
3. **Start** — as the owner teacher, inside the scheduled window (15 min before → scheduled end), press **Start Live Class** (class page or teacher dashboard). BEAN reserves `(confirmed + 1) × duration` participant-minutes from the monthly allowance, creates the room, and routes to `#/classroom/:id`. The pre-join screen explains permissions, previews camera/mic (opt-in), and only connects after the user presses Join.
4. **Join** — a student holding a confirmed seat sees **Join Live Classroom** on the class detail page and in My Bookings while the room is LIVE. Guests see a sign-in gate; cancelled/unbooked students are refused (server-side).
5. **In the room** — camera/mic toggles, raise hand, participants panel, teacher screen share, teacher whiteboard (pen/eraser/colour/size/undo/clear) with live student sync; late joiners receive the saved board automatically.
6. **End** — the teacher's "End class" asks for confirmation, disconnects everyone, finalises usage once, and the room cannot restart. The attendance strip in the teacher dashboard then shows verified live evidence (first joined, last left, connected time, reconnections) plus an ADVISORY ≥60% suggestion — the teacher still marks ATTENDED/NO_SHOW via the Phase 4A buttons.
7. **Webhooks (recommended)** — register `POST <your-domain>/api/webhooks/livekit` in LiveKit Cloud for verified attendance evidence and interrupted-session reconciliation; deliveries are signature-verified and idempotent.

Suites: `bun test` — the live-classroom coverage lives in `tests/unit/live-*.test.ts` (usage-budget SQL against real SQLite; start/token/end route matrices; webhook signature + idempotency with REAL signed tokens; whiteboard validation; attendance-evidence logic). The webhook verifier deliberately re-implements `WebhookReceiver`'s cryptographic checks with a tolerant JSON parse — see ADR-022.

## Phase 6 notes (Trust & Quality)

- **Env-free feature**: Phase 6 reads ZERO new configuration. All policy is code — constants live in `src/lib/trust.ts` (`RATE_LIMITS`: reviews 10 / complaints 10 / appeals 5 / flags 20 per rolling 24 h; edit windows `REVIEW_EDIT_WINDOW_DAYS=7` / `RESPONSE_EDIT_WINDOW_DAYS=7`; `QUALITY_MIN_SAMPLE=3`; text bounds). No `.env` change is needed and none should be added (payment variables are forbidden — asserted by tests).
- **Run the trust tests**: `bun test tests/unit/trust-quality.test.ts tests/unit/trust-review-route.test.ts tests/unit/trust-complaint-route.test.ts tests/unit/trust-action-route.test.ts tests/unit/trust-appeal-route.test.ts tests/unit/free-pilot-protection.test.ts` — or just `bun test` (349 tests / 28 files total). Route-level suites mock db/auth (established pattern); the free-pilot suite statically scans source files.
- **Admin provisioning reminder**: the Trust Center (`#/admin/trust`) needs an ADMIN account — there is no promote endpoint; grant via the operator CLI only: `bun scripts/grant-role.ts --email=<email> --role=ADMIN [--yes]` (see Phase 2B section above). Complaint/appeal assignment and appeal deciding also require ADMIN targets — assigning to a non-admin is refused (400).
- **db:status quirk**: `bun run db:status` (`prisma migrate status`) exits code 1 in this environment claiming migrations are unapplied even when the runtime DB (built with `prisma db push`) has the full schema — a pre-existing CLI bookkeeping quirk, recorded in docs/PHASE6_RESULTS.md. Fresh environments should use `bun run db:deploy`; don't treat `db:status` output here as evidence of a broken schema.
- Policy handbooks: docs/PHASE6_TRUST_QUALITY.md (umbrella), docs/PHASE6_REVIEW_POLICY.md, docs/PHASE6_COMPLAINTS_AND_APPEALS.md, docs/PHASE6_SAFEGUARDING.md, docs/PHASE6_SECURITY.md.

## Phase 7 — Institution & Career development notes

- **Worktree delivery**: Phase 7 was developed in `/home/z/phase7-wt` (a linked git worktree on `feat/bean-institution-career-phase-7`) so the platform-owned `/home/z/my-project` checkout could stay on `main`. `node_modules` is hard-link-copied (`cp -al`), `.env` copied, and commands run with an explicit `DATABASE_URL=file:/home/z/my-project/db/custom.db`.
- **Branch-naming gotcha**: this sandbox's filesystem rewrites directory names starting with `[m` (e.g. `[memberId]` → `emberId]`). Next.js dynamic segments starting with m are unusable; use an alternative param name (the member action route uses `[orgMemberId]`).
- **Route conventions** (unchanged): `export const dynamic = 'force-dynamic'` + `runtime = 'nodejs'`; async `params: Promise<…>`; `{error}` JSON bodies; 201 creates; same-origin + Zod on every mutation; transactional multi-outcome handlers with `type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]`; audit rows in the same transaction.
- **New guards**: `requireActiveMembership`, `requireOrgRole/Admin/Instructor` (`src/lib/institution.ts`); career gates `isDiscoverable`/`canApply` are pure functions — always call the DB-backed eligibility check in routes, never trust a client claim.
- **New rate limits** (`institution.RATE_LIMITS`, `career.RATE_LIMITS`): 24h rolling row counts → 429, matching the Phase 6 pattern.
- **Migration workflow** (as before): `db:backup` → edit schema → `--create-only` against a temp db → review SQL → apply to the runtime db (`db:push` here; `migrate deploy` in production) → `prisma migrate resolve --applied` to baseline push-managed runtimes → `db:status`.
- **Tests**: `bun test` (418). Route tests use the fake-db + `mock.module('@/lib/db')` pattern — ONE `mock.module` per module (a second registration replaces the first); fakes must return relation includes the route selects (e.g. `teacherProfile`, `organization`, `assignment`). Free-pilot scans strip comment lines before matching so policy text like "no refunds" cannot false-positive.
