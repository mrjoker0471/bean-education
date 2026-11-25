# CI-5 LANGUAGE GOVERNANCE — Durable Measurement, Qualified Bilingual Review, and Structural Transcription Restriction

> Unit: CI-5E · Status: implemented and tested with clearly-labelled synthetic
> fixtures (`tests/unit/ci5-language-governance.test.ts` + the updated CI-3F/4F
> suites). **Zero language capabilities are VERIFIED in this deployment** — no
> real bilingual reviewer exists, no real model measurement has been recorded.
> Every real capability stays EXPERIMENTAL / NEEDS_HUMAN_REVIEW / UNSUPPORTED
> until genuine qualified review happens.

## 1. The CI-5A discovery, closed

CI-4F's capability store was a process-local in-memory array. The CI-5A audit
proved: measurements and approvals vanished on restart, were invisible to
concurrent workers, were erased by deployments and DB restores, had no
qualification/scope/binding checks, and — worst — a caller-supplied
`humanApproved` flag could mint VERIFIED with no reviewer at all
(self-certification). CI-5E replaces it:

| CI-4F (before) | CI-5E (after) |
|---|---|
| `capabilityStore` module array | Three separated, database-backed tables |
| In-memory mutation, lost on restart | Persisted status — every worker/restart reads the same truth (proven by a second-PrismaClient test) |
| `humanApproved` flag → VERIFIED | Flag REMOVED; a machine measurement records LIMITED, full stop |
| `recordHumanLanguageApproval` with a length-checked string id | Deleted; VERIFIED only via the durable governance path |
| No scope, no qualification, no binding | Qualified ACTIVE bilingual reviewer + exact tag/task/domain scope + binding to the exact measurement/provider/model/benchmark/checksum |
| No revocation, no history | Revocation preserves the full history; superseded bindings keep their audit trail |

## 2. The persistence model (additive migration `20261125140000_ci5_language_governance`)

1. **`LanguageBenchmarkMeasurement`** — the deterministic benchmark result:
   language tag, task, domain ("" = general), dialect ("" = none measured),
   modelProvider, modelVersion, benchmarkVersion, benchmark dataset checksum
   (sha256 of the canonical case set), per-case testRef, passed flag, honest
   case/pass counts. Unique binding key makes re-runs idempotent.
2. **`LanguageCapabilityReview`** — the append-only human bilingual decision:
   bound to the exact measurement row, snapshots the full binding, records the
   server-resolved reviewer (studentId + reviewerCode + qualification snapshot),
   decision, rationale, and the 13-facet evidence checklist JSON.
3. **`LanguageCapabilityStatus`** — the derived, persisted effective status per
   binding: UNSUPPORTED / UNMEASURED / EXPERIMENTAL / LIMITED / IN_REVIEW /
   VERIFIED / REVOKED / SUPERSEDED with basis, measurement pointer, approval
   count, contributing review ids, supersededBy pointer.

## 3. Structural rules (all enforced in code, all tested)

- **A benchmark pass alone produces at most LIMITED.** A failed measurement
  records honestly too (LIMITED-at-best with the failure note). `passed=true`
  with `passedCount < caseCount` refuses (a pass means every case passed).
- **Only a qualified authorised human reviewer can approve a measured
  capability**: the reviewer must hold an ACTIVE `BILINGUAL_LANGUAGE` profile
  whose recorded scope matches the exact language tag + task (+ domain when
  the scope is domain-restricted). A Hindi reviewer cannot approve Tamil; a
  domain-restricted Tamil reviewer cannot approve general Tamil capabilities.
- **Approval binds to the exact measurement**: the review row snapshots the
  measurement's provider, model version, benchmark version and dataset
  checksum. An UNMEASURED capability cannot be approved (no measurement row →
  refuse).
- **An updated model or benchmark requires a new assessment**: a new model
  version is a new binding — it starts unverified and must be measured and
  approved on its own evidence. When a newer binding becomes VERIFIED for the
  same language/task/domain/dialect, the older VERIFIED binding is marked
  **SUPERSEDED** (with a pointer) — never silently extended, never downgraded
  by a benchmark re-run.
