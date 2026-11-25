# CI-5 DOMAIN VALIDATION — Expert Rubric-Backed Pack Review

> Unit: CI-5D · Status: workflow implemented and tested with clearly-labelled
> synthetic fixtures (`tests/unit/ci5-domain-validation.test.ts`). **No real
> domain pack is VERIFIED** — all 12 packs remain IN_REVIEW until genuine
> qualified humans record decisions on real inspections.

## 1. What changed (and what deliberately did not)

Changed (CI-5D strengthening of the CI-4C gate):

- **The promotion path requires reviewer qualification.** `recordPackReview`
  refuses an `APPROVED` decision unless the caller supplies the server-computed
  `qualifiedApproverIds` evidence AND the reviewer's account is in it. The set
  is computed by `qualifyingApproverIdsForDomain` from the CI-5B reviewer
  registry (ACTIVE profiles scoped to the pack's exact domain). A general
  administrator without the required reviewer qualification **cannot substitute
  for an expert** — the admin knowledge-pack route now computes this set
  server-side on every call.
- **Work-states remain available to administrators** (REJECTED /
  CHANGES_REQUESTED / RE_REVIEW_REQUESTED): they are conservative signals that
  can only hold a pack back, never promote it.
- **Structured rubric**: every expert pack review records the six charter
  sections A–F with per-section status/notes (see §2), stored INSIDE the
  append-only review row's evidence field as a versioned JSON payload.
- **Disagreement detection** on every recorded decision
  (`detectReviewDisagreement` over the checksum-bound rows) and an
  **independent adjudication record** path (§4).

Unchanged (CI-4 authority preserved verbatim):

- `ClassroomPackReview` remains the single, append-only decision ledger; there
  is no alternative store or API. Decisions bind to packId + packVersion +
  exact checksum; stale bindings refuse (409); REJECTED is terminal for the
  reviewed version; VERIFIED is derived (`resolveCuratedStatus`) — STANDARD 1
  distinct approver, HIGH_STAKES 2 distinct approvers. Since only qualified
  reviewers can record approvals, distinct approvals ARE qualified approvals.
- Benchmarks cannot promote packs; agents cannot promote packs; CI cannot
  promote packs (the API routes are session-gated; machines have no session).
- Source licence records stay read-only in this API family.

## 2. The expert review rubric (A–F)

| Section | Covers |
|---|---|
| A — Domain scope | subject classification, profession relationships, prerequisites, competency levels, no unsupported coverage claims |
| B — Knowledge accuracy | definitions, reasoning, formulas, procedures, examples, facts-vs-assumptions-vs-opinions separation |
| C — Source provenance | sources exist, exact licence recorded, use licence-compatible, citations support claims, superseded material identified, no unlicensed reproduction |
| D — Educational value | explanations suit levels, correct terminology, prerequisite progression, appropriate examples, understandable objectives |
| E — Safety | professional restrictions, jurisdiction limits, high-stakes boundaries, refusal scenarios, human escalation criteria |
| F — Benchmark quality | original fixtures, correct reference answers, valid reasoning expectations, edge/adversarial/insufficient-evidence cases |

Per-section status vocabulary: `OK` / `ISSUE` / `NOT_ASSESSED` (with notes).
Omission is refused — "NOT_ASSESSED is honest, omission is not".

Decision-vs-rubric consistency is enforced in code:

- `APPROVED` requires **every section OK** (any ISSUE or NOT_ASSESSED refuses).
- `REJECTED` requires **at least one ISSUE** (a rejection must name its reason).
- `CHANGES_REQUESTED` / `RE_REVIEW_REQUESTED` require at least one ISSUE or
  NOT_ASSESSED section (there must be something concrete to change/inspect).
- Plus the free-text requirements: rationale (≥20 chars) and what-was-inspected
  evidence (≥20 chars).

## 3. The expert submit path

`POST /api/ci5/reviewer/assignments/[assignmentId]/pack-review` — the only NEW
expert-facing decision path, writing exclusively through `recordPackReview`:

1. Session → server-resolved reviewer profile (must exist and be ACTIVE for
   ANY submit; suspended/expired reviewers cannot record decisions here — the
   admin work-state path remains for administrators).
2. Assignment ownership re-verified (lazy expiry applied first).
3. **Freshness**: the assignment's checksum must equal the CURRENT pack
   checksum — a changed pack refuses with a re-inspection instruction. A
   reviewer can never review a version they have not actually inspected.
4. Rubric structure + decision-consistency checks.
5. `markAssignmentSubmitted` → `recordPackReview` (qualification evidence
   passed server-side; checksum binding re-validated inside) →
   `markAssignmentCompleted(outcomeRef = reviewId)`.
6. If the authoritative ledger refuses the submission, the assignment returns
   to IN_PROGRESS with a SYSTEM-attributed event — nothing is lost, nothing is
   silently dropped.

## 4. Disagreement and adjudication

- Every recorded decision returns `detectReviewDisagreement` over the
  checksum-bound rows: an APPROVED alongside REJECTED / CHANGES_REQUESTED /
  RE_REVIEW_REQUESTED is flagged. **Both opinions are preserved; scores are
  never averaged; the favourable decision is never silently selected.**
- The conservative ledger semantics already protect the pack: any REJECTED row
  is terminal for that version; work-states are surfaced in the curated
  explanation.
- `POST /api/admin/ci5/adjudications` records the independent resolution:
  the adjudicator must be an ACTIVE reviewer scoped for the SAME domain,
  distinct from every disagreeing reviewer, on an OPEN assignment, and a real
  disagreement must exist. The record is **audit-only** (`ADJUDICATED` event,
  payload includes resolution + both opinions + an explicit note): it never
  mutates `ClassroomPackReview` and never changes the curated status — only
  new, checksum-bound decisions on a version can do that. Adjudication
  completes the assignment exactly once (re-adjudication refuses).

## 5. Approval rules (unchanged in substance, strengthened in evidence)

The pack becomes VERIFIED only when:

1. machine validation passes (CI-3/CI-4 pack gates),
2. required fixtures pass,
3. sources and licences are acceptable (CI-4A quarantine gate),
4. the required number of distinct **qualified** independent human reviewers
   approve the exact version (checksum-bound), and
5. all existing CI-4 approval rules are satisfied (append-only, terminal
   rejection, derived status).

## 6. Tested behaviour (11 tests + updated CI-4C suite)

Rubric structure and consistency (omission/ISSUE/NOT_ASSESSED rules);
golden expert submit (append-only row with rubric evidence, assignment
COMPLETED with outcomeRef, curated VERIFIED, no disagreement); mismatch
refusals with rubric summary; stale-checksum freshness refusal; ownership
enforcement; suspended-reviewer submit refusal (including work-states);
admin route: unqualified admin cannot approve (403 "cannot substitute for an
expert") but can record work-states, and a qualified reviewer-admin (qualified
by a DIFFERENT administrator — the self-review guard refuses self-qualification)
can approve; HIGH_STAKES: one qualified approval is not enough, the same
reviewer cannot be re-assigned a decided version, two distinct qualified
approvals verify; disagreement flagged with both opinions preserved and the
conservative terminal rejection; independent adjudication recorded audit-only
with participation/exactly-once/no-disagreement guards; qualification set
helper reflects ACTIVE scoped reviewers only.

The CI-4C suite (`tests/unit/ci4-curator.test.ts`) was updated for the
strengthened gate: its direct `recordPackReview` APPROVED calls now carry the
qualification-evidence option (fixture set), the golden admin-route approval
runs against a reviewer-registry fixture in the isolated DB, and new negative
cases prove the promotion path cannot bypass qualification.

## 7. Honest state

- Zero real review decisions exist: every pack remains IN_REVIEW; every
  approval in tests belongs to a clearly-labelled synthetic fixture reviewer.
- The recommended first-wave pack set (mathematics-statistics,
  education-pedagogy, physics-space, computing-software-it, engineering with
  the appropriate reviewer scope) is supported by the same workflow — the
  assignment layer refuses any reviewer without the exact domain scope.
- Human review does not grant BEAN government accreditation or professional
  licensing authority; a reviewer approval is an internal quality gate, not a
  certification.
