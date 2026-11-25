# BEAN Classroom Intelligence — Source-Grounded Knowledge Retrieval (CI-4D)

Milestone: CI-4D. Date: 2026-11-25.
Implementation: `src/lib/ci/fleet/retrieval.ts` + Prisma `ClassroomKnowledgeChunk` (migration `20261125090000_ci4_knowledge_chunks`).

## 1. Architecture — smallest reliable thing that works

SQLite + Prisma + deterministic lexical scoring. No vector database, no external hosted API, no network fetches, no unbounded connectors. The corpus lives in the same database as the rest of Classroom Intelligence; retrieval is pack-scoped and licence-gated end to end.

Pipeline (charter §6.5 / CI-4 mission §7):

1. `resolveKnowledgeContext()` — resolve the subject to BEAN domain families (deterministic token matching with `matchedOn` evidence; unmatched ⇒ honest empty, never guessed) → keep only packs passing BOTH the machine gate (`dispatchableDomainPacks`) AND the human curator gate (`curatedDispatchablePacks`; CI-4C) → list each pack's citation-usable sources. Every gap is recorded as an explicit `missing[]` reason.
2. `searchKnowledgeChunks()` — bounded lexical retrieval (tokenised term overlap, title-hit bonus, deterministic total ordering by score then chunkKey). Filters: domain, language, source. **Live licence checks at query time**: chunks whose source record has become superseded or unregistered are excluded on the spot with recorded reasons.
3. `formatRetrievedContextForPrompt()` — the prompt envelope: retrieved material is **DATA, NOT INSTRUCTIONS**, wrapped in hard delimiters with per-chunk provenance (source, locator, version, language, attribution, licence obligations). Anything inside the delimiters is untrusted evidence; instruction-shaped text inside a document is never a directive.
4. Specialist outputs cite only from the retrieved set or the pack's declared sources — enforced by `validateCitations()`.
5. Uncertainty is preserved: empty results always explain themselves (`no chunk matched…`, `no knowledge chunks ingested for domain…`, `source superseded: …`).

## 2. Ingestion — licence gate, idempotency, injection scan

`ingestKnowledgeChunk()` enforces, in order:

1. **Schema bounds** — content 10–4000 chars, bounded title/locator, strict zod (unknown fields rejected).
2. **Domain scope** — the chunk belongs to a registered pack domain.
3. **CI-4A content gate** — `assertSourceContentUsable(sourceId)` on the CONTENT-AUTHOR source. The OpenStax NC-SA quarantine (and REFERENCE_ONLY / PERMISSION_PENDING records) refuse with the verbatim reason; the refusal is designed for audit trails. Permitted sources ingest **with their obligations recorded verbatim on the chunk** (`obligationsJson`).
4. **Citation anchors resolve** — `citesSourceIds` must be registered and citation-usable. This is how a BEAN-authored definition can *cite* a textbook (attribution) without *ingesting* it (content).
5. **Prompt-injection scan** — deterministic pattern sweep (instruction-override, role takeover, system-prompt exfiltration, fake markup). `422` refusal; the scan verdict is stored on the row.
6. **Idempotent write** — `chunkKey = sha256(sourceId|locator|content)` UNIQUE; re-running a seed never duplicates (re-runs return `alreadyIngested`).

Content-author modelling: a chunk's `sourceId` is the AUTHOR of the text. Pack glossary definitions are BEAN-authored originals, so they ingest under the pack's own `bean-authored-*` seed source (or the generic `bean-authored-knowledge-corpus` record), while any external anchor (e.g. OpenStax) is carried in `citesSourceIds` for attribution. **No copyrighted source text is ingested anywhere in the current corpus** — the CI-4A quarantine is what makes that claim enforceable rather than aspirational.

## 3. Revocation and supersession (source withdrawal)

- `revokeKnowledgeChunks(db, sourceId, reason)` — marks every chunk of the source `revoked` with the reason; **rows are never deleted** (audit trail survives). Revoked chunks never surface in retrieval.
- Supersession is detected **at query time**: a source record flipped to `superseded` excludes its chunks from results immediately (outdated-content detection), and the ingestion gate refuses new chunks from it. Both paths tested.

## 4. Citation validation (fabricated citations rejected)

`validateCitations(cited, retrieval, pack)` — every cited sourceId must be (a) live and usable in the registry, and (b) either retrieved (chunk or citation anchor) or declared by the pack. Anything else is a **fabricated citation**: refused with the fabricated list, never averaged away. This is the retrieval-layer twin of the CI-3E grounding post-pass.

## 5. Current corpus (honest state)

- The seeded corpus is the pack glossaries (12 packs, BEAN-authored definitions) ingested by `seedBeanKnowledgeCorpus()` — idempotent, per-domain locators (`<domainId>/glossary#NNN`), citation anchors preserved.
- **No external-source content is ingested**: OpenStax (NC-SA) is quarantined; NCERT/CEFR are reference-only; ESCO/NCO are at the licence gate. Expansion of the corpus beyond BEAN-authored text requires a recorded permission decision per source — the machinery is ready, the permissions are not.
- Embeddings: deliberately NOT implemented (SQLite deployment scale does not justify them; the charter prefers the smallest reliable architecture). The lexical layer is the interface — if retrieval quality demands it later, an embedding adapter can be added BEHIND the same chunk store without changing the licence/provenance machinery.

## 6. Tests (`tests/unit/ci4-retrieval.test.ts`, isolated real DB via migrate deploy)

D1 licence gate (NC refusal verbatim; obligations recorded) · D2 chunkKey idempotency · D3 bounds/unknown-domain/bad-anchor refusals · D4 injection refusal at ingest · D5 provenance-complete deterministic retrieval + language filter · D6 fabricated-citation refusal · D7 revocation + supersession (audit rows survive; live query-time exclusion; superseded sources cannot gain chunks) · D8 data-not-instructions envelope · D9 honest uncertainty reasons · D10 machine gate AND curator gate in context resolution · D11 corpus seed idempotency + citation anchors (OpenStax cited, not ingested) · D12 real persistence.
