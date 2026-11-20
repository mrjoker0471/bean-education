# BEAN EDUCATION — Phase 7 UI Completion & Workflow Polish — Results

Branch: `feat/bean-phase7-ui-completion` (based on `origin/main` at `129ab09ebdbff065b917e400186089d0a90083e3`)
Scope: complete the real, usable website UI for the merged Phase 7 (Institution & Career) ecosystem, without rebuilding what already works, without fake data, and without weakening any server-side defense.

---

## 1. What was delivered (commits on this branch)

| Commit | Scope |
|---|---|
| `4b8601a` | Centralized UI capability evaluator + group management server endpoints (§2, §3) |
| `a1182db` | Institution assignment/resource/announcement lifecycle + admin audit read (§3, §5, §6) |
| `03f947a` | Career marketplace filters, employer listing management, application detail API (§10, §11, §12) |
| `34cb19a` | Group management UI completion (§3) |
| `4906a81` | Class management, operational dashboard, invitations UI (§4, §7) |
| `73f500d` | Assignment lifecycle UX, resources + announcements management UI (§5, §6) |
| `386c80d` | Career dashboard hub, portfolio polish, marketplace + applications UX (§8, §9, §10, §11) |
| `eb6e34f` | Employer workspace + admin moderation polish (§12, §13) |
| `61210d7` | Test hygiene fix: module-mock leak — audit tests exercise the real `requireAdmin` |
| `89cd40c` | Career UI fix: expose public portfolio slug in the profile editor (§9 share control) |
| `0064dfe` | Track the three admin career queue read routes (eligibility / opportunities / reports) referenced by the admin centers |

## 2. Role authorization repair (spec §2)

- The spec-named mismatch (GroupsPanel creation button behind `isAdmin` while the creation API uses `requireOrgInstructor()`) is resolved through a single centralized UI capability evaluator (`src/lib/ui-capabilities.ts`) driven by the caller's real organization membership role and verification state — mirrored by `tests/unit/capabilities-role-matrix.test.ts`.
- AssignmentsPanel and ResourcesPanel gating now go through the same evaluator (INSTRUCTOR-and-above for authoring, learner visibility preserved).
- Browser-verified: a LEARNER-scoped session never sees authoring controls; a non-admin session at `#/admin/organizations` is shown the "Administrators only" gate (accessibility snapshot captured during E2E).

## 3. Institution workflows (spec §3–§7)

- Group management: detail page, overview, member roster, instructor assignment, group-scoped classes/assignments/resources/announcements, registration management, edit, archive. Archival and member removal keep every historical record (audit events remain; nothing is deleted).
- Institution classes: private org classes created through the existing BEAN Teach + LiveKit stack (no duplicated system). Server-side defenses from Phase 5/6/7 remain intact (Approved TeacherProfile checks, membership checks, scheduling validation, atomic seat claims, TrustAction audit, LiveKit token authorization). Private classes never surface in public discovery (tested).
- Assignments: draft → publish → close lifecycle, grading queue, feedback, resubmission handling, student grade visibility. Private submissions are never exposed to other students (tested).
- Resources & announcements: create/browse/edit/archive with audience visibility; `db/uploads` stays private.
- Dashboard: every number comes from a real institution-scoped API response. No fabricated charts.

## 4. Career workflows (spec §8–§11)

- Career dashboard is fully API-driven with six quick actions; there is no fabricated "career score".
- Portfolio: PRIVATE / DISCOVERABLE / PAUSED status management (browser-verified: PRIVATE → DISCOVERABLE persisted server-side), projects, skills (self-declared vs institution-verified), credentials, share controls, privacy-safe DTOs.
- Opportunity market: only filters backed by real API query parameters (type, work mode, location, skills, employer); pagination present (Previous/Next, page N of M); listing status + employer verification badge visible; drafts/pending listings stay out of discovery (tested + browser-verified).
- Application experience: consent-based snapshot ("Choose exactly what to share"), exact-payload preview ("SNAPSHOT PREVIEW — THE PAYLOAD THE SERVER WILL STORE"), success shown only after the server responds; contact email consent defaults to OFF and is stored as `contactSharingConsent=false`.

## 5. Employer workspace (spec §12)

