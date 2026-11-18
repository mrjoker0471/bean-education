# Changelog

All notable changes to BEAN Education. Format based on Keep a Changelog.

## Phase 4A — BEAN Teach marketplace foundation (2026-11-18)

Branch `feat/bean-teach-marketplace` (from merged main f573b54).

### Added
- Teacher application lifecycle: any signed-in student applies via `#/teach/apply` ("Become a BEAN Teacher") — one profile per account (unique `studentId`), no second login, no paid registration, deliberately no DOB/bank/ID collection. States NOT_APPLIED → PENDING → APPROVED | REJECTED; rejection shows the reason and allows resubmission that reuses the same row while preserving the append-only history.
- Admin review (`#/teach/review`, ADMIN-only): pending/approved/rejected/all queues, bounded search, full application dialog with append-only history, approve (optional note) / reject (mandatory 10–400 char reason); self-review forbidden; reviewer id/role/date/note recorded on the profile and in the audit trail.
- Teacher capability = an APPROVED `TeacherProfile` attached to the existing authenticated Student — NO new role; the single `Student.role` field is untouched; curator/admin accounts can also be teachers.
- Class management (`#/teach/dashboard`, approved teachers only): public profile view/edit (verification-relevant edits trigger re-review — see Security), class lifecycle DRAFT → PUBLISHED → CANCELLED | COMPLETED, create dialog (duration 60–360 min in 30-min steps, capacity 1–50, minimum enrolment ≤ capacity, future schedule validated server-side, IANA time zone stored separately from UTC timestamps, optional planned price stored as paise metadata), explicit publish/unpublish (unpublish blocked while seats are held), audited class cancellation which releases all reservations.
- Student marketplace (`#/classes` for guests AND students; class detail `#/classes/:id`): subject/level/language/duration-bucket/date/teacher filters + search + bounded pagination; free reservations with atomic seat claiming; cancellation window until class start; "My bookings" tab (upcoming/completed/cancelled groups, attendance badges); guests browse freely and are asked to sign in only at reservation time.
- Attendance: teacher marks ATTENDED / NO_SHOW only after the class has ended (server-side time check), per-change audit events; teachers see enrolled students (display names only — never emails).
- Navigation: Classes entry added to the guest + signed-in header (desktop + mobile sheet), Teacher Review entry for ADMIN; every existing route/link unchanged.
- Typed API client methods in `src/lib/api.ts` + DTOs in `src/lib/types.ts`; 14 new route files under `/api/teach/*` and `/api/admin/teach/*` (19 handler functions).
- Tests: 5 new suites (application lifecycle, class rules/permissions, booking incl. concurrent last-seat + cancellation + attendance, admin review, seat-claim SQL against a real in-memory SQLite engine) — 158 tests / 15 files passing; route-level bun tests with mocked db/auth (established pattern).
- Docs: 4 new BEAN_TEACH_* docs (implementation, database, security, results) + roadmap/decisions/architecture/development updates.

### Changed
- Migration workflow baselined: the runtime DB had been built with `prisma db push`, so the 4 pre-existing migrations were recorded via `prisma migrate resolve --applied` (zero-drift verified with `prisma migrate diff` first; no data touched, no reset). The 4A schema change ships as an additive committed migration (`20261118030000_bean_teach_marketplace`, generated via `prisma migrate diff` from live DB → new schema).
- Prisma schema extended additively: `TeacherProfile`, `TeachAuditEvent`, `ClassSession`, `ClassBooking` + `Student` back-relations (`teacherProfile`, `classBookings`). No existing column or row changed.

### Security
- Seat integrity: `bookedCount` is maintained ONLY inside the booking transaction via one conditional SQL `UPDATE … WHERE bookedCount < capacity` (`src/lib/teach-booking.ts`) — two students racing for the last seat cannot both win; verified on the live server (exactly one 201, one 409).
- Identity always from the httpOnly session cookie; client-supplied ids never trusted for ownership (server-side lookups; foreign resources return 404). Every mutation enforces same-origin; every body is Zod-validated (`src/lib/teach-schema.ts`).
- Privacy: no public emails or phones — teachers appear by teaching name, enrolled students by display name only, review notes stay private (applicant + admins); the admin application list is the only surface exposing the applicant email. Applications deliberately exclude DOB/bank/Aadhaar/PAN.
- Authorization: self-review forbidden; no API can grant ADMIN (roles change only via the operator CLI, unchanged from 2B); bounded page sizes (≤48 public / ≤50 admin), query length caps, ≤50 active classes per teacher, duration/capacity/future-schedule validation on create, edit and publish.

## Phase 2B — Student experience & PYQ curation (2026-11-18)

Branch `feat/bean-learn-phase-2b` (from merged main 1b57633).

