# Phase 3A — Results & Evidence (Riishe Deep Research & Verified PYQ Discovery)

Branch: `feat/bean-riishe-phase3a-deep-research` (base: `origin/main` at `26dd3b8db0f75f68e64352539847d23043434bfb`, the PR #7 merge — verified via anonymous HTTPS `ls-remote` before branching).

## 1. Delivered

| Area | Detail |
|---|---|
| Research pipeline (`src/lib/riishe/research.ts`) | plan → search → retrieve → check → candidates → synthesize → summarize with persisted honest stage progress, budgets (≤6 searches, ≤6 page fetches + ≤2 PDFs, ≤10 candidates/run), real cost counters, per-stage idempotence (re-runs resume) |
| SSRF-guarded fetcher (`src/lib/riishe/url-guard.ts`) | scheme/host/IP-literal/DNS/redirect/size/type/timeout policy; metadata + private-range coverage for v4/v6; only path to external retrieval |
| Research APIs | `POST/GET /api/riishe/research`, `GET/DELETE /api/riishe/research/[id]`, `GET/POST /api/riishe/research/[id]/followup` — owner-scoped (guest identity + claim migration), quota 6/h, honest 400/404/409/429/502 |
| Historical-question candidates | `ResearchPyqCandidate` lifecycle `DISCOVERED → SOURCE_CHECKED → (curator) PROMOTED/DISCARDED`; curator-only promotion (`POST /api/pyq/candidates/[id]/promote`) reusing the import contract (validation, global `pyqHash` dedupe, batch audit row) and always creating `PYQ_UNVERIFIED`/`UNVERIFIED` |
| Rights policy | verbatim text stored only with a detected licence signal AND word-for-word containment; otherwise `REFERENCE_ONLY` (locator + ≤300-char evidence excerpts); promotion of reference-only candidates requires the curator to supply the verbatim text |
| Source classification | `OFFICIAL_AUTHORITY` requires the curated authority-map domain AND content match; `GOV_INSTITUTIONAL` / `OPEN_LICENSED` / `REPUTABLE_SECONDARY` / `UNVERIFIED` per evidence rules; `DISCOVERED → RETRIEVED → CHECKED / UNAVAILABLE` lifecycle per source |
| Follow-up chat | `RiisheChatTurn.researchSessionId` scope; server-verified `[n]` citations; RESEARCH-GROUNDED badge; rate-limited; persists with the dossier |
| UI | `#/riishe/research` hub + `#/riishe/research/:id` workspace (stage strip, cost counters, summary with citation chips, findings with conflict/missing-evidence states, source cards, candidate cards, follow-up chat); Riishe hub "Deep Research" entry; PYQ Studio **Candidates** tab with promote dialog; obsidian/gold language preserved |
| Safeguard alignment | `SELECTABLE_QUESTION` → VERIFIED-only practice (documented mismatch between runtime and curator-doc claims fixed by STRENGTHENING); `sameOrigin` added to pyq import/review/candidate routes; review decision + audit now atomic (`$transaction`) |
| Jobs/quota | `JobKind 'DEEP_RESEARCH'` + `QuotaKind 'research'` (6/h) wired into the existing durable worker (lease/heartbeat/retry/`markDomainFailed`/`recoverStaleResearch`) |
| Data model | single additive migration `20261120153000_phase3a_deep_research` (3 new tables, +6 nullable Question provenance columns, +`RiisheChatTurn.researchSessionId`); backup taken before push; SQL inspected — `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX` only |

## 2. Verification (actually executed)

- `bun test`: **777 pass / 0 fail** across 51 files, 4,470 assertions (baseline 705 kept green + 72 new: url-guard 19, research-normalize 11, research-route 12, research-pipeline 5, research-followup 6, pyq-candidates 13, safeguard-alignment 6).
- `bunx tsc --noEmit`: clean. `bun run lint`: clean.
- `db:status`: 9 migrations listed (`…phase7_institution_career`, `20261120153000_phase3a_deep_research`) with the known sandbox bookkeeping quirk (runtime DB provisioned via `db push`; no reset ever performed; isolated worktree DB used throughout).
- Secrets scan: tracked diff contains no keys/tokens/credentials/`.env`/database files (env, db, uploads, logs and `agent-ctx/` are git-ignored; verified with `git check-ignore`).
- **Live web_search availability**: verified before E2E (`zai.functions.invoke('web_search')` returned real results incl. `upsc.gov.in`).

## 3. Live browser E2E (real AI + real web_search, zero fabricated data)

Three real research runs executed through the production pipeline (`next dev -p 3100`, isolated DB, fixtures registered through the real HTTP APIs; curator role granted only via `scripts/grant-role.ts`):

- Run A (pre-fix): surfaced a real bug — the check stage received a stale in-memory source array (0 checks). Fixed (re-fetch after retrieve) and covered by the pipeline tests.
- Run B: `COMPLETE` — 4 searches, 6 fetches, 3 model calls; 18 sources discovered; official `upsc.gov.in` pages honestly `UNAVAILABLE` (the authority blocks fetchers); 3 sources content-checked.
- Run C (final): `COMPLETE` — all stages DONE including candidates ("no eligible question-paper sources among the checked sources" — honest, since the checkable sources were not authority-classified); 4 verbatim-contained evidence excerpts; findings with real citations (`[3]`) and explicit missing-evidence notes; cited summary.
- Follow-up chat verified live via API + browser: `grounding: document`, cited source rendered with class/status and the verbatim excerpt behind the "Show what context was used" toggle.
- Screenshots in `agent-ctx/e2e/` (local evidence, gitignored): 01 Riishe hub with the Deep Research entry, 02 research hub form, 03 run progress, 04 dossier, 05 findings/sources, 06 follow-up thread with RESEARCH-GROUNDED badge, 07 curator Candidates tab (honest empty queue), 08 hub @390px, 09 dossier @390px, 10 dossier @1280px. Console/page errors across all flows: **0**.

## 4. Honest limitations

- **No promoted candidate was exercised in a browser flow** — the real runs produced 0 candidates because no authority-classified source was retrievable (official sites block fetching). The promotion path is covered by 13 unit tests including role gates, rights rules, dedupe and the UNVERIFIED-only creation; the curator UI is rendered but the promote dialog was not driven end-to-end in a browser against a real candidate.
- upsc.gov.in (and likely other authority sites) actively block server fetches — their sources stay honestly `UNAVAILABLE`; candidate discovery will depend on authority mirrors/open-licensed archives. This is the system working as designed, but it means real candidate discovery may be sparse until such sources are retrievable.
- One E2E screenshot (06) shows the curator's session cookie while viewing the research dossier (identity layers are independent: research ownership is guest-scoped, nav is session-scoped) — cosmetic, not an authorization issue.
- DNS-rebinding residual risk is documented in `docs/PHASE3A_SECURITY.md` §1.
- Production build NOT run (`bun run build` is disallowed in this environment); verification stands on tests/tsc/lint/live E2E.

## 5. Git hygiene

- Branch created from verified `origin/main` (`26dd3b8…`); no main-branch commits; no force-push; no merge; the PR is opened by the repository owner.
- The platform-owned local-only commit `f127b79` on the main checkout is untouched; all work happened in the `p3a-wt` worktree with an isolated database.

## 6. Push status (honest report)

The sandbox was reset again between sessions and `/home/z/.ssh` + the OpenSSH shim were wiped, so the previously registered deploy key is gone. A fresh ED25519 deploy keypair was generated locally (`ssh-ed25519 …B6nFYsSFf1Ljhkwj40FduyG2ayF/usmWTZuHNAIrsSV bean-phase3a-push@2026-11-20`) and the pure-JS ssh2 transport (sshshim → `ssh.github.com:443`) was rebuilt and verified: it reaches GitHub and fails exactly at public-key authentication. The only missing step is registering the new public key as a repository deploy key (write access) — after that `git push origin feat/bean-riishe-phase3a-deep-research` completes delivery. Nothing force-pushed, nothing merged, main untouched.
