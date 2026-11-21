# BEAN Teach — Implementation Guide (Phase 4A)

**Teacher Marketplace Foundation (Free Pilot)**
Branch `feat/bean-teach-marketplace`, based on merged `main` (f573b54, contains all of Phase 2B).

BEAN Teach lets approved teachers publish classes and students reserve free seats. This milestone ships the full marketplace foundation: application → admin review → teacher dashboard → class discovery → free booking → attendance. There are NO payments anywhere — every class is a free pilot, the optional planned price is stored as paise metadata and is never charged (ADR-019). The in-platform live classroom is Phase 5; the class detail page says so honestly instead of showing fake video controls.

## The four user experiences

### A. Student marketplace — `#/classes` and `#/classes/:id`

- **Discovery is public.** Guests and signed-in students browse `#/classes` freely: only PUBLISHED, upcoming classes from APPROVED + published teachers are listed (drafts and cancelled classes are server-side filtered out). Filters: subject, level, language, duration bucket (SHORT 60–90 / MEDIUM 120–180 / LONG 210–360 minutes), date range (from/to), teacher name or id, plus a bounded search over title/description/subject/teaching name. Pagination is bounded (default 12, max 48 per page) and seat counts (`bookedCount`, `availableSeats`) are always server-computed.
- **Class detail** shows the full schedule rendered in the class's IANA time zone, duration, capacity vs seats left, teacher identity (teaching name, headline, reviewed qualifications + experience years), and — for the signed-in viewer — their own booking state. Cancelled classes stay viewable so affected students can always check their class.
- **Reserving a seat is free** and always requires sign-in: guests see everything but are asked to sign in only at reservation time. Booking is atomic (see "Booking state machine" below) and refuses started/cancelled/full classes and a teacher booking their own class.
- **My bookings** (`#/classes?tab=bookings`, signed-in only) groups the student's reservations into upcoming / completed / cancelled, with attendance badges (ATTENDED / NO_SHOW) once the teacher marks them. Cancelling before the class starts releases the seat.
- **Teacher discovery is API-first**: `GET /api/teach/teachers` and `/api/teach/teachers/:id` expose approved + published profiles only — teaching name, headline, bio, subjects/levels/languages, experience, portfolio link, upcoming class count. Never an email, phone or review note. (The typed client methods `teachTeachers`/`teachTeacher` are ready; this milestone has no dedicated teacher-directory UI — teacher identity surfaces on class cards and class detail.)

### B. Teacher application — `#/teach/apply`

- Any signed-in student can apply. There is no second login, no paid registration, and the form deliberately does NOT collect date of birth, bank details or government identity documents (Aadhaar/PAN) — the same school-age-safety posture as onboarding (ADR-016).
- Fields: teaching name (public, never a real-name requirement), headline, bio, subjects (1–8 tags), levels (mirrors the onboarding level set), languages (1–6 tags), qualifications text (reviewed by admins), experience years, optional portfolio URL (http/https, ≤300 chars).
- **State machine**: NOT_APPLIED → PENDING (SUBMIT) → APPROVED | REJECTED. Exactly one profile per account (unique `studentId`); simultaneous double-submits are refused by the unique constraint (409). A PENDING applicant edits instead of resubmitting (409 on POST); an APPROVED teacher edits their profile (PATCH).
- **Rejection is actionable**: the admin's reason (mandatory, 10–400 chars) is shown to the applicant, who can correct and resubmit — the SAME row returns to PENDING (never a duplicate), and the append-only audit history preserves every prior decision.
- The applicant's own view includes their review history (action, detail, actor role, time) and their latest review note; nobody else's application is ever visible to them.

### C. Teacher dashboard — `#/teach/dashboard` (approved teachers only)

