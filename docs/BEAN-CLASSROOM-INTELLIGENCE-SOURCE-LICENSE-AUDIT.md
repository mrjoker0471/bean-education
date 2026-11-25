# BEAN Classroom Intelligence — Source & Licence Audit (CI-4A)

Milestone: CI-4A. Audit date: **2026-11-25**. Baseline: `d86dfcc` (origin/main, ls-remote verified).
Registry authority: `src/lib/ci/fleet/sources.ts` (schema + gates) and `src/lib/ci/fleet/packs/sources.ts` / `src/lib/ci/fleet/taxonomy.ts` (seed records). This audit preserves that provenance authority — it corrects facts and adds a machine-checkable content-ingestion gate; it does not weaken any check.

> Principle (charter §7.3, unchanged): a public webpage, PDF or downloadable file is **not** permission to reproduce its content. Citation/reference use (naming a source with attribution) is not reproduction. Content ingestion (retrieval chunks, prompt material, knowledge records) is a separate, stricter path — now gated by `assertSourceContentUsable()`.

## 1. Headline finding — OpenStax licence misclassification (corrected)

**CI-3 recorded all three OpenStax entries as `CC-BY-4.0`. That was wrong.**

Primary evidence (checked 2026-11-25, from OpenStax's official distribution):

- `github.com/openstax/university-physics` README: "…are available under the Creative Commons Attribution-NonCommercial-ShareAlike License", linking `LICENSE`.
- That `LICENSE` file (fetched raw): "**Attribution-NonCommercial-ShareAlike 4.0 International**".
- `github.com/openstax/osbooks-university-physics-bundle` README states the same.
- openstax.org web pages are client-side rendered and could not be read server-side from this environment; the organisation's official GitHub distribution is authoritative for the licence instrument.

Consequences applied in CI-4A:

1. The three records (`openstax-mathematics`, `openstax-anatomy-physiology`, `openstax-science-series`) are corrected to **`CC-BY-NC-SA-4.0`** with an explicit `AUDIT CORRECTION` statement and verification date `2026-11-25`.
2. A machine-checkable restriction pair (`NON_COMMERCIAL`, `SHARE_ALIKE`) is recorded on each.
3. **Content ingestion is QUARANTINED** for these sources in BEAN's commercial operation: `assertSourceContentUsable(id)` refuses with an honest reason ("…NonCommercial-licensed and BEAN operates commercially — separate written permission required (citation/reference use remains permitted)"). The refusal reason is designed to be recorded verbatim in retrieval audit trails (CI-4D).
4. Citation/reference use remains permitted: packs may name OpenStax for concept anchoring with attribution; nothing in BEAN reproduces textbook text (verified: pack glossaries are BEAN-authored definitions).
5. If permission is ever sought from Rice University/OpenStax, the record is updated with `restrictions: ['PERMISSION_PENDING']` → then the granted terms; nothing auto-flips.

**Affected knowledge operation:** content ingestion/retrieval only. Pack validation (V4 "sources registered + usable") is a citation-level check and is intentionally unaffected.

## 2. Mechanism added (CI-4A)

`src/lib/ci/fleet/constants.ts` — `SOURCE_LICENCE_RESTRICTION` vocabulary:
`NON_COMMERCIAL` · `SHARE_ALIKE` · `NO_DERIVATIVES` · `REFERENCE_ONLY` · `PERMISSION_PENDING`.

`src/lib/ci/fleet/sources.ts`:

- `sourceLicenceSchema.restrictions` (optional array, default `[]`) — back-compatible with all existing records.
- `assertSourceContentUsable(sourceId, { commercialOperation = true })` — the ingestion gate. Refuses (with verbatim reasons): unregistered, superseded, `PERMISSION_PENDING`, `REFERENCE_ONLY`, `NO_DERIVATIVES`, and `NON_COMMERCIAL` while `commercialOperation` (BEAN's default — premium subscriptions and teacher payouts make the operation commercial; opting out requires an explicit, auditable flag). ShareAlike sources are usable WITH recorded obligations.

Tests: `tests/unit/ci4-source-audit.test.ts` (9 tests — A1..A9). CI-3's `S1.5` test was tightened (licence identity asserted, not just a verification date) — this reflects the audit's corrected facts; no assertion was weakened.

## 3. Per-source audit table (every registered source)

All fields per the CI-4B record requirements. `Retrieved` = date the licence evidence was actually fetched/read by this audit or inherited from CI-3's verification with re-check.

### 3.1 `openstax-mathematics`
| Field | Value |
|---|---|
| Publisher / authors | OpenStax, Rice University / (none recorded) |
| Canonical ref | https://openstax.org/subjects/math |
| Exact title | OpenStax Mathematics series (college algebra, precalculus, calculus, introductory statistics) |
| Version | current editions (per-volume versioning upstream) |
| Published | per-volume (not pinned) |
| Jurisdiction | — |
| Licence | **CC-BY-NC-SA-4.0** (corrected from CC-BY-4.0; see §1) |
| Restrictions | NON_COMMERCIAL, SHARE_ALIKE |
| Quality class | PROFESSION_BODY |
| Attribution | "OpenStax Mathematics titles © Rice University, licensed CC BY-NC-SA 4.0. View free at openstax.org." |
| Permitted | citation-level reference: concept anchoring, curriculum-scope notes, attribution in outputs |
| Prohibited | ingesting/reproducing/adapting textbook text into prompts, knowledge records or products (commercial operation), absent written permission |
| Superseded | no |
| Verification evidence | github.com/openstax/university-physics `LICENSE` + README (fetched raw 2026-11-25) |
| Retrieved | 2026-11-25 |

### 3.2 `openstax-anatomy-physiology`
Same licence facts as §1/3.1. Title: OpenStax Anatomy and Physiology 2e (published 2022, version 2e). Additional standing boundary: educational reference only — never clinical decision support (charter §14). Verification evidence and retrieval date identical to §3.1.

### 3.3 `openstax-science-series`
Same licence facts. Title: OpenStax Science series (Physics, Chemistry 2e, Biology 2e, Astronomy). Embedded third-party figure rights require per-volume check **if** permission is ever granted. Verification evidence and retrieval date identical to §3.1.

### 3.4 `mdn-web-docs`
| Field | Value |
|---|---|
| Publisher | Mozilla (Mozilla Contributors) |
| Canonical ref | https://developer.mozilla.org |
| Version | continuously updated upstream |
| Licence | CC-BY-SA-2.5 (content); code samples under their own licences |
| Restrictions | SHARE_ALIKE (CI-4A: recorded explicitly) |
| Quality class | ASSESSED_SECONDARY |
| Permitted | commercial use WITH attribution; adaptations of ingested content must carry the same ShareAlike licence |
| Prohibited | adaptations without ShareAlike compliance; treating code-sample licences as content licence |
| Verification evidence | MDN content licence page (CI-3 verification retained; restrictions formalised 2026-11-25) |
| Retrieved | 2026-11-24 (re-affirmed 2026-11-25) |

### 3.5 `python-docs-psf`
| Field | Value |
|---|---|
| Publisher | Python Software Foundation |
| Canonical ref | https://docs.python.org/3/ |
| Version | per-language-version (3.x) |
| Licence | PSF-2.0 (permissive; attribution preserved) |
| Restrictions | none recorded (version-pin obligation stays in the statement) |
| Quality class | OFFICIAL_CURRICULUM |
| Permitted | terminology/semantics/stdlib reference, version-pinned |
| Prohibited | citing a Python version's behaviour against a different version's docs |
| Retrieved | 2026-11-24 (CI-3 verification; no correction needed) |

### 3.6 `un-feed-the-minds-financial-literacy-note`
BEAN-authored seed (no external dataset). Licence: BEAN original; no restrictions. Explicitly NOT a regulatory source. Jurisdiction-specific finance/tax regulator datasets require per-source verification before any import (still true; no import happened).

### 3.7 `ncert-textbooks`
| Field | Value |
|---|---|
| Publisher | NCERT, Government of India |
| Canonical ref | https://ncert.nic.in/textbook.php |
| Jurisdiction | India (curriculum reference) |
| Licence | **no formal open-licence instrument published** — no SPDX claimed |
| Restrictions | **REFERENCE_ONLY** (CI-4A: made machine-checkable) |
| Quality class | OFFICIAL_CURRICULUM |
| Permitted | concept/terminology anchoring, curriculum-alignment notes, attribution of the reference |
| Prohibited | reproducing NCERT text anywhere; treating free PDF download as a reuse licence |
| Retrieved | 2026-11-24 (CI-3 verification; restrictions formalised 2026-11-25). Direct re-fetch of ncert.nic.in was not reachable from this audit environment at audit time — CI-3's verification stands unchanged; the restriction reflects the *absence* of a licence instrument, which is the conservative and correct reading |

### 3.8 `cefr-companion-volume`
| Field | Value |
|---|---|
| Publisher | Council of Europe |
| Canonical ref | https://www.coe.int/en/web/common-european-framework-reference-languages |
| Version | Companion Volume 2020 |
| Licence | free reference framework; attribution requested; **no open-content licence instrument** |
| Restrictions | **REFERENCE_ONLY** (CI-4A) |
| Quality class | OFFICIAL_REGULATOR |
| Permitted | level names/framework cited (A1–C2); descriptor text not copied |
| Prohibited | reproducing descriptor text |
| Retrieved | 2026-11-24 (restrictions formalised 2026-11-25) |

### 3.9 `unesco-isced-f-2013`
| Field | Value |
|---|---|
| Publisher | UNESCO Institute for Statistics |
| Canonical ref | https://uis.unesco.org/en/methods-and-tools/isced |
| Version | ISCED-F 2013 |
| Licence | reuse with attribution for educational/research purposes per UNESCO terms; exact terms re-read required before deeper import |
| Restrictions | none recorded beyond attribution (the imported seed is the 11 broad-field codes/names — factual classification identifiers) |
| Quality class | OFFICIAL_REGULATOR |
| Permitted | subject-field classification seed; attribution on derived published content |
| Prohibited | importing deeper ISCED content without re-reading UNESCO terms |
| Retrieved | 2026-11-24 (CI-3 verification) |

## 4. Sources evaluated for CI-4B (not yet registered — audited for the taxonomy work)

| Source | Licence position | Action in CI-4B |
|---|---|---|
| **ESCO** (esco.ec.europa.eu, European Commission) | Free access ≠ automatic licence. ESCO portal terms require attribution; the charter's mandated acknowledgement is "This service uses the ESCO classification of the European Commission." Adaptations must be disclosed as BEAN mappings. Versioned quarterly releases. | Import occupation/skill identifiers + multilingual labels as METADATA (identifiers + labels are factual classification data), record `adapted: BEAN` on every mapping, keep the acknowledgement string, register with version + retrieval date |
| **O*NET 31.0** (onetcenter.org) | CC BY 4.0 with attribution; O*NET® is a trademark (verified 2026-11-25: onetcenter.org/license.html fetched, "Creative Commons / CC BY / Attribution 4.0" ×multiple, "O*NET® is a trademark" ×5); third-party resources referenced by O*NET are NOT automatically licensed | Import occupation profiles/knowledge/skills/abilities/work-activities as metadata with per-record attribution; do not import third-party-referenced resources; keep trademark notice in outputs that name O*NET |
| **India NCO 2015** (dge.gov.in) | Reuse conditions could NOT be verified from this audit environment (dge.gov.in unreachable at audit time; the site offers PDFs without a stated open licence) | **Do not import content.** Store permitted metadata only: classification name, official URL, hierarchy relationship to ISCO (factual), version, and an explicit `restrictions: ['PERMISSION_PENDING']`-style record until reuse permission is verified by a human |
| **India NSQF/NQR** (nqr.gov.in, ncvet.gov.in) | Government framework descriptions; no open-content licence verified; qualification LEVEL STRUCTURE (10 levels, outcome-based descriptors) is factual | Represent level structure + learning-outcome shape as BEAN-authored reference with citation; explicit non-claim: a BEAN skill assessment is NOT an NSQF qualification or government certification |
| **Wikidata** | CC0 (public domain) — structured data may be reused without attribution (attribution still good practice) | Acceptable as a crosswalk assistant; record Q-identifiers as external ids; never sole authority (community-derived) → quality class COMMUNITY_CONTEXT if used |
| **ILO ISCO-08** | Factual classification structure published by ILO; reuse terms require re-reading | Same treatment as ISCED: identifiers/names as factual seed with attribution note |

## 5. Quarantine decisions recorded by this audit

| Source | Decision | Reason |
|---|---|---|
| openstax-mathematics | **CONTENT QUARANTINE** (citation OK) | CC BY-NC-SA 4.0 vs commercial operation |
| openstax-anatomy-physiology | **CONTENT QUARANTINE** (citation OK) | CC BY-NC-SA 4.0 vs commercial operation |
| openstax-science-series | **CONTENT QUARANTINE** (citation OK) | CC BY-NC-SA 4.0 vs commercial operation |
| ncert-textbooks | **CONTENT REFERENCE-ONLY** (formalised) | no licence instrument published |
| cefr-companion-volume | **CONTENT REFERENCE-ONLY** (formalised) | no licence instrument published |
| mdn-web-docs | ShareAlike obligation recorded; ingestion permitted WITH obligations | CC-BY-SA-2.5 permits commercial use with attribution + SA |
| dge.gov.in NCO 2015 | **NO IMPORT** (metadata links only) | reuse permission unverified; site unreachable from audit environment |
| nqr.gov.in / ncvet.gov.in NSQF | **NO IMPORT** (structure described BEAN-authored, cited) | no open-content licence verified; non-claim enforced |

**Enforcement:** `assertSourceContentUsable()` (sources.ts) — every CI-4D retrieval/ingestion path MUST call it and record the returned reason/obligations verbatim. A source never becomes usable merely because it has been downloaded.

## 6. Attribution obligations to surface in outputs

- OpenStax (citation use): "© Rice University, licensed CC BY-NC-SA 4.0" (per title).
- MDN (ingested content): "MDN Web Docs by Mozilla Contributors, licensed CC-BY-SA 2.5" + ShareAlike notice on adaptations.
- ESCO (CI-4B, when imported): "This service uses the ESCO classification of the European Commission." + BEAN adaptation disclosure.
- O*NET (CI-4B, when imported): CC BY 4.0 attribution + "O*NET® is a trademark of the U.S. Department of Labor" notice.
- NCERT / CEFR / NSQF: reference attributions only (no content reproduced).
