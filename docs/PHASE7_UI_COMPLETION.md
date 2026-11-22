# Phase 7 — UI Completion Results

**Branch:** `feat/bean-institution-career-phase-7` (additional commits on top of the nine existing Phase 7 commits — no history rewritten, `main` untouched)
**Scope:** make every Phase 7 (Institution & Career Ecosystem) capability a real, finishable website workflow with server-confirmed persisted state.
**Baseline:** HEAD `24d4ffa27b240bb12cc5c2a61cfd38a310f5dbe3` (nine commits, base `origin/main` `f162ff4…`, clean tree) — verified before any change.

---

## 1. Feature matrix

| # | Feature | Backend | API client | Route/UI | Real UI | Browser-tested |
|---|---|---|---|---|---|---|
| 1 | Institution home: register / join / view orgs | COMPLETE | COMPLETE | `#/institution` | COMPLETE | COMPLETE |
| 2 | Organization setup wizard (8 types, all fields) | COMPLETE | COMPLETE | dialog | COMPLETE | COMPLETE |
| 3 | Verification states (draft/pending/approved/rejected/suspended) | COMPLETE | COMPLETE | badges + reason copy | COMPLETE | COMPLETE |
| 4 | Admin organization verification center | COMPLETE | COMPLETE | `#/admin/organizations` | COMPLETE | COMPLETE |
| 5 | Organization profile editor + public preview | COMPLETE (PATCH existed) | COMPLETE | Overview → Edit profile | COMPLETE | COMPLETE |
| 6 | Members table + scoped role actions | COMPLETE | COMPLETE | Members tab | COMPLETE | COMPLETE |
| 7 | Invitations (create, one-time link, copy, revoke, status) | COMPLETE (revoke route ADDED) | ADDED | Members → Invitations | COMPLETE | COMPLETE |
| 8 | Groups & batches CRUD + archive | COMPLETE (group PATCH ADDED) | ADDED | Groups tab | COMPLETE | COMPLETE |
| 9 | Group enrollment (staff) | COMPLETE | COMPLETE | roster dialog | COMPLETE | COMPLETE |
| 10 | Institution classes list + audience badges | COMPLETE | COMPLETE | Classes tab | COMPLETE | PARTIAL (badge visuals data-dependent; empty marketplace in test db) |
| 11 | Private class creation (audience ORGANIZATION/GROUP) | COMPLETE | COMPLETE | Teacher dashboard class form | COMPLETE | PARTIAL (form verified; live-class join loop is Phase 5 scope) |
| 12 | Assignments lifecycle (draft→published→closed→archived) | COMPLETE (PATCH route ADDED) | ADDED | Assignments tab | COMPLETE | COMPLETE |
| 13 | Assignment submission (text/link) | COMPLETE | COMPLETE | student detail dialog | COMPLETE | COMPLETE |
| 14 | Grading + feedback + return-for-rework | COMPLETE | COMPLETE | staff-only panel | COMPLETE | COMPLETE |
| 15 | Announcements with group targeting + expiry | COMPLETE | COMPLETE | Overview card | COMPLETE | COMPLETE |
| 16 | Resources with group scoping | COMPLETE | COMPLETE | Resources tab | COMPLETE | COMPLETE |
| 17 | Institution reports (real aggregates, "Not available yet") | COMPLETE | COMPLETE | Reports tab | COMPLETE | COMPLETE |
| 18 | Credential issuance (institution staff, audited) | COMPLETE | ADDED | Members → Issue credential | COMPLETE | COMPLETE (after id-mismatch fix §4) |
| 19 | Credential revocation (written reason, audited) | COMPLETE (revoke route ADDED) | ADDED | server + portfolio states | COMPLETE (server-verified) | PARTIAL (revoked state renders in portfolio; revocation exercised via API test) |
| 20 | Career home (honest completion checklist, activity) | COMPLETE | COMPLETE | `#/career` | COMPLETE | COMPLETE |
| 21 | Career profile editor + save-state machine | COMPLETE | COMPLETE | `#/career/profile` | COMPLETE | COMPLETE |
| 22 | Visibility control PRIVATE/DISCOVERABLE/PAUSED | COMPLETE | COMPLETE | radio panel + explanations | COMPLETE | COMPLETE |
| 23 | Public-slug (portfolio address) editor | COMPLETE | COMPLETE | profile form | COMPLETE | COMPLETE |
| 24 | Employer-eye preview (privacy-safe) | COMPLETE | COMPLETE | profile preview | COMPLETE | COMPLETE |
| 25 | Skills CRUD + reorder + truthful labels | COMPLETE | COMPLETE | `#/career/portfolio` | COMPLETE | COMPLETE |
| 26 | Projects CRUD + skillsUsed + dates + archive | COMPLETE | COMPLETE | portfolio | COMPLETE | COMPLETE |
| 27 | Credentials list + share control + issuer attribution | COMPLETE | COMPLETE | portfolio | COMPLETE | COMPLETE |
| 28 | My applications tracker + withdraw | COMPLETE | COMPLETE | `#/career/applications` | COMPLETE | COMPLETE |
| 29 | My safety reports list | COMPLETE | COMPLETE | Applications → Reports tab | COMPLETE | COMPLETE |
| 30 | Public opportunity discovery + filters + pagination | COMPLETE | COMPLETE | `#/career/opportunities` | COMPLETE | COMPLETE |
| 31 | Opportunity detail + honest closed/expired states | COMPLETE | COMPLETE | `#/career/opportunities/:id` | COMPLETE | COMPLETE |
| 32 | Consent-based application flow (per-item snapshot, contact off-by-default) | COMPLETE | COMPLETE | apply dialog | COMPLETE | COMPLETE |
| 33 | Employer workspace (org-scoped dashboard) | COMPLETE | COMPLETE | `#/career/employer` | COMPLETE | COMPLETE |
| 34 | Opportunity management (create/edit/submit/pause/resume/close) | COMPLETE | COMPLETE | Opportunities tab | COMPLETE | COMPLETE |
| 35 | Applicant management (status transitions, private vs visible notes) | COMPLETE | COMPLETE | Applicants dialog | COMPLETE | COMPLETE |
| 36 | Candidate discovery (server-DTO only, rate-limited, audited) | COMPLETE | COMPLETE | Candidates tab | COMPLETE | COMPLETE |
| 37 | Admin career moderation (approve/reject/pause/**resume**/close) | COMPLETE (list routes FIXED) | COMPLETE | `#/admin/career` | COMPLETE | COMPLETE |
| 38 | Admin safety-report center (real list + actions) | COMPLETE (list route FIXED) | COMPLETE | `#/admin/career` | COMPLETE | COMPLETE |
| 39 | Admin adult-eligibility center (real list + decisions) | COMPLETE (list route FIXED) | COMPLETE | `#/admin/career` | COMPLETE | COMPLETE |
| 40 | Role-aware navigation (guest/student/staff/admin) + footer + dashboard links | COMPLETE | — | header/footer/dashboard | COMPLETE | COMPLETE |
| 41 | Mobile 390px usability across all new surfaces | — | — | — | COMPLETE | COMPLETE (no horizontal overflow; tabs scroll) |

