# CI-5 REVIEWER GOVERNANCE — Expert Reviewer Identity & Qualification

> Unit: CI-5B · Status: implemented and tested with synthetic fixtures
> (`tests/unit/ci5-reviewer-governance.test.ts`). No real reviewer
> qualifications are recorded in this deployment; every profile in tests is a
> clearly-labelled fixture.

## 1. What a reviewer is (and is not)

- A **reviewer** is the holder of an `ExpertReviewerProfile`: a separate,
  admin-approved governance record — NOT a role on the Student account, NOT a
  teacher status, NOT institution membership, NOT audience selection.
- A **BEAN administrator** is necessary to manage reviewers, but a general
  administrator is *never* automatically a qualified subject expert. Admin
  review privileges exist only through an `ACTIVE` reviewer profile with
  explicit server-controlled scopes.
- Reviewer identity is **server-resolved** from the session at every route. No
  client payload can supply a reviewer id, display name, qualification,
  verification result, scope or status — the strict application schema refuses
  unknown fields outright, and scope columns are written only by the admin
  action route.

## 2. Categories and scope semantics

| Category | Scope carried | Matcher (`reviewerCanReview…`) |
|---|---|---|
| `DOMAIN_EXPERT` | `approvedDomains: domainId[]` — must be registered pack domains | `reviewerCanReviewDomain(profile, domainId)` — true only for exact domainIds in scope |
| `BILINGUAL_LANGUAGE` | `approvedLanguages: [{ tag, tasks[], domains?[] }]` — tags must be in the 11-language catalogue | `reviewerCanReviewLanguage(profile, tag, task, domain?)` — exact tag + task; when `domains` is set the reviewer may only review those domain-language capabilities |

Structural rules enforced at scope-write time (`validateReviewerScope`):

- A `DOMAIN_EXPERT` cannot carry language scopes and vice versa (no mixed scope).
- Unknown domainIds and unknown language tags are refused.
- **TRANSCRIPTION can never enter a reviewer scope** — refused with the §9.2
  reason at every write path (qualification approval, scope update), and the
  pure matcher returns false for TRANSCRIPTION unconditionally.
- Scope examples that match CI-5 charter intent: a Mathematics reviewer cannot
  approve Engineering; a Hindi reviewer cannot approve Tamil; a general Tamil
  translation reviewer cannot approve Tamil *medical* terminology unless a
  domain-language scope records it.

## 3. Qualification model (minimal, honest)

Collected: qualification category (free text, e.g. "PhD Mathematics"), stated
professional experience, issuing institution/professional body (where
applicable), a **minimal verification result** and an explicit conflict-of-
interest declaration.

NOT collected (by design): government identity numbers, copies of identity or
credential documents, personal secrets, any data beyond what a review decision
needs. `verificationStatus` records the result, not the artefact:

| Verification result | Meaning |
|---|---|
| `UNVERIFIED` | nothing verified — an APPROVED decision can never carry this |
| `DOCUMENT_REVIEWED` | an authorised administrator reviewed the qualification evidence; the original is never stored |
| `REFERENCED_VERIFIED` | qualification verified against an external register/issuer reference |

## 4. Lifecycle and strict transitions

`REVIEWER_TRANSITIONS` (enforced in code — anything not listed is refused 409):

```
APPLICATION_PENDING → QUALIFICATION_REVIEW | REJECTED
QUALIFICATION_REVIEW → APPROVED | REJECTED
APPROVED             → ACTIVE | SUSPENDED | REVOKED | EXPIRED
ACTIVE               → SUSPENDED | REVOKED | EXPIRED
SUSPENDED            → ACTIVE (reinstate) | REVOKED | EXPIRED
EXPIRED              → QUALIFICATION_REVIEW (renewal re-review) | REVOKED
REVOKED, REJECTED    → terminal (history preserved)
```

- **APPROVED** requires: an authorised scope (validated for the category), a
  verification result ≠ UNVERIFIED, and stated qualifications (category on the
  profile or a verification note). The reviewer-proposed scope is advisory
  payload only — the admin decision payload is what becomes authoritative.
- **ACTIVE** = eligible for assignment rotation (`isReviewerAssignableStatus`).
  APPROVED-but-not-ACTIVE profiles cannot take expert work.
