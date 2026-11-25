# BEAN Classroom Intelligence — CI-3 Results

Milestone: CI-3 Agent Fleet & World Knowledge Architecture (charter
`docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-CHARTER.md`).
Branch: `feat/bean-classroom-intelligence-agent-fleet` (units CI-3A…CI-3H each
committed and pushed immediately after independent verification; every remote
SHA verified via `git ls-remote` and recorded in `docs/milestone-ledger.json`).

## 1. What shipped (unit by unit)

| Unit | Commit (pushed + verified) | Deliverable |
|---|---|---|
| CI-3A | `9658752` | Architecture audit + upstream decision: full agents-js framework REJECTED; minimal reuse of `@livekit/rtc-node@1.2.3` (Apache-2.0) + existing `livekit-server-sdk` (explicit-dispatch API); 6/6 reproducible upstream probe; licence bill of materials |
| CI-3B | `b6cc80e` | Typed agent registry (19 roles, §5 must-nevers), strict source/licence registry, ISCED-F taxonomy adapter (11 broad fields, 36 families), domain-pack schema with the V1–V8 gates (V6: a machine can NEVER flip a pack to VERIFIED), 4 seed packs honestly IN_REVIEW |
| CI-3C | `c3be302` | Durable per-agent fleet task queue (`ClassroomFleetTask`, UNIQUE taskKey = idempotent dispatch, CAS claims, lease+heartbeat recovery, honest skipReason, charter §12 terminal vocabulary), bounded worker pool, deterministic dispatcher (mandatory audit pair + core pair always planned; specialists only on deterministic domain match, cap 3) |
| CI-3D | `8ddb163` | Consent-gated LiveKit observer: ONE visible participant per room (DB-unique), explicit teacher dispatch via guarded route, structured-only mode (token canSubscribe/canPublish/canPublishData = false, autoSubscribe off), identity `bean-observer:<id>` (never counted as a participant), consent re-checked at dispatch/connect/heartbeat, bounded reconnects, single-flight identity-free evidence envelope |
| CI-3E | `4141379` | Specialist runtime executors: subject specialists with pack glossary + DETERMINISTIC source-grounding post-pass (unregistered/pack-foreign refs demoted to unverified), cross-domain handoff only to declared related domains, prohibited-task refusal, IN_REVIEW honesty marking; evidence auditor (deterministic resolution + one bounded model challenge; disagreements preserved verbatim); safety guardian (deterministic §14 sweep); core pair maps CI-1 runs (never re-runs the model); 4 new core-family packs (8 dispatchable total); deterministic domain fixture suite; queue priority fix so the audit pair audits outputs that EXIST |
| CI-3F | `94b71db` | Multilingual foundation: 11-language capability registry (per-task records; TRANSCRIPTION structurally UNSUPPORTED and unflippable — the §9.2 gate), pure Unicode script detection + code-switch segment preservation, server-side multilingual-evidence detection (teacher notes only), LANGUAGE specialist executor (deterministic + one bounded terminology pass), text benchmark harness (6 deterministic BEAN-authored cases, honest `ran:false` without an adapter) |
| CI-3G | `90f6df9` | Teacher/student workflow integration: development coach + revision coach live (advisory-only limitations verbatim; deterministic ranking/decision-language guard strips findings + raises risk flags; real BEAN learning links via the CI-2D builder); additive ownership-scoped fleet counts on the teacher CI overview |
| CI-3H | (this unit) | Domain fixture expansion (8 fixtures incl. §14 health refusal), load/recovery benchmark, RBAC + privacy audit tests, authenticated browser verification (this document, §4), **caught + fixed a sign-in regression** (§5), results doc + ledger + PR |

## 2. Test, type and lint evidence

- Full suite: **1482 tests, 0 failures** (`bun test`), across 102 files. CI-3
  added 104 tests on top of the CI-2 baseline (1378 → 1482); no existing test
  was weakened — the only count-assertion updates were 4→8 seed-pack counts
  (CI-3E pack expansion) and two deferral tests whose promised implementations
  arrived in later units (each updated to assert the REAL behaviour).
- `bun x tsc --noEmit`: clean.
- `bun run lint`: clean.
- CI (GitHub Actions) runs lint + tsc + `bun test --isolate` + the production
  build on every push; the PR for this branch must pass all of them (local
  sandbox does not run `next build` — the production build is evidenced by CI,
  not claimed here).

## 3. Load/recovery benchmark (charter §19 CI-3H)

`scripts/ci3-load-benchmark.ts` — isolated real SQLite DB, deterministic
executor, no model calls (measures the MACHINERY). Run recorded 2026-11-24:

| Phase | Result |
|---|---|
| Seed | 50 sessions, 200 ms |
| Dispatch | 350 tasks (7/session) in 462 ms — **758 tasks/s** |
| Drain (CAS claim + run) | 300 claimed+run (50 enrichment tasks honestly SKIPPED by capacity backpressure) in 1223 ms — **245 tasks/s, 4.1 ms/task** |
| Lease recovery sweep | 50 stale rows re-queued in 29 ms |
| Cancellation sweep | 20 sessions in 19 ms |
| Invariants | every dispatched task terminal (300 COMPLETED + 50 SKIPPED = 350); 0 FAILED under the deterministic executor |

The benchmark is also exercised as a test (`ci3-security-audit L1.1`) so the
invariants stay green in CI.

## 4. Authenticated browser verification

