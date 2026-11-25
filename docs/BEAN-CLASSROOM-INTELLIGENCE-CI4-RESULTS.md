# BEAN Classroom Intelligence — CI-4 Results (CI-4H)

Milestone: CI-4H — final verification. Date: 2026-11-25.
Branch: `feat/bean-classroom-intelligence-ci4` · Baseline: `d86dfcc` (origin/main at start, ls-remote verified) · All eight units committed, pushed and ls-remote verified individually.

## 1. Unit evidence map (every commit SHA + verification)

| Unit | Commit | Remote-verified | Deliverables |
|---|---|---|---|
| CI-4A | `367b8ff` (+ledger `511c61e`) | ✓ ls-remote | Capability audit (12 charter claims verified in source), OpenStax licence CORRECTION (CC-BY-4.0 → CC-BY-NC-SA-4.0 with primary evidence), `SOURCE_LICENCE_RESTRICTION` vocabulary, `assertSourceContentUsable()` ingestion gate, SOURCE-LICENSE-AUDIT.md, 9 audit tests |
| CI-4B | `cdb1b2a` (+ledger `d4d4a12`) | ✓ | World taxonomy adapters: 5 sources registered (O*NET CC BY 4.0 verified live + trademark; ESCO gate + EC acknowledgement; NCO no-import PERMISSION_PENDING; NSQF non-claim; ISCO structural), 12 live-verified occupation mappings across 11 families, crosswalk confidence vocabulary, WORLD-TAXONOMY.md, 10 tests |
| CI-4C | `1bbb485` (+ledger `993f11c`) | ✓ | Append-only curator ledger (ClassroomPackReview + migration), `resolveCuratedStatus` (VERIFIED derived from human approvals; HIGH_STAKES two-distinct-reviewer rule; REJECTED terminal), admin API (real requireAdmin; read-only licence snapshot), PACK_STATUS.REJECTED, 4 new pack candidates + 4 fixtures (12/12 green), DOMAIN-CURATOR-GUIDE.md, 8 tests |
| CI-4D | `4536960` (+ledger `ee65e1a`) | ✓ | ClassroomKnowledgeChunk store + migration, licence-gated idempotent ingestion (OpenStax refused verbatim; obligations recorded verbatim), prompt-injection scan, pack-scoped lexical retrieval with live query-time licence checks, citation validation, revocation, DATA-NOT-INSTRUCTIONS envelope, BEAN corpus seed, RETRIEVAL.md, 12 tests |
| CI-4E | `5a787b7` (+ledger `75978f7`) | ✓ | Retrieval-grounded specialists, contract 1.1.0 (structured handoffs + C7), `planHandoffFollowUps` (server-side proposals only; machine AND curator gates; domain cap), `runPackBenchmark` (never flips status), **checksum integrity fix** (CI-3 canonical form dropped ALL nested content), SPECIALIST-BEHAVIOUR.md, 5 tests |
| CI-4F | `88f2e35` (+ledger `25cce8b`) | ✓ | Corrected capability ladder (machine pass = LIMITED; human bilingual review = VERIFIED; refuses unmeasured), extended provenance records, benchmark set covering all 11 languages + notation preservation, CI4-LANGUAGE-RESULTS.md, 6 tests |
| CI-4G | `de09e40` (+ledger `3e42854`) | ✓ | Teacher observer controls UI (real API, honest states), student in-room disclosure (shared identity convention with the attendance exclusion), `BEAN_CI_FLEET_AUTO_DISPATCH` (exact-`true`, default OFF; consent re-checked at dispatch AND claim — flag alone never bypasses), capacity benchmark (140 tasks @ 160→259 tasks/s across 4→16 workers), OBSERVER-AND-DISPATCH.md, 3 tests |
| CI-4H | this commit | ✓ | Full gates re-run, production build, coverage-doc addenda, this results doc, ledger reconciliation |

**Zero new runtime dependencies** — `package.json` unchanged from baseline `d86dfcc`.

