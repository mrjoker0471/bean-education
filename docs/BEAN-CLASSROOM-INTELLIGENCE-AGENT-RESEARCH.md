# BEAN Classroom Intelligence — Agent Fleet Upstream Research (CI-3A)

Milestone: **CI-3A — Architecture audit and upstream decision**
Charter: `docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-CHARTER.md` (sections 2, 3, 19-CI-3A)
Predecessor research: `docs/CLASSROOM-INTELLIGENCE-OPEN-SOURCE-RESEARCH.md` (CI-1A — evaluated LiveKit Agents (Python), Agno, LangGraph; none adopted)
Scope: inspect the live BEAN repository state and CI-2 closure, inspect
`livekit/agents-js` at source level, evaluate the *actual* minimal reuse path,
audit licences, and record the final CI-3 architecture decision with honest
reasons. Facts below were verified on **2026-11-24** against the upstream
repositories (source clone inspection), the npm registry, installed package
manifests, and a reproducible integration probe (`scripts/ci3-probe-upstream.ts`)
run on the actual BEAN runtime. Nothing is asserted from memory alone.

---

## 0. Starting-state audit (GitHub dependency resolved first)

Verified 2026-11-24 by fresh `git fetch` + `git ls-remote` + ancestry checks:

| Fact | Verified value |
|---|---|
| `origin/main` | `d6ef91722e1dd66d8a82b5fead417dc86f30b759` — *Merge pull request #34 from feat/bean-classroom-intelligence-ci2* |
| Six CI-2 commits through `7abd15f` | **preserved and integrated**: `git merge-base --is-ancestor 7abd15ff... origin/main` → true (via PR #34 merge `d6ef917`) |
| CI-2 milestone ledger | COMPLETE/MERGED (PR #34), `docs/milestone-ledger.json` |
| CI-2 follow-up commits (homepage editorial refresh + reconciliation docs, `d7851f4`…`e3e3681`) | pushed on `feat/bean-classroom-intelligence-ci2`; branch **synchronised with main** by merge commit `3980992` (zero content delta; verified `1339/0` tests + lint green on the merge tip before push); follow-up PR to main remains an **owner manual action** — the sandbox holds a push-only deploy key, no PR-creation credential (documented per `docs/GIT-BRANCH-HYGIENE.md` step 11) |
| CI-3 branch | `feat/bean-classroom-intelligence-agent-fleet` cut from `origin/main` = `d6ef917` (rule 1 of the branch hygiene policy) |
| Suite state at CI-3 start | `bun test` 1339 pass / 0 fail (94 files, 7747 expect calls); lint clean |

The full LiveKit Agents JS monorepo was cloned at source level for inspection
(not adopted as a whole): `github.com/livekit/agents-js`, inspected 2026-11-24.

---

## 1. What BEAN already has (CI-1/CI-2 audit result)

The existing CI subsystem is the starting architecture (charter section 3.7).
Audited seams and why they matter for CI-3:

| Existing seam | Location | CI-3 role |
|---|---|---|
| `CiModelAdapter` interface + `ServerProviderAdapter` (z-ai-web-dev-sdk via `src/lib/riishe/ai.ts` chat()) | `src/lib/ci/model-adapter.ts` | per-specialist model selection (model tiers, charter §13.2) without touching call sites; process-level injection already used by tests/benches |
| Durable evaluation queue — CAS claim, 60s lease/heartbeat, bounded retries (3), idempotent enqueue (P2002 re-read), consent re-check at claim, lease recovery | `src/lib/ci/queue.ts`, `ClassroomEvaluationJob` (schema: `classSessionId @unique`, `status/leaseUntil` index) | the fleet's dispatcher extends this queue with a task-identity scheme; **no second job engine** (charter §16.2) |
| Append-only agent-run audit rows (`ClassroomAgentRun`: agent, status, attempt, modelId, inputDigest, outputJson, durationMs) | Prisma model | already generic — specialists record the same way; CI_AGENT enum extended |
| Evidence system — authorised bundle, digest, evidence view (aggregates only), evidence-ref register rows | `src/lib/ci/evidence.ts` | specialists receive only their scoped bundle slice; refs already persisted per report |
| Zod contracts + `normaliseStructuredOutput` (invented-kind dropping, synonyms) | `src/lib/ci/schemas.ts` | extended per-role contracts, aligned with charter §12 envelope |
| Deterministic orchestrator (pure, conflict-preserving, insufficient-evidence flags) | `src/lib/ci/agents/orchestrator.ts` | stays the single report builder (Agent 16); critic/auditor feed it, never replace it |
| Consent gate (`ConsentRecord` purpose `CLASSROOM_INTELLIGENCE_TEACHER`, checked at enqueue AND claim) | `src/lib/ci/trigger.ts`, `queue.ts` | observer dispatch reuses the same purpose plus observer-specific checks |
| LiveKit integration — `createParticipantToken` (least-privilege grants), guarded RoomService ops, verified idempotent webhook, budget reservation | `src/lib/livekit/*`, `src/app/api/webhooks/livekit/route.ts` | the observer adapter extends this seam (probe proof C1) |
| Trust & Safety — disputes, append-only event history, reviewer separation, admin-only inspection, account export/deletion cascades | routes + `tests/unit/ci2-*.test.ts` | untouched semantics; new agents never make Trust decisions (charter §15.5) |

Known small gap (noted, scheduled): `CI_TRIGGER.ADMIN_RETRY` is defined but no
route uses it yet — an admin retry endpoint is a candidate CI-3C unit, not a
blocking gap.

**Greenfield in CI-3**: no programmatic LiveKit participants exist anywhere;
no specialist registry, domain packs, or language capability registry exist.
Both facts verified by repo-wide search.

---

## 2. `livekit/agents-js` source-level inspection

Monorepo `@livekit/agents-monorepo` at version **1.10.1** (`agents` package),
41 plugin workspaces. Licence **Apache-2.0** (LICENSE + NOTICE verified in the
clone; copyright "Copyright 2024 LiveKit, Inc.").

### 2.1 What the framework actually is

A standalone **agent server runtime**, not an embeddable library:

- `agents/src/worker.ts` defines `AgentServer` (aliased `Worker`/`WorkerOptions`)
  that registers with a LiveKit server's worker service, receives job
  assignments, and runs each job — historically in forked subprocesses
  (`JobProcess`, `defaultInitializeProcessFunc`, `fork()` in worker.ts).
- Real-time voice pipeline centred on `AgentSession`, RoomIO, STT/LLM/TTS
  streams, turn detection, VAD — `agents/src/{voice,stt,tts,llm,vad,inference}/`.
- Heavy operational dependencies: OpenTelemetry SDK suite (trace/logs/metrics +
  OTLP exporters), `pino`, `sharp` (native image lib), `fluent-ffmpeg`
  (requires an ffmpeg binary), `commander` CLI, `@livekit/av` media stack.

### 2.2 Why the full framework is NOT adopted for CI-3 (recorded decision)

1. **It duplicates BEAN's job infrastructure.** Its job/worker lifecycle would
   run beside BEAN's proven durable queue (CAS/lease/retry/idempotency,
   charter §16.2 forbids a duplicate engine). BEAN's specialists are
   post-class, queue-dispatched workers — not per-room job processes.
2. **Structured-only observation needs no voice pipeline.** CI-3D is Mode A
   (charter §9.1): lifecycle + structured evidence only, no STT/TTS. The
   framework's core value (real-time media processing) is out of scope; its
   audio deps (ffmpeg/sharp) would be dead weight and a new attack/ops surface.
3. **Process model mismatch.** Forked job subprocesses + OTel exporters do not
   fit a single-node Next.js 16 + Bun + SQLite deployment (ADR-011
   single-writer), and complicate bundling, sandboxing and upgrades.
4. **CI-1A already rejected the Python sibling** for the same architectural
   reasons; the JS sibling is closer (TypeScript) but carries the same
   runtime-shape mismatch.

### 2.3 What IS reused — the FilmCraft-style minimal path (verified)

The framework's room-presence capability rests on two layers, and BEAN adopts
exactly those, without the framework:

| Upstream component | Version | Role in BEAN | Licence (verified) |
|---|---|---|---|
| `@livekit/rtc-node` | 1.2.3 (npm; current) | the Node RTC room-join engine — lets the observer be a **genuine, visible programmatic participant** with the full room event surface | Apache-2.0 (npm registry metadata + installed package) |
| `livekit-server-sdk` | 2.20.0 (**already a BEAN dependency**, no new install) | explicit agent dispatch (`AgentDispatchClient.createDispatch/getDispatch/listDispatch`) + least-privilege observer identity tokens | Apache-2.0 (installed package manifest) |

LiveKit's own dispatch documentation recommends explicit dispatch for
production; charter agent 00 requires "explicit LiveKit dispatch for the
observer only when eligible" — `AgentDispatchClient` provides exactly this
with zero new dependencies (B1 proof below). `@livekit/rtc-node` adds native
prebuilt bindings (`@livekit/rtc-ffi-bindings-linux-x64-gnu`) — one new
package, small dependency footprint (pino, mutex, typed-emitter, deque).

Upgrade path: both packages are versioned npm artefacts; BEAN pins exact
versions in `package.json`, records the provenance in this document and in
`docs/THIRD-PARTY-NOTICES.md`, and can track `agents-js` releases
(`@livekit/agents` CHANGELOG) for rtc-node/API changes without importing the
framework.

### 2.4 Alternatives evaluated and rejected / deferred (charter §3.3)

| Candidate | Licence (verified 2026-11-24) | Decision |
|---|---|---|
| Agno (`agno-agi/agno`) | Apache-2.0 (raw LICENSE verified) | **Not adopted.** Durable services/scheduling/human-approval features duplicate BEAN's queue, report lifecycle and dispute/admin workflow. Revisit only if a measured, documented gap appears. |
| LangGraph (`langchain-ai/langgraph`) | MIT (raw LICENSE verified) | **Not adopted.** CI-1A decision stands: a second workflow engine duplicates BEAN queue semantics. Comparison candidate only. |
| CrewAI | MIT (upstream statement; charter reference) | **Not adopted.** No second persona framework just to add named agents (charter §3.3). |
| LiveKit Agents **Python** | Apache-2.0 (CI-1A verified) | **Not adopted.** Python sidecar adds deployment surface; JS path covers current needs. Deferred unless a materially better Python-only model integration appears (charter §3.2). |
| Omnilingual ASR (`facebookresearch/omnilingual-asr`) | Apache-2.0 (raw LICENSE header verified: "Copyright 2025 (c) Meta Platforms, Inc. and affiliates... Apache License") | **Evaluated in CI-3F, not adopted as a dependency.** Resource figures (300M ≈1.3 GiB / 1B ≈3.7 GiB / 7B ≈25 GiB) are upstream reference numbers, not BEAN benchmarks. Speech processing stays disabled until the separate consent/legal gate passes (charter §8.4, §9.2). |
| Qwen3 | Apache-2.0 for open-weight models per repo README (charter reference; GitHub API licence detection unavailable for this repo at verification time — to recheck before any adoption) | **Benchmark candidate only** in the model-adapter harness; BEAN's default provider is unchanged without measured domain/language wins (charter §3.6). |
| ESCO / O*NET 31.0 / UNESCO ISCED-F 2013 | O*NET: CC BY 4.0 (attribution + exceptions); ESCO: free reuse with attribution — exact terms to re-read before import; ISCED-F: free for educational reuse with attribution | **Seed taxonomies** for the CI-3B registry adapters. No dataset enters the knowledge base until licence, version and attribution are recorded in the source registry (charter §3.5, §7.3). Not imported in CI-3A. |

---

## 3. Minimal integration proof (reproducible)

`scripts/ci3-probe-upstream.ts` — run with `bun scripts/ci3-probe-upstream.ts`.
Environment: bun 1.3.14, node v24.3.0, linux/x64. **Result 2026-11-24: 6/6 PASS.**

| Proof | What it establishes |
|---|---|
| A1 | `@livekit/rtc-node` native runtime loads in this environment; a `Room` instantiates with `connectionState = CONN_DISCONNECTED` — the prebuilt native binding is functional, not merely importable |
| A2 | The complete observer-required event surface exists: ParticipantConnected, ParticipantDisconnected, DataReceived, TrackSubscribed/Unsubscribed, Disconnected, Reconnecting, Reconnected, ConnectionStateChanged, RoomMetadataChanged (33 events, 6 connection states) |
| A3 | `Room.connect`/`Room.disconnect` lifecycle surface present — genuine visible programmatic participation is possible |
| B1 | `AgentDispatchClient` (createDispatch/getDispatch/listDispatch) available in the already-installed `livekit-server-sdk@2.20.0` — explicit, eligibility-gated dispatch with **zero new dependencies** |
| B2 | Observer identity token minted with roomJoin-only least-privilege grants (canPublish=false, canPublishData=false, no roomAdmin) and disclosed metadata — the observer cannot publish media or control the room |
| C1 | BEAN's existing seam (`src/lib/livekit/config`: `createParticipantToken`/`isLivekitConfigured`/`livekitRoomService`) imports cleanly — the observer adapter extends it rather than introducing a parallel one |

Honest limitation: the sandbox has **no LiveKit server** (env placeholders per
`docs/PHASE5_LIVEKIT_SETUP.md`), so the probe proves the runtime/API surface,
not a live room join. CI-3D adds contract tests over a deterministic room
client seam; a live join against the owner's configured LiveKit project
remains an explicit manual verification item.

---

## 4. Final CI-3 architecture decision (recorded for CI-3B…CI-3H)

1. **No new orchestration framework.** Agno/LangGraph/CrewAI/full
   `@livekit/agents` are all rejected for the same class of reason: they
   duplicate infrastructure BEAN already owns (queue, evidence, trust,
   approval) or carry runtime weight (voice pipelines, forked processes,
   OTel/ffmpeg/sharp) that structured-only education intelligence does not
   need. BEAN-native durable workflow remains the system of record.
2. **Observer adapter = `@livekit/rtc-node` + `livekit-server-sdk`.** One
   visible observer per eligible consented room, explicit dispatch only,
   least-privilege identity, structured-only mode. The adapter is a thin,
   typed seam so that a future Mode B (consented audio) could adopt the full
   agents framework *inside the adapter* without changing BEAN's queue,
   contracts or trust surfaces.
3. **Specialist fleet = BEAN-defined roles** on the existing queue:
   typed registry + versioned contracts (CI-3B), domain-aware dispatcher with
   bounded pools (CI-3C), specialist roles with knowledge packs and rubrics
   (CI-3E) — all recorded in the append-only `ClassroomAgentRun` audit.
4. **Multilingual capability is measured, not claimed** (CI-3F): a
   `LanguageCapabilityRegistry` with per-task statuses; speech processing
   remains disabled behind the consent/legal gate; ASR candidates are
   benchmarked, never assumed.
5. **Taxonomy sources enter only through the licence-gated source registry**
   (CI-3B); nothing is scraped or imported into prompts wholesale (charter §7).
6. **Third-party attribution is maintained** in `docs/THIRD-PARTY-NOTICES.md`
   from CI-3A onward, covering every package the CI-3 code path imports.

Dependency delta for CI-3A: **+1 package** (`@livekit/rtc-node@1.2.3`, Apache-2.0).
Everything else reuses existing dependencies.
