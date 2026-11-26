# BEAN Classroom Intelligence — CI-7B Controlled Pilot Protocol & Governance

**Milestone:** CI-7 — Controlled Real Expert Pilot & First Genuine Knowledge Approval
**Protocol version:** `ci7-pilot-protocol-1` (machine-pinned in `src/lib/ci/fleet/pilot.ts`; changing any governing constant below requires a new protocol version and a re-consent of participants)
**Status:** DRAFT FOR OWNER APPROVAL. Nothing in this protocol is executable until the owner authorisation points in §12 are passed. The real-world pilot has NOT been executed; every real count is zero until genuine records exist.

**Machine binding:** `tests/unit/ci7-pilot-protocol.test.ts` asserts the constants below against the live registry and the existing approval authorities. The document and the code cannot drift silently.

---

## 1. Exact subject of the pilot

| Field | Value | Authority |
|---|---|---|
| Domain | `education-pedagogy` | CI-7A readiness audit (owner approval pending) |
| Pack | `bean:ci3:domain:education-pedagogy` | `src/lib/ci/fleet/packs/index.ts` |
| Pack version | `1.0.0` | same |
| Pack checksum | computed at review time by `computePackChecksum` (sha256, fully-nested canonical JSON); every review binds to it | `src/lib/ci/fleet/domain-packs.ts` |
| Declared status at protocol drafting | `IN_REVIEW`, `humanReview: null`, zero recorded reviews | registry facts, test R1/R2 |
| Risk class | `STANDARD` → existing approval policy requires **1** distinct qualified approver | `resolveCuratedStatus`, `src/lib/ci/fleet/curator.ts` |
| Source | `bean-authored-education-pedagogy-seed` v1.0.0 (BEAN-authored; restrictions none) | `src/lib/ci/fleet/packs/sources.ts` |

The checksum is recorded in the ledger at each review, not in this document — the document pins the *version discipline*, never a frozen hash that could silently diverge from content.

## 2. Intended purpose (the only purpose)

Bounded, non-consequential **educational knowledge validation**: genuine qualified experts review the pedagogy pack's content (glossary definitions, competency progression, task boundaries, safety boundary) against the CI-5 A–F rubric, producing attributable human-review evidence that either (a) supports recording a genuine pack approval through the existing CI-4/CI-5 authority, or (b) produces documented findings and corrections.

The pilot additionally serves as the first end-to-end exercise of the review → disagreement → adjudication → (possible) activation machinery on real evidence.

## 3. Excluded use cases (hard exclusions)

1. Any student assessment decision — grades, progress judgements, promotion/retention.
2. Any payment, pricing, admissions, hiring, employment or institutional high-stakes decision.
3. Diagnosis of learning disabilities or health conditions; replacement of a qualified special-educational-needs assessment (pack `prohibitedTasks` — respected verbatim).
4. Public ranking or grading of any named student (pack `prohibitedTasks`).
5. Retention/discipline decisions for any individual learner (pack `prohibitedTasks`).
6. Transcription, audio/video recording, or any voice capability — TRANSCRIPTION remains structurally `UNSUPPORTED` (charter §9.2; enforced in `language-governance.ts`).
7. Global activation of the pack for all BEAN users or all agent surfaces — only the bounded restricted pilot scope (§11) may be enabled, and only after §12 gates.
8. Use of quarantined or reference-only external material as content (CI-4A gate — no promotion, no citation-as-ingestion).
9. Benchmark publication or model-performance claims beyond the CI-7F evidence rules (no metric without sufficient genuine labelled evidence).

## 4. Source-material inclusion rules

- Only content traceable to the registered pilot source (`bean-authored-education-pedagogy-seed`) and the ISCED-F 2013 taxonomy anchor (framework citation only) is in scope.
- No external text is imported into the pack during the pilot. If reviewers identify a need for an external authoritative source, the finding is recorded (CI-7E) and any future registration goes through the CI-4 licence gate — never around it.
- Any content change means a **new pack version + new checksum**; reviews bound to the old checksum become stale and are structurally refused by `recordPackReview` (409). Version-bound re-review is required (CI-5H renewal-demand lifecycle stays authoritative).

