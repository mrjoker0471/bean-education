# PHASE 7 — RESULTS

Status: **delivered** on `feat/bean-institution-career-phase-7` (8 commits ahead of base `origin/main` @ `f162ff48517a3847b1d22cb61020b157ee926d21`). Worktree: `/home/z/phase7-wt` (linked git worktree — the platform-owned `/home/z/my-project` checkout stayed on `main` untouched, preserving the local-only `f127b79` dev.pid commit exactly as required by the git-safety audit).

## 1. Commits

| SHA | Subject |
|---|---|
| `67c09a5` | feat(db): institution and organization foundation |
| `ca6d3bc` | feat(api): organization membership and institution access |
| `af75e85` | feat(ui): institution workspace and groups |
| `28dcbb5` | feat(institution): assignments and private class integration |
| `5108776` | feat(career): student skills and portfolio |
| `d06a2f9` | feat(career): verified employer opportunities and applications |
| `734f8bd` | test: institution career privacy and regression coverage |
| `4797f97` | fix(ui): opportunity type filter uses a non-empty Select value |

Docs commit: appended at delivery (this file and six doc updates).

## 2. Real verification outputs

### Tests — 418 passing, 0 failing (349 pre-existing kept green + 69 new)

```
$ DATABASE_URL="file:/home/z/my-project/db/custom.db" bun test
 418 pass
 0 fail
 2265 expect() calls
Ran 418 tests across 32 files. [~813ms]
```

New suites: `tests/unit/phase7-org-access.test.ts` (22), `tests/unit/phase7-private-classes-assignments.test.ts` (19), `tests/unit/phase7-career.test.ts` (21), `tests/unit/phase7-routing-admin.test.ts` (7). The duplicate-application test exercises the **real** `PrismaClientKnownRequestError` P2002 path against the fake unique index, exactly as the shipped constraint behaves.

### Type check and lint — clean

```
$ bunx tsc --noEmit   → exit 0 (no output)
$ bun run lint        → eslint . exits clean (0 problems)
```

### Database — additive migration, tracked, verified

```
$ bun run db:backup   → db/backups/custom-20261119-113553.db (taken BEFORE any change)
$ bunx prisma migrate dev --name phase7_institution_career --create-only   (against a temp db)
   → prisma/migrations/20261119114819_phase7_institution_career/migration.sql
$ DATABASE_URL="file:/home/z/my-project/db/custom.db" bun run db:push (additive; the runtime db was push-managed)
$ bun run db:status
8 migrations found in prisma/migrations
Database schema is up to date!
```

- 19 new tables + 7 Phase 6 tables (the runtime db was missing them because the platform boots on `main`) + 3 nullable `ClassSession` columns with `PUBLIC` defaults.
- The migration SQL was reviewed manually before applying: pure `CREATE TABLE`/`CREATE INDEX`/unique indexes; the `ClassSession` change is SQLite's standard table-rebuild **with a full `INSERT INTO … SELECT` copying every existing row** (existing public classes preserved; `audience` defaults `'PUBLIC'`).
- Migration tracking was **baselined** (`prisma migrate resolve --applied` for all 8 migrations) because the runtime database is push-managed by the environment's `dev.sh` (`bun run db:push` on every boot) and had no `_prisma_migrations` table. This environment mismatch is documented honestly here and in `docs/PHASE2A_DATABASE_MIGRATIONS.md` terms: `migrate dev` against the runtime db demands a reset — it was **never run** there; the folder was generated against a temp db and verified additive.

### Browser E2E (agent-browser, desktop 1280px + iPhone 14 390px)

Verified interactively against the Phase 7 dev server on port 3000 (real API + real db):

