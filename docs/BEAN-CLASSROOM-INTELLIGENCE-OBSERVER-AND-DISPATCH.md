# BEAN Classroom Intelligence — Observer Controls & Post-Class Dispatch (CI-4G)

Milestone: CI-4G. Date: 2026-11-25.
Implementation: teacher UI `observer-controls.tsx`, student disclosure `observer-disclosure.tsx` (wired into `classroom-shell.tsx`), feature flag + lifecycle wiring in `dispatcher.ts` / `live/end/route.ts` / `webhooks/livekit/route.ts`, capacity benchmark `scripts/ci4-capacity-benchmark.ts`.

## 1. Teacher-facing observer controls (new, uses the REAL CI-3D API)

`ObserverControls` (teacher surfaces) — every state comes from the actual owner-only API (`GET/POST/DELETE /api/teach/classes/:id/live/observer`; server re-checks ownership, consent, LIVE state, pool capacity and provider configuration on every call):

- **Availability**: the panel states the prerequisites and renders the API's typed refusals (401/403/404/409/503) as first-class messages — never hidden.
- **Status**: real session row — `PLANNED / CONNECTING / OBSERVING / LEFT / FAILED / CANCELLED`, reconnect count, connected seconds, left-reason, media-access provenance (`none (cannot publish or subscribe)`), transcription (`disabled — no audio is processed`), failure alerts.
- **Enable / Withdraw**: explicit teacher actions; withdrawal mid-class is honoured at the next consent/heartbeat check (CI-3D semantics) and never affects attendance, booking or completion records.
- **Plain-words disclosure** is part of the control itself: "it cannot listen or watch (no audio/video access), cannot publish anything, and records only aggregate, identity-free signals".

## 2. Student disclosure (new, in-room)

`ObserverDisclosure` renders for EVERYONE in the room when the observer participant is present — detected by the `bean-observer:` identity prefix, the same convention the webhook attendance accounting excludes, so the disclosure and the "no fake attendance" guarantee can never drift apart. The wording states plainly: visible in the participant list, structured signals only, **no audio or video is being recorded**, teacher-controlled. No implication of recording exists anywhere; no fake participant states are generated.

## 3. Safe post-class fleet dispatch (feature-flagged, OFF by default)

New helper `shouldAutoDispatchFleet()` + `autoDispatchFleetForEndedSession()` in `dispatcher.ts`:

- `BEAN_CI_FLEET_AUTO_DISPATCH` must be **exactly `'true'`** — anything else (unset, `false`, `TRUE`, `1`) keeps dispatch OFF and preserves the CI-3 manual/explicit behaviour (tested).
- When enabled, the two lifecycle hooks (`live/end` for teacher-ended sessions, `room_finished` webhook for provider-ended ones) fire a fire-and-forget dispatch for the now-TERMINAL class.
- **The flag alone can never bypass consent**: `dispatchFleetForSession` re-checks CI consent at dispatch, and the worker re-checks it at every claim. Tested end-to-end: flag ON + no consent ⇒ zero queue rows.
- Duplicate webhook events are idempotent at the queue (`taskKey` UNIQUE). Specialists NEVER enter live rooms — only the single visible observer can.
- Deployment note: enable the flag only after the product consent setup is complete in that deployment; the flag is per-environment configuration, not a code default.

## 4. Multi-class capacity (measured 2026-11-25, isolated real SQLite, deterministic executor)

`scripts/ci4-capacity-benchmark.ts` — 20 synthetic ended classrooms × 7 charter-real tasks (core 2 + audit 2 + domain 1 + enrichment 2 = 140 tasks), drained through the REAL bounded worker pool at increasing concurrency:

| Worker concurrency | Wall time | Throughput | Per-task cost |
|---|---|---|---|
| 4 | 877 ms | 160 tasks/s | 6.26 ms/task |
| 8 | 674 ms | 208 tasks/s | 4.81 ms/task |
| 16 | 541 ms | 259 tasks/s | 3.86 ms/task |

- Terminal invariants: 140/140 COMPLETED, 0 FAILED (deterministic executor; consent re-checked at claim).
- Throughput scales +62% from 4→16 workers on this machine, with visibly diminishing per-worker gains — consistent with SQLite's single-writer behaviour.

**Honest limits (do not over-read these numbers):**

1. The executor is a deterministic no-op — these numbers measure the QUEUE MACHINERY (claims, leases, state transitions), NOT model latency. Real specialist runs are model-bound and will be far slower per task.
2. SQLite is a **single-writer** database. Concurrent worker processes on one file contend on writes; horizontal scale ("N simultaneous classrooms on M machines") is NOT claimed and was NOT measured. The deployment limit is one app instance per database file.
3. The benchmark is synthetic and isolated — real-classroom throughput depends on provider latency, evidence volume and backlog backpressure (enrichment skips honestly at QUEUED > 50, unchanged from CI-3).
4. "20 classrooms in under a second of machinery time" must never be quoted as "20 simultaneous classrooms supported" — the charter's wording is deliberate.

## 5. Tests

`tests/unit/ci4-classroom-operation.test.ts` — G1 flag semantics (exact-match, default off) · G2 end-to-end through the REAL dispatcher/worker on an isolated DB: flag off ⇒ nothing queued; flag on + no consent ⇒ nothing queued (consent gate holds); flag on + consent ⇒ charter task set queued, repeat dispatch idempotent via taskKey · G3 disclosure identity convention (prefix matches the webhook exclusion exactly; no student-identity collision).
