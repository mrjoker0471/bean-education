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

Auth routing: sign-up → onboarding; sign-in → onboarding when `onboardedAt` is null, else dashboard. The header switches nav sets by role (guests keep the original nav; PYQ Studio appears for curators).

## Backend architecture

33 route handlers under `src/app/api/**`. Conventions:

- Ownership scoping is dual-identity: rows carry BOTH `guestId` and (since 2A) optional `studentId`; `resolveOwnerScope()` + `ownedBy()` build the OR-scope. Signed-in students claim device data via `POST /api/auth/claim-guest` (never rewriting guest identity).
- **Identity & sessions** (`src/lib/auth.ts`, ADR-010/014): scrypt password hashing; random 256-bit tokens live only in an httpOnly SameSite=Lax cookie; the DB stores SHA-256 hashes; 30-day sliding expiry. `AuthStudent` carries `role` + `onboardedAt`.
- **Roles** (`src/lib/roles.ts`, Phase 2B): STUDENT (default) / PYQ_CURATOR / ADMIN. Pure decision functions (`hasRole`, `roleDenial` — 401 when signed out, 403 when signed in without the role) + `requirePyqCurator()` guard used by all four PYQ endpoints. No API can raise a role; promotion is operator-CLI only (`scripts/grant-role.ts`).
- DTOs in `src/lib/types.ts`; serializers in `src/lib/serialize.ts`.
- Test engine is server-authoritative: questions served without `correctIndex`; scoring, negative marking, TIMED_OUT auto-submit and idempotent submission server-side.
- Files never touch `public/`: uploads live in `db/uploads/` (mode 0600), streamed owner-only with Range support. `/api/pdf` proxies external PDFs strictly against a DB whitelist.

## Riishe engine (`src/lib/riishe/`)

Pipeline stages (honest-failure aware): upload validation → **durable job runner** (`jobs.ts` on RiisheJob/JobQuota tables: atomic CAS claims, lease recovery, bounded retries, durable hourly quotas — replaced the in-process Maps of Phase 1) → PDF extraction (per-page text, scanned-page detection, 400-page cap) → **OCR** (`ocr.ts`: Tesseract + pdftoppm for scanned pages, English/Tamil, per-page provenance, honest OCR_FAILED) → deterministic structure detection → AI section analysis (JSON-tolerant chat, injection fencing, 429 backoff, sub-chunking, deterministic fallback) → origin-aware topic canonicalisation → question generation (only VALIDATED questions publish) → grounded explanations → chat (TF-IDF retrieval, server-verified citations, persisted turns).

## Data model (19 models, Prisma/SQLite, migration-managed)

- Catalogue: `Category → Exam → Stage → Subject → Unit → Topic` (cascade), `Note`, `Resource` per topic.
- Bank: `Question` (sourceType ORIGINAL | PYQ_VERIFIED | PYQ_UNVERIFIED; provenance: `pyqHash`, `sourceRef`, `importedBatchId`, `reviewedBy/At/Note`), `TestTemplate`.
- Activity: `Attempt` (BANK | RIISHE, dual guest/student ownership, server-scored).
- Riishe: `StudyDocument`, `RiisheTest`, `RiisheQuestion`, `RiisheExplanation`, `RiisheChatTurn` (all dual-owner), `RiisheJob`, `JobQuota`.
- Student identity (2A) + roles (2B): `Student` (scrypt hash, `role` default STUDENT, `onboardedAt`), `Session` (hashed tokens), `StudyGoal`.
- PYQ curation: `PyqImportBatch` (audit trail, curator `importedBy`), `PyqReviewEvent` (2B, append-only: reviewer, role held, action, justification, timestamp).

Schema changes go through additive migrations only: `bun run db:backup` → edit schema → `bun run db:migrate` → `bun run db:status`. Never edit applied migrations; never reset the live DB (docs/PHASE2A_DATABASE_MIGRATIONS.md).

## Known architectural constraints

- Single-node SQLite: job claims and quotas are correct for one writer; multi-process soft limits are documented in PHASE2A docs.
- PYQ imports require a catalogue `examSlug` (hard FK) — college/university semester papers are not representable yet; surfaced honestly in the studio (docs/PHASE2B_PYQ_CURATOR.md).
- No email service: password reset / email verification remain unavailable (guest mode and scrypt auth unaffected).
- On-device AI is foundation-scoped: capability detection + consent-gated adapter; the optional runtime is not shipped (docs/PHASE2A_AI_RUNTIME.md).
- Production build should be re-verified in CI/staging (docs/PHASE2B_RESULTS.md § Static checks).
