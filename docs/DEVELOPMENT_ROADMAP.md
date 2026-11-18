# BEAN Education — Development Roadmap (BEAN LEARN)

Milestone-by-milestone plan. Each phase: inspect → plan → implement approved scope → test → review diff → report → commit/push. Payment integration is explicitly the FINAL milestone.

## Phase 1 — Audit and preserve (COMPLETE 2026-11-18)

- Full read-only audit completed: see docs/PHASE1_AUDIT.md.
- All existing Riishe functionality preserved; no application code changed during setup.
- Git repository connected, history scrubbed of secrets/private files, pushed to GitHub (see DECISIONS ADR-007/008).
- Phase 1.5 hygiene backlog identified (defect list in audit §6, entry backlog §9) — to be scheduled at the start of Phase 2.

## Phase 2 — Universal student platform

**Phase 2A (COMPLETE 2026-11-18):** reliability fixes, durable jobs/quotas, migration baseline, student identity (auth, guest claiming, export/deletion), PYQ ingestion foundation, OCR, dashboard data model, local-AI foundations. See docs/PHASE2A_*.md.

**Phase 2B (COMPLETE 2026-11-18):** student experience layer — PYQ curator role system (STUDENT/PYQ_CURATOR/ADMIN, operator CLI, review audit trail), onboarding wizard, personal dashboard, My Learning workspace, goals & planning, PYQ curation studio (import/review/history with provenance). See docs/PHASE2B_*.md.

- Student profiles, learning levels, subjects; personal library; learning dashboard; study planner; progress.
- No predefined exam catalogue as the primary experience; students upload and organise their own materials.
- Entry tasks from Phase 1 audit backlog: fix the 12 recorded defects, prune dead code/deps, tighten TS/ESLint config, introduce Prisma migrations, add test runner, design the account model replacing guest-only identity.

## Phase 3 — Riishe intelligence extensions

- Document understanding (current) extended with: web research, historical question discovery, source verification, personal tutoring, question generation (current), answer evaluation (current), mistake intelligence, revision planning, assignment/project guidance, multilingual explanations.
- Clear separation of VERIFIED historical questions vs AI-generated questions in all surfaces (data model already supports sourceType PYQ_VERIFIED/PYQ_UNVERIFIED; ingestion pipeline to be built).

## Phase 4 — BEAN Teach (teacher marketplace)

**Phase 4A (COMPLETE 2026-11-18):** marketplace foundation shipped on branch `feat/bean-teach-marketplace` — teacher application lifecycle + admin review queue (teacher capability is an APPROVED `TeacherProfile`, not a new role), teacher dashboard (public profile, class creation/publish/unpublish/cancel, attendance marking after class end), student marketplace (`#/classes` discovery with filters + free reservations with atomic seat claiming + My bookings), append-only `TeachAuditEvent` trail. Free pilot only: the planned price is stored as metadata and never charged; no payments exist. Results and evidence: docs/BEAN_TEACH_RESULTS.md; guide: docs/BEAN_TEACH_IMPLEMENTATION.md.

**Phase 4B candidates (not scheduled):** remaining Phase 4 refinements — quality/reviews/attendance improvements (verified reviews and teacher quality indicators otherwise remain Phase 6). The live classroom is Phase 5, not 4B. The bullets below describe the full phase scope; 4A covered the marketplace foundation only.

- Teacher registration, profile, identity/qualification verification workflows.
- Teaching subjects, class creation (duration, price metadata, capacity, minimum enrolment), scheduling, student discovery.
- Free pilot reservations, booking history, teacher dashboard.
- ALL initial classes free pilots; no payments collected.

## Phase 5 — Live classroom

- Video service integration within a small dev/test allowance.
- Secure classroom access, teacher/student controls, audio/video, screen share, whiteboard, attendance, session completion, connection-failure handling.
- Hard usage caps tied to the free allowance.

## Phase 6 — Trust and quality

- Verified reviews, teacher quality indicators, complaints, teacher responses, admin investigations, appeals, published refund policies, safeguarding.
- A negative review never automatically triggers a refund.

## Phase 7 — Institution and career features

- School, college, coaching-centre, professional-course and skill-learning workflows.

## Phase 8 — Final monetisation (ONLY after product validation)

- Razorpay one-time payments, subscriptions, Route, teacher commission/payouts (proposed 20% BEAN / 80% teacher — subject to final business terms), refunds, financial ledger, webhook processing, reconciliation, admin payment settings.
- Nothing Razorpay-related before this phase: no API integrations, credential forms, endpoints, orders, charges, transfers, refunds or webhooks.
