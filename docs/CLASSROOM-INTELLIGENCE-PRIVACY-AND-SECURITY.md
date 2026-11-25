# BEAN Classroom Intelligence — Privacy & Security (CI-1E)

**Status**: implementation-backed documentation for milestone CI-1.
Every statement below describes what the code actually enforces; where a
protection is a design boundary rather than an enforcement, it says so.
Draft for legal review — this document does not constitute legal advice and
does not alter the Terms or Privacy Policy; it records how the feature works
so the legal documents can describe it accurately.

---

## 1. What the pipeline processes (and what it never touches)

| Source | Processed? | Detail |
|---|---|---|
| Lesson plan (class title/description/subject/level/language) | Yes | the class's own advertised content |
| Verified attendance (booking statuses) | Yes | counts only (`x attended, y no-show…`) |
| LiveKit connection evidence | Yes — **aggregate only** | totals and means; never per-student rows, never identities |
| Whiteboard snapshot | Structure only | stroke count; the board stores pen/eraser geometry, no text exists to read |
| Teacher lesson notes | Only if the teacher provides them | opt-in per evaluation (30–4000 chars), teacher-authored |
| **Audio / video / screen capture** | **Never** | BEAN classrooms are live-only; no recording or transcription infrastructure exists in CI-1 |
| **Chat transcripts, private messages** | **Never** | none are collected by BEAN classrooms |
| **Individual student behaviour / engagement** | **Never** | no per-student profiles, no engagement scores, no rankings |

Student data reaches the agents **only** in aggregate form. The evidence view
is identity-free by construction (unit-tested: no emails, no participant
identities can appear in the agent payload).

## 2. Consent model

- One purpose on the existing `ConsentRecord` model:
  `CLASSROOM_INTELLIGENCE_TEACHER`, per teacher account.
- **Granting** consent enables evaluations for that teacher's ended classes.
  It does not make evaluation automatic for future classes — a run still needs
  a lifecycle trigger (session end) or an explicit teacher request.
- **Withdrawing** consent stops future evaluations **immediately**: the gate
  is checked when a job is enqueued AND again when a worker claims it — a
  withdrawal between those moments results in the job being marked `SKIPPED`
  with reason `consent_not_granted`.
- Withdrawal does not silently delete past reports (that would rewrite history
  the teacher may still need); the teacher deletes reports individually, or
  everything is erased with account deletion (§6).
- Student-side consent: students' personal data is not processed at all —
  summaries are class-level material, so no per-student AI processing exists
  that would need its own consent gate.
- **Child safeguarding**: BEAN's existing signup boundary applies unchanged —
  under-18 accounts cannot be created until verifiable parental consent ships.
  CI-1 adds no new minor-facing processing and does not weaken any classroom
  access control.

## 3. Disclosure (what users are told)

- The teacher panel states plainly what is read, that audio/video are never
  recorded, that reports are private to the teacher and authorised
  administrators, that findings are advisory, and that student summaries are
  class-level. (Rendered in `teacher-ci-panel.tsx`; enforced wording, not a
  placeholder.)
- The student summaries section carries the fixed scope note (schema-enforced
  literal): class-level, same for every attendee, not an assessment of any
  individual student.
- The model engine id is shown to teachers as provenance metadata
  ("engine: …") — no provider names, keys or infrastructure details are ever
  shown to students.

## 4. Access control

| Route | Who | Scope |
|---|---|---|
| `GET/POST /api/teach/classroom-intelligence` | approved teacher | own profile's classes only |
| `GET/POST /api/teach/classes/:id/evaluation` | approved teacher | class owner only (others get 404) |
| `POST …/reports/:reportId/dispute` | approved teacher | report owner only (404 otherwise) |
| `GET /api/teach/classroom-intelligence/disputes` | approved teacher | own disputes |
| `DELETE …/reports/:reportId` | approved teacher | report owner only; blocked while a dispute is open |
| `GET/POST /api/admin/classroom-intelligence/disputes[/:id/action]` | ADMIN | queue + human decisions |
| `GET /api/learn/class-summaries` | signed-in student | own bookings only (`booking.studentId` scope) |

All identity comes from the httpOnly session cookie. No route trusts a
client-supplied user id, role, attendance state, evaluation score or approval
state. Ownership mismatches return 404 (indistinguishable from "not found").

## 5. Prompt-injection resistance & agent containment

