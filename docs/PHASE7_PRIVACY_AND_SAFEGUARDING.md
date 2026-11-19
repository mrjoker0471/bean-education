# PHASE 7 — PRIVACY & SAFEGUARDING

Status: delivered on `feat/bean-institution-career-phase-7`. This document states what Phase 7 collects, who can see it, and the adult-eligibility safeguard that keeps school-age learners out of employer reach.

## 1. Adult-eligibility safeguard (the core rule)

BEAN serves school-age students as well as adults. Career learning and **private** portfolio preparation are available to everyone; **employer discovery, candidate contact and job applications require an approved adult-eligibility review**.

- `CareerEligibilityReview` per student: `NOT_ELIGIBLE` (default) → `PENDING_REVIEW` (student requests) → `APPROVED | DENIED` (admin decision with required written reason for denials). Every transition audited (`CareerAuditEvent`).
- **Server-enforced, not a hidden UI button**: the apply route and the discovery route both re-check the review state per request (route-tested — a pending review still gets 403). The client cannot forge the state: it lives only server-side, changes only through the admin decision route.
- No self-declaration-only path: the request merely queues a review; a human BEAN administrator decides.
- **No government identity documents or numbers are collected, requested or stored anywhere in Phase 7.** The review is a deliberate, documented human process; no raw identity evidence exists in the database.
- Age is never inferred from education level; school-age learners are excluded from employer visibility by the eligibility gate itself (they can never be `APPROVED` without review).
- No targeted advertising or behavioral tracking exists for anyone, children included.

If reliable verification is unavailable for an account, discovery and applications stay **disabled** for it — private career planning and portfolio preparation remain fully available (this is the product's explicit fallback posture).

## 2. Current law and policy review (honest status)

Before activating career discovery, the implementation was checked against the **Digital Personal Data Protection Act, 2023** and the DPDP Rules through official **MeitY** sources, with attention to the Rules' phased commencement schedule and child-data obligations (verifiable parental consent for processing children's data, no tracking/behavioral monitoring/targeted advertising directed at children).

Honest statements for professional review — BEAN makes **no claim of legal compliance** merely because consent checkboxes exist. Flagged for professional/legal review before any real discovery activation:

- The exact operational requirements for verifiable parental consent under the phased commencement, and whether BEAN's age-eligibility review satisfies them in every launch scenario.
- The classification of institution-issued credentials as processing of children's data where the learner is a minor, and the corresponding consent path.
- Data-retention limits for application snapshots and safety reports under the Act's purpose-limitation and erasure provisions.

This document deliberately records unresolved questions rather than inventing legal conclusions.

## 3. Data inventory (Phase 7)

| Data | Purpose | Who receives it | Retention | Deletion/export |
|---|---|---|---|---|
| Organization profile (public fields) | institution identity & workspace | BEAN admins; members; public-ish (verified identity labels) | until soft-archival | soft archival; no hard delete while history exists |
| Memberships & roles | authorization | org staff (display names only) | lifetime of the org (history preserved) | account deletion removes membership rows; audit history kept |
| Invitation hashes | secure joining | org staff (raw token once) | until expiry/revocation | revocable; raw token never stored |
| Assignments & submissions | teaching/assessment | author student + permitted staff | org lifetime | account deletion cascades own submissions; assignment/audit rows persist |
| Career profile & skills | private portfolio, optional discovery | the student; (if DISCOVERABLE+APPROVED) verified employers, approved fields only | student-controlled | account deletion cascades |
| Projects | portfolio | student; shared ones in discovery | student-controlled | student deletes |
| Credentials | truthful achievements | student; issuer org; shared ones in discovery | org/student lifetime; revocation audited | revocation, not erasure, is the correction path |
| Application snapshots | applying to one opportunity | that one employer | opportunity lifetime | withdrawal stops progression; account deletion cascades |
| Eligibility reviews | safeguarding gate | student (status) + admins | account lifetime | deletion cascades |
| Safety reports | fraud/conduct investigation | admins only | investigation lifetime | admin-resolved; notes admin-private |

Consent withdrawal: pausing visibility (`PAUSED`) removes future discovery immediately; sharing toggles per project/credential are honored on the next read. Deletion and export follow the existing account deletion design; revoked consent never affects data already shared under the earlier consent (snapshots), while all future visibility stops.

## 4. Never-shared data (institutions and employers)

Private Riishe conversations/prompts, private uploads, `StudyDocument` contents, personal notes, `StudyGoal`s, student passwords/auth data, private complaints, classroom recordings (none exist), personal examination answers. Institutions see only institution-owned aggregates; employers see only snapshots the student explicitly assembled and (with consent) contact details. No institution or employer membership is a gateway into a student's BEAN account.

## 5. No private employer-to-minor contact

- Minors (non-APPROVED eligibility) are unreachable by employers: absent from discovery, unable to apply.
- No private direct messaging exists anywhere in Phase 7 (employer↔candidate contact is limited to application status notes and explicit contact consent at submission).
- No teacher-to-minor private messaging was introduced by the institution features (announcements are in-app and audience-scoped only).

## 6. Free pilot honesty

Phase 7 collects no money, charges no application fees, and grants no paid employer advantages; `compensationDescription` is informational text that cannot trigger any payment processing. This is enforced by tests (no payment models, packages, routes, env vars, or refund code exist — see `docs/PHASE7_RESULTS.md`).
