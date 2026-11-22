# Phase 3G — Riishe Studio Graded Recall (type-the-answer flashcards)

**Base:** `e93cdef1bf2d3a584f05c35c9038ab9e68091052` (`origin/main`, PR #22 merge — verified exact)
**Branch:** `feat/bean-riishe-phase3g-next-milestone`
**Ledger id:** `phase3g-graded-recall`

## 1. Scope decision (roadmap evidence)

The repository documents no explicit Phase 3G spec, so the scope was chosen
from the documented next step. `docs/PHASE-3F-RIISHE-LEARNING-CONTINUITY.md`
§11 "Known limitations and future improvements", item 4, states:

> **Flashcard recall is self-reported.** It is honest, labelled self-marked,
> and never conflated with mastery; **a future graded-recall mode
> (type-the-answer checking) could strengthen it.**

Phase 3G implements exactly that improvement — the smallest coherent next
milestone that reuses the Phase 3E/3F architecture with no redesign, no new
tables, no provider changes and no payments:

- **What it adds:** an OPTIONAL graded-recall step on flashcards. Before
  revealing the answer, the learner can type what they recall; a
  deterministic, documented text-similarity heuristic grades the attempt
  against the card's answer, immediately and honestly.
- **What it does NOT do:** change the mastery systems (zero contribution —
  same as 3F), alter any other activity kind, add any AI call (grading is a
  pure local function), or touch the ownership/privacy model.

## 2. Honesty contract (extends 3E/3F)

1. **The verdict is approximate text matching, never semantic grading.** A
   correct idea phrased differently can be marked wrong. The card's real
   answer is always shown after the check, and the note
   (`STUDIO_GRADED_RECALL_NOTE`) is displayed with every verdict.
2. **Verdicts are evidence inside the studio record only.** They never feed
   `TopicMastery`, `Attempt`, `RevisionScheduleItem`, `MistakeRecord` or
   `LearningAction` — the Phase 3F zero-contribution rule is untouched.
3. **The stored result is recomputed server-side.** The UI and the server run
   the IDENTICAL pure helper (`gradeTypedRecall`); client verdicts are
   display-only and never trusted for the stored result (unknown response
   fields are stripped by validation).
4. **Self-marked recall stays available and separate.** Typing does not
   overwrite a self-mark; the two evidence kinds are stored side by side
   (`selfRecall` / `typedRecall` in `responsesJson`) and reported separately.
5. **An attempt that was never made is not evidence.** Empty/whitespace-only
   input is never stored and never graded (`gradeTypedRecall` returns null).

## 3. Grading heuristic (documented, deterministic)

`gradeTypedRecall(expected, typed)` in `src/lib/riishe/studio-types.ts`:

1. **Normalize** both sides: NFKC (superscripts → digits: `mc²` → `mc2`),
   lowercase, strip diacritics, apostrophes/quotes removed in-place
   (`newton's` → `newtons`), remaining punctuation/symbols → space, collapse
   whitespace (`normalizeRecallText`, exported for tests).
2. **Empty typed input** → `null` (no attempt, no evidence). Empty expected
   → `incorrect`.
3. **Letters/numbers equality** (`got === exp`) → `correct`, unless the
   significant operators differ (below) → `partial`.
4. **Compact equality** (whitespace removed) with the same operator rule —
   `"e mc 2"` ≡ `"e=mc2"`.
5. **Single-token answers** (formulas, terms): compact containment counts as
   `partial` only for substrings ≥ 4 chars (a one-letter slip or a common
   word cannot inflate the verdict).
6. **Multi-token answers**: token-set overlap (Jaccard).
   ≥ 0.75 → `correct`; ≥ 0.4 → `partial`; below → `incorrect`
   (`GRADE_CORRECT_THRESHOLD` / `GRADE_PARTIAL_THRESHOLD`).
7. **Operators are significant** (`significantOps`): a same-letters attempt
   with different significant operators caps at `partial` — `F = m · a` vs
   `f = m / a` is a different formula. Two notation-only families are
   lenient: multiplication dots/asterisks (juxtaposition "ma" equals explicit
   "m · a") and ASCII caret superscripts (`mc^2` ≡ `mc²`). Division,
   addition, subtraction and equality compare exactly.
8. **Spam guard**: input with more than 3× the expected token count caps at
   `partial` (`GRADE_SPAM_TOKEN_RATIO`).

## 4. Data model — no migration

Typed recall rides the existing JSON columns:

- `RiisheStudioActivity.responsesJson` gains the optional `typedRecall` map
  (card index → trimmed text, ≤ 2000 chars, indexes validated against the
  stored snapshot; whitespace-only entries are dropped).
- `RiisheStudioActivity.resultJson` flashcards results gain the optional
  `graded` block (`{ attempted, correct, partial, incorrect }`) — present
  only when at least one card was attempted, computed server-side at
  completion.

Zero schema change; the Phase 3F migration chain is untouched.

## 5. Server changes

- `src/lib/riishe/studio-types.ts` — `StudioActivityResponses.typedRecall`;
  `StudioGradedRecallSummary`; flashcards result `graded?` block; the grading
  helper + constants; `STUDIO_GRADED_RECALL_NOTE`.
- `src/lib/riishe/studio-store.ts` — flashcard responses schema gains
  `typedRecall` (bounds-checked against the snapshot; trimmed; empties
  dropped); `computeResult` recomputes graded counts server-side via the
  shared helper; completion merges evidence FIELD-level for flashcards
  (typed answers saved mid-session are never silently dropped when the
  completion payload only re-sends self-marks).
- API routes: **no changes** — the existing PATCH contract already carries
  arbitrary validated responses payloads; ownership (fail-closed
  `assertLearningOwner`), CSRF-lite, scoping and error hygiene are unchanged.
- Privacy surfaces: **no changes needed** — typed evidence lives inside the
  record's `responsesJson`, which claim-guest, account export, account
  deletion and guest purge already cover wholesale.

## 6. UI changes (`src/components/bean/riishe-studio.tsx`)

- Flashcards study mode (in progress, before reveal): optional
  "Type what you recall" input with a **Check** button. Checking reveals the
  answer next to the honest verdict line + the approximation note; the typed
  answer becomes evidence for the card. Plain reveal without typing keeps
  the exact Phase 3F behaviour.
- Review mode (completed records): stored typed answers are shown with their
  recomputed verdict ("Typed: … — matches the answer").
- History result lines append the graded summary when present
  ("typed check: X correct, Y partial, Z no match of N typed").
- Verdict labels use match wording ("matches the answer" / "partially
  matches" / "does not match") — never a mastery or correctness guarantee.

## 7. Tests

`tests/unit/riishe-phase3g-graded-recall.test.ts` — 25 tests:

- **G1 helper (12):** normalization (case, punctuation, diacritics, NFKC),
  verdict thresholds, empty-attempt honesty, compact/containment rules,
  operator significance (`m/a ≠ m·a`; `mc^2` ≡ `mc²`), spam guard,
  determinism.
- **G2 store (8):** typedRecall persistence + trimming, index/length
  rejection (400), server-side graded recomputation, backward compatibility
  (no typed answers → no graded block), stored-evidence fallback, idempotent
  completion, client verdicts stripped.
- **G3 routes (5):** complete intent with typed answers, progress save,
  foreign-claimant 403, unknown-id 404, cross-origin 403.

## 8. Verification results (this milestone)

Recorded during the milestone run (see the ledger + final report for exact
numbers): frozen install, isolated-DB migration deploy + drift check,
`tsc --noEmit`, `eslint .`, full Bun suite (1129 pass / 0 fail — baseline
1104 + 25 new), production build, branch-health normal/JSON under Bun and
Node, and browser verification of the graded-recall flow at 390/768/1280 px.

## 9. Known limitations

1. Approximate matching cannot judge semantic equivalence — the note is
   always shown next to the verdict, and the real answer is always revealed.
2. Graded recall is optional per card; a session can mix typed checks, plain
   reveals and self-marks.
3. The verdict thresholds are heuristics, chosen to be explainable; they may
   be tuned later without any data migration (they are code, not stored
   data — stored results keep the verdict counts computed at completion).
