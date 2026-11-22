# Phase 3B — Personal Learning Intelligence

Status: implemented on branch `feat/bean-personal-learning-intelligence` (created from `origin/main` at `ba80d98`). Not merged; no PR created without explicit authorisation.

Phase 3B answers five questions from REAL learning evidence only — what has the learner understood, where are the gaps, what is the next step, when should they revise, and are they actually improving. It is explicitly NOT an exam-only product: the learning hub works identically for guests and signed-in students, and every number is computed deterministically from submitted attempts.

## 1. Delivery gate (spec §0)

Before implementation, remote history was fetched and independently verified via anonymous HTTPS `ls-remote`:

| Ref | SHA (verified 2026-11-21) |
| --- | --- |
| `refs/heads/main` | `ba80d9834642b33b9d695c73eb56d013e3d1364a` |
| `refs/heads/feat/bean-riishe-phase3a-deep-research` | `7d88be0d50c3d671ec92546f5e23141f2723fa3d` |

Phase 3A was confirmed merged (PR #8 merge `716d55f` and feature commit `7d88be0` are ancestors of main). Remote main had advanced past `716d55f` with two additional merges — PR #9 (`78688f5`, 3A branch merged through the 2B branch) and PR #10 (`ba80d98`, the 2B branch back into main) — both proven **zero-content** (`git diff 716d55f ba80d98` is empty), so branching from latest `origin/main` imports no legacy-2B development.

Baseline safeguard verification (all PRESENT on `ba80d98`): research routes (`/api/riishe/research*`, `/api/pyq/candidates*`), the additive 3A migration (`20261120153000_phase3a_deep_research`), the SSRF URL guard (`src/lib/riishe/url-guard.ts`), the curator-only promotion state machine (DISCOVERED → SOURCE_CHECKED → PROMOTED/DISCARDED, `requirePyqCurator`), VERIFIED-only practice (`SELECTABLE_QUESTION` applied to every selection path in `/api/tests/start`, enforced by the `safeguard-alignment` static scan test), single-writer `PYQ_VERIFIED` enforcement, and the durable quota/job machinery. All preserved untouched by 3B.

## 2. Gap audit against the merged 3A baseline (spec §2)

Focused re-audit on the merged baseline (superseding the pre-3A audit at `26dd3b8`):

| Capability | Verdict on merged 3A main | 3B action |
| --- | --- | --- |
| Server-authoritative test engine (`/api/tests/start`, `scoreAttempt`, autosave, server clock) | EXISTS | Reused untouched for diagnostics |
| Student profile (`Student`, preferences incl. `dailyMinutes`, unused `revisionStyle` slot) | EXISTS | Read for plan capacity + stated insights; not rebuilt |
| Goals (`StudyGoal` CRUD + UI, studentId-scoped) | EXISTS | Reused as planner input (post-claim only) |
| Attempts (`Attempt` with `perTopicJson`, `answersJson`, BANK/RIISHE provenance) | EXISTS | Evidence source; one additive submit hook |
| Weak-topic signals (bank heuristic in `/api/progress`, Riishe heuristic in `/api/riishe/weak-topics`) | EXISTS | Preserved; mastery adds the persistent, distinct-question layer |
| `weakFocus` feature | HALF-WIRED: render sites + API exist, nothing ever sends it | Producer closed: weak-areas button generates with `weakFocus: true` + focus topics |
| Mistake intelligence (`RiisheExplanation` — Riishe attempts only) | PARTIAL | Ledger added for BOTH sources; grounded explanations feed CONCEPT classification |
| Dashboard recommendations | EXISTS (deterministic `{key,title,reason,href}`) | Pattern copied; dashboard gains a learning-intelligence section |
| Planning / spaced repetition | ABSENT | Built (planner + revision ladder) |
| Riishe learning-history context | ABSENT (chat grounds on documents only) | Server-computed digest injected |
| `/api/progress` | DEFECTS: per-topic `attempts: 1` hard-coded; N+1 exam-slug loop | Fixed (real counts, one batched lookup) |
| `analyse` quota | DEFECT: defined but never reserved (phantom 30/h limit) | Enforced at upload + user-initiated retries; self-heal stays governed by job caps |
| Research quota | DEFECT: slot leaked when session create failed | Released on failure |
| Identity convention | guestId = working identity; studentId stamped by claim-guest; progress APIs guest-scoped, dashboard student-scoped | 3B tables follow the dual-ownership model; claim/export/delete extended |

## 3. Data model (spec §12)

Five new tables, all additive, all dual-ownership (`guestId` required, `studentId` stamped by claim-guest):

- **TopicMastery** — one row per (guest, catalogue topic). Unique `[guestId, topicId]`. A topic with no row is NOT_ASSESSED by definition (zero evidence is never persisted).
- **StudyPlanTask** — one task per plan slot. `planDate` (YYYY-MM-DD learner-local day key — see §17c), kind, priority, evidence-cited `rationale`, status PLANNED/COMPLETED/SKIPPED/DEFERRED.
- **RevisionScheduleItem** — one per (guest, topic): interval ladder state, lapses, next due date, weakness flag.
- **MistakeRecord** — one per (attempt, question) wrong answer with an immutable snapshot (text/options/explanation), evidence-only category, optional student self-tag/note.
- **LearningAction** — one per (guest, actionKey): dismiss/snooze/complete lifecycle + outcome snapshots.

Migration `20261121000000_phase3b_personal_learning_intelligence` is strictly additive (21 CREATE statements — no DROP/DELETE/UPDATE/ALTER). Verified per the migration ritual:

1. **Empty path:** `prisma migrate deploy` on a fresh empty DB applied all 10 migrations in order; resulting schema diff vs the datamodel is empty.
2. **Data path:** a copy of the production database was migrated directly (`prisma db execute`); record counts before/after were identical (10 categories, 77 exams, 134 stages, 226 subjects, 496 units, 1992 topics, 9487 questions, 1475 resources, 263 templates, zero user rows), and the schema diff vs the datamodel is empty.

Deployment note (honest): the production database has no `_prisma_migrations` history — it is managed with `prisma db push` (schema sync). The migration SQL files exist for provenance and are verified by the two paths above; production rollout uses the additive schema sync. No reset, no `--accept-data-loss`, production never touched from this worktree (all DB work used the isolated `db/bean-3b.db` with an explicit `DATABASE_URL` prefix on every command).

Compatibility: all five tables are added to `claim-guest` (stamping is idempotent and never overwrites another student's rows), the privacy export (new `learning` section), the student account deletion flow, and the guest data purge.

## 4. Mastery engine (spec §5) — deterministic, documented

Computation lives in `src/lib/learning/mastery.ts`. Pure functions (`buildTopicEvidence` / `accumulateTopicEvidence`, `mapMasteryStatus`) are unit-tested; the DB layer only gathers and upserts. An LLM is never in this path.

**Evidence pagination (release review §17a):** `recomputeTopicMastery` streams ALL submitted attempts of the owner in deterministic oldest→newest pages of `EVIDENCE_PAGE_SIZE = 200`, ordered by the composite `(startedAt, id)` with the unique attempt id as the seek cursor — bounded memory, no gaps, no duplicates, and no undocumented rolling window. A topic that first appears beyond attempt 200 still receives its row, and a re-answer beyond the first page still replaces the earlier outcome of the same question. Proven by a real-persistence regression test (`tests/unit/learning-mastery-pagination.test.ts`) that runs the orchestration against an isolated Prisma/SQLite database with a same-timestamp group straddling the page boundary.

Evidence rules (anti-gaming):
- Evidence = **DISTINCT answered questions**; each question's outcome is its **latest** answered result across all submitted attempts (latest answer wins). Repeating the same question can never inflate accuracy.
- Out-of-range selections are skipped (no outcome), matching the authoritative scoring engine.
- Reading documents or notes never counts — only submitted answers do.
- "One correct answer ≠ mastered": the minimum-evidence guard.

Status mapping (documented, tested):

| Status | Rule |
| --- | --- |
| NOT_ASSESSED | zero answered questions (no row persisted) |
| INSUFFICIENT_EVIDENCE | fewer than 5 distinct answered questions (accuracy shown, never banded) |
| LEARNING | < 60% over ≥ 5 distinct questions |
| DEVELOPING | 60–79% |
| STRONG | ≥ 80% |
| NEEDS_REVISION | the topic was in a band and its most recent attempt covering it scored < 60% — a real regression signal, restored by re-proving with fresh evidence |

Riishe document topics (free-text `t:` labels) are deliberately out of scope for TopicMastery (they remain with the existing weak-areas system) — a documented limitation, not a silent gap.

## 5. Diagnostic assessments (spec §4)

`src/lib/learning/diagnostics.ts` reuses the authoritative engine end-to-end:

- **Scope (release review §17b):** a diagnostic probes one TOPIC (the original form), one UNIT (chapter), one SUBJECT or one whole EXAM/syllabus area (`scopeType` + `scopeId`; legacy `topicId` requests keep working). Non-topic selections go THROUGH the topic relation (`topic → unit → subject → stage → exam`), so every selected question still carries a catalogue topic and per-topic results, mastery evidence and mistake records work identically for all four scopes. Scope metadata (`scopeType`/`scopeId`/`scopeLabel`, `topicId` mirror for TOPIC) is persisted in the attempt's `configJson`, so the four kinds are distinguishable afterwards.
- Selection is server-side from **VERIFIED bank rows only** (same safeguard constant semantics as `/api/tests/start`); answers are never exposed before submission.
- Needs ≥ 6 verified questions **in the requested scope**, takes up to 10; honest 409 otherwise — coverage is never fabricated, and unknown scope ids are 404s, not invented banks.
- Config marked `kind: 'DIAGNOSTIC'`; 1 minute per question (a mastery probe, not an exam simulation — the difference from stage-pattern practice is documented).
- One in-progress diagnostic per topic (resume instead of stacking); skipped questions count as skipped, never wrong; retests after learning are always allowed.
- Rate limit 12 starts/hour/owner; CSRF-lite on the route.
- Submission flows through the existing `POST /api/attempts/[id]`; per-topic results come free via `perTopicJson`, and the evidence hook fires like any other attempt.

## 6. Personalized planner (spec §6)

`src/lib/learning/planner.ts` (pure, tested) + `plan-service.ts` (orchestration):

- Capacity = the learner's stated `dailyMinutes` preference (post-claim), clamped 15–180 (default 30).
- Candidate priority: due/overdue revisions and NEEDS_REVISION practice (1) → diagnostics (max 1/day) → weak-topic practice (lowest accuracy first) → mistake review (max 1/day) → goal work (≤ 14 days to target) → continue in-progress analysis (3).
- Every task carries a `rationale` citing the real numbers ("43% over 12 distinct questions across 3 attempts…") and an `evidenceJson` record.
- **History rule:** regeneration deletes only PLANNED rows for the date. COMPLETED / SKIPPED / DEFERRED rows are immutable — the API rejects every mutation on them (409). Deferred tasks stay in history; rescheduling/resize apply to PLANNED tasks only.
- Per-topic dedupe prevents double-booking a topic on the same day; one schedule row per (owner, topic) prevents duplicate revision tasks.

## 7. Spaced revision (spec §7)

`src/lib/learning/revision.ts` — a deterministic SM-2-inspired ladder, documented and unit-tested:

- Ladder: 1 → 3 → 7 → 14 → 30 → 60 days (indexed by repetition count, capped).
- SUCCESS (topic accuracy ≥ 80%): repetitions + 1, interval walks up the ladder.
- PARTIAL (60–79%): interval unchanged, next due in max(2, ⌈interval/2⌉) days.
- FAILURE (< 60%): repetitions reset, lapses + 1, interval 1 day.
- Weakness signal (a REPEAT_GAP mistake — a real prior miss — or a grounded misconception explanation): the next due date is pulled to at most +1 day until a SUCCESS clears the flag.
- First real evidence creates the schedule (first revision tomorrow).
- The UI and API state plainly that this is a practical pattern, not a scientific prediction of memory.
- Due-state classification (`dueStateOf`) computes "today" in the learner's explicit timezone (§17c): overdue flips at LOCAL midnight, never at the server container's midnight.

## 8. Mistake intelligence (spec §8)

`src/lib/learning/mistakes.ts` — records are created only from real wrong answers at submit time (idempotent per attempt+question):

- **CONCEPT** requires a grounded Riishe explanation (payload `concept`/`misconception`/`revisionTopic`) for that exact attempt+question.
- **REPEAT_GAP** requires real prior misses (same question missed before, or ≥ 2 topic-level misses).
- Everything else stays honestly **UNCLASSIFIED**. FACT / FORMULA / MISREAD are never system-inferred — they exist only as student self-tags, displayed as self-reported and never overwriting the system category.
- Review shows the original question snapshot, chosen vs correct options, the explanation, the category reason, related topic link, and `timesWrong` (distinct attempts with a miss).
- Related practice goes through the existing engines (topic page / result review); PYQ vs AI-generated provenance is preserved (`source` BANK/RIISHE on every record, shown in the UI).

## 9. Next-best actions (spec §9)

`src/lib/learning/actions.ts` (pure, tested) + `actions-service.ts`:

- Fixed base priorities: REVIEW_DUE 90 · NEEDS_REVISION 85 · WEAK_TOPIC 80 · DIAGNOSTIC 70 · REVIEW_MISTAKES 65 · GOAL_WORK 60 · PLAN_TODAY 55 · CONTINUE_DOC 50.
- Evidence boosts (+5): overdue revisions; repeat-mistake volume ≥ 3.
- Outcome boost (+10): action types whose past completions measurably improved the underlying topic (accuracy snapshot captured at completion vs current computed accuracy, ≥ +5 points). Deterministic — no learned black box, no paid API.
- Lifecycle: DISMISS hides 7 days (then re-offers if evidence persists); SNOOZE hides until the date; COMPLETE hides until new evidence lands on the topic (or the next day for day-scoped actions). Every action carries an evidence-cited reason; max 5 shown.
- PLAN_TODAY is only suggested when real evidence exists — a fresh guest gets an honest empty state, not an invented nudge.

## 10. Dashboard & UI (spec §10, §14)

- New `#/learning` hub (guest AND student): today's plan (done/skip/put off/move to tomorrow/+10 min, regenerate), mastery map (status chips, accuracy, evidence counts, last activity, diagnose/practice), mistake ledger (accordion review + self-tagging), revision due, diagnostics launcher, next-best actions, stated-vs-observed insights with honesty notes.
- Dashboard gains a "Learning intelligence" section fed by the same overview API — a failure there never breaks the dashboard itself.
- All metrics come from real DB records; thin data shows honest empty states ("Nothing needed today — your evidence does not justify inventing tasks").
- Styling stays on the existing obsidian-black + champagne-gold token system (`bg-card`, `text-gold`, `font-display`, existing shadcn components); no new dependencies.

## 11. Riishe integration (spec §11)

- `POST /api/riishe/chat` injects a **server-computed** learning digest (weak topics with accuracy + distinct-question counts, thin-evidence topics, strong topics, due revisions, repeat-gap concentration, self-reported labels) into the system prompt, clearly labelled read-only. Built only from DB rows — client-supplied progress values are never trusted. Empty string when there is no data; 3A dossier grounding and the source-tag protocol are untouched.
- The deterministic engines own all computation and scheduling; Riishe only adapts explanations. Research follow-ups are unchanged.

## 12. Verified pre-existing defect fixes (spec instruction 6)

| Defect (re-verified on the merged 3A baseline) | Fix |
| --- | --- |
| `/api/progress` reported `attempts: 1` for every weak topic regardless of real coverage | Real per-topic attempt count computed during aggregation |
| `/api/progress` N+1 exam-slug loop (one query per attempt, populating a field no client read) | One batched `findMany` over the distinct exam ids |
| `weakFocus`: render + API existed; no UI ever sent it, so all three render sites were dead | The weak-areas "Practice weak areas" button now generates a real weak-focus set (`weakFocus: true` + the weak topic labels as focus topics, which do bias generation) and opens the workspace |
| `analyse` quota: defined at 30/hour but never reserved (releases were no-ops on a never-incremented counter) | Charged at upload and user-initiated retries (honest 429 before state changes); the stale-job self-heal path is system recovery, not new demand, and stays bounded by the per-owner job caps — documented |
| Research quota slot leaked when session creation failed after reservation | Reservation released on failure; held once the durable job owns the run |

## 13. Privacy & security (spec §13)

- Strict ownership: every learning query is scoped by the validated `guestId` (8–64 chars, zod); foreign rows are invisible or 404 (tested).
- **Honest identity model (release review §17d):** the learning API is guest-first — the `guestId` is an opaque bearer identifier, the SAME product contract as `/api/progress` and `/api/attempts`. These routes are therefore NOT session-bound for unclaimed guests, and the docs say so plainly. On top of the bearer contract, the existing claim model is enforced where it allows a real check: when a signed-in session exists, a guest identity CLAIMED by a different account is rejected with 403 on every learning route (reads included), while guests keep full access and a signed-in claimant keeps access. No client-supplied `studentId` exists in any learning request schema — the account side always comes from the server-side session. The Riishe chat digest withholds the learning profile under the same check (one account's profile never enriches another account's prompt).
- CSRF-lite (`sameOrigin`) on every mutating learning route; per-owner in-memory rate limits (plan regen 6/h, task updates 60/min, mistake tags 30/min, action decisions 30/min, diagnostics 12/h).
- No client-supplied progress/score value is ever trusted; mastery/plan/revision are server-computed.
- No sensitive profiling: insights are counts of activity, never health/disability/personality inferences; inactivity is never treated as low ability; nothing is shared with teachers/employers/institutions.
- Export/delete compatibility proven by tests; guests get the same purge path.
- Learning rows are private by default; the only AI surface that sees them is the student's own Riishe chat, server-side only.

## 14. Zero-budget architecture (spec §15)

No new dependencies, no external services, no workers. Five SQLite tables + deterministic TypeScript libraries + the existing Prisma/jobs/quota/Riishe infrastructure. AI involvement is limited to the existing Riishe chat/generation/explanation surfaces (existing quotas unchanged in size).

## 15. Verification evidence (spec §16)

- `bun test` (at original implementation): **841 passed / 0 failed** across 58 files (baseline on `ba80d98`: 777 passed / 0 failed). Release review re-run: **888+ passed / 0 failed** across 62+ files — see §17 and docs/PHASE3B_CORRECTIONS_RELEASE_REVIEW.md for the final numbers.
- `bunx tsc --noEmit`: clean. `bun run lint`: clean.
- `prisma migrate deploy` (empty path) + additive migration on a production-data copy (record-survival verified above).
- No secrets committed (`.env`, DB files and uploads stay untracked); no production data in the repository.
- Browser E2E: see worklog entry — dev server verification with real flows (diagnostic start → runner → submit → mastery/mistakes/revision updates → plan/actions → dashboard section), responsive checks at 390/768/1280 px. AI-provider-dependent flows are only verifiable live; mocked tests above prove the deterministic paths.

## 16. Honest limitations

- TopicMastery covers catalogue topics only; Riishe document topics stay in the existing weak-areas surface.
- Mastery evidence uses the latest outcome per distinct question — it measures current standing, not effort.
- The revision ladder is a heuristic pattern, not a memory model; intervals are intentionally simple.
- Planner "week view" is a projection (today's plan + due revisions), not persisted future plans — future days are generated when they arrive.
- Outcome boost is a small deterministic signal (+10), not a learned ranking system.
- The analyse-quota self-heal path is intentionally uncharged (system recovery); it is bounded by per-owner job caps, and this asymmetry is documented rather than hidden.
- `/api/student/dashboard` remains studentId-scoped by its original doctrine; the learning section reads via the guest-scoped learning API so both guests and students see the same intelligence.

## 17. Release-review corrections (2026-11-21)

Four targeted corrections were applied to the SAME feature branch (the original implementation commit `4ed712f` is preserved untouched; corrections are a follow-up commit). Full evidence: `docs/PHASE3B_CORRECTIONS_RELEASE_REVIEW.md`.

**a. Mastery evidence pagination (critical fix).** The original orchestration read `take: 200` oldest attempts — permanently excluding newer evidence beyond that limit. Replaced with deterministic cursor pagination over ALL submitted attempts (see §4). A real-persistence regression test with 212 attempts (a same-timestamp group straddling the page boundary) proves: latest attempt updates a first-page question's outcome, a topic first appearing after attempt 200 gets its row, counts and the NEEDS_REVISION regression rule stay exact, and pagination loses/duplicates nothing.

**b. Diagnostic scope extension.** TOPIC / UNIT / SUBJECT / EXAM scopes added (spec §4 originally included chapters, subjects and syllabus areas). Engine reuse is complete: server-authoritative selection, VERIFIED-only, no answers before submission, honest 409 on thin coverage, resume-not-stack per scope, rate limits unchanged. Limitations stated rather than faked: unit/subject/exam diagnostics deliberately select only questions that HAVE a catalogue topic (topic-less rows would silently contribute nothing to per-topic results); scope coverage is derived in the overview UI only from the learner's thin-evidence topics (no invented global catalogue browsing).

**c. Timezone policy.** All day-keyed surfaces (daily plan date keys, revision due/overdue classification, observed-activity day grouping) now compute "today" in an EXPLICIT timezone. Product default: **Asia/Kolkata** (the app's exam audience; fixed +05:30, no DST — stable boundaries year-round). The client passes its own IANA zone as an explicit learner timezone (`tz` param); the server validates it (charset + `Intl` check) and falls back to the product default — the accidental host/container zone is never consulted. Tests pin the IST midnight boundary (18:30 UTC), DST zones, calendar-key arithmetic (leap years), and the wrong-local-hour regression (a revision due during an IST day must read OVERDUE at 00:30 IST, not flip at UTC midnight).

**d. Ownership hardening.** `assertLearningOwner` guards all nine `/api/learning/*` routes and the Riishe chat digest: guest-bearer operation is preserved (documented product contract), and the claim model is enforced where it allows a real check — a signed-in session that does not match a claimed identity's claimant gets 403 (reads included) before any row mutation. No client-supplied `studentId` exists anywhere; claim/export/delete compatibility is untouched.

**Operational note discovered during the review (DB footgun):** in this sandbox the Prisma CLI does not load `.env` files — a `prisma db push` without an explicit `DATABASE_URL` env var silently no-ops ("already in sync" while writing nothing). This is exactly the class of shell-level ambiguity behind the disclosed Phase 3B incident (see `docs/PHASE3B_CORRECTIONS_RELEASE_REVIEW.md` §5 for the closure note). Rule going forward: every DB-touching command carries an explicit `DATABASE_URL` prefix; `.env` is relied on only for the Next dev server (Next loads it itself).
