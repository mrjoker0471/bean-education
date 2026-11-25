# BEAN Classroom Intelligence — Domain Curator Guide (CI-4C)

Milestone: CI-4C. Date: 2026-11-25.
Implementation: `src/lib/ci/fleet/curator.ts` + admin API `/api/admin/knowledge/packs*` + Prisma `ClassroomPackReview` (append-only ledger, migration `20261125080000_ci4_pack_reviews`).

## 1. The rule that never changes

**An AI agent, a benchmark script or a CI workflow must never promote a pack to VERIFIED.** In CI-4 this is structural, not conventional:

- Promotion decisions are rows in `ClassroomPackReview`, written ONLY by `POST /api/admin/knowledge/packs/[packId]/review` behind `requireAdmin()` — an authenticated ADMIN session resolved **server-side**. Agents, benchmarks and CI have no session and therefore no write path. (Tests assert the guard: unauthenticated → 401, non-admin → 403, forged reviewer id in the body is ignored.)
- The reviewer's identity is never taken from the request body — it comes from the session (`guard.student.id` / `displayName` snapshot).
- `resolveCuratedStatus()` is a PURE function: VERIFIED is *derived* from recorded human approvals; it is never a stored flag someone can flip.
- The V6 validator still refuses a pack whose *declared* status is VERIFIED without recorded human review — CI-4C adds the decision ledger on top, it does not weaken the machine gates (V1–V8 unchanged).

## 2. What a reviewer must inspect before deciding

| Area | Where | What to verify |
|---|---|---|
| Scope accuracy | pack `title`, `aliases`, `iscedCodes`, `relatedSubjectDomainIds` | The pack claims exactly the domain it covers — no scope drift |
| Sources | GET detail → `sources[]` (read-only provenance snapshot) | Every source registered, licence `spdx`/`restrictions`/`verifiedAt` correct, usage matches the licence (see the source licence audit) |
| Licence compatibility | same | NC/SA/REFERENCE_ONLY restrictions understood; the pack's *declared use* must not exceed them |
| Subject correctness | `glossary`, `competencyLevels` | Definitions are BEAN-authored and conceptually correct; anchored claims match the cited source's actual scope |
| Safety boundaries | `safetyBoundary`, `allowedTasks`, `prohibitedTasks` | Charter §14 boundaries present; HIGH_STAKES packs always declare prohibitions (V7) |
| Benchmark fixtures | `benchmark.fixtureRefs` + `runDomainFixtureSuite()` | Every cited fixture runs green; acceptance is deterministic (no model judges a model) |
| Domain coverage | taxonomy mappings | `DOMAIN_FAMILIES` entry, ISCED codes, verified occupation mappings only (`world-taxonomy.ts`) |
| Language claims | `languageSupport[]` | Statuses are honest (EXPERIMENTAL/NEEDS_HUMAN_REVIEW/UNSUPPORTED) — never VERIFIED without a measured benchmark + human approval |

## 3. How to record a decision

`POST /api/admin/knowledge/packs/[packId]/review` (ADMIN session required):

```json
{
  "packVersion": "1.0.0",
  "packChecksum": "<sha256 from the GET detail response>",
  "decision": "APPROVED | REJECTED | CHANGES_REQUESTED | RE_REVIEW_REQUESTED",
  "rationale": ">= 20 chars — WHY you decided this",
  "evidence": ">= 20 chars — WHAT you actually inspected (commands, fixtures run, sources checked)"
}
```

Server-side refusals (honest, no silent rebinding):

- `404` unknown pack · `400` invalid decision/short rationale · `409` **version mismatch** (pack moved on since inspection) · `409` **checksum mismatch** (content changed — you must re-inspect the current content and re-submit).

Decision semantics:

- **APPROVED** — advances the human gate. STANDARD risk: 1 distinct reviewer ⇒ curated status VERIFIED. HIGH_STAKES: **2 DISTINCT reviewers** required (the two-reviewer rule; the same person approving twice does not count).
- **REJECTED** — terminal for the reviewed version. The pack's curated status becomes REJECTED; it never dispatches. A rejection row stays in the ledger forever. A NEW pack version restarts review from scratch.
- **CHANGES_REQUESTED / RE_REVIEW_REQUESTED** — work states; the pack keeps its declared status (e.g. IN_REVIEW) and cannot reach VERIFIED until resolved.

## 4. Where the curated status applies

- `curatedPackSummaries(db)` — the admin inspection surface (GET list): every pack with its declared vs curated status, approvals recorded/required, checksum, review count.
- `curatedDispatchablePacks(reviews)` — the dispatch-time gate: the machine gate (declared VERIFIED/IN_REVIEW) **and** the human gate must both pass. A curator-rejected pack never dispatches, regardless of its declared status. (The dispatcher adopts this as its pack source in CI-4E/4G.)
- Appending is the only write operation on the ledger — no update, no delete, in code or API. Historical decisions are immutable.

## 5. What a reviewer can NEVER do here

- **Approve a source licence on behalf of its rights holder.** Source records are surfaced read-only in the pack detail response (`readonly: true`). Source licence changes are owner-level code changes recorded in git, verified in the source licence audit — not approvable via the API.
- **Approve without inspecting.** The API requires rationale + evidence, and binds the decision to the exact checksum — a rubber-stamp without content is visible and auditable.
- **Promote as an agent.** There is no non-session path; there is no "auto-approve" decision value (`AUTO_VERIFY` is refused by the schema).
- **Flip transcription or language capabilities.** Those registries are separate (CI-3F/CI-4F); TRANSCRIPTION is structurally UNSUPPORTED and the language gate cannot be moved by curation decisions.

## 6. Verification on the CI-4 branch

- `tests/unit/ci4-curator.test.ts` (8 tests C1–C7): checksum-bound approvals; STANDARD one-reviewer gate; HIGH_STAKES two-distinct-reviewer rule; REJECTED terminal; stale-version/stale-checksum 409s; unknown pack 404; short rationale 400; unknown decision value 400; REAL `requireAdmin` guard (401/403); server-resolved reviewer identity (forged body id ignored); read-only source snapshot; curated dispatch gate; 12 registered packs (8 CI-3 + 4 new CI-4C candidates) with the 12-fixture suite green; real Prisma persistence on an isolated DB.
- New pack candidates (all honestly IN_REVIEW, all machine-gate-valid): `education-pedagogy`, `engineering`, `agriculture-agritech`, `history-philosophy` — BEAN-authored seed sources registered per domain; occupation notes cite only LIVE-VERIFIED O*NET mappings (teachers, archivist) or state honestly that none exists yet.