- All classroom text (lesson plan, teacher notes, evidence JSON) is fenced as
  untrusted data before reaching a model (`fenceClassroomText`): the fence
  instructs the model that the content is inert data, and payloads that try to
  impersonate the fence tags are neutralised (unit-tested).
- Structured-output enforcement: agent replies must parse as JSON **and**
  satisfy the Zod contracts (`schemas.ts`) — one strict retry, then honest
  failure. An agent cannot publish a finding without citing evidence kinds,
  cannot invent categories, and cannot emit timestamps (none exist to give).
- Agents have **no tools** and **no arbitrary code execution**: a "run" is one
  chat completion whose output is validated; nothing an agent returns is ever
  executed, and agents never write to the database directly — the pipeline
  writes all rows after validation.
- No write path from CI into Trust & Safety: the pipeline has no code touching
  `ClassReview`, `TeachComplaint`, `TrustAction`, `TeachAppeal`, bookings or
  attendance. Automated consequences are structurally impossible.

## 6. Retention, deletion and export

- **Retention**: reports and evidence registers are retained until the teacher
  deletes them, the evaluation is re-run (old versions become `SUPERSEDED`,
  still retained), or the account is deleted. Dispute histories are append-only
  while they exist.
- **Teacher deletion of a version**: `DELETE …/reports/:reportId` removes the
  report row + its evidence register. Blocked while a dispute on that report is
  open — the human review outcome must be recorded first. Student summaries are
  job-anchored and are not removed by single-version deletion (documented).