- **Revocation preserves the historical approval**: revocation marks the
  binding REVOKED with the reason and reviewer attribution; the review rows and
  the approval record stay intact; re-approval of a revoked binding refuses
  (a NEW measurement + review is the only path back).
- **TRANSCRIPTION remains structurally UNSUPPORTED**: the measurement path
  refuses outright (422), the review path refuses, no status row can exist for
  TRANSCRIPTION, the effective resolution hard-returns UNSUPPORTED with basis
  STRUCTURAL, and the reviewer-scope layer rejects TRANSCRIPTION at scope-write
  time (CI-5B). **No approval workflow can bypass the charter §9.2
  transcription/legal gate.**
- **No self-certification**: the legacy in-memory path can never mint VERIFIED
  (the flag and the function are gone); VERIFIED exists exclusively through
  `recordLanguageCapabilityReview` on persisted state.

## 4. The bilingual evidence checklist (13 facets)

Every review records per-facet status (OK / ISSUE / NOT_ASSESSED) with notes:
meaning preservation, domain terminology, grammar, naturalness, script
correctness, mathematical notation, scientific symbols, code-switching,
regional register, dialect differences, ambiguous wording, unsupported claims,
safety/refusal accuracy. **APPROVED requires every facet OK**; REJECTED /
CHANGES_REQUESTED with recorded issues never promote (the binding stays
LIMITED-at-best with the objection referenced).

A general bilingual reviewer cannot approve domain-specialised capabilities:
domain-language scope (CI-5B) restricts e.g. Tamil *medical* terminology to
reviewers explicitly scoped for that domain.

## 5. Effective resolution (what consumers read)

`resolveEffectiveCapability(db, tag, task)`: TRANSCRIPTION → structural
UNSUPPORTED; else VERIFIED (human-approved binding) → the best measured
LIMITED binding (a revoked binding never hides other bindings' machine
evidence — bindings are model/benchmark-specific) → REVOKED when nothing else
stands → honest catalogue default. The specialist runtime
(`runLanguageSpecialist`) reads this durable resolution with an honest
fallback to the catalogue defaults when the store is unreachable.

## 6. API surface

| Route | Who | Purpose |
|---|---|---|
| `POST /api/admin/ci5/language/benchmark` | requireAdmin | run both benchmark sets + persist every measurement durably (no adapter ⇒ ran=false, nothing recorded) |
| `GET /api/admin/ci5/language/capabilities` | requireAdmin | full 11×5 durable capability view |
| `POST /api/ci5/reviewer/assignments/[id]/language-review` | reviewer owner | submit the bilingual decision through an assignment (ownership, ACTIVE, scope re-check, measurement binding) |
| `POST /api/admin/ci5/language/revoke` | requireAdmin | reason-required, history-preserving revocation |

## 7. Tested behaviour

16 dedicated CI-5E tests: idempotent measurement persistence with honest
counts; LIMITED-at-most machine evidence (pass AND fail); unmeasured cannot be
approved; binding-provenance snapshots; scope enforcement (wrong language,
domain-restricted, suspended reviewer); golden durable VERIFIED with the
in-memory view proven incapable of VERIFIED; **restart durability proven with
a second PrismaClient on the same database**; model-change ⇒ new assessment +
supersession of the old binding with preserved history; revocation preserving
reviews and refusing re-approval; TRANSCRIPTION structurally unreachable at
every layer; evidence-checklist completeness; the reviewer route through a
real assignment (ownership + lifecycle); the full 11×5 durable view. The
CI-3F L-series and CI-4F F-series suites were updated to exercise the durable
path (their semantics — LIMITED ladder, transcription lock, refusal honesty —
are unchanged and re-proven).

## 8. Honest state and limits

- No real model measurement has been recorded (no adapter credentials in this
  deployment; the benchmark route reports ran=false honestly).
- No real bilingual reviewer exists; every VERIFIED/REVOKED state in the test
  suite belongs to clearly-labelled synthetic fixtures on isolated databases.
- Zero VERIFIED language capabilities exist on any production surface BY
  DESIGN, exactly as CI-4F declared — but now the governance that could grant
  one is durable, qualified, scope-bound, measurement-bound and auditable.