- **Public profile management**: view and edit what students see (teaching name, headline, bio, subjects, levels, languages, qualifications, experience, portfolio). Any verification-relevant edit by an APPROVED teacher returns the profile to PENDING and unpublishes it until an admin re-approves (classes vanish from the marketplace meanwhile). Approved teachers can also toggle marketplace visibility (`isPublished`) — that toggle is audited (PUBLISH_TOGGLE).
- **Class lifecycle**: DRAFT → PUBLISHED → CANCELLED | COMPLETED, with explicit publish/unpublish (details in "Class state machine" below).
- **Create dialog rules** (validated server-side on create, edit AND publish): duration 60–360 minutes in 30-minute steps; capacity 1–50; minimum enrolment ≤ capacity; schedule must parse and be in the FUTURE; the IANA time zone is validated server-side and stored separately from the UTC `startsAt` timestamp; optional planned price is paise metadata only (labelled "Planned regular price — not charged during the free pilot."). A teacher can hold at most 50 active (DRAFT + PUBLISHED) classes (409 above that).
- **Publishing** is explicit: drafts are never public. Publishing re-validates the schedule (a draft whose start time passed cannot be published). Unpublishing is blocked while any seat is held — the teacher must cancel the class instead so booked students see it.
- **Attendance**: after `startsAt + durationMinutes` has fully passed (server-side time check; 409 before that), the teacher marks ATTENDED or NO_SHOW per booking. Re-marking is allowed while the class remains and every change appends an audit event (old → new, actor, role, time).
- **Enrollment view**: the teacher sees bookings for their own classes — display names ONLY, never emails or contact details.

### D. Admin review — `#/teach/review` (ADMIN only)

- Queues: pending / approved / rejected / all, with bounded search (teaching name, applicant email, display name) and pagination (default 20, max 50).
- The full application dialog shows every field plus the append-only history (SUBMIT / RESUBMIT / EDIT_REVIEW / APPROVE / REJECT with actor role and timestamp).
- **Approve**: optional decision note. The profile becomes APPROVED and is published to the marketplace automatically; reviewer id, role, date and note are recorded.
- **Reject**: a written reason of 10–400 characters is mandatory. The profile is REJECTED and unpublished; the reason is shown to the applicant so they can resubmit.
- **Integrity**: an admin can NEVER review their own application (403); approving an already-approved profile is a 409. Admin identity comes from the session cookie; ADMIN itself is granted only via the operator CLI (no API can promote anyone — unchanged from Phase 2B).

## Class state machine

```
              create (validated)            publish (explicit)
   [new] ──────────────► DRAFT ──────────────► PUBLISHED ──► (display derives COMPLETED
                           ▲    unpublish         │            once endsAt has passed)
                           │    only when zero    │ cancel (owner or admin)
                           │    seats are held    ▼
                           └──────────────── CANCELLED   (terminal; releases all seats)
```

- **DRAFT**: owner-only (even the API returns 404 to everyone else). Can be edited freely.
- **DRAFT → PUBLISHED**: explicit POST, re-validates that the schedule is still in the future and capacity/minimum are consistent.
- **PUBLISHED → DRAFT (unpublish)**: only while ZERO seats are held; otherwise 409 with guidance to cancel instead.
- **PUBLISHED → CANCELLED**: owner teacher or ADMIN, transactionally cancels every seat-holding booking (students see it in My bookings), resets `bookedCount` to 0 and appends a CLASS_CANCELLED audit event. Drafts cannot be "cancelled" (409 — edit or discard instead); COMPLETED classes cannot be cancelled.
- **COMPLETED** is derived from the schedule for display (`startsAt + durationMinutes` in the past) — the stored status stays PUBLISHED until the teacher acts or cancels; there is no completion automation in this milestone.
- **Edits are blocked** on CANCELLED and COMPLETED (409). Capacity can never be reduced below the number of seats currently held. Schedule edits must stay in the future.

## Booking state machine

