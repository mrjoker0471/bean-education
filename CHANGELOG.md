# Changelog

All notable changes to BEAN Education. Format based on Keep a Changelog.

## Phase 6 — BEAN Trust & Quality (2026-11-19)

Branch `feat/bean-trust-quality-phase-6`. Additive milestone: every Phase 4A/5 surface, route and rule is unchanged; still no payments, wallets or refunds (free pilot — refund rules are Phase 8).

### Added
- Trust & quality data model: additive migration `20261119050000_phase6_trust_quality` with 7 new tables — `ClassReview` (one review per booking, `bookingId` UNIQUE at DB level), `TeacherReviewResponse` (one reply per review), `TeachComplaint` + append-only `ComplaintEvent`, `TrustAction`, `TeachAppeal` (+ append-only `AppealEvent`) — 2 unique indexes + 11 lookup indexes; zero columns added to existing tables.
- Verified reviews (`POST/GET /api/teach/classes/:id/reviews`, `PATCH /api/teach/reviews/:reviewId`): eligibility is a real ATTENDED booking after class end (server-evaluated, identity from the session cookie); one review per booking with P2002 → 409 on racing duplicates; author self-edit within a 7-day window (HIDDEN reviews cannot be edited); reviewers render as "Verified student" plus an opt-in consented displayName — never emails or account ids.
- Review moderation: teacher/ADMIN flag with a written reason (flagging NEVER auto-hides — FLAGGED stays publicly visible but is excluded from aggregates), ADMIN-only HIDE/RESTORE/KEEP_PUBLISHED with documented reasons, every transition audited (`REVIEW_*` on `TeachAuditEvent`).
- Teacher responses: one public reply per review by the reviewed class's owner teacher (unique FK), 7-day edit window, audited; teachers can never edit a student's review.
- Quality metrics: server-computed from authoritative rows only (`src/lib/trust-quality.ts`) — averageRating over PUBLISHED+verified reviews, reviewCount, completed/completionRate, publishedClasses; below the 3-review sample the UI honestly shows "New teacher — not enough verified reviews yet" instead of a fabricated score. Complaint data is structurally excluded from the math.
- Private complaints: 11 categories, severity + sensitivity SERVER-DERIVED (clients cannot assert them), legitimate-relationship rule (booking holder or class teacher; platform-level only for SAFEGUARDING/HARASSMENT/OTHER), append-only case history with redacted admin notes for the complainant, 10/day rate limit. Teachers see only an anonymous open-complaint count — never content or reporter identity; there are no public complaint endpoints.
- Trust actions: admin-issued NOTICE / WARNING (record-only), PAUSE_LISTINGS (hide browse + detail from non-seat-holders, block NEW bookings inside the booking transaction), SUSPEND_PUBLISHING (block create + publish), EMERGENCY_STOP (blocks live start AND join tokens — the immediate-safeguarding procedure), REINSTATE (ends every enforcing row, individually audited); optional `endsAt` expiry evaluated at enforcement time; documented reason mandatory. Filing a complaint NEVER creates a trust action (static tests).
- Appeals: against complaint decisions, review moderation or trust actions with relationship checks; duplicate open appeals 409; 5/day rate limit; `originalDecisionById` captured server-side from the audit trail so a deciding admin cannot be the original decision maker (self-review ban, 403); only the assigned reviewer may decide; OVERTURNED applies documented restorations (review → PUBLISHED + REVIEW_RESTORED; trust action → deactivated + TRUST_REINSTATE; complaint → re-opened UNDER_REVIEW with original events preserved). Appeals never create payments or refunds.
- ADMIN Trust Center at `#/admin/trust` (overview counters, review queues, complaint investigation with filters/full notes, teacher trust actions, appeal adjudication) + student `#/my-reports` (own complaints & appeals with timelines) + public `#/trust-policy` (policy page with the exact safeguarding guidance wording; no invented emergency numbers). Integrations: class detail (quality line, review section, "Report a concern"), My bookings (per-booking report entry), teacher dashboard (Trust & Quality tab), footer (Trust & Safety), Teacher Review view (Trust Center entry).
- Enforcement hooks in Phase 4A/5 routes (additive): class create/publish checks, browse-filter + detail hiding for paused teachers (seat-holders keep access), booking-transaction pause check, live start/token EMERGENCY_STOP checks.
- Tests: 6 new suites — trust-quality 23 (pure rules), free-pilot-protection 9 (static no-payment/no-auto-consequence guards), trust-review-route 19, trust-complaint-route 20, trust-action-route 19, trust-appeal-route 21 — 111 new tests → **349 tests / 28 files passing**.
- Docs: 5 new PHASE6_* docs (trust-quality, review-policy, complaints-and-appeals, safeguarding, security) + PHASE6_RESULTS (executed numbers, browser E2E, honest gaps); README/ARCHITECTURE/DEVELOPMENT/DEVELOPMENT_ROADMAP/DECISIONS updated.

### Security
- Authorization stays server-side end-to-end: ADMIN-guarded trust surfaces (`requireAdmin`), ownership intrinsic to the session identity (foreign complaints get a bare 404, no existence leak), paused-teacher classes return the same 404 as missing ones while owners and seat-holders keep access.
- Same-origin + Zod on every mutation; plain-text-only validation rejects control characters (no HTML is ever stored or rendered — React escaping only); rate limits: reviews 10/day, complaints 10/day, appeals 5/day, flags 20/day (durable 24 h row counts — the flag cap counts append-only audit events).
- Privacy DTO rules enforced by construction (`src/lib/trust-dto.ts`): public reviews never carry identity or complaint data; admin DTOs are the only surfaces with reporter/reviewer identity; complaints never appear in teacher-facing DTOs beyond the anonymous count.

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

