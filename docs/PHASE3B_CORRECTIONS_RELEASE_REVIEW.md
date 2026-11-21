# Phase 3B — Pre-PR Correction & Release Review (2026-11-21)

Scope: targeted corrections on `feat/bean-personal-learning-intelligence` requested before opening the PR. The original implementation commit `4ed712f1d34315f5ecca2045442bf659221e45d3` is preserved untouched; the corrections are follow-up commits. Nothing is merged; no PR is created by the agent.

Starting state (independently verified at session start):

| Ref | SHA |
| --- | --- |
| remote `feat/bean-personal-learning-intelligence` | `4ed712f1d34315f5ecca2045442bf659221e45d3` |
| remote `main` | `ba80d9834642b33b9d695c73eb56d013e3d1364a` |

## 1. CRITICAL — Mastery evidence pagination

Defect (confirmed by line-level inspection of `src/lib/learning/mastery.ts` at `4ed712f`): `recomputeTopicMastery` fetched attempts with `orderBy: { startedAt: 'asc' }, take: 200` (`MAX_EVIDENCE_ATTEMPTS`). That selects only the oldest 200 submitted attempts — once a learner exceeds 200, all newer evidence was permanently invisible to mastery, and a topic first appearing after attempt 200 could never earn a row.

Fix (`src/lib/learning/mastery.ts`):

- Deterministic cursor pagination: `orderBy: [{ startedAt: 'asc' }, { id: 'asc' }]` with `cursor: { id }` + `skip: 1`, page size `EVIDENCE_PAGE_SIZE = 200` (exported), looping until the owner's history is exhausted.
- The unique attempt `id` is the seek cursor under the composite order — a plain `startedAt` cursor is non-unique and could silently skip every row sharing the boundary timestamp; the composite seek cannot.
- Bounded memory: one page of attempt rows + that page's question metadata at a time. The growing per-topic evidence map is the RESULT, not the raw history. No rolling window, documented in the code header.
- Oldest→newest chronology preserved (`accumulateTopicEvidence` folds pages into the same map the pure builder produces, latest outcome per question wins).
- Question metadata is resolved per page (chunked at 500 ids), not for the whole lifetime.

Regression test (`tests/unit/learning-mastery-pagination.test.ts`) — REAL persistence: a temp-file SQLite database is provisioned with `prisma db push` (explicit `DATABASE_URL` env var) and the code under test binds it via `PrismaClient({ datasources: { db: { url } } })`. The developer DB and the main checkout are never touched. Fixture: 212 submitted attempts for one owner (plus one attempt for a second owner), with a FOUR-attempt group sharing ONE `startedAt` deliberately positioned so the page boundary falls INSIDE it (positions P-1…P+2), a nine-attempt tie group in page 2, and a strictly-latest final attempt. Proven:

1. The LAST attempt updates the outcome of a question first answered in the first page (`pq-old1`: wrong in A1, re-answered correct beyond the page → `correctDistinct: 5`, `accuracy: 83`).
2. A topic first appearing after attempt 200 (`topic-late`, first evidence at ordered position ≥ 201) receives a mastery row (`attemptCount: 2`, latest-correct → `accuracy: 100`).
3. Evidence counts and latest-attempt regression stay correct (`NEEDS_REVISION` fires from persisted STRONG after the final 0% attempt; `attemptCount`, `evidenceQuestions`, `correctDistinct` all exact).
4. Pagination has no missing and no duplicated attempts: every attempt carries one unique sentinel question, so `attemptCount === evidenceQuestions === 212` — a lost page lowers it, a replayed page inflates `attemptCount`; the baseline pass (first 202 attempts, boundary straddled) is checked separately.
5. Cross-owner isolation: the other guest's identical-topic evidence never bleeds in.

## 2. Diagnostic assessment scope

Original Phase 3B scope included topics, chapters/units, subjects and examination/syllabus areas; the implementation only accepted `topicId`.

Investigation: the authoritative engine (`POST /api/attempts/[id]` → `scoreAttempt`) is fully generic — it scores any BANK attempt from `questionIdsJson`, computes `perTopicJson` and fires the evidence hook. Nothing in the submit path is topic- or template-bound, so wider scopes are safe with the existing engine.

Extension (`src/lib/learning/diagnostics.ts`, route, overview API, UI):

