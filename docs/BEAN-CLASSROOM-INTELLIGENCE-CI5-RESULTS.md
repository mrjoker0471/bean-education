# CI-5 RESULTS — Human Expert Validation & Real-World Intelligence

> Milestone: CI-5 · Branch `feat/bean-classroom-intelligence-ci5` · Baseline main
> `7ccf355986c0cab738cb705e11b87f97c25a5c32` (PR #44 merge). Every claim below
> distinguishes **Implemented / Tested / Browser-verified / Expert-reviewed /
> Human-approved / Benchmark-verified / Limited / Experimental / In review /
> Unsupported / Deferred**. Nothing is claimed as complete that is not.

## 1. Exact baseline and final SHAs

| Item | Value | Verification |
|---|---|---|
| Baseline main | `7ccf355986c0cab738cb705e11b87f97c25a5c32` | ls-remote == fetch == worktree checkout |
| CI-5A | `64ca6adc24f11ec52bf44f3bec59ef7fa7376125` | pushed + ls-remote (branch tip `42684211…` at the time) |
| CI-5B | `4dd24232105fd7aa6f4d9e8d12091aef12252ffd` | pushed + ls-remote (tip `f6795cd…`) |
| CI-5C | `8cd874a98d988db0aa03dfd03d19090ab84065a4` | pushed + ls-remote (tip `ea62de4…`) |
| CI-5D | `17984777dfcce3a3767780f0f38a628dfada5989` | pushed + ls-remote (tip `20e5fcc…`) |
| CI-5E | `07cc5d4b05499d064687e3849d5a64cdeb0d9879` | pushed + ls-remote (tip `a4bcf78…`) |
| CI-5F | `f6742f5abdeaa0931012e1e4e3f82ae7c632fa44` | pushed + ls-remote (tip `dd58974…`) |
| CI-5G | `42a90ad6a540a1dd9793c4b46e5e6fc97a5b3b6e` | pushed + ls-remote (tip `dbd6454…`) |
| CI-5H | this commit | pushed + ls-remote immediately after commit |
| Final branch tip | the CI-5H ledger commit's SHA | ls-remote verified at push |

Every unit followed the per-unit policy: inspect diff → targeted tests → commit
→ push → **independent `git ls-remote` verification** → ledger update. No
force-push, no rebase, no history rewrite, no branch deletion anywhere.

## 2. Reviewer workflow implementation — IMPLEMENTED + TESTED

- **CI-5B** (`reviewers.ts`, migration `20261125120000`): `ExpertReviewerProfile`
  + append-only `ExpertReviewerEvent`; strict transition table
  (APPLICATION_PENDING → QUALIFICATION_REVIEW → APPROVED → ACTIVE with
  SUSPENDED/EXPIRED/REVOKED/REJECTED); lazy SYSTEM-attributed expiry; reasons
  required for suspension/revocation; self-review impossible; minimal
  verification results (UNVERIFIED can never approve); no identity documents or
  government ids stored; DOMAIN_EXPERT (exact domainIds) and
  BILINGUAL_LANGUAGE (exact tag/task/domain scopes; TRANSCRIPTION refused at
  every scope write). 22 tests.
- **CI-5C** (`assignments.ts`, migration `20261125130000`):
  `ExpertReviewAssignment` + append-only events; creation gates (ACTIVE +
  exact scope match + mandatory admin COI check + one-open-slot +
  decided-version independence); lifecycle ASSIGNED→IN_PROGRESS→SUBMITTED→
  COMPLETED with RECUSED/EXPIRED(lazy SYSTEM)/CANCELLED/REASSIGNED
  (validated-first — a failed reassignment never leaves a subject unassigned);
  assignments carry no decisions (outcomeRef to the authoritative ledgers).
  18 tests.
- **CI-5D** (`domain-rubric.ts` + curator strengthening, no new migration):
  qualification-gated promotion (APPROVED requires server-computed
  `qualifiedApproverIds` — ACTIVE reviewer scoped to the exact domain; admins
  keep conservative work-states, can never substitute for experts); A–F
  rubric with decision-vs-rubric consistency; rubric JSON stored INSIDE the
  append-only `ClassroomPackReview` evidence (single authority, no bypass
  API); expert submit route with ownership + ACTIVE + checksum freshness;
  independent adjudication (distinct scoped adjudicator, real disagreement,
  exactly-once, audit-only). 11 tests + updated CI-4C suite (8).
- **CI-5E** (`language-governance.ts`, migration `20261125140000`): the CI-5A
  critical discovery CLOSED — durable measurements/reviews/status replace the
  process-local store; the `humanApproved` self-certification flag and the
  in-memory approval function REMOVED; VERIFIED only via qualified, scoped,
  ACTIVE bilingual review bound to the EXACT measurement; 13-facet checklist;
  model/benchmark change ⇒ new binding + SUPERSEDED; revocation
  history-preserving; TRANSCRIPTION structurally unreachable everywhere.
  16 tests + updated CI-3F (16) and CI-4F (6) suites.
- **CI-5F** (`expert-benchmarks.ts`, migration `20261125150000`): immutable
  dataset versions + expert reference labels (multi-answer, prohibited
  conclusions, disagreement preserved) + honest metrics runs with sample
  sizes; BLIND_HOLDOUT sealed; leakage prevention structural; regression
  comparison across model versions. 11 tests.
- **CI-5G** (`report-audit.ts` + governance UI, migration `20261125160000`):
  privacy-masked classroom-report audit pilot; checksum-bound; corrections as
  new rows; Evidence Auditor findings preserved; disputes untouched; admin +
  reviewer workspaces on real APIs. 8 tests.
- **CI-5H** (`re-review.ts`, migration `20261125170000`): renewal-demand
  lifecycle (8 triggers mapped honestly, duplicates refused, reasoned
  resolution); model-context capability resolution (a VERIFIED binding is
  never valid for a different model); audit-history export; the empty-pack-
  registry production bug found by the browser walkthrough FIXED
  (`packs/registry.ts` bootstrap). 10 tests.

## 3. Qualification verification evidence — IMPLEMENTED + TESTED; EXPERT-REVIEWED: none (honest)

The verification model records minimal results (DOCUMENT_REVIEWED /
REFERENCED_VERIFIED) with issuing body and notes; originals are never stored.
**No real qualification has been verified** — every profile in the test suite
is a clearly-labelled synthetic fixture, and the production registry starts
empty.

## 4. Domain review decisions actually recorded — WORKFLOW VERIFIED; REAL DECISIONS: 0

- Tests: qualified rubric-backed approvals verified the mathematics pack and
  the HIGH_STAKES health pack (two distinct qualified reviewers) on isolated
  DBs; disagreements, rejections and work-states recorded honestly.
- **Browser-verified (real dev server, real DB)**: the walkthrough reviewer
  `BR-walkthrough` (clearly labelled fixture) submitted a rubric-backed
  APPROVED for `mathematics-statistics` v1.0.0 through the real route —
  append-only row created, assignment COMPLETED with outcomeRef, pack curated
  VERIFIED with 1 distinct qualified approval (verified via the live API).
- Production/main state: **all 12 packs remain IN_REVIEW** — the walkthrough
  decision lives in the disposable dev database only. No real expert has
  reviewed a real pack.

## 5. Language approval decisions actually recorded — WORKFLOW VERIFIED; REAL DECISIONS: 0

Durable approvals proven in tests (golden VERIFIED, supersession, revocation)
and the restart-durability proof (second PrismaClient). Zero real bilingual
reviewers exist; zero real approvals recorded. The specialist runtime now
resolves capabilities through the DURABLE store with the current adapter as
model context.

## 6. Durable measurement and approval storage proof

- Structural: three additive tables; the process-local store no longer holds
  VERIFIED-capable state (source guards assert no DB import in the default
  view and no in-memory approval function).
- Behavioural: second-PrismaClient restart proof (CI-5E LG5) and the full
  ledger restart check (CI-5H H5).

## 7. Expert-labelled dataset and benchmark methodology — IMPLEMENTED + TESTED; REAL LABELS: 0

Immutable versions + checksums + licence records; 12 task kinds; 4 splits
with sealed holdouts; expert labels with accepted alternatives, prohibited
conclusions, confidence and ambiguity; disagreement preserved. Zero real
expert-labelled datasets — the seed datasets in tests are BEAN-authored
fixtures.

## 8. Measured specialist performance with sample sizes — BENCHMARK-VERIFIED infrastructure; PRODUCTION MEASUREMENTS: none

No model adapter credentials exist in this deployment: every harness run
records `ran=false` with the honest reason rather than fabricating numbers.
The test suite proves the metrics machinery (expert-scored + deterministic
scoring, prohibited-conclusion detection, sample-size honesty, exclusion
reporting, regression deltas). **No production accuracy percentage is claimed.**

## 9. Reviewer agreement/disagreement — IMPLEMENTED + TESTED; REAL DATA: none

`detectReviewDisagreement` on every pack decision; both opinions preserved,
never averaged, never silently favourable; independent adjudication recorded
audit-only; fixture disagreement proven in tests (two labels, two pack
decisions).

## 10. Classroom pilot evidence — IMPLEMENTED + TESTED; REAL AUDITS: 0

Masked evidence view (student data removed server-side at read time),
UNOBSERVABLE dimensions honest, checksum-bound audits, corrections as new
rows, Evidence Auditor findings preserved, disputes untouched. The pilot
fixture is synthetic and clearly labelled. No real report audited yet.

## 11. Privacy and security results

- Reviewer identity, qualifications, scopes, assignments, decisions,
  capability status and audit timestamps are all SERVER-controlled; client
  payloads cannot set them (strict schemas; forged fields refused — tested).
- No new client-trusted field anywhere; every actor is session-resolved.
- Report audits mask student data before it reaches any reviewer surface
  (tested: masked strings absent from the payload).
- Sensitive qualification evidence is never stored (minimal-result model).
- Account export/deletion: audit rows survive deletion by design (no FK) —
  tested; the existing export/deletion behaviour is untouched.
- No agent/model output can alter reviewer assignments or approvals (the
  routes are session-gated; machines have no session — CI-4 rule intact).
- The CI-4 gates re-proven intact at CI-5H: checksum-bound approvals,
  terminal rejection, distinct-reviewer counts, TRANSCRIPTION `z.literal(false)`
  + §9.2 refusals at every layer, fleet auto-dispatch default-off.

## 12. Screenshots (real browser, real dev server)

`docs/screenshots/ci5-governance/`:
- `1440-admin-reviewers.png`, `1440-admin-assignments.png`,
  `1440-admin-language.png` — admin governance workspace (registry with the
  labelled fixture reviewer, assignment queue, the durable 11×5 language grid)
- `1440-reviewer-workspace.png`, `1440-reviewer-completed.png` — reviewer
  workspace before/after the golden-path submission (assignment ASSIGNED →
  IN_PROGRESS → COMPLETED)
- `768/390/320-admin-reviewers.png`, `768/390/320-reviewer-workspace.png` —
  responsive set; **no horizontal overflow at 320 px** (verified
  programmatically in the browser).

## 13. Full tests and production build

| Gate | Result |
|---|---|
| Full Bun suite (`bun test --isolate`, isolated SQLite per file) | **1677 pass / 0 fail across 118 files** (baseline 1563/110 → +114 CI-5 tests) |
| Lint (`bun run lint`) | clean |
| TypeScript (`tsc --noEmit`) | clean |
| Prisma validate | valid |
| Migrations (`prisma migrate deploy` on a fresh DB) | ALL migrations applied (5 additive CI-5 migrations) |
| Production build (`bun run build`) | exit 0 |

## 14. Every commit and remote SHA verification

See §1 — every unit commit was pushed immediately and verified with a fresh
`git ls-remote`; the ledger records the verified branch tip per unit. The
final ledger commit is verified the same way after push.

## 15. GitHub Actions run results

Recorded from the GitHub UI (the sandbox API is rate-limited): the branch
pushes trigger the BEAN Education CI workflow (install → prisma → lint →
tsc → `bun test --isolate` → migrations → production build). The owner
verifies the runs on the PR; the same pipeline gates merge. Per repo policy
the PR is opened through the owner session.

## 16. PR and merge status

Branch `feat/bean-classroom-intelligence-ci5` pushed and verified; CI-5 is
recorded in the ledger as PUSHED/PENDING — **CI-5 is COMPLETE only when the
implementation is in main and verified there** (the close-out ledger commit
follows the owner's normal review + merge, exactly as CI-3/CI-4 did).

## 17. Remaining gaps (honest)

1. **No real expert reviewers / no real qualifications verified** — the
   registry is empty on production data; every workflow exercise used clearly
   labelled synthetic fixtures.
2. **No real domain-pack decisions** — all 12 packs remain IN_REVIEW; the
   first-wave candidates (mathematics, education, physics, computing,
   engineering) have the workflow ready and wait for qualified humans.
3. **No real language approvals** — zero VERIFIED capabilities BY DESIGN; the
   durable governance makes the eventual approvals durable, qualified,
   scope-bound and auditable.
4. **No real benchmark measurements** — no model credentials; every
   model-dependent metric would be fabricated, so none is published.
5. **No real classroom-report audits** — the pilot fixture is synthetic;
   real audits require authorised reviewers and applicable consent.
6. **Model-version context uses the adapter id** (provider-level) — the CI
   adapter does not expose a model version string; when it does, the same
   binding machinery applies unchanged.
7. Deferred: Google-OAuth round-trip browser verification (no credentials in
   the sandbox — unchanged from CI-3/CI-4/pos).

## Final classification summary

| Classification | Items |
|---|---|
| Implemented | all CI-5A–5H units (reviewer governance, assignments, domain validation, durable language governance, benchmark programme, pilot + UI, re-review lifecycle, audit export) |
| Tested | 114 new CI-5 tests across 9 files; full suite 1677/0 |
| Browser-verified | admin governance workspace, reviewer workspace, golden-path submission, responsive layout at 1440/768/390/320, no 320px overflow |
| Expert-reviewed | none (no real experts available) |
| Human-approved | walkthrough fixture decision on the disposable dev DB only; production packs remain IN_REVIEW |
| Benchmark-verified | metrics infrastructure; zero production measurements |
| Limited | every language capability (machine evidence at best; model-context aware) |
| Experimental | unmeasured catalogue defaults |
| In review | all 12 domain packs (declared IN_REVIEW) |
| Unsupported | TRANSCRIPTION for all 11 languages (structural, §9.2) |
| Deferred | real expert recruitment, real model measurement, real report audits, adapter model-version exposure |
