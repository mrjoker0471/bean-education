# bean-education
An AI-powered learning ecosystem for every student. BEAN Education brings personalised learning, Riishe AI tutoring, deep research, document intelligence, practice, live classes, teacher opportunities, and student collaboration together in one platform.

## Repository

`mrjoker0471/bean-education` — branch `main`. This repository is the automatic source-control and backup destination for every completed development milestone; the development environment pushes verified work automatically (no manual uploads, no repeated authentication).

## Product status

| Area | Status |
|---|---|
| Exam catalogue + bank practice/revision tests, progress | Working (guest mode) |
| Riishe document intelligence (upload → analysis → AI tests → explanations → chat) | Working (+ real OCR for scanned pages, English/Tamil) |
| Student accounts (email/password, guest migration, export, deletion) | Working (Phase 2A) |
| Onboarding, learning profile, student dashboard, My Learning workspace, goals & planning | Working (Phase 2B) |
| Roles (STUDENT / PYQ_CURATOR / ADMIN) + PYQ curation studio (import → review → verified, provenance, audit trail) | Working (Phase 2B; bank honestly zero-PYQ until a reviewed import) |
| Durable AI job queue + hourly quotas | Working (Phase 2A) |
| PYQ ingestion rules (validation, dedupe, review gating) | Working (Phase 2A foundation, curator-gated in 2B) |
| On-device AI (browser inference) | Capability detection + consent-gated adapter (foundation) |
| BEAN Teach — teacher marketplace foundation (apply → admin approval → classes → free bookings) | Working (Phase 4A, merged; free pilot — planned price is metadata only, no payments) |
| Live classroom — real LiveKit rooms behind `#/classroom/:id` (auth, tokens, whiteboard, verified attendance, usage budget) | Working on branch `feat/bean-live-classroom-phase-5` (Phase 5; live-only, never recorded; needs LiveKit Cloud credentials — see docs/PHASE5_LIVEKIT_SETUP.md) |
| Payments (Razorpay) | Final milestone only — intentionally absent |

## Documentation

- docs/ARCHITECTURE.md — system and data-model overview
- docs/DEVELOPMENT.md — setup, verification, conventions
- docs/DEVELOPMENT_ROADMAP.md — BEAN LEARN phase plan
- docs/PHASE1_AUDIT.md — current working/incomplete/broken inventory
- docs/PHASE2B_IMPLEMENTATION.md — what Phase 2B built, file by file
- docs/PHASE2B_RESULTS.md — executed test/verification numbers (82 unit tests, 37/37 API E2E, browser E2E)
- docs/PHASE2B_SECURITY.md — role model, provisioning & recovery procedures
- docs/PHASE2B_PYQ_CURATOR.md — curator handbook (import format, review workflow, limitations)
- docs/BEAN_TEACH_IMPLEMENTATION.md — teacher marketplace guide (flows, state machines, API)
- docs/BEAN_TEACH_DATABASE.md — the 4 new models, migration & baselining, seat-count invariants
- docs/BEAN_TEACH_SECURITY.md — authorization model, endpoint matrix, privacy & abuse controls
- docs/BEAN_TEACH_RESULTS.md — executed test/verification numbers (158 unit tests, live-server race evidence, browser E2E)
- docs/PHASE5_LIVE_CLASSROOM.md — live classroom guide (lifecycle, tokens, whiteboard protocol, reconnection)
- docs/PHASE5_LIVEKIT_SETUP.md — how the owner enables LiveKit Cloud (env vars, webhook, troubleshooting)
- docs/PHASE5_SECURITY.md — token grants, webhook verification, privacy, no-recording policy
- docs/PHASE5_USAGE_BUDGET.md — the free-pilot participant-minute budget and its atomic enforcement
- docs/PHASE5_RESULTS.md — executed test/verification numbers (238 unit tests, browser E2E, honest gaps)
- docs/DECISIONS.md — decision log (auth, data, git history, etc.)
- CHANGELOG.md — notable changes

## Quick start

```bash
bun install
cp .env.example .env
bun run db:deploy && bun run db:seed
bun run dev
bun test          # unit tests
```

Before any schema change: `bun run db:backup` first (see docs/PHASE2A_DATABASE_MIGRATIONS.md).

## Protected paths (never commit)

`.env*` (except `.env.example`), `*.db`/`*.sqlite*`, `/db/` (local database + user uploads), `/upload/`, `/download/`, `/tool-results/`, `/agent-ctx/`, logs, `node_modules`, build output.