- `POST /api/learning/diagnostic` accepts `scopeType: TOPIC|UNIT|SUBJECT|EXAM` + `scopeId`; the legacy `topicId` body keeps working (mapped to TOPIC); mixing the two forms is a 400.
- Non-topic question selection goes through the topic relation (`topic: { unitId }` / `topic: { unit: { subjectId } }` / `topic: { unit: { subject: { stage: { examId } } } }`), guaranteeing every selected question carries a catalogue topic — per-topic results, mastery evidence and mistake records behave identically for all scopes.
- VERIFIED-only selection and coverage counting are unchanged; ≥ 6 verified questions in the requested scope, up to 10 chosen; honest 409 naming the scope label when coverage is thin; 404 for unknown scope ids; coverage is never fabricated.
- Resume-not-stack is preserved per scope (TOPIC resumes via the `topicId` column exactly as before; UNIT/SUBJECT/EXAM resume via a bounded `configJson` prefilter followed by an exact parsed match). Expired in-progress diagnostics are abandoned and replaced; different scopes stack independently.
- Scope metadata persists in `configJson` (`scopeType`, `scopeId`, `scopeLabel`, plus the `topicId` mirror for TOPIC) and on the attempt row (`topicId` only for TOPIC, `subjectId` when the scope resolves to one subject, `examId` always) — topic, unit, subject and exam diagnostics are distinguishable afterwards.
- Rate limits (12 starts/hour/owner) and CSRF-lite unchanged.
- Overview API + learning hub UI: broader scopes are offered ONLY where they derive from the learner's own thin-evidence topics and the verified bank really supports them (unit → subject → exam of those topics, bank ≥ 6, capped at 5).

