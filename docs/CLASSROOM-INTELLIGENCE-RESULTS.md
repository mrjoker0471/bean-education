# BEAN Classroom Intelligence — Results & Acceptance Report (CI-1F)

**Branch**: `feat/bean-classroom-intelligence` (based on verified
`origin/main` = `bb12daa…`)
**Report date**: 2026-11-23 · **All figures below are measured or verified —
nothing is projected.**

---

## 1. What was actually implemented

| Milestone | Delivered | Commit (pushed & SHA-verified) |
|---|---|---|
| CI-1A | Open-source research (LiveKit Agents / LangGraph / CrewAI, licences verified live) + architecture & compatibility report | `ec0f8be` |
| CI-1B | Agent runtime: additive migration (7 tables), durable evaluation queue (CAS/lease/heartbeat/bounded retries), authorised evidence service, consent gate, lifecycle triggers wired into live/end + webhook | `26e3789` |
| CI-1C | BEAN Learner Agent, BEAN Teacher Judge Agent (10 categories), pure deterministic Evaluation Orchestrator, Zod output schemas, pipeline publish with versioned reports | `6055a3d` |
| CI-1D | Teacher/student report APIs + Classroom Intelligence UI (teacher tab, student summaries), strict server-side ownership | `fd281f8` |
| CI-1E | Disputes + admin human review (UPHELD/CORRECTED/RETRACTED), report deletion guardrails, consent withdrawal handling, export/deletion integration, privacy & security doc | `22d952c` |
| CI-1F | Production build, benchmarks, results/acceptance documentation, future-payments boundary, API reference | this commit |

