# BEAN Teach — Database (Phase 4A)

Source of truth: `prisma/schema.prisma` (§ BEAN Teach) and `prisma/migrations/20261118030000_bean_teach_marketplace/migration.sql`. Everything below describes what is actually committed.

Phase 4A adds exactly 4 models (19 → 23) plus two back-relations on the existing `Student` model. No existing column changed; the migration is purely additive (new tables + indexes only).

## TeacherProfile

One teacher capability per account. NOT a role — `Student.role` is untouched (ADR-017).

| Field | Type | Notes |
|---|---|---|
| `id` | String @id | cuid |
| `studentId` | String @unique | one profile per Student; FK → Student (onDelete: Cascade) |
| `teachingName` | String | public teaching name — never a real-name requirement |
| `headline` | String | short public headline |
| `bio` | String | public biography (50–2000 chars, validated at the API) |
| `subjectsJson` | String | JSON string[] (1–8 tags) |
| `levelsJson` | String | JSON string[] — education levels served (mirrors the onboarding level set) |
| `languagesJson` | String | JSON string[] (1–6 tags) |
| `qualificationsText` | String | qualification details reviewed by admins |
| `experienceYears` | Int | 0–60, validated at the API |
| `portfolioUrl` | String? | optional public portfolio / professional profile URL (http/https, ≤300 chars) |
| `verificationStatus` | String @default("PENDING") | `PENDING \| APPROVED \| REJECTED` |
| `isPublished` | Boolean @default(false) | set true automatically on approval; teacher can unpublish/toggle |
| `reviewedBy` | String? | Student.id of the admin who decided the CURRENT state (cleared on resubmission) |
| `reviewedAt` | DateTime? | decision time of the current state |
| `reviewNote` | String? | latest decision note — PRIVATE (applicant + admins only) |
| `createdAt` / `updatedAt` | DateTime | timestamps |

Relations: `student` (→ Student), `classSessions` (→ ClassSession[]).

**Verification state machine**: PENDING → APPROVED | REJECTED. Resubmission after rejection — or a verification-relevant profile edit by an APPROVED teacher (teachingName, bio, subjects, levels, languages, qualificationsText, experienceYears, portfolioUrl) — returns the profile to PENDING (re-review). Only APPROVED + `isPublished` profiles appear in the public marketplace. Review fields (`reviewedBy/At/Note`) are cleared on resubmission so the "current state" is never stale; the decision history itself lives in TeachAuditEvent.

## TeachAuditEvent

Unified append-only audit trail for the whole domain. Rows are NEVER updated or deleted — a re-review appends a new event, so earlier decisions remain provable.

| Field | Type | Notes |
|---|---|---|
| `id` | String @id | cuid |
| `entityType` | String | `TEACHER_PROFILE \| CLASS_SESSION \| CLASS_BOOKING` |
| `entityId` | String | TeacherProfile.id / ClassSession.id / ClassBooking.id — plain string, NO FK by design (polymorphic) |
| `actorId` | String | Student.id of the actor (applicant / teacher / admin) |
| `actorRole` | String | role held at decision time (`STUDENT \| PYQ_CURATOR \| ADMIN`) |
| `action` | String | `SUBMIT \| RESUBMIT \| EDIT_REVIEW \| PUBLISH_TOGGLE \| APPROVE \| REJECT \| CLASS_CANCELLED \| ATTENDANCE_MARKED` |
| `detail` | String? | context (rejection reason, attendance transition `PREV → NEW`, released-reservation count, …) |
| `createdAt` | DateTime | decision time |

Polymorphic by design: one table covers teacher review, class cancellation and attendance audit, and `entityId` intentionally has no foreign key so all three entity types share one trail. Every mutation in the domain appends here; rows are never updated or deleted afterwards.

## ClassSession

One teacher class.

