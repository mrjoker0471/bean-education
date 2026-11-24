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

## Part 2 — dispute and administrator review walkthrough (CI-2E delivered)

Executed with `scripts/ci2-walkthrough-browser2.sh` (+ focused gap-closing passes in `scripts/ci2-walkthrough-browser4.sh` / `-5.sh`; raw logs in `docs/ci2-browser*.txt`). The dispute lifecycle below is the REAL browser flow on the seeded fixture — every decisive step is also confirmed by the append-only event history in the database:

1. **Administrator review queue** — admin signs in → Trust Center → new **Classroom Intelligence** tab → review queue lists the pending dispute with class reference, disputed finding ids and SUBMITTED status.
2. **Review workspace** — Review opens the workspace: the teacher's explanation, the ORIGINAL evaluation (report version, engine provenance, all agent findings), the evidence register (available/unavailable markers), the agent-run audit rows and the append-only case history.
3. **Human decision** — Assign to me → Decide → UPHELD with a mandatory documented note → the dispute moves to Closed with its resolution recorded (`RESOLVED — UPHELD — Human review: …` in the event history).
4. **Teacher dispute creation through the UI** — teacher opens the evaluated report → "Dispute a finding" → the dialog shows the human-review disclosure ("Disputes go to authorised BEAN administrators — never to an AI"), the finding radio list, and a bounded reason → submit → POST `/api/teach/classroom-intelligence/reports/:id/dispute` returns 200 and the new dispute appears as SUBMITTED in "Your disputes".
5. **Teacher governance** — the dispute history dialog states plainly: *"You cannot change an administrator's decision; you may request ONE reconsideration on a closed dispute, decided by a different administrator."* The teacher UI has NO decision controls.
6. **Reconsideration (the appeal)** — teacher requests reconsideration with a documented note → the dispute returns to SUBMITTED with a `RECONSIDER_REQUESTED` event; the teacher's one-appeal limit is enforced server-side.
7. **Reviewer separation** — the original decision-maker's "Assign to me" is refused by the server (403, honest refusal surfaced in the UI as "Action refused — The administrator who made the original decision cannot review this reconsideration"); a SECOND administrator (granted via the operator CLI) then reviews and resolves the reconsidered case (UPHELD with a documented note).
8. **Mobile** — the teacher's disputes section renders and is reachable at 390×844.

Append-only event chain in the database for the fixture dispute: `SUBMITTED → ASSIGNED → RESOLVED (UPHELD) → RECONSIDER_REQUESTED → ASSIGNED (admin B) → RESOLVED (UPHELD)` — six events, nothing rewritten.

### Additional screenshots (part 2)

| File | Shows |
| --- | --- |
| `1440-admin-ci-queue.png` | Administrator dispute queue |
| `1440-admin-review-workspace.png` / `-b.png` | Review workspace: original evaluation + evidence register |
| `1440-admin-ci-decision-recorded.png` | Decision recorded (UPHELD, Closed section) |
| `1440-admin-b-resolution.png` | Second administrator resolving the reconsidered case |
| `1440-admin-reviewer-separation-refusal.png` | Honest 403 refusal for the original decision-maker |
| `1440-teacher-dispute-dialog.png` | Dispute dialog with human-review disclosure |
| `1440-teacher-dispute-submitted.png` / `-b.png` | New dispute listed as SUBMITTED |
| `1440-teacher-dispute-ui-created.png` | UI-created dispute |
| `1440-teacher-dispute-history.png` | Governance wording + append-only history |
| `1440-teacher-disputes-list.png` | Both disputes with statuses |
| `390-teacher-disputes.png` | Mobile disputes experience |

### Findings recorded during part 2 (and fixed)

- The auth screen's sign-in switcher was unreachable by substring `--name` matching (the header's "Sign in or create an account" matches first) and the whole auth view re-renders on a 4s Google-status poll, detaching elements between find and click — the walkthrough login now takes fresh accessibility refs and verifies the panel state (no application change needed; walkthrough hardening only).
- Dialog content checks must read `body` (Radix portals mount outside `<main>`), and the dispute dialog needs a tall viewport for its footer button — walkthrough-only adjustments.