### Added
- Role system: `Student.role` (STUDENT default, additive migration) + server-only `src/lib/roles.ts`; PYQ import/review/batches/questions restricted to PYQ_CURATOR/ADMIN (guest 401, student 403); operator CLI `scripts/grant-role.ts` (dry-run default, last-ADMIN protection); append-only `PyqReviewEvent` audit trail.
- Onboarding wizard (`#/onboarding`, skippable, re-openable as profile editor): education category (7 student groups), level, interests, language, style, daily time, optional exam focus, first real goals; one-way `onboardedAt` stamp.
- Student dashboard (`#/dashboard` + extended `GET /api/student/dashboard`): today summary, continue-learning cards, in-progress analyses, recent attempts/topics, goals triple, deterministic data-backed recommendations.
- My Learning workspace (`#/workspace`): library, subject grouping, search, processing status, organise-by-subject, continue/practise links — over the existing materials + Riishe APIs.
- Goals manager (`#/goals`): create/edit/complete/archive/reopen/delete + deterministic plan hints (days-left × daily minutes).
- PYQ curation studio (`#/pyq-studio`): structured JSON import with client pre-flight + honest row errors; review queue with provenance-complete cards, mandatory approval justification, explicit rejection confirmation, status/exam/year/batch/text filters with exact live counts; import history. New curator-only `GET /api/pyq/questions`.
- Role-aware header navigation; "Edit my profile" in settings; reconstructed `local-ai-card.tsx` (fixes broken 2A build — see below).
- Tests: 10 suites / 82 tests (route-level authorization, isolation, honesty rules); API E2E suite `scripts/verify-phase2b.sh` (37 checks); browser E2E; QA demo-catalogue seed.

### Changed
- Registration now refuses client-supplied roles (400) — every account is STUDENT.
- PYQ import guest path REMOVED (curator-only provenance accountability).
- Auth responses carry `role` + `onboardedAt`; sign-up routes to onboarding, sign-in routes by onboarding state.

### Fixed
- `.gitignore` `local-*` rule silently ignored `src/components/bean/local-ai-card.tsx` (referenced by settings since 2A) — the merged main build was broken. Scoped the rule to `/local-*` and committed the reconstructed card.

### Security
- A student can no longer approve/reject PYQ records (was: any signed-in student). Reviewer identity, role held, justification and timestamp are recorded per decision; verified rows cannot be casually downgraded (409).

## [Unreleased] — 2026-11-18

### Added
- Project documentation suite: README (extended), CHANGELOG, docs/ARCHITECTURE.md, docs/DEVELOPMENT.md, docs/DEVELOPMENT_ROADMAP.md, docs/DECISIONS.md, docs/PHASE1_AUDIT.md.
- `.env.example` with placeholder values (variable names only).

### Changed
- Connected the repository to GitHub (`mrjoker0471/bean-education`), preserving the remote initial commit via an unrelated-histories merge.

### Security
- Scrubbed secrets and private files from entire git history before first push: `.env`, `db/custom.db`, `db/uploads/*` (user PDFs). Files restored to disk; git-ignored permanently (ADR-007).
- Untracked and ignored runtime artifacts: `tool-results/`, `agent-ctx/`, `upload/`, `download/`.
- GitHub authentication established via sandbox-local SSH key (ADR-008); no tokens or secrets stored in plaintext files.

### Notes
- Phase 1 (audit & preserve) completed; no application code modified in this milestone. Audit findings and Phase 2 entry backlog in docs/PHASE1_AUDIT.md.

## [Phase 2A] — 2026-11-18 (branch feat/bean-learn-phase-2a)

### Added
- Student identity: email/password accounts (scrypt), hashed session tokens, httpOnly cookies, guest-data claim, JSON export, account deletion; #/auth view and settings account card. Guest mode unchanged.
- PYQ ingestion foundation: structured import with provenance + duplicate detection, review workflow (PYQ_VERIFIED only via justified approval), batch audit trail, CLI script. Bank honestly still zero-PYQ.
- OCR: Tesseract 5.5 + pdftoppm (English + Tamil) inside the Riishe pipeline — scanned pages get real text with provenance and honest failure states.
- Durable background jobs: RiisheJob/JobQuota tables, atomic claims, lease recovery, bounded retries, per-owner limits, durable hourly quotas, cancellations.
- Student profile/learning level/interests/preferences, study goals, dashboard aggregate endpoints.
- On-device AI foundation: capability detection, consent-gated WebLLM adapter, settings card — no automatic downloads; server AI remains default.
- Prisma migration history (baseline + 2 incremental) with backup-first workflow; test runner (`bun test`) with 23 focused tests.

### Changed
- Answer correctness: one canonical per-question valid-index rule across scoring/autosave/result/explanations — invalid indices are skipped, never wrong-with-undefined-text.
- BEAN chat: prompt-injection fencing for notes and external document excerpts.
- Riishe generation: exact generated/validated/flagged/rejected accounting; FLAGGED workflow retains validator-doubted questions unpublished; `_parts` retry state stripped from complete analyses.
- Engineering: reactStrictMode ON, ignoreBuildErrors removed, tsconfig scoped to the app, db query logging opt-in (DB_QUERY_LOG=1), --accept-data-loss removed, dead /api scaffold removed.

### Security
- Uploads: file-first creation (no empty-storedPath window), compensating cleanup, orphan sweep, transactional deletes incl. chat turns, job cancellation.
- Auth mutations guarded by same-origin; no plaintext secrets anywhere; no user data in logs.