## 5. Reviewer qualification requirements

Everything reuses the existing CI-5/CI-6 authorities — no new onboarding system:

1. **Account:** a real, authenticated BEAN account (server-resolved identity; no client-supplied identities).
2. **Application:** through the existing flow (`INVITE → APPLY → EVIDENCE → INDEPENDENT VERIFICATION → QUALIFICATION → ACTIVATION`, `docs/BEAN-EXPERT-ONBOARDING-OPERATIONS.md`). Claiming an invitation grants no privilege.
3. **Verification:** credentials examined by an authorised person **other than the applicant** (`recordVerification`, CI-6C — self-dealing refused 403). Holding a document is not proof of authenticity; methods are limited to DOCUMENT_EXAMINATION / ISSUING_BODY_REFERENCE / PUBLISHED_REGISTRY with recorded reference detail.
4. **Qualification:** admin qualification decision with exact approved scope `education-pedagogy` (server-side `validateReviewerScope`; scope is never client-writable), `verificationStatus !== 'UNVERIFIED'`, and a stated qualification category.
5. **Activation:** `ACTIVE` status with `availability === 'AVAILABLE'` at assignment time (CI-6F gate).
6. **Expiry discipline:** expired/suspended/revoked/withdrawn reviewers are not assignable (lazy expiry + strict transitions, CI-5B); eligibility is re-derived on every read.
7. **Language reviewers (if any language review is included):** exact approved language tag + task scope via `reviewerCanReviewLanguage`; TRANSCRIPTION is refused at scope-write time and never reviewable.
8. **Directory listing is NOT a condition of participation:** `PROFILE_VISIBILITY.PRIVATE` experts participate fully; listing is a separate disclosure consent (CI-6D).

## 6. Required number of independent reviewers

- **Approval threshold (existing policy, unchangeable by CI-7):** 1 distinct qualified approver for a STANDARD pack — `resolveCuratedStatus` derives VERIFIED only from distinct `reviewerStudentId`s bound to the exact version+checksum through `recordPackReview` with `qualifiedApproverIds`.
- **Pilot requirement (this protocol):** **≥ 2 independent completed reviews by 2 different verified experts** before any pilot acceptance evaluation is made. Rationale: the pilot's purpose is to observe genuine human judgment including disagreement; a single review cannot reveal disagreement, and CI-7E's analysis needs at least one comparison point. The pilot requirement is deliberately *stricter* than the approval policy and never weaker; it cannot and does not bypass or relax the existing threshold.
- **Independence enforcement (existing gates):** one-open-assignment-per-subject, completed-checksum separation (no reviewer re-assigned to the same checksum they completed), COI refusal, recusal, reassignment — all via the existing `assignments.ts` authority.

## 7. Conflict-of-interest rules

- Declared at application (`COI_DECLARED` event, CI-5B) and re-declared at assignment time (`coiCheck: 'NONE_DECLARED' | 'CONFLICT_FOUND'`; `CONFLICT_FOUND` refuses assignment 409).
- A conflicted reviewer cannot accept, start, submit or approve; recusal (`RECUSED`, reason ≥10 chars) is always available and auditable.
- Adjudicators must be independent of the disagreeing reviewers (adjudication is created as a separate assignment for a different qualified reviewer — the existing `/api/admin/ci5/adjudications` path).
- The pack author is not an eligible reviewer for this pilot: BEAN-authored content means BEAN staff/contractors involved in authoring the seed must recuse or be excluded at invitation time (admin checklist item).

## 8. Evidence and rubric requirements

