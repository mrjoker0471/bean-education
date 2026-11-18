# Changelog

All notable changes to BEAN Education. Format based on Keep a Changelog.

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