## Phase 5 — BEAN Live classroom (2026-11-18)

Branch `feat/bean-live-classroom-phase-5` (from merged main 4dbc4d0). Additive milestone: every Phase 4A surface, route and rule is unchanged.

### Added
- Real live classrooms on LiveKit Cloud behind `#/classroom/:classId` (hash route + `page.tsx` mounting). Teacher starts the room from the class page or teacher dashboard inside the scheduled window (opens 15 min early); confirmed students join while the room is LIVE. Live-only: no recording, egress, transcription or replay anywhere.
- Server-only LiveKit configuration (`src/lib/livekit/config.ts`): `LIVEKIT_WS_URL/HOST_URL/API_KEY/API_SECRET` (placeholders in `.env.example` only), honest configuration status surfaced to the UI (`NOT_CONFIGURED | CONFIGURED | CONNECTION_ERROR | AVAILABLE`), credentials never exposed or logged. The rest of BEAN stays fully usable when unconfigured.
- Additive schema migration `20261118040000_phase5_live_classroom`: `LiveClassSession` (one per class, unique room name, single-use `usageFinalisedAt`), `LiveClassParticipant` (verified per-person connection evidence), `LiveKitWebhookEvent` (idempotency ledger), `LiveUsageMonth` (monthly accounting), `LiveWhiteboardState` (teacher-authored snapshot).
- Live API group: `POST live/start` (owner-only, window + ≥1 booking checks, ATOMIC monthly reservation of `(confirmed+1) × duration` participant-minutes via conditional SQL, opaque room name, `maxParticipants` = confirmed+1 capped, duplicate start safe, failed room creation releases the reservation), `POST live/token` (role re-derived from DB; role-scoped grants; students never get screen share), `GET live/status` (safe public payload, participant COUNT only), `POST live/end` (single-use finalisation: intervals closed, usage reconciled once, room deleted best-effort), `POST live/moderate` (audited mute/remove), `GET/POST live/whiteboard` (teacher-only writes, bounded snapshots), `GET live/attendance` (verified evidence + advisory suggestion).
- Signed webhook endpoint `POST /api/webhooks/livekit`: raw-body-first signature verification (TokenVerifier + sha256 body binding — the same checks as `WebhookReceiver.receive`, with a tolerant JSON parse because the protocol codegen rejects real-world `createdAt` shapes), idempotent processing keyed by provider event id, out-of-order-safe interval accounting, `room_finished` reconciliation (INTERRUPTED + single-use finalise).
- Bookings freeze once a live session exists (checked inside the Phase 4A booking transaction): no seats sold after the room is reserved; cancelled bookings can never (re)join.
- Collaborative whiteboard: teacher-only pen/eraser/colours/size/undo/clear over validated data messages (fixed palette, normalised coords, ≤500 strokes, ≤200 KB), students view-only, late joiners restore from the persisted snapshot + live sync, debounced persistence, high-DPI canvas. Raise hand via data messages. No images, no scripts.
- BEAN-styled classroom UI (no imported conference skin): pre-join screen (opt-in camera preview, mic level test, device list, permission explainer — nothing activates before the user joins), responsive video grid with teacher highlighting, screen-share view, control bar (mic/cam/share/hand/board/participants/leave), participant panel with audited teacher moderation, connection states (CONNECTING/CONNECTED/RECONNECTING/DISCONNECTED/CONNECTION_FAILED/SESSION_ENDED) with honest retry that re-applies previous consent.
- Entry points woven additively: class detail entry card, teacher dashboard Start/Open/Ended control, My Bookings live badges; attendance strip now shows verified live evidence (first joined, last left, connected time, reconnections) with the documented ≥60% attendance SUGGESTION — advisory only, the teacher still confirms/overrides via the Phase 4A endpoint.
- Tests: 7 new suites / 80 tests — total 238 passing (158 pre-existing remain green), including the usage-budget SQL proven against real SQLite and real webhook signature verification.

### Docs
- New: `docs/PHASE5_LIVE_CLASSROOM.md`, `docs/PHASE5_LIVEKIT_SETUP.md`, `docs/PHASE5_SECURITY.md`, `docs/PHASE5_USAGE_BUDGET.md`, `docs/PHASE5_RESULTS.md`. Updated: README, ARCHITECTURE, DEVELOPMENT, DEVELOPMENT_ROADMAP, DECISIONS.

### Security
- `LIVEKIT_API_SECRET` server-only; no response contains it (tested). Participant identity is the opaque `bean:<studentId>` — never an email. Tokens are short-lived, room-specific, with `roomAdmin`/`roomCreate`/`roomRecord` explicitly denied — moderation and room management stay on the BEAN server (audited).
- Usage budget cannot be oversubscribed under concurrent starts (conditional UPDATE re-checked at commit time, proven on real SQLite); reservations release on failure; finalisation is single-use; duplicate webhooks never double-count.
- Same-origin + Zod on every mutation; ownership re-checked server-side on every request; append-only audit for start/end/mute/remove.
