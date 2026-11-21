# BEAN Teach — Security (Phase 4A)

This document describes how the teacher marketplace is protected, endpoint by endpoint. The server is the enforcement point everywhere; the UI hides things for usability only (the established Phase 2B pattern).

## Authorization model

Three guards in `src/lib/teach.ts`, used by every route handler:

- **`requireSignedIn()`** — any authenticated account (401 for guests).
- **`requireAdmin()`** — signed in AND `hasRole(role, ['ADMIN'])`; signed-out → 401, signed-in non-admin → 403.
- **`requireApprovedTeacher()`** — signed in AND owns a `TeacherProfile` whose `verificationStatus` is APPROVED. The profile is resolved server-side from the session identity — a client cannot present a profile id, role or "I am a teacher" claim. PENDING → 403 ("still under review"); REJECTED → 403 (resubmit first); no profile → 403.

Underlying guarantees (unchanged from Phase 2A/2B):

- **Identity always comes from the httpOnly session cookie** (`src/lib/auth.ts`) — never from a header, body field or query parameter.
- **Client-supplied ids are never trusted for ownership.** Class ownership is `classSession.teacherProfileId === profile.id` with the profile resolved from the session; booking ownership is the `@@unique([classSessionId, studentId])` lookup keyed on the session student id; application ownership is the unique `studentId` lookup. Foreign resources are reported as 404 (not 403) where the caller has no relationship with them — existence is not leaked.
- **Every mutation enforces same-origin** (`sameOrigin(req)` → 403 otherwise) and **Zod-validates its body** (`src/lib/teach-schema.ts`) before any database access.
- **No API can grant ADMIN or teacher capability.** Roles change only via the operator CLI (`scripts/grant-role.ts`, ADR-014); teacher capability only via admin review of an application. There is no promote endpoint and registration always creates STUDENT.

## Endpoint-by-endpoint authorization matrix

Outcome codes per caller type. "—" = not applicable (guard fires first). 404 is also used for "exists but invisible to you" (no existence leak).

