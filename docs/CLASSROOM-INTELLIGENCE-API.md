# BEAN Classroom Intelligence — API Reference (CI-1)

All routes are Next.js App Router handlers (`runtime: nodejs`). Identity comes
exclusively from the httpOnly session cookie; no route trusts a client-supplied
user id, role or state. Mutating routes enforce same-origin. Error bodies are
`{ "error": string }`; success bodies are JSON.

## Teacher — consent & overview

### `GET /api/teach/classroom-intelligence`
**Auth**: approved teacher. Returns the caller's consent state and their
ended-class evaluation landscape (rows scoped to the caller's profile only).

```json
{
  "consent": { "granted": true, "grantedAt": "…", "withdrawnAt": null },
  "evaluated":  [ { classEvaluationSummary } ],
  "pending":    [ { classEvaluationSummary } ],
  "eligible":   [ { classEvaluationSummary } ],
  "totals": { "evaluatedClasses": 3, "requiresReview": 1 }
}
```
`classEvaluationSummary` = `{ classSessionId, title, subject, startsAt, timeZone,
durationMinutes, evaluation: { jobId, status, stage, trigger, error, updatedAt } | null,
currentVersion, insufficientEvidence, requiresHumanReview }`.
`evaluated` = COMPLETED jobs; `pending` = QUEUED/RUNNING; `eligible` = no job or
FAILED/SKIPPED (can be requested).

### `POST /api/teach/classroom-intelligence`
Body `{ "granted": boolean }`. Grants or withdraws CI consent
(`ConsentRecord` purpose `CLASSROOM_INTELLIGENCE_TEACHER`). Withdrawal stops
future evaluations immediately (enforced at enqueue AND claim time). Idempotent.
Returns `{ "consent": … }`.

## Teacher — per-class evaluation

### `GET /api/teach/classes/:id/evaluation`
**Auth**: the class's owner teacher (anyone else → 404). Returns the job
status and ALL report versions (newest first), each with the parsed report.

```json
{
  "classSession": { "id", "title", "subject", "startsAt", "timeZone", "durationMinutes" },
  "job": { "jobId", "status", "stage", "trigger", "error", "updatedAt" } | null,
  "versions": [ {
    "id", "version", "status", "createdAt",
    "insufficientEvidence", "requiresHumanReview", "modelId",
    "report": { …FinalReport… }, "reportError": null
  } ]
}
```

### `POST /api/teach/classes/:id/evaluation`
**Auth**: the class's owner teacher; CI consent required (403 otherwise).
Body (optional): `{ "teacherNotes": "30..4000 chars" }` — opt-in teacher
lesson notes that become authorised evidence for this evaluation only.

Outcomes:
- `200 { "queued": true, "jobId", "alreadyQueued" }` — an in-flight job is reused;
  a terminal job is reset for a fresh run (next report VERSION).
- `403` consent not granted · `404` class not found/not owned ·
  `409` no live session / session not terminal / already evaluated.

### `DELETE /api/teach/classroom-intelligence/reports/:reportId`
**Auth**: the report's owner teacher. Deletes one report version + its
evidence register. `409` while a dispute on that report is open.

## Teacher — disputes

### `POST /api/teach/classroom-intelligence/reports/:reportId/dispute`
**Auth**: the report's owner teacher. Body:
`{ "findings": [ { "findingId": "judge-2", "reason": "20..1000 chars" } ] }`
(1–10 findings; every id is verified against the stored report).
Creates a `SUBMITTED` dispute + append-only event. `409` if a dispute is
already open or the report is retracted.

### `GET /api/teach/classroom-intelligence/disputes`
The caller's disputes with full append-only history.

## Admin — human review

### `GET /api/admin/classroom-intelligence/disputes`
**Auth**: ADMIN. The dispute queue (oldest first) with report, class and
event history.

### `POST /api/admin/classroom-intelligence/disputes/:id/action`
**Auth**: ADMIN. Body:
```json
{ "action": "ASSIGN" | "UNDER_REVIEW" | "RESOLVE" | "DISMISS",
  "resolution": "UPHELD" | "CORRECTED" | "RETRACTED",   // RESOLVE only
  "note": "10..1000 chars" }                             // RESOLVE/DISMISS mandatory
```
- `UPHELD` — findings stand; dispute closes.
- `CORRECTED` — the report is rebuilt WITHOUT the disputed findings by the
  pure orchestrator (deterministic, no model call; `modelId: null`); the
  disputed version becomes `SUPERSEDED`. `409` when the stored agent outputs
  are unavailable (use `RETRACTED`).
- `RETRACTED` — the report is marked `RETRACTED`; nothing is deleted.

## Student — class summaries

### `GET /api/learn/class-summaries`
**Auth**: signed-in student. The caller's own class-level learning summaries,
scoped by `booking.studentId` (one row per ATTENDED booking). Malformed stored
rows are skipped honestly.

```json
{ "summaries": [ {
  "bookingId", "classSessionId", "title", "subject", "startsAt", "timeZone",
  "summary": {
    "classId", "lessonSummary", "conceptsCovered": [ … ],
    "revisionRecommendations": [ … ], "suggestedPractice": [ … ],
    "scopeNote": "This is a class-level learning summary … not an assessment of any individual student."
  },
  "generatedAt"
} ] }
```

## Internal lifecycle (no public API)

Evaluation jobs are created by two server-internal, error-isolated triggers:
`POST /api/teach/classes/:id/live/end` (SESSION_END) and the LiveKit
`room_finished` webhook (PROVIDER_ROOM_FINISHED). Both are consent-gated and
deduplicated; they can never delay or fail the classroom operation that
triggered them. Teacher requests go exclusively through the API above.

## CI-3D — Live classroom observer (explicit dispatch, structured-only)

The observer is the charter's Agent 01 (`BEAN_CLASSROOM_OBSERVER`): ONE visible
programmatic LiveKit participant per consented room (DB-unique per live
session), joined ONLY through an explicit teacher action, in charter §9.1
**Mode A (structured-only)** — the observer subscribes to no media at all
(token `canSubscribe/canPublish/canPublishData` all `false`, `hidden: false`)
and records only identity-free aggregate signals. Audio/transcript processing
does not exist in CI-3D; `transcriptionEnabled` stays `false` on the row and in
the evidence contract.

### `GET /api/teach/classes/:id/live/observer`
**Auth**: approved class owner. Returns `{ liveStatus, observer }` where
`observer` (or `null`) is:
`{ observerSessionId, status, leftReason, consentMode, transcriptionEnabled,
canPublishMedia, reconnectCount, connectedSeconds, dispatchedAt, connectedAt,
leftAt, hasEvidence }`. Statuses: `PLANNED | CONNECTING | OBSERVING | LEFT |
FAILED | CANCELLED`.

### `POST /api/teach/classes/:id/live/observer`
**Auth**: approved class owner + same-origin. **Explicit dispatch.** All
charter §11 Phase 0 checks run server-side (ownership, approved teacher,
LIVE room, current CI consent, one-observer-per-room, global observer pool
bound, provider configured); the authorising identity is the session-resolved
teacher — never a request body. Errors are honest typed reasons with statuses
`404/403/409/503` (`class_not_found`, `teacher_not_authorised`, `room_not_live`,
`no_consent`, `already_observing`, `observer_capacity_full`,
`livekit_not_configured`). Re-dispatch after a terminal run resets the room's
single observer row (CAS-guarded) for a fresh run.

### `DELETE /api/teach/classes/:id/live/observer`
**Auth**: approved class owner + same-origin. Withdraws the observer: an
in-process run disconnects its room and finalises `CANCELLED/teacher_cancelled`;
a run owned by another process is terminal-marked directly (stale remote rows
are recovered honestly by `recoverStaleObserverSessions`, never resurrected).

### Lifecycle hooks (no public API)
`POST /api/teach/classes/:id/live/end` and the LiveKit `room_finished` webhook
also fire-and-forget `cancelObserverForEndedSession` — the observer always
leaves a finished class, and its failure can never affect attendance, booking
or class completion (charter acceptance criterion 6).

### Evidence (written once at finalisation, strictly validated)
`consentMode` (literal `STRUCTURED_ONLY`), `transcriptionEnabled` (literal
`false`), observer identity/room name, `connectedSeconds`, `reconnectCount`,
bounded `presenceSamples` (timestamps + aggregate participant counts only),
bounded `evidenceGaps` (reconnects, server restarts), `dataMessageCount`
(counts only — payloads never read), `whiteboardSnapshotVersion` (structure
count from the authorised whiteboard row). No student identities, no media, no
payloads — asserted by tests (`tests/unit/ci3-observer.test.ts`).

## CI-3E — Specialist fleet runtime (executors behind the CI-3C worker seam)

The CI-3E runtime (`src/lib/ci/fleet/runtime.ts`) is the real executor behind
`registerFleetTaskExecutor`, auto-registered wherever dispatch runs. Role map:
`BEAN_SUBJECT_EXPERT::<domain>` (source-grounded specialist), `EVIDENCE_AUDITOR`
(deterministic resolution + one bounded model challenge), `SAFETY_GUARDIAN`
(deterministic-only §14 sweep), `LEARNER`/`TEACHER_JUDGE` (deterministic mapping
of completed CI-1 pipeline runs — never a duplicate model call), `LANGUAGE`
(honest FAILED until CI-3F), enrichment coaches (honest FAILED until CI-3G).
Permanent failures (missing pack, unparseable upstream output, missing handler)
skip retries via the worker's `fleetPermanent` contract.

Queue honesty fix: task priorities were reordered (`CORE 10 → DOMAIN 20 →
LANGUAGE 30 → MANDATORY_AUDIT 40 → ENRICHMENT 50`) so the audit pair challenges
outputs that EXIST — auditing before specialists would be a vacuous pass.

### Specialist guarantees (all enforced in code, tested in `tests/unit/ci3-specialists.test.ts`)
- **Source grounding**: a finding may cite only registered sources that the
  pack itself declares (pack `sources` or glossary anchors); everything else is
  demoted to `partially_available` + low confidence + an honest unknown.
- **Cross-domain handoff**: `handoffTargetDomainId` is honoured only when it is
  a declared `relatedSubjectDomainIds` entry of the citing pack; undeclared
  targets become unknowns, never guesses.
- **Prohibited tasks**: claims matching a pack's `prohibitedTasks` are refused
  (deterministic matcher) and recorded as risk flags, never answered.
- **IN_REVIEW honesty**: outputs of under-review packs carry a limitation on
  every finding, an explicit unknown, and `requiresHumanReview: true`.
- **Disagreements preserved**: the auditor surfaces conflicts verbatim; it
  never averages or smooths them (§10.2).

### Deterministic domain fixtures
`src/lib/ci/fleet/fixtures.ts` ships the grounding/demotion/handoff/refusal
fixture suite referenced by the packs' benchmarks (no model needed); the CI-3E
core-family packs (`physics-space`, `chemistry-materials`, `biology-life`,
`languages-literature`) extend the catalogue to 8 dispatchable packs — all
still honestly IN_REVIEW pending the human VERIFIED gate (§6.4).
