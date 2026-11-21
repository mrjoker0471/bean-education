# BEAN Teach — Safeguarding (Phase 6)

How BEAN handles the most serious report categories: restricted access, priority handling, the emergency halt for live classrooms, privacy controls, and what staff must NOT do. Grounded in `src/lib/trust.ts` (`SENSITIVE_CATEGORIES`, `SAFEGUARDING_GUIDANCE`, `evaluateTrustState`), `src/lib/trust-dto.ts`, the complaint routes and the live classroom routes.

## Sensitive categories

Three of the eleven complaint categories are restricted (`SENSITIVE_CATEGORIES` in `src/lib/trust.ts`):

- **SAFEGUARDING** — a child or vulnerable person may be at risk.
- **HARASSMENT** — harassment or threats.
- **DISCRIMINATION** — discriminatory treatment.

For these, `isSensitive` is set to `true` at filing time (server-side, from the category) and severity is derived HIGH (see the severity rules in docs/PHASE6_COMPLAINTS_AND_APPEALS.md; ESCALATE raises to CRITICAL with an audit event). These reports may be filed platform-level — without naming a class — because harm may occur outside any single class relationship.

## Restricted access model

Access control is enforced SERVER-SIDE, not by hiding UI:

- `TeachComplaint.isSensitive` marks the row; the DB column and every DTO are reachable only through guarded routes.
- Student-facing complaint endpoints key on the session identity and return the complainant's OWN rows only (`complainantId === student.id`) — a non-owner (including the reported teacher) receives an identical bare 404 with no existence leak.
- Teacher-facing surfaces never receive complaint rows at all: `GET /api/teach/trust` performs a COUNT only and returns `openComplaintCount` — an anonymous number with no content, category, status or timeline. Static tests assert teachers never see complaint content or status levers.
- The only surfaces that return complaint content are the ADMIN-guarded endpoints (`/api/admin/trust/complaints*`), whose guard is `requireAdmin()` (server-side role check, not UI hiding). The admin DTO includes reporter identity — justified for investigation, never public, never shown to the reported party.
- There are no public complaint endpoints anywhere; `tests/unit/free-pilot-protection.test.ts` statically asserts every complaint-touching route lives under `teach/` (session-guarded) or `admin/` (ADMIN-guarded).

## Elevated priority and escalation

- Sensitive cases are counted separately in the Trust Center overview (`sensitiveOpen`) and filterable in the case search (`sensitive=1`); the complaints list sorts by severity descending.
- Severity at filing: HIGH for sensitive categories (BEAN collects no age data, so the minor-context input of `deriveComplaintSeverity` is false today — documented honestly in docs/PHASE6_COMPLAINTS_AND_APPEALS.md).
- **ESCALATE** (admin case action) sets severity to CRITICAL, appends the ESCALATED event, and mirrors into the unified `TeachAuditEvent` trail. Repeat escalation is a no-op. Escalation is a human judgement call — nothing in the codebase escalates automatically.

## Emergency procedure: EMERGENCY_STOP

`EMERGENCY_STOP` is the immediate-safeguarding halt, issued by an admin through `POST /api/admin/trust/teachers/:teacherProfileId/actions` with a mandatory documented reason. Effects (verified in the routes):

| Surface | Effect while EMERGENCY_STOP is active |
|---|---|
| `POST /api/teach/classes/:id/live/start` | 403 before any budget reservation — no new live room can start for this teacher |
| `POST /api/teach/classes/:id/live/token` | 403 — no join tokens are issued (start AND join are both closed) |
| Bookings / seats | untouched — confirmed students are not losing their seats; the halt ends on admin reinstatement (or expiry if a temporary `endsAt` was set) |
| Complaints / reviews | untouched — the halt is a containment measure, not a verdict |

The restriction message shown to users: "This classroom is temporarily unavailable while BEAN operators review a serious safety concern. Confirmed students are not losing their seats — please contact support."

Rules the implementation enforces:

