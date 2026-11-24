# Classroom Intelligence CI-2 — Results and Final Acceptance Report

Milestone: CI-2 · Branch `feat/bean-classroom-intelligence-ci2` · Base: verified `origin/main` = `e5782af5080e4b008748088fe7fc6e7de8368e01` (the merge of CI-1 PR #32, verified live via `git fetch` + `git log` before any work started; CI-1's reported tip `adc1100` confirmed as the ledger commit on that merge).

CI-2 was delivered as independently verified, individually pushed milestones. Nothing was batched at the end; every unit below was committed and pushed immediately after its own verification, with the remote SHA checked via `git ls-remote` each time.

## Commits (all pushed; remote tip verified)

| SHA | Unit | Contents |
| --- | --- | --- |
| `1756e58` | CI-2A (part 1) | seeded walkthrough fixtures + real-pipeline evaluation runs; agent-browser authenticated walkthrough (student/teacher/admin); 9 server-side ownership denials verified; 12 genuine screenshots; browser-verification doc |
| `803928f` | CI-2B | 12 expert-reviewed reference fixtures; deterministic quality harness (16 tests); live-provider harness (23/23 findings grounded, F12 abstention, 0 prohibited hits); orchestrator fix (flagged findings can no longer inflate the category table); `completeJson` error contract fix |
| `8c03d80` | CI-2C | teacher improvement intelligence: deterministic per-subject trends (coverage ratios, sample-gated directional signals, recurring suggestions, missing-evidence separation, static development catalogue), trends API + Growth-over-time UI (10 tests) |
| `69ba493` | Branding (owner-requested) | supplied BEAN artwork adopted as the single brand source; header lockup rebuilt; old text wordmark removed everywhere; favicon repointed; verified at 1440/768/390 with before/after screenshots |
| `6dc2986` | CI-2D | student learning experience: deterministic learning links from class summaries to existing BEAN surfaces (syllabus topics, exam practice, Revision planner, curated resources with `matchedOn` provenance), full review history (6 tests) |
| `267fe65` | docs | milestone ledger sync (push verification recorded) |
| `cfbd1bb` | CI-2E | dispute experience + administrator trust review: teacher dispute dialog + disputes section, ONE reconsideration (appeal) with server-enforced reviewer separation and self-review refusal, admin Classroom Intelligence tab (queue, review workspace, UPHELD/CORRECTED/RETRACTED/DISMISS with mandatory notes), admin report-inspection route (5 tests) |
| `0e6f10f` | CI-2A (part 2) | dispute + administrator review browser walkthrough: queue/workspace/evidence verified, UPHELD decision recorded, UI dispute creation (POST 200), reconsideration appeal, reviewer-separation refusal surfaced honestly, second-admin positive path, teacher governance wording; 15 new screenshots |
| `6a18cb2` | CI-2F | 13-scenario reliability suite (6 tests); enqueue P2002 race hardened; measured load benchmark 4→32 classes × 1→8 concurrency (zero double claims, flat RSS, SQLite serialised-writes boundary documented) |
| `cefe751` | CI-2G | 8-test consolidated security audit (ownership incl. trends, admin-only inspection, dispute scoping, export completeness extended with dispute event history, deletion cascades verified row-by-row, session refusal, log-minimisation scan, DTO exposure assertions); privacy doc security-evidence section |

## Verification status

**Implemented, tested and pushed** (1339 tests / 94 files, 0 fail; ESLint clean; `tsc --noEmit` clean; `prisma validate` valid; production build green; runtime smoke: `/` 200, `/api/auth/me` 200, protected CI endpoints correctly 401 anonymous):

- Every commit above was pushed and the remote tip re-verified with `git ls-remote` at the time of pushing.

**GitHub Actions (verified via the Actions HTML, the repo's established convention):** runs for `cfbd1bb`, `6a18cb2`, `cefe751` and the branch tip `0e6f10f` all read `WORKFLOW_RUN_CONCLUSION_SUCCESS`. The intermediate docs-only commit `267fe65` shows CANCELLED (superseded by the next push; its content is contained in the passing tip run). Runs for the four earliest commits have aged off the filtered Actions view; their content is fully contained in the passing tip run.

**Browser-verified (genuine agent-browser sessions, real sign-ins, screenshots in `docs/screenshots/ci2/`):** student walkthrough (bookings, summaries, scope note, mobile), teacher walkthrough (disclosure, consent pause/re-enable, report categories/evidence/versions, trends, dispute dialog, disputes list, mobile), administrator walkthrough (Trust Center + new Classroom Intelligence tab, review workspace with original evaluation + evidence register + agent-run audit, UPHELD decision with documented note, reviewer-separation refusal shown honestly, second-admin positive path), server-side ownership denials (9 real authenticated HTTP checks), UI dispute creation (POST 200 confirmed in DB).

**Live-provider-verified:** two real end-to-end evaluations during fixture seeding (both COMPLETED); the CI-2B live harness subset (F01/F05/F12 — 23/23 findings grounded, honest abstention on F12, zero prohibited content).

**Known honest limitations:** the dispute-dialog walkthrough needed hardened click tooling (the auth view re-renders on a 4s Google-status poll and Radix dialogs portal outside `<main>` — walkthrough-only adjustments, no product change); the CI-2B reference dataset is synthetic and small (12 fixtures, 3 live) — a spot-check, not universal accuracy; the load benchmark uses a deterministic stub adapter (queue mechanics measured; live-provider throughput at 32-class scale not measured); CI-2D deliberately does not synthesise definitions/formulas per class (no transcript evidence exists — links point to the authoritative existing notes instead).

## Individualisation boundary (preserved)

Student reports remain class-level with the fixed scope note. Nothing in CI-2 infers individual understanding, attention or mastery; no public rankings exist for students or teachers; AI observations are never converted into verified reviews; trends are teacher-private, sample-gated, per-subject, and dispute-linked.

## Deferred / not done

- Multi-process scale-out (beyond one sequential worker per process) was simulated at the claim level only.
- A live-provider 32-class burst benchmark was not run (provider cost/latency; the stub benchmark isolates queue mechanics instead).
- No payments activation, no audio/video recording, no transcription — unchanged from CI-1 (the milestone forbids scope expansion).
- PR opening and merge remain with the repository owner per the established owner-session workflow (compare URL in the ledger; the branch passes CI on its tip).
