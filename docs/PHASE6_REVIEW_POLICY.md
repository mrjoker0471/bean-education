# BEAN Teach — Verified review policy (Phase 6)

This document states the rules BEAN Teach actually enforces on class reviews — eligibility, one-per-booking, the moderation state machine, edit windows, privacy and aggregates. It mirrors `src/lib/trust.ts` (pure rules), `src/lib/trust-schema.ts` (validation bounds), `src/lib/trust-dto.ts` (privacy mapping) and the routes under `src/app/api/teach/reviews/*` and `src/app/api/admin/trust/reviews/*`. The public-facing summary lives at `#/trust-policy`.

## Eligibility matrix

A review can be created only through `POST /api/teach/classes/:id/reviews`, which runs `evaluateReviewEligibility()` inside the create transaction. Identity always comes from the httpOnly session cookie; teacher attribution comes from the class row, never from the client.

| Situation | Outcome | Wording returned |
|---|---|---|
| Class missing or DRAFT | 404 | "Class not found" |
| No booking for this (class, student) / booking belongs to someone else | 403 | "Only students who attended this class can review it." |
| Booking's class does not match the stated class | 403 | "This booking does not belong to the stated class." |
| Booking CANCELLED | 403 | "Cancelled reservations cannot be reviewed." |
| Booking NO_SHOW | 403 | "Classes you did not attend cannot be reviewed." |
| Booking not ATTENDED yet (CONFIRMED) | 403 | "Reviews open once the teacher confirms your attendance." |
| Class has not ended yet (`startsAt + durationMinutes` in the future) | 403 | "Reviews open after the class has ended." |
| A review already exists for this booking | 409 | "You have already reviewed this class." |
| ATTENDED booking, class ended, no existing review | ok | review is created PUBLISHED with `isVerified: true` |

Rating is an integer 1–5 (Zod + `isValidRating` on create AND edit). Text bounds: title ≤ 120 chars (optional), reviewText 20–2000 chars, plain text only — control characters are rejected (see docs/PHASE6_SECURITY.md).

Attendance remains teacher-marked: a CONFIRMED student cannot review until the teacher marks ATTENDED (Phase 5 live evidence assists the teacher but never auto-marks). This is deliberate — a student is never marked attended merely by joining a room, and technical failure never auto-penalises anyone.

## One review per booking

- `ClassReview.bookingId` is UNIQUE at the database level; the Prisma relation is one-to-one (`ClassBooking.review`).
- The create transaction re-checks the booking, class, eligibility and existing review inside `db.$transaction`; a second racer loses and gets the honest 409.
- Concurrent duplicate creation is the P2002 unique-violation case → 409 "You have already reviewed this class." The DB index is the last line of defence.
- Rebooking the same class re-activates the SAME booking row (Phase 4A rule), so history stays one-booking-one-review even across cancel/rebook cycles.

## State machine

```
                    create (ATTENDED booking, class ended)
                                   │
                                   ▼
                             ┌───────────┐
        ┌── KEEP_PUBLISHED ──▶│ PUBLISHED │◀── RESTORE (admin) / appeal OVERTURNED ──┐
        │   (admin decision) └───────────┘                                          │
        │                           │                                               │
        │            flag (owner teacher or ADMIN,  │                                │
        │            written reason, REVIEW_FLAGGED)│                                │
        │                           ▼                                               │
        │                   ┌───────────┐                                           │
        └───────────────────│  FLAGGED  │  stays PUBLICLY VISIBLE while under       │
                            └───────────┘  moderation; excluded from aggregates      │
                            (already-FLAGGED flag → 409;                             │
                             HIDDEN review cannot be flagged → 409)                  │
                                   │                                                 │
                                   ▼                                                 │
                            ┌───────────┐   admin RESTORE (or appeal OVERTURNED)     │
                            │  HIDDEN   │─────────────────────────────────────────────┘
                            └───────────┘   HIDDEN: author-only view + moderation reason;
                                            cannot be edited (409)
```

- **Flag** (`POST /api/teach/reviews/:reviewId/flag`): only the reviewed class's owner teacher (APPROVED profile) or an ADMIN. Requires a written reason (10–600 chars). Sets FLAGGED — flagging is NEVER auto-hiding. Rate limit 20 flags/day (counted from the append-only REVIEW_FLAGGED audit events, so deleted reviews do not reset the cap).
- **Moderate** (`POST /api/admin/trust/reviews/:reviewId/moderate`, ADMIN only): KEEP_PUBLISHED (FLAGGED → PUBLISHED; "criticism is not a violation"), HIDE (any visible state → HIDDEN), RESTORE (HIDDEN → PUBLISHED). A documented reason (10–600 chars) is mandatory for every decision. Only an authorised moderator may hide; a negative review alone is never sufficient grounds.
- **No-op protection**: moderation of a review already in the requested state → 409; repeated flagging → 409.
- Every transition writes a `TeachAuditEvent` (entityType CLASS_REVIEW: REVIEW_FLAGGED / REVIEW_HIDDEN / REVIEW_KEPT_PUBLISHED / REVIEW_RESTORED) inside the same transaction. History is never deleted — re-moderation appends.
- Complaints never touch review status; the flag route is the only non-admin path to FLAGGED (asserted by static tests).