- **Never automatic.** No complaint, report or investigation step issues EMERGENCY_STOP (or any trust action) by itself — it is always an explicit admin decision with a documented reason. `tests/unit/free-pilot-protection.test.ts` asserts the complaint-filing route contains no trust-action creation and no trust evaluation.
- Ordinary complaints NEVER reach the live-start path — teaching confirmed students continues while investigations run. Only EMERGENCY_STOP can block live classrooms.
- Issuance and reinstatement are audited (`TRUST_ACTION_ISSUED` / `TRUST_REINSTATE`, entityType TRUST_ACTION); REINSTATE deactivates the halt immediately and is itself recorded as a decision row.
- Enforcement is expiry-aware at request time: an expired halt stops biting without any background job.

## The exact guidance text — and why no numbers are invented

Displayed on the report composer (sensitive categories selected) and repeated verbatim in the public policy view (`#/trust-policy`); defined once in `src/lib/trust.ts`:

> "If anyone is in immediate danger, contact your local emergency services or a trusted adult right away. BEAN operators review safeguarding reports as a priority, but BEAN is not an emergency service."

BEAN deliberately does NOT invent emergency phone numbers or third-party helpline contacts: its users span regions with different emergency systems, and a fabricated number in product copy would be both unsafe and dishonest. The text points people to their LOCAL emergency services and a trusted adult, and is explicit that BEAN is not an emergency service.

## Privacy controls

- **Identity protection.** The reported party never learns who reported them: reporter identity exists only in ADMIN DTOs; teacher-facing DTOs carry the anonymous open count only. Complaint content never appears in public DTOs. There are no public complaint endpoints.
- **No DM systems.** BEAN Teach has no private 1:1 messaging (a Phase 5 rule that continues to apply), so the platform never becomes an unsupervised contact channel; communication stays in class-wide surfaces.
- **Minimal data collection.** Complaints collect only category, optional class anchor, subject and description — no attachments, no contact forms, no identity documents. BEAN accounts never collected DOB, phone, school names or location (ADR-016), and Phase 6 does not add any of these.
- **Plain text only.** Every complaint field is validated plain printable text (control characters rejected); nothing user-supplied is ever rendered as HTML.
- **Append-only history.** ComplaintEvent rows are never rewritten; admin notes are redacted for the complainant, and the complainant's own information is visible to them. A decided case keeps its events even when an appeal re-opens it.

## What staff must NOT do

Documented product rules for BEAN operators (the code does not automate any of these):

- **No automated disciplinary decisions.** Filing a complaint — including a sensitive one — never changes ratings, reviews, bookings, listings, teacher verification status or creates a trust action. Every consequence follows a documented human investigation, and any restriction is an explicitly issued TrustAction with a written reason.
- **No sentiment auto-moderation.** There is no automated sentiment/abuse-language analysis anywhere in Phase 6 — deliberate. Reports and reviews are read by humans; machines never decide harm, and criticism is never treated as a violation on its own.
- **No identity disclosure.** Staff must not reveal reporter identity to the reported party — the code cannot do it, and the policy forbids working around it.
- **No vigilante enforcement against bookings.** Restrictions (PAUSE_LISTINGS, EMERGENCY_STOP) hide listings and block new activity but never revoke existing reservations — seat-holders keep access to their classes.
- **No emergency impersonation.** Staff are not emergency responders; the platform copy says so, and operators should direct people in immediate danger to local emergency services.

## Limitations (honest)

- Sensitive-case detection is category-driven only — there is no classifier that flags sensitive content in non-sensitive categories.
- The minor-context escalation input exists in `deriveComplaintSeverity` but is not populated automatically (BEAN collects no age data); CRITICAL comes from admin ESCALATE.
- There is no dedicated safeguarding escalation rota/on-call system in code — priority handling is the operator's responsibility, supported by overview counters and severity sorting.
- Appeals for sensitive-case decisions follow the standard appeal workflow (no additional restriction beyond the self-review ban).
