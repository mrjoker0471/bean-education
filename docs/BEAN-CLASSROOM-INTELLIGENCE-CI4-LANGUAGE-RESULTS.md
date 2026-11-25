# BEAN Classroom Intelligence — CI-4 Language Results (CI-4F)

Milestone: CI-4F. Date: 2026-11-25.
Implementation: `src/lib/ci/fleet/language.ts` (extended capability records, human-approval gate, CI-4F benchmark cases + `runCi4LanguageBenchmark()`).

## 1. The rule CI-4F strengthens (and a CI-3 inconsistency it corrects)

**A model must never grade itself and automatically certify its own language capability.** CI-3F's `recordCapabilityMeasurement` flipped a measured machine pass straight to VERIFIED — a violation of this rule in spirit. CI-4F corrects the ladder:

```
EXPERIMENTAL (unmeasured)
   └─ benchmark run (deterministic acceptance) → LIMITED  (machine evidence, provenance recorded)
         └─ human bilingual review of the measured result → VERIFIED (humanApproved: true)
```

- A measured pass records **LIMITED** with full provenance (model provider, model version, benchmark version, measurement date). It is still refused for use until a human approves it (`isCapabilityVerified` unchanged semantics).
- `recordHumanLanguageApproval()` is the ONLY path to VERIFIED: it requires an existing MEASURED record (a reviewer can only approve what a benchmark actually measured), a reviewer identity, and it appends the reviewer attribution to the record. TRANSCRIPTION can never be moved by either path (the §9.2 consent/legal gate is structural — tested).
- CI-3's L1.3/L1.4 tests were updated to the stricter rule (documented; no assertion weakened — the new assertions are stronger).

## 2. Benchmark set (all BEAN-authored original content)

- CI-3F set (unchanged): terminology preservation (en/ta), comprehension with structured JSON output (hi/ta), code-switch recognition (Tamil+Latin), §14 refusal structure — 6 cases.
- CI-4F set (new): in-script terminology preservation for **all 11 catalogue languages** — हिन्दी बीजगणित, గణితం, കണക്ക്, ವಿಜ್ಞಾನ, বীজগণিত, व्याकरण, ભૂમિતિ, حساب, ਗਣਿਤ — plus a **mathematical-notation preservation case** (x² + 2x + 1 = 0 must survive inside a Devanagari instruction, never transliterated away). 10 new cases; deterministic acceptance in code, no model judge.

`runCi4LanguageBenchmark()` runs BOTH sets per language and records TEXT_UNDERSTANDING/TERMINOLOGY measurements with provenance. Without an adapter nothing runs and nothing is recorded (`ran: false` — the honest default stands).

## 3. Capability states after CI-4F (honest current state)

| Language | TEXT_UNDERSTANDING | TERMINOLOGY | GENERATION | TRANSLATION | TRANSCRIPTION |
|---|---|---|---|---|---|
| All 11 (en, hi, ta, te, ml, kn, bn, mr, gu, ur, pa) | EXPERIMENTAL (unmeasured in production) | EXPERIMENTAL (unmeasured in production) | EXPERIMENTAL | NEEDS_HUMAN_REVIEW | **UNSUPPORTED (structural, §9.2)** |

- **No VERIFIED language capability exists** — the production deployment has not run a recorded measurement against a named provider, and no human bilingual review has been performed. The benchmark machinery runs in tests with scripted adapters to prove the recording path; those results are test-scoped and never persisted as product claims.
- Capability records now carry (optional, back-compatible): `dialect`, `modelProvider`, `modelVersion`, `domain`, `benchmarkVersion`, `humanApproved`. A future measured run must record all of them.

## 4. Speech and transcription — decision preserved

CI-3F's rejection stands unchanged in CI-4F: **no classroom recording, no hidden transcription, no ASR dependency, no observer media subscription, no transcription-status change.** The §9.2 consent/legal architecture, technical benchmarks and licence verification required to revisit this belong to a SEPARATELY REVIEWED proposal. Tested in CI-4F F5: neither benchmarks nor human approvals can move TRANSCRIPTION off UNSUPPORTED.

## 5. What CI-4F did not do (honest)

- **No qualified bilingual reviewer has approved anything yet** — the human-approval path is implemented and gated, but the reviewer step has not happened. There are zero VERIFIED language capabilities by design.
- Dialect variants (e.g. Tamil spoken registers, Urdu Hindi vocabulary overlap) remain recorded as `variationNote`s the specialist must preserve — they are NOT separately benchmarked.
- Translation remains NEEDS_HUMAN_REVIEW for every language: the deterministic cases check terminology/notation preservation, NOT meaning quality; semantic quality needs the human reference judgements described in the charter, which require the qualified reviewers above.
- Omnilingual ASR remains rejected (CI-3F decision unchanged).