- Every review records the CI-5 A–F rubric (`PACK_REVIEW_RUBRIC`, all six sections, `NOT_ASSESSED` is honest, omission is not) with `inspected` free text ≥20 chars describing what was actually inspected.
- CI-7D adds a **source-licence snapshot binding**: the review evidence embeds the licence state of the pack's cited sources at review time, so the audit trail shows what licensing facts the reviewer saw.
- Recorded per review (existing `ClassroomPackReview` columns): packId, packVersion, packChecksum, riskClass, decision, reviewerStudentId, reviewerName, rationale (≥20), evidence JSON, timestamp.
- The charter's quality dimensions map to rubric sections: accuracy → B; source fidelity & missing citations → C; completeness & relevance → D; clarity → D/A; safety & suitability → E; unsupported statements → B/C findings in `inspected`/rationale; required corrections → recorded as CHANGES_REQUESTED decisions and CI-7E findings.

## 9. Review and adjudication sequence

1. Admin creates assignment for the pilot pack (subjectType DOMAIN_PACK, subjectKey `education-pedagogy`, version 1.0.0, checksum bound, riskClass STANDARD) — only for ACTIVE, AVAILABLE, scope-matched, COI-clear, pilot-consented reviewers.
2. Reviewer accepts/starts (`ASSIGNED → IN_PROGRESS`) and inspects the actual pack content.
3. Reviewer submits the rubric-backed pack review (existing `/api/ci5/reviewer/assignments/[assignmentId]/pack-review`), decision ∈ {APPROVED, REJECTED, CHANGES_REQUESTED, RE_REVIEW_REQUESTED}; stale version/checksum refused 409.
4. Assignment completes with an `outcomeRef` pointing at the recorded review.
5. `detectReviewDisagreement` runs on the review set for the version; any disagreement is **preserved as recorded** (no averaging, no consensus manufacture).
6. If adjudication is needed, an independent adjudicator assignment is created through the existing adjudications authority; the adjudicator records their own review; `ADJUDICATED` events are append-only. An administrator never substitutes for a qualified domain expert where expert approval is required.
7. Corrections, if any, become a new pack version + CI-7E finding + (if the checksum changes) version-bound re-review.

## 10. Privacy and retention rules

- No student personal data, grades, classroom artefacts or identifiable learner information enters the pilot at any point; reviewer-facing surfaces expose only pack content and rubric material (CI-5 masked-report architecture is the precedent).
- Expert evidence files stay in the restricted 0600 evidence store (CI-6B); withdrawal purges ACTIVE evidence; verification records are append-only (CI-6C); public profiles expose only consented fields (CI-6D).
- Pilot participation consent is recorded as append-only `CONSENT_RECORDED` events (CI-7C) and withdrawn on reviewer withdrawal/revocation of participation.
- Review rows and events are append-only audit history; no destructive migration is permitted (CI-7I validates on an isolated disposable database only).
- Assignment/expiry retention follows the existing lazy-expiry rules; nothing is deleted to hide a decision.

## 11. Evaluation design (summary — full rules in CI-7F)

Human-grounded only. Model/benchmark evaluation runs exclusively through the existing CI-5F benchmark authority (datasets, expert case labels by scoped ACTIVE reviewers, harness runs, regression comparison). A metric may be reported only when the sample of genuine expert labels and the evaluation design support it; otherwise the honest output is `INSUFFICIENT EVIDENCE`. Fixture labels are never human evidence. Language evaluation stays separate from domain-pack approval; TRANSCRIPTION stays `UNSUPPORTED`.

## 12. Acceptance criteria (pilot-level)

The pilot may be evaluated as successful for its **exact scope** only when ALL of:

