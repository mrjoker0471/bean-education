# Phase 3A — Riishe Deep Research & Verified PYQ Discovery

Status: **implemented on `feat/bean-riishe-phase3a-deep-research`** (baseline `origin/main` at `26dd3b8`, the PR #7 merge). This document is the product/design record; security details live in `docs/PHASE3A_SECURITY.md`.

## What it is

Riishe can now do genuine, source-grounded research inside the existing workspace. A student describes WHAT to research — an examination, a subject/chapter/topic, a specific historical question, or a concept — optionally attaching their own analysed materials as context. Riishe plans searches over the configured `web_search` integration, retrieves a budgeted subset of sources through an SSRF-guarded fetcher, checks each source's content, and produces a **persistent research dossier**: findings organised by topic with citations, source cards with lifecycle + classification, conflicting-source warnings, explicit missing-evidence states, a cited summary, suggested follow-ups, and a follow-up chat grounded in the dossier. For examination runs, the pipeline also mines **historical-question candidates** that enter the existing PYQ curation workflow only through a curator-gated promotion.

## What it deliberately is NOT

- **Not verification.** Nothing in the pipeline can set a question to `PYQ_VERIFIED`. AI confidence is not verification; only `/api/pyq/review` (curator/admin, mandatory justification, append-only audit) verifies.
- **Not a scraper.** No paywalled or commercial question banks are collected. Verbatim question text is stored only when a reuse licence is detected on the source; otherwise the candidate keeps a locator and minimal evidence excerpts and a curator supplies the verbatim text themselves.
- **Not unlimited.** 6 research runs / hour / owner (durable `JobQuota`), ≤6 searches, ≤6 page fetches + ≤2 PDF fetches, ≤10 candidates per run, all counted on the session row and shown in the UI.
- **Not a new system.** Same app, same Prisma/SQLite, same Riishe AI wrapper (`z-ai-web-dev-sdk`), same durable `RiisheJob` worker, same guest-identity + claim model, same hash-navigation.

## The pipeline (stages persisted as honest progress)

| Stage | What happens | Honesty rules |
|---|---|---|
| PLAN | One model call decomposes the brief into ≤6 queries + ≤6 subtopics | Input is untrusted data (fenced); planner may restate the brief, never invent |
| SEARCH | `web_search` per query (≤6), results normalised (URL canonicalisation, utm-stripping, dedupe) and persisted as `ResearchSource` rows | Per-query failures recorded and disclosed; policy-blocked URLs never become sources; zero results → honest failure |
| RETRIEVE | SSRF-guarded fetch of ≤6 pages + ≤2 PDFs (official-hint prioritised) | Each source is `RETRIEVED` or `UNAVAILABLE` with a real reason (timeout, size, content-type, HTTP status); budget disclosed |
| DOCUMENTS | Attached materials contribute `kind: document` sources — visually and structurally separate from web evidence | Owner-only; never shared with curators or other students |
| CHECK | Per-source model check: relevance, verbatim evidence excerpts (programmatic containment check — paraphrase is dropped), printed dates, licence signals, publisher establishment | Classification = domain hint **AND** content; `OFFICIAL_AUTHORITY` requires the curated authority map + content match; unknown hosts stay `UNVERIFIED` |
| CANDIDATES | Exam-aware runs mine official/gov/open-licensed sources for historical questions | Verbatim only when licence-detected AND containment-verified; answer index only when the page itself marks it; year bounded 1990–2035; unconfirmable wording stored as clearly-labelled incomplete candidates |
| SYNTHESIZE | Findings per subtopic with numeric citations | Unresolvable citation ids are dropped; subtopics with no evidence are kept with an explicit "no retrieved evidence addressed this" note |
| SUMMARIZE | Cited summary + ≤3 suggested follow-ups | Unresolvable `[n]` markers stripped before display |

A failed stage fails the session honestly (`FAILED` + `statusDetail`); the job runner's lease/heartbeat/retry semantics apply unchanged, and stage-level idempotence makes re-runs resume instead of duplicating sources.

## Source classification (evidence-aware, not domain-alone)

| Class | Requires |
|---|---|
| `OFFICIAL_AUTHORITY` | host suffix in the curated authority map (UPSC/TNPSC/SSC/IBPS/NTA/Railways/RBI/SBI) **AND** retrieved content matching the research scope |
| `GOV_INSTITUTIONAL` | gov/academic domain suffix **AND** content match — or an official-domain source whose content did not confirm relevance |
| `OPEN_LICENSED` | licence text detected on the page (Creative Commons / public domain / GFDL / open licence) |
| `REPUTABLE_SECONDARY` | LLM-confirmed established publisher **AND** academic-domain rule (`.ac.in`, `.edu`, `.ac.uk`, `nic.in`) |
| `UNVERIFIED` | anything else — the honest default |

A domain name alone never makes a source trustworthy, and model output alone never classifies a source.

## Historical-question lifecycle

```
DISCOVERED → SOURCE_CHECKED → (curator promotes) → PYQ_UNVERIFIED → HUMAN REVIEW → PYQ_VERIFIED / REJECTED
```

- Candidates live in `ResearchPyqCandidate` with full provenance (exam, year, session, paper, question number, locator, source URL/title/publisher, retrieval date, answer-key ref when seen, verification note).
- **Promotion is curator-only** (`requirePyqCurator`, `sameOrigin`): it mirrors the import contract — per-row validation, `computePyqHash` global duplicate detection (409 with the existing row), a real `PyqImportBatch` audit row, and a `Question` created as `PYQ_UNVERIFIED` / `UNVERIFIED` with the new web-discovery provenance columns (`sessionLabel`, `questionNumber`, `sourceUrl`, `sourcePublisher`, `retrievedAt`, `answerKeyRef`).
- The curator queue in PYQ Studio gains a **Candidates** tab; promoted rows show in the review queue with their provenance.
- Students own their research sessions/candidates; they can discard their own candidates but can never promote.

## Safeguard alignment (additive strengthening, documented per DECISIONS)

1. **Verified practice draws only from VERIFIED questions.** `SELECTABLE_QUESTION` (`/api/tests/start`) was `verificationStatus: { not: 'REJECTED' }` — meaning UNVERIFIED PYQ rows were actually served in practice tests while the curator docs/UI claimed they were invisible. It is now `{ verificationStatus: 'VERIFIED' }`. This *strengthens* the safeguard (never weakens) and makes runtime match the documented policy; the review contract itself is untouched.
2. **CSRF guard on PYQ mutations.** `/api/pyq/import`, `/api/pyq/review` and the new candidate routes now apply the same `sameOrigin` check as every other mutating route.
3. **Atomic review audit.** The review decision + `PyqReviewEvent` append now share one `$transaction`, so the audit trail cannot lose a decision.

## Data model (single additive migration `20261120153000_phase3a_deep_research`)

- New: `ResearchSession`, `ResearchSource`, `ResearchPyqCandidate` (owner-scoped; candidates survive session deletion by design — they carry curation provenance).
- Extended: `Question` +6 nullable provenance columns; `RiisheChatTurn` + nullable `researchSessionId` (research follow-ups persist as first-class chat turns); `claim-guest` migrates both new tables.
- Backup taken before the migration (`db/backups/`); migration SQL is purely `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX` — no destructive change anywhere.

## UI

- `#/riishe/research` hub: research-type selector, examination catalogue picker, year range, research question, focus note, material attachments (≤3 READY docs), quota note, session history with real counters.
- `#/riishe/research/:id` workspace: honest stage progress, real cost counters, summary with citation chips, findings by topic (conflict + missing-evidence states), source cards (class/status/dates/URL/evidence), candidates with rights labels, follow-up chat (reuses `RiisheChatPanel` via the new `researchSessionId` scope — the grounding badge reads "Research-grounded").
- PYQ Studio: 4th tab **Candidates** (curator-gated) with promote dialog (verbatim text required for reference-only candidates), discard, and honest provenance display.
- Obsidian/champagne-gold tokens throughout; no fabricated numbers anywhere.

## Known limitations (honest)

- `web_search` availability/quality is whatever the configured provider returns; when it is down, research runs fail honestly instead of fabricating.
- The authority map is a manually maintained list; genuinely official pages on unknown domains classify as `GOV_INSTITUTIONAL`/`UNVERIFIED` rather than pretending to be official.
- PDF retrieval is capped at 2 per run and 8 MB each; scanned PDFs without an OCR-yielding text layer produce an honest "no extractable text" state.
- Rights detection is textual (licence phrases); absence of a detected licence always means reference-only. It is a conservative filter, not a legal opinion.
- DNS-rebinding residual risk is mitigated in layers, not eliminated (see PHASE3A_SECURITY.md).
- Session/locator provenance is stored only when actually visible on the source — candidates may carry honest "not captured" fields.