Documented limitations (not faked):
- Unit/subject/exam diagnostics deliberately select only topic-bearing questions; topic-less bank rows would contribute nothing to per-topic results and are excluded by construction.
- The UI's broader-scope suggestions derive from the learner's existing evidence (their thin topics' hierarchy). There is no global "diagnose any subject" catalogue browsing — that would invent scope coverage the learner never signalled.
- Exam-scope diagnostics sample up to 10 questions from the whole exam — a baseline probe, not a full-syllabus audit; the UI copy says so.

Tests: `tests/unit/learning-diagnostic-scopes.test.ts` (13 tests) — legacy form, scope metadata per scope, unit aggregation across thin topics, subject/exam scopes, honest 409s (per scope label), VERIFIED-only counting, 404s, resume/expiry per scope, scope non-collision, max-question cap.

## 3. Timezone correctness

Investigated: `todayKey()`, `dateKeyOf()`, `dateKeyStart()`, `dateKeyEnd()`, `currentPlanDate()`, `dueStateOf()`, planner date generation and insights day-grouping all used **server-local** (`getFullYear/getMonth/getDate`) wall-clock. Deployed runtime: this sandbox runs UTC (no `/etc/timezone`, `date` → UTC) — i.e. day boundaries were an accidental container property, and any deployment elsewhere would silently move them.

Decision (explicit, documented):

- **Product default: `Asia/Kolkata`** (`PRODUCT_TIMEZONE` in `src/lib/learning/scope.ts`) — the app's exam audience, fixed +05:30, no DST, stable boundaries year-round.
- **Explicit learner timezone:** day-keyed routes accept `tz` (query param for GETs, body for POSTs) carrying the client's IANA zone (`learnerTimezone()` helper sent by the learning hub). The server validates untrusted values (`resolveLearnerTimezone`: charset-bounded IANA shape + `Intl` check) and falls back to the product default. The host/container zone is never consulted.
- Implementation: `dateKeyOf(d, tz)` via cached `Intl` formatters; `dateKeyStart(key, tz)` computes local midnight via zone-offset (with a one-pass refinement for midnight-DST zones); `dateKeyEnd` is the NEXT local midnight (DST-safe, replacing the old `start + 24h`); `shiftDateKey` is pure calendar arithmetic on the key. `dueStateOf(item, now, tz)`, `currentPlanDate(tz)`, `getOrCreateDayPlan(..., { tz })`, `buildVisibleActions(..., tz)` and `buildInsights({ tz })` thread the zone; revision ladder movement stays absolute-time based (now + N days), which is timezone-independent by design.
- Routes threaded: overview GET, plan GET/POST, revision GET, actions GET. Diagnostics/mastery/mistakes have no day-keyed math and stay unchanged. No unrelated date-system refactors (claim/export/delete and the attempts pipeline untouched).

Tests (`tests/unit/learning-timezone.test.ts`, 19 tests):

- IST midnight boundary: `18:29:59.999Z` → old day, `18:30:00Z` → next day; same instant in UTC stays the old day; the DEFAULT key at `19:00Z` is the NEXT IST day (proving independence from the container's UTC clock).
- `dateKeyStart` round-trips across five zones incl. DST (`America/New_York` −5 winter / −4 summer verified explicitly); `dateKeyEnd` = next local midnight; malformed calendar dates rejected.
- `shiftDateKey` month/year/leap-year boundaries.
- Wrong-local-hour regressions: a revision due during the IST day reads `OVERDUE` at 00:30 IST; the same instant in UTC still reads `DUE_TODAY` (the difference IS the fix); a revision due later in the local IST day reads `DUE_TODAY` (not wrongly overdue) while UTC still says `UPCOMING`; overdue day-counts negative.

## 4. Ownership & privacy review

Audited: all nine `/api/learning/*` route files (overview, mastery, plan, plan/[id], actions, diagnostic, mistakes, mistakes/[id], revision) and the Riishe chat learning-digest integration.

Findings at `4ed712f`:

- Every route accepted the client-supplied `guestId` with zod validation + `sameOrigin` on mutations. `sameOrigin` is CSRF hygiene, not ownership authentication.
- No route accepted a client-supplied `studentId` (verified across all request schemas) — no trust-the-client-studentId defect exists.
- For signed-in users, nothing cross-checked the session against the guest identity: a signed-in account could pass another account's claimed `guestId` and read its learning profile.

Honest model statement + hardening (`assertLearningOwner` in `src/lib/learning/scope.ts`, applied to every handler of all nine routes, and to the chat digest):

- **Guest-first operation is preserved and stated:** the `guestId` remains an opaque bearer identifier — the same product contract as `/api/progress` and `/api/attempts`. These routes are NOT session-bound for unclaimed guests, and this document says so; no claim of session binding is made.
- **Claim-model enforcement where safely possible:** when a signed-in session exists, the claimant of the guest identity is resolved from the attempts table (`claimedStudentIdFor` — attempts are the one table every learner journey writes; claim-guest stamps `studentId` across owned tables). A session that does not match the claimant gets **403 before any row read or mutation** — reads included. Guests (no session) and the claimant keep working; an unclaimed identity keeps working for a signed-in learner before they claim.
- No authentication redesign was introduced: no middleware, no schema change, no new identity model; claim, privacy-export, account-delete and guest-purge compatibility are untouched (the compat tests still pass unchanged).
- The Riishe digest withholds the learning profile under the same check — one account's learning profile never enriches another account's prompt. (Chat itself remains under its pre-existing guest-bearer contract; that is pre-existing scope, not 3B.)

Residual risk, stated honestly: an UNCLAIMED guest identity is still a bearer token — anyone holding the id can use it, exactly as with `/api/progress` and `/api/attempts` today. Migrating those routes off the bearer contract is an app-wide identity redesign outside this correction's mandate.

Tests (`tests/unit/learning-ownership.test.ts`, 9 tests): claim-model semantics (signed-out / claimant / unclaimed / foreign), and route-level rejection — overview GET 403 for a foreign account while claimant gets 200 and guest gets 200; mastery/revision/mistakes reads protected; diagnostic POST, plan-regeneration POST, action-decision POST 403; plan-task PATCH and mistake-tag PATCH 403 with rows PROVEN untouched; the claimant can still mutate their own rows.

## 5. Database incident closure

Disclosed incident (from the Phase 3B implementation session's report and worklog): a shell-level `DATABASE_URL` leak briefly caused one additive schema push and the app's own idempotent catalogue seed to run against the main sandbox database copy instead of the session's isolated database.

Precise note (no credentials, no connection strings):

- **Affected copy:** `/home/z/my-project/db/custom.db` — the main checkout's local SQLite development database (a production-shaped catalogue copy used for verification inside this sandbox).
- **Was the deployed production database connected or modified?** No. This sandbox has no credentials and no network route to any deployed database; every `DATABASE_URL` value present in the environment resolves to a local `file:` path under `/home/z`. The deployed production database was never reachable from this machine, therefore never connected to and never modified.
- **Copy, not live production:** confirmed — the affected file is the sandbox's own dev-checkout database, not the live system's database.
- **What ran against it:** one additive schema push (the 3B DDL — CREATE TABLE/INDEX only; the migration SQL was reviewed line-by-line at implementation time: 21 CREATE statements, zero destructive) plus the idempotent catalogue seeder (upserts by stable ids). No DELETE/DROP/UPDATE of user data.
- **Backup evidence:** an independent older data snapshot exists at `/tmp/my-project/db/custom.db` (mtime `2026-10-29 07:33 UTC`, untouched since): 16 tables, 77 exams, 9,487 questions, 1,992 topics, 19 attempts, 1 study document — intact and outside the incident path. The main checkout's `db/backups/` directory does not exist (no backup file was created there).
- **Before/after record counts:** at implementation time the migration was verified on a production-data copy with identical record counts before/after (10 categories, 77 exams, 134 stages, 226 subjects, 496 units, 1,992 topics, 9,487 questions, 1,475 resources, 263 templates, zero user rows). Verified again THIS session on the affected file itself: the file now holds the full 3B schema (66 tables) with **zero rows in every user/data table** — `Student 0, Attempt 0, StudyDocument 0, Session 0` and `Exam 0, Question 0, Topic 0` (read-only `bun:sqlite` inspection).
- **No student/user records or uploads touched:** confirmed by the zero-row state above; nothing of user value existed in the affected copy, and no upload file was part of the path (`db/` contains only the single database file).
- **Subsequent operations used explicit isolated DATABASE_URL values:** this review session's schema push and catalogue seed ran with an explicit `DATABASE_URL=file:/home/z/p3b-wt/db/bean-3b.db` env var (verified: the isolated file was created and populated; the main copy was not written by those commands); the pagination regression test binds its own temp-file database via explicit `datasources` override; browser E2E runs from the worktree with its own isolated `.env` (loaded by Next itself, isolated path).
- **Root-cause footgun found during this review:** in this sandbox the Prisma CLI does not load `.env` files — a `prisma db push` without an explicit `DATABASE_URL` env var silently no-ops ("already in sync" while writing nothing; reproduced three ways: `.env`-only, no-env, existing-empty-file). This ambiguity class is exactly what produced the original leak (shell-level overrides beating file-based config). Operational rule adopted: every DB-touching CLI command carries an explicit `DATABASE_URL` prefix; `.env` is relied on only for the Next dev server (Next loads it itself).
- **New event investigated this session (transparent disclosure):** the affected file's mtime changed during this session (`03:53:04 UTC`, 573,440 → 1,224,704 bytes) while its content is a schema-only database with all tables empty. Investigation ruled out, with evidence: dev-server traffic (`dev.log` shows no request after boot 03:38:57), the pfs-topup restore (ran once at boot 03:38 per `/tmp/pfs-topup.log` and `/home/z/.pfs-topup-tmp`), the worktree `prisma db push` attempts (proven no-ops — their isolated target `db/bean-3b.db` was never created by them; the `.env`-only invocation cannot write in this sandbox), and the test suite (every DB-touching test mocks `@/lib/db`, and bun's auto-loaded env pointed at the worktree path). Most consistent with harness file-layer materialisation or another unattributed no-data schema write; the exact writer is not attributable from the evidence available. Impact assessment: zero — the file held no user data before or after (all tables empty), and no data anywhere else changed. Because the deployed production database was definitively NOT touched (no route exists), work continues per the instruction; this disclosure is made in full.

## 6. Verification (executed this session — real commands, real output)

| Check | Result |
| --- | --- |
| `bun test` | **888 passed / 0 failed** across 62 files (841 baseline — incl. 6 compat tests that had silently not been running in combined runs — + 6 pagination + 19 timezone + 13 diagnostic-scope + 9 ownership) |
| `bunx tsc --noEmit` | clean (re-run after every change group) |
| `bun run lint` | clean (exit 0) |
| Migration status | 10 migrations found in `prisma/migrations`; the verification DB is provisioned by additive schema sync (`prisma db push` with an explicit `DATABASE_URL` env var), so `migrate status` reports no `_prisma_migrations` ledger for it — the pre-existing sandbox bookkeeping condition, documented since Phase 2A, no reset performed |
| Migration SQL review | word-boundary scan over the shipped 3B `migration.sql`: strictly CREATE statements (21), zero DROP/ALTER/DELETE/UPDATE |
| Secrets scan | `git status` shows only docs/tests/code changes; `.env`, `*.db`, `dev.log` git-ignored (verified via `git check-ignore`); diff scan finds no key material (only a pre-existing test fixture string) |
| Browser E2E | executed against `next dev -p 3100` (worktree, isolated DB `db/bean-3b.db`) — see below |
| Guest + signed-in ownership | ownership suite (9 tests) + live browser checks (403/200/200) |
| 390 / 768 / 1280 breakpoints | 0px horizontal overflow at all three; sticky footer verified short-page and long-page |

Browser E2E evidence (all against the real app + real isolated DB, screenshots in local `agent-ctx/e2e-*.png`):

- **Mastery beyond 200 attempts:** a fixture guest with 213 real submitted attempts (two catalogue topics + a thin third). `GET /api/learning/mastery` recomputes live: `Geography NEEDS_REVISION acc=67 ev=6 att=206` (its final collapse attempt is #213 — beyond any 200-cap — and it overrode first-page outcomes) and `History STRONG acc=100 ev=7 att=7` (evidence exists ONLY in attempts 206–212 — the old take-200 code could never have produced this row). The learning hub renders both rows with status chips, evidence counts and rationale text.
- **Diagnostics:** the hub's diagnostics card lists the thin topic (10 verified Qs) AND the three broader scopes derived from it — `Awareness (unit) 32 Qs`, `General Awareness (subject) 32 Qs`, `AFCAT (full syllabus) 117 Qs`. A topic diagnostic was started, answered (1 correct / 1 wrong / 8 honest skips), submitted through the authoritative runner (score 10%, per-topic breakdown) and the derived state appeared live: Polity mastery row updated (INSUFFICIENT_EVIDENCE, 3 distinct), the wrong answer in the mistake ledger (missed 1×, Unclassified), a spaced-revision schedule entry for Polity, and DIAGNOSTIC/NEEDS_REVISION next-best actions. An EXAM-scope diagnostic started live returned `resumed: true` on the second start with the same attemptId (resume-not-stack per scope). Honesty paths verified live: thin-bank scope → 409 naming the scope label ("Current Events — 4 available right now"); unknown scope → 404; mixed legacy+scope body → 400.
- **Timezone behaviour:** with the SAME data, `GET /api/learning/plan` returns `2026-11-20` for `tz=Pacific/Midway` (UTC-11) and `2026-11-21` for `tz=Pacific/Kiritimati` (UTC+14) at 04:26 UTC — the learner's local day drives the plan key. An attack string (`tz=../../etc/passwd`) falls back to the documented product default (Asia/Kolkata). The revision schedule honours the requested zone. This check also caught and fixed a real threading gap (the plan route's default date key ignored the learner tz; fixed and re-verified).
- **Ownership:** a real account registered and claimed the fixture guest (claim report: 215 attempts + 7 learning rows). Live browser checks: signed-in foreign account → 403 on the overview read AND on a diagnostic POST; the claimant → 200; signed-out guest → 200. The signed-in hub renders for the claimant (screenshot).
- **Console/page errors:** none across all sessions.

Test-suite hygiene correction (required to make `bun test` green in this environment): bun 1.3.14 keeps the FIRST `mock.module('@/lib/auth')` registration of a process alive; the partial auth mocks in early test files broke later files that bind other auth exports (`SyntaxError: Export named 'destroyCurrentSession' not found` between tests — 1 file failed to evaluate in the combined run while passing individually). Fix: `tests/helpers/auth-mock.ts` provides the COMPLETE auth export surface; all 29 auth-mocking test files were switched to it (test-only change, no production code). This restored the full 841-test baseline (6 compat tests that had silently not been running in combined runs are included).

## 7. Git & delivery

- Work confined to `feat/bean-personal-learning-intelligence` in the linked worktree `/home/z/p3b-wt`; `/home/z/my-project` (main checkout, carries local commit `f127b79`) untouched except read-only inspection.
- The original implementation commit `4ed712f` is preserved (no rebase, no force-push).
- Corrections committed only after the full verification pass; `main` verified unchanged at `ba80d9834642b33b9d695c73eb56d013e3d1364a` immediately before delivery; no merge, no PR.
- **Push status (honest):** the sandbox was reset between sessions, destroying the previously registered deploy key's private half along with all files outside the repository. The ssh2 transport shim was rebuilt and a NEW keypair generated; the push attempt over `ssh.github.com:443` reaches GitHub and fails exactly at publickey authentication because the new key (`bean-3b-release-review@2026-11-21`) is not registered as a deploy key yet. Nothing was force-pushed and nothing else was attempted. Once the key is registered, a normal `git push origin feat/bean-personal-learning-intelligence` delivers the branch; the remote HEAD must then be independently verified equal to the local HEAD below.
- SHAs at delivery: correction commit `3f694fbadbe5d3499228786ee197f2c25142d505` on top of the preserved implementation commit `4ed712f1d34315f5ecca2045442bf659221e45d3`; remote branch still at `4ed712f…` until the push succeeds.
