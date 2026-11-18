# BEAN Education — Architecture

## Product shape

BEAN LEARN is one modular Next.js application (no microservices). Riishe is the shared AI engine (document intelligence, tutoring, generation, evaluation). BEAN LEARN serves ALL students — school, college, university, CA/CMA/CS, competitive exams, skill and career learners — not only government-exam candidates. BEAN Teach (teacher marketplace, live classes) will be added as clearly separated domains inside the same application from Phase 4.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack dev), React 19, TypeScript 5 |
| UI | Tailwind CSS 4 + shadcn/ui (New York), Lucide icons; obsidian + champagne-gold design system |
| State | zustand (hash router + guest identity + auth session + settings); typed API client in `src/lib/api.ts` |
| Data | Prisma 6 + SQLite (`db/custom.db`, runtime artifact, git-ignored); **migrations since Phase 2A** (`prisma/migrations/`) |
| AI | `z-ai-web-dev-sdk`, server-only (`ZAI.create()`), never imported client-side |
| Runtime | Bun (dev server `bun run dev`, port 3000) |

## Frontend architecture

The app is a hash-routed SPA: a single `src/app/page.tsx` renders views from `#/`-style routes via a zustand store. Views live in `src/components/bean/views/*`:

- **Guest + shared**: catalogue, exam, topic, test runner, result, progress, PDF reader, materials, Riishe workspace, practice, topics, BEAN Intelligence, settings, auth.
- **Student (Phase 2B)**: `#/onboarding` (5-step skippable wizard, re-openable as `?edit=1` profile editor), `#/dashboard` (personal home: continue-learning, progress, goals, deterministic recommendations), `#/workspace` (My Learning: library/subjects/search/organise over the existing materials + Riishe pipeline), `#/goals` (CRUD + deterministic plan hints).
- **Curator (Phase 2B)**: `#/pyq-studio` (Import / Review queue / History) — role-gated in UI, enforced server-side.
- **Marketplace (Phase 4A)**: `#/classes` + `#/classes/:id` (guest AND student class discovery/detail), `#/teach/apply` (application), `#/teach/dashboard` (approved-teacher workspace), `#/teach/review` (admin application review).

Auth routing: sign-up → onboarding; sign-in → onboarding when `onboardedAt` is null, else dashboard. The header switches nav sets by role (guests keep their original nav plus the Classes entry; PYQ Studio appears for curators, Teacher Review for admins — hiding in the UI is never the enforcement).

## Backend architecture

54 route files (68 handler functions) under `src/app/api/**` — 14 of those files (19 handlers) are the Phase 4A teach/admin-teach endpoints. Conventions:

- Ownership scoping is dual-identity: rows carry BOTH `guestId` and (since 2A) optional `studentId`; `resolveOwnerScope()` + `ownedBy()` build the OR-scope. Signed-in students claim device data via `POST /api/auth/claim-guest` (never rewriting guest identity).
- **Identity & sessions** (`src/lib/auth.ts`, ADR-010/014): scrypt password hashing; random 256-bit tokens live only in an httpOnly SameSite=Lax cookie; the DB stores SHA-256 hashes; 30-day sliding expiry. `AuthStudent` carries `role` + `onboardedAt`.
- **Roles** (`src/lib/roles.ts`, Phase 2B): STUDENT (default) / PYQ_CURATOR / ADMIN. Pure decision functions (`hasRole`, `roleDenial` — 401 when signed out, 403 when signed in without the role) + `requirePyqCurator()` guard used by all four PYQ endpoints. No API can raise a role; promotion is operator-CLI only (`scripts/grant-role.ts`).
- DTOs in `src/lib/types.ts`; serializers in `src/lib/serialize.ts`.
- Test engine is server-authoritative: questions served without `correctIndex`; scoring, negative marking, TIMED_OUT auto-submit and idempotent submission server-side.
- Files never touch `public/`: uploads live in `db/uploads/` (mode 0600), streamed owner-only with Range support. `/api/pdf` proxies external PDFs strictly against a DB whitelist.

## BEAN Teach (Phase 4A)

The teacher marketplace is a free pilot: no orders, payments, wallets or commission exist anywhere; `plannedPricePaise` is stored as metadata for a future milestone (Phase 8) and never charged.

