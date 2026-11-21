# BEAN Trust & Quality — Phase 6 implementation

Source of truth: `src/lib/trust.ts` (domain constants + pure rules), `src/lib/trust-schema.ts` (Zod), `src/lib/trust-dto.ts` (privacy DTO mappers), `src/lib/trust-quality.ts` (shared aggregates), the 18 Phase 6 route files under `src/app/api/teach/*` and `src/app/api/admin/trust/*`, the trust components under `src/components/bean/trust/*`, the three views (`trust-policy-view`, `my-reports-view`, `admin-trust-view`), and `prisma/migrations/20261119050000_phase6_trust_quality/migration.sql`. Everything below describes what is actually committed; companion docs cover each area in depth (`docs/PHASE6_REVIEW_POLICY.md`, `docs/PHASE6_COMPLAINTS_AND_APPEALS.md`, `docs/PHASE6_SAFEGUARDING.md`, `docs/PHASE6_SECURITY.md`, `docs/PHASE6_RESULTS.md`).

## What Phase 6 is

Trust and quality for BEAN Teach, additive on top of Phase 4A (marketplace) and Phase 5 (live classroom):

- **Verified reviews** — one review per real ATTENDED booking, written only after the class ended, editable by its author for 7 days, publicly attributed only as "Verified student" (plus an optional consented display name), with teacher responses and human-only moderation.
- **Private complaints** — 11 categories, server-derived severity, append-only case history, restricted handling for safeguarding/harassment/discrimination. Teachers never see complaint content or reporter identity — only an anonymous open count.
- **Trust actions** — explicit, admin-issued teacher records (NOTICE → EMERGENCY_STOP) with documented reasons, optional expiry, and server-side enforcement in the class/booking/live routes.
- **Appeals** — against complaint decisions, review moderation and trust actions, with a server-captured original decision maker and a self-review ban.

Product invariants enforced by `src/lib/trust.ts` (quoted from its header, and proven by tests):

- A review exists only for one real ATTENDED booking after the class ended.
- A negative review NEVER triggers a refund, suspension, rejection, booking cancellation or auto-hidden review. Adverse decisions follow documented investigation only.
- Complaints are private; they never change ratings, reviews or bookings.
- Trust restrictions are explicit admin records with reasons — filing a complaint never creates one automatically.

There are still NO payments, wallets or refunds: the pilot stays free (Phase 8 owns money). `tests/unit/free-pilot-protection.test.ts` statically guarantees this.

## Architecture in one picture

```
Student browser (hash-routed SPA)
  ├── #/classes/:id  → ReviewSection (list/composer), QualityLine, ReportClassDialog
  ├── #/classes?tab=bookings → report entry per booking + "My reports & appeals"
  ├── #/my-reports   → own complaints + appeals with event timelines
  ├── #/trust-policy → public policy (exact safeguarding guidance wording)
  ├── #/teach/dashboard → Trust & Quality tab (GET /api/teach/trust)
  └── #/admin/trust  → ADMIN Trust Center (5 tabs)
                         │
BEAN Next.js API (Node runtime, session-cookie identity)
  ├── teach: reviews create/edit · responses · flag · complaints · appeals · trust dashboard
  ├── admin/trust: overview · review moderation · complaint investigation ·
  │                teacher trust actions · appeal adjudication
  └── enforcement hooks in Phase 4A/5 routes:
        classes POST (SUSPEND_PUBLISHING) · classes GET (PAUSE_LISTINGS browse filter)
        class detail GET (hide from non-seat-holders) · book POST (block NEW bookings)
        publish POST (both listing restrictions) · live/start + live/token (EMERGENCY_STOP)
                         │
SQLite (Prisma): ClassReview, TeacherReviewResponse, TeachComplaint, ComplaintEvent,
                 TrustAction, TeachAppeal, AppealEvent (all additive)
```

All eligibility/authorisation decisions happen server-side against the httpOnly session identity; client-supplied ids name targets but never grant access.

## Data model (7 new tables, pure additive)