Real dev server (port 3001) serving the fleet-branch worktree with the real
database; real sign-in; real pipeline + real provider for the evaluated class.
Script: `scripts/ci3-walkthrough-browser.sh`; seed:
`scripts/ci3-walkthrough-seed.ts`; log `/tmp/verify/ci3-browser.txt`;
screenshots `docs/screenshots/ci3/`.

Verified in a real browser:
1. **Teacher sign-in** (three-audience auth panel → Teacher → Sign in tab →
   credentials) lands on the teach dashboard.
2. **Classroom Intelligence tab** renders the consent card (granted state,
   honest evidence-boundary disclosure: no audio/video, no transcription,
   aggregate-only), the trends honesty note (minimum 3 evaluated classes before
   any trend), and the evaluated class card (COMPLETED, v1).
3. **Fleet counts** surface through the ownership-scoped overview API:
   `"fleet":{"total":7,"completed":7,"failed":0,"running":0}` for the class
   processed by the REAL fleet (all seven tasks completed against the real
   provider), `0`s honestly shown for the never-evaluated class.
4. **Observer API RBAC** (cookie-authenticated): owner GET → 200; owner POST on
   an ended room → 409 `room_not_live`; unauthenticated GET → 401.
5. **Responsive**: horizontal overflow **0 px at 390 px and 320 px** on the
   dashboard and classes views.
6. **Footer discipline**: long page — footer sits exactly at the content end
   (offset 0); no floating gap below the footer on any checked page.

## 5. Regression found and fixed during verification

The browser walkthrough caught a **production-breaking sign-in regression** on
the merged auth milestone: the signup age-declaration gate ran on the sign-in
panel too (which renders no declaration radios), so `declaredAge` was always
null and **every password sign-in was refused client-side**. Fixed on this
branch (`fix(auth)` commit): declaration gates now apply to signup only; the
signup path keeps every gate (8-char password, terms+privacy, declaration,
UNDER_18 fail-safe) and a fail-closed guard; the server-side under-18 guard is
untouched; the auth-milestone test suites pass unchanged.

## 6. Acceptance criteria evidence map (charter §20)

| # | Criterion | Evidence |
|---|---|---|
| 1 | CI-1 agents remain functional | CI-1/CI-2 suites green; walkthrough ran the REAL pipeline |
| 2 | Typed registry versions roles | CI-3B registry + tests (39) |
| 3 | Dispatcher selects specialists from verified metadata | CI-3C P1/D1 tests + CI-3E runtime |
| 4 | Concurrent classes within measured capacity | Load benchmark §3 (758 dispatch tasks/s, bounded pool, backpressure honest) |
| 5 | One visible observer joins eligible consented rooms via explicit dispatch | CI-3D tests + walkthrough §4.4 (401/409/200 matrix) |
| 6 | Observer failure cannot break attendance/completion | CI-3D failure-isolation tests (classroom rows untouched) |
| 7 | Specialists don't all join rooms / no unnecessary data | Runtime LIVE_ROOM only for the observer; evidence gatherer is the CI-1 authorised bundle |
| 8 | Seed packs have sources, licences, versioning | 8 packs, all sources licence-registered; V1–V8 gates |
| 9 | Unsupported domain returns honest limitation | Dispatcher honest no-match skips; pack-gate refusals |
| 10 | Language capability measured per task | CI-3F registry + benchmark harness (honest unmeasured states) |
| 11 | No speech processing without the consent gate | TRANSCRIPTION UNSUPPORTED, structurally unflippable (tested) |
| 12 | Reports preserve evidence, uncertainty, disagreements | Contract C-checks; auditor preserves conflicts verbatim |
| 13 | Tools permission-scoped; no arbitrary code/SQL from agents | Agents only read the authorised evidence bundle; no eval/SQL surface exists |
| 14 | Teacher/student/admin access tested in authenticated browser sessions | §4 walkthrough + CI-2 walkthrough (unchanged surfaces) |
| 15 | Ownership, export, deletion, consent withdrawal, admin review correct | CI-1/CI-2 suites (D1–D9) unchanged and green |
| 16 | No AI disciplinary/safeguarding/rating/payment decisions | §5 must-nevers + deterministic ranking/decision-language guard (tested) |
| 17 | Full suite, lint, typecheck, build, smoke, browser checks | §2 (build via CI), §3, §4 |
| 18 | Every verified milestone commit pushed and independently checked | Ledger remoteVerifiedSha per unit (ls-remote verified) |

## 7. Honest limitations (not claimed as done)

1. All 8 domain packs remain IN_REVIEW — the VERIFIED gate needs a recorded
   human reviewer; nothing machine-flipped (V6).
2. Zero VERIFIED language capabilities — the benchmark harness exists but no
   measured run has been recorded into the registry; dialect variants are not
   separately benchmarked.
3. The observer is API-complete but has no teacher-facing UI control yet —
   dispatch/withdraw work through the documented route (verified by tests and
   the walkthrough's API matrix); a UI toggle is a future milestone.
4. `dispatchFleetForSession` is invoked by tests/seed scripts and is wired for
   lifecycle use, but the fleet pipeline does not yet auto-dispatch from the
   live/end webhook path (CI-1's evaluation pipeline remains the
   production trigger; the fleet rides alongside). Wiring decision belongs to
   the owner with the next milestone.
5. The Omnilingual ASR candidate was evaluated and REJECTED for now (licence
   re-check required + §9.2 consent fit unsatisfied); no ASR dependency added.
6. Production build evidence comes from GitHub CI on the PR (the local sandbox
   does not run `next build`).
