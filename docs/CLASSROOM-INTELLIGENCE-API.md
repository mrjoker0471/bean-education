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