## 2. Quality gates (final, this branch)

- Full Bun suite: **1535 tests, 0 failures** across 109 files (`bun test --isolate`, isolated real DBs; baseline was 1482 → CI-4 added 53 tests; no existing assertion weakened — count/fact updates are documented in each unit).
- `bun x tsc --noEmit`: clean. `bun run lint`: clean.
- `prisma validate`: valid. `prisma migrate deploy` on fresh DBs: green (two new migrations: `20261125080000_ci4_pack_reviews`, `20261125090000_ci4_knowledge_chunks`).
- Production build (`bun run build`, standalone): **exit 0**.
- GitHub Actions (quality job: install → prisma generate → db push → lint → tsc → `bun test --isolate` → production build): recorded in the ledger after the final push (run ID + conclusion).

## 3. Source/licence audit findings (headline)

- **OpenStax misclassification corrected**: CI-3 recorded three textbook sources as CC-BY-4.0; OpenStax's official distribution declares **CC BY-NC-SA 4.0** (primary evidence: `github.com/openstax/university-physics` LICENSE). NC content cannot be ingested into BEAN's commercial operation → **content ingestion QUARANTINED** (citation/reference use remains permitted — a citation is not reproduction). Existing pack content is BEAN-authored; nothing was ever reproduced.
- NCERT/CEFR: REFERENCE_ONLY formalised. MDN: ShareAlike obligation machine-checkable. O*NET: CC BY 4.0 verified live + trademark rule encoded. NCO 2015: no-import (permission unverified; source unreachable at audit). Full per-source records: SOURCE-LICENSE-AUDIT.md.

## 4. Profession taxonomy coverage

- 12 live-verified O*NET occupation identifiers (labels matched at onetonline.org on 2026-11-25, `verificationRef` per record) mapping to 11 of 36 BEAN families with a BEAN-authored confidence vocabulary (EXACT/CLOSE/PARTIAL/MANUAL_REVIEW) and per-record jurisdiction.
- ESCO: machinery + EC acknowledgement ready; **zero identifiers shipped** (UUIDs are never asserted from memory) — gated behind a controlled, verification-logged import run.
- NCO 2015 / NSQF: no-import / structure-cited-only with enforced non-claims.

## 5. Domain packs & human curation

- **12 packs** (8 CI-3 + 4 CI-4C candidates), all IN_REVIEW, all machine-gate-valid (V1–V8), all with BEAN-authored glossaries and registered provenance.
- **Human curator decisions recorded: none yet** — the ledger, admin API, two-reviewer HIGH_STAKES rule and rejection semantics are implemented and tested; no human has reviewed a pack yet. Zero VERIFIED packs, by design.
- The AI-promotion ban is structural: decisions require an authenticated ADMIN session (server-resolved identity); benchmarks/CI/agents have no write path.

## 6. Retrieval implementation evidence

- Licence-gated idempotent ingestion (chunkKey = sha256 of source|locator|content), full provenance per chunk (locator, source version, ingestion time, obligations verbatim), deterministic injection scan, pack-scoped bounded lexical retrieval, live query-time supersession/revocation exclusion, fabricated-citation refusal, DATA-NOT-INSTRUCTIONS prompt envelope, honest `missing[]` reasons on every gap. 12 dedicated tests on an isolated real DB.
- Corpus honesty: BEAN-authored glossaries only; **no external source text ingested anywhere**.

## 7. Agent evaluation & cross-domain handoffs

- Specialists are retrieval-grounded (prompt envelope + provenance); grounding accepts pack-declared OR retrieved sources; retrieval failure degrades to an explicit unknown.
- Handoffs: contract 1.1.0 records with C7 declared-target integrity; server-side planning only (`planHandoffFollowUps` — machine AND curator gates on the target, per-class cap 3); the receiving specialist answers under ITS OWN pack scope.
- Benchmarks: 12 deterministic fixtures (grounded/demoted/handoff/refused), all green; `runPackBenchmark` records results without status flips.