Architecture decision: **BEAN-native multi-agent pipeline** — LiveKit Agents
(Python worker + STT) rejected for CI-1 with documented reasons; LangGraph
rejected (duplicates BEAN's durable job semantics); CrewAI rejected
(persona mismatch, Python-only). Model access behind a swappable adapter.
Full rationale: `docs/CLASSROOM-INTELLIGENCE-OPEN-SOURCE-RESEARCH.md`.

## 2. Live end-to-end verification (real provider, real database)

Two independent full-pipeline runs against the LIVE configured provider on an
isolated SQLite database (script: `scripts/bench-ci-pipeline.ts`, operator
runnable). Each run: consented teacher → ended class with 3 bookings
(2 ATTENDED / 1 NO_SHOW) → verified connection intervals → opt-in teacher
notes → enqueue → claim → full multi-agent evaluation → publish.

| Metric | Run 1 | Run 2 |
|---|---|---|
| Job outcome | COMPLETED (attempts=1) | COMPLETED (attempts=1) |
| Wall-clock (enqueue→publish) | 29.4 s | 17.5 s |
| Learner Agent | COMPLETED @ 6.0 s | COMPLETED @ 4.5 s |
| Teacher Judge Agent | COMPLETED @ 23.4 s | COMPLETED @ 13.0 s |
| Orchestrator (pure) | COMPLETED @ 10 ms | COMPLETED @ 7 ms |
| Process RSS growth | +8.2 MB | +4.9 MB |
| Reports produced | 1 (v1, CURRENT) | 1 (v1, CURRENT) |
| Evidence register rows | 5 | 5 |
| Student summaries | 2 (exactly the ATTENDED bookings) | 2 |

**Honest live-integration history**: the first live attempts surfaced real
model-behaviour failures — the judge invented evidence-kind labels (e.g. the
fence's own source label) and misread aggregate participant-minutes as session
length. The honest pipeline REFUSED these outputs (schema validation → strict
retry → terminal failure recorded in `ClassroomAgentRun`). Fixes were
code-level and honest: synonym remapping for near-miss labels, a semantics
legend in the evidence view. After the fixes, both live runs completed. No
output was ever fabricated to make the pipeline look successful.

## 3. Deployment footprint (measured)

- **No new service, port, GPU, runtime or npm dependency.** The worker runs
  in-process in the Next.js server (`unref`-ed timer, does not hold the process
  open); storage is the existing SQLite database (7 additive tables).
- Production build: `bun run build` → `✓ Compiled successfully in 23.6s`,
  3/3 static pages, all CI routes present in the route manifest.
- Memory: pipeline RSS growth ≈ 5–8 MB per evaluation (measured); no resident
  model memory (provider-based inference).
- Degradation: provider unavailable → job FAILED after bounded retries
  (unit-tested); booking/cancellation/live-class/attendance flows never wait
  on CI (trigger is post-transaction and error-isolated — the webhook/live-end
  contract is unchanged).

## 4. Test evidence

Full suite (`bun test --isolate`): **1288 pass / 0 fail** across 88 files,
7162 assertions. `bun x tsc --noEmit` clean; `bun run lint` clean;
production build clean.

Classroom-Intelligence-specific suites (real isolated SQLite, real API/
database behaviour):

| Suite | Tests | Covers |
|---|---|---|
| `tests/unit/ci-runtime.test.ts` | 12 | evidence truthfulness (no identities in agent views), duplicate prevention, consent gate + withdrawal at claim time, non-terminal refusal, CAS claim, retry→honest FAILED with classroom rows untouched, lease recovery, consent lifecycle |
| `tests/unit/ci-agents.test.ts` | 20 | schema enforcement (findings require evidence kinds; categories cannot be invented), orchestrator flagging/conflicts/insufficient-evidence/deterministic rebuild, prompt fairness (protected characteristics, camera-off/silence non-evidence), injection fencing, adapter retry semantics |
| `tests/unit/ci-routes.test.ts` | 6 | teacher scoping (403/404 semantics), consent lifecycle via API, consent gate before any row, notes bounds, student own-booking-only visibility, malformed-row honesty |
| `tests/unit/ci-trust.test.ts` | 9 | dispute lifecycle, ADMIN-only queue, action semantics (notes mandatory, closed-is-final), deterministic CORRECTED rebuild, RETRACTED honesty, deletion guardrails, export section, CI-row erasure, trust-table isolation (0 reviews/complaints/trust actions/appeals created by CI) |

## 5. GitHub publication evidence (all SHA-verified via `git ls-remote`)

| Push | Remote-verified SHA | CI run | CI conclusion |
|---|---|---|---|
| CI-1A | `ec0f8be27231c5f91a16cf5729d6d8ec22645325` | `45122229190` | SUCCESS |
| CI-1B | `26e37897a08caa6385b59fca05d9932e4b6c4bb0` | `45123442462` | SUCCESS |
| CI-1C | `6055a3d2d8b78abb4319987827445ca3713033f5` | `45124586374` | SUCCESS |
| CI-1D | `fd281f876b6d2e9b89964f002a2f154e9558d9d1` | `45125810277` | SUCCESS |
| CI-1E | `22d952c98f17d36e61df70231076863930e51634` | `45127267590` | recorded at report time as IN PROGRESS; final state verified below |
| CI-1F | this commit | see ledger entry | recorded after push |

CI is the repository's `quality` job (ESLint, `tsc --noEmit`,
`bun test --isolate`, production build) triggered on every push to
`feat/**`; conclusions were read from the GitHub Actions page for the branch
(the unauthenticated REST API was IP-rate-limited during verification).

## 6. What is NOT done / honest limitations

1. **No audio/video or transcript processing** — by design and by policy
   (live-only classrooms). `docs/CLASSROOM-INTELLIGENCE-OPEN-SOURCE-RESEARCH.md`
   records the LiveKit Agents upgrade path (consent-gated STT) for a future
   milestone; it is not built here.
2. **Evidence ceiling**: without transcripts, several judge categories
   (student interaction, question handling) are honestly
   `INSUFFICIENT_EVIDENCE` unless the teacher provides lesson notes. The
   reports say so rather than guessing.
3. **Student summaries are class-level** — the same content for every attendee
   (schema-enforced literal scope note). Personalised learning reports would
   require authorised per-student evidence that CI-1 deliberately does not
   collect.
4. **No live multi-tenant load test**: benchmarks are single-class, single-run
   measurements; queue behaviour under many concurrent evaluations is
   bounded by MAX_ATTEMPTS/lease design and unit-tested, but not load-tested.
5. **Browser screenshots**: the UI was verified by build + component-render
   tests; a full interactive browser walkthrough with screenshots is listed as
   a remaining verification step in the ledger entry for CI-1F.
6. **PR**: per the repository's established workflow (ADR-008), the PR is
   opened by the owner; the branch and CI runs are published and verified.

## 7. Acceptance against the CI-1 brief

| Requirement | Status |
|---|---|
| Real multi-agent system (3 specialist agents) | ✅ implemented, live-verified |
| Observes authorised classroom activity only | ✅ structural evidence only; no A/V, no identities to the model (unit-tested) |
| Evidence-backed reports with versions | ✅ versioned reports + evidence register + agent-run audit |
| Teacher report dashboard | ✅ Classroom Intelligence tab (consent, reports, evidence, disputes entry) |
| Student learning reports | ✅ class-level summaries in My bookings with fixed scope note |
| Trust & Safety integration, advisory-only | ✅ no write path to trust tables (test-asserted); human review mandatory for consequential changes |
| Idempotency, retry, failure recovery, duplicate prevention | ✅ DB-unique jobs, CAS claims, leases, bounded retries (unit-tested) |
| Privacy: consent, withdrawal, export, deletion | ✅ ConsentRecord purpose; immediate withdrawal; export section; transactional erasure (tested) |
| Future payments boundary | ✅ documented (docs/CLASSROOM-INTELLIGENCE-FUTURE-PAYMENTS.md); no payout logic exists |
| Model-provider independence | ✅ swappable adapter; honest unavailability; no client exposure |
| Tests, lint, typecheck, build | ✅ 1288/0, clean, clean, green |
| Milestone commits pushed & SHA-verified | ✅ every milestone, verified via `git ls-remote` |