- Opportunities tab scoped to one selected employer organization — the UI states "All actions below apply only to <org> — nothing here touches another organization" and the server enforces membership on every route.
- Applicants dialog: privacy copy enforced by behavior — with consent OFF the row reads "no contact sharing", and the application detail says "No contact sharing — reach out only via the candidate-visible note."
- Snapshot is immutable ("never re-derived from their live profile"); status transitions (Under review → …) with candidate-visible note AND employer-private note (explicitly labeled "Only your organization can see these notes"); candidate view shows the candidate-visible note and never the private one (browser-verified both sides + DB row).

## 6. Admin workspace (spec §13)

- `#/admin/organizations`: status-filtered verification queue (pending/approved/rejected/suspended/draft/all), evidence dialog ("Everything below is exactly what the admin APIs return for this organization — nothing is inferred"), audit history tab, decision dialog with optional note, legal-transition-only actions (Approve/Reject from PENDING_REVIEW; Suspend from APPROVED; Reinstate from SUSPENDED — DRAFT orgs must first be submitted by their owner).
- `#/admin/career`: three queues (opportunity moderation, safety reports, adult eligibility) with the explicit trust boundary "Teacher trust lives separately in its own admin area". Phase 6 teacher TrustAction data is not mixed into org/career decisions.
- Adult eligibility queue is privacy-minimizing: no identity documents or numbers collected; denial keeps private career planning available.
- All decisions require evidence + optional reason + a decision dialog; success is shown only after the server confirms. Every decision lands in append-only audit events.

## 7. Navigation & UX (spec §14–§15)

- Existing header/design preserved; nav entries are role-aware (e.g. admin sees Teacher Review / Organizations / Career Moderation; a plain learner does not).
- Hash deep-links work for direct URL entry and back/forward (route round-trip tests included).
- Loading (spinner/skeleton), empty states with retry, inline validation, toast feedback, confirm dialogs for destructive actions, disabled-during-busy buttons, form value retention on failure (inline error + values kept), 44px+ touch targets, ARIA roles/labels on queues and dialogs.

## 8. Test & verification results (spec §16)

- `bun test`: **705 pass / 0 fail** across 44 files (4,134 assertions). Baseline Phase 7 suite (418) + Phase 2A/2B/4A/5/6 suites all still pass; the branch adds targeted suites: role capability matrix, group management, assignment lifecycle, resource authoring rules, announcements lifecycle, marketplace filters, application detail owner-scoping, employer security, admin routing, private-class discovery exclusion, snapshot exactness/bounds.
- `bunx tsc --noEmit`: clean. `bun run lint`: clean.
- `bun run db:status`: 8 migrations present (`baseline` … `phase7_institution_career`). The sandbox SQLite file is provisioned via `db push`, so Prisma reports migrations as "not applied" even though every schema object exists and the full E2E + 705 tests run against it. Pre-existing sandbox condition, unchanged by this branch; no reset was performed.
- Browser E2E (agent-browser, production-shaped flows, zero fabricated data):
  - 12 workflow screenshots in `agent-ctx/e2e/01…12-*.png` (institution overview, group detail, roster, private class management, assignment grading, career home, portfolio preview, opportunity discovery, application consent, application tracking, employer applicants, admin verification).
  - 4-breakpoint sweep evidence: 1440px (the 12 workflow shots), 1280px, 768px, 390px (`bp{width}-{view}.png` for career home + opportunity discovery; layout and sticky footer hold at all widths).
  - Console audit: 0 errors, 0 page errors across all flows (auth → admin decisions → employer listing → candidate application → employer review).
  - No test seeding was faked inside UI claims: account fixtures were registered through the real HTTP API (`/api/auth/register`), admin raised only via the sanctioned operator script (`scripts/grant-role.ts`), org created DRAFT and approved through the real decision flow.

## 9. Git hygiene (spec §17)

- Branch created from `origin/main` (`129ab09…`, verified via anonymous HTTPS `git ls-remote` before branching).
- No main-branch commits, no force-push, no history rewrites; local-only main commit left untouched.
- Secrets scan performed before push (tracked diffs + working tree): no keys, tokens, credentials, `.env`, or database files added. Test accounts use throwaway passwords in throwaway fixtures only.
- Deployment is by pull request only — the branch is pushed and left unmerged; the PR is created manually by the repository owner.
