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