1. ≥2 independent completed reviews by 2 different genuinely verified, pilot-consented, scope-matched experts on the same pack version+checksum.
2. All rubric sections recorded; approval decisions carry all-OK rubrics; rejection/changes decisions carry recorded issues (rubric/decision consistency enforced by `checkRubricAgainstDecision`).
3. Either zero unresolved factual disagreements after adjudication, or every unresolved disagreement is documented in CI-7E findings with its classification and disposition.
4. Any genuine approval was recorded through `recordPackReview` by a reviewer within `qualifiedApproverIdsForDomain` — never by an admin, never by a model, never self-approved.
5. No stale-checksum review was accepted; any content change triggered version-bound re-review.
6. All activation/rollback events (if any) are append-only and owner-authorised (CI-7G).
7. The findings report (CI-7E) exists and identifies errors, source-quality problems, coverage gaps, rubric ambiguity, disagreement patterns, corrected and unresolved items — including inconvenient ones.

## 13. Stop conditions (any one halts the pilot)

1. Any attempt to use pilot output in a consequential decision (§3) — halt and report.
2. Credential verification cannot be completed honestly for a participant (unverifiable claims, purged evidence, examiner conflict) — halt that participant's cohort entry.
3. Pack checksum drift without re-review — reviews refuse; the pilot pauses until version-bound re-review completes.
4. A licence status change on any cited source — pilot pauses; CI-4 gate re-evaluated before any further review.
5. Adjudication deadlock (disagreement cannot be resolved by the independent adjudicator) — record honestly; no forced consensus; findings report the deadlock.
6. Evidence of a fabricated identity/credential — revoke via the existing authority; preserve the audit trail.
7. Owner authorisation withdrawn at any gate.

## 14. Owner authorisation points (gates that software cannot pass)

| # | Gate | Owner action |
|---|---|---|
| G1 | Domain selection | Approve/reject `education-pedagogy` v1.0.0 as pilot subject (CI-7A §5) |
| G2 | Protocol approval | Approve this protocol version for use (including participant terms below) |
| G3 | Participant terms | Approve the participant information & consent text (§15); obtain any legal review BEAN deems necessary — CI-7 does not invent legal consent |
| G4 | Recruitment | Invite genuine professionals through an appropriate secure channel (admin-created single-use links; BEAN sends no external messages) |
| G5 | Verification | Authorised administrators examine credentials through the live CI-6C workbench |
| G6 | Reviews | Activated experts perform real reviews; admins create assignments through the existing gates |
| G7 | Activation | Authorise restricted pilot activation (CI-7G) only after genuine approvals exist |

## 15. Participant information (what every expert is told, verbatim intent)

- **What they are reviewing:** the BEAN pedagogy pack `education-pedagogy` v1.0.0 — glossary definitions, competency levels, task boundaries and the safety boundary, against a six-section rubric.
- **How their decisions will be used:** recorded as append-only attributable review rows; genuine approvals can contribute to the pack's derived VERIFIED status through the existing authority; disagreements are preserved and may be adjudicated; anonymised patterns may appear in findings reports (their identity stays attributable in the audit ledger).
- **What data they can access:** the pack content, its registered source metadata and licence snapshot, and the rubric — never student data, never other applicants' evidence.
- **Attribution:** reviews are attributed to their reviewer identity in the audit ledger; public directory listing is optional (PRIVATE default) and never a condition of participation.
- **Compensation:** `[OWNER DECISION — G3: record the chosen answer: unpaid / compensated / otherwise agreed]`. CI-7 does not assume or invent an answer.
- **Confidentiality and disclosure expectations:** pack content is BEAN proprietary in-repo material; participants keep it confidential outside BEAN; COI must be declared and is enforced.
- **Withdrawal and privacy:** a participant can withdraw via the existing CI-6 withdrawal flow (purges ACTIVE evidence, terminal status); pilot participation consent is recorded as events and cannot be silently erased where a decision already relied on it — the audit trail is preserved per the retention rules; privacy requests follow the existing CI-6 privacy paths.

Legal/contractual review, compensation commitments and any accreditation claims are **owner gates**, not software outcomes.

## 16. What this protocol does NOT do

- Does not create experts, reviews, approvals, metrics or activations.
- Does not relax any CI-4/CI-5/CI-6 gate, threshold or transition.
- Does not send any external message.
- Does not touch student data, transcription, or consequential decisions.
