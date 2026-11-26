# BEAN Classroom Intelligence — CI-6A: Architecture Audit and Activation Design

> Status: CI-6A complete. Branch `feat/bean-classroom-intelligence-ci6` opened from
> **verified `origin/main` = `643d56889c33d8036d3455f6f045efbbf749e28d`** (the PR #48 merge
> that recorded CI-5 COMPLETE/SYNCHRONIZED in the authoritative ledger). Every claim below
> was verified by reading the source at that SHA; nothing is inferred from memory or docs alone.

CI-6 is an activation layer on top of CI-5, not a second system. Rule 7 of the charter
(no second qualification authority) is enforced by design: every CI-6 unit extends the
**existing** CI-5 models, transition tables, append-only event ledgers and route guards.
No pre-existing file is rewritten; CI-5 behaviour is widened additively only.

---

## 1. What CI-5 already provides (verified, at 643d568)

### 1.1 Reviewer identity, qualification and scope (`src/lib/ci/fleet/reviewers.ts`)
- `ExpertReviewerProfile` (migration `20261125120000_ci5_expert_reviewers`): one profile per
  account (`studentId @unique`, deliberately FK-less so the audit trail survives account
  deletion), `reviewerCode` (`BR-` + 10 hex), `category` (`DOMAIN_EXPERT | BILINGUAL_LANGUAGE`),
  status lifecycle `APPLICATION_PENDING → QUALIFICATION_REVIEW → APPROVED → ACTIVE`, plus
  `SUSPENDED | EXPIRED | REVOKED | REJECTED` with a strict `REVIEWER_TRANSITIONS` table and
  terminal states that refuse. `verificationStatus` vocabulary
  (`UNVERIFIED | DOCUMENT_REVIEWED | REFERENCED_VERIFIED`), `issuingBody`, `verificationNote`,
  `qualificationCategory`, `professionalExperience`, `expiresAt` + lazy SYSTEM-attributed
  expiry, and a **mandatory explicit `conflictOfInterest` declaration**.
- Server-controlled scope columns (`approvedDomains` / `approvedLanguages` JSON) written only
  through `decideReviewerQualification` / `updateReviewerScope`; `validateReviewerScope`
  refuses unknown domains, unknown catalogue tags and — structurally — any
  `TRANSCRIPTION` task ("§9.2"). `reviewerCanReviewDomain` / `reviewerCanReviewLanguage`
  are the only scope matchers; `qualifyingApproverIdsForDomain/Language` compute the
  server-side qualified-approver sets consumed by the CI-4C pack authority.
- Append-only `ExpertReviewerEvent` ledger (11 event types, `ADMIN | REVIEWER | SYSTEM`
  attribution) records every lifecycle action with rationale/payload.
- `selfReviewGuard` makes it impossible for an account to act on its own reviewer profile.

### 1.2 Assignments, cases, COI, recusal, reassignment (`src/lib/ci/fleet/assignments.ts`)
- `ExpertReviewAssignment` + `ExpertReviewAssignmentEvent` (migration `20261125130000`).
  `createAssignment` is the only entry point: reviewer must be ACTIVE, `coiCheck:
  CONFLICT_FOUND` refuses outright, exact scope match per subject kind
  (`DOMAIN_PACK` / `LANGUAGE_CAPABILITY` / `CLASSROOM_REPORT`), one open assignment per
  subject per reviewer, never re-assign a reviewer who already completed the same
  `subjectChecksum`. Lifecycle `ASSIGNED → IN_PROGRESS → SUBMITTED → COMPLETED` with
  `RECUSED | EXPIRED (lazy) | REASSIGNED | CANCELLED`; `outcomeRef` links decisions to the
  authoritative ledgers. `detectReviewDisagreement` preserves both opinions (never averaged).

### 1.3 Domain-pack approval authority (`src/lib/ci/fleet/curator.ts`, CI-4C + CI-5D)
- Append-only `ClassroomPackReview` bound to `packId + packVersion + packChecksum`.
  APPROVED requires server-computed `qualifiedApproverIds` (admins can record conservative
  work-states but can never substitute for an expert); `resolveCuratedStatus` promotes a
  pack to VERIFIED only on `approvalsRequired = riskClass === 'HIGH_STAKES' ? 2 : 1`
  **distinct** human approvals. The CI-5D A–F rubric (`domain-rubric.ts`) enforces
  decision-vs-rubric consistency and is stored inside the review evidence.

