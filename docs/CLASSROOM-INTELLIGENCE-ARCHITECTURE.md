# BEAN Classroom Intelligence — Architecture & Compatibility Report (CI-1A)

**Status**: produced before implementation, from a verified inspection of the
repository at `origin/main` = `bb12daa5460103ab913fa8c15baa49840e7cfda9`
(verified by `git ls-remote` on 2026-11-23).
**Feature branch**: `feat/bean-classroom-intelligence` (created from that tip).
**Milestone**: BEAN Classroom Intelligence — CI-1.

---

## 1. What actually exists in BEAN today (verified, not assumed)

| Area | Verified implementation | CI-1 relevance |
|---|---|---|
| Framework | Next.js 16 App Router (hash-routed SPA views under `src/components/bean/views/*`), React 19, TypeScript 5, Bun runtime | pipeline runs in-process; UI follows the existing view/store conventions |
| Data | Prisma 6 + SQLite, migration-managed (`prisma/migrations/`); single-writer serialisation | additive schema only; FKs with `onDelete: Cascade` into existing tables |
| Auth | httpOnly session cookie; `Student.role` = STUDENT \| PYQ_CURATOR \| ADMIN; teacher capability = **approved TeacherProfile** (`requireApprovedTeacher()` in `src/lib/teach.ts`); `requireAdmin()` guard | all CI routes re-use these guards; client-supplied ids never trusted |
| Live classroom | `livekit-server-sdk` 2.20 (server) / `livekit-client` 2.24 (browser); one `LiveClassSession` per `ClassSession` (unique FK); webhook receiver (`/api/webhooks/livekit`) with provider-event-id idempotency; per-participant verified connection intervals (`LiveClassParticipant`); monthly usage budget (`LiveUsageMonth`) | **observation channel**: structured events + verified intervals, not media |
| Attendance | teacher-marked `ATTENDED`/`NO_SHOW` on `ClassBooking` after class end (server-checked), webhook-derived attendance suggestions (`suggestedAttendance()`, advisory only), append-only `TeachAuditEvent` | evaluation is keyed to bookings with final attendance |
| Trust & Safety | verified `ClassReview` (1-per-booking, ATTENDED-only), `TeacherReviewResponse`, private `TeachComplaint` (+ append-only `ComplaintEvent`), `TrustAction` restrictions, `TeachAppeal` (+ append-only `AppealEvent`) | CI never writes these tables automatically; disputes get their own flow |
| AI | server-side `z-ai-web-dev-sdk` wrapped in `src/lib/riishe/ai.ts` (`chat`, `chatJson`, tolerant `extractJson`, `fenceDocumentText` prompt-injection fence, 429/content-filter classifiers); browser-local WebLLM is consent-gated and separate | CI adds its own adapter layer over the same pattern; no client-side AI |
| Background jobs | `RiisheJob` durable queue: CAS claims, lease + heartbeat recovery, bounded retries, hourly quotas | CI-1B clones these semantics for a dedicated evaluation queue (separate table; `RiisheJob` semantics untouched) |
| Privacy | `ConsentRecord` (per-purpose grant/withdraw), `PrivacyRequest`, account export (`/api/auth/account/export`, 541 lines), transactional account deletion (`/api/auth/account/delete`) | CI consent = one new purpose string; export + deletion extended additively |
| Legal | draft/legal-review notices in Terms/Privacy; DPDP-aligned documents | CI ships with its own privacy/security document; no legal text changes here |
| CI | GitHub Actions `quality` job: ESLint, `tsc --noEmit`, `bun test --isolate`, production build; triggers on PRs to main and pushes to `main`/`fix/**`/`feat/**` | every milestone push runs this exact stack |