## 8. Language/task benchmark results

- All 11 catalogue languages have BEAN-authored deterministic cases (terminology in-script + notation preservation + CI-3F comprehension/code-switch/refusal).
- Honest current state: **zero VERIFIED language capabilities** (no production measurement recorded; no human bilingual review yet). The corrected ladder is tested: machine pass ⇒ LIMITED; human approval ⇒ VERIFIED; TRANSCRIPTION structurally UNSUPPORTED and immovable by both paths.

## 9. Observer UI

- Teacher controls and student disclosure are implemented against the real API/identity conventions (CI-4G). **Authenticated browser walkthrough with screenshots: DEFERRED** — the sandbox's preview surface serves the main checkout, not this feature branch, and no production deployment of this branch exists yet; performing the walkthrough against a different checkout than the one under review would not be honest evidence. The owner's final verification pass on a deployed branch should capture them (the CI-3H walkthrough pattern — seed script + browser script — carries over; the CI-3 version references an old worktree path and needs the one-line `cd` updated).

## 10. Fleet capacity and resources (measured, machinery-only)

20 classrooms × 7 tasks through the real bounded pool on isolated SQLite: 160 tasks/s @ 4 workers → 208 @ 8 → 259 @ 16 (+62%, diminishing per-worker gains consistent with single-writer SQLite); invariants 140/140 COMPLETED, 0 FAILED. Explicitly NOT claimed: model-bound throughput, horizontal scale, "machinery time = simultaneous classrooms supported".

## 11. Security & privacy results

- Observer: unchanged CI-3D guarantees (least-privilege token, one-per-room UNIQUE, consent re-checks, no media, identity-free evidence) — all CI-3D tests still green (suite unchanged regions).
- Curator API: real `requireAdmin` on every route; server-resolved reviewer identity (forged body identity ignored — tested); read-only licence snapshot (reviewers cannot approve licences for rights holders).
- Retrieval: prompt-injection scan at ingestion; untrusted-content framing at the consumption edge; source licence gate refuses NC/REFERENCE_ONLY/PERMISSION_PENDING/superseded content with verbatim reasons.
- Auto-dispatch: OFF by default; flag alone never bypasses consent (tested); specialists never enter live rooms.
- No student identities anywhere in knowledge records; CI-3 privacy sweeps unchanged and green.

## 12. Capability classification (final, honest)

- **IMPLEMENTED + TESTED**: licence-restriction gate & quarantine; world-taxonomy adapters & verified O*NET crosswalk; curator ledger & admin API; retrieval layer (ingest/search/validate/revoke/envelope); retrieval-grounded specialists; structured handoffs + server-side planning; benchmark recording; capability ladder with human bilingual gate; observer controls & disclosure UI; flag-gated dispatch; capacity benchmark.
- **HUMAN-VERIFIED**: nothing yet — no pack reviews, no bilingual approvals have been performed (the paths are built, gated and tested; the human step is pending by design).
- **VERIFIED BY BENCHMARK**: 12/12 deterministic domain fixtures; all unit suites; machinery capacity numbers (machinery only).
- **EXPERIMENTAL**: all language capabilities (unmeasured in production); ENGLISH-first pack language support.
- **IN_REVIEW**: all 12 domain packs.
- **UNSUPPORTED**: transcription (structural, §9.2); TTS (out of scope).
- **DEFERRED**: ESCO identifier import (controlled API run), NCO import (permission), embeddings (not justified at current scale), authenticated browser walkthrough (see §9), pack VERIFIED promotion (awaits human curators).

## 13. Remaining unsupported domains and languages

- 24 of 36 domain families have no pack. 12 packs cover the initial priority set; expansion follows the same verify-then-record process (curation + licence-clean sources).
- Zero VERIFIED language capabilities; translation NEEDS_HUMAN_REVIEW everywhere; transcription UNSUPPORTED everywhere.
- Indian occupation classification awaits NCO permission verification; ESCO multilingual labels await the controlled import run.
