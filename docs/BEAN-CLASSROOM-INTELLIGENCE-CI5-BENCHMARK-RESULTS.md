# CI-5 BENCHMARK RESULTS — Expert-Labelled Evaluation Programme

> Unit: CI-5F · Status: programme implemented and tested
> (`tests/unit/ci5-benchmark-programme.test.ts`). **No real expert-labelled
> dataset and no real measured agent performance exists yet in this
> deployment** — no model credentials are configured (every model-dependent
> metric would be fabricated) and no real qualified expert has labelled a case.
> The infrastructure below is real and tested; the measured numbers are not.

## 1. Programme architecture

Three additive tables (migration `20261125150000_ci5_benchmark_programme`):

1. **`ExpertBenchmarkDataset`** — immutable dataset versions (slug + version
   unique), carrying task kind, split, deterministic content checksum,
   licence record (BEAN-AUTHORED-ORIGINAL or a recorded compatible licence),
   optional domain/language scope, and the BEAN-authored case array.
2. **`ExpertBenchmarkCaseLabel`** — expert reference labels, append-only per
   reviewer per case: expected result + accepted alternatives (multiple
   acceptable answers are first-class), prohibited conclusions, supporting
   sources, confidence (HIGH/MEDIUM/LOW), ambiguity note.
3. **`ExpertBenchmarkRun`** — one measured harness run of an agent kind
   against a dataset version: ran flag, reason, parsed metrics with sample
   sizes, expert-label count, executor identity.

The 12 charter task kinds and 9 evaluated agents are vocabulary-enforced
(`SUBJECT_CORRECTNESS` … `MULTILINGUAL_QUALITY`; `LEARNER` …
`REVISION_COACH`). No new agent personas were added — the programme measures
the agents CI-1–CI-4 already built.

## 2. Split separation and leakage prevention

- Splits: `DEVELOPMENT` / `CALIBRATION` / `VALIDATION` / `BLIND_HOLDOUT`.
- **BLIND_HOLDOUT labels cannot be written through the open labelling path**
  (refused with "sealed until scoring") — holdout references cannot leak into
  review, prompts or calibration.
- The admin dataset view returns empty case-key lists for holdout datasets.
- Structural leakage prevention: the benchmark module imports nothing from the
  retrieval or domain-pack content systems — dataset material can never be
  ingested into prompts, retrieval packs or training inputs through this code.

## 3. Expert reference labels (no false certainty)

- A label may record MULTIPLE acceptable answers — legitimate professional
  alternatives are first-class, not grader noise.
- Prohibited conclusions are explicit strings; a reply containing one fails
  regardless of any match.
- Confidence and ambiguity notes are recorded; **two labels for the same case
  from different reviewers are BOTH preserved** — disagreement is never
  averaged and the favourable variant is never silently selected (proven in
  tests with two deliberately differing fixture labels).
- Labelling requires an ACTIVE reviewer scoped to the dataset's domain
  (domain-scoped datasets) or language scope (language-scoped datasets).

## 4. Metrics — honest by construction

Every run stores: method, sample size, expert-labelled sample size,
deterministic-only sample size, accuracy (null when nothing scored),
prohibited-conclusion violations, and notes that state what was excluded and
why. **A percentage is never published without its dataset size, task scope,
model/executor identity and evaluation method** — the metrics JSON carries all
of them. Unlabelled cases without a deterministic check are excluded and the
exclusion count is reported.

Scoring is deterministic against expert reference labels and structural
checks — no model judges a model.

## 5. No self-certification (structural + proven)

- The benchmark module contains no import or call of `recordPackReview`,
  `recordLanguageCapabilityReview` or `persistLanguageMeasurement` (source
  guard asserted in tests).
- Behaviourally proven: after harness runs, the pack-review ledger for
  mathematics-statistics remains empty and the Telugu language capability
  remains EXPERIMENTAL — a run measures; it never promotes.
- `ran=false` (no adapter / no executable path) is recorded as a first-class
  honest outcome with the reason; nothing is fabricated.

## 6. Regression across model versions

`compareRunsForRegression` compares two runs of the SAME dataset version,
refusing non-runs and cross-dataset comparisons. The verdict states the delta
in percentage points WITH both sample sizes and records the CI-5H policy
verbatim: a candidate measured below baseline is a regression signal — a
previously verified capability is not silently treated as valid for the new
model version.

## 7. Current measured state (honest)

| Item | State |
|---|---|
| Real expert-labelled datasets | 0 (no real qualified expert has labelled a case) |
| Real measured agent runs | 0 (no model adapter credentials in this deployment; all runs record ran=false) |
| Seed datasets created in tests | BEAN-authored fixtures only, clearly labelled (mathematics subject-correctness dev set, refusal-accuracy blind holdout, uncertainty-handling route set) |
| Metrics published | none — every number in this document is a test-fixture number on an isolated database, not a production measurement |

When a model adapter is configured and real qualified experts label datasets,
the same harness produces publishable metrics with sample sizes — the
programme is built so that honest measurement is the only possible outcome.

## 8. Tested behaviour (11 tests)

Dataset creation (immutable versions, deterministic checksums, vocabulary
enforcement); blind-holdout labelling refusal + masked case keys; scoped
labelling with accepted alternatives and prohibited conclusions; duplicate
per-reviewer label refusal; unscoped labelling refusal; unknown-case refusal;
disagreeing labels both preserved; honest non-run (ran=false, no fabricated
metrics, governance untouched); measured run (expert-scored + deterministic
scoring, prohibited-conclusion violation detection, sample-size honesty,
exclusion reporting); regression comparison (delta with sample sizes, non-run
and cross-dataset refusals); no-self-certification source + behavioural
proofs; route guards through the REAL requireAdmin/requireStudent.