Migration `20261119050000_phase6_trust_quality`: 7 CREATE TABLE + 2 unique indexes + 11 lookup indexes. No existing table gains a column, no existing index changes, no row is touched.

| Table | Purpose | Key guarantees |
|---|---|---|
| `ClassReview` | One verified review per booking | `bookingId` UNIQUE at DB level (P2002 → 409 on racing duplicates); `status` PUBLISHED \| FLAGGED \| HIDDEN; `isVerified` true by construction; `showDisplayName` explicit consent flag; private `moderationReason` (admins + author only) |
| `TeacherReviewResponse` | Teacher's public reply | `reviewId` UNIQUE — one response per review; only the reviewed class's owner teacher can create it |
| `TeachComplaint` | Private report / case record | `severity` server-derived (never client-asserted); `isSensitive` for the three restricted categories; **no FK to ClassSession** (`classSessionId` is a plain string so investigation history survives class deletion); `teacherProfileId` FK is ON DELETE SET NULL |
| `ComplaintEvent` | Append-only complaint history | every transition/assignment/note recorded once; duplicates are no-ops |
| `TrustAction` | Teacher restriction / notice records | `reason` mandatory (20–1000); `endsAt` null = until reinstated; REINSTATE rows are decisions (`isActive=false`), not restrictions |
| `TeachAppeal` | Appeal against a decision | `originalDecisionById` captured SERVER-SIDE at filing (self-review ban); `targetType`/`targetId` polymorphic |
| `AppealEvent` | Append-only appeal history | SUBMITTED / ASSIGNED / DECIDED / CLOSED |

## State machines

**Review moderation** (details: docs/PHASE6_REVIEW_POLICY.md):

```
        create (POST reviews, ATTENDED booking, class ended)
                       │
                       ▼
                  PUBLISHED ◀──────────────────────┐
                       │                           │
        teacher/ADMIN flag (REVIEW_FLAGGED)        │ admin KEEP_PUBLISHED
                       ▼                           │ or appeal OVERTURNED
                    FLAGGED ───────────────────────┘  (RESTORE → PUBLISHED)
                       │  stays publicly visible while under moderation;
                       │  excluded from aggregates while FLAGGED
                       ▼ admin HIDE (documented reason; author keeps access)
                    HIDDEN  ──── admin RESTORE (or appeal OVERTURNED) ───▶ PUBLISHED
```

- HIDDEN reviews cannot be edited (409) and cannot be flagged (409); the author still sees their own review plus the moderation reason.
- Only the flag route (owner teacher or ADMIN) and admin moderation ever change review status. Complaints never touch review state.

**Complaint lifecycle** (details: docs/PHASE6_COMPLAINTS_AND_APPEALS.md):

```
OPEN ──ACKNOWLEDGE──▶ ACKNOWLEDGED ──START_REVIEW──▶ UNDER_REVIEW ◀──(re-opened by overturned appeal)──┐
  │  └──START_REVIEW──▶ UNDER_REVIEW                    │  │                                           │
  │               REQUEST_INFO ──▶ WAITING_FOR_INFORMATION (complainant supplies INFO_PROVIDED)         │
  │                                                     │  │                                           │
  │                              RESOLVE (note mandatory)  DISMISS (note mandatory)                    │
  └───────────────────────────▶ RESOLVED ◀────────────────┘  └────────▶ DISMISSED                      │
ESCALATE (any time before decision) → severity CRITICAL, event ESCALATED                              │
```

- NOTE and ASSIGN leave status unchanged. Identical repeat transitions are idempotent no-ops (`unchanged: true`), never duplicate events. RESOLVED/DISMISSED/ESCALATED are mirrored into the unified `TeachAuditEvent` trail (`entityType: COMPLAINT`).

**Trust action lifecycle**:

```
issued (isActive=true, optional endsAt) ──▶ enforcing while isActive AND (endsAt is null OR endsAt > now)
   │
   ├─ REINSTATE (admin): every currently-enforcing row deactivated individually
   │                      (endedAt/endedById set) + REINSTATE decision row (isActive=false)
   └─ temporary restriction past endsAt: stops biting at next evaluation (no sweeper)
```

