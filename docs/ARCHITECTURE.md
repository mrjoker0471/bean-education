# BEAN Education — Architecture

## Product shape

BEAN LEARN is one modular Next.js application (no microservices). Riishe is the shared AI engine (document intelligence, tutoring, generation, evaluation). BEAN Teach (teacher marketplace, live classes) will be added as clearly separated domains inside the same application from Phase 4.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack dev), React 19, TypeScript 5 |
| UI | Tailwind CSS 4 + shadcn/ui (New York), Lucide icons |
| State | zustand (hash router + guest identity + settings); typed API client in `src/lib/api.ts` |
| Data | Prisma 6 + SQLite (`db/custom.db`, runtime artifact, git-ignored) |
| AI | `z-ai-web-dev-sdk`, server-only (`ZAI.create()`), never imported client-side |
| Runtime | Bun (dev server `bun run dev`, port 3000) |

## Frontend architecture

The app is a hash-routed SPA: a single `src/app/page.tsx` renders 15 views from `#/`-style routes via a zustand store. Views live in `src/components/bean/*` (catalogue, exam, topic, test runner, result, progress, PDF reader, Riishe workspace, practice, topics, settings). PDF reading progress is persisted in localStorage (`reading-progress.ts`).

## Backend architecture

26 route handlers under `src/app/api/**`. Conventions:

- All requests pass a `guestId` (UUIDv4, localStorage-backed) for ownership scoping. This is the current identity model (see DECISIONS ADR-002).
- DTOs are defined in `src/lib/types.ts`; serializers in `src/lib/serialize.ts`.
- Test engine is server-authoritative: questions are served without `correctIndex`; scoring, negative marking, TIMED_OUT auto-submit and idempotent submission happen server-side in `attempts/[id]/route.ts`.
- Files never touch `public/`: uploads live in `db/uploads/` (mode 0600) and are streamed owner-only with Range support. `/api/pdf` proxies external PDFs strictly against a DB whitelist.

## Riishe engine (`src/lib/riishe/`)

Pipeline stages (all honest-failure aware): upload validation → in-process job runner (`jobs.ts`: FIFO per guest, stale recovery, hourly quotas) → PDF extraction (`extract.ts`, per-page text, scanned-page detection, 400-page cap) → deterministic structure detection (`structure.ts`: TOC, headings, printed-page offsets, question-paper layouts) → AI section analysis (`pipeline.ts` + `ai.ts`: JSON-tolerant chat, injection fencing, 429 backoff, sub-chunking, deterministic fallback) → origin-aware topic canonicalisation (`dedupe.ts`, word-boundary page verification) → question generation (`generate.ts`: programmatic + LLM validation; only VALIDATED questions publish; multi-doc support) → grounded explanations (`explain.ts`: verbatim-quote verification, fabrication downgrade) → chat (`api/riishe/chat`: TF-IDF retrieval, server-verified citations, live web search for time-sensitive questions, persisted turns).

## Data model (16 models, Prisma/SQLite)

Catalogue: `Category → Exam → Stage → Subject → Unit → Topic` (cascade), with `Note` and `Resource` per topic. Bank: `Question` (sourceType ORIGINAL | PYQ_VERIFIED | PYQ_UNVERIFIED, provenance fields) and `TestTemplate`. Activity: `Attempt` (source BANK | RIISHE, guest-scoped, server-scored). Riishe: `StudyDocument` (status QUEUED→EXTRACTING→ANALYSING→READY/NEEDS_OCR/FAILED, contentHash dedupe), `RiisheTest`, `RiisheQuestion` (page refs + evidence), `RiisheExplanation`, `RiisheChatTurn`.

Schema changes are currently applied with `prisma db push` (no migrations folder yet — see roadmap).

## Known architectural constraints

- Job/quota/rate-limit state is in-memory (module-level Maps): single-process assumption; restart resets quotas; stale jobs are recovered and marked FAILED with manual retry.
- No OCR: scanned PDFs land in NEEDS_OCR and are honestly reported (never silently mis-analysed).
- BEAN chat has no persistence and (unlike Riishe chat) no prompt-injection fencing yet.
- See docs/PHASE1_AUDIT.md for the full defect list with file references.
