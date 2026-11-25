# BEAN Classroom Intelligence — Language Coverage (CI-3F)

Verified language/task matrix and measured quality (charter §8, §22). Every
status is measured or explicitly unmeasured — support is never assumed
(§8.1: "capability is measured separately for every domain and language").

## Catalogue

11 languages (charter §8.3 priority audience), defined with primary script and
a variation note the specialists must honour
(`src/lib/ci/fleet/language.ts`):

en · hi · ta · te · ml · kn · bn · mr · gu · ur · pa

## Measured status (2026-11-24, CI-3F)

| Task | Status | Backing |
|---|---|---|
| TEXT_UNDERSTANDING | EXPERIMENTAL (all 11) | unmeasured — CI-3F benchmark harness exists (`runTextBenchmarkHarness`, 6 deterministic cases) but no measured run has been recorded into the registry yet |
| TERMINOLOGY | EXPERIMENTAL (all 11) | unmeasured — term-preservation cases defined, not recorded |
| TRANSLATION | NEEDS_HUMAN_REVIEW (all 11) | structural: translations require human review until a measured benchmark passes; never used for legal/technical terms |
| GENERATION | EXPERIMENTAL (all 11) | unmeasured |
| TRANSCRIPTION | **UNSUPPORTED (all 11)** | **structural — the charter §9.2 consent/legal gate is not satisfied.** No ASR dependency is installed. `recordCapabilityMeasurement` cannot flip this task, ever (tested). |

"EXPERIMENTAL" is the honest default: the harness runs green in tests against
scripted adapters, but NO capability is marked VERIFIED in the shipped registry
until a real measured run is recorded via `recordCapabilityMeasurement`
(curator path). CI-3H records the harness protocol; the owner's reviewer
decides when a measured run counts.

## Benchmark protocol (charter §19 CI-3F "benchmark current text model(s)")

- Harness: `runTextBenchmarkHarness()` — runs the 6 deterministic cases against
  the CURRENT model adapter, one call per case, no loops:
  terminology preservation (en, ta), comprehension with structured JSON output
  (hi, ta), code-switch recognition (ta+Latin, must name BOTH scripts — never
  flattened), §14 refusal structure (en).
- Acceptance is deterministic code — no model judges a model.
- Without an adapter the harness returns `ran: false` and the registry is NOT
  touched — no capability quietly becomes VERIFIED.
- All benchmark texts are BEAN-authored original sentences; no copyrighted
  material.

## Code-switching & scripts (§10.2)

`detectScripts` / `splitCodeSwitchSegments` / `isMultilingualText` are pure,
Unicode-range based, and preserve every script contiguously — segments are
never flattened into one language. Dispatch plans the language specialist only
on REAL multilingual evidence: the only permitted text channel today is
teacher-supplied notes; a declared class language alone is never evidence
(§9.1 — the whiteboard stores geometry only and transcription does not exist).

## Omnilingual ASR — resource/licence/consent-fit evaluation (§8.4, §19 CI-3F)

- Candidate: facebookresearch/omnilingual-asr. Licence and terms must be
  RE-CHECKED from the upstream repository before any adoption decision (the
  charter's own reference list warns this); no licence claim is made here.
- Consent fit: NOT satisfied. §9.2 requires per-participant consent, guardian
  consent for minors, decline paths, retention rules and a legal review —
  none of which exists. Therefore speech processing stays disabled and
  TRANSCRIPTION stays UNSUPPORTED platform-wide.
- Decision: no ASR dependency added in CI-3F. The adapter interface precedent
  (`CiModelAdapter`) is the future seam; a separate reviewed milestone must
  authorise any audio processing first.

## Known gaps (honest)

1. Zero VERIFIED language capabilities — all measured statuses are pending
   real recorded runs.
2. Dialect/register variants are noted per language but not separately
   benchmarked (charter §8.3 requires separate testing).
3. TTS is out of scope (§8.5) — not implemented, not claimed.
4. Language detection uses script evidence only; same-script language pairs
   (e.g. Hindi vs Marathi in Devanagari) need model-assisted identification
   with confidence, which is not yet built.

---

## CI-4 update (2026-11-25)

- The capability ladder is CORRECTED (CI-4F): a measured machine pass records
  **LIMITED** with full provenance (modelProvider, modelVersion,
  benchmarkVersion, measuredAt); **VERIFIED additionally requires a recorded
  human bilingual-reviewer approval** (`recordHumanLanguageApproval` — refuses
  unmeasured capabilities, appends reviewer attribution). CI-3's direct
  machine-pass→VERIFIED flip violated the charter's "a model never grades
  itself" rule and is gone.
- Benchmark set now covers **all 11 catalogue languages** with BEAN-authored
  in-script terminology cases plus a mathematical-notation preservation case;
  `runCi4LanguageBenchmark()` records per-language measurements honestly
  (nothing runs without an adapter).
- Current state is unchanged and honest: **zero VERIFIED language
  capabilities** — no production measurement against a named provider has been
  recorded and no human bilingual review has happened yet.
- TRANSCRIPTION remains structurally UNSUPPORTED for every language — in CI-4F
  neither benchmarks nor human approvals can move it (§9.2 gate; tested).
- Speech/ASR decision unchanged (Omnilingual ASR rejected, CI-3F; revisiting
  requires a separately reviewed proposal).