**Appeal lifecycle**:

```
SUBMITTED ──ASSIGN──▶ UNDER_REVIEW ──DECIDE──▶ UPHELD | OVERTURNED      (any open state ──CLOSE_WITHOUT_DECISION──▶ CLOSED)
```

## API surface (18 Phase 6 route files)

All teach routes authenticate the session cookie (`requireStudent` / `requireApprovedTeacher`); all admin/trust routes are ADMIN-guarded (`requireAdmin` in `src/lib/teach.ts`). Same-origin is enforced on every mutation.

| Method + path | Who | What |
|---|---|---|
| GET `/api/teach/classes/:id/reviews` | public (viewer-aware) | PUBLISHED + FLAGGED list (+ own review in any state for the author); composer eligibility for the signed-in viewer |
| POST `/api/teach/classes/:id/reviews` | signed-in student | create review (ATTENDED booking, class ended, one per booking); 429 over 10/day |
| PATCH `/api/teach/reviews/:reviewId` | review author | self-edit within 7 days; HIDDEN → 409; audited REVIEW_EDITED |
| POST `/api/teach/reviews/:reviewId/response` | reviewed class's owner teacher | one public response (unique reviewId); P2002 → 409 |
| PATCH `/api/teach/reviews/:reviewId/response` | response author | edit within 7 days |
| POST `/api/teach/reviews/:reviewId/flag` | owner teacher or ADMIN | FLAGGED for moderation with a reason; 429 over 20/day; never auto-hides |
| GET `/api/teach/complaints` | signed-in student | own complaints (admin notes redacted) |
| POST `/api/teach/complaints` | signed-in student | file report; legitimate-relationship rule; severity server-derived; 429 over 10/day |
| GET `/api/teach/complaints/:id` | complainant only | own case file (non-owners get a bare 404) |
| PATCH `/api/teach/complaints/:id` | complainant only | add information (INFO_PROVIDED event) |
| GET `/api/teach/appeals` | signed-in student | own appeals |
| POST `/api/teach/appeals` | party to the decision | file appeal; duplicate open appeal → 409; 429 over 5/day |
| GET `/api/teach/trust` | approved teacher | quality metrics, recent reviews, responses, ANONYMOUS open-complaint count, restrictions, appeal status |
| GET `/api/admin/trust/overview` | ADMIN | Trust Center counters (expiry-aware active restrictions) |
| GET `/api/admin/trust/reviews?filter=` | ADMIN | moderation queue (flagged default) with reviewer identity |
| POST `/api/admin/trust/reviews/:reviewId/moderate` | ADMIN | KEEP_PUBLISHED / HIDE / RESTORE — reason mandatory, audited |
| GET `/api/admin/trust/complaints?status=&category=&severity=&q=&sensitive=` | ADMIN | case search — the ONLY endpoint that returns complaint content |
| GET `/api/admin/trust/complaints/:id` | ADMIN | full case file, notes unredacted |
| POST `/api/admin/trust/complaints/:id/action` | ADMIN | ACKNOWLEDGE / START_REVIEW / REQUEST_INFO / NOTE / ASSIGN / ESCALATE / RESOLVE / DISMISS |
| GET `/api/admin/trust/teachers?q=` | ADMIN | approved teachers with quality aggregates + anonymous complaint counts + restrictions |
| POST `/api/admin/trust/teachers/:teacherProfileId/actions` | ADMIN | issue NOTICE / WARNING / PAUSE_LISTINGS / SUSPEND_PUBLISHING / EMERGENCY_STOP / REINSTATE (no rate limit — admin-only surface) |
| GET `/api/admin/trust/appeals?status=` | ADMIN | appeal queue with appellant identity + original decision maker |
| POST `/api/admin/trust/appeals/:appealId/action` | ADMIN | ASSIGN / DECIDE (UPHELD/OVERTURNED; assigned reviewer only; self-review ban) / CLOSE_WITHOUT_DECISION |

