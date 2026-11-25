# BEAN Classroom Intelligence — CI-4 Baseline & Capability Audit (CI-4A)

Milestone: CI-4A — Baseline and source audit
Baseline: `origin/main` = `d86dfcc339317b41720884ca5b3c37b5152256f5` (verified via `git ls-remote` at audit time; this is the merge of PR #40, the CI-3 ledger close-out — main therefore contains CI-3 units A→H **and** the CI-3H CI close-out fix `eb27d2e`).
Branch: `feat/bean-classroom-intelligence-ci4` (fresh worktree from `d86dfcc`; no CI-3 worktree reused).
Audit date: 2026-11-25. Method: every claim below was verified against the actual source files and live test runs on this baseline — not copied from CI-3 documents.

**Headline audit finding:** CI-3's source registry misclassified the three OpenStax textbook entries as `CC-BY-4.0`. OpenStax's own distribution declares **Attribution-NonCommercial-ShareAlike 4.0 International** (primary evidence: `github.com/openstax/university-physics` → `LICENSE` file, literally "Attribution-NonCommercial-ShareAlike 4.0 International"). NonCommercial content cannot be ingested into BEAN's commercial operation without separate written permission. CI-4A corrects the records, adds a machine-checkable content-ingestion quarantine, and documents everything in `BEAN-CLASSROOM-INTELLIGENCE-SOURCE-LICENSE-AUDIT.md`. Existing pack content is BEAN-authored (no textbook text was ever reproduced), so packs remain valid; only *content ingestion* (CI-4D retrieval) is now licence-gated per source.

---

## 1. Claim-by-claim verification against source

| # | Claim | Verdict | Evidence (file:line at `d86dfcc`) |
|---|-------|---------|-----------------------------------|
| 1 | 36 ISCED-F domain families | **TRUE** | `src/lib/ci/fleet/taxonomy.ts` `DOMAIN_FAMILIES` — counted 36 entries (`education-pedagogy` … `interdisciplinary-emerging`), each with `iscedCodes` + `matchTokens`; 11 ISCED-F broad fields in `ISCED_F_BROAD_FIELDS` (lines 27–39) |
| 2 | Eight existing dispatchable domain packs | **TRUE** | `src/lib/ci/fleet/packs/index.ts` — 8 packs by `domainId`: `mathematics-statistics`, `computing-software-it`, `accounting-finance`, `health-medicine-edu`, `physics-space`, `chemistry-materials`, `biology-life`, `languages-literature`; all resolve via `dispatchableDomainPacks()` (subject-expert instance ids `BEAN_SUBJECT_EXPERT::<domain-id>`, `constants.ts` line 119) |
| 3 | Eight packs still IN_REVIEW | **TRUE** | same file — 8× `status: PACK_STATUS.IN_REVIEW` (lines 94, 139, 180, 220, 268, 309, 350, 398); V6 machine-promotion refusal enforced in `domain-packs.ts` |
| 4 | Eleven registered priority languages | **TRUE** | `src/lib/ci/fleet/language.ts` `CI3_LANGUAGES` — en, hi, ta, te, ml, kn, bn, mr, gu, ur, pa with script + variation notes |
| 5 | No VERIFIED language capability | **TRUE** | `language.ts` `defaultLanguageCapabilities()` — TEXT_UNDERSTANDING/TERMINOLOGY/GENERATION = EXPERIMENTAL (unmeasured), TRANSLATION = NEEDS_HUMAN_REVIEW, TRANSCRIPTION = UNSUPPORTED; `isCapabilityVerified` returns true only for measured passes; `recordCapabilityMeasurement` structurally cannot flip TRANSCRIPTION (lines 231–234) |
| 6 | Text comprehension & terminology experimental | **TRUE** | `language.ts` lines 203–204: EXPERIMENTAL with `testRef: null` ("unmeasured — benchmark harness has not recorded a result") |
| 7 | Translation requiring human review | **TRUE** | `language.ts` line 205: NEEDS_HUMAN_REVIEW, "never used for legal/technical terms" |
| 8 | Transcription unsupported | **TRUE** | `language.ts` lines 207–214: UNSUPPORTED for every language, testRef = "charter §9.2 consent/legal gate — speech processing disabled platform-wide"; no ASR dependency in package.json |
| 9 | One visible consent-gated observer per eligible room | **TRUE** | `ClassroomObserverSession.liveClassSessionId UNIQUE` (Prisma schema line ~2017 area); `src/lib/ci/fleet/observer.ts` — least-privilege VISIBLE token (roomJoin only, canSubscribe/canPublish/canPublishData=false, hidden=false), consent re-check at dispatch/connect/heartbeat, global pool bound `BEAN_CI_OBSERVER_MAX_ACTIVE` |
| 10 | No teacher-facing observer control | **TRUE** | The observer exists ONLY as an API route: `src/app/api/teach/classes/[id]/live/observer/route.ts` (GET/POST/DELETE). No teach-UI component references it — grep over `src/components/` and teach pages finds no observer control surface. CI-4G builds this |
| 11 | Fleet dispatch not auto-triggered by class lifecycle | **TRUE** | `src/app/api/teach/classes/[id]/live/end/route.ts` and `src/app/api/webhooks/livekit/route.ts` import only `cancelObserverForEndedSession` (observer leave); `dispatchFleetForSession` has **zero production call sites** (only its definition in `dispatcher.ts`; tests/seed scripts invoke it directly) |
| 12 | 19-role agent registry + bounded worker queue | **TRUE** | `src/lib/ci/fleet/constants.ts` `FLEET_AGENT_ID` — Agents 00–18 (DISPATCHER … PROFESSION_MENTOR); `worker.ts` bounded pool (`FLEET_WORKER_CONCURRENCY` default 4, clamp 1–32), CAS claims, lease+heartbeat recovery, backlog backpressure (50) with honest ENRICHMENT skips |

Additional verified facts (same audit):

- **Profession taxonomy is at the licence gate:** `taxonomy.ts` `PROFESSION_IMPORT_STATE = 'LICENCE_GATE_PENDING'`, `professionCatalogue()` returns zero nodes — ESCO/O*NET data is NOT imported. CI-4B is the unit that may change this, only through the documented licence path.
- **Retrieval does not exist yet:** there is no knowledge-retrieval module; sources are provenance records only (nothing downloads content). CI-4D builds this.
- **Runtime registration:** `runtime.ts` registers ONE real executor (`registerFleetTaskExecutor(executeFleetTask)`, line ~1094) implementing all specialist roles behind the CI-3C seam.
- **Persistence:** Prisma/SQLite — `ClassroomFleetTask` (taskKey UNIQUE, CAS claims, lease), `ClassroomObserverSession` (liveClassSessionId UNIQUE), plus CI-1 evidence models; migrations under `prisma/migrations/` (fleet tables: `20261124070000_ci3_fleet_tasks`, `20261124080000_*` observer).
- **Model adapter:** `src/lib/ci/model-adapter.ts` — the only model seam; absence = honest unmeasured states everywhere (no adapter → benchmarks `ran:false`, registry untouched).
- **Suite at baseline:** 1482 tests / 0 failures across 102 files (`bun test --isolate`, isolated DB). CI-4A adds 9 audit tests → 1491/0.
- **CI-3H CI close-out** (`eb27d2e`, merged via PR #39; ledger close-out merged via PR #40 → `d86dfcc`): benchmark is checkout-portable, production build is CI-green — CI-4 does NOT need to re-fix these.

## 2. What CI-4 must therefore build (gap list)

1. **CI-4A (this unit):** licence audit + quarantine mechanism — DONE in this unit.
2. **CI-4B:** profession/competency taxonomy adapters (ESCO, O*NET, NCO/NSQF audit, ISCED mapping) — currently structure-only (`LICENCE_GATE_PENDING`).
3. **CI-4C:** curation workflow + human reviewer identity/decision recording (V6 currently refuses machine promotion but no curator interface exists) + additional pack candidates in the 36-family space (8/36 covered).
4. **CI-4D:** source-grounded retrieval (nothing exists), citation validation, revocation, prompt-injection resistance.
5. **CI-4E:** cross-domain handoffs (structured contract — dispatcher caps domains but no handoff record exists), specialist upgrade, domain benchmarks.
6. **CI-4F:** measured multilingual benchmarks (harness exists with 6 cases; human-reviewed reference sets and per-language measurement do not), capability records extended (dialect/model/version/domain/benchmark-version/human approval).
7. **CI-4G:** teacher observer controls UI (missing), student disclosure, `BEAN_CI_FLEET_AUTO_DISPATCH` (absent), capacity benchmarks.
8. **CI-4H:** final verification + docs + ledger.

## 3. CI-3 status preservation

Nothing in CI-3's honest states was changed by this audit except the OpenStax licence classification (a factual correction, recorded in the source-license audit with primary evidence). Pack statuses remain IN_REVIEW; language states remain EXPERIMENTAL/NEEDS_HUMAN_REVIEW/UNSUPPORTED; the observer and fleet machinery are untouched.