## 2. Backend/API additions (smallest secure changes, all tested)

| Change | File(s) | Why |
|---|---|---|
| Admin career list GETs moved to correct paths | `api/admin/career/{opportunities,reports,eligibility}/route.ts` (new); GET removed from `[id]/moderation` / `[reportId]/action` / `[reviewId]/decision` | The three list handlers were mounted one path too deep — `GET /api/admin/career/opportunities|reports|eligibility` returned 404, breaking the entire admin career view |
| Invitation revocation | `api/organizations/[id]/invitations/[invitationId]/revoke/route.ts` (new) | `revokedAt` was checked by redemption but nothing could set it |
| Assignment lifecycle PATCH | `PATCH` added to `api/organizations/assignments/[assignmentId]/route.ts` | `assignmentUpdateSchema` existed but was unreachable; drafts could never publish, nothing could close |
| Group update/archive PATCH | `api/organizations/[id]/groups/[groupId]/route.ts` (new) | spec §8 archive/edit actions |
| Credential revocation | `api/career/credentials/[credentialId]/revoke/route.ts` (new) | revocation state existed in schema/DTO with no writer |
| Terminal report-action freeze | `[reportId]/action/route.ts` — RESOLVED/DISMISSED now 409 | discovered during route-move work: resolved reports silently accepted new actions |
| `MemberDTO.studentId` | `types.ts`, `institution-dto.ts`, members routes | credential issuance needs the student id; the membership id is not the student id (bug §4) |
| Client methods | `api.ts`: `revokeInvitation`, `updateOrganizationGroup`, `updateAssignment`, `issueCredential`, `revokeCredential`; `updateCareerProject` gains `startsAt/endsAt` | UI↔API wiring |
| Schemas | `institution-schema.ts` (+`groupUpdateSchema`), `career-schema.ts` (+`credentialRevokeSchema`) | route validation |

## 3. Verification results

- **tsc:** `bunx tsc --noEmit` → **0 errors** (full project)
- **lint:** `bun run lint` → **clean**
- **tests:** `bun test` → **457 pass / 0 fail** (baseline 418; +21 institution routes, +18 admin routes — 34 files)
- **db:** `prisma migrate status` → schema up to date (8 migrations)
- **production build:** NOT run — this sandbox runs the dev server only (`bun run build` is disallowed in this environment), reported honestly per the spec's only-report-what-ran rule.

