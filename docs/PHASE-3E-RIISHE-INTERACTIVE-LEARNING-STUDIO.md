# Phase 3E — Riishe Interactive Learning Studio

**Branch:** `feat/bean-riishe-phase3e-interactive-learning-studio`
**Baseline:** Phase 3D.1 (`ead9c2265dfa726369864b4515cdd91fe381abe8`, parent `ad53dcd01ad6a9dd68dbbe356548f3add03351af`) on top of `main` (`65f30bd9b364d0a725d3cbbe03f10121e65e1174` — untouched).

Riishe Studio turns the tutor's chat into an interactive learning experience: students can generate **concept maps**, study through **step-by-step explanations**, work through **formula walkthroughs** with deterministic arithmetic verification, revise with **flashcards**, and check themselves with **mini-tests** — all grounded in their own uploaded material, all validated server-side, all launched from the existing Riishe chat.

---

## 1. Architecture and integration points

The Studio is a **capability of the existing Riishe chat**, not a separate product. Two integration points, both minimal:

| Integration | File | Change |
|---|---|---|
| Studio launcher in the chat response-settings bar (between Language and the sources switch) | `src/components/bean/riishe-chat.tsx` | one conditional `{!researchMode && !compact && <RiisheStudioLauncher …/>}` block, reusing the exact `Toggle` idiom of the bar (gold active state, `sr-only` label in compact). Hidden in research follow-up scope (Phase 3A's independent pathway) and compact per-question review panels — same reasoning as the Phase 3C controls. |
| API client method | `src/lib/api.ts` | one `riisheStudioGenerate` method using the existing `jsonFetch` error contract. |

Everything else is new, self-contained code:

```
src/lib/riishe/studio-types.ts      client-safe DTOs, labels, pure helpers (tree/scoring/shuffle)
src/lib/riishe/studio.ts            server: prompts, programmatic validators, deterministic
                                    arithmetic evaluator, generation pipeline (injectable chatJson)
src/app/api/riishe/studio/route.ts  POST route (zod, sameOrigin, rate limit, ownership, retrieval)
src/components/bean/riishe-studio.tsx  Studio dialog + five activity renderers + launcher
```

No new route pages, no store changes, no composer changes. The chat message list, composer, scope selector and every existing control are untouched (verified by diff review).

**Grounding reuses the chat pipeline exactly:** `sectionPages` + `SectionIndex.retrieveWithScores` (with the same `MIN_RELEVANCE = 0.05` floor) + `fenceDocumentText` injection fencing. Document scope passes `documentId`; the hub passes explicit `documentIds` (the chat panel's "Ground in" selection) or falls back to the last 8 READY materials — the same breadth chat uses.

**Language:** the chat's selected response language rides through to the studio prompt via `responseLanguagePrompt()`; all generated activity text follows it (formulas, symbols, identifiers and page numbers unchanged, per the Phase 3C language contract). UI chrome stays English, matching the app convention.

## 2. Implemented activities

| Activity | What the student gets | Key behaviours |
|---|---|---|
| **Concept map** (`concept-map`) | Validated single-root tree (3–40 nodes, depth ≤ 4 in prompt, ≤ 5 enforced) rendered as a connector-rail visual map | Expand/collapse per node + Expand all/Collapse; selecting a node reveals its explanation and related concepts (parent + children chips, clickable); scoped scroll (`max-h-72 overflow-y-auto`) contains large maps; the same structure is the readable narrow-screen fallback — no absolute positioning, no overlap possible |
| **Step-by-step** (`steps`) | One focused step at a time (3–12 validated steps) | Previous/Next, progress bar, "Step X of Y", optional per-step Example tile; terms explained inline by prompt rule |
| **Formula walkthrough** (`formula`) | Formula display, symbol table, ordered substitute → calculate steps, final result | **Deterministic verification:** each calculate step carries a plain arithmetic expression the server recomputes itself; steps show "Deterministic check passed: = X" or "Not verified: reason"; the result card is **VERIFIED BY RECOMPUTATION** only when every numeric step and the final result match — otherwise explicitly **Illustrative example** with a reason. Incomplete inputs can never produce a verified claim |
| **Flashcards** (`flashcards`) | 4–30 front/back cards tagged definition/fact/formula/qa | Reveal answer, Previous/Next, seeded Shuffle (reproducible), reviewed-count tracking ("Reviewed X of Y cards this session. Reviewing is practice — cards are never marked as mastered.") |
| **Mini-test** (`mini-test`) | 3–10 MCQs ordered foundation → application → advanced | One correct option per question, submit → immediate correct/incorrect feedback + explanation, verified page chip ("From your material: page N") when the page was actually fed, score + percent summary, fixed honest framing note, Try again |

## 3. Data contracts and validation

All activity shapes are typed in `src/lib/riishe/studio-types.ts` (client-safe, shared by UI, API client and server — the `tutor.ts` pattern). `src/lib/riishe/studio.ts` normalises + validates every model payload **before** the UI ever sees it:

- **Structural rejection** (never repaired by guessing): concept-map single root, existing parents, acyclicity, id format/uniqueness, depth bound; step/flashcard/quiz counts; option uniqueness; `correctIndex` range; explanation length; formula stage ordering (all substitutes before calculates); result required when numeric calculate steps exist.
- **Cosmetic normalisation** (safe): control characters stripped, whitespace collapsed, string caps enforced by truncation.
- **One semantic repair retry** carrying the exact validation errors; a second failure is an honest `502` — **no fabricated activity is ever returned** (mirrors `chatJson`'s strict-retry philosophy at the semantic level).
- **No arbitrary rendering:** payloads are plain-text data; the UI renders them through React text nodes only (auto-escaped; no `dangerouslySetInnerHTML` anywhere in the diff). Model text can never become HTML or executable content.
- **Citation integrity:** quiz `pageRef` values are kept only when the cited page was inside the fed material (document mode); everything else is stripped. General mode strips all page refs. No fabricated citations, no invented verification status.

**Arithmetic evaluator:** `evaluateArithmetic()` — a recursive-descent parser (tokenizer + expression/term/power/unary/primary grammar; **never `eval`/`Function`**) supporting `+ - * / % ^` (plus `**`, `× ÷ −`), parentheses, decimals, unary minus and `pi`. Division by zero, unknown identifiers and malformed input throw and are surfaced as "Not verified". Claim matching is **precision-aware**: a claim is verified at the precision it actually states (`≈ 12.57` legitimately verifies `pi·2²`, while a wrong value at any precision fails) — this keeps verification honest without punishing legitimate rounding.

## 4. AI provider behaviour and limitations

- Uses the **existing provider abstraction only** (`src/lib/riishe/ai.ts` → `chatJson`, the platform-injected `z-ai-web-dev-sdk`). No new provider, no API keys, no paid services, no Ollama. Provider failures map to honest 502s with human text.
- Generation cost: **one provider call per activity** (two when a semantic repair retry fires). Rate limit: **12 activities / 10 min per guest**, in-memory, same pattern as chat.
- Deterministic-first principle honoured where it is real: formula arithmetic and mini-test scoring are computed by the server/client deterministically — the model only supplies content, never results. Flashcard shuffling is seeded and reproducible.
- Honest limitations (documented, not hidden): activity quality depends on the provider; concept-map layout is a tree (no cross-links/force graphs by design — robustness over spectacle); mini-test "difficulty progression" is the model's declared difficulty ordering, not an adaptive engine — the product never claims adaptivity it does not have; page refs are only as good as the fed retrieval window.

## 5. Persistence and privacy decisions

**No persistence was added — no migration, no new Prisma models, no schema change** (verified: `prisma/` untouched in the diff). Decision rationale:

- The smallest safe implementation: activities are generated on demand and rendered client-side. Regeneration is cheap and expected; nothing to restore.
- Studio interactions must **never** write learner records. The existing mastery pipeline (`recomputeTopicMastery`) is fed by real attempt evidence (BANK attempts) — Studio mini-test results deliberately create **no** Attempt rows, so "one short test" can never inflate mastery (spec Part E requirement). An opened flashcard is tracked as ephemeral UI state only.
- **Ownership:** `POST /api/riishe/studio` runs `assertLearningOwner(guestId)` **before any database read** — the fail-closed Phase 3B.1/3D.1 contract: no session → guest-bearer works; claimant → works; foreign claimant → **403** with zero document reads; thrown session lookup → **503**. A client-supplied guestId alone can never reach another account's material. Document reads are `guestId`-equality scoped; any requested id that is missing or foreign → `404 'Material not found'` (no existence leaks); non-READY → `409`. Cross-origin POSTs → `403` (`sameOrigin`, plan-route convention).
- No learner data crosses accounts anywhere in the Studio path; no new data leaves the existing boundaries.

## 6. Accessibility and responsive checks

- All controls are real `<button>`s with `aria-label`s; activity picker uses `aria-pressed` chips (house idiom); concept map uses `role="tree"` with `aria-expanded` toggles and `aria-live="polite"` detail panel; quiz options use `role="group"` + `aria-pressed`; flashcard/step navigation uses labelled Previous/Next with disabled states; feedback regions are `aria-live="polite"`; errors are `role="alert"`; loading is `role="status"` with `Loader2`.
- Keyboard: everything is natively focusable buttons/inputs; global gold `:focus-visible` outline applies; Radix Dialog supplies focus trap + Escape (exercised in the browser session).
- Responsive: dialog `max-h-[85dvh]` with internal scroll; picker grid collapses 3-col → 2-col; map area scrolls internally; verified at ~390 / 768 / 1280 (below). No horizontal overflow, no clipped content, no overlapping controls observed in the inspected screenshots.

## 7. Test commands and actual results

All commands run in the worktree at `HEAD` (this branch), Bun 1.3.14:

| Check | Command | Result |
|---|---|---|
| Phase 3E focused tests | `bun test tests/unit/riishe-phase3e-studio-schema.test.ts tests/unit/riishe-phase3e-studio-generation.test.ts tests/unit/riishe-phase3e-studio-route.test.ts` | **51 pass / 0 fail** (176 assertions) |
| Full suite (incl. 3B, 3B.1, 3C, 3D, 3D.1 regression) | `bun test` | **1024 pass / 0 fail** (5,947 assertions, 71 files) — was 973/0 at the baseline; the 51 new tests are the only delta |
| TypeScript | `bunx tsc --noEmit` | exit 0 |
| ESLint | `bun run lint` | 0 errors, 0 warnings |
| Production build | `bun run build` | ✓ Compiled successfully; `ƒ /api/riishe/studio` registered |

No existing test was weakened or skipped; the Phase 3D.1 fail-closed ownership suite and the 3D preference suites pass unchanged.

**New test coverage (51 tests):**

- `riishe-phase3e-studio-schema.test.ts` (26): evaluator correctness + unsafe-expression rejection; concept-map acceptance/BFS ordering/single-root/cycle/unknown-parent/id rules/depth/bounds; steps bounds; formula verification (verified, mismatch → illustrative, unparseable, division-by-zero, symbolic → illustrative, stage ordering, result-required); flashcards bounds/tags; mini-test honesty note/difficulty ordering/pageRef keep-vs-strip/option and range rules; scoring + seeded shuffle.
- `riishe-phase3e-studio-generation.test.ts` (10): valid passthrough per kind; fenced material + topic in the user prompt; language block propagation; pageRef keep/strip in document vs general mode; verified vs illustrative arithmetic; repair-retry with exact validation errors; honest double-failure; honest provider failure; general grounding.
- `riishe-phase3e-studio-route.test.ts` (15): 400 body variants; 403 cross-origin; 429 rate limit; **403 foreign claimant with zero document reads and zero provider calls**; **503 session-throw fail-closed with zero reads**; guest-bearer compatibility; claimant access; 404 foreign/missing doc; 409 non-READY; single-doc grounding + topic fallback to doc title; hub general honesty (no materials); hub multi-doc grounding; 502 provider/validation honesty; 200 happy path with validated activity + badges.

## 8. Screenshots (real generated content, inspected)

All captures are from a live dev server (`next dev`) against the seeded demo material *Physics Essentials — Motion & Forces*, generated through the real provider — no mock UI, no hardcoded demo data. Files live in `docs/screenshots/phase3e/`.

| Width | Screenshot | What it shows (actual inspection result) |
|---|---|---|
| 1280 | `1280-hub-chat.png` | Hub "Ask Riishe" settings bar with the new Studio toggle sitting naturally between LANGUAGE and the sources switch; composer untouched |
| 1280 | `1280-concept-map.png` | Studio dialog, picker, document-grounded badge, 22-concept tree from the real material with a selected node (gold) |
| 1280 | `1280-formula.png` | Formula walkthrough top: formula tile `F = m * a`, SYMBOLS table, SUBSTITUTE stage |
| 1280 | `1280-formula-verified.png` | The full verification chain with real output: `6 / 3` → "Model claimed: 2 m/s²" → **"Deterministic check passed: = 2"** → RESULT **"VERIFIED BY RECOMPUTATION" 2 m/s²** + honesty footer |
| 1280 | `1280-steps.png` | Step player "Step 1 of 7" with progress bar, STEP 1 body and EXAMPLE tile; Previous disabled at start |
| 768 | `768-minitest-feedback.png` | Question 1 of 7, FOUNDATION tag, options with the correct one highlighted green after submit, "Correct." + explanation, **verified page chip "page 2"** |
| 390 | `390-concept-map.png` | Dialog at phone width: picker stacks 2-col, badges wrap, no overflow |
| 390 | `390-concept-map-tree.png` | The readable narrow-screen map: indented tree, expand glyphs, selected root, detail + RELATED CONCEPTS chips — fully readable at 390px |
| 390 | `390-flashcards.png` | Revealed flashcard (DEFINITION tag, front → back) at phone width |
| 390 | `390-flashcards-controls.png` | "Card 1 of 10", Previous disabled on first card, "Reviewed 1 of 10 cards this session…" tracking, honesty footer |

Every screenshot was opened and inspected; no claim below is based on unrendered output.

## 9. Known limitations and follow-up recommendations

1. **Ephemeral by design.** Activities and review progress are not persisted; reloading loses the current activity. If students later want their maps/cards back, an additive `StudioActivity` table keyed by `guestId` (+ claim stamping via `claim-guest`) would be the natural extension — with `assertLearningOwner` reads.
2. **Concept maps are trees.** Cross-links between siblings (graph edges) are intentionally out of scope; the validator guarantees a readable hierarchy at any size. A graph mode would need a real layout engine to avoid the overlap/clipping the spec forbids.
3. **Mini-test adaptivity is declared-difficulty only.** True adaptive progression would integrate with `TopicMastery` evidence; the product never claims more than "short self-check" today.
4. **Scope refinement:** the hub launcher currently passes the chat panel's explicit "Ground in" selection when set, and otherwise grounds across all READY materials (chat's default breadth). A dedicated studio-scope picker inside the dialog could be added later.
5. **Studio is hidden in compact (per-question review) and research scopes** — deliberate; both have focused pathways. A question-scoped studio (grounded on the reviewed question's stored evidence) is a natural follow-up.
6. **Language:** activity content follows the selected response language; dialog chrome is English (app-wide convention). Localised chrome would follow the `disclosures.ts` table pattern.

## 10. Verification of the delivery itself

- Baseline verified before work: remote `feat/bean-riishe-phase3d-conversation-continuity` = `ead9c22…`, `main` = `65f30bd…`; the branch is based on the exact Phase 3D.1 commit; local-only work (`f127b79` on local `main`) untouched.
- Full diff reviewed before commit; only the files listed in §1 + tests + this document are in the commit.
- Push: normal fast-forward only, no force; remote SHA independently verified via HTTPS `ls-remote`; `main` verified unchanged; GitHub Actions run for the pushed commit verified (see final delivery report).