- **Teacher capability is an APPROVED `TeacherProfile`, not a role** — the single `Student.role` field (STUDENT | PYQ_CURATOR | ADMIN) is untouched, and the profile is resolved server-side by the `requireApprovedTeacher()` guard in `src/lib/teach.ts`. Identity always comes from the httpOnly session cookie; client-supplied ids are never trusted for ownership. Guards: `requireSignedIn` / `requireAdmin` / `requireApprovedTeacher`.
- **Four endpoint groups**: application lifecycle (`/api/teach/application` GET/POST/PATCH), public discovery (`/api/teach/classes`, `/api/teach/teachers` + detail), classes & booking (`/api/teach/classes/:id` GET/PATCH, publish/unpublish/cancel/book/attendance, `/api/teach/my-classes`, `/api/teach/my-bookings`), admin review (`/api/admin/teach/applications` + `/:id/review`).
- **Transactional seat-claim engine** (`src/lib/teach-booking.ts`): `bookedCount` is incremented/decremented by ONE conditional SQL `UPDATE … WHERE bookedCount < capacity` inside the booking transaction. Prisma cannot compare two columns in a WHERE clause on SQLite; SQLite serialises writes, so a losing racer's predicate matches zero rows and no booking is created. The `startsAt`/time guards bind **epoch-millisecond integers** because Prisma 6 stores SQLite DateTime columns as INTEGER — an ISO string would silently never match. The SQL constants are exported and executed verbatim by tests against a real in-memory SQLite engine.
- **Unified append-only `TeachAuditEvent`** — one audit table for the whole domain (teacher review, class cancellation, attendance marking), polymorphic `entityType`/`entityId` BY DESIGN (`entityId` is a plain string, no FK on purpose). Rows are never updated or deleted; a re-review appends, so earlier decisions remain provable.

## Riishe engine (`src/lib/riishe/`)

Pipeline stages (honest-failure aware): upload validation → **durable job runner** (`jobs.ts` on RiisheJob/JobQuota tables: atomic CAS claims, lease recovery, bounded retries, durable hourly quotas — replaced the in-process Maps of Phase 1) → PDF extraction (per-page text, scanned-page detection, 400-page cap) → **OCR** (`ocr.ts`: Tesseract + pdftoppm for scanned pages, English/Tamil, per-page provenance, honest OCR_FAILED) → deterministic structure detection → AI section analysis (JSON-tolerant chat, injection fencing, 429 backoff, sub-chunking, deterministic fallback) → origin-aware topic canonicalisation → question generation (only VALIDATED questions publish) → grounded explanations → chat (TF-IDF retrieval, server-verified citations, persisted turns).

## Data model (28 models, Prisma/SQLite, migration-managed)

- Catalogue: `Category → Exam → Stage → Subject → Unit → Topic` (cascade), `Note`, `Resource` per topic.
- Bank: `Question` (sourceType ORIGINAL | PYQ_VERIFIED | PYQ_UNVERIFIED; provenance: `pyqHash`, `sourceRef`, `importedBatchId`, `reviewedBy/At/Note`), `TestTemplate`.
- Activity: `Attempt` (BANK | RIISHE, dual guest/student ownership, server-scored).
- Riishe: `StudyDocument`, `RiisheTest`, `RiisheQuestion`, `RiisheExplanation`, `RiisheChatTurn` (all dual-owner), `RiisheJob`, `JobQuota`.
- Student identity (2A) + roles (2B): `Student` (scrypt hash, `role` default STUDENT, `onboardedAt`), `Session` (hashed tokens), `StudyGoal`.
- PYQ curation: `PyqImportBatch` (audit trail, curator `importedBy`), `PyqReviewEvent` (2B, append-only: reviewer, role held, action, justification, timestamp).
- BEAN Teach (4A): `TeacherProfile` (one per Student; PENDING → APPROVED | REJECTED; re-review on verification-relevant edits), `ClassSession` (DRAFT → PUBLISHED → CANCELLED | COMPLETED; `bookedCount` maintained only transactionally), `ClassBooking` (one per student per class — rebooking re-activates the same row), `TeachAuditEvent` (append-only, polymorphic). `Student` gains back-relations `teacherProfile` + `classBookings`.
- Live classroom (5): `LiveClassSession` (one per ClassSession; READY/LIVE/ENDED/INTERRUPTED/FAILED; single-use `usageFinalisedAt`), `LiveClassParticipant` (webhook-verified connection intervals, unique identity per session), `LiveKitWebhookEvent` (idempotency ledger, unique provider event id), `LiveUsageMonth` (monthly budget accounting, unique monthKey), `LiveWhiteboardState` (one snapshot per live session).

Schema changes go through additive migrations only: `bun run db:backup` → edit schema → `bun run db:migrate` → `bun run db:status`. Never edit applied migrations; never reset the live DB (docs/PHASE2A_DATABASE_MIGRATIONS.md).

## Known architectural constraints

