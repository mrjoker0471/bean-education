# PHASE 7 — INSTITUTION WORKSPACE

Status: delivered on `feat/bean-institution-career-phase-7` (base `main` @ `f162ff4`, Phase 6 PR #5 merged).
Design of record: `docs/PHASE7_DESIGN.md`. This document covers the institution domain end to end.

## 1. Organizations

A `Student` account may belong to **multiple** organizations; powers are always organization-scoped — a membership **never** changes `Student.role` (`STUDENT | PYQ_CURATOR | ADMIN` unchanged; no API can raise it).

Organization types: `SCHOOL | COLLEGE | UNIVERSITY | COACHING_CENTRE | PROFESSIONAL_INSTITUTE | SKILL_PROVIDER | EMPLOYER | OTHER`.
Profile fields: official name, display name, type, description, website, public contact, country/state/city, unique slug, optional short logo mark, verification state, timestamps. **No company registration number and no government identity documents are collected.**

### Verification states

`DRAFT → PENDING_REVIEW → APPROVED | REJECTED`; `APPROVED → SUSPENDED`; `REJECTED → PENDING_REVIEW` (reapplication). The state machine is a **pure function** (`isLegalVerificationTransition`, unit-tested): no transition can be skipped, and only admins can move states.

- Submission for review is the owner's action; **approval is a deliberate human admin decision** recorded with the admin's identity in `OrganizationAuditEvent`.
- Email-domain matching is never treated as proof of organizational identity.
- Truthful labelling: the UI shows **"Identity reviewed by BEAN"** for APPROVED orgs and explicit pending/declined/suspended labels otherwise. BEAN verification means identity review — it never claims government recognition, accreditation, affiliation or academic quality (enforced in UI copy and DTO labels).
- Never show an unverified organization as verified (badge classes are derived from server status only).

## 2. Memberships

`OrganizationMembership` — one row per (organization, student) **unique pair**; history is preserved by status (`INVITED | ACTIVE | SUSPENDED | LEFT`) rather than deletion. Scoped roles: `OWNER | ADMIN | INSTRUCTOR | STAFF | LEARNER | CAREER_COORDINATOR | RECRUITER`.

Authorization rules (all server-enforced, unit-tested):

| Rule | Enforcement |
|---|---|
| Org functions require an ACTIVE membership | `requireActiveMembership` guard on every route |
| Elevated actions require the right scoped role | `requireOrgRole(studentId, orgId, roles)` — OWNER/ADMIN for management, OWNER/ADMIN/INSTRUCTOR for teaching |
| Only an OWNER manages another OWNER | `evaluateMemberAction` pure rule |
| The last active OWNER cannot be removed/suspended/demoted | pure rule + member action route |
| The client can never assign itself a role | role changes flow only through `POST /organizations/:id/members/:memberId` after the admin guard |
| OWNER role is never granted by role edits | `SET_ROLE` on an OWNER is refused |

A person may simultaneously be an institution learner, an approved BEAN teacher and an administrator of another organization — each context authorizes independently.

## 3. Invitations

`OrganizationInvitation` with intended scoped role, **SHA-256 token hash only**, creator membership, expiry, optional max uses, acceptance and revocation timestamps.

- Tokens are 32 random bytes (base64url) generated server-side; the raw token appears **exactly once** in the create response for the copy-link workflow and is never stored or logged (unit-tested: the hash never round-trips, hashing is deterministic, different tokens never collide).
- Invitations can never grant `OWNER` or `ADMIN` (`isInvitableRole` pure rule; OWNER/ADMIN come only from existing-administrator actions).
- Enforcement at redemption: token validity (revocation/expiry/max-uses via `isInvitationRedeemable`), organization APPROVED + active, email restriction (when set), no duplicate active membership (unique pair + status checks). Rate-limited per organization (creation) and per student (acceptance).
- **No email service exists and none is pretended** — the UI says clearly that the administrator copies and distributes the link independently. There are no public, guessable joining codes.
- Acceptance policy: `LEARNER` activates immediately; elevated roles (`INSTRUCTOR/STAFF/CAREER_COORDINATOR/RECRUITER`) start `INVITED` until an existing administrator approves them (`APPROVE_OWNER` action, audited).

## 4. Groups, batches and cohorts

`OrganizationGroup` (academic year, programme, batch, section, track, dates, capacity, status) + `OrganizationGroupMembership` (unique pair per group/member, `ACTIVE | LEFT`).

- Duplicate active enrollment is impossible at the database level (unique constraint; the route also treats re-enrollment of a LEFT row as a re-join).
- Leaving (or being removed) flips `enrollmentState` to `LEFT` — **rows are never deleted**, so assignment and attendance history survives a member leaving the organization or account anonymization.

## 5. Private institution classes

Institution classes reuse the existing BEAN Teach + Live Classroom stack (no separate video system). `ClassSession` gained three nullable columns — `audience` (`PUBLIC | ORGANIZATION | GROUP`, default `PUBLIC`), `organizationId`, `organizationGroupId` — additive only, with a SQLite table-rebuild migration that copies every existing row (verified in the migration SQL).

- **Public discovery filters `audience: 'PUBLIC'`** — organization and group classes never appear in `GET /api/teach/classes` (route-tested).
- Class detail 404s for ineligible callers (strangers, guests, suspended members) while seat-holders and eligible members keep access — matching the established hidden-from-public convention (route-tested).
- Booking re-checks eligibility **inside the seat-claim transaction** (a mid-flight suspension cannot race a seat claim): `ORGANIZATION` needs an ACTIVE membership; `GROUP` additionally needs an ACTIVE enrollment in the owning group (`evaluatePrivateClassAccess`, pure, unit-tested).
- **Live tokens re-check eligibility on every request** in `live/token` (a membership suspended after booking never yields a new entry; existing booking rows are untouched) — `live/start` stays owner-only as before.
- Creation requires an ACTIVE `OWNER/ADMIN/INSTRUCTOR` membership in an APPROVED organization **and** every pre-existing teacher guard (approved `TeacherProfile`, Phase 6 trust restrictions, capacity/duration rules). An institution invitation never bypasses teacher verification or trust actions.
- Suspended/left membership blocks **new** private-class access; historical bookings, attendance evidence and submissions are always retained.
- Preserved unchanged: `ClassBooking` uniqueness, conditional seat-claim SQL, cancellation behavior, LiveKit monthly usage protection, webhook attendance evidence, teacher moderation, trust actions, emergency classroom stop — all 349 pre-Phase-7 tests remain green.

## 6. Institution dashboard & workspace UI

`#/institution` (hub: organization cards with truthful badges, registration dialog, invitation redemption) and `#/institution/:orgId[/:section]` (Overview with in-app announcements, Members, Groups & batches, Classes with audience badges, Assignments, Resources, Reports). Sections render only from authorized organization-scoped endpoints; the header gains Institution/Career entries for signed-in students only, with server authorization remaining authoritative.

### Analytics and privacy

Institutions may access: their own roster, their own group membership, assignments they administer, submissions they are authorized to assess, attendance for their own institution classes, and aggregate group-level metrics from institution-owned activity. Institutions must **not** (and cannot, server-side) access: Riishe conversations/prompts/uploads, `StudyDocument` contents, personal notes, `StudyGoal`s, test answers, unrelated exam attempts, other institutions' records, or private complaints. Joining a group never exposes personal progress.
