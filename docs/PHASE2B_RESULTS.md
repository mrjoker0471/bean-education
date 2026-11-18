# Phase 2B — Results

Every number below was actually executed during this milestone. Nothing is projected or assumed.

## Automated tests — `bun test` (bun 1.3.x)

**82 tests, 0 failures, 197 expect() calls** across 10 files in `tests/unit/`:

| Suite | What it proves |
|---|---|
| `roles.test.ts` (9) | Role vocabulary; PYQ curation allowed ONLY for PYQ_CURATOR/ADMIN; signed-out→401 vs signed-in-student→403 distinction; spoofed role values never pass |
| `pyq-review-route.test.ts` (13) | Guest 401; **STUDENT 403 with zero writes**; curator/admin approve; justification ≥10 chars enforced (400); verified-PYQ reject → 409 (no casual downgrade); ORIGINAL rows untouchable (409); unknown id → 404; audit event appended per decision; re-approval keeps both events |
| `pyq-import-route.test.ts` (10) | Guest 401 (no guest path); student 403 + zero writes; curator/admin import with provenance `importedBy`; every row lands PYQ_UNVERIFIED; unknown examSlug 400; duplicates counted never re-inserted; per-row honest failures; batch audit row exists even when all rows fail |
| `goals-route.test.ts` (10) | Guest 401; strict isolation (foreign goal 404, no leak, no mutation); general-goal creation without exam; guest creation refused |
| `profile-route.test.ts` (11) | Guest 401; preference MERGE + null-clear semantics; interests dedupe; invalid level 400; one-way onboarding stamp; **role stripped from PATCH — self-promotion impossible** |
| `dashboard-route.test.ts` (6) | Guest 401; **every aggregate query scoped by studentId** (isolation); honest zeros/nulls for fresh accounts; accuracy = Σcorrect/Σ(correct+wrong) over scored attempts only; deterministic recommendations backed by real rows |
| `pyq-helpers.test.ts` (14) | Phase 2A (unchanged, still passing) — hash stability + row validation |
| `answer-index / fence / route-parse` | Phase 2A regression suites, still passing |

## Static checks

- `bunx tsc --noEmit` — **0 errors**
- `bun run lint` (eslint 9, next config) — **0 problems**
- `prisma migrate status` — **"Database schema is up to date!"** (4 migrations: baseline, 2A foundation, 2A job payload, 2B roles+review-audit)
- `bun run db:backup` executed before any schema change (db/backups/custom-20261118-023929.db)
- Production build: **not run in this sandbox** — the environment provides only a dev server on port 3000 and explicitly forbids `bun run build` here. Mitigation: typecheck + lint + the full route-level test matrix (which compile every touched route module) provide the strongest available signal; the build must be re-run in CI/staging before deploy. Reported honestly as a limitation.

## API end-to-end verification (`scripts/verify-phase2b.sh`) — **37/37 PASS**

Run against the real dev server + real SQLite DB:

- **Student journey (16)**: register → role STUDENT; role-via-register refused (400); onboarding PATCH stamps onboardedAt, persists educationCategory, dedupes interests; /me carries role; dashboard honest zeros + first-goal recommendation; general goal created (no exam); dashboard shows the goal; **student import/batches/questions all refused (403)**
- **Curator journey (15)**: registers as STUDENT; `grant-role.ts --yes` promotes; unknown account refused; import created 2 / failed 1 (row audit); re-import counts 2 duplicates; batches history lists the paper; questions list renders provenance; approve → PYQ_VERIFIED; reject → REJECTED; **verified downgrade refused**; short justification 400; verified listing records reviewer + role + justification
- **Guest regression (6)**: catalog + exam search work; **PYQ batches/import now refused for guests** (intended hardening); guest dashboard 401; **cross-student isolation: curator sees zero of the student's goals**

## Browser end-to-end verification (agent-browser, real Chromium)

Screenshots in `db/`-external `/tmp/verify/shots/` (regenerated per run):

1. Home renders (obsidian + champagne-gold, BEAN LEARN branding)
2. **Sign-up routes to onboarding** (`#/onboarding`)
3. Onboarding wizard: name → College category + level → interests → English/Practice-first/45 min → goal entered → **Finish routes to `#/dashboard`**
4. **Dashboard**: "Hello, Bhavya." greeting, Daily plan 45 minutes, Continue learning honest empty state, My goals with the onboarding-created goal, My progress honest zeros + "nothing here is estimated or invented", Next step recommendations with honesty disclaimer
5. **Goals view**: onboarding goal listed; second goal created via UI; "2 active" counter
6. **Workspace**: header + honest empty-library state
7. **Settings → Edit my profile** opens the wizard in edit mode ("Your profile")
8. **Student at `#/pyq-studio` → "Not authorised" panel** (role-gated UI)
9. **Curator sign-in** lands correctly; **PYQ Studio** renders with role badge, catalogue-limitation note, Import/Review/History tabs
10. **Review queue**: status chips with live counts (All 4 / Unverified 0 / Verified 2 / Rejected 2); VERIFIED cards show keyed answer highlighted, explanation, source paper, year, session, source ref, batch (file + import date + importer), **"Reviewed by <email> (PYQ_CURATOR) on <date>"**; REJECTED cards show the exclusion note
11. Import history lists batches with created/duplicate/failed counts
12. Mobile (iPhone 14) auth + home render correctly; footer pushed naturally, no overlap

Issues found and fixed during verification:
- "Verified" chip click initially matched "Unverified" (substring matching in the test harness) — test-harness issue, not app; re-verified with exact-text clicks.
- Dev server restart race caused a benign EADDRINUSE line in dev.log; zero 4xx/5xx errors from application routes across all sessions.

## Preserved (regression-verified)

- Guest mode fully functional (catalog, exams, progress APIs unchanged; guest nav identical)
- Auth (login/logout/export/delete/claim-guest) untouched except additive role/onboardedAt fields
- Riishe pipeline, OCR, durable jobs, quotas — untouched
- Legacy exam catalogue, materials view, test engine — untouched

## Limitations & known risks (honest)

1. **Catalogue is empty in fresh environments** — the 9,487 Phase-1 questions lived in the old DB file (lost to a sandbox reset, never in git). `scripts/seed-demo-catalogue.ts` seeds a clearly-labelled QA exam for functional verification; production needs real catalogue data.
2. **examSlug constraint** — PYQ imports must attach to a catalogue exam; college/university semester papers cannot be represented yet (surfaced honestly in the studio UI + docs).
3. **Production build not runnable in this sandbox** — see above.
4. **Password reset / email verification** — no email service; unchanged from 2A.
5. **Role changes take effect on next session lookup** — roles are read fresh on every request (session join), so promotion/revocation is effective immediately; the UI nav updates after the next /api/auth/me.
6. **PYQ re-import across edits** — duplicate detection is content-hash based; editing a question's text/options makes it a new row (by design — provenance is immutable).
