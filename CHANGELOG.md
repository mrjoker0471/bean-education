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