## Edit window

- The author may edit rating / title / text / display-name consent for **7 days** after creation (`REVIEW_EDIT_WINDOW_DAYS = 7`, `isWithinEditWindow`).
- Edits set `editedAt` and append a REVIEW_EDITED audit event ("author edit within 7-day window"). The edit never touches moderation state.
- HIDDEN reviews cannot be edited (409 "This review is under moderation and cannot be edited.").
- Window closed → 409 with the honest wording "Reviews can be edited for 7 days after posting."
- The edit endpoint reuses the REVIEWS_PER_DAY (10/day) rolling-window counter as its anti-spam cap.
- The same 7-day rule applies to teacher responses (`RESPONSE_EDIT_WINDOW_DAYS = 7`).

## Privacy

- Public review data NEVER includes emails, account ids, phone numbers or complaint information (`toPublicReview` in `src/lib/trust-dto.ts`).
- The reviewer is always shown as **"Verified student"**. The display name appears ONLY when the author explicitly consented (`showDisplayName` — a checkbox in the composer, stored on the review row itself, not on the student profile). Consent can be changed by editing the review inside the window.
- The author alone receives their review's moderation block (`ownStatus`, `ownModerationReason`, `canEdit`) via the author-unlock in the public mapper; `moderationReason` is PRIVATE — admins and the author only.
- The author sees their own review in ANY state (the public list adds the viewer's own rows regardless of status), so a hidden review never silently vanishes from its author.
- The admin moderation queue DTO (`toAdminReview`) adds reviewer identity (id, display name, email) and full class/teacher context — justified for investigation, ADMIN-guarded, never public.

## Aggregates — what counts and what never counts

`computeTeacherQuality()` (pure) + `teacherQualityFor()`/`teacherQualityBatch()` (server recomputation from authoritative rows — aggregates are never accepted from the browser):

| Metric | Counts | Never counts |
|---|---|---|
| `averageRating` | PUBLISHED **and** isVerified reviews (mean, 1 decimal) | FLAGGED reviews (excluded while under moderation), HIDDEN reviews, anything else; `null` when no sample — never a fabricated 0 |
| `reviewCount` | published verified reviews | — |
| `completedClasses` / `completionRate` | COMPLETED sessions; rate = completed/(completed+cancelled), rounded to 2 decimals, `null` when the denominator is 0 | — |
| `publishedClasses` | currently PUBLISHED sessions | — |

- `sampleSufficient = reviewCount >= 3` (`QUALITY_MIN_SAMPLE = 3`). Below the threshold the UI renders "New teacher — not enough verified reviews yet" (`QualityLine` in `src/components/bean/trust/quality-metrics.tsx`) — no numeric score is shown from an insufficient sample.
- Complaint data is structurally excluded: `computeTeacherQuality` takes no complaint input, so complaint volume can never influence public ratings. Complaints also never appear in any public or teacher-facing DTO (anonymous open count only — see docs/PHASE6_COMPLAINTS_AND_APPEALS.md).

## Teacher responses

- One public reply per review: `TeacherReviewResponse.reviewId` is UNIQUE; a second response is rejected in-transaction and by the DB (P2002 → 409 "You have already responded to this review.").
- Only the reviewed class's OWNER teacher (APPROVED profile via `requireOwnTeacherProfile`, then `review.teacherProfileId === profileId`) may respond. Students can never create teacher responses; a foreign teacher can never respond outside their own classes.
- Bounds: 20–1000 chars, plain text only. Edits are allowed for 7 days (`editedAt`), audited TEACHER_RESPONSE_CREATED / TEACHER_RESPONSE_EDITED.
- **Teachers can never edit the student's review itself** — through this route or any other. The PATCH on `/api/teach/reviews/:reviewId` checks `review.studentId === student.id` intrinsically.
- **Retaliation policy**: the response surface exists for factual, respectful replies. Threats, harassment or retaliation in a response are policy violations handled by human moderation (the same flag/admin review path as reviews; admin moderation of reviews includes the response text in the queue DTO). The policy forbids retaliation — enforced by moderation, not by client claims. There is no automated language screening (deliberate; see docs/PHASE6_SAFEGUARDING.md).

## Appeal path for moderation

- An author whose review was HIDDEN can file `POST /api/teach/appeals` with `targetType: REVIEW_MODERATION` — only the review's author, and only while the review is HIDDEN (otherwise 403/409).
- `originalDecisionById` is captured SERVER-SIDE from the latest REVIEW_HIDDEN audit event, so the deciding reviewer cannot be the admin who hid the review (self-review ban; see docs/PHASE6_COMPLAINTS_AND_APPEALS.md for the workflow).
- An OVERTURNED appeal restores the review to PUBLISHED with a documented reason ("Appeal <id> overturned the hiding decision") and a REVIEW_RESTORED audit event. The original decision history is never rewritten.
- Reasons are bounded (30–2000 chars); duplicate open appeals for the same target → 409; rate limit 5/day.
