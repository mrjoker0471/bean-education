# Phase 2A — Consolidated Validation Results

Date: 2026-11-18 · Branch: `feat/bean-learn-phase-2a` · All checks below were executed against the running dev server (Next.js 16.1.3, port 3000) after the complete implementation.

## Automated checks

| Check | Command | Result |
|---|---|---|
| TypeScript (app scope) | `bunx tsc --noEmit` | **0 errors in src/** (aux dirs excluded from tsconfig by design; pre-existing errors in dev scripts were fixed or excluded) |
| ESLint (full repo) | `bun run lint` | **clean** (0 problems) |
| Unit tests | `bun test` | **23 pass / 0 fail** across 4 suites (answer-index rule, PYQ normalization/hash/validation, hash-router parsing incl. #/auth, prompt-injection fence incl. breakout resistance) |
| Migration status | `bunx prisma migrate status` | up to date (3 migrations, baseline resolved + 2 applied) |
| Dev log | recent window of `dev.log` | no runtime errors, no failed requests |

## Live API validation (golden paths)

- `GET /` → 200; `GET /api/catalog` → 200 (live catalogue data intact: 77 exams, 9,487 questions).
- `GET /api/materials` → 200; `GET /api/tests/revision-check` → 200.
- Guest guards: `GET /api/student/profile` → 401, `GET /api/student/dashboard` → 401 (guest mode honest).
- PYQ zero state: `GET /api/pyq/batches` → `{ batches: [], count: 0, note: "…zero PYQ records…" }` (honest).
- **Full auth lifecycle (curl, then again via the real UI)**: register → session cookie (httpOnly) → `me` → claim (idempotent zeros for a fresh guest) → profile PATCH (learning level, interests, preferences) → goal create → dashboard aggregate → export (200, attachment) → cross-origin register **403** → account delete `{ok:true}` → `me` → `null`. Database verified empty of test artifacts afterwards (students/sessions/goals = 0).
- Existing surfaces regression: catalogue, materials list, revision check all intact; `tests/start` verified to exclude REJECTED PYQ rows while including VERIFIED/original rows.

## Browser verification (agent-browser, real Chromium)

- Home renders fully (hero, live counters, nav). No console errors, no page errors.
- `#/settings`: Account card shows guest state + "Sign in or create a free account"; Privacy and preference sections unchanged; **On-device AI card live**: WebGPU: no / WASM: yes — real capability detection, no downloads triggered.
- `#/auth`: Sign in / Create account tabs; UI sign-up and sign-in flows exercised; after sign-in Settings shows "Signed in as …" with Save-session-data / Export / Sign out / Delete account controls; Delete-account dialog → guest state restored; DB rows removed.
- Bug found and fixed during browser verification: the auth panel performs its own fetch (store-free by design), so the shell now syncs the session into the store on `onAuthed` before navigating.

## Database state after validation

`Student 0 · Session 0 · StudyGoal 0 · PyqImportBatch 0 · RiisheJob 0 · JobQuota 0` — every E2E artifact cleaned up; the preserved user data (attempts, the analysed CUET document, its Riishe test/questions) untouched.

## Known limitations (honest, none blocking)

1. OCR accuracy on dense/low-quality scans is Tesseract-class; Tamil validation heuristics are Latin-oriented (may under-accept valid Tamil OCR); stored extractions gain OCR only on re-analysis.
2. Durable queue is claim-atomic (CAS) and SQLite-serialised, but per-owner running limits are soft across multiple app processes.
3. Identity: no email verification or password reset (no email service); one session per sign-in; export covers data rows, not uploaded file bytes.
4. PYQ ingestion is a foundation — the bank still contains zero PYQ records until a permission-cleared import happens.
5. On-device AI is detection + consent-gated adapter only; the optional WebLLM runtime is intentionally not installed and nothing downloads without explicit user action.
6. reactStrictMode is now ON: initial double-effect invocation is handled by the store's hydration guard; no double-network issues observed in browser tests.
