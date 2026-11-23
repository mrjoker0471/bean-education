# BEAN Classroom Intelligence — Open-Source Research (CI-1A)

Milestone: **CI-1A — Research and architecture**
Scope: study the three candidate open-source projects, compare them against the
actual BEAN Education deployment reality, and record the final architecture
decision with honest reasons. Facts below were verified against the live
GitHub API / package registries and the projects' own licence files on the
verification date **2026-11-23**. Nothing here is copied from the projects —
BEAN integrates none of their code in this milestone, so no licence notices
are triggered; if that ever changes, the upstream licence and copyright
notices will be reproduced in full in this repository.

---

## 1. Candidate A — LiveKit Agents (`livekit/agents`)

| Fact | Verified value (2026-11-23) |
|---|---|
| Repository | https://github.com/livekit/agents |
| Language | **Python** (`requires-python >=3.10`) |
| Licence | **Apache-2.0** (pyproject + GitHub API) |
| Activity | pushed 2026-11-23; latest release `livekit-agents@1.8.13` (2026-11-18); ~15.3k stars; ~1.0k open issues |
| Runtime shape | a separate long-running **worker process** that joins LiveKit rooms as an agent participant; carries `livekit`, `livekit-api`, `livekit-local-inference`, `aiohttp`, `psutil`, protobuf and more |
| Core value | real-time media: room/track event handling, speech-to-text worker loops, agent lifecycle, turn detection |

**What it would give BEAN**: an in-room agent runtime that can subscribe to
authorised audio tracks, run STT, and emit transcripts in real time.

**Why it is NOT adopted for CI-1**:
1. **It is a Python worker.** BEAN is a single-node Next.js 16 + Bun + SQLite
   deployment. Adding a Python service means a second runtime, a second
   process supervisor, and a second deployment artifact — a large operational
   step for one milestone.
2. **It is a speech pipeline.** Its headline value is STT over room audio.
   BEAN's classroom is **live-only by documented policy** (docs/PHASE5_SECURITY.md:
   "No media is ever recorded, stored or replayed"). Capturing student audio
   for transcription would be a material privacy/safeguarding expansion —
   requiring its own consent architecture (including verifiable parental
   consent for minors) that does not exist yet. CI-1 therefore observes
   **structured classroom events** (the already-authorised LiveKit webhook
   stream) and never audio.
3. **No STT credentials exist** in this deployment; claiming transcription
   capability without a real provider would be dishonest.

**Upgrade path (documented, not built)**: when BEAN later opts into
consent-gated, disclosed transcription, a LiveKit Agents worker is the right
tool. This document reserves that decision for a future milestone (CI-2+)
with its own consent work.

---

## 2. Candidate B — LangGraph (`langchain-ai/langgraph`)

| Fact | Verified value (2026-11-23) |
|---|---|
| Repository | https://github.com/langchain-ai/langgraph |
| Languages | **Python** (primary) and **TypeScript** (`@langchain/langgraph`) |
| Licence | **MIT** (LICENSE file: "Copyright (c) 2024 LangChain, Inc.") |
| Activity | Python release `1.2.24` (2026-11-20); npm `@langchain/langgraph` `1.7.5` |
| Runtime shape | a graph-orchestration library: state machines ("graphs") over agent steps, optional durable checkpointers, human-in-the-loop interrupts |

**What it would give BEAN**: orchestration, persistent workflow state,
structured evaluation pipelines, human approval checkpoints — the exact
categories the CI-1 brief asks to evaluate.

**Why it is NOT adopted for CI-1**:
1. **The orchestration capability already exists in BEAN.** BEAN ships a
   durable job runner (`src/lib/riishe/jobs.ts` on `RiisheJob`): atomic CAS
   claims, lease-based recovery with heartbeats, bounded retries, per-owner
   limits, durable hourly quotas. The CI-1 evaluation is a **linear,
   five-stage pipeline** (evidence → learner → teacher-judge → orchestration →
   publish) with a human review step that is *already a BEAN domain concept*
   (Trust & Safety disputes/appeals). A graph library adds its own state
   model on top of a state model BEAN owns.
2. **Dependency weight vs. benefit.** Even the TS edition pulls the
   `@langchain/*` family (`langgraph-checkpoint`, `langgraph-sdk`,
   `@langchain/protocol`, and transitively `langchain-core`) into the
   production bundle for a pipeline BEAN can express in ~3 pure modules plus
   the existing queue.
3. **Checkpointing targets it solves** (multi-node resume, cross-process
   state) are solved differently in BEAN: single-node SQLite with serialised
   writers + lease recovery is the deployed reality.

LangGraph remains the **first candidate to revisit** if CI grows beyond a
linear pipeline (branching agent graphs, sub-graph reuse, multi-tenant
checkpoints). This is a recorded reconsideration trigger, not a vague "maybe".

---

## 3. Candidate C — CrewAI (`crewAIInc/crewAI`)