- **EXPIRED** is applied *lazily on read* (`resolveReviewerProfile`,
  `listReviewerProfiles`) when `expiresAt` passes — deterministic, idempotent,
  attributed to the SYSTEM actor with an audit event. A lapsed qualification
  can never silently stay eligible.
- **Self-review is impossible**: every admin action refuses when the acting
  admin's server-resolved `studentId` equals the profile's `studentId`
  ("a reviewer can never act on their own qualification").
- **Suspension/revocation** require reasons (≥10 / ≥20 chars) stored on the
  profile and in the event; REVOKED is terminal and the full event history
  (including the earlier APPROVED) is preserved — revocation never erases.
- One profile per BEAN account (unique constraint); REJECTED/REVOKED decisions
  stand — re-application is refused honestly.

## 5. Append-only audit

Every transition writes an `ExpertReviewerEvent` (append-only):

`APPLICATION_SUBMITTED`, `COI_DECLARED`, `QUALIFICATION_REVIEW_STARTED`,
`APPROVED` (payload: approved scope + verification result + issuing body +
expiry), `ACTIVATED`, `SUSPENDED`, `REINSTATED`, `EXPIRED` (payload: previous
status), `REVOKED`, `REJECTED`, `SCOPE_UPDATED` (payload: previous + updated
scope). Events name `actorKind` (ADMIN/REVIEWER/SYSTEM) and the server-resolved
`actorId` — no unattributed status change is possible.

## 6. API surface (all server-authorised)

| Route | Who | Purpose |
|---|---|---|
| `POST /api/ci5/reviewers/apply` | signed-in account | submit an application (COI explicit; proposed scope advisory) |
| `GET /api/ci5/reviewers/me` | signed-in account | own profile + scope + events only |
| `GET /api/admin/ci5/reviewers` | requireAdmin | registry with status/category filters |
| `POST /api/admin/ci5/reviewers/[profileId]/action` | requireAdmin | `BEGIN_QUALIFICATION_REVIEW`, `DECIDE`, `ACTIVATE`, `SUSPEND`, `REINSTATE`, `REVOKE`, `UPDATE_SCOPE` |

Route guards exercised against the REAL `requireAdmin`: 401 unauthenticated,
403 non-admin, unknown action 400, forged actor impossible (identity from
session). No route exposes another reviewer's data; the registry view carries
reviewerCode + qualification facts + scope only.

## 7. Schema

Additive migration `20261125120000_ci5_expert_reviewers`:

- `ExpertReviewerProfile` — unique `studentId`, unique non-personal
  `reviewerCode`, category/status/scope columns (JSON strings), verification
  facts, `expiresAt`, explicit `conflictOfInterest`, suspension/revocation
  reasons. No FK to Student on purpose: the audit trail survives account
  deletion (same discipline as `ClassroomPackReview`).
- `ExpertReviewerEvent` — append-only history, indexed by profile + time and
  event type.

## 8. Tested behaviour (22 tests, isolated real DB)

Golden lifecycle; self-review refusal; UNVERIFIED approval refusal; scope-less
approval refusal; strict transition table (skip-ahead refused); unknown
domains/tags; TRANSCRIPTION scope refusal at every write path; category
mismatch; Mathematics≠Engineering and Hindi≠Tamil matchers; domain-language
restriction (Tamil TERMINOLOGY restricted to mathematics-statistics);
suspension/reinstatement reasons; terminal REVOKED with preserved history;
lazy EXPIRED with SYSTEM attribution + renewal path; route-level 401/403/
golden/forged-field refusals; owner-only `me` route; registry filters;
advisory-only proposed scope (authoritative columns stay empty until an admin
decides).

## 9. Honest limits

- No real reviewer exists in this deployment; no qualification has been
  verified; no profile carries real credentials. The registry starts empty on
  production data.
- Qualification verification is a recorded minimal result — BEAN does not
  authenticate identity documents; review scope is only as good as the admin
  verification behind it, which is why scope changes are audited and expiry is
  mandatory-to-honour.
- Reviewer eligibility never flows from agent output or model-generated tool
  calls (no code path connects agents to reviewer administration).