**Branch compatibility check (verified)**: remote branches `main`,
`feat/bean-public-experience-auth-legal`, `feat/bean-premium-brand-ui-redesign`,
`feat/bean-legal-pages-redesign`, `chore/brand-redesign-ledger-sync` and all
older phase branches were listed via `git ls-remote`; `main` already contains
the brand redesign (PR #28), the ledger sync (PR #29) and the legal pages
redesign (PR #30). No open PR carries unmerged feature work that CI-1 would
conflict with. CI-1 branches from the current tip, so nothing is excluded.

## 2. Classroom lifecycle → evaluation trigger map (verified end-to-end)

1. Teacher publishes class (`ClassSession`, PUBLISHED).
2. Student books (`ClassBooking`, transactional seat claim).
3. Teacher starts room (`LiveClassSession` READY→LIVE, budget reserved).
4. LiveKit webhooks verify joins/leaves into connection intervals.
5. Class ends — teacher-initiated (`POST …/live/end`, single-use finalisation)
   or provider `room_finished` (session → INTERRUPTED, usage reconciled once).
6. Teacher marks attendance (`ATTENDED`/`NO_SHOW`, server-checked, audited).
7. **CI-1 hook**: when a live session reaches a terminal state and attendance
   has been marked, an evaluation job is created (idempotently — unique per
   class) **if and only if** the teacher holds CI consent. The hook is
   post-transaction, best-effort, and can never fail or delay the classroom
   request that triggered it.
8. The pipeline evaluates, writes versioned reports + evidence references.
9. Teacher sees their quality report; students (ATTENDED) see the class-level
   learning summary.
10. Disputed findings go to human review; AI is advisory everywhere.

## 3. Target architecture (CI-1)

```
┌──────────────────────────── BEAN Education (existing) ───────────────────────────┐
│  LiveKit webhooks ─┐                                                             │
│  live/end route ───┼─→ ciEvaluationTrigger (post-transaction, best-effort)        │
│                    │        │ unique per ClassSession → ClassroomEvaluationJob    │
│                    ▼        ▼                                                     │
│  Classroom Intelligence worker (lease-bounded background loop, in-process)        │
│   stage EVIDENCE ─→ collect authorised evidence (bookings, verified intervals,    │
│   │                 whiteboard snapshot, lesson plan, opt-in teacher notes)       │
│   stage LEARNER ──→ BEAN Learner Agent ─→ Zod-validated structured output         │
│   stage JUDGE ────→ BEAN Teacher Judge Agent ─→ Zod-validated 10-category output  │
│   stage ORCHESTRATE → BEAN Evaluation Orchestrator (pure builder): validate,      │
│   │                 flag conflicts, mark insufficient evidence, version report    │
│   stage PUBLISH ───→ ClassroomEvaluationReport (TEACHER + STUDENT class summary)  │
│                                                                                   │
│  ModelAdapter (swappable; default = existing provider wrapper; honest failures)   │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Non-negotiable properties

- **Idempotent & duplicate-proof**: one evaluation job per class (DB-unique);
  re-runs create a new report **version**, never a second job row.
- **Fail-safe by design**: a failed evaluation never marks a class failed,
  never invalidates attendance, never blocks a booking/cancellation/live
  request. Classroom routes do not call the model synchronously.
- **Evidence-locked**: agents receive only BEAN-verified evidence, fenced as
  untrusted data; outputs are schema-validated; the orchestrator refuses to
  publish findings whose evidence references are missing and states
  "insufficient evidence" explicitly.
- **No fabrication**: no timestamps/quotes/syllabus coverage are invented.
  Where a data source is absent (e.g. no whiteboard snapshot, no lesson
  notes), the evidence record says `available: false` and the report says so.
- **Protected characteristics**: judge prompts and output schemas exclude
  accent/appearance/disability/personality/gender/religion/language
  background; silence, camera-off and network interruptions are explicitly
  non-evidence for engagement claims.
- **Advisory only**: CI cannot write `ClassReview`, `TeachComplaint`,
  `TrustAction`, `TeachAppeal`, bookings or attendance rows; it cannot
  suspend teachers or alter payments. Human review is the only path to
  consequential action.

## 4. Data model (additive; all FKs cascade into existing tables)

| Model | Purpose | Key guarantees |
|---|---|---|
| `ClassroomEvaluationJob` | one durable job per class | `classSessionId` **@unique**; QUEUED→RUNNING→COMPLETED/FAILED/SKIPPED; trigger ∈ {SESSION_END, TEACHER_REQUEST, ADMIN_RETRY}; CAS + lease columns |
| `ClassroomAgentRun` | per-agent execution audit | job FK; agent ∈ {LEARNER, TEACHER_JUDGE, ORCHESTRATOR}; modelId, inputDigest (sha256), outputJson, durationMs, honest error |
| `ClassroomEvaluationReport` | versioned report | (classSessionId, audience, version) **@unique**; audience ∈ {TEACHER, STUDENT}; status ∈ {CURRENT, SUPERSEDED, RETRACTED}; `insufficientEvidence`, `requiresHumanReview` flags |
| `ClassroomEvidenceRef` | evidence register per report | report FK; kind ∈ {LESSON_PLAN, ATTENDANCE_RECORD, PARTICIPANT_INTERVALS, WHITEBOARD_SNAPSHOT, TEACHER_LESSON_NOTES}; `available` flag; honest summary |
| `ClassroomStudentSummary` | class-level learning summary | **unique per booking**; only for ATTENDED bookings; content is the same class-level material for every attendee (no individual inference) |
| `ClassroomEvaluationDispute` | teacher disputes a finding | report FK; SUBMITTED→UNDER_REVIEW→RESOLVED/DISMISSED; resolution ∈ {UPHELD, CORRECTED, RETRACTED}; CORRECTED triggers a deterministic orchestrator re-run excluding the disputed finding |
| `ClassroomDisputeEvent` | append-only dispute history | never updated or deleted |

Consent reuses the existing `ConsentRecord` model with purpose
`CLASSROOM_INTELLIGENCE_TEACHER` (grant/withdraw, per teacher account). No
new consent table is invented where the existing one fits.

## 5. API surface (server-side ownership on every route)

| Route | Access | Behaviour |
|---|---|---|
| `GET/POST /api/teach/classroom-intelligence/consent` | approved teacher | consent status; grant/withdraw (withdrawal stops all future evaluations immediately) |
| `GET /api/teach/classroom-intelligence/summary` | approved teacher | evaluated classes, strengths/improvement aggregates, trends — computed only from stored reports |
| `GET /api/teach/classes/[id]/evaluation` | class owner teacher | job status + report versions (CURRENT first) |
| `POST /api/teach/classes/[id]/evaluation` | class owner teacher | request evaluation / re-run (new version) — consent-gated, idempotent |
| `DELETE /api/teach/classroom-intelligence/reports/[reportId]` | report owner | deletes a report version + its evidence + student summaries; refused while a dispute is open |
| `POST /api/teach/classroom-intelligence/reports/[reportId]/dispute` | report owner | dispute specific findings with reason |
| `GET /api/teach/classroom-intelligence/disputes` | teacher | own disputes + status |
| `GET /api/admin/classroom-intelligence/disputes` | ADMIN | queue of disputes |
| `POST /api/admin/classroom-intelligence/disputes/[id]/action` | ADMIN | assign / review / resolve (UPHELD/CORRECTED/RETRACTED) — human decision, appended to dispute history |
| `GET /api/learn/class-summaries` | signed-in student | own ATTENDED bookings' class summaries — ownership via booking.studentId |

## 6. Compatibility assessment

- **Next.js app**: zero route changes outside new CI endpoints; the trigger
  hook adds two `void`-ed, error-isolated calls (live/end + webhook
  room_finished path). No existing handler's contract changes.
- **Database**: purely additive models + two relations added to existing
  models (`ClassSession`, `TeacherProfile`, `ClassBooking`, `Student` back-relations).
  No existing column or index changes; `prisma migrate` generates one additive migration.
- **Trust & Safety**: untouched tables; CI disputes are a parallel flow that
  links to reports, never to moderation state.
- **Payments (future)**: `docs/CLASSROOM-INTELLIGENCE-FUTURE-PAYMENTS.md`
  records the boundary — payout eligibility derives only from verified
  class completion/attendance/booking/cancellation facts; AI quality scores
  can never gate payouts.
- **Deployment**: no new service, port, GPU or runtime. Worker runs inside
  the Next.js server process with `unref`-ed timers (does not hold the
  process open), exactly like the existing Riishe worker.
- **Offline behaviour**: if the model provider is unavailable, evaluations
  fail honestly (FAILED + bounded retry) and every other BEAN feature works
  normally. Teacher/student UI renders "evaluation unavailable — retry"
  states rather than fake data.

## 7. Risks & mitigations (recorded before building)

| Risk | Mitigation |
|---|---|
| Model returns invented timestamps/quotes | schema forbids free-form quotes without evidence refs; orchestrator drops non-referenced observations; evidence refs are DB-validated |
| Prompt injection via whiteboard text / lesson notes | all classroom text passes the existing fence pattern; agents are told it is inert data |
| Duplicate evaluations | DB-unique job per class + versioned reports |
| Worker dies mid-run | lease expiry → bounded re-queue; agent stages are idempotent; partial agent runs are recorded and re-executed |
| Privacy of student summaries | class-level content only; per-booking access control; excluded from account export? No — included in the student's own export, deleted with account deletion |
| Overreach into moderation | hard rule: CI code has no write path to trust tables; enforced by code review + tests asserting no cross-writes |
