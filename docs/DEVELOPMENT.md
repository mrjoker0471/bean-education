# BEAN Education — Development Guide

## Prerequisites

- Bun (runtime + package manager)
- The dev environment is Linux; the app runs on port 3000 only (platform gateway forwards other ports explicitly).

## Setup

```bash
bun install
cp .env.example .env        # then fill values (DATABASE_URL points at ./db/custom.db)
bun run db:push             # apply prisma schema (uses db push; see caveats)
bun run db:seed             # idempotent catalogue seed (safe to re-run)
bun run dev                 # start dev server (background: logs go to dev.log)
```

## Verification

```bash
bun run lint                # ESLint
```

There is no unit-test runner yet (see roadmap). Feature verification today uses the live dev server plus the E2E scripts in `scripts/e2e-*.ts` (they require the dev server on :3000). E2E fixture PDFs live in `upload/` (local-only, never committed).

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
