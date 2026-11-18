# BEAN Trust & Quality security (Phase 6)

Companion to `docs/BEAN_TEACH_SECURITY.md` (Phase 4A rules all still apply) and `docs/PHASE5_SECURITY.md`. This doc covers what Phase 6 adds: the authorization matrix, input hardening, rate limits, XSS posture, privacy DTO rules, audit, DB integrity, the free-pilot protection tests, and env posture.

## Identity & authorization matrix

No new role exists. Identity always comes from the httpOnly session cookie (`src/lib/auth.ts`); client-supplied ids/roles/ownership claims are never trusted — they only NAME targets. Teacher capability remains an APPROVED `TeacherProfile` resolved server-side (`requireApprovedTeacher` / `requireOwnTeacherProfile`).

| Endpoint | Guest | Signed-in student | Owner teacher (APPROVED) | Complainant | ADMIN |
|---|---|---|---|---|---|
| GET `/api/teach/classes/:id/reviews` | public list (PUBLISHED+FLAGGED) | + own review any state; composer eligibility | same | same | same (plus flag rights elsewhere) |
| POST `/api/teach/classes/:id/reviews` | 401 | 403 unless own ATTENDED booking + class ended | — (booking rule decides) | ✓ (booking rule) | 403 unless own booking |
| PATCH `/api/teach/reviews/:reviewId` | 401 | 403 unless review author | 403 (not author) | ✓ if author | 403 unless author |
| POST/PATCH `.../reviews/:reviewId/response` | 401 | 403 (no approved profile / not owner) | ✓ only for own reviewed classes | 403 | 403 unless owner teacher |
| POST `.../reviews/:reviewId/flag` | 401 | 403 | ✓ own reviewed classes | 403 | ✓ any review |
| GET `/api/teach/complaints` / `/:id` | 401 | own complaints only (404-style denial for others) | own complaints only | ✓ | n/a (admin surfaces separate) |
| POST `/api/teach/complaints` | 401 | 403 without booking/teacher relationship (404 for unknown/DRAFT class) | ✓ (booking or own class) | ✓ | ✓ |
| GET/POST `/api/teach/appeals` | 401 | relationship-checked per target (403 otherwise) | ✓ per target table | ✓ | ✓ (same checks) |
| GET `/api/teach/trust` | 401 | 403 without APPROVED profile | ✓ own summary only | ✓ | ✓ |
| `/api/admin/trust/*` (all 10) | 401 | 403 | 403 | 403 | ✓ (`requireAdmin`) |

Key invariants (asserted by tests):

- Class detail hiding: a paused teacher's class returns the SAME "Class not found" 404 to guests and unrelated students as a truly missing class — no existence leak — while the owner and any seat-holder (booking ≠ CANCELLED) keep access.
- Complaint detail: non-owners get a bare 404 ("Report not found") identical to a missing id — no case-existence leak.
- Review/complaint/appeal ownership is decided by comparing the DB row's student/complainant/appellant id to the session id — never by accepting a client-sent id.
- Admin assignment targets (complaint ASSIGN, appeal ASSIGN) must be actual ADMIN accounts — 400 otherwise (a non-admin assignee would silently break the authorization model).

## Input hardening

- **Same-origin** is enforced on every mutating Phase 6 endpoint (`sameOrigin(req)` → 403 on foreign origins).
- **Zod validation** for every body (`src/lib/trust-schema.ts`) with strict bounds:
  - review: rating int 1–5, title ≤ 120 (optional), reviewText 20–2000;
  - response: 20–1000; complaint: subject 8–120, description 30–4000;
  - appeal reason: 30–2000; trust-action reason: 20–1000; moderation reasons: 10–600.
- **Control-character rejection**: every multi-line field uses `plainText(min, max)` which rejects C0 control chars (`\u0000`–`\u0008`, `\u000B`, `\u000C`, `\u000E`–`\u001F`) and DEL (`\u007F`) — XSS/zero-width hardening at ingestion; content is trimmed and bounded before storage.
- Enums are server-side constants: complaint categories, severities, statuses, trust actions, appeal targets/decisions — a client cannot invent a value.
- Complaints additionally enforce the legitimate-relationship rule server-side (booking holder or class teacher; platform-level only for SAFEGUARDING/HARASSMENT/OTHER).
- Severity/sensitivity are server-derived — the client has no fields to assert them.
- Admin query surfaces cap search length (`MAX_QUERY_LENGTH = 100` in `src/lib/teach.ts`) and page sizes (≤100) and whitelist filter values against the enums.

