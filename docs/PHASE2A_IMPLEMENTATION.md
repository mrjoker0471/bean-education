# Phase 2A — Implementation Record

Branch: `feat/bean-learn-phase-2a` · Baseline: `main` at `1171d27284e7c2384b01b11941866a0a20186db6` (verified local == remote before work began) · Implementation order followed the mandated sequence 1→12.

## 1. Scope delivered

| Milestone (mandated order) | Delivered |
|---|---|
| 1. Safe branch + data preservation | Branch `feat/bean-learn-phase-2a`; DB backup `db/backups/pre-phase2a-20261118-011709.db`; README + Phase 1 docs untouched and preserved |
| 2. Answer correctness + document lifecycle | Canonical `isValidAnswerIndex` (per-question option count) enforced in scoring, autosave, attempt GET, result DTO and explanations; file-first upload, compensating cleanup, orphan sweep, transactional document delete incl. chat turns + job cancellation |
| 3. BEAN chat injection + generation accounting | Same fence as Riishe chat on notes and external-document excerpts; exact generated/validated/flagged/rejected accounting (no batch-size estimates) |
| 4. Persist jobs + quotas | `RiisheJob` + `JobQuota` tables; CAS claims; lease heartbeat + recovery; bounded retries; per-owner running/pending limits; durable hourly quotas with release on failure/cancel; cancellation for queued jobs |
| 5. Migrations | Baseline + 2 incremental migrations (see docs/PHASE2A_DATABASE_MIGRATIONS.md); `--accept-data-loss` removed from db:push; backup/verify/status scripts added |
| 6. Student identity + guest migration | scrypt passwords, SHA-256-hashed session tokens, httpOnly cookies, register/login/logout/me, guest-data claim, JSON export, transactional account delete, #/auth view, settings account card; guest mode unchanged |
| 7. PYQ ingestion | Structured import (≤500 rows/batch) with provenance + normalized-content-hash duplicate detection; always PYQ_UNVERIFIED; review workflow (APPROVE needs written justification → PYQ_VERIFIED; REJECT excluded from tests); batch audit trail; CLI script |
| 8. OCR | Tesseract 5.5 + pdftoppm integration (eng + tam), 60 pages/doc bound, 150 DPI, sequential, per-page 60 s timeout, per-page honest outcomes + provenance; availability-aware messaging |
| 9. Student dashboard/profile foundations | Profile GET/PATCH (learning level, interests, preferences), goals CRUD (50 cap), dashboard aggregate over student-owned rows with honest zeros |
| 10. Browser inference foundation | Capability detection (WebGPU/WASM/memory/cores/storage), consent-gated WebLLM adapter (dynamic, no automatic downloads), settings card; server AI unchanged and default |
| 11. Documentation | This doc + DATABASE_MIGRATIONS + RESULTS + the four foundation docs (IDENTITY, PYQ_INGESTION, OCR, AI_RUNTIME); README/CHANGELOG/DECISIONS/DEVELOPMENT updated |
| 12. Consolidated validation | See docs/PHASE2A_RESULTS.md |

## 2. Key design decisions

- **Answer validity**: one rule (`src/lib/answer-index.ts`), used everywhere; the transport schema keeps a loose 0..5 sanity bound while the server enforces the real per-question range. Invalid ⇒ skipped, never a wrong answer with undefined option text.
- **Upload ordering**: file written first (UUID id, mode 0600), row created second with the final `storedPath` already set — the empty-storedPath failure window is gone; row-write failure unlinks the file; a lazy sweep removes >1 h orphan files.
- **FLAGGED workflow**: questions that pass programmatic checks but are doubted by the LLM validator are retained (`status FLAGGED`, validator note) and never published (`questionIdsJson` contains only VALIDATED rows) — review/audit data instead of silent deletion; the dead enum now has real semantics.
- **`_parts` storage**: COMPLETE analyses are persisted without the internal per-section retry state (and legacy rows are lazily cleaned on read); PARTIAL analyses keep it because partial retries still need it. No analysed content is ever removed.
- **Durable queue**: one row per `(kind, refId)` — recovery can never double-generate; claims are atomic conditional UPDATEs (CAS), safe under SQLite single-writer serialisation; RUNNING jobs heartbeat a 12-min lease; expired leases requeue (bounded by maxAttempts) or FAIL honestly and reconcile the domain row. Clean in-task failures still surface to the user exactly as before. Honest scope: single-node SQLite concurrency-safe; true multi-process owner-limit enforcement is soft (claim atomicity is hard).
- **Identity**: additive `studentId` columns; ownership = guestId OR studentId; claim sets `studentId` on unowned rows without rewriting guest identity; passwords scrypt(N=16384,r=8,p=1)+salt; sessions store only token hashes; cookies httpOnly/SameSite=Lax/Secure(prod); auth mutations require same-origin. next-auth was evaluated and deliberately NOT used (unconfigured dependency, heavier than the need, no paid services rule) — see docs/PHASE2A_IDENTITY.md.
- **PYQ**: import never relabels; `PYQ_VERIFIED` only via review with a written justification; `REJECTED` rows excluded from test selection; the bank honestly still contains zero PYQ records.
- **OCR**: engines evaluated (Tesseract chosen; Docling rejected — Python/model-download weight vs sandbox constraints — see docs/PHASE2A_OCR.md); only scanned pages processed; usable-text validation; original extraction provenance preserved.

## 3. Files changed (summary)

New: `src/lib/answer-index.ts`, `src/lib/auth.ts`, `src/lib/pyq.ts`, `src/lib/riishe/ocr.ts`, `src/lib/ai-local/{detect,adapter,index}.ts`, `src/app/api/auth/**` (7 routes), `src/app/api/student/**` (4 routes), `src/app/api/pyq/**` (3 routes), `src/components/bean/auth-view.tsx`, `src/components/bean/local-ai-card.tsx`, `scripts/pyq-import.ts`, `tests/unit/*` (4 suites), `prisma/migrations/{baseline,phase2a_foundation,job_payload}`, docs (7 Phase 2A docs).

Modified: attempts routes (validation/scoring/result), materials routes (lifecycle), bean/chat (fencing), riishe generate/explain (accounting, FLAGGED, validity), riishe jobs (durable rewrite), pipeline/extract (OCR stage + provenance + `_parts` strip), tests/start (REJECTED exclusion), db.ts (opt-in SQL logging), next.config.ts (strict mode + type errors on), tsconfig.json (app-only type scope), package.json (db scripts, test script), store/api/types (client integration), settings-view/page (account + on-device AI UI), README/CHANGELOG/DECISIONS/DEVELOPMENT.

Not removed (deliberate): unused shadcn/ui components and unused npm dependencies stay — the audit's static scan is not proof of disuse and the instruction forbids removal on first-scan evidence alone. The dead `/api` scaffold WAS removed (proven placeholder).

## 4. Explicit non-goals (unchanged from mandate)

No Razorpay/payment code, no BEAN Teach, no live classroom, no predefined-exam removal, no cosmetic redesign. All existing product surfaces (catalogue, search, topics, PDF reader, timed runner, autosave/resume, negative marking, results, revision, progress, BEAN chat, Riishe upload/analysis/generation/practice/explanations/chat, personal data wipe) preserved and regression-checked.
