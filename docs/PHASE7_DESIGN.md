# PHASE 7 — TECHNICAL DESIGN REPORT

Status: design of record for `feat/bean-institution-career-phase-7`.
Branch base: `origin/main` @ `f162ff48517a3847b1d22cb61020b157ee926d21` (PR #5, Phase 6 merged).
Worktree: `/home/z/phase7-wt` (linked worktree; platform owns `/home/z/my-project` checkout of `main`).

## 0. Audit findings that constrain this design

1. Roles stay `STUDENT | PYQ_CURATOR | ADMIN` globally (`src/lib/roles.ts`). All institution/employer power is **organization-scoped** (`OrganizationMembership.role`), never a global role.
2. Guards to reuse: `requireStudent()`, `requireAdmin()`, `requireApprovedTeacher()` (`src/lib/auth.ts`, `src/lib/teach.ts`), Guard shape `{ok:true,...}|{ok:false,status,error}`.
3. Route conventions: `export const dynamic = 'force-dynamic'`, `runtime = 'nodejs'`, `{error}` JSON bodies, 201 creates, Next 16 `params: Promise<...>`, `try/catch` + `console.error('[api/... <METHOD>]')`.
4. Transactions: `type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]`, outcome-kind maps → status codes. Audit rows always inserted in the same transaction as the state change.
5. Audit: `appendAudit(tx, {...})` → `TeachAuditEvent` (teacher domain, untouched). Phase 7 adds its own append-only `OrganizationAuditEvent` + `CareerAuditEvent` (spec §23 forbids overloading teacher trust models).
6. Rate limiting: `countRecent()` / `RATE_LIMITS` rolling-window row counts → 429.
7. Migrations: additive-only, `bun run db:migrate`, timestamped folders; latest applied = `20261119050000_phase6_trust_quality`. `db:backup` taken before work (`db/backups/custom-20261119-113553.db`).
8. Trust enforcement (`trustStateFor`) must keep working for public classes; Phase 7 adds org/group eligibility **alongside** it, never instead of it.
9. Live token gate (`api/teach/classes/[id]/live/token`) and `live/start` are the two authorization points that gain org/group eligibility checks.
10. Frontend: hash router in `src/lib/store.ts` (`Route` union + `parseHash` + `routeToHash`), views in `src/components/bean/views/*.tsx` (gate→panel split), typed client in `src/lib/api.ts`, DTOs in `src/lib/types.ts`, nav arrays in `src/components/bean/header.tsx`. Single dark theme, gold `#D6A514`, `rounded-xl border border-border bg-card` cards.

## 1. Data model (additive only; String status columns + lib constants, matching existing convention)

### Institution domain
- **Organization**: name, displayName, orgType (SCHOOL…EMPLOYER,OTHER), description, website, publicContact, country/state/city, slug @unique, logoEmoji/logoRef (text only; no upload pipeline in this phase), verificationStatus (DRAFT→PENDING_REVIEW→APPROVED|REJECTED, SUSPENDED), verificationNote (private), reviewedByAdminId/reviewedAt, isActive (soft archival), timestamps.
- **OrganizationMembership**: organizationId+studentId @unique (history preserved by status, not row deletion), role (OWNER/ADMIN/INSTRUCTOR/STAFF/LEARNER/CAREER_COORDINATOR/RECRUITER), status (INVITED/ACTIVE/SUSPENDED/LEFT), invitedByMembershipId, activatedAt/suspendedAt/leftAt, timestamps.
- **OrganizationInvitation**: organizationId, email?, intendedRole (never OWNER/ADMIN), tokenHash @unique (sha256 of 32-byte token; raw shown once), createdByMembershipId, expiresAt, maxUses?, useCount, acceptedAt?, revokedAt?.
- **OrganizationGroup**: organizationId, name, academicYear?, programmeLabel?, batchLabel?, sectionLabel?, trackLabel?, startsAt?/endsAt?, capacity?, status (ACTIVE/ARCHIVED), createdByMembershipId, timestamps.
- **OrganizationGroupMembership**: groupId+membershipId @unique, enrollmentState (ACTIVE/LEFT), joinedAt/leftAt?. History survives leaving.
- **OrganizationAnnouncement**: organizationId, groupId?, authorMembershipId, title, body, publishedAt?, expiresAt?, status (DRAFT/PUBLISHED/ARCHIVED).
- **OrganizationResource**: organizationId, groupId?, authorMembershipId, title, description?, url (https-validated), createdAt.
- **OrganizationAssignment**: organizationId, groupId, createdByMembershipId, title, instructions?, subjectLabel?, submissionType (TEXT/EXTERNAL_LINK/TEXT_AND_LINK), status (DRAFT/PUBLISHED/CLOSED/ARCHIVED), publishedAt?, dueAt?, maxScore?, timestamps.
- **AssignmentSubmission**: assignmentId+studentId @unique (resubmission = update of the same row), studentId, responseText?, externalLink? (https-validated), status (DRAFT/SUBMITTED/RETURNED/GRADED), submittedAt?, gradedByMembershipId?, gradeValue?, teacherFeedback?, gradedAt?, timestamps.
- **OrganizationAuditEvent**: organizationId, entityType, entityId, actorId?, actorRole?, action, detail?, createdAt. Append-only; no cascade deletes.

### Career domain
- **CareerProfile**: studentId @unique, headline?, summary?, preferredRoleTypes/preferredSkills/preferredLocations/workModes (JSON string arrays), visibility (PRIVATE default / DISCOVERABLE / PAUSED), publicSlug? @unique, timestamps.
- **StudentCareerSkill**: studentId, skillName, proficiency?, description?, verificationLabel (SELF_DECLARED default / INSTITUTION_ISSUED / BEAN_ASSESSMENT_VERIFIED — never fabricated), sourceRef?, position, timestamps.
- **CareerProject**: studentId, title, description?, category?, skillsUsed JSON, projectUrl? https, startsAt?/endsAt?, visibility (PRIVATE default / SHARED), status (ACTIVE/ARCHIVED), timestamps.
- **CareerCredential**: studentId, issuerOrganizationId, credentialName, credentialDescription?, issuedDate, expiryDate?, credentialReference?, status (ISSUED/REVOKED), issuedByMembershipId, portfolioShared Boolean default false, revokedAt?/revokedByMembershipId?, timestamps.
- **CareerEligibilityReview**: studentId @unique, status (NOT_ELIGIBLE default / PENDING_REVIEW / APPROVED / DENIED), requestedAt?, reviewedByAdminId?/reviewedAt?/decisionReason?, timestamps. Server-enforced gate for discovery + applications.
- **CareerOpportunity**: employerOrganizationId, title, description, responsibilities?, requiredSkills/preferredSkills JSON, location?, workMode?, opportunityType (JOB/INTERNSHIP/APPRENTICESHIP/PROJECT), compensationDescription? (informational only), applicationDeadline?, eligibilityDescription?, status (DRAFT→PENDING_REVIEW→PUBLISHED/PAUSED/CLOSED|REJECTED), reviewedByAdminId?/reviewedAt?/rejectionReason?, publishedAt?, timestamps.
- **CareerApplication**: opportunityId+studentId @unique (DB-level duplicate prevention), studentId, status (SUBMITTED→UNDER_REVIEW→SHORTLISTED→INTERVIEW→SELECTED|REJECTED; WITHDRAWN), snapshotJson (bounded ≤ 8KB; submission-time snapshot, never rewritten), contactSharingConsent Boolean default false, employerNotes? (private), candidateVisibleStatusNote?, withdrawnAt?, submittedAt, updatedAt.
- **CareerSafetyReport**: reporterId, targetType (OPPORTUNITY/ORGANIZATION), targetId, category, subject, description, status (OPEN/UNDER_REVIEW/RESOLVED/DISMISSED), assignedAdminId?, resolutionNote? (admin-private), resolvedAt?, timestamps.
- **CareerAuditEvent**: entityType, entityId, actorId?, actorRole?, action, detail?, createdAt. Append-only.

### ClassSession additive columns
`organizationId String?`, `organizationGroupId String?`, `audience String @default("PUBLIC")` + index `@@index([organizationId, audience])`. All existing rows default to PUBLIC; public behavior unchanged.

## 2. Authorization matrix (server-enforced on every route)

| Action | Who |
|---|---|
| Create organization | any signed-in student (creator → pending OWNER membership) |
| Edit org / submit for verification | OWNER, ADMIN |
| Create invitation | OWNER, ADMIN (roles limited to INSTRUCTOR/STAFF/LEARNER/CAREER_COORDINATOR/RECRUITER) |
| Accept invitation | signed-in student matching email (if set), org APPROVED, not already member |
| Appoint/suspend/remove member | OWNER/ADMIN; cannot touch OWNER of another org; last-owner protection |
| Create group / enroll member | OWNER/ADMIN/INSTRUCTOR |
| Create private class (audience ORGANIZATION/GROUP) | active INSTRUCTOR/ADMIN/OWNER of that org **and** approved TeacherProfile (existing guard) for live hosting |
| Book private class | ORGANIZATION → active org membership; GROUP → active enrollment in that group |
| Live token/start (private class) | re-checks same eligibility per request |
| Publish/close/grade assignment | group instructor or org admin/owner |
| Submit/resubmit assignment | active enrolled learner; others 403/404 |
| Read submission/grade | author student + permitted staff only |
| Issue credential | OWNER/ADMIN of an APPROVED organization, issuer membership active |
| Create opportunity | OWNER/ADMIN/RECRUITER of APPROVED EMPLOYER org |
| Edit opportunity | same org only |
| Apply to opportunity | signed-in student, adult eligibility APPROVED, opportunity PUBLISHED + open deadline |
| Withdraw application | applicant only |
| View applicants | employer org members (OWNER/ADMIN/RECRUITER/CAREER_COORDINATOR) for own opportunities only |
| Candidate discovery | APPROVED EMPLOYER org + eligible candidates only; rate-limited, paginated |
| Org verification / opportunity moderation / career safety / eligibility review | `requireAdmin()` only |

Suspension semantics: `SUSPENDED`/`LEFT` membership blocks **new** private-class access and org functions; historical bookings/attendance/submissions are retained (no deletions).

## 3. API surface (new route files under `src/app/api/`)

- `organizations/route.ts` (GET my orgs, POST create)
- `organizations/[id]/route.ts` (GET profile, PATCH update)
- `organizations/[id]/submit/route.ts` (submit for verification)
- `organizations/[id]/members/route.ts` (GET list)
- `organizations/[id]/members/[memberId]/route.ts` (POST role/status action)
- `organizations/[id]/invitations/route.ts` (GET list, POST create → returns raw token once)
- `organizations/invitations/accept/route.ts` (POST raw token)
- `organizations/[id]/groups/route.ts` (GET, POST)
- `organizations/[id]/groups/[groupId]/enrollments/route.ts` (POST enroll, DELETE leave)
- `organizations/[id]/dashboard/route.ts` (GET overview aggregates)
- `organizations/[id]/assignments/route.ts` (GET, POST)
- `organizations/assignments/[assignmentId]/route.ts` (GET detail + submissions for staff)
- `organizations/assignments/[assignmentId]/submissions/route.ts` (POST student submit)
- `organizations/assignments/[assignmentId]/submissions/[submissionId]/route.ts` (PATCH resubmit / grade)
- `organizations/[id]/announcements/route.ts` (GET, POST)
- `organizations/[id]/resources/route.ts` (GET, POST)
- `organizations/[id]/classes/route.ts` (GET org classes incl. private)
- `career/profile/route.ts` (GET, POST create, PATCH update)
- `career/skills/route.ts` (GET, POST) + `career/skills/[id]/route.ts` (PATCH, DELETE)
- `career/projects/route.ts` (GET, POST) + `career/projects/[id]/route.ts` (PATCH, DELETE)
- `career/credentials/route.ts` (GET own; PATCH portfolio sharing) 
- `career/credentials/issue/route.ts` (POST by institution staff)
- `career/eligibility/route.ts` (GET status, POST request review)
- `career/opportunities/route.ts` (GET published browse)
- `career/opportunities/[id]/route.ts` (GET detail)
- `career/opportunities/[id]/apply/route.ts` (POST)
- `career/my-applications/route.ts` (GET)
- `career/applications/[id]/withdraw/route.ts` (PATCH)
- `career/employer/opportunities/route.ts` (GET manage list, POST create)
- `career/employer/opportunities/[id]/route.ts` (PATCH edit, POST submit)
- `career/employer/opportunities/[id]/applications/route.ts` (GET applicants)
- `career/employer/applications/[id]/status/route.ts` (PATCH status + visible note)
- `career/employer/candidates/route.ts` (GET discovery, paginated + rate-limited)
- `career/reports/route.ts` (POST safety report)
- `admin/organizations/route.ts` (GET queue) + `admin/organizations/[id]/verification/route.ts` (POST decision)
- `admin/career/opportunities/route.ts` (GET queue) + `admin/career/opportunities/[id]/moderation/route.ts` (POST)
- `admin/career/reports/route.ts` (GET) + `admin/career/reports/[id]/action/route.ts` (POST)
- `admin/career/eligibility/route.ts` (GET queue) + `admin/career/eligibility/[reviewId]/decision/route.ts` (POST)

Teach routes touched (additive eligibility only): `teach/classes/route.ts` (POST/PATCH audience fields + GET discovery excludes non-PUBLIC), `teach/classes/[id]/route.ts` (detail visibility), `teach/classes/[id]/book/route.ts` (org/group gate), `teach/classes/[id]/live/token/route.ts` + `live/start/route.ts` (re-check).

## 4. Frontend routes

Route union additions (`src/lib/store.ts`):
```
{ view: 'institution' }
{ view: 'institution-org'; orgId: string; section?: 'members'|'groups'|'classes'|'assignments'|'resources'|'reports' }
{ view: 'career' }
{ view: 'career-profile' }
{ view: 'career-portfolio' }
{ view: 'career-opportunities' }
{ view: 'career-opportunity'; opportunityId: string }
{ view: 'career-applications' }
{ view: 'career-employer' }
{ view: 'admin-organizations' }
{ view: 'admin-career' }
```
parseHash: `case 'institution'` (parts[1] = orgId, parts[2] = section), `case 'career'` (parts[1] = profile|portfolio|opportunities|applications|employer; opportunities/:id → detail), `case 'admin'` extended with `organizations` | `career` (`trust` unchanged).
Views: `institution-view.tsx` (hub + create), `institution-org-view.tsx` (section tabs), `career-view.tsx` (hub), `career-profile-view.tsx`, `career-portfolio-view.tsx`, `career-opportunities-view.tsx`, `career-opportunity-detail-view.tsx`, `career-applications-view.tsx`, `career-employer-view.tsx`, `admin-organizations-view.tsx`, `admin-career-view.tsx`.
Nav: header adds "Institution" + "Career" for signed-in users; admin-only spread adds the two admin entries (server remains authoritative).

## 5. Milestones & commits

1. `feat(db): institution and organization foundation` — schema + migration `20261119060000_phase7_institution_career` (new tables + ClassSession columns).
2. `feat(api): organization membership and institution access` — org/invitation/member/group routes + libs (`institution.ts`, `institution-schema.ts`, `institution-dto.ts`).
3. `feat(ui): institution workspace and groups` — routes/views/nav + api client entries.
4. `feat(institution): assignments and private class integration` — assignments/resources/announcements routes + teach integration (booking/live gates).
5. `feat(career): student skills and portfolio` — career profile/skills/projects/credentials/eligibility routes + views.
6. `feat(career): verified employer opportunities and applications` — employer routes + moderation + discovery + views + admin org/career views.
7. `test: institution career privacy and regression coverage` — new suites + no-payment guard + full regression.
8. `docs: phase 7 institution and career ecosystem` — 7 PHASE7_* docs + 6 doc updates.

## 6. Explicit non-goals (enforced by tests)

No payments/Razorpay/fees/wallets/payouts/billing/ledgers/payment webhooks. No email/SMS delivery (invitation = copy-link, honestly labeled). No third-party services. No AI candidate scoring/ranking. No new global roles. No teacher `TrustAction` reuse for employers. No auto-suspension from reports. No disclosure of private learning data to institutions/employers. Discovery/applications blocked without approved adult eligibility; no identity documents collected.
