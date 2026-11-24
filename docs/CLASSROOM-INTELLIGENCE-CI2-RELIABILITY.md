# Classroom Intelligence CI-2F — Multi-Class Reliability, Recovery and Load

Milestone: CI-2 (branch `feat/bean-classroom-intelligence-ci2`). CI-1 verified individual evaluation runs; CI-2F verifies many classes and workers operating concurrently, recovery from failure, and measured load — all against isolated test databases with synthetic classes (never real student data).

## 1. Scenario coverage (tests/unit/ci2-reliability.test.ts — 6 tests, deterministic stub adapter)

| # | Scenario | Test | Verified behaviour |
| --- | --- | --- | --- |
| 1 | Multiple completed classrooms trigger evaluation simultaneously | C1+C2 | 6 classes enqueued via concurrent duplicate triggers → exactly 6 jobs (DB-unique guarantee), no duplicates |
| 2 | Duplicate LiveKit webhooks | C1+C2 | the second trigger reuses the in-flight job (`alreadyQueued`); concurrent create-races on the UNIQUE constraint are now caught and resolved by re-reading the winner (hardening fix in `queue.ts` — see below) |
| 3 | Queue worker exits during an evaluation | C4 | claim → lease expires → `recoverExpiredCiLeases` re-queues honestly |
| 4 | A worker loses its lease | C4 | same recovery path; attempts preserved |
| 5 | Heartbeat delayed | C4 | lease expiry (12 min) is the recovery bound; recovery keeps attempts for bounded retries |
| 6 | A stale lease is recovered | C4 | re-queued with attempts=1; after two more failing runs the job is terminal |
| 7 | An AI provider times out | C4 | attempts 2 and 3 fail honestly → terminal FAILED with the provider error; **no partial reports, no summaries; class, live session and bookings untouched** |
| 8 | An AI provider returns malformed output | C5 | strict retry inside the adapter, then honest per-agent FAILED rows; the judge never ran; zero artefacts |
| 9 | A database operation fails | C4/C5 | failures surface as job errors with bounded retries; nothing partial is published (publish is a single transaction) |
| 10 | A dispute is opened while report processing occurs | C8 | teacher re-request during an open dispute creates a NEW version; the disputed version is SUPERSEDED (never deleted/rewritten); dispute + its event history remain intact and still point at the original version; summaries stay exactly one per ATTENDED booking |
| 11 | Consent withdrawn before evaluation claim | C6 | claim-time consent re-check SKIPS the job (`consent_not_granted`) — no evaluation runs |
| 12 | An evaluation is retried | C7 | flaky provider (first call fails) → retry completes; exactly ONE CURRENT report per class, exactly ONE summary per ATTENDED booking, all rows anchored to the same job |
| 13 | An already completed task receives another webhook | C1+C2 (+ CI-1 Q4) | auto-triggers are deduplicated (`already_evaluated`); only explicit teacher/admin re-requests reset a job |

Explicit guarantees asserted: atomic claims (a job is never claimed twice across concurrent claims and follow-up drains), idempotent job creation, lease ownership + bounded retry policy (maxAttempts=3), correct final statuses, no duplicate reports or student summaries, no lost dispute history, no cross-class data leakage, and no impact on the underlying classroom (class status, live session, bookings unchanged after terminal failure).

### Hardening fix produced by CI-2F

The concurrency test exposed a real defect in `enqueueEvaluation`: two simultaneous triggers for the same class raced the `classSessionId` UNIQUE constraint and the loser crashed with an unhandled P2002 (the lifecycle trigger would have swallowed it, but the enqueue outcome was lost). Fixed: the loser now re-reads the winner's job and reports it as `alreadyQueued` — full idempotency under duplicate webhooks.

## 2. Measured load (scripts/bench-ci2-reliability.ts — isolated DB, deterministic stub adapter)

The stub adapter measures QUEUE AND PIPELINE MECHANICS (enqueue, CAS claims, retries, transactional publish) with no model latency. Real-provider latency dominates end-to-end wall clock in production (~15–40 s/evaluation, measured in CI-1); the numbers below quantify what the queue itself adds.

| Batch (classes) | Claim concurrency | Duplicate-trigger enqueue | Drain time | Throughput | Completed | Double claims | Retries | Reports | Summaries | RSS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 1 | 20 ms | 124 ms | 32.3 eval/s | 4/4 | 0 | 0 | 4 (4 classes) | 8 | 100→107 MB |
| 8 | 2 | 25 ms | 146 ms | 54.8 eval/s | 8/8 | 0 | 0 | 8 (8 classes) | 16 | 109→113 MB |
| 16 | 4 | 34 ms | 229 ms | 69.9 eval/s | 16/16 | 0 | 0 | 16 (16 classes) | 32 | 114→119 MB |
| 32 | 8 | 69 ms | 567 ms | 56.4 eval/s | 32/32 | 0 | 0 | 32 (32 classes) | 64 | 119→127 MB |

Observations:

- **Zero double claims** at every tested level; every class produced exactly one CURRENT report and one summary per ATTENDED booking.
- **Memory is flat** (RSS growth ≈ batch working set, no leak signature).
- **SQLite single-writer contention is real**: an early 16×4 run without a serialised pool hit Prisma socket timeouts (`P1008`) under 4 concurrent transactional publishes. The benchmark now runs with `connection_limit=1` — the honest single-node SQLite configuration (ADR-011) — under which writes serialise and throughput plateaus around 56–70 eval/s of pure queue mechanics. Deployments that need higher write concurrency need a different database, and that boundary is documented rather than hidden.
- Concurrent claims are bounded (`take 5` per tick): a burst of 6+ concurrent claims can leave jobs for the next tick — asserted as atomicity-never-completeness in the tests, with the follow-up claim draining the rest.

## 3. Honest limitations

- The deterministic stub adapter proves queue/pipeline mechanics, NOT model-output quality at load — the live provider was verified for single runs (CI-1 bench, CI-2B live harness), not for a 32-class live burst.
- The tested concurrency levels are 1–8 concurrent claimers and up to 32 classes per batch on one SQLite file. These are the actually-tested numbers; no claim is made beyond them.
- Worker parallelism in production is one sequential loop per process (by design — provider calls dominate); multi-process scale-out was simulated at the claim level only.