```
                 (reserve, free, atomic seat claim)
   [no row] ────────────────────────────────────► CONFIRMED
                 (rebooking re-activates the SAME row)
   CANCELLED ───────────────────────────────────► CONFIRMED
   CONFIRMED ──► CANCELLED   by the student, before the class starts (seat released)
   CONFIRMED ──► CANCELLED   automatically when the class is cancelled (seat released)
   CONFIRMED ──► ATTENDED | NO_SHOW   by the owner teacher, only AFTER the class ends
```

- Seats are handed out ONLY by one conditional SQL `UPDATE … WHERE bookedCount < capacity` inside the booking transaction (`src/lib/teach-booking.ts`, ADR-018): two students racing for the last seat cannot both win; the loser gets 409 and no booking row is created.
- One booking record per student per class (`@@unique([classSessionId, studentId])`): a cancelled booking is re-ACTIVATED on rebooking (same row, history intact), never duplicated.
- The student's cancellation window closes when the class starts (`startsAt <= now` → 409).
- Booking another student's class, another student's booking and the teacher's own class are unreachable: lookups are scoped to the session identity (404/403 respectively).

## API endpoints

14 route files (19 handler functions) under `/api/teach/*` and `/api/admin/teach/*`. All responses are `Cache-Control: no-store`; all mutations enforce same-origin and Zod-validate their bodies (`src/lib/teach-schema.ts`). Guest = not signed in; student = any signed-in account; owner teacher = signed-in account whose APPROVED `TeacherProfile` owns the class (resolved server-side).

| # | Route | Method | Auth | Contract (one line) |
|---|---|---|---|---|
| 1 | `/api/teach/application` | GET | student | Own application + review history; `{ application: null }` when NOT_APPLIED |
| 2 | `/api/teach/application` | POST | student | SUBMIT first application (201) or RESUBMIT after REJECTED (200); 409 when PENDING/APPROVED/duplicate |
| 3 | `/api/teach/application` | PATCH | student | Edit own application; verification-relevant edits force re-review (EDIT_REVIEW) or RESUBMIT; `isPublished` toggle for approved teachers only |
| 4 | `/api/admin/teach/applications` | GET | ADMIN | Paginated queue (status/q/page/pageSize ≤ 50) with applicant basics + append-only history |
| 5 | `/api/admin/teach/applications/[id]/review` | POST | ADMIN | APPROVE (optional note) / REJECT (mandatory 10–400 char reason); 404 unknown, 403 self-review, 409 already-approved |
| 6 | `/api/teach/classes` | GET | public | PUBLISHED upcoming classes of approved+published teachers; bounded filters/search/pagination (≤ 48) |
| 7 | `/api/teach/classes` | POST | approved teacher | Create a DRAFT class (duration/capacity/schedule/time-zone validation; ≤ 50 active classes) |
| 8 | `/api/teach/classes/[id]` | GET | public | Class detail; drafts owner-only; includes viewer's `myBooking` and owner-only `ownerBookings` (display names) |
| 9 | `/api/teach/classes/[id]` | PATCH | owner teacher | Edit own class; CANCELLED/COMPLETED immutable; capacity ≥ held seats; schedule stays future |
| 10 | `/api/teach/classes/[id]/publish` | POST | owner teacher | DRAFT → PUBLISHED after re-validating schedule/capacity/minimum |
| 11 | `/api/teach/classes/[id]/unpublish` | POST | owner teacher | PUBLISHED → DRAFT only when zero seats are held (409 otherwise) |
| 12 | `/api/teach/classes/[id]/cancel` | POST | owner teacher or ADMIN | Transactional cancel: class CANCELLED, all held bookings cancelled, `bookedCount` = 0, CLASS_CANCELLED audit event |
| 13 | `/api/teach/classes/[id]/book` | POST | student | Free seat reservation via atomic conditional seat claim; 403 self-booking; 409 full/started/cancelled/duplicate |
| 14 | `/api/teach/classes/[id]/book` | DELETE | student | Booking owner cancels before the class starts; seat released atomically (double-release safe) |
| 15 | `/api/teach/classes/[id]/attendance` | POST | owner teacher | ATTENDED / NO_SHOW on own class's booking AFTER the class has ended; audit event per change |
| 16 | `/api/teach/my-classes` | GET | approved teacher | Own classes + enrolled students (display names) + defensive `bookedCount` reconciliation with drift logging |
| 17 | `/api/teach/my-bookings` | GET | student | Own bookings, newest first (bounded 200), with class summary + teaching name |
| 18 | `/api/teach/teachers` | GET | public | Approved + published teacher profiles with upcoming-class counts; bounded search/pagination (≤ 48) |
| 19 | `/api/teach/teachers/[id]` | GET | public | Teacher profile detail + upcoming PUBLISHED classes; pending/rejected/unpublished profiles are 404 |

