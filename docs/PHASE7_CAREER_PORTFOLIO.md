# PHASE 7 — CAREER PORTFOLIO

Status: delivered on `feat/bean-institution-career-phase-7`. Companion to `docs/PHASE7_PRIVACY_AND_SAFEGUARDING.md`.

## 1. Career profile

`CareerProfile` — one per student (`studentId` unique), **created PRIVATE by default** (lazy creation on first read; explicit create endpoint returns the existing row idempotently). Fields: headline, summary, preferred role types / skills / locations / work modes (bounded JSON string arrays), optional public slug (unique).

### Visibility states

- `PRIVATE` (default) — nothing is exposed to anyone.
- `DISCOVERABLE` — the student's explicit choice to appear in employer candidate discovery.
- `PAUSED` — hidden from discovery **immediately and reversibly**, keeping the underlying choice.

Two server-enforced gates always apply before anything is discoverable or applicable: the student's visibility choice **AND** an `APPROVED` `CareerEligibilityReview` (adult-eligibility safeguard — see the privacy/safeguarding document). Both are pure, tested rules (`isDiscoverable`, `canApply`); profile edits never silently rewrite already-submitted application snapshots.

## 2. Skills — truthful labels

`StudentCareerSkill` — student-owned, ordered (`position`), ≤ 50 per student. Labels:

- `SELF_DECLARED` — the only label a student can produce; every self-service route **server-forces** this value (the Zod schema accepts only this literal, and the route overrides regardless).
- `INSTITUTION_ISSUED` — produced only by real credential issuance from a verified institution; never by self-service.
- `BEAN_ASSESSMENT_VERIFIED` — cannot be produced anywhere in Phase 7: there is no documented, tested BEAN assessment process yet, so no route can grant this label. No unverifiable numeric career scores exist.

The UI renders the label from server data (`Self-declared` / `Issued by institution` / `Verified by BEAN assessment`) — a self-declared skill is never shown as verified (route/E2E verified).

## 3. Projects

`CareerProject` — student-owned, `PRIVATE` by default, per-project `SHARED` toggle; categories (`ACADEMIC | PERSONAL | PRACTICAL | INTERNSHIP | RESEARCH | SKILL_DEMO`); HTTPS-validated external links; skills used; start/end dates. Private drafts never appear in any shared DTO; untrusted external HTML is never embedded (links only). Ownership is enforced by (id, studentId) lookups — other students' rows are unreachable (404).

## 4. Institution-issued credentials

`CareerCredential` — issued only by an **authorized membership** (`OWNER/ADMIN/INSTRUCTOR`) of an **APPROVED, non-EMPLOYER** organization, with the issuer identity (`issuedByMembershipId`) recorded; `ISSUED | REVOKED` status; optional expiry and reference; issuance and revocation audited on both the organization (`OrganizationAuditEvent`) and career (`CareerAuditEvent`) trails.

Distinctions (never conflated): student-claimed claims are plain portfolio content; institution-issued credentials carry the verified issuer's identity; a `REVOKED` credential never displays as an active verified achievement (UI disables sharing and renders `revoked` truthfully).

**Student control:** the student toggles `portfolioShared` per credential (owner-only PATCH); default is private. The issuer cannot force a credential into the student's shared portfolio.

## 5. Student-facing surfaces

- `#/career` — hub (portfolio tiles + employer entry only for members of approved employer organizations).
- `#/career/profile` — editor + truthful visibility/eligibility states (the UI states plainly that discovery stays off until the server-side review approves; requesting a review is one click).
- `#/career/portfolio` — skills, projects, credentials sections with honest labels and share toggles.
- `#/career/applications` — tracker with employer-visible status notes, withdrawal, private report entry point.

## 6. What the career domain never touches

Riishe conversations, private uploads, personal notes, `StudyGoal`s, exam attempts, passwords/auth data, private complaints, classroom recordings (none exist), personal examination answers. No AI training from portfolio data; no automatic AI candidate scoring or ranking anywhere in Phase 7.