| Field | Type | Notes |
|---|---|---|
| `id` | String @id | cuid |
| `teacherProfileId` | String | FK → TeacherProfile (onDelete: Cascade) |
| `title` | String | 8–120 chars (validated at the API) |
| `description` | String | 50–4000 chars (validated at the API) |
| `subject` | String | free-text subject tag (2–60 chars) |
| `targetLevel` | String | education level the class is aimed at (onboarding level set) |
| `language` | String | 2–30 chars |
| `durationMinutes` | Int | 60..360 in 30-minute increments (enforced server-side) |
| `startsAt` | DateTime | stored in UTC; display renders in `timeZone` |
| `timeZone` | String | IANA time zone selected by the teacher (validated with `Intl.DateTimeFormat`) |
| `capacity` | Int | 1..50 |
| `minimumStudents` | Int | 1..capacity |
| `bookedCount` | Int @default(0) | seats currently held = bookings whose status is NOT CANCELLED — maintained ONLY inside transactions with conditional updates (see invariants below) |
| `plannedPricePaise` | Int @default(0) | METADATA ONLY during the free pilot — never charged, no order is created |
| `status` | String @default("DRAFT") | `DRAFT \| PUBLISHED \| CANCELLED \| COMPLETED` |
| `publishedAt` | DateTime? | set on publish; cleared on unpublish |
| `cancelledAt` | DateTime? | set transactionally on cancellation |
| `createdAt` / `updatedAt` | DateTime | timestamps |

Relations: `teacherProfile` (→ TeacherProfile), `bookings` (→ ClassBooking[]).

## ClassBooking

One booking record per student per class.

| Field | Type | Notes |
|---|---|---|
| `id` | String @id | cuid |
| `classSessionId` | String | FK → ClassSession (onDelete: Cascade) |
| `studentId` | String | FK → Student (onDelete: Cascade) |
| `status` | String @default("CONFIRMED") | `CONFIRMED \| CANCELLED \| ATTENDED \| NO_SHOW` |
| `bookedAt` | DateTime | set on (re-)activation |
| `cancelledAt` | DateTime? | set on cancellation; cleared on rebooking |
| `attendanceMarkedAt` | DateTime? | set when the teacher marks ATTENDED / NO_SHOW |
| `createdAt` / `updatedAt` | DateTime | timestamps |

**Unique constraint** `@@unique([classSessionId, studentId])`: one booking record per student per class — rebooking after cancellation re-activates the SAME row (status back to CONFIRMED, `cancelledAt` cleared), never a duplicate, keeping history intact.

## Student back-relations

Additive only (no new columns on Student):

- `teacherProfile` `TeacherProfile?` — the account's teacher capability (present once approved/reviewed).
- `classBookings` `ClassBooking[]` — the account's reservations as a student.

## Indexes and their purpose

| Index | Table | Purpose |
|---|---|---|
| `TeacherProfile_studentId_key` (UNIQUE) | TeacherProfile | enforces exactly one profile per account; also powers `findUnique({ where: { studentId } })` in the guard |
| `TeacherProfile_verificationStatus_idx` | TeacherProfile | admin queues filter by PENDING/APPROVED/REJECTED; marketplace filter `verificationStatus = APPROVED` |
| `TeachAuditEvent_entityType_entityId_createdAt_idx` | TeachAuditEvent | ordered history fetch per entity (application dialogs, class audit) |
| `TeachAuditEvent_actorId_createdAt_idx` | TeachAuditEvent | per-actor audit lookups ("everything this admin/teacher did") |
| `ClassSession_status_startsAt_idx` | ClassSession | marketplace queries: `status = PUBLISHED AND startsAt > now ORDER BY startsAt` |
| `ClassSession_teacherProfileId_startsAt_idx` | ClassSession | teacher dashboard listing + teacher profile page (upcoming classes) |
| `ClassBooking_classSessionId_status_idx` | ClassBooking | held-seat counts (`status != CANCELLED`), enrollment lists per class |
| `ClassBooking_studentId_status_idx` | ClassBooking | My bookings per student |
| `ClassBooking_classSessionId_studentId_key` (UNIQUE) | ClassBooking | one booking per student per class; makes rebooking-reuse enforceable |