### 1.4 Language governance (`src/lib/ci/fleet/language-governance.ts`)
- Durable `LanguageBenchmarkMeasurement` → `LanguageCapabilityReview` (13-facet evidence
  checklist, ACTIVE reviewer, scope-checked) → `LanguageCapabilityStatus` with basis
  (`STRUCTURAL | DEFAULT_UNMEASURED | MEASUREMENT_ONLY | HUMAN_APPROVED | REVOKED`).
  Measurement alone caps at `LIMITED`; `VERIFIED` exists only through a qualified reviewer
  bound to the exact model/benchmark version; supersession and revocation are
  history-preserving; `TRANSCRIPTION` is structurally `UNSUPPORTED` at every layer.

### 1.5 Benchmarks, report audit, renewals (`expert-benchmarks.ts`, `report-audit.ts`, `re-review.ts`)
- `ExpertBenchmarkDataset` (immutable versions + checksums, `BLIND_HOLDOUT` labels sealed
  until scoring), `ExpertBenchmarkCaseLabel` (append-only per reviewer, multiple accepted
  alternatives + prohibited conclusions, disagreement preserved), `ExpertBenchmarkRun`
  (honest `ran=false`, metrics never fabricated, no self-certification — runs never mutate
  governance ledgers).
- `ClassroomReportAuditReview` with read-time privacy masking and checksum binding
  (corrections are new rows).
- `ExpertReviewRenewalDemand` (8 charter triggers, duplicate OPEN refused, reasoned
  resolution) and `buildAuditExport` (read-only export across all ten CI-5 ledgers).

### 1.6 Routes, guards and conventions (verified across all 26 CI-5 route files)
- `requireStudent()` (`@/lib/auth`, nullable) and `requireAdmin()` (`@/lib/teach`,
  `Guard<null>` — 401/403) are the only authorization primitives; admin is exclusively
  `Student.role === 'ADMIN'` (settable only by operator CLI `scripts/grant-role.ts`).
- Route skeleton everywhere: `dynamic = 'force-dynamic'`, `runtime = 'nodejs'`, JSON-body
  try/catch → 400, lib result objects `{ok:false,status,error}` forwarded verbatim,
  `await params` for Next 16 dynamic segments, `console.error` + 500 catch-all.
- **No CI-5 route applies rate limiting** — the shared `rateLimited(clientKey(req, scope),
  limit, window)` helper exists (`src/lib/rate-limit.ts`) and is used by auth routes; CI-6
  public-facing application/invitation/claim routes must use it.
- Upload precedent: `/api/materials` (filesystem under `db/uploads`, `0600`, magic-byte
  check, size caps, file-before-row, orphan sweep) — but it is **guest-scoped with no
  session auth**; CI-6 credential evidence needs a session-authenticated, reviewer-owned,
  admin-readable restricted store instead.

### 1.7 UI shell, workspaces and walkthrough infrastructure
- SPA at `/` with hash routes registered in exactly three places (`src/lib/store.ts` Route
  union, `parseHash`, `routeToHash`) plus a conditional render in `src/app/page.tsx`.
  Existing CI-5 surfaces: `#/admin/ci5-reviewers` (`AdminCi5GovernancePanel`) and
  `#/reviewer` (`Ci5ReviewerWorkspace`) in `src/components/bean/ci5-reviewer-governance.tsx`
  — real APIs only, refusal toasts, `min-h-[44px]` touch targets, `data-testid` hooks,
  source-guard tests assert the exact API strings and forbid mock-data identifiers.
- BEAN tokens (`src/app/globals.css`): obsidian `bg-page`, `bg-card`/`bg-elevated`,
  `border-border`, gold `--gold #C6A05E` (`text-gold`, `bg-gold/10`, `border-gold/30`),
  champagne, success/destructive, `font-display` Playfair. Shared `EmptyState`, badge maps,
  `SectionHeader`, `LegalConsentRow`.
- Walkthrough: `agent-browser` CLI + API-registered fixtures
  (`scripts/ci5-verify-walkthrough-seed.ts` pattern), screenshots to
  `docs/screenshots/<id>/`; CI-6 uses `docs/screenshots/ci6-verify/`.

### 1.8 Privacy, export, deletion, notifications
- Student deletion intentionally leaves every CI-5 ledger row in place (FK-less by design;
  proven by `tests/unit/ci5-reliability.test.ts` H6). Account export v2 covers learner
  content, not reviewer ledgers; the admin-side audit export covers those.