Frontend surfaces and hash routes (registered in `src/lib/store.ts`): `#/trust-policy` (public policy view), `#/my-reports` (complainant's own tracker), `#/admin/trust` (ADMIN Trust Center; entered from the Phase 4A Teacher Review view's "Trust Center" button). Integrations: class detail page (QualityLine, ReviewSection, Report a concern dialog), My bookings (per-booking report entry + My reports link), teacher dashboard (Trust & Quality tab), footer (Trust & Safety link).

## Enforcement matrix (trust actions vs routes)

`trustStateFor(profileId, now)` (`src/lib/trust.ts`) fetches active rows and `evaluateTrustState()` decides what bites — expiry-aware at evaluation time. Enforcement points:

| Route | Check | Effect |
|---|---|---|
| GET `/api/teach/classes` (browse) | active PAUSE_LISTINGS on the teacher | teacher's listings excluded from discovery via a `trustActions: { none: … }` filter (expiry-aware) |
| GET `/api/teach/classes/:id` (detail) | active PAUSE_LISTINGS | 404 (identical "Class not found") to non-seat-holders; the owner AND any student holding a non-cancelled booking keep full access — reservations are never revoked |
| POST `/api/teach/classes` (create) | `suspendedPublishing` | 403 with the restriction message (PAUSE_LISTINGS alone still allows drafting) |
| POST `/api/teach/classes/:id/publish` | `pausedListings` OR `suspendedPublishing` | 403 with the restriction message |
| POST `/api/teach/classes/:id/book` | `pausedListings` (checked INSIDE the booking transaction) | 403 "paused" for NEW bookings; existing seat-holders untouched |
| POST `/api/teach/classes/:id/live/start` | `emergencyStop` | 403 before any budget reservation — the immediate-safeguarding procedure |
| POST `/api/teach/classes/:id/live/token` | `emergencyStop` | 403 — no join tokens issued while the halt is active |

NOTICE and WARNING are record-only. REINSTATE deactivates every currently-enforcing row (individually audited) and records itself as a decision. `verificationStatus` on the teacher profile stays SEPARATE from trust state — moderation/misconduct never flips or re-pends teacher verification.

## Audit trail inventory

One unified append-only `TeachAuditEvent` table (polymorphic `entityType`/`entityId`, no FK by design) plus per-case event tables. Phase 6 additions:

- **`TeachAuditEvent`, entityType `CLASS_REVIEW`** — REVIEW_CREATED (create; detail `rating=N`), REVIEW_EDITED (author self-edit), REVIEW_FLAGGED (flag with reason; also the FLAGS_PER_DAY rate-limit counter), REVIEW_HIDDEN / REVIEW_RESTORED / REVIEW_KEPT_PUBLISHED (admin moderation; the REVIEW_HIDDEN actor is later captured for the appeal self-review ban), TEACHER_RESPONSE_CREATED / TEACHER_RESPONSE_EDITED.
- **`TeachAuditEvent`, entityType `COMPLAINT`** — RESOLVED, DISMISSED, ESCALATED (mirrored from the case-action route; the ComplaintEvent row remains the primary history).
- **`TeachAuditEvent`, entityType `TRUST_ACTION`** — TRUST_ACTION_ISSUED (detail `ACTION: reason`), TRUST_REINSTATE (both admin reinstatement and appeal-overturned deactivation).
- **`ComplaintEvent`** — CREATED, ACKNOWLEDGED, UNDER_REVIEW, WAITING_FOR_INFORMATION, RESOLVED, DISMISSED, ASSIGNMENT_CHANGED, NOTE_ADDED (admin notes redacted for the complainant), INFO_PROVIDED, ESCALATED.
- **`AppealEvent`** — SUBMITTED, ASSIGNED, DECIDED, CLOSED. (The schema comment also names UNDER_REVIEW; current code records assignment as ASSIGNED and moves status to UNDER_REVIEW without a separate event.)

