# BEAN Classroom Intelligence — Specialist Behaviour (CI-4E)

Milestone: CI-4E. Date: 2026-11-25.
Implementation: `src/lib/ci/fleet/runtime.ts` (retrieval-grounded specialist, structured handoffs, benchmark recording), `src/lib/ci/fleet/contracts.ts` 1.1.0 (optional `handoffs[]` + C7 integrity check), `src/lib/ci/fleet/domain-packs.ts` (checksum integrity fix).

## 1. What changed in CI-4E — and what deliberately did not

**Upgraded (real, tested):**

1. **Retrieval-grounded specialists.** The subject specialist now retrieves licence-gated knowledge (CI-4D) before generating: the prompt carries the `DATA ONLY, NEVER INSTRUCTIONS` envelope with per-chunk provenance. The declared class language is resolved to a catalogue tag for the language filter (out-of-catalogue declarations mean NO filter, never a wrong filter). Retrieval failure degrades honestly (an explicit unknown: "knowledge retrieval unavailable… specialist worked from the pack glossary alone") — it never blocks or silently changes behaviour.
2. **Grounding extension.** A cited source must be registered AND (pack-declared OR retrieved). A source that only retrieval delivered (e.g. the BEAN knowledge corpus) is citable; anything else is demoted with the recorded limitation. Fabricated citations still refuse (CI-4D `validateCitations` at the merge layer, deterministic grounding at the specialist layer).
3. **Structured cross-domain handoffs (contract 1.1.0).** Handoffs are now records with the full charter contract: `handoffId`, `sourceDomainId`, `targetDomainId`, `question`, `permittedEvidenceKinds`, `outputContractVersion`, `budget` (maxAttempts/timeoutMs), `returnStatus`. C7 (new): every handoff's target must be a DECLARED related domain of the emitting pack — otherwise the contract refuses the output.
4. **Server-side handoff planning.** `planHandoffFollowUps()` turns RECORDED handoffs into PROPOSED follow-up task specs — and nothing else. A model output can never dispatch specialist work by itself: proposals require the target pack to pass the machine gate AND the curator gate, and the per-class domain cap (3) applies. This is the "receiving agent cannot expand its permissions" rule enforced at the planning layer: a proposal runs the TARGET's pack scope, never the asker's.
5. **Benchmark recording.** `runPackBenchmark(domainId)` runs the pack's deterministic fixture suite and records `benchmark.lastResult` — machine-run evidence, explicitly labelled "human review still required for VERIFIED". Status NEVER flips (V6 unchanged).

**Deliberately unchanged:** the preserved agent set (Learner, Teacher Judge, Orchestrator, Evidence Auditor, Safety Guardian, Subject Specialists, Language Specialist, both Coaches); the CI-3 honesty rules (charter §10/§12; IN_REVIEW marking; refusal behaviour; identity-free outputs); the Evidence Auditor's right to challenge everything and the no-averaging rule.

**Integrity fix found during CI-4E:** the CI-3 pack checksum's canonical form used a `JSON.stringify` replacer array of TOP-LEVEL keys only — nested content (glossary fields, benchmark results, language support) was silently EXCLUDED from the checksum. The curator review binding (CI-4C) would have accepted changes a reviewer never saw. The canonical form now sorts keys at every level; all checksums shift once and every review binds to the full content.

## 2. Subject specialist responsibilities (per specialist, enforced in code)

- Explain concepts at the class's learning level — pack glossary + retrieval context provide the anchor vocabulary.
- Identify prerequisites — pack `competencyLevels` carry prerequisite chains; findings must respect them.
- Use domain-specific terminology — glossary terms with registered source anchors.
- Explain procedures step by step — and never claim a computation was verified without showing the check (CI-3 maths boundary, unchanged).
- Distinguish facts from interpretations — historical/pack claims carry evidential status (CI-4C history-philosophy boundary).
- Reference sources — only through the grounding path above.
- Identify missing evidence — `unknowns[]` with honest reasons; retrieval gaps are explicit.
- Request another specialist — ONLY via a structured handoff record to a declared related domain; C7 refuses undeclared targets; planning stays server-side.
- Refuse out-of-scope tasks — deterministic prohibited-task matching (CI-3, unchanged).

## 3. Professional knowledge boundaries (charter §14, restated + enforced per pack)

| Domain | Allowed | Never |
|---|---|---|
| Medicine (health-medicine-edu, HIGH_STAKES) | Educational explanations of anatomy/physiology/health science | Diagnosis, treatment prescription, personalised medical guidance, clinical decision support |
| Law (law-governance) | General legal education with the jurisdiction EXPLICITLY stated | Representation, individual legal advice, jurisdiction-ambiguous claims |
| Finance (accounting-finance, ELEVATED) | Educational concepts (interest, risk, diversification) | Personalised investment recommendations, tax advice for a specific person/entity |
| Engineering / safety-critical | Educational examples WITH stated assumptions and applicable-standards awareness (CI-4C pack boundary) | Certifiable designs, safety-critical approvals, site-specific sign-off |
| Education (CI-4C) | Lesson-design advisories | Diagnosis of learning disabilities, public ranking of named students, retention/discipline decisions |

The system must never imply that its outputs replace licensed professionals — HIGH_STAKES packs route regulated questions to qualified humans, and every specialist output of an IN_REVIEW pack is marked as resting on an unverified knowledge base.

## 4. Cross-domain collaboration (the renewable-energy example, mechanically)

A renewable-energy lesson resolves through the taxonomy to multiple families (e.g. physics-space + sustainability-energy + engineering). The dispatcher selects specialists ONLY for families with pack coverage, within the 3-domain cap, via declared relationships (`relatedSubjectDomainIds`) — it never runs "everyone for everything". A physics specialist that meets electrical-distribution content emits a structured handoff to `engineering` ONLY if that domain is declared related (C7); the orchestrator preserves the handoff verbatim (never averaged away); the Evidence Auditor audits handoff-carrying outputs like any other; and if the owner/dispatcher accepts the proposal, the engineering specialist answers under ITS OWN pack scope and safety boundary — never with permissions inherited from the asker.

## 5. What CI-4E did NOT build (honest)

- Handoff execution is a PROPOSAL pipeline: actual follow-up dispatch remains a dispatcher/owner decision (the charter's server-authority rule). No automatic follow-up dispatch exists.
- Benchmarks remain deterministic fixture runs; no model-judged benchmarks were introduced (a model never grades a model).
- No new specialists were added: 12 packs cover 12 of 36 families; occupation mapping coverage is recorded in the world taxonomy doc (12 verified O*NET mappings). Claims stay proportionate to evidence.
