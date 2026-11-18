# bean-education
An AI-powered learning ecosystem for every student. BEAN Education brings personalised learning, Riishe AI tutoring, deep research, document intelligence, practice, live classes, teacher opportunities, and student collaboration together in one platform.

## Repository

`mrjoker0471/bean-education` — branch `main`. This repository is the automatic source-control and backup destination for every completed development milestone; the development environment pushes verified work automatically (no manual uploads, no repeated authentication).

## Product status

| Area | Status |
|---|---|
| Exam catalogue + bank practice/revision tests, progress | Working (guest mode) |
| Riishe document intelligence (upload → analysis → AI tests → explanations → chat) | Working |
| Historical PYQ ingestion | Surfaces ready, ingestion pending |
| BEAN Teach (teachers, classes, pilots) | Phase 4 (planned) |
| Live classroom | Phase 5 (planned) |
| Payments (Razorpay) | Final milestone only — intentionally absent |

## Documentation

- docs/ARCHITECTURE.md — system and data-model overview
- docs/DEVELOPMENT.md — setup, verification, conventions
- docs/DEVELOPMENT_ROADMAP.md — BEAN LEARN phase plan
- docs/PHASE1_AUDIT.md — current working/incomplete/broken inventory
- docs/DECISIONS.md — decision log (auth, data, git history, etc.)
- CHANGELOG.md — notable changes

## Quick start

```bash
bun install
cp .env.example .env
bun run db:push && bun run db:seed
bun run dev
```

## Protected paths (never commit)

`.env*` (except `.env.example`), `*.db`/`*.sqlite*`, `/db/` (local database + user uploads), `/upload/`, `/download/`, `/tool-results/`, `/agent-ctx/`, logs, `node_modules`, build output.
