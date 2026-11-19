# PHASE 7 — EMPLOYER & OPPORTUNITY EXCHANGE

Status: delivered on `feat/bean-institution-career-phase-7`. Companion to `docs/PHASE7_PRIVACY_AND_SAFEGUARDING.md` (adult-eligibility and data-sharing rules).

## 1. Employer organizations

Employers reuse the same `Organization` + `OrganizationMembership` architecture (`orgType: EMPLOYER`). Employer roles: `OWNER | ADMIN | RECRUITER | CAREER_COORDINATOR`. **Server-enforced** requirements:

- Only an `APPROVED` + active employer organization can create opportunities or search candidates (`isApprovedEmployerOrg` — route-tested; a `PENDING_REVIEW` employer gets 403).
- Every employer action is scoped to the caller's own organization — employer A cannot edit or even read employer B's listings or applicants (route-tested 403/404).
- Employer organizations cannot issue educational credentials (explicit refusal).

## 2. Opportunities

`CareerOpportunity` — types `JOB | INTERNSHIP | APPRENTICESHIP | PROJECT`; description + responsibilities (bounded plain text), required/preferred skills, location, work mode, optional informational `compensationDescription`, `applicationDeadline` (must be future at create/edit), `eligibilityDescription`.

Lifecycle: `DRAFT → PENDING_REVIEW → PUBLISHED | REJECTED`; `PUBLISHED → PAUSED | CLOSED`. Rules (all audited in `CareerAuditEvent`):

- Employers create drafts and **submit for review**; they can `PAUSE`/`CLOSE` published listings and resubmit rejected ones — they can **never** set `PUBLISHED` or `REJECTED` (schema-refused; moderation is admin-only).
- Admin moderation (`POST /api/admin/career/opportunities/:id/moderation`): approve publication, reject with a **required written reason** (10+ chars), pause unsafe listings with reason, close, resume. Every decision records the admin identity.
- Public browse/detail expose `PUBLISHED` listings only; unpublished rows 404 without an existence oracle; every listing truthfully identifies its organization and its BEAN verification badge.
- Closed/expired listings reject new applications at submit time (route-tested).
- **No application fees, no paid employer subscriptions** — Phase 7 contains no payment code of any kind (enforced by the free-pilot protection tests).

## 3. Applications

`CareerApplication` — unique pair `(opportunityId, studentId)` (database-level duplicate prevention; the route additionally mirrors the real `P2002` error in tests).

### Candidate-controlled data sharing

Before applying, the student assembles the snapshot **explicitly**: choose headline, summary, individual skills, individual shared projects, individual shared credentials, an optional note — each a separate selection. Contact email enters the snapshot **only** with the separate explicit consent checkbox (off by default). The snapshot:

- is validated server-side against a whitelist of keys and an 8 KB bound (rejects oversized or foreign-key payloads);
- is **frozen at submission time** — later profile edits never silently rewrite it (documents in `docs/PHASE7_CAREER_PORTFOLIO.md`);
- is what the employer sees — nothing else from the account is included (no Riishe data, no learning history, no account ids).

Statuses: `SUBMITTED → UNDER_REVIEW → SHORTLISTED → INTERVIEW → SELECTED | REJECTED`, plus `WITHDRAWN` (student-only). Employers progress their own opportunities' applicants; a final decision (`SELECTED`/`REJECTED`) is terminal; `WITHDRAWN` applications are frozen for employers. Employers attach a `candidateVisibleStatusNote` (reaches the applicant) and private `employerNotes` (never leaves the employer DTO — mapper-level separation). Status changes are visible to the applicant with the note; employers' private notes are structurally absent from student DTOs.

Applicants can withdraw at any point before a final decision; employers cannot withdraw on the candidate's behalf (route-tested 404 for foreign applications).

## 4. Candidate discovery

`GET /api/career/employer/candidates` — available only to employer-role members of an APPROVED employer organization. Server-enforced safeguards:

- Results include only `DISCOVERABLE` profiles of students whose `CareerEligibilityReview` is `APPROVED` — **no default discovery**; a student can pause discovery instantly and subsequent searches respect it (tested).
- The DTO exposes only candidate-approved fields: headline, summary preview (240 chars), selected skills/projects/credentials (shared ones only), preferred role types/locations/work modes. **Never** account ids, emails, phone numbers or private learning data; `candidateRef` is an opaque token, not a Student id (tested).
- Pagination (≤ 20/page), bounded search terms, rate-limited (40 searches/day per recruiter, 429 with an honest message).
- Every search is audited (`CANDIDATE_SEARCH`) **without** the query string — no search text is ever logged with personal data.
- No AI ranking, automated rejection or suitability scoring — a plain filtered list, newest first.

## 5. Safety reporting

`POST /api/career/reports` — private reports against listings or organizations (fraudulent listing, misleading description, organization conduct, harassment, discrimination, safeguarding, other). Rate-limited (5/day). Reports **never** auto-suspend anything: the admin career view handles investigation (`ACKNOWLEDGE/INVESTIGATE/RESOLVE/DISMISS` with required written notes) and an explicit, reasoned `PAUSE_OPPORTUNITY` action where justified — every action recorded in `CareerAuditEvent`; report details and resolution notes stay admin-private.
