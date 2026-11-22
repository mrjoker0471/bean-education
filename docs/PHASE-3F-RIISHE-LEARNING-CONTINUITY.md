# Phase 3F — Riishe Learning Studio Continuity & Evidence-Based Progress

**Branch:** `feat/bean-riishe-phase3f-learning-continuity`
**Base:** `2ae966caa590aef7ca0c941020a593df57182450` (`feat(riishe): Phase 3E interactive learning studio` — verified exact)
**Date:** 2026-11-22

Phase 3E made Riishe interactive: five validated, document-grounded learning
activities generated inside the existing chat experience. Their state, however,
was deliberately ephemeral — closing the Studio dialog lost everything.

Phase 3F makes that learning **continuous and measurable without compromising
trust**: students can resume unfinished activities, review completed ones, keep
a private history, and see honest self-study evidence — while the exam-side
mastery systems (Phase 3B) remain exactly as authoritative and untouchable as
before.

---

## 1. Baseline and Git safety

Independently verified before any change:

| Ref | Expected | Actual | Status |
| --- | --- | --- | --- |
| Phase 3E HEAD (local + remote) | `2ae966caa590aef7ca0c941020a593df57182450` | `2ae966caa590aef7ca0c941020a593df57182450` | exact match |
| Parent | `ead9c2265dfa726369864b4515cdd91fe381abe8` | `ead9c2265dfa726369864b4515cdd91fe381abe8` | exact match |
| `origin/main` | `65f30bd9b364d0a725d3cbbe03f10121e65e1174` (spec value) | `f80b6869941db40e0d85bd7d779617505e79746e` | **differs — reported, not silent** |

