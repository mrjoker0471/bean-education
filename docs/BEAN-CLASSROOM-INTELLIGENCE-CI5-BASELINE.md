# CI-5 BASELINE — Human Expert Validation & Real-World Intelligence

> Milestone: CI-5 · Branch: `feat/bean-classroom-intelligence-ci5`
> Baseline recorded from **actual source inspection and live test runs**, not from
> historical reports. Every claim below was re-verified at the recorded SHA.

## 0. Verified starting point

| Item | Value | How verified |
|---|---|---|
| Starting main | `7ccf355986c0cab738cb705e11b87f97c25a5c32` | `git ls-remote origin refs/heads/main` + `git fetch` + worktree checkout of the exact SHA |
| Historical expected main | `7ccf355986c0cab738cb705e11b87f97c25a5c32` | identical — no drift |
| Branch | `feat/bean-classroom-intelligence-ci5` created at that SHA | `git worktree add` |
| Full suite at baseline | **1563 pass / 0 fail across 110 files** (36.19 s, `bun test --isolate`, isolated SQLite) | live run in this worktree |
| Migrations | ALL migrations apply cleanly on a fresh empty SQLite DB (`prisma migrate deploy`) | live run, fresh `file:` DB |
| Baseline head commit of this milestone | the CI-5A commit on `feat/bean-classroom-intelligence-ci5` (SHA recorded in the milestone ledger) | `git ls-remote` after push |

