# Classroom Intelligence CI-2A — Authenticated Browser Verification

Milestone: CI-2 (branch `feat/bean-classroom-intelligence-ci2`, started from verified `origin/main` = `e5782af5080e4b008748088fe7fc6e7de8368e01`, the merge of CI-1 PR #32).

CI-1's completion report explicitly listed the authenticated, seeded browser walkthrough as not performed. CI-2A closes that gap using the repository's existing browser-testing convention (`agent-browser` CLI, as in `scripts/verify-browser*.sh`) — no new test dependencies were introduced.

## What was verified

Everything below was executed against the real dev server (port 3000) serving the CI-2 branch, with real sign-ins, real sessions and the real evaluation pipeline. Full step-by-step log: `/tmp/verify/ci2-browser.txt` (transcribed into this document); reproducible via the two committed scripts.

### Fixture seeding (`scripts/ci2-walkthrough-seed.ts`)

Isolated demo accounts (all passwords `bean-ci2-demo`, QA-labelled data on the dev database only):

| Account | Role | Fixtures |
| --- | --- | --- |
| `ci2-teacher@bean.test` | APPROVED teacher | CI consent granted; 5 ended classes |
| `ci2-student@bean.test` | Student | ATTENDED bookings on classes A/A2/B/D, NO_SHOW on E |
| `ci2-outsider@bean.test` | Unrelated student | no bookings (cross-access denials) |
| `ci2-admin@bean.test` | ADMIN | for the trust-review walkthrough |
| `ci2-mate1/2@bean.test` | Students | extra attendees for realistic aggregates |

Classes: **A** "Quadratic equations — intuition first" (whiteboard snapshot + teacher notes), **A2** "Introduction to fractions — visual first" (no notes, no whiteboard), **B** "Trigonometry basics" (never evaluated), **D** "Reading the exam paper carefully" (attended, not evaluated), **E** "Geometry past-paper drill" (student no-show).

**Classes A and A2 were evaluated by the REAL multi-agent pipeline with the REAL server model provider** (enqueue → claim → run; both jobs COMPLETED). No report content was hand-written. The script also seeds one honest teacher dispute against a real finding id of report A v1 (fixture for the dispute walkthrough completed in CI-2E).

### Student walkthrough (desktop + mobile) — all verified in a real browser

- Sign in as the test student → lands in the app.
- `My bookings` lists the attended classes, the honest `no-show` booking, and the **Class learning summaries** section (2 summaries).
- Opening a summary shows: *What this class covered*, **Concepts covered** badges, **Suggested practice**, and the fixed class-level scope note ("…the same for everyone who attended this class and is not an assessment of any individual student").
- Revision recommendations appear only when the evidence supports them — for these two fixtures the Learner Agent honestly produced none (its summaries describe only what aggregate evidence supports). Recorded as an honest absence, not a defect.
- Mobile viewport (390×844) renders the same flow correctly.

### Server-side ownership denials (real authenticated HTTP calls)

| Attempt | Result |
| --- | --- |
| Unrelated student → own summaries list | `200` with `summaries: []` — **no cross-student rows** |
| Student → teacher CI endpoint | `403` |
| Student → admin CI dispute queue | `403` |
| Student → teacher-only class evaluation | `403` |
| Owner teacher → own class evaluation | `200` |
| Outsider → delete a teacher's report | `403` (role gate) |
| Anonymous → summaries | `401` |
| Outsider → dispute another teacher's report | `403` (role gate) |
| Admin → dispute a teacher's report | `403` (admins are not teachers) |
| Login burst during testing | `429` — the login rate limiter genuinely fired during repeated walkthrough runs |

### Teacher walkthrough (desktop + mobile)

- Sign in as the approved teacher → `Teacher dashboard` → **Classroom Intelligence** tab.
- AI disclosure is visible ("…never records audio or video, never transcribes speech, and never sees individual students' behaviour").
- Evaluated classes (2) with review-flag badge; ended-but-unevaluated class listed as eligible.
- **Consent control verified live**: `Pause evaluations` shows the paused banner (withdrawal stops future evaluations); `Enable evaluations` re-enables.
- Report v1 opens: lesson summary, strengths/improvements, **ten-category evaluation table**, objectives covered/unverifiable, evidence register, version + engine provenance.
- Dispute status is available via the dispute API (the seeded dispute is listed with its append-only history). **The dispute creation/review UI did not exist in CI-1** — this walkthrough surfaced that gap; the teacher dispute UI and the administrator review UI are delivered in CI-2E, after which the dispute walkthrough (CI-2A part 2) was executed.

### Administrator walkthrough (part 1)

- Sign in as admin → `#/admin/trust` renders the Trust Center.
- The CI dispute queue is reachable and returns the pending dispute with history (API-level). The dedicated CI review workspace ships in CI-2E and was then browser-verified (see below).

## Screenshots (genuine authenticated captures)

Stored under `docs/screenshots/ci2/`:

| File | Shows |
| --- | --- |
| `1440-student-bookings.png` | My bookings + Class learning summaries (desktop) |
| `1440-student-summary-open.png` | Expanded class-level summary with scope note |
| `1440-student-home.png` | Post-sign-in home (desktop) |
| `1440-teacher-ci-dashboard.png` | Teacher CI tab: disclosure + evaluated/eligible classes |
| `1440-teacher-ci-paused.png` | Consent paused state |
| `1440-teacher-evaluation-report.png` | Evaluation report v1: categories, evidence, provenance |
| `1440-teacher-evaluation-report-b.png` | Second evaluated class report |
| `1440-admin-trust-center.png` | Administrator Trust Center |
| `390-student-bookings.png`, `390-student-summary-open.png` | Mobile student experience |
| `390-teacher-ci-dashboard.png`, `390-teacher-report.png` | Mobile teacher experience |

## Reproduction

```bash
bun scripts/ci2-walkthrough-seed.ts          # seed fixtures + run REAL evaluations
bash scripts/ci2-walkthrough-browser.sh      # the browser walkthrough (log: /tmp/verify/ci2-browser.txt)
bun scripts/ci2-walkthrough-seed.ts --clean  # remove all ci2 fixtures
```

## Honest limitations

- The evaluation content in the fixtures was produced by the live model provider; a different run produces different wording. What is deterministic is the pipeline behaviour (schema validation, evidence register, versioning), not the prose.
- The seeded dispute fixture is created directly against a real finding id so the review walkthrough has stable data; dispute creation through the UI is exercised in CI-2A part 2 / CI-2E.
- Login rate limiting (10 attempts / 5 min) applies to the walkthrough too; runs spaced ≥5 minutes apart succeed (observed 429s are recorded above as genuine behaviour).
