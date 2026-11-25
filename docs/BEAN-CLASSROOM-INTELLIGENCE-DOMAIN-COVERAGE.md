# BEAN Classroom Intelligence — Domain Coverage (CI-3B/CI-3E)

Authoritative status of the profession/subject knowledge base. Companion to the
charter (§6) and the source registry (`src/lib/ci/fleet/sources.ts`). This file
is honest about what is NOT covered — the catalogue is expandable, never
"complete" (charter §1.1).

## Coverage snapshot (2026-11-24, CI-3E)

| Domain pack | ISCED-F | Risk class | Status | Sources (registered) | Fixtures |
|---|---|---|---|---|---|
| mathematics-statistics | 05 | STANDARD | IN_REVIEW | openstax-mathematics | grounding, handoff |
| computing-software-it | 06 | STANDARD | IN_REVIEW | mdn-web-docs, python-docs-psf | — |
| accounting-finance | 04 | ELEVATED | IN_REVIEW | BEAN-authored seed | — |
| health-medicine-edu | 09 | HIGH_STAKES | IN_REVIEW | openstax-anatomy-physiology | refusal cases |
| physics-space | 05 | STANDARD | IN_REVIEW | openstax-science-series | misconception, grounding |
| chemistry-materials | 05 | STANDARD | IN_REVIEW | openstax-science-series | refusal cases |
| biology-life | 05 | STANDARD | IN_REVIEW | openstax-science-series | — |
| languages-literature | 02 | STANDARD | IN_REVIEW | cefr-companion-volume, ncert-textbooks | unverified-translation |

- Taxonomy: 36 domain families across the 11 ISCED-F broad fields
  (`src/lib/ci/fleet/taxonomy.ts`), anchored on UNESCO ISCED-F 2013
  (broad-field names only; terms re-read required before deeper import).
- **8 of 36 families have packs.** Subject text that resolves to a family
  without a pack is an honest no-specialist dispatch (`no domain family
  matched` / pack-not-dispatchable skips) — never a guessed specialist.
- All packs are IN_REVIEW: the charter's VERIFIED gate requires a recorded
  human reviewer plus a passing benchmark; the validator refuses an unreviewed
  VERIFIED pack structurally (V6). Specialist outputs from IN_REVIEW packs are
  marked `requiresHumanReview` and carry an explicit limitation.
- Pack benchmark `lastResult` stays null until the Domain Curator workflow
  records a run; the deterministic fixture suite itself runs green in CI
  (`runDomainFixtureSuite`).

## Licence posture

No copyrighted source text is reproduced in the repository. Registry entries
record licence statements + verification dates; three of the CI-3E sources
(NCERT, CEFR) deliberately carry `spdx: null` because no open-licence
instrument is published upstream — only concept-level references are made and
terms must be re-read before any content import.

## Known gaps (honest)

1. 28 of 36 families await packs (highest demand next: economics-politics,
   business-management, education-pedagogy, environment-earth).
2. All packs are English-first; `languageSupport` entries are EXPERIMENTAL with
   pending CI-3F benchmarks. Translation/terminology support is NOT verified.
3. Retrieval against sources is not implemented — glossary anchoring only
   (licence-gated retrieval is a later milestone).
4. Profession catalogue remains `LICENCE_GATE_PENDING` (ESCO/O*NET terms must
   be re-read before import — charter §6.2/§7.3).

---

## CI-4 update (2026-11-25)

- **12 of 36 families now have packs** (8 CI-3 seeds + 4 CI-4C candidates:
  education-pedagogy, engineering, agriculture-agritech, history-philosophy) —
  all honestly IN_REVIEW; the human curator ledger (CI-4C) and two-reviewer
  HIGH_STAKES rule exist but no pack has human approval yet.
- **26 of 36 families await packs** (previously 28; the CI-4C candidates
  closed education-pedagogy from the "highest demand next" list).
- Profession mappings: 12 LIVE-VERIFIED O*NET occupation identifiers
  (CC BY 4.0, per-record attribution + trademark notice) covering 11 families;
  ESCO at its licence gate; NCO 2015 no-import (permission unverified).
  See BEAN-CLASSROOM-INTELLIGENCE-WORLD-TAXONOMY.md.
- Retrieval is IMPLEMENTED (CI-4D): licence-gated ingestion (OpenStax
  quarantined — CI-4A audit corrected the licence to CC BY-NC-SA-4.0),
  pack-scoped lexical retrieval with provenance, citation validation,
  revocation. The corpus is BEAN-authored glossaries only; no external text
  is ingested.
- Source-grounding for specialists is wired (CI-4E): prompts carry the
  licence-gated retrieval envelope; grounding accepts pack-declared OR
  retrieved sources only.
- Deterministic fixture suite: 12 fixtures (8 CI-3 + 4 CI-4C), all green;
  `runPackBenchmark` records results without flipping status.