- Signed up a fresh account → onboarding → header shows **Institution** and **Career**.
- `#/institution` guest gate → signed-in hub → registered **"E2E Spring College"** via the dialog (201) → workspace opened at `#/institution/:id`.
- Truthful verification copy observed: `Not verified yet` → owner `Submit for verification` → `Verification pending`; the gating notice explains that "verified" means identity reviewed by BEAN, not accreditation.
- `#/institution/:id/members` renders the roster (1 active owner) with role/status badges.
- `#/career` hub, `#/career/profile` (visibility + adult-eligibility states render), `#/career/portfolio` — added skill "Financial modelling" through the UI; it persisted via the API and rendered with the truthful **Self-declared** label.
- `#/career/opportunities`, `#/career/applications`, `#/career/employer` (correct no-verified-employer empty state), `#/admin/organizations` and `#/admin/career` — both show the **"Administrators only … (server-enforced)"** gate for the non-admin account, matching the server guards.
- Full route sweep across all 7 new routes: **zero client-side exceptions** at both desktop and 390px widths.

One real bug was found by E2E and fixed in `4797f97`: shadcn `SelectItem` rejects empty-string values, which crashed the opportunities filter ("All types" used `value: ''`). The sentinel is now `ALL`, stripped before API calls.

## 3. What works end-to-end

- Organization registration → verification submission → admin decision lifecycle (legal transitions only; audit rows written in the same transaction).
- Invitation copy-link flow with hash-only token storage, expiries, revocation, role restrictions.
- Members management (appoint admin, set role, suspend, reinstate, remove) with last-owner protection.
- Groups/batches with capacity, unique enrollment, leave-preserves-history.
- Private institution classes end-to-end: creation with org/group audience, discovery exclusion, detail 404 for strangers, membership-checked booking inside the seat-claim transaction, membership re-checked on live tokens.
- Assignments: publish → learner submit (enrollment-checked) → instructor grade/return → rework; privacy preserved.
- Career: profile + visibility + eligibility request; truthful skills; projects with per-project sharing; credential issuance/sharing/revocation semantics; applications with explicit snapshots and consent-gated contact; withdrawal; private safety reports.
- Employer: draft → submit-for-review; admin moderation → published; applicants review with candidate-visible vs private notes; consent-gated candidate discovery (rate-limited, audited, opaque refs).
- Admin: organization verification queue, opportunity moderation queue, safety-report actions (explicit pause only), eligibility decisions.

## 4. Known gaps & unimplemented features (honest list)

- **No email/SMS delivery** — invitations are copy-link only; nothing pretends to email anyone. No notification service was added (in-app surfaces only).
- **No document attachments for assignments** — text + HTTPS link only; attaching files would require the existing private-storage ownership model and is deliberately out of Phase 7 scope.
- **`BEAN_ASSESSMENT_VERIFIED` skills cannot be produced yet** — no documented BEAN assessment process exists; the label is unreachable by any route.
- **Adult-eligibility review is procedural** — a human admin decision with no automated verification and no identity documents; the DPDP questions flagged in `docs/PHASE7_PRIVACY_AND_SAFEGUARDING.md` need professional review before discovery is heavily promoted.
- **Organization logos** are a short text mark (emoji), not uploads — no new storage pipeline was introduced.
- **Group-level completion metrics** are basic aggregates (published assignments, open submissions); richer analytics would need institution-owned activity beyond this phase.
- **Production migration path** — deployment packaging (`start.sh`) uses the packaged db; production environments using `migrate deploy` will apply all 8 migrations cleanly against an empty packaged db, but the sandbox runtime is push-managed (see §2).
- **LiveKit unconfigured in the sandbox** — live token/start paths were regression-tested through the existing suites (mocked provider) and the membership gates were unit/route tested; a real LiveKit Cloud connection was not exercised in this environment (no credentials), consistent with Phase 5's documented limitation.

## 5. Free-pilot protection (spec §32) — proven, not claimed

`tests/unit/phase7-career.test.ts` enforces: no payment models or fields in the schema, no razorpay/stripe packages, no payment/checkout/webhook route folders, no payment-related environment variables read anywhere in `src/`, and **no refund code anywhere** in `src/lib` — an adverse decision (bad review, complaint, report) cannot trigger a refund flow because none exists to trigger. All informational compensation text (`compensationDescription`, `plannedPricePaise`) remains metadata only.
