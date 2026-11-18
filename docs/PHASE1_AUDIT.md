# Phase 1 Audit — BEAN EXAMS → BEAN LEARN

Date: 2026-11-18 · Scope: full read-only inspection of the existing codebase, runtime and data · Method: three parallel exploration audits (app surface, Riishe pipeline, runtime/config/DB) plus direct verification (dev.log, lint, SQL row counts, git history scan).

Verdict summary: **the platform is a coherent, near-complete guest-first study platform with a working Riishe AI pipeline.** All 26 API endpoints are consumed by the UI; there are no TODO/FIXME markers and no half-wired surfaces. The main gaps are: no authentication, no OCR, no PYQ (historical question) ingestion data, in-process-only job/quota state, and a set of small defects and hygiene issues listed below.

## 1. Runtime health (verified 2026-11-18)

- Dev server: `next dev -p 3000` (Next.js 16.1.3, Turbopack) — running, all logged requests 200.
- `dev.log` (recent window): zero runtime errors, zero failed API calls, zero hydration warnings.
- Noise: Prisma query logging is always on (`src/lib/db.ts` `log:['query']`) — heavy log volume, should be dev-only.

## 2. Application surface

Single-page hash-routed SPA (`src/app/page.tsx`) rendering 15 views via a zustand router:
`#/` `#/catalog` `#/exam/:slug` `#/topic/:id` `#/test/:attemptId` `#/result/:attemptId` `#/bean` `#/progress` `#/pdf/:resourceId` `#/materials` `#/riishe[/:docId]` `#/practice` `#/topics` `#/settings` `#/not-found`.

26 API endpoints (`src/app/api/**`): catalogue/exams/topics reads, test lifecycle (`tests/start`, `tests/revision-check`, `attempts/[id]` GET/PATCH/POST, result), progress, `bean/chat`, account wipe, PDF proxy + resource reads, Riishe library (`materials` CRUD + file + retry), Riishe generation (`generate`, test status/start), Riishe surfaces (`topics`, `weak-topics`, `chat`, attempt `explain`/`explanations`). One dead scaffold: `src/app/api/route.ts` ("Hello, world!").

All calls go through the typed client `src/lib/api.ts`; no component fetches `/api/...` directly. Every endpoint has at least one UI consumer.

## 3. Feature status

