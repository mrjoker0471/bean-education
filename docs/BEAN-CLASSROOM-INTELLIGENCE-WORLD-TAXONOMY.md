# BEAN Classroom Intelligence — World Knowledge & Professional Taxonomy (CI-4B)

Milestone: CI-4B. Date: 2026-11-25. Baseline: `d86dfcc` → CI-4 branch.
Implementation: `src/lib/ci/fleet/world-taxonomy.ts` (+ the CI-3 adapters it builds on: `taxonomy.ts` — 11 ISCED-F broad fields, 36 BEAN domain families, deterministic subject resolution with `matchedOn` evidence).

## 1. What this unit does — and deliberately does not do

CI-4B builds the profession/competency classification layer as **permitted metadata import with preserved identifiers**:

- Original upstream identifiers (e.g. O*NET-SOC codes) are preserved **verbatim** — never re-encoded or collapsed into an invented BEAN hierarchy. BEAN domain families are a *crosswalk target*, not a replacement.
- Every crosswalk record is a **BEAN-created mapping** (`adaptedBy: 'BEAN'`) with explicit confidence — BEAN mappings are never passed off as upstream data.
- Jurisdiction is per-record and classifications are never merged across jurisdictions.
- Only **identifiers, labels and relationship facts** are imported in CI-4B. Descriptive profile text is NOT imported — that is a controlled ingestion run behind the CI-4A licence gate (`assertSourceContentUsable`).
- No identifier is shipped from memory. Every shipped identifier was **verified live** at `verificationRef` on the audit date.

## 2. Source-by-source position (full licence records in the source licence audit)

### ESCO (European Commission) — `esco-classification`
- Official source: https://esco.ec.europa.eu/
- Position: free **access** is not a content licence. The EC requires the acknowledgement below and disclosure of adaptations. Versioned releases; version must be pinned at the controlled import run.
- Required acknowledgement (exported as `ESCO_CLASSIFICATION_ACKNOWLEDGEMENT` and to be surfaced on any BEAN surface presenting ESCO-derived data):
  > "This service uses the ESCO classification of the European Commission."
- Adaptation disclosure: every BEAN mapping from ESCO concepts must be labelled as an adaptation by BEAN Education; ESCO occupation→skill relations are recorded as structural metadata, not prose.
- **Import state: `LICENCE_GATE_PENDING` — zero identifiers shipped.** ESCO concept URIs (`http://data.europa.eu/esco/occupation/<uuid>`) cannot be asserted from memory; they ship only after a controlled, verification-logged API run. The code refuses any mapping whose source is ESCO until that run exists (tested: B6, B8).

### O*NET (U.S. Department of Labor / National Center for O*NET Development) — `onet-web-database`
- Official source: https://www.onetcenter.org/ ; live record pages at onetonline.org.
- Licence: **CC BY 4.0** — verified live 2026-11-25 (record pages carry "Creative Commons Attribution 4 / CC-BY" notices; onetcenter.org/license.html states the terms and that **O*NET® is a trademark of the U.S. Department of Labor**).
- Trademark rule: outputs that name O*NET reproduce the notice ("O*NET® is a trademark of the U.S. Department of Labor") — encoded in the record's attribution string.
- Third-party rule: resources referenced BY O*NET records are NOT automatically licensed — recorded in the licence statement; only O*NET's own published identifiers/labels/relationship facts are in scope.
- **Import state: `METADATA_SEED_IMPORTED` — 12 curated occupation mappings**, each identifier+label verified live (title-match at onetonline.org, 2026-11-25):

| O*NET-SOC | Label (verbatim) | BEAN domain(s) | Confidence |
|---|---|---|---|
| 15-1252.00 | Software Developers | computing-software-it | EXACT |
| 15-2051.00 | Data Scientists | ai-data | EXACT |
| 15-1244.00 | Network and Computer Systems Administrators | cybersecurity-networks, computing-software-it | CLOSE |
| 11-3021.00 | Computer and Information Systems Managers | computing-software-it, business-management | PARTIAL |
| 25-2021.00 | Elementary School Teachers, Except Special Education | education-pedagogy | EXACT |
| 25-1022.00 | Mathematical Science Teachers, Postsecondary | education-pedagogy, mathematics-statistics | PARTIAL |
| 25-1042.00 | Biological Science Teachers, Postsecondary | education-pedagogy, biology-life | PARTIAL |
| 29-1141.00 | Registered Nurses | nursing-allied-health | EXACT (educational context only, §14) |
| 13-2011.00 | Accountants and Auditors | accounting-finance | EXACT (educational concepts only, §14) |
| 47-2111.00 | Electricians | skilled-trades | EXACT (educational examples ≠ professional work, §14) |
| 19-2011.00 | Astronomers | physics-space | EXACT |
| 25-4011.00 | Archivists | history-philosophy | PARTIAL |