- **No email/notification infrastructure exists** (no smtp/nodemailer/resend/sendgrid).
  Per charter §7, CI-6E therefore uses secure administrator-controlled invitation links
  with raw tokens shown exactly once — no delivery success is ever claimed.
- No `.env` committed; `DATABASE_URL` environment-only; dev DBs under gitignored `db/`.

---

## 2. Gap analysis → CI-6 design (smallest additive changes)

| # | Charter requirement | CI-5 gap | CI-6 additive answer |
|---|---|---|---|
| B | Proper application experience (domains+specialties, experience, affiliation, evidence upload, COI, consent, review-before-submit, status, info requests, withdrawal) | `submitReviewerApplication` records category + advisory scope + COI only; no evidence, no consent artefact, no info requests, no withdrawal | Extend the **existing** profile pipeline: additive columns + `ExpertCredentialEvidence` + `ExpertApplicationInfoRequest` + `WITHDRAWN` state in the existing transition table + 5 new event types in the existing ledger. New `src/lib/ci/fleet/applications.ts` service owns the new flows; `reviewers.ts` transitions are widened (never replaced) |
| B | Protected evidence upload | Only precedent is the unauthenticated `/api/materials` | New session-authenticated route family `/api/ci5/reviewers/me/evidence*`: `requireStudent` + profile ownership + rate limit + magic-byte sniff (PDF/PNG/JPEG) + size cap + sha256 + `0600` files under `db/evidence/` (gitignored, never `/public`) + restricted admin streaming route |
| C | Independent verification workbench | `verificationStatus` + `decideReviewerQualification` exist but there is no per-credential verification record, evidence linkage, or info-request loop | `ExpertVerificationRecord` (append-only, one row per credential examination, explicit honest `verificationMethod` vocabulary, required reason, optional `expiresAt`), recorded through a new admin action in the **existing** `/api/admin/ci5/reviewers/[profileId]/action` route; self-approval guard reused; profile-level qualification still only via the existing CI-5 gates (distinction preserved) |
| D | Expert profiles + distinct states | No public profile surface; states implicit | Disclosure columns + consent (`profileVisibility PRIVATE|LISTED`, `disclosureConsentAt`), derived public directory route that assembles the five states **each from its own authoritative ledger** (application → profile status; credential-verified → verification records; reviewer-eligible → ACTIVE+scope; domain approval → `ClassroomPackReview`; language verified → `LanguageCapabilityStatus` bindings). No state is inferred from another; nothing private is exposed |
| E | Invitations | Nothing exists | `ExpertInvitation` (sha-256 token hash only, single-claim, expiry, revocation, scope request, creator + audit events), claim route binds the invitation to the signed-in account and **starts/links an application without granting any privilege**; ops guide documents the manual secure-link workflow (no email claimed) |
| F | Assignment/workspace completion | Queue/start/recuse/rubric/language/report flows exist | Add reviewer availability control (`availability AVAILABLE|PAUSED`, enforced server-side in `createAssignment` via the existing gate path) + eligibility/scope surfacing in the workspace; everything else reuses CI-5 as-is |
| G | Honest activation reporting | No aggregate reporting surface | `GET /api/admin/ci6/reporting` computing each count **from its own ledger** with explicit zero display (verified experts, completed reviews, labels, approved packs, measured languages) and fixture-only separation; admin reporting tab |
| H | Acceptance battery | CI-5 pattern exists | Full suite + lint + tsc + prisma + fresh-DB migrations + production build + negative-security tests + real-browser walkthrough with genuine screenshots + CI6-RESULTS.md + ledger |

## 3. Hard invariants carried through CI-6 (non-negotiable)

1. **Identity**: reviewer/application/verification state is always resolved server-side from
   the session (`requireStudent` / `requireAdmin`); no client-supplied identity, scope,
   qualification, `verified`, `approved` or `humanApproved` field is ever trusted (strict
   schemas refuse unknown fields — CI-5 convention).
2. **No self-dealing**: the existing `selfReviewGuard` blocks acting on one's own profile;
   verification actors must differ from the applicant; reviewers can never approve their own
   credentials or decisions.
3. **Verification ≠ qualification ≠ content approval**: an `ExpertVerificationRecord`
   verifies a credential; only `decideReviewerQualification`/`activateReviewer` (existing
   CI-5 admin path) grants reviewer status; only `recordPackReview` with
   `qualifiedApproverIds` approves content; only `recordLanguageCapabilityReview` grants
   language VERIFIED. CI-6 adds no parallel authority to any of these.