| Endpoint (method) | Guest | Signed-in student | Owner teacher | Other teacher (approved) | ADMIN |
|---|---|---|---|---|---|
| `GET /api/teach/application` | 401 | own application (or `null`) | own application | own application | own application |
| `POST /api/teach/application` | 401 | 201 SUBMIT / 200 RESUBMIT / 409 duplicate·pending·approved | 409 (already approved) | 409 (already approved) | 409 (already approved) |
| `PATCH /api/teach/application` | 401 | 404 (no application) / edits own | own edits (+ `isPublished` allowed) | own edits | own edits |
| `GET /api/admin/teach/applications` | 401 | 403 | 403 | 403 | 200 (full queue) |
| `POST /api/admin/teach/applications/[id]/review` | 401 | 403 | 403 | 403 | 200 approve/reject; **403 self-review**; 404 unknown; 409 already-approved |
| `GET /api/teach/classes` (discovery) | 200 | 200 | 200 | 200 | 200 (public; only PUBLISHED + approved + published teachers) |
| `POST /api/teach/classes` | 401 | 403 (not approved) | 201 | 201 | 403 unless the admin is also an approved teacher |
| `GET /api/teach/classes/[id]` | 200 published/cancelled; **404 draft** | same + own `myBooking` | own incl. `ownerBookings` (and drafts) | 404 draft; no owner bookings | same as student |
| `PATCH /api/teach/classes/[id]` | 401 | 403 / 404 (foreign) | 200 own; 409 CANCELLED·COMPLETED; 409 capacity < held seats | 404 (foreign class — not revealed) | 403 unless owner |
| `POST .../publish` | 401 | 403 | 200 own DRAFT→PUBLISHED; 409 wrong state/past schedule | 404 (foreign) | 403 unless owner |
| `POST .../unpublish` | 401 | 403 | 200 PUBLISHED→DRAFT; **409 while seats held** | 404 (foreign) | 403 unless owner |
| `POST .../cancel` | 401 | **404** (no relationship) | 200 own; 409 DRAFT·CANCELLED·COMPLETED | **404** (no relationship) | 200 (admin may cancel any non-draft class) |
| `POST .../book` | 401 | 201 / 409 full·started·cancelled·duplicate / 403 self-booking / 404 draft·unknown | 403 (own class) | 201 (a teacher can be a student in others' classes) | 201 |
| `DELETE .../book` | 401 | 200 own / 404 no active booking or window on cancelled class / 409 window closed (after start) | n/a (own class bookings 404) | 200 own booking | 200 own booking |
| `POST .../attendance` | 401 | 403 | 200 own class's booking; 404 foreign/unknown; **409 before class end** | **404** (foreign class) | 403 unless owner |
| `GET /api/teach/my-classes` | 401 | 403 | 200 (own classes + enrollment) | 200 (own) | 403 unless approved teacher |
| `GET /api/teach/my-bookings` | 401 | 200 (own only) | 200 (own as student) | 200 (own) | 200 (own) |
| `GET /api/teach/teachers`, `/api/teach/teachers/[id]` | 200 (public profiles only) | 200 | 200 | 200 | 200; pending/rejected/unpublished profiles → 404 for everyone |

Notes on deliberate choices:

- **Cancel is owner-or-admin, 404-masked**: a signed-in student with no relationship gets 404, not 403, so class ids cannot be enumerated through the cancel endpoint.
- **Cross-teacher writes are 404** (patch/publish/unpublish/attendance): the ownership check runs before any state check.
- **Self-booking is 403** (explicit), not 404 — the class is visible to the teacher; only the action is forbidden.
- **Book DELETE re-derives the booking** from `(classSessionId, session studentId)` — "another student's booking" is unreachable by construction.

## Privacy rules

- **No public emails or phones, anywhere.** Public teacher DTOs (`toPublicTeacher`, `toPublicClass`) expose teaching name, headline, bio, subjects/levels/languages, experience, portfolio URL and class counts only. The application form collects NO contact field at all.
- **Enrolled students show display names only** — the owner teacher sees `studentName` (nullable), booking status and timestamps; never an email or any contact detail.
- **Review notes are private**: `reviewNote` is returned only on the applicant's own view and on the ADMIN DTO; public DTOs never include it. Rejection reasons are shown to the applicant (so they can fix and resubmit) and to admins — not to other students.
- **Application fields deliberately exclude DOB, bank details, Aadhaar/PAN** or any government identity — enforced by the Zod schema (`teachApplicationSchema` has no such fields; extra fields are dropped).
- **Admin listing is the only surface exposing the applicant email** (`GET /api/admin/teach/applications` includes `applicant.email` for ADMIN review accountability, per the Phase 2B curator pattern).

## Abuse controls

- **Bounded page sizes**: marketplace classes ≤ 48 (default 12), teachers ≤ 48 (default 24), admin applications ≤ 50 (default 20); page index clamped to 1..500; result sets bounded (`take: 200` bookings, `take: 500` enrollment rows, `take: 100` owner bookings, `take: 1000` audit batch).
- **Query length caps**: search `q` ≤ 100 chars, filter params ≤ 30–60 chars — all sliced server-side before hitting SQLite `contains`.
- **≤ 50 active (DRAFT + PUBLISHED) classes per teacher** (409 above) — anti-spam cap (`MAX_ACTIVE_CLASSES_PER_TEACHER`).
- **Validation on create, edit AND publish**: duration 60–360 min in 30-min steps; capacity 1–50; minimum ≤ capacity; schedule must be strictly in the future; IANA time zone validated with `Intl.DateTimeFormat`; portfolio URL http/https ≤ 300 chars; planned price 0–10,000,000 paise.
- **Zod validation on every mutating endpoint**; unknown/extra fields are stripped, so no client can smuggle `verificationStatus`, `bookedCount`, `role` or `reviewNote` through a create/edit body.
- **State guards everywhere**: 409 for wrong-state transitions (publish a non-draft, unpublish with held seats, cancel a draft/completed, book a started/cancelled class, duplicate booking), and transactional consistency for the ones that must be atomic.

## Audit trail

Append-only `TeachAuditEvent` — rows are never updated or deleted. One row per decision, each carrying actor id + role held + timestamp + detail:

| Action | Written when | Entity |
|---|---|---|
| `SUBMIT` | first application submitted | TEACHER_PROFILE |
| `RESUBMIT` | resubmission after rejection, or a PENDING applicant's edit | TEACHER_PROFILE |
| `EDIT_REVIEW` | APPROVED teacher edits verification-relevant fields (profile → PENDING) | TEACHER_PROFILE |
| `PUBLISH_TOGGLE` | approved teacher changes marketplace visibility | TEACHER_PROFILE |
| `APPROVE` / `REJECT` | admin decision (detail carries the note/reason) | TEACHER_PROFILE |
| `CLASS_CANCELLED` | owner teacher or admin cancels a class (detail carries released-reservation count) | CLASS_SESSION |
| `ATTENDANCE_MARKED` | teacher marks/changes attendance (detail carries `PREV → NEW`) | CLASS_BOOKING |

The audit write happens INSIDE the same transaction as the state change, so an audit row exists if and only if the change happened. History is exposed to the applicant (own application), to admins (full dialog) — never publicly.

## Integrity blocks

- **Self-review forbidden**: `POST /api/admin/teach/applications/[id]/review` refuses when `profile.studentId === reviewer.id` (403) — an admin cannot approve their own teaching application.
- **No API can grant ADMIN**: role changes happen only through `scripts/grant-role.ts` on the server (dry-run default, last-ADMIN protection). Admin review can only APPROVE/REJECT a teaching application; it cannot touch roles.
- **No API can create a charge**: the pilot has no order/payment model at all; `plannedPricePaise` is inert metadata (ADR-019).
- **Seat integrity**: `bookedCount` changes only inside transactions via the conditional SQL in `src/lib/teach-booking.ts` — the loser of a last-seat race gets 409 and no booking row; release is double-release-safe; drift is reconciled with logging on `GET /api/teach/my-classes` (ADR-018).

## School-age safety notes

- BEAN LEARN serves school students (levels SCHOOL_6_8 / 9_10 / 11_12). Phase 4A introduces **no private adult–minor messaging**: the marketplace has no chat, no DMs, and no comment surfaces between teachers and students. All class content is structured and reviewed (admin-approved teacher profiles; teacher-authored class fields visible to everyone).
- **No unnecessary child data is collected**: applications exclude DOB/contact/identity documents (ADR-016 posture); booking stores only the student id, timestamps and status. Students appear to their teacher by display name only.
- The only student→teacher exposure is the display name of an enrolled student inside the owner's enrollment list; the only teacher→student exposure is the admin-approved public profile. Both are minimal by design; parental consent tooling remains future work (documented in PHASE2B docs).