- **Account deletion**: explicit transactional erasure of every CI row owned by
  the account — disputes (plain `teacherId`, no FK), evaluation jobs (with
  reports, evidence refs, agent runs via cascade), and student summaries (via
  the caller's bookings) — before the Student row goes.
- **Export**: `GET /api/auth/account/export` now includes a
  `classroomIntelligence` section: all teacher report versions (with full
  content), all class-level summaries, and all disputes the account filed.
- **Provider data**: classroom evidence is sent to the model provider for
  evaluation as transient prompts. BEAN does not use classroom data to train
  external models, and the provider relationship is the existing BEAN AI
  integration — no new data-sharing arrangement is introduced by CI-1.

## 7. Reliability & failure behaviour

- Evaluations run on a lease-based background worker; a dead worker's job is
  re-queued (bounded) or failed honestly. A failed evaluation never marks a
  class failed, never invalidates attendance, never blocks a booking, a
  cancellation, a live session or any classroom route.
- Provider unavailable → job `FAILED` with a clear error after bounded retries;
  the rest of BEAN works normally. No fabricated outputs under any failure mode
  (unit-tested).
- Duplicate prevention is a database guarantee: one job per class; auto
  triggers never re-run a terminal evaluation; only explicit human requests do.

## 8. Audit trails

- `ClassroomAgentRun`: per-stage audit (agent, adapter id, evidence digest,
  validated output or error, timing) — append-only.
- `ClassroomDisputeEvent`: append-only dispute history (submission, assignment,
  review, decision with grounds).
- Report versioning: `CURRENT`/`SUPERSEDED`/`RETRACTED` states preserve the
  full evaluation history; a `CORRECTED` rebuild records exactly which findings
  were excluded and by whom.

## 9. Fairness constraints (structural, not aspirational)

- The judge prompt hard-forbids judging on accent, appearance, disability,
  personality, gender, religion, language background or other protected
  characteristics (unit-tested presence in the prompt).
- Silence, camera-off and network interruptions are declared non-evidence
  (unit-tested).
- Categories without a real evidence basis must be declared
  `categoriesNotEvaluable` — the ten-category table shows them as
  "Not evaluable from this evidence" instead of speculative scores.
- Student silence is never interpreted; students are never ranked; engagement
  scores do not exist in the schema.

---

## CI-2 security evidence (audit date: 2026-11-24, branch `feat/bean-classroom-intelligence-ci2`)

Reinspection of every CI-1 + CI-2 access path, executed as real database tests on isolated SQLite (`tests/unit/ci2-security-audit.test.ts` — 8 tests) plus the CI-2A authenticated browser walkthrough.

| Area | Evidence |
| --- | --- |
| Student ownership | summaries query joins through the session-resolved student's own bookings; another student's summary rows are invisible; the response payload contains no `modelId`, no engine provenance, and no teacher identity (asserted on the serialised payload) |
| Class-level boundary | learning links are navigation to existing catalogue pages with `matchedOn` provenance; the fixed scope note remains; no per-student data exists anywhere in the pipeline |
| Teacher ownership | CI summary, per-class evaluation, trends and dispute list are scoped by the session-resolved APPROVED TeacherProfile; teacher B's trends/summary contain none of teacher A's rows (cross-teacher assertions) |
| Admin-only routes | the new report-inspection route (`GET /api/admin/classroom-intelligence/reports/:id`) is ADMIN-gated (403 for teachers, 401 anonymous); the dispute queue lists all cases for authorised administrators only |
| Dispute access | teacher dispute list is teacher-scoped (another teacher's dispute 404s); reconsideration is owner-only, once per dispute, note-bounded; the admin action route refuses self-review and bars the original decision-maker from a reconsidered case (403s asserted) |
| Export completeness | export includes teacher reports (with report JSON + engine id), class summaries, and filed disputes — now including the FULL append-only event history per dispute (CI-2G improvement: `RECONSIDER_REQUESTED` and every other event is exported) |
| Account deletion | deleting the owner erases jobs, reports, evidence refs, student summaries, disputes and dispute events — verified row by row after the delete, not assumed from schema |
| Consent withdrawal | enforced at enqueue AND claim time; a withdrawn teacher's queued job is SKIPPED (`consent_not_granted`) |
| Session expiry | an unauthenticated caller receives 401/403 on every CI endpoint; sessions expire after the platform TTL and every lookup re-reads the live session row |
| Stale job cleanup | lease expiry recovery re-queues bounded attempts (CI-2F C4); terminal FAILED jobs keep an honest error and never block the classroom |
| Log minimisation | structural scan over all CI server code: no `console.*` statement includes `summaryJson`, `reportJson`, `teacherNotes`, `lessonSummary` or `outputJson`; logs carry ids, statuses and error strings only |
| Sensitive exposure | student-facing DTOs carry no model provenance and no teacher identity; dispute reasons are visible only to the dispute's teacher and authorised administrators |

Nothing in CI-2 changed the data model (no new tables or columns — the reconsider appeal reuses the append-only event table), so the CI-1 deletion/export surface grows only by the dispute-history inclusion above. No legal certification is claimed; the disclosures in the privacy policy and the in-product AI notice remain the authoritative wording.

## CI-3D observer privacy evidence (audit date: 2026-11-24, branch `feat/bean-classroom-intelligence-agent-fleet`)

The CI-3D observer extends the CI-1/CI-2 boundary instead of widening it:

1. **No new signal classes.** Charter §9.1 Mode A only. The observer receives
   NO media: `Room.connect({ autoSubscribe: false })` at the transport level
   plus a fixed least-privilege token (`canSubscribe=false`, `canPublish=false`,
   `canPublishData=false` — asserted from the minted JWT in tests). No
   transcription code exists; the persisted `transcriptionEnabled` column and
   the evidence contract's literal `false` make a silent consent downgrade
   impossible (§9.2 requires a separate reviewed milestone first).
2. **Visible by construction.** `hidden: false`, participant name
   "BEAN Classroom Observer (AI)", and a metadata disclosure ("no audio or
   video is processed, recorded or stored; the teacher can remove this
   participant at any time") are minted into every token (§10.1).
3. **Identity minimisation.** The observer's identity is `bean-observer:<rowId>`
   — never a `bean:` student identity — so webhook accounting can never count
   it as a participant (`studentIdFromIdentity` returns null; asserted in
   tests). Presence evidence is aggregate counts only; the observer never reads
   participant identities, data payloads or track content.
4. **Consent is re-checked at dispatch, at every connect attempt and on every
   heartbeat; withdrawal mid-class makes the observer leave immediately and
   finalise `CANCELLED/consent_withdrawn` (§10.2).**
5. **Explicit dispatch + ownership.** Only the approved owner teacher can
   dispatch/withdraw via the guarded route; every §11 Phase 0 check runs
   server-side; exactly one observer per room is a DB unique constraint.
6. **Failure honesty.** Bounded connect attempts → `FAILED/connection_failed`
   with a bounded explanation; lost runs (server restart) → `FAILED/
   server_restart` with an evidence gap; reconnects are clamped intervals from
   the same pure functions as the attendance webhook (never negative, never
   double-counted) and are recorded as evidence gaps. An observer failure
   never touches class, booking or attendance state (criterion 6, tested).
7. **Retention.** The row stores aggregate, identity-free evidence only;
   deletion of the class/account cascades the row. Re-dispatch resets the
   room's single row for a fresh run (previous envelope replaced by the new
   run's honest finalisation).