4. **Honesty**: production packs stay `IN_REVIEW`, languages stay `LIMITED`/unmeasured,
   `TRANSCRIPTION` stays structurally `UNSUPPORTED`, benchmark metrics stay unpublished until
   real eligible labels exist, and the verified-expert count is **0** until a real verified
   human record exists. Fixtures are clearly labelled and never counted as real approvals.
5. **Evidence hygiene**: credential files live only in the restricted evidence store
   (`0600`, no public URLs, never served by ordinary profile endpoints, excluded from
   learner export), referenced by id + sha256 in the ledgers; document possession is never
   treated as authenticity; no third-party verification is fabricated; logs never contain
   file bytes or raw invitation tokens.
6. **Data safety**: every migration is additive (`CREATE TABLE` / `ADD COLUMN`), applied to
   an isolated disposable database, never `--accept-data-loss`, never touching existing
   rows; FK-less audit discipline is preserved (CI-5 ledgers survive account deletion).

## 4. Implementation checklist (unit → deliverables → verification)

- **CI-6A (this document)**: architecture map + checklist + ledger entry opened
  (`bean-classroom-intelligence-ci6`, baseMainSha `643d568`). ✔
- **CI-6B**: migration `20261125180000_ci6_expert_applications` (profile columns
  `institutionAffiliation`/`specialtiesJson`/`applicationConsentAt`, tables
  `ExpertCredentialEvidence` + `ExpertApplicationInfoRequest`, event types
  `EVIDENCE_UPLOADED|INFO_REQUESTED|INFO_ANSWERED|APPLICATION_WITHDRAWN|CONSENT_RECORDED`,
  `WITHDRAWN` transition); `applications.ts` service; routes: application detail
  (`GET/PUT /api/ci5/reviewers/me/application`), evidence upload/list/fetch/delete,
  info-request answer, withdraw; application UI `#/expert-apply` + status view; tests
  (`ci6-expert-applications.test.ts`) incl. negatives (no auto-approval, no assignment for
  pending applicants, forged fields refused, rate limiting).
- **CI-6C**: migration `20261125190000_ci6_credential_verification`
  (`ExpertVerificationRecord`); verification actions in the existing admin action route
  (`RECORD_VERIFICATION`), evidence streaming route for authorised admins, info-request
  creation route, workbench UI section; tests incl. self-approval block, forged
  verified-state refusal, expiry/renewal.
- **CI-6D**: migration `20261125200000_ci6_expert_profiles` (disclosure columns);
  `GET /api/ci6/experts` public directory (consent-gated, state-derived);
  `#/experts` directory UI + reviewer profile visibility controls; tests: no private data
  leak, distinct-state derivation, expiry/suspension automatic.
- **CI-6E**: migration `20261125210000_ci6_expert_invitations` (`ExpertInvitation`);
  admin create/list/revoke routes (raw token shown once), claim route (rate-limited,
  single-use, expiry, links to application, grants nothing); claim UI step in
  `#/expert-apply`; `docs/BEAN-EXPERT-ONBOARDING-OPERATIONS.md` ops guide; tests:
  replay/expiry/revocation/no-privilege negatives, token never logged.
- **CI-6F**: migration `20261125220000_ci6_assignment_availability`
  (`availability` column + `AVAILABILITY` vocabulary); availability toggle route +
  `createAssignment` gate; workspace eligibility/scope surfacing; tests: paused reviewer
  refusal, scope still exact, recusal/reassignment unchanged.
- **CI-6G**: `GET /api/admin/ci6/reporting` honest aggregate route + admin reporting tab;
  provenance assertions wiring expert decisions to real authenticated reviewers; tests:
  zero-display honesty, fixture/real separation, no metric fabrication.
- **CI-6H**: full acceptance battery (suite, lint, tsc, prisma validate, fresh-DB
  migrations, production build, security negatives), real-browser walkthrough
  (application → verification → activation → assignment → review → reporting) with
  genuine screenshots at 1440/768/390/320, CI6-RESULTS.md, ledger unit records.

## 5. Known limitations and outstanding real-world work

- The sandbox holds no real experts, no real credentials, no real verification events and
  no real measurements; all walkthrough fixtures are clearly labelled and disposable.
- Push/PR remain owner-controlled: the sandbox deploy key transports git only (no GitHub
  API PR creation); PRs are opened and merged exclusively by the owner.
- Real-world activation (recruiting genuine experts, independently verifying their
  credentials, acquiring genuine labels) is operational work that happens **after** this
  software lands; until then every real-count in the reporting surface reads zero.