Pre-existing entity types (Phase 4A/5 — unchanged): TEACHER_PROFILE (application submit/resubmit/review), CLASS_SESSION (cancel, live started/resumed/ended/mute/remove), CLASS_BOOKING (attendance marked).

Every audit write happens inside the same transaction as the state change it documents; rows are never updated or deleted.

## Quality metrics

`computeTeacherQuality()` (`src/lib/trust.ts`, pure) is the single source of public quality math; `teacherQualityFor()`/`teacherQualityBatch()` (`src/lib/trust-quality.ts`) recompute it from authoritative DB rows for the teacher list/detail APIs and the trust dashboard. Complaint data is structurally excluded — the function signature takes only review rows and class counts.

- `averageRating` — mean over PUBLISHED **and** isVerified reviews, rounded to 1 decimal; `null` with no sample (never a fabricated zero-star score).
- `reviewCount` — count of published verified reviews.
- `completedClasses` / `completionRate` — COMPLETED sessions; rate = completed/(completed+cancelled), `null` when the denominator is 0.
- `publishedClasses` — currently PUBLISHED sessions.
- `sampleSufficient` — `reviewCount >= QUALITY_MIN_SAMPLE` (3). Below the threshold the UI shows "New teacher — not enough verified reviews yet" instead of a score.

## Test summary

`bun test`: **349 pass / 0 fail** across 28 files (1,100 expect() calls) — full output in docs/PHASE6_RESULTS.md. Phase 6 contributes 111 tests in 6 new suites:

| Suite | Tests | Area |
|---|---|---|
| `trust-quality.test.ts` | 23 | pure rules: eligibility matrix, quality math, edit windows, severity derivation, rate-limit thresholds |
| `free-pilot-protection.test.ts` | 9 | static scans: no payments anywhere; adverse decisions never touch bookings/classes; complaint route creates no trust action; no public complaint endpoints |
| `trust-review-route.test.ts` | 19 | booking-verified creation, privacy-mapped list, 7-day self-edit |
| `trust-complaint-route.test.ts` | 20 | filing rules, own-list privacy, case file, info provision, admin workflow |
| `trust-action-route.test.ts` | 19 | admin authorization, issuing restrictions, REINSTATE, `evaluateTrustState` expiry, enforcement wiring |
| `trust-appeal-route.test.ts` | 21 | filing rules per target, duplicate 409, decide authorization (assigned reviewer, self-review ban), OVERTURNED restorations, no-payments static scan |

Static gates: `bunx tsc --noEmit` clean; `bun run lint` clean.

## Known limitations (honest)

- Attendance is still teacher-marked. Phase 5 live evidence assists the teacher but never auto-marks; review eligibility therefore depends on the teacher confirming ATTENDED (deliberate — see docs/PHASE5_RESULTS.md).
- No automated sentiment/abuse-language analysis anywhere — moderation is human-only by design (docs/PHASE6_SAFEGUARDING.md).
- FLAGGED reviews stay publicly visible but are excluded from aggregates while under moderation — a documented trade-off (review policy doc).
- Trust-state expiry is evaluated at enforcement/read time; there is no background sweeper, so expired temporary rows keep `isActive=true` until touched by REINSTATE or the next evaluation. Enforcement is always correct because every check is expiry-aware; only stored flags lag.
- The trust-action route has no rate limit (it is ADMIN-only; every student-facing Phase 6 write path is rate-limited).
- Appeal reviewer assignment takes an admin id input in the Trust Center UI — there is no admin directory picker yet.
- Complaints have no file attachments; no notification emails exist anywhere in BEAN — parties learn of updates in-app (My reports / Trust Center).
- `bun run db:status` (`prisma migrate status`) exits code 1 in this environment even though all migrations are applied to the runtime DB (built with `prisma db push`) — a pre-existing CLI quirk, recorded in docs/PHASE6_RESULTS.md.
- Free pilot: refund rules do not exist yet and are deferred to Phase 8; the planned price stays metadata (ADR-019).