Confidence vocabulary (BEAN-authored, machine-checkable): `EXACT` (unambiguous core domain) · `CLOSE` (strongly aligned, minor scope differences) · `PARTIAL` (bridges 2+ domains, all listed) · `MANUAL_REVIEW`. Validation refuses mappings outside the vocabulary, mappings into unknown BEAN domains, mappings without verification evidence, and mappings whose source fails the licence gate.

Deliberately small: curated verified records beat manufactured coverage. Expansion follows the same verify-then-record process.

### India NCO 2015 — `india-nco-2015`
- Official source: https://www.dge.gov.in/national_classification_of_occupations
- Audit finding: dge.gov.in was **unreachable** from the audit environment (2026-11-25) and the publication offers PDFs without a stated open-content licence. A downloadable PDF is not a reuse licence.
- **Import state: `NO_IMPORT_PERMISSION_UNVERIFIED` — zero content, zero codes.** Only factual reference metadata is stored (name, official URL, version "NCO 2015 (ISCO-08 structure)", attribution line). Restriction flags: `REFERENCE_ONLY` + `PERMISSION_PENDING`. The code refuses any mapping attempt against this source (tested: B6). If a human verifies reuse permission later, the record is updated by that decision — never automatically.

### India NSQF / NQR — `india-nsqf`
- Official sources: https://nqr.gov.in/nsqf (reachable 200 at audit) and https://ncvet.gov.in/ (403 to the audit environment — recorded honestly).
- Position: the framework **structure** (10 outcome-based qualification levels, learning-outcome orientation) is factual classification data and is represented in BEAN's own words with citation. Descriptor text is not reproduced. Restriction: `REFERENCE_ONLY`.
- **Non-claim enforced and tested (B9):** a BEAN-generated skill assessment is NOT an NSQF qualification, NQR entry or government certification. This non-claim is recorded in the source record and must surface wherever the framework is referenced.
- **Import state: `STRUCTURE_CITED_ONLY`.**

### ILO ISCO-08 — `ilo-isco-08`
- Structural facts only (e.g. "NCO 2015 incorporates ISCO-08"; major-group identifiers) as factual crosswalk metadata; ILO descriptive text not imported; terms re-read required before any content import. **Import state: `STRUCTURE_CITED_ONLY`.**

### ISCED-F 2013 (existing CI-3 seed, unchanged)
- The 11 broad-field codes/names remain the subject-side factual seed; the 36 BEAN domain families map to ISCED codes via `iscedCodes` (charter §6.1). CI-4B does not alter this.

### Wikidata (evaluated, not registered)
- CC0 — structured data may be reused without conditions. Suitable as a **crosswalk assistant**; any use would be quality-class `COMMUNITY_CONTEXT` (community-derived, never sole authority) and must record Q-identifiers verbatim. Not needed for CI-4B's deliverable; deferred rather than imported without purpose.

## 3. Crosswalk integrity rules (tested in `tests/unit/ci4-world-taxonomy.test.ts`)

1. **Identifier preservation:** external ids/labels round-trip verbatim (B2); O*NET-SOC format enforced; no ESCO URI is ever fabricated (B8).
2. **Occupation mapping:** mappings must point at existing BEAN domain families; unknown domains refused (B5); PARTIAL bridges list every domain (B10).
3. **Skill mapping:** occupation→skill facts stay structural metadata in this unit; descriptive skills/abilities remain unimported pending the controlled run (per-source `recordCount`/state makes this machine-checkable — B7).
4. **Jurisdiction separation:** per-record jurisdiction, never merged (B3).
5. **Crosswalk confidence:** BEAN-authored vocabulary only; invalid values refused (B4).
6. **Unknown-domain handling:** queries for unknown domains return honest empty results (B10); the CI-3 subject resolver continues to report `matched: false` rather than guess.
7. **Licence-gate integration:** a source that fails `assertSourceContentUsable` cannot gain mappings at all (B6) — the CI-4A quarantine is authoritative even at metadata level.

## 4. Missing domains and limitations (honest)

- 12 verified occupations cover 11 of 36 BEAN families — **25 families have zero occupation mappings**. Coverage claims are per-record; nothing is "expert".
- ESCO's multilingual labels (a key CI-4 value for Indian-language context) are NOT yet available — gated behind the controlled import run.
- O*NET occupation profile content (knowledge areas, skills, abilities, work activities, education levels) is **not imported**; only identifiers/labels/domain-mappings are. When imported, it must be version-pinned and attributed per record.
- NCO 2015 has no verified reuse permission; Indian occupation classification is currently represented ONLY via ISCO-08 structural facts.
- NSQF levels are structural citations, not aligned skill taxonomies; no BEAN assessment claims NSQF equivalence.
- Occupation data is US-centric (O*NET). India-context occupation grounding awaits either NCO permission or an ESCO run (ESCO has EU jurisdiction; Indian coverage would need explicit crosswalk work with disclosed confidence).