Merge history on main confirms every completed milestone is still integrated:
`7ccf355` (PR #44 — CI-4 ledger close-out) → `d02d5ee` (PR #43 — auth age+consent)
→ `a6c8d33` (PR #42 — CI-4E-H) → `9e932ee` (PR #41 — CI-4A-D). No completed PR
has been reverted or lost.

## 1. Ledger state (actual, read from `docs/milestone-ledger.json`)

- 27 milestone entries, 27 unique IDs; `version: 1`.
- `bean-classroom-intelligence-ci4`: **status COMPLETE, syncStatus IN_SYNC**,
  `finalMainSha a6c8d33665ef866e94762d5d37b0719d9280d02e`, PR #42 MERGED,
  `completionRule: SATISFIED — all units in main, verified (tree-identity proof)`.
  CI-4A–H all `MERGED_INTO_MAIN`. **CI-4 remains COMPLETE — nothing in CI-5 regresses it.**
- `bean-auth-age-legal-consent-ux`: **COMPLETE / SYNCHRONIZED**, merged via PR #43
  (merge commit `d02d5ee5…`), CI runs 45550606192 + 45550624182 SUCCESS.
- `branchReconciliation` audit history intact.

## 2. Domain packs — actual state (read from `src/lib/ci/fleet/packs/index.ts`)

All 12 packs are registered and **declared IN_REVIEW** with zero recorded human
review rows (fresh DB): curated status therefore equals the declared state.

| domainId | riskClass | declared status |
|---|---|---|
| mathematics-statistics | STANDARD | IN_REVIEW |
| computing-software-it | STANDARD | IN_REVIEW |
| accounting-finance | ELEVATED | IN_REVIEW |
| health-medicine-edu | HIGH_STAKES | IN_REVIEW |
| physics-space | STANDARD | IN_REVIEW |
| chemistry-materials | STANDARD | IN_REVIEW |
| biology-life | STANDARD | IN_REVIEW |
| languages-literature | STANDARD | IN_REVIEW |
| education-pedagogy | STANDARD | IN_REVIEW |
| engineering | STANDARD | IN_REVIEW |
| agriculture-agritech | STANDARD | IN_REVIEW |
| history-philosophy | STANDARD | IN_REVIEW |

Human-approval gate re-verified in `src/lib/ci/fleet/curator.ts` (unchanged from CI-4C):

- `resolveCuratedStatus` derives VERIFIED only from recorded human approvals bound
  to packId + packVersion + **exact pack checksum**; REJECTED is terminal for the
  reviewed version; STANDARD needs 1 distinct approver, HIGH_STAKES needs 2.
- `recordPackReview` is the only write path, called exclusively from the admin API
  route `POST /api/admin/knowledge/packs/[packId]/review` behind `requireAdmin()`
  (server-resolved identity; body-supplied identity ignored). Stale checksum ⇒ 409.
- Source records stay read-only in this API family (a reviewer cannot approve a
  licence on behalf of a rights holder).

## 3. Transcription restriction — still intact

`src/lib/ci/fleet/observer.ts`: `transcriptionEnabled` is a `z.literal(false)` —
it cannot be set true by any payload. The observer is structured-only ("no audio
or video is processed, recorded or stored"), the observer disclosure renders for
every participant, and no ASR dependency exists in the fleet code. `language.ts`
hard-codes every catalogue language's TRANSCRIPTION record to UNSUPPORTED with the
§9.2 charter note, and both `recordCapabilityMeasurement` (silent no-op) and
`recordHumanLanguageApproval` (explicit refusal) refuse to touch it. **CI-5 must
never weaken this.**

## 4. Observer & fleet dispatch — preserved

- `shouldAutoDispatchFleet`: default OFF; env value must be **exactly** `'true'`
  (`'TRUE'`/`'1'` refuse) — re-verified at `dispatcher.ts:296`.
- Observer controls UI (`observer-controls.tsx`), student disclosure
  (`observer-disclosure.tsx` in `classroom-shell.tsx`), and the fire-and-forget
  post-class dispatch path are all present on main.

## 5. CRITICAL DISCOVERY — language approval durability audit

`src/lib/ci/fleet/language.ts` was inspected line-by-line and **every call site,
API route and deployment path was greped** (`rg` across `src/` and `tests/`).

### Findings (all verified in source)

1. **The capability store is process-local.** `language.ts:233` declares
   `const capabilityStore: LanguageCapabilityRecord[] = defaultLanguageCapabilities()` —
   a module-level in-memory array. `recordCapabilityMeasurement`,
   `recordHumanLanguageApproval` and `resetLanguageCapabilitiesForTests` mutate it
   in place; `listLanguageCapabilities`, `isCapabilityVerified` and
   `capabilityRefusalReason` read it.

2. **Nothing persists.** Measurements and approvals are lost on:
   - process restart (module re-evaluates `defaultLanguageCapabilities()`);
   - new deployment (new process, empty store);
   - serverless instance changes (every warm instance holds its own copy);
   - concurrent workers (worker A's approval is invisible to worker B);
   - database restoration (there is nothing in the database to restore).

3. **No durable write path exists at all.** `language.ts` imports no database
   client. `rg` for the approval/measure functions shows the ONLY production
   caller of `recordCapabilityMeasurement` is `runCi4LanguageBenchmark` itself,
   and `recordHumanLanguageApproval` has **zero call sites anywhere** — no API
   route has ever been able to record a human language approval. (The specialist
   gate at `runtime.ts:1138` consumes `capabilityRefusalReason` read-only.)

4. **Self-certification hole.** `recordCapabilityMeasurement` maps
   `humanApproved: true` straight to `status: 'VERIFIED'` — any caller that passes
   the flag can mint a VERIFIED capability without a reviewer, a qualification or
   a durable record. A model (or any process) can currently certify itself by
   function call.

5. **No qualification, scope or binding on the human path.**
   `recordHumanLanguageApproval` checks only that `reviewerId.trim().length >= 3`.
   It does not check: reviewer qualification, an approved language/task/domain
   scope, the exact measurement being approved, model version, benchmark version,
   or any assignment. An approval for any language flips whichever single
   language+task record exists, regardless of what was actually measured or on
   which model.

6. **No revocation.** Once VERIFIED, nothing can un-verify, and there is no
   history: the previous note is overwritten in place.

### CI-4 verdict on its own terms

CI-4F's own claims remain true as far as they went: all language capabilities are
UNMEASURED/EXPERIMENTAL/NEEDS_HUMAN_REVIEW by default, zero VERIFIED states exist
by design, the harness records LIMITED at most, and TRANSCRIPTION is structurally
locked. The durability gap does not create a wrong VERIFIED today — because
nobody can even run the approval path. But the moment an approval IS recorded it
would be (a) invisible to other instances, (b) erased on restart, and (c) bound to
nothing. **CI-5E must make measurements and approvals durably persistent with a
reviewer-qualified, scope-bound, append-only design.**

### Required persistence model (CI-5E contract)

Separate database-backed records — additive migrations only:

1. Language benchmark **measurement** (language tag, task, domain, dialect,
   modelProvider, modelVersion, benchmarkVersion, benchmark dataset checksum,
   per-case result, measuredAt).
2. Human bilingual **review decision** (append-only; server-resolved reviewer,
   qualification snapshot, decision, rationale, evidence, created timestamp).
3. Effective **capability status** (derived, persisted so restarts read the same
   truth: UNSUPPORTED / UNMEASURED / EXPERIMENTAL / LIMITED / IN_REVIEW /
   VERIFIED / REVOKED / SUPERSEDED).
4. **Reviewer qualification and scope** (CI-5B profiles — domain and bilingual).
5. **Review version and history** (every status transition auditable; revocation
   preserves the historical approval).

Structural rules carried into CI-5E: benchmark pass alone ⇒ at most LIMITED;
only a qualified authorised human reviewer can approve a measured capability;
scope must match the exact language/task/domain; approval binds to the exact
measurement and model version; updated model or benchmark ⇒ new assessment;
revocation preserves history; unmeasured ⇒ cannot be approved; TRANSCRIPTION
stays structurally UNSUPPORTED; no workflow bypasses the §9.2 gate.

## 6. Governance paths that do not exist yet (CI-5B–5G scope)

Verified absent by inspection (no Prisma models, no lib modules, no routes):

- Reviewer identity/qualification/scope model (`CI-5B`) — nothing beyond
  `requireAdmin` exists; a general administrator is currently the only review
  identity and is NOT a qualified subject expert.
- Review assignment & case management (`CI-5C`) — no queue, no assignment,
  no independence separation beyond distinct-student counting, no recusal,
  no adjudication.
- Expert rubric-backed domain validation (`CI-5D`) — `ClassroomPackReview`
  stores free-text rationale/evidence only; no structured A–F checklist.
- Durable language governance (`CI-5E`) — see §5.
- Expert-labelled benchmark datasets & splits (`CI-5F`) — the language
  benchmark sets are code constants; no dataset/version/checksum storage, no
  dev/calibration/validation/blind-holdout separation, no metric runs.
- Classroom-report audit pilot (`CI-5G`) — no privacy-masked report review
  workflow; no reviewer-facing UI.
- Reviewer/admin governance UI (`CI-5G`) — no workspace surfaces.

## 7. Honest operating limits for CI-5

- **No real human reviewers exist in the sandbox.** Every workflow exercise in
  CI-5 uses clearly-labelled synthetic fixtures; real domain packs therefore
  remain IN_REVIEW and real language capabilities remain LIMITED/unmeasured
  until genuine qualified humans record decisions. The system is built and
  tested so those decisions can be made and will persist — but none are
  fabricated.
- No model credentials in the deployment: agent-quality benchmark runs execute
  through deterministic adapters/fixtures only; model-dependent metrics are
  recorded as NOT_RUN with reasons rather than invented numbers.
- The classroom pilot uses synthetic classroom fixtures and explicit teacher-note
  channels only; no hidden recording, no transcription, no audio/video.

## 8. Baseline integrity checklist (machine-checked in `tests/unit/ci5-baseline-audit.test.ts`)

- [x] ledger: CI-4 COMPLETE / IN_SYNC / PR #42 / finalMainSha a6c8d336; 27 entries
- [x] 12 packs registered; all declared IN_REVIEW; 1 HIGH_STAKES + 1 ELEVATED
- [x] curator gates: no approvals ⇒ not VERIFIED; distinct-approver + checksum binding intact
- [x] TRANSCRIPTION UNSUPPORTED for all 11 catalogue languages; measurement no-op; approval refused
- [x] fleet auto-dispatch default-off (exact 'true' only)
- [x] observer structured-only (`z.literal(false)` source guard)
- [x] durability gap proven behaviourally: approval + reset ⇒ gone (in-memory store)
- [x] self-certification hole proven: `humanApproved: true` measurement ⇒ VERIFIED (CI-5E closes this)
- [x] `recordHumanLanguageApproval` has zero production call sites (source grep guard)