| Feature | Status | Evidence |
|---|---|---|
| Exam catalogue, search, exam detail (syllabus tree, honest provenance badges) | WORKING | `api/catalog`, `api/exams*`, `catalog-view.tsx`, `exam-view.tsx` |
| Topic pages (notes, curated resources, siblings) | WORKING | `api/topics/[id]`, `topic-view.tsx` |
| Integrated PDF reader + reading progress + chat handoff | WORKING | `pdf-viewer.tsx`, `api/pdf` (whitelisted, Range-capable) |
| Bank practice tests (topic/subject/exam/template), timed, stage-pattern marking | WORKING | `tests/start/route.ts` (`cfgFromStagePattern`) |
| Revision tests from own mistakes | WORKING | `tests/start` type=REVISION |
| Test runner (timer, autosave, resume, mark-for-review, auto-submit) | WORKING | `test-runner-view.tsx`, `attempts/[id]` |
| Server-authoritative scoring (negative marking, TIMED_OUT, idempotent) | WORKING | `attempts/[id]/route.ts:97–162` |
| Result review + stored bank explanations | WORKING | `attempts/[id]/result`, `result-view.tsx` |
| Progress dashboard + weak topics | WORKING | `api/progress` |
| BEAN Intelligence chat (catalogue-grounded, rate-limited) | WORKING | `api/bean/chat` — but lacks the injection fencing Riishe chat has |
| Riishe upload → extraction → AI topic analysis (honest NEEDS_OCR/FAILED states, partial retry) | WORKING | `api/materials*`, `riishe/pipeline.ts` |
| Riishe workspace (reader, analysis, history, rename/delete/re-analyse) | WORKING | `riishe-view.tsx` |
| AI question generation (validated: programmatic + LLM pass; 1–8 docs, 4–200 Q) | WORKING | `riishe/generate`, `riishe/generate.ts` |
| Riishe practice hub + focus topics | WORKING | `practice-view.tsx` |
| Riishe post-exam explanations (grounded, batched, quota'd) | WORKING (code+routes verified; 0 rows in current DB) | `riishe/explain.ts` |
| Riishe chat (document/hub/per-question scopes, page citations, live web search, persisted turns) | WORKING (0 persisted turns in DB) | `api/riishe/chat` |
| Topics library across uploads | WORKING | `api/riishe/topics` |
| Weak-topic loop (accuracy < 60% → focus generation) | WORKING | `api/riishe/weak-topics` |
| Settings, identity reset, full data wipe | WORKING | `settings-view.tsx`, `api/account` |
| OCR for scanned PDFs | INCOMPLETE (declared honestly; NEEDS_OCR end-to-end) | `riishe/extract.ts` header, `retry/route.ts` 409 |
| Authentication / accounts | ABSENT (guest-only by design; next-auth installed but unused) | `lib/store.ts` |
| Historical PYQ ingestion into the bank | INCOMPLETE — surfaces exist, zero data | `prisma/seed.ts` writes only ORIGINAL; 9,487 bank questions are 100% ORIGINAL |

## 4. Database inventory (direct SQL, 2026-11-18)

`db/custom.db` 12.3 MB, 16 Prisma models. Row counts: Category 10 · Exam 77 · Stage 134 · Subject 226 · Unit 496 · Topic 1,992 · Note 1,801 · Resource 1,476 · Question 9,487 · TestTemplate 263 · Attempt 0 · StudyDocument 1 · RiisheTest 1 · RiisheQuestion 19 · RiisheExplanation 0 · RiisheChatTurn 0.

No `prisma/migrations/` folder — schema is managed by `prisma db push` (script uses `--accept-data-loss`).

## 5. Riishe pipeline stage map

upload/storage (`api/materials`, `db/uploads` 0600, sha256 dedupe, 15 MB, PDF magic) → in-process job runner (`riishe/jobs.ts`, stale recovery, guest slots, hourly quotas) → extraction (`riishe/extract.ts`, pdfjs per-page, 400-page cap, scanned-page detection) → structure detection (`riishe/structure.ts`, TOC/heading validation) → AI section analysis (`riishe/pipeline.ts` + `ai.ts`, backoff, sub-chunking, deterministic fallback) → topic canonicalisation (`riishe/dedupe.ts`, origin-aware, page verification) → question generation (`riishe/generate.ts`, programmatic + LLM validation, publish-only-VALIDATED) → attempts/scoring (shared server engine) → explanations (`riishe/explain.ts`, grounded, verified quotes) → chat (`api/riishe/chat`, TF-IDF retrieval, verified `[SOURCES:*]`, web search) → BEAN chat (`api/bean/chat`, no persistence).

## 6. Defects found (small, real, worth scheduling)

1. Answer-index validation mismatch: submit schema allows 0–5, scoring treats >3 as skipped, but result rendering treats any `>= 0` as answered → out-of-range index renders a wrong answer with undefined option text (`attempts/[id]/route.ts:93`, `result/route.ts:99`).
2. Document DELETE leaves orphaned `RiisheChatTurn` rows (`materials/[id]/route.ts`).
3. Empty-`storedPath` window between row creation and file write → unrecoverable FAILED doc (`materials/route.ts:132–152`).
4. Generation "rejected" stat overcounts (`generate.ts:646/673`).
5. `RiisheQuestion.status=FLAGGED` enum never written by any code path (dead enum).
6. `analysisJson` stores `_parts` duplicates of section text (storage amplification).
7. `/api/bean/chat` does not fence external document excerpts against prompt injection (Riishe chat does).
8. In-memory Maps for jobs/quotas/rate limits: restart wipes them; unsafe for multi-process.
9. `src/lib/db.ts` logs every SQL query unconditionally.
10. `next.config.ts`: `typescript.ignoreBuildErrors: true`, `reactStrictMode: false`; `tsconfig` has `noImplicitAny: false`; ESLint has ~25 rules disabled.
11. Dead weight: `src/app/api/route.ts` scaffold, ~26 unused shadcn/ui components, ~10 unused npm dependencies.
12. No tests/test-runner; verification is via ad-hoc `scripts/e2e-*.ts` (require live dev server).

## 7. Security posture

Good: server-authoritative scoring; answers never sent to client before submit; ownership checks on every Riishe/attempt/file route; uploads stored outside web root (0600); `/api/pdf` is DB-whitelisted (no SSRF); prompt-injection fencing on Riishe surfaces; rate limits and hourly quotas on AI features; `.env` contains only `DATABASE_URL`.

Concerns: identity is a guest UUID carried in query params (no session/rotation/origin binding); all endpoints are public (upload + AI abusable at scale beyond per-guest quotas); `ignoreBuildErrors` masks regressions.

## 8. Git hygiene (fixed during this audit)

Removed from tracking (kept on disk, now ignored): `tool-results/` (~80 agent logs/screenshots), `agent-ctx/`, `upload/` (E2E fixture PDF), `download/`. History was scrubbed of `.env`, `db/custom.db` and `db/uploads/*` (user documents) before any push; see DECISIONS.md ADR-007.

## 9. Recommended Phase 2 entry backlog

1. Fix the defects in section 6 (start with answer-index bound, orphaned chat turns, BEAN chat fencing, db query logging).
2. Delete scaffold endpoint, prune unused components/deps.
3. Decide the PYQ strategy: ingest/classify real historical questions into `Question` with `sourcePaper`/`year`, or hide PYQ surfaces until data exists.
4. Enable `reactStrictMode`; plan removal of `ignoreBuildErrors`/`noImplicitAny`.
5. Introduce Prisma migrations before the next schema change.
6. Design the BEAN LEARN account model (replacing guest-only identity) before Phase 2 profiles.
7. Add a real test runner and CI-relevant checks.