- Single-node SQLite: job claims, quotas AND class-seat accounting are correct for one writer; transactions serialise and the conditional seat-claim UPDATE is the correctness mechanism; multi-process soft limits are documented in PHASE2A docs.
- BEAN Teach is a free pilot: the planned price is metadata only and nothing in the schema or code can create a charge (ADR-019); the live classroom is live-only — no recording/egress exists in schema or code (ADR-020), and classrooms require LiveKit Cloud credentials (honest NOT_CONFIGURED state otherwise).
- No email service: password reset / email verification remain unavailable (guest mode and scrypt auth unaffected); BEAN Teach has no notifications either — students discover cancellations via My bookings.
- PYQ imports require a catalogue `examSlug` (hard FK) — college/university semester papers are not representable yet; surfaced honestly in the studio (docs/PHASE2B_PYQ_CURATOR.md).
- On-device AI is foundation-scoped: capability detection + consent-gated adapter; the optional runtime is not shipped (docs/PHASE2A_AI_RUNTIME.md).
- Production build should be re-verified in CI/staging (docs/PHASE2B_RESULTS.md § Static checks).

## BEAN Live Classroom (Phase 5)

Realtime class delivery on LiveKit Cloud, additive on top of Phase 4A. BEAN owns identity, authorisation, scheduling, usage budgeting, attendance evidence and audit; LiveKit carries media (WebRTC to its edge — media never transits BEAN).

- **Server-only config** (`src/lib/livekit/config.ts`): credentials read from env at call time; `LIVEKIT_API_SECRET` never reaches the browser or logs; honest `NOT_CONFIGURED` status when absent (the rest of BEAN is unaffected).
- **One `LiveClassSession` per `ClassSession`** (unique FK) with states READY → LIVE → ENDED | INTERRUPTED | FAILED. Start validates ownership, PUBLISHED status, the scheduled window (opens 15 min before `startsAt`) and ≥1 confirmed booking, then **atomically reserves `(confirmed + 1) × duration` participant-minutes** against `LiveUsageMonth` with ONE conditional SQL UPDATE (same pattern as the seat engine — SQLite serialises writes, concurrent starts cannot oversubscribe). Room names are server-generated opaque ids. Duplicate start returns the existing LIVE session; failed room creation releases the reservation; a FAILED session reuses the row on retry; ENDED never restarts. Bookings freeze once a live row exists (checked inside the booking transaction).
- **Tokens** (`POST live/token`): role re-derived from DB state per request; JWT minted server-side with grants scoped by role (`canPublishSources` camera+microphone[+screen_share for teachers]; `roomAdmin`/`roomCreate`/`roomRecord` explicitly false). Identity is the opaque `bean:<studentId>`.
- **Webhook** (`POST /api/webhooks/livekit`): raw body read before parsing; signature verified via `TokenVerifier` + SHA-256 body binding (`src/lib/livekit/webhook-verify.ts` — the same checks as `WebhookReceiver.receive`, with a tolerant JSON parse because `@livekit/protocol`'s generated decoder rejects every real-world `createdAt` shape); idempotent by unique `providerEventId`; interval accounting clamps out-of-order events so negative durations are impossible; `room_finished` finalises usage exactly once (INTERRUPTED).
- **End** (`POST live/end`): transactional single-use finalisation guarded by `usageFinalisedAt` — intervals closed conservatively, verified actual minutes recorded once, reservation released once; `deleteRoom` best-effort afterwards.
- **Whiteboard** (`src/lib/livekit/whiteboard.ts`): versioned zod protocol (fixed palette, normalised coords 0..1, ≤1000 points/stroke, ≤500 strokes, ≤200 KB) over LiveKit reliable data messages; mutations accepted only from TEACHER-metadata participants; persisted snapshots teacher-only via API with server re-validation; late joiners restore from snapshot + `request-sync`.
- **Attendance evidence**: `LiveClassParticipant` rows are written ONLY by signed webhook processing; the owner-facing evidence endpoint adds a documented advisory suggestion (≥60% connected → ATTENDED, 30 s–60% → NO_SHOW) — the teacher always confirms or overrides via the unchanged Phase 4A endpoints.
- **Free-pilot caps** (BEAN product decisions, not provider quotas): `BEAN_LIVEKIT_MONTHLY_BUDGET_MINUTES=4000`, `BEAN_LIVEKIT_MAX_CONCURRENT_PARTICIPANTS=80`, `BEAN_LIVEKIT_MAX_ROOM_PARTICIPANTS=51` — all env-configurable; availability is always `budget − reserved − used`; overtime overruns reduce availability honestly (ADR-021).
