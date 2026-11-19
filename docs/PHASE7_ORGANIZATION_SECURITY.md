# PHASE 7 — ORGANIZATION SECURITY

Status: delivered on `feat/bean-institution-career-phase-7`. Companion to `docs/PHASE7_INSTITUTIONS.md`; this document is the security contract for the institution domain.

## 1. Identity and authorization

- Every request authorizes from the **server session** (httpOnly `bean_session` cookie). Client-supplied ids, roles, verification states and organization ownership are never trusted.
- Guards (all unit-tested or route-tested):
  - `requireStudent()` — authentication (401 otherwise).
  - `requireActiveMembership(studentId, organizationId)` — ACTIVE membership (403 otherwise, including INVITED/SUSPENDED/LEFT).
  - `requireOrgRole(...allowedRoles)` / `requireOrgAdmin` / `requireOrgInstructor` — scoped role checks.
  - `requireAdmin()` — BEAN-administrator only for verification decisions.
- Scoping is absolute: organization A's administrators cannot manage organization B (lookups re-verify `organizationId` on every nested resource; a foreign member id is a 404, never leaked).

## 2. State machines and rules (pure, tested)

| Rule | Function |
|---|---|
| Verification transitions are legal-only | `isLegalVerificationTransition` |
| Only APPROVED + active orgs run functions | `isOperationalOrg` |
| Only approved EMPLOYER orgs run employer functions | `isApprovedEmployerOrg` |
| Last-owner protection; owner-managed-by-owner; no role-edit ownership transfer | `evaluateMemberAction` |
| Invitation redeemability (expiry/revocation/max-uses) | `isInvitationRedeemable` |
| OWNER/ADMIN never invitable | `isInvitableRole` |
| Private-class eligibility | `evaluatePrivateClassAccess` |

## 3. Invitation security

- 32-byte CSPRNG token (`randomBytes`), stored **only** as SHA-256 hex; raw token returned once at creation, never persisted or logged (no email service exists — the copy-link flow is honest about this).
- Token lookup is by hash — an unknown token returns the same generic 404 as an invalid one (no oracle distinguishing "expired" from "never existed" in the response body beyond the documented copy).
- Email-restricted invitations compare case-insensitively against the session account; a mismatch is 403.
- Rate limits (24h rolling row counts, no external limiter): 30 invitations/day/organization, 10 acceptances/day/student, 3 organizations/day/student, 10 groups/day/org, 20 assignments/day/org, 30 submission edits/day/student.

## 4. Transaction boundaries

State changes and their audit rows succeed or fail together (`db.$transaction`):

- Organization registration → org + pending-OWNER membership + `ORGANIZATION_REGISTERED` audit.
- Verification decision → status update + `VERIFICATION_*` audit (admin identity recorded).
- Member actions → membership update + `MEMBER_*` audit.
- Invitation create/redeem → invitation row (hash only) + `INVITATION_*` audit.
- Group enrollment/leave → enrollment update + `GROUP_*` audit.

`OrganizationAuditEvent` is append-only (never updated or deleted; FK restricts org deletion). Detail strings contain role/subject metadata only — no student private data, no invitation raw tokens.

## 5. Input hardening

- Zod v4 schemas (`institution-schema.ts` / `teach-schema.ts` extension) bound every field; the shared `plainText` helper rejects control characters (XSS/zero-width hardening); all content renders as React text (no HTML injection surface).
- Website/resource/application links must be valid **HTTPS** URLs (`isValidHttpUrl`).
- Same-origin check on every mutation; correct 401/403/404/409/429 vocabulary everywhere.
- List endpoints paginate/clamp (offset pagination with bounded page sizes); search strings are length-clamped before `contains` filters.

## 6. Trust separation

- Institutional verification is a **separate context** from teacher `TeacherProfile.verificationStatus` and Phase 6 `TrustAction` records — no model, route or UI reuses teacher trust state to represent employer/institution restrictions (and vice versa).
- Phase 6 teacher trust enforcement keeps working for institution classes (they are `ClassSession` rows): creation/publishing respect `SUSPEND_PUBLISHING`, discovery respects `PAUSE_LISTINGS`, live start/token respect `EMERGENCY_STOP`.
- No report or complaint ever automatically suspends an organization — every restriction is a recorded human decision.

## 7. Data protection

- Member rosters expose display names only — no emails, no account ids, no private student data (DTO-mapped; route-tested).
- `verificationNote` (admin-private) never appears in any organization DTO; `rejectionReason` is visible to the organization's own admins after a decision.
- Audit detail strings carry metadata only (e.g. `role=INSTRUCTOR`, `groupId=…`) — never student descriptions, never sensitive evidence.
- Account deletion/anonymization: memberships cascade (the roster shrinks) while organization audit history, assignments and attendance evidence persist (rows reference ids, not cascades); historical records are never destroyed because a member left.