## Rate limits (durable, stateless — rolling 24 h row counts)

`RATE_LIMITS` in `src/lib/trust.ts`; counters come from `countRecent()` (DB row counts over the last 24 h — no in-memory state to reset, no clock drift):

| Surface | Cap | Counter source |
|---|---|---|
| Review create AND edit (`REVIEWS_PER_DAY`) | 10/day/student | ClassReview rows by studentId |
| Complaint filing (`COMPLAINTS_PER_DAY`) | 10/day/student | TeachComplaint rows by complainantId |
| Appeal filing (`APPEALS_PER_DAY`) | 5/day/appellant | TeachAppeal rows by appellantId |
| Review flags (`FLAGS_PER_DAY`) | 20/day/flagger | TeachAuditEvent REVIEW_FLAGGED rows by actor (append-only, so the cap survives) |

Exceeding a cap returns honest 429s with user-facing wording. Note (recorded honestly): the trust-action route has NO rate limit — it is an ADMIN-only surface; every student-facing Phase 6 write path is rate-limited.

## XSS posture

- All user-generated review/response/complaint/appeal text is **plain text**: stored raw-but-validated, rendered by React as text content (JSX escaping) — no `dangerouslySetInnerHTML`, no markdown rendering on these surfaces, no HTML storage anywhere.
- Control characters are rejected at validation time (above), so zero-width and bidi characters cannot be smuggled into public review text.
- Reviewer identity is server-shaped (`toPublicReview`): the only names ever rendered are the fixed "Verified student" label and the consent-gated displayName.
- The admin Trust Center renders the same DTO fields with React escaping; no field is ever treated as markup.

## Privacy DTO rules

Every Phase 6 response is shaped in `src/lib/trust-dto.ts`; the rules are enforced by construction, not by convention:

- **Public reviews** never include emails, account ids, phone numbers or complaint information. Reviewer = "Verified student" + displayName ONLY when `showDisplayName` (explicit consent flag stored on the review row — not the profile).
- **Author-only block**: ownStatus / ownModerationReason / canEdit are added by `toPublicReview` only when `viewerStudentId === review.studentId`.
- **Complaint events**: NOTE_ADDED details are redacted (`detail: null`) for the complainant unless the complainant authored the note; the admin DTO keeps `detailFull`.
- **Teacher-facing**: `TeacherTrustSummaryDTO` carries the anonymous `openComplaintCount` — no complaint rows are read into teacher space.
- **Admin DTOs** (reviews queue, complaints, appeals) include identity (id, displayName, email) — justified for investigation, ADMIN-guarded, never public. Trust Center teacher rows expose complaint COUNTS (total/open), never content.
- **Appeals**: the own-appeal DTO hides nothing from the appellant except internal reviewer ids; the admin DTO adds appellant identity and `originalDecisionById`.

## Audit trail

Append-only, transactional, per-write:

- `TeachAuditEvent` (unified, polymorphic) gains entityTypes CLASS_REVIEW (REVIEW_CREATED/EDITED/FLAGGED/HIDDEN/RESTORED/KEPT_PUBLISHED, TEACHER_RESPONSE_CREATED/EDITED), COMPLAINT (RESOLVED/DISMISSED/ESCALATED mirrors) and TRUST_ACTION (TRUST_ACTION_ISSUED / TRUST_REINSTATE).
- `ComplaintEvent` records every case action (CREATED, ACKNOWLEDGED, UNDER_REVIEW, WAITING_FOR_INFORMATION, RESOLVED, DISMISSED, ASSIGNMENT_CHANGED, NOTE_ADDED, INFO_PROVIDED, ESCALATED) — duplicates are no-ops, never duplicate events.
- `AppealEvent` records SUBMITTED / ASSIGNED / DECIDED / CLOSED.
- The REVIEW_HIDDEN audit actor is the data source for the appeal self-review ban; TRUST_ACTION_ISSUED carries `ACTION: reason` in its detail.
- Every audit write happens inside the same DB transaction as the state change it documents; nothing is ever updated or deleted.

