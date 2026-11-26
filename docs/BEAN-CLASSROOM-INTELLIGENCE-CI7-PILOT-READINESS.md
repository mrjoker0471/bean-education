# BEAN Classroom Intelligence — CI-7A Pilot Readiness Audit & Domain Selection

**Milestone:** CI-7 — Controlled Real Expert Pilot & First Genuine Knowledge Approval
**Status:** AUDIT COMPLETE (software-side). Selection is a RECOMMENDATION; the owner approves it (§ owner gates).
**Base verified:** main `cdc036c5e966f5fa53014d75d0ba979c5654380c` (CI-6 close-out; PR #49 merged).
**Method:** source-level audit of the live registry code — `src/lib/ci/fleet/packs/index.ts` (pack definitions), `src/lib/ci/fleet/packs/sources.ts` (seed source records), `src/lib/ci/fleet/sources.ts` (licence registry + gates), `src/lib/ci/fleet/curator.ts` (approval derivation), `src/lib/ci/fleet/domain-packs.ts` (validation V1–V8 + checksum). Every claim below is backed by an identifier that exists in the repository. A machine test (`tests/unit/ci7-pilot-readiness.test.ts`) binds this document's factual claims to the registry so the two cannot drift.

**Honesty baseline:** all 12 packs are declared `IN_REVIEW` with `humanReview: null` and zero recorded `ClassroomPackReview` rows anywhere in the repository. The real-world pilot has NOT been executed; verified real expert count remains **0**. Nothing in this document changes that.

---

## 1. Candidate domains actually found in the repository

The domain registry (`listDomainPacks()` in `src/lib/ci/fleet/domain-packs.ts`, seeded by `src/lib/ci/fleet/packs/index.ts`) contains exactly **12 packs**, all `packVersion '1.0.0'`, all declared `IN_REVIEW`. This is the complete candidate set — no domain outside this list was considered, and no new domain was invented.

| # | domainId | ISCED | riskClass | source(s) (sourceId) | source licence (spdx) | content-usable for BEAN's commercial purpose? | approval policy |
|---|---|---|---|---|---|---|---|
| 1 | mathematics-statistics | 05 | STANDARD | openstax-mathematics | CC-BY-NC-SA-4.0 | **NO — QUARANTINED** (NON_COMMERCIAL + SHARE_ALIKE; CI-4A audit correction) | 1 distinct qualified approver |
| 2 | computing-software-it | 06 | STANDARD | python-docs-psf; mdn-web-docs | PSF-2.0; CC-BY-SA-2.5 | **YES** (PSF version-pinned; MDN with SHARE_ALIKE obligation on adaptations) | 1 |
| 3 | accounting-finance | 04 | **ELEVATED** | un-feed-the-minds-financial-literacy-note | BEAN-authored (no external licence) | YES | 1 |
| 4 | health-medicine-edu | 09 | **HIGH_STAKES** | openstax-anatomy-physiology | CC-BY-NC-SA-4.0 | **NO — QUARANTINED** (NON_COMMERCIAL + SHARE_ALIKE) | **2 distinct qualified approvers** |
| 5 | physics-space | 05 | STANDARD | openstax-science-series | CC-BY-NC-SA-4.0 | **NO — QUARANTINED** | 1 |
| 6 | chemistry-materials | 05 | STANDARD | openstax-science-series | CC-BY-NC-SA-4.0 | **NO — QUARANTINED** | 1 |
| 7 | biology-life | 05 | STANDARD | openstax-science-series | CC-BY-NC-SA-4.0 | **NO — QUARANTINED** | 1 |
| 8 | languages-literature | 02 | STANDARD | cefr-companion-volume; ncert-textbooks | none (REFERENCE_ONLY both) | **NO — content ingestion forbidden** (citation only) | 1 |
| 9 | education-pedagogy | 01 | STANDARD | bean-authored-education-pedagogy-seed | BEAN-authored original (restrictions: none) | **YES** | 1 |
| 10 | engineering | 07 | STANDARD | bean-authored-engineering-seed | BEAN-authored original | **YES** | 1 |
| 11 | agriculture-agritech | 08 | STANDARD | bean-authored-agriculture-agritech-seed | BEAN-authored original | **YES** | 1 |
| 12 | history-philosophy | 02 | STANDARD | bean-authored-history-culture-seed | BEAN-authored original | **YES** | 1 |

Approval policy source: `resolveCuratedStatus` in `src/lib/ci/fleet/curator.ts` — `approvalsRequired = pack.riskClass === 'HIGH_STAKES' ? 2 : 1`; approvals must be recorded by **distinct** `reviewerStudentId`s through `recordPackReview` with `qualifiedApproverIds` supplied by `qualifyingApproverIdsForDomain` (CI-5D authority). Approval is a *decision* recorded in the append-only `ClassroomPackReview` ledger; `VERIFIED` pack status is derived, never declared.

### Source licensing assessment (CI-4 authority respected)

The CI-4A audit (`docs/BEAN-CLASSROOM-INTELLIGENCE-SOURCE-LICENSE-AUDIT.md`, implemented as `assertSourceContentUsable` in `src/lib/ci/fleet/sources.ts`) is the binding licence authority. CI-7 adds **no** new licence decision and promotes **no** quarantined source:

- **6 packs are disqualified outright by the licensing gate** for commercial content use: the three OpenStax-sourced packs (mathematics-statistics, physics-space, chemistry-materials, biology-life — via `NON_COMMERCIAL` + `SHARE_ALIKE` restrictions recorded 2026-11-25), health-medicine-edu (same), and languages-literature (`REFERENCE_ONLY` on both CEFR and NCERT — citation permission is NOT content-ingestion permission). Using any of these to produce commercial knowledge content would breach the recorded CI-4 decisions; CI-7 does not touch them.
- **7 packs remain licensable candidates**: computing-software-it (external sources with real but manageable obligations — PSF-2.0 version-pinning, MDN CC-BY-SA-2.5 ShareAlike on adaptations) and the five CI-4C BEAN-authored-seed packs plus accounting-finance (BEAN-authored original content, no external licence obligations, version `1.0.0` pinned in-repo).

## 2. Evidence-based elimination

| Candidate | Eliminated / retained | Reason (evidence) |
|---|---|---|
| mathematics-statistics, physics-space, chemistry-materials, biology-life | **Eliminated** | Sole source quarantined (`NON_COMMERCIAL`); commercial content use forbidden by CI-4A gate |
| health-medicine-edu | **Eliminated** | Source quarantined **and** `HIGH_STAKES` (2-approver rule; medical-adjacent harm surface) — the opposite of a low-risk first pilot |
| languages-literature | **Eliminated** | Both sources `REFERENCE_ONLY` — a downloadable PDF is not a reuse licence (CI-4A) |
| accounting-finance | **Retained, not selected** | Licensable (BEAN-authored) but `ELEVATED` riskClass: financial-adjacent harm surface; a later pilot candidate once the review pipeline is proven |
| computing-software-it | **Retained, not selected** | Licensable and `STANDARD`, but sources are externally versioned (Python docs "per-language-version", MDN "continuously updated upstream") — source-freshness and ShareAlike adaptation obligations add moving parts a first pilot should not carry |
| engineering | **Retained, not selected** | Licensable, `STANDARD`, BEAN-authored; safety boundary is well-drawn, but factual/physical correctness errors carry a higher harm surface than pedagogy guidance |
| agriculture-agritech | **Retained, not selected** | Licensable, `STANDARD`, BEAN-authored; agrochemical/biosecurity-adjacent advice needs extra care — held for a later cohort |
| history-philosophy | **Retained, not selected** | Licensable, `STANDARD`, BEAN-authored; interpretive subject makes "factual accuracy" evaluation noisier for a first calibration pilot |
| **education-pedagogy** | **SELECTED (recommended)** | See §3 |

## 3. Recommended first pilot domain — `education-pedagogy`

**Exact identity (verified against `src/lib/ci/fleet/packs/index.ts`):**
- `domainId: 'education-pedagogy'`
- `stableUri: 'bean:ci3:domain:education-pedagogy'`
- `packVersion: '1.0.0'` · checksum computed at runtime by `computePackChecksum` (sha256 over fully-nested canonical JSON, V8 determinism-checked)
- `riskClass: 'STANDARD'` → existing approval policy requires **1 distinct qualified approver**; CI-7B protocol nevertheless requires ≥2 independent reviewers so genuine disagreement can be observed and adjudicated without ever being averaged away
- `status: PACK_STATUS.IN_REVIEW` (declared), `humanReview: null` — exactly the state a pilot should start from: no approvals exist, none will be fabricated
- `effectiveAt: '2026-11-25'`, `reviewDueAt: '2027-05-25'` (review not yet due — freshness window intact)

**The exact reasons for selecting it (each verifiable in code):**

1. **Cleanest licensing position of any pack.** Its only cited content source is `bean-authored-education-pedagogy-seed` — publisher BEAN Education, version 1.0.0, `restrictions: []`, `verifiedAt 2026-11-25`, registered in `src/lib/ci/fleet/packs/sources.ts` as original in-repo content. `assertSourceContentUsable('bean-authored-education-pedagogy-seed')` passes for a commercial operation with **zero external licence obligations** (the machine gate records only BEAN's own attribution duty — no ShareAlike adaptation terms, no NonCommercial quarantine, no upstream version-pinning). No external licence re-reads, no ShareAlike adaptation duties, no version-pinning of upstream releases. (Taxonomy anchoring additionally cites `unesco-isced-f-2013` — ISCED-F 2013 broad field 01 — for the classification framework only; concept-level citation, no content ingestion, consistent with the existing CI-4 usage.)
2. **Lowest harm surface that still exercises the full review authority.** The pack's own `safetyBoundary` is explicit and modest: pedagogy guidance is advisory for lesson design; never diagnose learning disabilities or health conditions; never rank or publicly grade named students; route safeguarding to humans. Errors in a pedagogy glossary definition are pedagogically wrong, not physically, financially or medically dangerous — the safest domain in which human reviewers, adjudication and (if ever earned) activation controls can be exercised end-to-end.
3. **Bounded and stable.** The pack is small and fully in-repo: 5 glossary terms (formative assessment, scaffolding, cognitive load, spaced repetition, differentiation), 3 competency levels, explicit `allowedTasks`/`prohibitedTasks`, and 2 agent profile bindings (`BEAN_SUBJECT_EXPERT::education-pedagogy`, `BEAN_PEDAGOGY_SPECIALIST` — the only seed pack with two specialist agents). Source content is versioned `1.0.0` in-repo; the pack checksum is deterministic (V8). A source-frozen review (CI-7D) binds to all of it with zero external drift risk.
4. **A bounded evaluation is technically possible without student data.** Reviewers evaluate *content and guidance quality* (definitions, competency progression, task boundaries, rubric sections A–F) — no student records, grades, identities or classroom artefacts are involved at any point. The CI-4 fixture suite already has education fixtures (`ci4-fixture-education-grounded`), and fixture results remain marked fixture-only (never counted as real evidence).
5. **Realistically recruitable expert cohort.** The pilot needs genuine, verifiable professionals — qualified teachers, teacher-educators, education researchers. This is the most recruitable qualification population among the licensable candidates, and their credentials (teaching qualification, education degree, publication/employment record) fit the existing CI-6C verification methods (DOCUMENT_EXAMINATION / ISSUING_BODY_REFERENCE / PUBLISHED_REGISTRY).
6. **Disagreement analysis will be meaningful.** Pedagogy mixes factual claims (cognitive-load research) with interpretive judgement (assessment design advice) — a genuine mix of FACTUAL / INTERPRETIVE / RUBRIC_RELATED disagreements (CI-7E classifications) is plausible, which is exactly what a first pilot should surface rather than suppress.

## 4. Risks and limitations (recorded honestly)

- **Thin content depth.** The seed is a 5-term glossary + competency scaffold — deliberately shallow. The pilot validates the *review and activation machinery* on real evidence; it does not claim deep pedagogical coverage. Findings (CI-7E) should recommend depth improvements.
- **No external authoritative source yet.** `permittedUse` for the seed records the caveat: "authoritative claims need a registered external source". An expert reviewer may flag that certain definitions warrant grounding in an external authority; registering one later follows the CI-4 licence gate — it cannot shortcut it.
- **Zero reviews exist.** The pack is IN_REVIEW with no human review rows. The approval threshold (1 distinct qualified approver for STANDARD) is reachable in principle the moment a genuine verified expert records an APPROVED review through the existing authority — but **none exists today and none will be manufactured by CI-7**.
- **Verification is examiner-dependent.** CI-6C verification is human DOCUMENT_EXAMINATION etc. — quality depends on the authorised examiner. The protocol (CI-7B) requires an examiner other than the applicant; the examiner's judgement is not independently auditable by software.
- **Owner-dependent requirements ( blockers that software cannot clear):** owner approval of the recommended domain; owner approval of the protocol and participant terms; real invitations through a secure channel; real credential examinations by authorised administrators; real reviews by real activated experts; owner authorisation of any restricted activation. Until then: verified-expert count **0**, completed human reviews **0**, pack approval count for the pilot domain **0/1**.

## 5. Requirements that remain owner-dependent

1. Approve (or reject) the recommended domain `education-pedagogy` v1.0.0 for the pilot.
2. Approve the pilot protocol and participant-facing terms (CI-7B) — including any legal review of participant information BEAN deems necessary. CI-7 records these as owner gates; it does not invent legal consent or compensation terms.
3. Perform recruitment (invitations are created by admins, delivered manually — BEAN sends no external messages) and independent credential verification through the live CI-6 workflows.
4. Authorise restricted pilot activation (CI-7G) only after the existing CI-4/CI-5 approval authorities record the required genuine approvals.
5. Decide the compensation question for participants (the protocol records the chosen answer; CI-7 does not assume one).

## 6. What CI-7A did NOT do

- Did not modify any pack, source, licence record, status or checksum.
- Did not promote any quarantined source or treat citation permission as ingestion permission.
- Did not create review rows, approvals, experts, invitations, fixtures-in-production, or any real-world record.
- Did not alter CI-1..CI-6 behaviour in any way.

Machine check: `tests/unit/ci7-pilot-readiness.test.ts` asserts the registry facts this document relies on (candidate set, recommended pack identity/risk/policy, licensing gate outcomes for selected and eliminated candidates, checksum determinism).
