# BEAN Education — Decision Log

Append-only. One entry per significant decision, newest at the bottom.

## ADR-001 — One modular application, no microservices (2026-11-18)

Status: accepted. The product is a single Next.js application. Domain boundaries (student, teacher, booking, class, payment) are kept clear in code and schema, but deployment stays unified unless a demonstrated reason requires a change.

## ADR-002 — Guest-first identity for the current product (2026-11-18)

Status: accepted (to be revisited at Phase 2). Identity is a UUIDv4 guest id stored in localStorage and passed on every request; all ownership checks key on it. Consequences: zero-friction onboarding, but no cross-device identity, no sessions/rotation, and all endpoints are public. The BEAN LEARN account model must replace this before Phase 2 profiles ship.

## ADR-003 — SQLite via prisma db push, no migrations folder (2026-11-18)

Status: accepted for now, flagged for change. Schema is applied with `prisma db push` (`--accept-data-loss` in the script). Reproducibility/rollback risk recorded; migrations to be introduced before the next schema change (Phase 2). The SQLite file and uploads live in `db/` which is git-ignored.

## ADR-004 — In-process job queue and quotas (2026-11-18)

Status: accepted for the single-process deployment. Riishe jobs, hourly quotas and chat rate limits are module-level in-memory state with stale-job recovery. Consequences: restart resets quotas; multi-process deployment would break dedupe/quota assumptions. Revisit before any horizontal scaling.

## ADR-005 — Riishe honesty policy (2026-11-18)

Status: accepted. Riishe never pretends: NEEDS_OCR and FAILED states are first-class outcomes; only VALIDATED questions publish; explanations verify verbatim quotes and downgrade fabrications; chat citations are server-verified; AI-generated content is always distinguished from verified bank content (`Attempt.source`, `Question.sourceType`).

## ADR-006 — Razorpay deferred to the final milestone (2026-11-18)

Status: accepted. No Razorpay code, credentials, endpoints or webhooks until Phase 8, after core platform and BEAN Teach are validated. Proposed 20/80 commission split is provisional.

## ADR-007 — Git history scrubbed of secrets and private documents before first push (2026-11-18)

Status: done. The local repository history contained `.env`, `db/custom.db` and `db/uploads/*` (14–16 user PDFs) tracked across 28 commits. Before any GitHub push, history was rewritten with `git filter-repo` (paths removed; 27 meaningful commits preserved; one empty commit pruned). Files were restored to disk from a pre-scrub bundle backup (`/tmp/bean-pre-scrub-backup.bundle` on the original machine, since destroyed). Commit hashes changed; work history and messages preserved. `.gitignore` hardened so these paths can never return.

## ADR-008 — GitHub authentication via SSH from the dev sandbox (2026-11-18)

Status: accepted. GitHub's OAuth device-flow endpoint (`github.com/login/device/code`) is blocked by the sandbox network gateway (404 via proxy), so `gh auth login --web` cannot complete here. Approved alternative per project rules: SSH. An ed25519 keypair was generated IN the sandbox; the private key never leaves the machine and is never displayed; the public key was added by the owner at github.com/settings/ssh/new. Direct github.com:22 connections are throttled by the network after bursts and can wedge mid-handshake, so `~/.ssh/config` routes github.com through `ssh.github.com:443` (officially supported SSH-over-HTTPS endpoint). If the sandbox is reset, re-add a freshly generated public key (see DEVELOPMENT.md).

## ADR-009 — Remote history preserved via unrelated-histories merge (2026-11-18)

Status: done. The GitHub repo contained a single "Initial commit" (README only). Local main was merged with `--allow-unrelated-histories`, keeping the owner's initial commit and README text intact as ancestors. No force-push; subsequent pushes are fast-forwards.

## ADR-010 — Hand-rolled credential auth instead of next-auth (2026-11-18)

Status: accepted. Phase 2A identity uses scrypt password hashing + SHA-256-hashed session tokens in httpOnly SameSite cookies, implemented in src/lib/auth.ts. next-auth (installed but never configured) was deliberately NOT used: the product needs exactly one credential flow with no third-party providers, and an unconfigured framework dependency adds attack surface without benefit. No paid authentication services. Consequences: password reset and email verification require an email service (not yet available) — documented limitations; the guest-first model remains fully functional and additive (`studentId` columns; claim keeps guest identity).

## ADR-011 — Durable job state in SQLite, CAS claims (2026-11-18)

Status: accepted. Riishe jobs and hourly quotas moved from module-level Maps to RiisheJob/JobQuota tables. Claims are atomic conditional UPDATEs (compare-and-set) — safe under SQLite single-writer serialisation for a single-node deployment; per-owner running limits are soft across processes (documented honestly). Lease heartbeats + expiry recovery replace in-memory staleness checks; retries are bounded (maxAttempts) and reservations are released on terminal failure/cancellation.

## ADR-012 — OCR via Tesseract + pdftoppm, not Docling (2026-11-18)

Status: accepted. Docling was evaluated and rejected for this runtime (Python/model-download weight vs the sandbox's constraints and the no-unnecessary-downloads rule). Tesseract 5.5 (eng+tam tessdata) + pdftoppm are user-space binaries with env-var overrides (TESSERACT_BIN/POPPLER_BIN/TESSDATA_PREFIX); the pipeline processes only scanned pages, validates usable text, and keeps per-page provenance. Honest failure states (OCR_FAILED / unavailable) are preserved end-to-end.

## ADR-013 — On-device AI is consent-gated and foundation-scoped (2026-11-18)

Status: accepted. Browser-local inference (WebLLM path) ships as capability detection + an adapter interface only; the optional runtime is intentionally not installed and NO model downloads without an explicit user action. Server-side Riishe/BEAN chat remains the default. Students' devices are never used for other users' inference; prompts/files stay on device. Transformers.js (embeddings) and a llama.cpp desktop engine are later integrations.