## DB integrity

- **One transaction per write**: review create, review edit, response create/edit, flag, complaint create/info, complaint actions, trust actions, appeal create/assign/decide/close all run in `db.$transaction` with re-reads inside the transaction (state can't change between check and write).
- **Unique constraints as last line of defence**: `ClassReview.bookingId` UNIQUE (concurrent duplicate review → P2002 → 409), `TeacherReviewResponse.reviewId` UNIQUE (concurrent duplicate response → 409).
- **No FK from complaints to ClassSession**: `classSessionId` is a plain string, so investigation history survives class deletion (class titles are joined read-time when the row still exists). `TeachComplaint.teacherProfileId` is ON DELETE SET NULL.
- **Trust enforcement is read-time correct**: `evaluateTrustState()` treats a row as enforcing only when `isActive` AND (`endsAt` is null OR `endsAt > now`) — temporary restrictions end predictably without a sweeper; REINSTATE deactivates rows at write time and is itself never enforcing.
- Booking integrity (seat-claim SQL, one booking per student per class) is unchanged from Phase 4A; the pause check runs INSIDE that transaction.

## Free-pilot protection tests

`tests/unit/free-pilot-protection.test.ts` (9 tests) statically scans the tree (comments stripped first, so documented phrases like "no refunds" cannot false-positive):

1. `package.json` declares no payment provider dependency (razorpay/stripe/paypal/braintree/cashfree/payu/lemonsqueezy patterns).
2. `.env.example` contains no payment credential variables (RAZORPAY/STRIPE/PAYPAL/PAYMENT_ patterns).
3. No route path under `src/app/api` matches payment|razorpay|checkout|order|refund|wallet|payout.
4. The 10 core Phase 6 files (trust libs + complaint/appeal/trust-action routes) contain NO executable payment/refund tokens (`razorpay|checkout|createOrder|payment|refund`).
5. Review moderation never mutates bookings or classes (`classBooking.*`/`classSession.*` writes absent; `classReview.update` present).
6. Complaint case actions never mutate bookings, classes or reviews — and never `trustAction.create`.
7. Filing a complaint never creates a trust action and never even evaluates trust state (`trustStateFor` absent from the complaint route).
8. A negative review alone never suspends/rejects a teacher (moderate route has no `teacherProfile.update`, no `trustAction.create`).
9. Every complaint-touching route lives under `teach/` (session-guarded) or `admin/` (ADMIN-guarded) — no bare public complaint routes.

## Env / .env.example posture

Phase 6 introduces ZERO new configuration. No env var is read by any trust module; rate limits, sample thresholds, edit windows and text bounds are code constants in `src/lib/trust.ts`. `.env.example` documents only `DATABASE_URL`, the LiveKit Phase 5 variables and the BEAN live-budget caps — no payment variables exist (asserted by the protection test above). Secrets posture unchanged: `.env` git-ignored, placeholders only in `.env.example`.

## Operator notes

- Role grants still happen ONLY through the operator CLI (`bun scripts/grant-role.ts`); the Trust Center requires an ADMIN account (see docs/DEVELOPMENT.md for provisioning).
- Every Trust Center mutation requires a written reason (10–600 chars for moderation; 20–1000 for trust actions) — the UI refuses to submit without one, and the schema enforces it.
- REINSTATE ends EVERY currently-enforcing restriction for that teacher (individually audited); there is no per-row reinstate — to end one of several restrictions, issue REINSTATE and re-issue the ones that should remain.
- Temporary restrictions take an optional future `endsAt`; REINSTATE never carries one.
- Filing a complaint alone suspends nobody. Restrictions are separate, explicit decisions — that separation is what makes the audit trail meaningful.
- `bun run db:status` exits 1 in this environment even when migrations are applied (pre-existing `prisma migrate status` quirk — see docs/PHASE6_RESULTS.md).
