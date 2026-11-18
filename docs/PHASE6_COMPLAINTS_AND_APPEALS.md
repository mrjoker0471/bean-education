# BEAN Teach — Complaints & appeals (Phase 6)

How private complaints and appeals actually work on BEAN Teach: categories, server-derived severity, the legitimate-relationship rule, the append-only lifecycle, exactly what each party sees, the admin action reference, and the appeal workflow with the self-review ban. Grounded in `src/lib/trust.ts`, `src/lib/trust-schema.ts`, `src/lib/trust-dto.ts`, `src/app/api/teach/complaints/*`, `src/app/api/teach/appeals/route.ts` and `src/app/api/admin/trust/*`. Safeguarding-specific handling has its own doc: docs/PHASE6_SAFEGUARDING.md.

## Categories (11)

`COMPLAINT_CATEGORIES` in `src/lib/trust.ts` (UI labels from `report-class-dialog.tsx` / `my-reports-view.tsx`):

| Category | Sensitive? | Base severity (server-derived) | Class linkage |
|---|---|---|---|
| TEACHING_QUALITY | no | NORMAL | requires a class the reporter booked or taught |
| MISLEADING_CLASS_DESCRIPTION | no | NORMAL | requires a class |
| TEACHER_CONDUCT | no | HIGH | requires a class |
| STUDENT_CONDUCT | no | HIGH | requires a class (fileable by the class's teacher too) |
| SAFEGUARDING | **yes** | HIGH (filing) — CRITICAL via ESCALATE | may be platform-level (no class) |
| HARASSMENT | **yes** | HIGH (filing) — CRITICAL via ESCALATE | may be platform-level |
| DISCRIMINATION | **yes** | HIGH (filing) — CRITICAL via ESCALATE | may be platform-level |
| CLASS_CANCELLATION | no | NORMAL | requires a class |
| TECHNICAL_PROBLEM | no | NORMAL | requires a class |
| ATTENDANCE_DISPUTE | no | NORMAL | requires a class |
| OTHER | no | NORMAL | may be platform-level |

Text bounds: subject 8–120 chars, description 30–4000 chars, plain printable text only (control characters rejected).

## Severity derivation — the server decides

`deriveComplaintSeverity(category, studentIsMinorContext)`:

1. Sensitive categories (SAFEGUARDING / HARASSMENT / DISCRIMINATION) → **CRITICAL** when a minor context is indicated, otherwise **HIGH**.
2. TEACHER_CONDUCT / STUDENT_CONDUCT → **HIGH**.
3. Everything else → **NORMAL**.

Facts that matter:

- The client cannot assert severity or sensitivity — `complaintCreateSchema` accepts only category/classSessionId/subject/description; the POST route derives both server-side.
- BEAN deliberately collects no date-of-birth/age data (ADR-016), so the filing route calls `deriveComplaintSeverity(category, false)`: a filed safeguarding report starts at HIGH. The pure function's minor-context escalation exists and is unit-tested, but today nothing populates that input automatically. CRITICAL is reached through the admin **ESCALATE** action (investigator judgement), and the escalation is audited.
- `isSensitive = isSensitiveCategory(category)` — the three restricted categories are ADMIN-only server-side (docs/PHASE6_SAFEGUARDING.md).

## Legitimate-relationship rule

A class-linked report (`classSessionId` supplied) requires the caller to hold a genuine product relationship with that class:

- the caller's own booking in that class (booking holder — any status; `classBookingId` is captured on the complaint), **or**
- the class's teacher (student-conduct reports; in this case `teacherProfileId` is deliberately left null — a teacher does not file a complaint against themselves).

Anyone else gets 403 "You can only report classes you booked or taught." DRAFT classes are invisible (404). Platform-level reports (no class) are allowed only for SAFEGUARDING / HARASSMENT / OTHER — enforced by the `complaintCreateSchema` refine with the message "This report needs the class it concerns — pick the class from your bookings, or use a safeguarding category for a platform-level concern."

## Lifecycle and events

Statuses (`COMPLAINT_STATUS`): OPEN → ACKNOWLEDGED → UNDER_REVIEW → WAITING_FOR_INFORMATION → RESOLVED | DISMISSED. The four pre-decision statuses count as "open" (`OPEN_COMPLAINT_STATUSES`).

Admin actions (`POST /api/admin/trust/complaints/:id/action`) — one `ComplaintEvent` per action, written in the same transaction as any state change:

| Action | Status change | Event | Notes |
|---|---|---|---|
| ACKNOWLEDGE | OPEN → ACKNOWLEDGED | ACKNOWLEDGED | no-op otherwise |
| START_REVIEW | OPEN/ACKNOWLEDGED → UNDER_REVIEW | UNDER_REVIEW | no-op otherwise |
| REQUEST_INFO | → WAITING_FOR_INFORMATION | WAITING_FOR_INFORMATION | optional note; complainant replies via PATCH (INFO_PROVIDED) |
| NOTE | unchanged | NOTE_ADDED | internal note — redacted for the complainant |
| ASSIGN | unchanged | ASSIGNMENT_CHANGED | target must be an actual ADMIN (400 otherwise) |
| ESCALATE | unchanged | ESCALATED | severity → CRITICAL; mirrored into TeachAuditEvent; no-op when already CRITICAL |
| RESOLVE | → RESOLVED (+ `resolvedAt`) | RESOLVED | **note mandatory** (schema-level) |
| DISMISS | → DISMISSED (+ `resolvedAt`) | DISMISSED | **note mandatory** (schema-level) |

- RESOLVED / DISMISSED / ESCALATED are mirrored into the unified `TeachAuditEvent` trail (`entityType: COMPLAINT`) so admin decisions are provable alongside reviews and trust actions.
- Duplicate transitions are idempotent no-ops (`unchanged: true`) — identical repeat requests never create duplicate events.
- Adverse consequences (trust actions) are NEVER automatic here: an investigation ends in a documented decision, and any restriction is a separate, explicitly issued TrustAction (`trustAction.create` does not exist on this route — asserted by `tests/unit/free-pilot-protection.test.ts`).
- Rate limit: 10 complaints/day/student (rolling 24 h row count).

## What each party sees

**Complainant** (GET `/api/teach/complaints`, GET/PATCH `/api/teach/complaints/:id`, `toOwnComplaint`):
- Their own complaints only (non-owners — including teachers and other students — get an identical bare 404 with no existence leak).
- id, category, severity, isSensitive, subject, description, status, class title, timestamps and the full event timeline.
- Admin-added NOTE_ADDED events are **redacted** (`detail: null`) by `toComplaintEventDTO`; their own INFO_PROVIDED details stay visible.

**Admin** (GET `/api/admin/trust/complaints*`, `toAdminComplaint`):
- Everything: complainant identity (id, display name, email), assignment, teacher/class/booking anchors, and the unredacted event history (`detailFull`).
- The complaints search endpoint is the ONLY place complaint content is returned; there are no public complaint endpoints anywhere (static test asserts every complaint-touching route lives under `teach/` or `admin/`).

**Teacher** (GET `/api/teach/trust`, `TeacherTrustSummaryDTO`):
- An **anonymous open-complaint count only**. No complaint rows are read into teacher space; no content, subject, category, status, timeline or reporter identity ever reaches a teacher-facing DTO or route. Enforced in code and asserted by static privacy tests ("teachers never see complaint content or status levers").
- Filing a complaint changes nothing for the teacher: no ratings impact, no review changes, no booking mutations, no automatic trust action, no verification-status change.

## Safeguarding priority procedure

The exact guidance text (identical on all surfaces — report dialog, policy view; `SAFEGUARDING_GUIDANCE` in `src/lib/trust.ts`):

> "If anyone is in immediate danger, contact your local emergency services or a trusted adult right away. BEAN operators review safeguarding reports as a priority, but BEAN is not an emergency service."

Why no emergency numbers are invented: BEAN's users span regions with different emergency services; fabricating phone numbers in product copy would be both unsafe and dishonest. The text directs people to their LOCAL emergency services without inventing digits.

Operator procedure (what the code supports):

1. Sensitive cases (`isSensitive: true`) are visible only through the ADMIN-guarded complaint surfaces; the Trust Center filters them (`sensitive=1`) and the overview counts open sensitive cases separately.
2. Prioritise by the server-derived severity (HIGH at filing; ESCALATE → CRITICAL with an audit event when judgement warrants).
3. If a live classroom presents an immediate danger, issue **EMERGENCY_STOP** on the teacher — the only complaint-adjacent mechanism that blocks live start AND join tokens (never automatic; see docs/PHASE6_SAFEGUARDING.md).
4. Any lasting consequence is an explicit, separately issued TrustAction with a documented reason.
5. Decide with RESOLVE or DISMISS (mandatory note) — both audited; the complainant sees the status trail (notes redacted).

## Appeals workflow

`POST /api/teach/appeals` — targets (`APPEAL_TARGET`) and relationship checks (all server-side):

| Target | Who may file | Precondition | `originalDecisionById` source |
|---|---|---|---|
| COMPLAINT_DECISION | the complainant **or** the concerned teacher (APPROVED profile matching `complaint.teacherProfileId`) | complaint must be RESOLVED or DISMISSED (409 otherwise) | actorId of the latest RESOLVED/DISMISSED ComplaintEvent |
| REVIEW_MODERATION | the review's author | review must be HIDDEN | actorId of the latest REVIEW_HIDDEN TeachAuditEvent |
| TRUST_ACTION | the restricted teacher themselves (profile must match the action's teacher) | — | the TrustAction row's `createdByAdminId` |

- `originalDecisionById` is captured SERVER-SIDE at filing time from the audit trail — the client never supplies it.
- Duplicate OPEN appeal (SUBMITTED/UNDER_REVIEW) for the same (appellant, targetType, targetId) → 409 "An appeal for this decision is already open."
- Rate limit: 5 appeals/day. Reason 30–2000 chars. Statuses: SUBMITTED → UNDER_REVIEW → UPHELD | OVERTURNED (CLOSED without a decision is also possible).

Admin adjudication (`POST /api/admin/trust/appeals/:appealId/action`):

- **ASSIGN** — reviewer must be an actual ADMIN (400 otherwise); SUBMITTED → UNDER_REVIEW; ASSIGNED event.
- **DECIDE** — requires UPHELD or OVERTURNED plus a written explanation (schema-level). Server-side rules:
  - a reviewer must be assigned first (409);
  - only the assigned reviewer may decide (403);
  - **self-review ban**: the deciding admin may NOT be the admin who made the original decision — `originalDecisionById === decidingAdmin` → 403 "You made the original decision — another administrator must review this appeal."
- **CLOSE_WITHOUT_DECISION** — CLOSED with optional note.
- Appeals never create payments or refunds (static test asserts no payment/refund tokens in the appeal routes; money is Phase 8).

**OVERTURNED applies a documented restoration** — the original investigation is never silently rewritten:

| Target | Restoration | Audit |
|---|---|---|
| REVIEW_MODERATION | the HIDDEN review returns to PUBLISHED with `moderationReason` "Appeal <id> overturned the hiding decision" | REVIEW_RESTORED (entityType CLASS_REVIEW) |
| TRUST_ACTION | the restriction row is deactivated (`isActive=false`, `endedAt`, `endedById`) | TRUST_REINSTATE (entityType TRUST_ACTION) |
| COMPLAINT_DECISION | the complaint returns to UNDER_REVIEW with `resolvedAt` cleared and an event "Re-opened by appeal <id> (OVERTURNED)" | ComplaintEvent UNDER_REVIEW — the original RESOLVED/DISMISSED events remain in the append-only history |

A restore only fires when the target is still in the overruled state (e.g. an already-republished review is left alone); the appeal decision and DECIDED event are written regardless, inside the same transaction.