(The `Student.role` index from Phase 2B is unchanged.)

## Migration: `20261118030000_bean_teach_marketplace`

- Generated with `prisma migrate diff` (from the live DB state → the new schema), so the SQL contains exactly the four CREATE TABLE statements and nine CREATE INDEX statements above — nothing else. The SQL is committed (`prisma/migrations/20261118030000_bean_teach_marketplace/migration.sql`) and applied to the live DB via `prisma migrate deploy`/`dev` (5 migrations recorded in `_prisma_migrations`; `bun run db:status` reports "Database schema is up to date!").
- No `UPDATE`/`DELETE` statements — purely additive; existing data untouched.

### Baselining note (important historical context)

The runtime DB had originally been built with `prisma db push` (per ADR-003), so `_prisma_migrations` had no records for the four pre-existing migrations (`20261118000000_baseline`, `20261118010000_phase2a_foundation`, `20261118020000_job_payload`, `20261118024220_student_roles_review_audit`). Before the 4A change:

1. **Zero-drift verified first**: `prisma migrate diff --from-url <live db> --to-schema-datamodel prisma/schema.prisma` (pre-4A schema) reported NO difference between the live database and the migration history's implied state.
2. **Recorded, not executed**: the four existing migrations were marked via `prisma migrate resolve --applied` — baselining only; no SQL was re-run, no data touched, no reset.
3. **Backup taken before the schema change**: `db/backups/custom-20261118-060309.db` (pre-4A: contains the 23 pre-4A tables, no `TeacherProfile`).
4. Only then was the additive 4A migration created, applied and verified (`bun run db:status`).

## `bookedCount` invariants

1. `bookedCount` equals the number of that class's bookings whose `status != CANCELLED` — ATTENDED/NO_SHOW bookings still hold their historical seat for capacity math on past classes; capacity is only ever claimed while the class is PUBLISHED and in the future.
2. It is maintained ONLY inside transactions, and only through the conditional SQL statements in `src/lib/teach-booking.ts`:
   - claim: `UPDATE "ClassSession" SET "bookedCount" = "bookedCount" + 1, "updatedAt" = ? WHERE "id" = ? AND "status" = 'PUBLISHED' AND "startsAt" > ? AND "bookedCount" < "capacity"` — returns 0 rows when full/started/not published, in which case no booking is created;
   - release: `UPDATE "ClassSession" SET "bookedCount" = MAX("bookedCount" - 1, 0), "updatedAt" = ? WHERE "id" = ? AND "bookedCount" > 0` — a double release is a no-op instead of a negative count.
3. Class cancellation sets `bookedCount = 0` in the same transaction that cancels all held bookings.
4. Defensive reconciliation: `GET /api/teach/my-classes` recomputes the held-seat count per class (one grouped query) and, if it differs from the stored `bookedCount`, corrects the row and logs the drift (`reconciling bookedCount drift for class <id>: X → Y`). The transactional path keeps counts exact; this guards against any manual/external corruption so counts can never silently rot.
5. Every edit endpoint refuses a capacity below the currently held seats; unpublish refuses while seats are held.

## Epoch-millis DateTime storage (why the SQL binds integers)

Prisma 6 stores SQLite `DateTime` columns as **INTEGER milliseconds since the epoch**, not ISO text. The conditional seat-claim/release statements therefore bind epoch-millisecond numbers for `startsAt`/`updatedAt` comparisons. Binding an ISO-8601 string would compare text against integers — numbers always sort before text in SQLite — so the predicate would silently never match (no error, just zero rows and a failed claim). This is documented in the SQL constants themselves and asserted by `tests/unit/teach-seat-sql.test.ts`, which executes the EXACT production SQL against a real in-memory SQLite engine.

Prisma reads/writes all other DateTime fields as usual — only the raw SQL in `src/lib/teach-booking.ts` deals with epoch millis directly.