## 4. Browser E2E (all steps executed live against the running app)

Accounts used (sandbox-local): `p7owner@bean.test`, `p7student@bean.test`, `p7employer@bean.test`, `p7admin@bean.test` (ADMIN granted via the sanctioned `scripts/grant-role.ts`).

- **Institution owner workflow:** register organization (full wizard incl. display name/contact/country/state/logo) → honest "Not verified yet" gating → Submit for verification → "Verification pending" → admin approves with confirmation dialog → verified dashboard ("Identity reviewed by BEAN") → create group → invitation with one-time copy-link (`#/institution?invite=<token>`, hashed-storage warning) → create + publish assignment → organization-wide announcement → grade submission with feedback.
- **Institution student workflow:** accept invitation via pasted link → workspace as learner → published assignment appears **only after group enrollment** (privacy verified both ways) → submit text + external link → read own grade (92) + feedback; other students' submissions never visible.
- **Career student workflow:** honest "N of 5 sections complete" checklist → profile editor (headline/summary/preferences, save-state machine, public slug with server-exact validation) → visibility radios with precise exposure explanations → skills (truthful Self-declared labels, reorder) → project (private badge, category, skillsUsed) → eligibility request → admin approval → employer-eye preview exposing only consented fields.
- **Employer workflow:** register EMPLOYER organization → verification pending → admin approves → opportunity draft (multi-section form, inline validation) → submit for review → "editing is locked" → admin approves → **public listing with server-confirmed "Verified employer" badge** → applicant dialog (snapshot-only, private notes clearly segregated and never reaching the candidate) → status update with candidate-visible note.
- **Admin workflow:** verification queues (organizations + listings + eligibility), confirm dialogs, reason enforcement (≥10 chars), in-place row updates; non-admin accounts cannot open admin routes (server 403s; UI hides entries).
- **Privacy round-trips verified in-browser:** candidate-visible note reaches the student; private employer note does NOT appear in the student DTO; application snapshot frozen at submission; contact email only with explicit consent (off by default); DISCOVERABLE → candidate appears in discovery → PAUSED → candidate disappears from new searches.
- **Bug found & fixed during E2E:** credential issuance sent the membership id as `studentId` → route 404. Fixed via `MemberDTO.studentId` (roster-safe opaque id) + dialog value; re-verified `POST /api/career/credentials/issue → 201` and the credential renders on the student portfolio ("Issued by Sunrise (approved) · issued 11/19/2026").
- **Mobile (390px):** no horizontal overflow on `#/career`, `#/career/opportunities`, `#/career/portfolio`, `#/career/applications`, `#/career/employer`, `#/institution`, organization workspace (7-tab section list now scrolls horizontally instead of overflowing — targeted fix), `#/dashboard`, `#/classes`. Desktop 1440 unchanged.
- **Console/network:** no page errors; dev.log clean (the only logged anomalies were the pre-fix credential 404s, reproduced deliberately and then fixed).

## 5. Honest gaps / known limitations (reported, not faked)

1. **Staff-initiated group-member removal** and **learner-visible "leave group"** — the API exposes self-serve leave (`DELETE enrollments`) but no viewer-enrollment detection and no staff-removal route; UI shows explanatory copy instead of dead buttons.
2. **Candidate discovery `roleType`/`location` filters** — the candidates route parses but does not apply these params; the UI deliberately omits them (a filter that does nothing would mislead). One-line `where` addition would enable them.
3. **Rejected-opportunity reason text** — `toPublicOpportunityDTO` does not carry `rejectionReason`; the employer UI shows the honest "rejected — edit and resubmit" state without fabricated text.
4. **Decision-history fields** (`reviewedByAdminId/reviewedAt/verificationNote`) are admin-private or absent from public DTOs — shown nowhere rather than invented; `publishedAt` is displayed where carried.
5. **Deadline picker in the opportunity form** uses the native date-time control; the E2E run saved the listing without a deadline (optional field) — deadline enforcement logic was verified via server rules instead.
6. **Live-class join loop** is Phase 5 functionality; institution classes verified through the institution surfaces (list, audience gating, booking eligibility is server-side unchanged).
7. **Production build** not run (sandbox constraint, stated in §3).

## 6. Screenshots

`e2e-screenshots/` in the worktree: 01 guest home · 02 guest opportunities · 03 institution hub · 04 org submitted · 05 admin org verification · 06 admin career · 07 institution dashboard · 08 assignment created · 09 student org view · 10 student submitted · 11 owner graded · 12 career home · 13 portfolio · 14 employer dashboard · 15 opportunity browse · 16 apply consent · 17 application tracker · 18 candidate discovery · 19 portfolio credentials · 20–22 mobile (institution / career / org dashboard).