Typed client methods for all of the above live in `src/lib/api.ts` (`teachApplication`, `teachSubmitApplication`, `teachUpdateApplication`, `teachTeachers`, `teachTeacher`, `teachClasses`, `teachClass`, `teachCreateClass`, `teachUpdateClass`, `teachPublishClass`, `teachUnpublishClass`, `teachCancelClass`, `teachBook`, `teachCancelBooking`, `teachMyBookings`, `teachMyClasses`, `teachMarkAttendance`, `adminTeachApplications`, `adminTeachReview`); DTOs live in `src/lib/types.ts`.

## How to test teacher and student flows

1. **Student applies** — register/sign in at `#/auth`, open `#/teach/apply`, submit the form. Verify the PENDING state (the view shows it; `GET /api/teach/application` returns it).
2. **Operator grants ADMIN (CLI only)** — `bun scripts/grant-role.ts --email=<email> --role=ADMIN` (dry-run; add `--yes`). Sign in as that account → header shows **Teacher Review** → `#/teach/review` → open the application → **Approve** (or **Reject** with a ≥10-char reason, then verify the applicant sees the reason and can resubmit).
3. **Teacher creates + publishes** — as the approved teacher, `#/teach/dashboard`: edit the public profile, create a class (future schedule, valid IANA time zone, capacity 1–50), **Publish** it. Check it appears at `#/classes` (signed out AND signed in).
4. **Student books** — a second account opens the class detail → **Reserve a seat** (free). Verify My bookings (`#/classes?tab=bookings`) shows it under Upcoming. Cancel it and verify the seat count recovers; rebook and verify no duplicate row is created.
5. **Race test (optional)** — two sessions booking the last seat simultaneously produce exactly one 201 and one 409 with `bookedCount` frozen at capacity.
6. **Attendance** — wait until `startsAt + durationMinutes` has passed (or point the class schedule in the near past via a test account), then mark ATTENDED / NO_SHOW from the teacher dashboard; verify the badge appears in the student's My bookings and an audit event was appended.

## Known limitations

- **Free pilot only** — the planned price is metadata; nothing is ever charged and no order/wallet/commission logic exists (Phase 8).
- **No notifications** — there is no email/push/in-app notification system; students discover class cancellations through My bookings.
- **No completion automation** — COMPLETED is derived from the schedule for display; the stored status stays PUBLISHED until the teacher acts or the class is cancelled. Drafts cannot be cancelled (409 — edit or discard instead) and there is no draft deletion in this milestone.
- **Attendance re-marking is allowed** (with an audit event per change) — there is no lock-in window.
- **No reviews/quality indicators** — verified reviews and teacher quality stay in Phase 6.
- **No live classroom** — the class detail page honestly states that this phase schedules and reserves classes; in-platform video arrives in Phase 5.
- **SQLite single-writer** — booking transactions serialise; the conditional seat-claim UPDATE is the correctness mechanism (ADR-018). Multi-process deployments would need re-evaluation.
- **Verification is human review only** — admins read the qualifications text; no document upload, third-party verification or background check exists in this milestone.
