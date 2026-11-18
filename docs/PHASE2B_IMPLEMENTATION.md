# Phase 2B — Implementation Notes

**Student Experience, Personal Learning Workspace & PYQ Curation**
Branch `feat/bean-learn-phase-2b`, based on merged `main` (1b57633, contains all of Phase 2A).

## Scope delivered

| Milestone | Delivered |
|---|---|
| A — PYQ curator permissions | Role system (STUDENT / PYQ_CURATOR / ADMIN), server-side guards on all PYQ endpoints, operator CLI provisioning, append-only review audit trail, route-level 403/401 tests |
| B — Student onboarding | 5-step skippable wizard (`#/onboarding`, re-openable as `#/onboarding?edit=1`), profile API extension (educationCategory, learningStyle, one-way `onboardedAt` stamp), post-auth routing |
| C — Student dashboard | `GET /api/student/dashboard` extended (today summary, continue-learning cards, in-progress analyses, recent attempts + topics, goals triple, deterministic recommendations); `#/dashboard` view |
| D — My Learning Workspace | `#/workspace` over the EXISTING materials + Riishe pipeline (library, subjects, search, status, retry, organise, continue/practise links) |
| E — Goals & planning | `#/goals` full CRUD (create/edit/complete/archive/reopen/delete) + deterministic plan hints (days-left × daily minutes) |
| F — PYQ curation workspace | `#/pyq-studio` (Import / Review queue / History) + new curator-only `GET /api/pyq/questions` with filters and exact per-status counts |
| Engineering | 82 unit/route tests, typecheck-clean, lint-clean, API E2E suite (37 checks), browser E2E (17 steps), QA seed script |

## Key files

**Server**
- `prisma/schema.prisma` + `prisma/migrations/20261118024220_student_roles_review_audit/` — additive: `Student.role` (default STUDENT, indexed), `Student.onboardedAt`, new `PyqReviewEvent` table. SQLite table-rebuild pattern preserves every existing row (verified by migration deploy + row counts).
- `src/lib/roles.ts` (new) — server-only authorization. Pure decision functions (`hasRole`, `roleDenial`) + `requirePyqCurator()` guard. The 401-vs-403 distinction is deliberate: signed-out → 401, signed-in without role → 403.
- `src/lib/auth.ts` — `AuthStudent` carries `role` + `onboardedAt`; session lookup selects them.
- `src/app/api/auth/register/route.ts` — refuses any client-supplied `role` (400), always creates STUDENT.
- `src/app/api/auth/login/route.ts`, `me/route.ts` — role surfaced (UI-only; server enforces everywhere).
- `src/app/api/pyq/review/route.ts` — `requirePyqCurator()` gate + `PyqReviewEvent` append on every APPROVE/REJECT (reviewer, role held, action, justification, timestamp). Re-approval appends a second event — history is never erased.
- `src/app/api/pyq/import/route.ts` — curator/admin only; guest path REMOVED (no unauthenticated import in the public workflow).
- `src/app/api/pyq/batches/route.ts` — curator/admin only.
- `src/app/api/pyq/questions/route.ts` (new) — curator/admin listing with provenance (paper, exam, year, options, keyed answer, explanation, batch, reviewer, notes), filters (status/exam/year/batch/text), exact status counts, id-desc ordering (Question has no createdAt; cuid ids are time-prefixed).
- `src/app/api/student/profile/route.ts` — preferences gain validated `educationCategory` + `learningStyle` enums; `onboardingComplete: true` stamps `onboardedAt` ONCE (first stamp wins forever). Role is NOT in the schema — a client cannot set it via profile updates.
- `src/app/api/student/dashboard/route.ts` — response extended: `today` (attempts today, minutes submitted today, dailyMinutesTarget), `continueLearning` (recentDocuments w/ topic names, inProgressDocuments, recentAttempts, recentTopics from per-topic JSON), `goals` { active, completedRecent, completedCount }, `recommendations` (deterministic, data-backed rules; capped at 3).

**Client**
- `src/lib/profile-options.ts` (new) — shared profile vocabulary (categories, levels, styles, languages, interest chips) mirroring the server enums.
- `src/components/bean/views/onboarding-view.tsx` (new) — wizard; every step skippable; goals step creates REAL StudyGoal rows; edit-mode reuses the same steps.
- `src/components/bean/views/dashboard-view.tsx` (new) — keyed-fetch pattern (loading derives from initial render; no sync setState in effects).
- `src/components/bean/views/workspace-view.tsx` (new) — My Library/My Subjects/search/organise over existing APIs.
- `src/components/bean/views/goals-view.tsx` (new) — CRUD + plan hints.
- `src/components/bean/views/pyq-studio-view.tsx` (new) — curator workspace; gates mirrored in UI (never the enforcement).
- `src/components/bean/views/settings-view.tsx` — "Edit my profile" entry.
- `src/components/bean/header.tsx` — role-aware nav (Dashboard/My Learning/Goals always for signed-in; PYQ Studio for curators; guests unchanged).
- `src/lib/store.ts` — routes for onboarding/dashboard/workspace/goals/pyq-studio.
- `src/components/bean/local-ai-card.tsx` (new) — RECONSTRUCTED: referenced by settings-view since Phase 2A but never committed (root cause: unscoped `local-*` gitignore rule silently ignored the file and the merged 2A build was broken). Fixed by scoping the rule to `/local-*` and committing the card.

## Onboarding data policy (school-age safety)

Collected: display name, education category, learning level, interests, language, learning style, daily minutes, optional target exam/course, optional goals.
NOT collected: birth date, phone number, school/institution name or location, or any identity documents. Parental consent for minors is future work (see RESULTS § Limitations).

## Design

BEAN's established direction preserved: obsidian background, champagne-gold accents, glass-like cards, consistent spacing, focus states, honest empty states everywhere (dashboard, workspace, goals, review queue). Footer stays sticky-bottom (root `min-h-screen flex flex-col` + `mt-auto` footer — unchanged shell).

## Verification

See `docs/PHASE2B_RESULTS.md` for exact numbers. Nothing in this document claims a result that was not executed.