**Main divergence, explained and verified:** after the Phase 3F spec was
written, the repository owner merged the Phase 3D branch (PR #17) and the
Phase 3E branch (PR #18) into `main`. `git diff 2ae966c f80b686` is **empty** —
`origin/main` contains exactly the verified Phase 3E tree plus two merge
commits, and both `2ae966c` and `ead9c22` are ancestors of `f80b686`. The new
branch is therefore based on the exact Phase 3E commit the spec mandates; no
different baseline was used. `main` is never modified by this phase.

Local-only sandbox work (including `f127b79`) was preserved untouched.

---

## 2. Architecture audit (what was inspected before designing)

| Area | Findings |
| --- | --- |
| Phase 3E Studio | `POST /api/riishe/studio` generates ONE activity via `generateStudioActivity` (provider call + server-side normalisation + deterministic arithmetic verification). UI: `RiisheStudioLauncher` toggle in the Riishe chat settings bar → `RiisheStudioDialog`. No persistence anywhere; the 3E honesty note promised "not stored". |
| Activity schemas | Five kinds (`concept-map`, `steps`, `formula`, `flashcards`, `mini-test`) with strict server-side normalisers in `src/lib/riishe/studio.ts`; client-safe DTOs in `studio-types.ts`. Formula results carry a `verified` / `illustrative` honesty contract. Mini-test scoring is a pure client helper in 3E (`scoreMiniTest`). |
| Riishe chat persistence (3D/3D.1) | `RiisheChatTurn` is guestId-first, never stamped with `studentId` at creation; `claim-guest` stamps it later. History GET guarded by `assertLearningOwner` before any read (Phase 3D.1). |
| Phase 3B intelligence | `TopicMastery` covers **catalogue topics only** (`topicId` must be a real `Topic.id`); `recomputeTopicMastery` reads **BANK-source submitted attempts only** (`source !== 'BANK'` is skipped). `MistakeRecord` (BANK+RIISHE), `RevisionScheduleItem` and `LearningAction` complete the derived state; everything is recomputable from `Attempt` rows. |
| Phase 3B.1 ownership | `assertLearningOwner(guestId)` in `src/lib/learning/scope.ts`: fail-closed (session throw → generic 503; claim lookup throw → generic 503; foreign claimant → 403; completed resolution without a session → guest-bearer). |
| Phase 3C | Tutor modes + response-language preferences ride per assistant turn. |
| Claim / export / delete | `claim-guest` stamps 11 tables; export (`/api/auth/account/export`) and account deletion are `studentId`-based; guest data deletion (`/api/account` DELETE) is `guestId`-based. |
| Prisma / migrations | SQLite, additive migration chain baseline → 3B → 3D; the 3D migration test establishes the isolated-DB pattern. |

**Key architectural fact driving the design:** the existing mastery system
cannot represent Studio activities *at all* — Studio topics are free-text
document topics, while `TopicMastery` represents catalogue topics and is fed
exclusively by BANK-source submitted attempts. The 3F spec's own escape clause
applies: *"If the existing mastery system cannot safely represent a particular
activity, preserve that activity's history without pretending it contributes to
mastery."*

---

## 3. Persistence design

### 3.1 One new table, nothing else

```
model RiisheStudioActivity {
  id, guestId, studentId?          ← guestId-first, claim-guest stamps studentId
  kind                             ← one of the five activity kinds
  topic, status, grounding
  documentId?                      ← plain reference, NO FK / NO cascade
  documentTitle?                   ← display snapshot; survives document deletion
  responseLanguage?
  activityVersion                  ← schema version of the snapshot (= 1)
  activityJson                     ← SERVER-VALIDATED activity snapshot (never raw model output)
  progressJson?                    ← UI progress state (per-kind, validated)
  responsesJson?                   ← learner interaction evidence (per-kind, validated)
  resultJson?                      ← server-computed completion summary
  createdAt, updatedAt, lastAccessedAt, completedAt
}
```

Migration: `prisma/migrations/20261122010000_phase3f_studio_continuity/migration.sql`
— a single `CREATE TABLE` + four indexes. **No existing table is touched.**
Rollback consideration: the table is self-contained; `DROP TABLE
"RiisheStudioActivity";` removes it with zero side effects (documented in the
migration header). The migration was tested against an isolated temporary
SQLite database (`tests/unit/riishe-phase3f-migration.test.ts`): full chain
deploy, schema-diff equality, field round-trips, claim/export/delete semantics,
and proof that the Phase 3D columns on `RiisheChatTurn` still behave. The
developer database and any production database were never touched.

### 3.2 Deliberate design decisions

- **Snapshot, not regeneration.** `activityJson` stores the *validated* DTO.
  Reopening an activity renders the stored snapshot; generation is never rerun,
  so resume needs no provider call, no document, and cannot produce different
  content. This is also why a deleted source document cannot break resume
  (tested: P7 / C3).
- **No FK to `StudyDocument`.** History is the student's learning journey and
  survives document deletion; `documentTitle` keeps the display label.
- **Progress and responses live in separate columns** (`progressJson` =
  navigation/UI state; `responsesJson` = learner interaction evidence), stored
  on the same row — deletion removes both together, so orphaned learner
  responses are structurally impossible.
- **Everything is private by default and guestId-scoped** at every read/write.
- **Nothing is written to `Attempt`, `TopicMastery`,
  `RevisionScheduleItem`, `MistakeRecord`, `LearningAction`** — see §6.

### 3.3 Server-side validation of everything a client sends

`src/lib/riishe/studio-store.ts` validates every payload **against the stored
snapshot**:

- concept-map: selection must be a real node id; expanded ids filtered to real nodes.
- steps: indexes clamped into `[0, steps.length - 1]`.
- flashcards: `order` must be an exact permutation of `0..n-1`; reviewed set
  deduped and range-checked; recall marks range-checked per card.
- mini-test: answer arrays must match the question count; every chosen option
  must be inside that question's option range.
- Malformed payloads are `400`; rows whose stored snapshot fails re-validation
  on read are never rendered (defensive `parseActivitySnapshot`).

---

## 4. Activity lifecycle (server-owned)

```
            generate (POST /api/riishe/studio)
                │  row created IN_PROGRESS
                ▼
          IN_PROGRESS ──"abandon" (explicit) ──► ABANDONED (terminal)
                │
                └─"complete" (explicit) ──► COMPLETED (terminal, recorded once)
```

- The client can never send a `status`. The PATCH body accepts exactly three
  intents: `progress` (and/or `responses`), `action: 'complete'`,
  `action: 'abandon'` — all transitions are enforced server-side.
- **Completion is idempotent.** A repeated completion (double click, retry,
  stale client, *different answers*) returns the stored summary unchanged and
  re-records nothing — duplicate completion records and score inflation are
  structurally impossible (tested: P3a, P3b, C4a).
- `complete` on ABANDONED → 409; `abandon` on COMPLETED → 409; progress on
  terminal rows → 409 (tested: P4a–P4d, C4b).
- Completed activities reopen in **review mode** — browsing is allowed, but no
  completion button, no restart, no re-recording. A retake means generating a
  fresh activity (an explicit student action, a new record).

## 5. Resume and history behaviour

- **Resume strip** — "Continue where you left off" at the top of the Studio
  dialog (up to 3 most-recent in-progress activities) with Resume / Discard /
  Delete actions.
- **History** — "Your Studio history" below the picker: most recently updated
  first (bounded at 50), each row showing activity type, topic, document
  context, relative time, status chip (In progress / Completed / Discarded) and
  a factual result line.
- **Restored state per kind** — concept-map: selected node + expanded set;
  steps: current + furthest step; flashcards: order, position, reveal state,
  reviewed set; mini-test: current question, answers, submitted flags.
  Formula walkthroughs are a single static view (nothing to restore).
- **Deletion** — a student can delete any of their records (row-scoped hard
  delete; responses live on the row, so nothing is orphaned).
- The Riishe chat experience is untouched: the Studio remains the same launcher
  inside the existing chat panel; history lives inside the Studio dialog, not a
  new dashboard or navigation system.

---

## 6. Evidence model (the trust core of Phase 3F)

| Activity | What is recorded | What is deliberately NOT recorded |
| --- | --- | --- |
| **Mini-test** | Submitted answers (learner evidence, separate column) + a score **recomputed server-side** from the validated snapshot at completion (`correct / answered / total / percent`). Completion exactly once; abandoned tests keep partial progress and no result. | Any client-supplied score (the contract has no score field at all). Any influence on `Attempt`, mastery, revision, mistakes, digest. |
| **Flashcards** | Per-card **self-marked recall** (`recalled` / `missed`) offered only **after** a reveal; reveal-only review is tracked as progress but **never** becomes recall evidence. Summary counts reviewed / recalled / missed. | Mastery for opening, viewing or shuffling. Any objective-correctness claim (self-marks are labelled self-marked everywhere). |
| **Steps** | Factual navigation summary: `Studied N of M steps`. | Any correctness score. |
| **Formula** | The verified/illustrative distinction **copied verbatim from the validated snapshot** — deterministic server recomputation at generation time, never upgraded, never fabricated. | Any learner-correctness claim (the 3E walkthrough has no learner inputs). |
| **Concept map** | Factual context only: map size. Selection/expansion are restored as navigation state, not evidence. | Any "understanding" score for exploring. |

**Mastery integration decision — reuse by non-interference.** The Phase 3B
mastery rules, thresholds, digest and planner are untouched: no code path from
Studio rows into any exam-evidence table exists. Rationale:

1. The existing system structurally cannot represent document free-text topics
   (`TopicMastery` is catalogue-only; Studio topics are document topics), so
   feeding Studio outcomes in would require *inventing* a mapping — exactly the
   fabrication the spec forbids.
2. The existing mastery thresholds are calibrated for real submitted practice
   attempts (BANK source). Injecting short self-checks would silently dilute
   those thresholds — the inflation the spec forbids.
3. The 3E honesty note shown to students ("Completing it does not create
   attempt records or change your mastery") remains literally true in 3F.

Instead, the Studio surfaces its own **honest, clearly-labelled evidence**:
a compact "Studio practice so far" strip (completed / in progress counts,
mini-test average, cards recalled) with the fixed caption *"Self-study evidence
only — it never changes your mastery or attempt records."* Evidence source and
activity context stay traceable through `kind`, `topic`, `documentId`,
`documentTitle`, `responseLanguage` and `activityVersion` on every row.

---

## 7. Ownership and security

Every new/changed endpoint enforces the Phase 3B.1/3D.1 fail-closed contract
**before any database read**:

| Endpoint | Guard + scope |
| --- | --- |
| `GET /api/riishe/studio` (history) | `assertLearningOwner` → guestId-scoped list |
| `POST /api/riishe/studio` (generation, unchanged route) | `assertLearningOwner` → row created with the verified guestId |
| `GET /api/riishe/studio/[id]` | `assertLearningOwner` → `{ id, guestId }` read |
| `PATCH /api/riishe/studio/[id]` | sameOrigin + `assertLearningOwner` → `{ id, guestId }` mutation |
| `DELETE /api/riishe/studio/[id]` | sameOrigin + `assertLearningOwner` → `{ id, guestId }` delete |

- A **valid activity id belonging to another guest is indistinguishable from a
  missing one** (`404`, no existence leak); client-supplied ids cannot bypass
  ownership (tested O4, P6a, P6b, C6).
- **Same-ID foreign-account attacks** (claimed guestId + real activity id +
  attacker session) are rejected 403 before any read on *all* endpoints,
  mutations included (tested O1-record).
- Session-resolution and claim-lookup failures fail closed with the generic
  503 message (tested O2).
- The guest-bearer contract for unclaimed guest identities is preserved
  (tested O3), and claimants keep access to their claimed scope.
- Error responses carry generic text only — no activity, answer or progress
  data leaks (tested H2).
- Document-scoped activities keep their guest/document scope: the generation
  route's document check (404 for foreign material) is unchanged, and stored
  `documentId` values are plain references that never grant read access.

---

## 8. Privacy, export, and deletion

- **Claim:** `claim-guest` stamps `studentId` on unclaimed Studio rows
  (guestId untouched, idempotent) — consistent with every other learner table.
- **Export:** `/api/auth/account/export` includes a `studioActivities` section
  (context + lifecycle + progress/responses/result evidence; activity snapshots
  included via version field — no passwords, no file bytes, no server paths).
- **Account deletion** (signed-in): Studio rows are purged by `studentId` in
  the same transaction as everything else.
- **Guest data deletion** (`/api/account` DELETE): Studio rows purged by
  `guestId`; the deleted-count response reports them.
- No public profile or discovery surface exists for Studio data; nothing new is
  exposed cross-account; no new consent, AI-training or content-sharing
  permissions are introduced.

---

## 9. UI/UX and accessibility

- The existing BEAN/Riishe visual system is preserved (same dialog, gold/dark
  tokens, existing shadcn components); the chat composer and all other Riishe
  surfaces are untouched.
- New UI is confined to: the resume strip, the history section, status banners
  ("Completed — review mode" / "Discarded"), finish actions, flashcard
  self-recall marks, and the evidence strip.
- Status labels are explicit and distinct: **In progress**, **Completed**
  (review mode), **Discarded** — and "Completed" never implies mastery
  (every summary carries the honest caption).
- All controls are keyboard-accessible buttons/toggles with descriptive
  `aria-label`s; state changes use `aria-live`/`aria-pressed`; groups have
  roles and labels.
- Loading (spinner), empty ("Nothing here yet…"), error (inline + retry) and
  degraded ("Saved session unavailable — …") states are implemented.
- Verified responsive at **390px, 768px, 1280px** (screenshots below): the
  picker reflows 2-col on mobile; history rows wrap cleanly; scoped scroll
  areas keep large maps inside the dialog; no clipped or overlapping UI.

---

## 10. Test results (all actually executed)

**Suite totals: 1065 tests, 0 failures, across 74 files** (baseline before 3F:
1024 tests / 71 files, all green).

| Test file | Coverage |
| --- | --- |
| `tests/unit/riishe-phase3f-studio-store.test.ts` (23) | Round-trips for all five kinds; per-kind progress validation/clamping; completion exactly once + idempotency; invalid lifecycle transitions; evidence honesty (reveal ≠ recall, zero-mark completion, formula distinction, no invented correctness, abandoned ≠ completed, no responses for non-evaluated kinds); `{ id, guestId }` ownership scoping incl. cross-account; deleted-document resilience; evidence roll-up. |
| `tests/unit/riishe-phase3f-studio-routes.test.ts` (14) | Fail-closed ownership on all four endpoints incl. **same-ID foreign-account attacks**; 503 on session failure; guest-bearer + claimant preservation; generation persistence + honest degradation (no fabricated activityId); resume without provider calls; lifecycle intents + idempotent completion; history + evidence; delete/cross-account delete; CSRF/400 hygiene; leak-safe error bodies. |
| `tests/unit/riishe-phase3f-migration.test.ts` (4) | Isolated-DB full-chain `migrate deploy`; schema-diff equality; field round-trips + lifecycle defaults; claim/export/delete semantics; Phase 3D columns untouched. |
| Existing regression files | 3B (`learning-*`), 3B.1 (`learning-ownership*`, `learning-ownership-fail-closed`), 3C (`riishe-tutor-chat`, `riishe-phase3d-*`), 3D/3D.1 (`riishe-phase3d-chat-preferences`, `riishe-phase3d-history-ownership`, `riishe-phase3d-migration`, language matrix), 3E (`riishe-phase3e-studio-*`) — all pass unchanged (only mock-db fixtures in two privacy-flow tests gained the new table so the extended flows stay testable; no assertion was weakened). |

| Gate | Result |
| --- | --- |
| `bun test` (full) | **1065 pass / 0 fail** |
| `bunx tsc --noEmit` | clean |
| `bunx eslint .` | clean |
| `bunx next build` (production) | successful |
| Isolated-DB migration tests | pass (temp DB only; dev/production DB untouched) |

### Browser verification (agent-browser, dev server on the isolated worktree DB)

Executed end-to-end with real AI generation on a seeded READY document:

1. Generated a **concept map** on "Photosynthesis" → selected "Calvin Cycle" +
   collapsed a branch → returned to Studio home → **resumed** → selection and
   expanded-state restored exactly (DB row: `progress: {selectedNodeId: n8,
   expandedIds: [...]}`). Discarded it → row `ABANDONED`, no result.
2. Generated **flashcards** → revealed card 1 → marked "I recalled it" →
   finished → summary "Self-marked recall on 1 of 10 cards (1 recalled)"; DB:
   `responses: {selfRecall: {"0": "recalled"}}` separate from
   `progress.reviewed`.
3. Generated a 6-question **mini-test** → answered/submitted each → "See
   results" → server-recorded summary "67% · 4 of 6 correct · 6 answered ·
   saved to your Studio history"; DB result matches server recomputation; row
   `COMPLETED`, completion recorded once.
4. Generated **steps** → navigated to step 2 → Finish → "Completed — review
   mode · Studied 2 of 6 steps". (This flow exposed and fixed a real bug:
   finish-button `onClick` was passing the click event as the responses
   argument, causing an honest 400 — fixed to `() => onComplete?.()`.)
5. Generated a **formula walkthrough** → the deterministic checker flagged an
   unverifiable calculate step ("Not verified: unexpected character") →
   finished → recorded outcome "Illustrative walkthrough (not a verified
   computation)".
6. History, evidence strip ("Studio practice so far: 4 completed · mini-test
   average 67% · 1 card recalled"), delete (row removed), reopen-in-review
   verified in the browser; page error console clean after the fix.
7. Screenshots captured at **390 / 768 / 1280** px
   (`docs/screenshots-3f/`): `390-studio-home.png`, `390-activity.png`,
   `768-studio-home.png`, `1280-studio-home.png`, `1280-minitest-review.png`
   — layouts hold, no clipping/overlap/horizontal overflow.

---

## 11. Known limitations and future improvements

1. **Mastery contribution is deliberately zero.** If the product later wants
   Studio self-checks to influence the weak-areas system (`t:`-prefixed
   document topics), that needs an explicit product decision and a safe
   mapping design — out of scope here by the spec's own escape clause.
2. **History is bounded** (most recent 50 for the list + evidence roll-up).
   Older records remain queryable by id but are not summarised in the strip.
3. **Deletion is manual** — no automatic retention window exists yet. The
   schema keeps timestamps (`createdAt`, `updatedAt`, `lastAccessedAt`) so a
   retention policy can be added later without a destructive migration.
4. **Flashcard recall is self-reported.** It is honest, labelled self-marked,
   and never conflated with mastery; a future graded-recall mode (type-the-
   answer checking) could strengthen it.
5. **Activity retakes** create new records rather than versioning within one —
   keeps completion semantics simple and auditable.
6. **Multi-document generations** are not attributed to a single document
   (same honesty rule as the 3E `docTitle`); the topic and snapshot still
   carry full context.

---

## 12. Files changed by Phase 3F

- `prisma/schema.prisma` — additive `RiisheStudioActivity` model
- `prisma/migrations/20261122010000_phase3f_studio_continuity/migration.sql` — additive table
- `src/lib/riishe/studio-types.ts` — continuity DTOs (statuses, progress, responses, results, history)
- `src/lib/riishe/studio-store.ts` — NEW server store: validated persistence, lifecycle, evidence
- `src/app/api/riishe/studio/route.ts` — generation persists; GET history
- `src/app/api/riishe/studio/[id]/route.ts` — NEW: GET / PATCH / DELETE record
- `src/lib/api.ts` — continuity client methods + `activityId`
- `src/components/bean/riishe-studio.tsx` — resume, history, review mode, recall marks, evidence strip
- `src/app/api/auth/claim-guest/route.ts` — studio rows join the claim
- `src/app/api/auth/account/export/route.ts` — studio history exports
- `src/app/api/auth/account/delete/route.ts` — studio rows purged
- `src/app/api/account/route.ts` — guest purge includes studio rows
- `tests/unit/riishe-phase3f-*.test.ts` — NEW: store / routes / migration suites
- `tests/unit/learning-compat.test.ts`, `tests/unit/riishe-phase3d-chat-preferences.test.ts` — mock-db fixture gains the new table (no assertion weakened)
- `docs/PHASE-3F-RIISHE-LEARNING-CONTINUITY.md` — this document
- `docs/screenshots-3f/` — verification screenshots