| Fact | Verified value (2026-11-23) |
|---|---|
| Repository | https://github.com/crewAIInc/crewAI |
| Language | **Python** |
| Licence | **MIT** (LICENSE: "Copyright (c) 2025 crewAI, Inc.") |
| Activity | pushed 2026-11-23; release `1.15.44` (2026-11-19); ~61.2k stars; ~1.3k open issues |
| Runtime shape | Python framework for role-playing "crews" of agents with tasks/tools |

**Why it is NOT adopted for CI-1**:
1. **Python-only** — same deployment objection as Candidate A, with none of
   Candidate A's LiveKit-native benefit.
2. **Role-play abstraction mismatches the task.** CI-1 agents are validators
   over typed evidence with Zod-schema-enforced outputs and honest
   "insufficient evidence" states — not conversational personas delegating
   tasks to each other. CrewAI's abstractions (crew goals, delegated tasks)
   do not map onto "validate evidence, refuse to invent it".
3. **Commercial-licence nuance**: the core repo is MIT, but CrewAI ships
   enterprise/managed offerings around it; adopting it would additionally
   require tracking which parts of the ecosystem carry non-MIT terms. Not
   worth that overhead for zero adopted code.

---

## 4. Decision

**Adopted architecture: BEAN-native multi-agent pipeline.**

- **Runtime**: a dedicated durable job runner for classroom evaluations
  (same CAS/lease/heartbeat/retry semantics BEAN already trusts), driven by
  a deterministic five-stage state machine.
- **Agents**: three specialist modules — BEAN Learner Agent, BEAN Teacher
  Judge Agent, BEAN Evaluation Orchestrator — as typed, unit-testable
  functions whose outputs are validated against Zod schemas before anything
  is persisted. The Orchestrator's final-report builder is a **pure function**
  so dispute corrections can rebuild a report version without a new model call.
- **Model access**: a swappable adapter layer (`ModelAdapter`) with the
  existing server provider as the default implementation and graceful
  failure classification (unavailable → honest FAILED with retry, never
  fabricated output). Provider identity is never exposed in student-facing UI.
- **Observation**: structured classroom events and authorised text only —
  booking/attendance records, verified connection intervals, teacher-authored
  whiteboard snapshots, the class lesson plan, and opt-in teacher lesson
  notes. No audio, no video, no hidden capture, no continuous recording.
- **Human review**: mandatory for consequential use — AI findings are
  advisory; disputes flow through a teacher-facing dispute flow reviewed by
  BEAN admins; nothing automatic touches reviews, moderation, payments or
  safeguarding.

### Rejected components and reasons (summary)

| Component | Reason |
|---|---|
| LiveKit Agents worker (CI-1) | Python worker + STT credentials + audio-consent architecture do not exist; BEAN classrooms are live-only |
| LangGraph (CI-1) | duplicates BEAN's durable orchestration; adds the langchain dependency chain for a linear pipeline |
| CrewAI (CI-1) | Python-only; persona/crew abstraction mismatches evidence-validation task; ecosystem licence tracking overhead |

### Smallest useful components identified (for future milestones, none adopted now)

- LiveKit Agents: its `rtc` room/participant event vocabulary — BEAN already
  implements the equivalent idempotent webhook accounting itself.
- LangGraph: the "interrupt / resume with human decision" checkpoint pattern —
  mirrored by BEAN's dispute state machine.
- CrewAI: none for CI-1.

---

## 5. Dependency, infrastructure and resource implications

- **New runtime dependencies in this milestone: zero.** The pipeline uses the
  existing Prisma client, the existing provider wrapper pattern, and Zod
  (already a dependency) for schema validation. `bun.lock` is unchanged by
  CI-1A–1F except where existing tooling requires it (it does not).
- **Infrastructure**: runs inside the existing Next.js server process as a
  background worker loop (non-blocking, lease-bounded), using the existing
  SQLite database. No GPU, no model download, no new service, no new port.
- **Model compatibility**: the adapter interface accepts any provider that
  can return text completions; structured output is enforced by schema
  validation after generation (tolerant JSON extraction, one strict retry),
  not by provider-specific modes.
- **Security implications**: no third-party agent code executes in-process;
  agent "tools" are BEAN service functions with server-side ownership
  checks; all classroom text is fenced as untrusted data before reaching a
  model (prompt-injection defence carried over from the Riishe engine).
- **Maintenance risks**: the adopted code is BEAN-owned and small; the
  external dependency is the model provider itself, whose failure modes are
  classified and surfaced honestly (job FAILED + retryable), never hidden.

## 6. Estimated resource requirements (CI-1, measured and documented)

Per evaluation of one class: 2–4 model calls (learner, teacher-judge, plus
one strict retry worst-case each) and a pure orchestration step. Measured
figures are recorded in `docs/CLASSROOM-INTELLIGENCE-RESULTS.md` (CI-1F) —
this document only states the design budget: wall-clock seconds per
evaluation, single-digit DB rows per stage, no resident model memory. The
normal BEAN Education application must keep working when the evaluation
service is unavailable or the provider is down; classroom booking, live
sessions and attendance never wait on this pipeline.
