# BEAN Education — Decision Log

Append-only. One entry per significant decision, newest at the bottom.

## ADR-001 — One modular application, no microservices (2026-11-18)

Status: accepted. The product is a single Next.js application. Domain boundaries (student, teacher, booking, class, payment) are kept clear in code and schema, but deployment stays unified unless a demonstrated reason requires a change.

## ADR-002 — Guest-first identity for the current product (2026-11-18)

Status: accepted (to be revisited at Phase 2). Identity is a UUIDv4 guest id stored in localStorage and passed on every request; all ownership checks key on it. Consequences: zero-friction onboarding, but no cross-device identity, no sessions/rotation, and all endpoints are public. The BEAN LEARN account model must replace this before Phase 2 profiles ship.

## ADR-003 — SQLite via prisma db push, no migrations folder (2026-11-18)

Status: accepted for now, flagged for change. Schema is applied with `prisma db push` (`--accept-data-loss` in the script). Reproducibility/rollback risk recorded; migrations to be introduced before the next schema change (Phase 2). The SQLite file and uploads live in `db/` which is git-ignored.

## ADR-004 — In-process job queue and quotas (2026-11-18)

Status: accepted for the single-process deployment. Riishe jobs, hourly quotas and chat rate limits are module-level in-memory state with stale-job recovery. Consequences: restart resets quotas; multi-process deployment would break dedupe/quota assumptions. Revisit before any horizontal scaling.

## ADR-005 — Riishe honesty policy (2026-11-18)

Status: accepted. Riishe never pretends: NEEDS_OCR and FAILED states are first-class outcomes; only VALIDATED questions publish; explanations verify verbatim quotes and downgrade fabrications; chat citations are server-verified; AI-generated content is always distinguished from verified bank content (`Attempt.source`, `Question.sourceType`).

## ADR-006 — Razorpay deferred to the final milestone (2026-11-18)

Status: accepted. No Razorpay code, credentials, endpoints or webhooks until Phase 8, after core platform and BEAN Teach are validated. Proposed 20/80 commission split is provisional.

## ADR-007 — Git history scrubbed of secrets and private documents before first push (2026-11-18)

Status: done. The local repository history contained `.env`, `db/custom.db` and `db/uploads/*` (14–16 user PDFs) tracked across 28 commits. Before any GitHub push, history was rewritten with `git filter-repo` (paths removed; 27 meaningful commits preserved; one empty commit pruned). Files were restored to disk from a pre-scrub bundle backup (`/tmp/bean-pre-scrub-backup.bundle` on the original machine, since destroyed). Commit hashes changed; work history and messages preserved. `.gitignore` hardened so these paths can never return.

## ADR-008 — GitHub authentication via SSH from the dev sandbox (2026-11-18)

Status: accepted. GitHub's OAuth device-flow endpoint (`github.com/login/device/code`) is blocked by the sandbox network gateway (404 via proxy), so `gh auth login --web` cannot complete here. Approved alternative per project rules: SSH. An ed25519 keypair was generated IN the sandbox; the private key never leaves the machine and is never displayed; the public key was added by the owner at github.com/settings/ssh/new. Direct github.com:22 connections are throttled by the network after bursts and can wedge mid-handshake, so `~/.ssh/config` routes github.com through `ssh.github.com:443` (officially supported SSH-over-HTTPS endpoint). If the sandbox is reset, re-add a freshly generated public key (see DEVELOPMENT.md).

## ADR-009 — Remote history preserved via unrelated-histories merge (2026-11-18)

Status: done. The GitHub repo contained a single "Initial commit" (README only). Local main was merged with `--allow-unrelated-histories`, keeping the owner's initial commit and README text intact as ancestors. No force-push; subsequent pushes are fast-forwards.

## ADR-010 — Hand-rolled credential auth instead of next-auth (2026-11-18)

Status: accepted. Phase 2A identity uses scrypt password hashing + SHA-256-hashed session tokens in httpOnly SameSite cookies, implemented in src/lib/auth.ts. next-auth (installed but never configured) was deliberately NOT used: the product needs exactly one credential flow with no third-party providers, and an unconfigured framework dependency adds attack surface without benefit. No paid authentication services. Consequences: password reset and email verification require an email service (not yet available) — documented limitations; the guest-first model remains fully functional and additive (`studentId` columns; claim keeps guest identity).

## ADR-011 — Durable job state in SQLite, CAS claims (2026-11-18)

Status: accepted. Riishe jobs and hourly quotas moved from module-level Maps to RiisheJob/JobQuota tables. Claims are atomic conditional UPDATEs (compare-and-set) — safe under SQLite single-writer serialisation for a single-node deployment; per-owner running limits are soft across processes (documented honestly). Lease heartbeats + expiry recovery replace in-memory staleness checks; retries are bounded (maxAttempts) and reservations are released on terminal failure/cancellation.

## ADR-012 — OCR via Tesseract + pdftoppm, not Docling (2026-11-18)

Status: accepted. Docling was evaluated and rejected for this runtime (Python/model-download weight vs the sandbox's constraints and the no-unnecessary-downloads rule). Tesseract 5.5 (eng+tam tessdata) + pdftoppm are user-space binaries with env-var overrides (TESSERACT_BIN/POPPLER_BIN/TESSDATA_PREFIX); the pipeline processes only scanned pages, validates usable text, and keeps per-page provenance. Honest failure states (OCR_FAILED / unavailable) are preserved end-to-end.

## ADR-013 — On-device AI is consent-gated and foundation-scoped (2026-11-18)

Status: accepted. Browser-local inference (WebLLM path) ships as capability detection + an adapter interface only; the optional runtime is intentionally not installed and NO model downloads without an explicit user action. Server-side Riishe/BEAN chat remains the default. Students' devices are never used for other users' inference; prompts/files stay on device. Transformers.js (embeddings) and a llama.cpp desktop engine are later integrations.

## ADR-014 — Server-side role system with operator-CLI-only promotion (2026-11-18)

Status: accepted. Student.role (STUDENT default) is enforced by pure, unit-tested decision functions in src/lib/roles.ts; all four PYQ endpoints gate via requirePyqCurator(). Registration parses a client `role` field ONLY to refuse it; profile PATCH cannot touch role; there is no promote endpoint. Promotion happens exclusively through scripts/grant-role.ts (dry-run default, last-ADMIN protection, printed audit transcript). Guests get 401, signed-in students 403 — the distinction is deliberate. Consequences: role changes are instant (roles read on every session lookup) and recoverable only with server-side DB access (documented).

## ADR-015 — PYQ review is curator-governed with an append-only audit trail (2026-11-18)

Status: accepted. The guest import path from 2A was REMOVED; import + review are curator/admin actions with provenance accountability. Every decision writes PyqReviewEvent (reviewer, role held, action, justification, timestamp) in addition to the Question snapshot; re-reviews append and never erase. Verified rows cannot be rejected from the review endpoint (409) — unverification stays a deliberate curation action. The catalogue examSlug constraint (college/university papers not representable) is surfaced honestly in the studio UI and docs rather than faked.

## ADR-016 — Onboarding collects minimal, safety-conscious profile data (2026-11-18)

Status: accepted. The wizard collects display name, education category (7 student groups incl. school/college/university/CA-CMA-CS/skill/career — never exam-only), learning level, interests, language, learning style, daily minutes, optional exam focus and optional REAL StudyGoal rows. It does NOT collect birth date, phone, school names or location (future parental-consent groundwork for minors). Every field is skippable; onboardedAt is a one-way stamp (first completion kept forever); edit mode reuses the same wizard via #/onboarding?edit=1. Dashboard recommendations are deterministic rules over real rows — the product never invents streaks, mastery or topics.

## ADR-017 — Teacher capability is an approved TeacherProfile, not a new role (2026-11-18)

Status: accepted. Phase 4A deliberately does NOT extend `Student.role` (STUDENT | PYQ_CURATOR | ADMIN) with a TEACHER value. The teacher capability is an APPROVED `TeacherProfile` row (unique per Student), resolved server-side on every guarded request by `requireApprovedTeacher()` in src/lib/teach.ts — the client never sends a role or a profile id that is trusted. Rationale: the single role field stays intact (no migration risk to existing accounts, no client-controlled role surface, no second login), review state lives on the profile where admins can approve/reject/re-review it, and curator/admin accounts can legitimately also be teachers. Consequences: a pending/rejected applicant has zero teacher capability (403), verification-relevant profile edits flip an approved profile back to PENDING (re-review; classes vanish from the marketplace until re-approved), and role promotions remain operator-CLI only (ADR-014).

## ADR-018 — Seat integrity via one conditional SQL UPDATE inside the booking transaction (2026-11-18)

Status: accepted. Prisma's query builder cannot compare two columns in a WHERE clause on SQLite (`bookedCount < capacity`), and a "count, then insert" pattern loses the race for the last seat. The seat claim is therefore a single conditional statement executed INSIDE the booking transaction (src/lib/teach-booking.ts): `UPDATE "ClassSession" SET "bookedCount" = "bookedCount" + 1 WHERE "id" = ? AND "status" = 'PUBLISHED' AND "startsAt" > ? AND "bookedCount" < "capacity"`. SQLite serialises writes, so the second racer re-evaluates the predicate against the already-incremented row, matches zero rows, and no booking row is created for them — bookedCount can never exceed capacity. IMPORTANT: Prisma 6 stores SQLite DateTime columns as INTEGER milliseconds since the epoch, so the `startsAt`/time guards bind epoch-millisecond numbers — binding an ISO string would silently never match. Consequences: correctness relies on SQLite single-writer serialisation (fine for the single-node deployment, documented honestly); the SQL constants are exported and executed VERBATIM by tests against a real in-memory SQLite engine; seat release uses `MAX(bookedCount - 1, 0)` with a `WHERE bookedCount > 0` guard so a double release is a no-op, and GET /api/teach/my-classes reconciles any drift defensively with logging.

## ADR-019 — Free pilot: planned price is metadata only; no monetisation exists in Phase 4A (2026-11-18)

Status: accepted. ClassSession stores `plannedPricePaise` (0–10,000,000 paise) as METADATA for a future regular price, displayed to students as "planned regular price — not charged during the free pilot". No orders, payments, wallets, payouts, commissions or refunds exist anywhere in this milestone — the proposed 20% BEAN / 80% teacher split stays future monetisation Phase 8 (per ADR-006) and is NOT implemented, not even partially. Consequences: booking is always free; nothing in the schema or code can create a charge; Phase 8 must add its own models/endpoints rather than reuse pilot fields, and the UI never shows a pay button.

## ADR-020 — Live classrooms are live-only; no recording exists in Phase 5 (2026-11-18)

Status: accepted. Phase 5 implements realtime delivery (video, audio, screen share, whiteboard) with NO recording, cloud egress, transcription, AI summaries or replay of any kind — no participant token carries `roomRecord`, no egress API is called, no media bytes are stored, and the UI states "live only — nothing is recorded" in the classroom header, pre-join screen and control bar. Rationale: recording minors' classes is a safeguarding and storage-cost decision that deserves its own milestone with explicit consent design; the free pilot also cannot afford egress. Consequences: attendance cannot be reconstructed from recordings — it is built from verified connection evidence instead; a future recording milestone must add its own models, consent flows and retention policy.

## ADR-021 — Monthly usage budget is BEAN-side and enforced atomically before a room starts (2026-11-18)

Status: accepted. LiveKit Cloud free-tier allowances are hard provider caps, so BEAN keeps its own conservative budget (`BEAN_LIVEKIT_MONTHLY_BUDGET_MINUTES=4000`, `BEAN_LIVEKIT_MAX_CONCURRENT_PARTICIPANTS=80`, `BEAN_LIVEKIT_MAX_ROOM_PARTICIPANTS=51` — BEAN product caps, NOT claims about provider quotas). A teacher cannot start a room until `(confirmed bookings + 1) × duration` participant-minutes are reserved via ONE conditional SQL UPDATE (`reserved + used + need <= budget` — SQLite serialises writes so concurrent starts cannot oversubscribe; the loser gets an honest 429). Finalisation is single-use per session (`LiveClassSession.usageFinalisedAt`): open intervals close conservatively, verified actual usage (from signed webhooks) is recorded once, and unused reservation is released with a MAX(0) floor. Overtime overruns reduce availability honestly (used grows more than the released reservation). Consequences: the app never quietly exceeds its allowance, never asks for a credit card, and month rollover is automatic (per-month rows; a reservation reconciles against the month it reserved in).

## ADR-022 — Webhook verification re-implements the receiver's cryptographic checks with a tolerant parse (2026-11-18)

Status: accepted. `WebhookReceiver.receive()` verifies the signature JWT and the SHA-256 body binding correctly, but `@livekit/protocol`'s generated `WebhookEvent.fromJson` cannot decode ANY real-world `createdAt` shape (its codegen inlined `google.protobuf.Timestamp` into a bigint scalar, so both RFC 3339 strings and `{seconds}` objects throw "cannot decode field"). BEAN therefore verifies with the identical cryptographic steps — `TokenVerifier` (HS256, issuer, expiry) + SHA-256 body comparison — and then parses the JSON tolerantly itself (`src/lib/livekit/webhook-verify.ts`). The raw body is read with `request.text()` BEFORE any parsing; invalid or missing signatures still return 401; the security model is unchanged, only the fragile decode step is replaced. Documented in docs/PHASE5_SECURITY.md.

## ADR-023 — FLAGGED reviews stay publicly visible but are excluded from aggregates (2026-11-19)

Status: accepted. A teacher flag moves a review to FLAGGED, which remains publicly readable while an admin reviews it — flagging is a request for human attention, never an automatic removal (auto-hiding would let the reviewed party silence criticism unilaterally). The cost is a documented trade-off: `computeTeacherQuality` excludes FLAGGED rows from `averageRating`/`reviewCount` while they are under moderation, so a teacher's public score can dip when a review is flagged and recover on KEEP_PUBLISHED. Deliberate: a number that includes content awaiting a human decision would present contested text as settled fact. The author always sees their own review in any state plus the moderation reason, and every decision is audited.

## ADR-024 — Complaints carry no FK to ClassSession; history survives class deletion (2026-11-19)

Status: accepted. `TeachComplaint.classSessionId` is a plain string column (index, no constraint) instead of a foreign key. Classes are deletable rows (and cascade to bookings/reviews), but an investigation record must remain complete and provable after the class is gone — the complaint is a support/audit document, not a class feature. Class titles are joined read-time when the row still exists; `teacherProfileId` keeps a real FK with ON DELETE SET NULL (the teacher anchor degrades gracefully, the case survives). Consequence: referential integrity for the class anchor is the application's responsibility; accepted in exchange for durable investigation history.

## ADR-025 — Trust-state expiry is evaluated at enforcement time; no background sweeper (2026-11-19)

Status: accepted. A `TrustAction` row restricts only while `isActive` AND (`endsAt` is null OR `endsAt > now`) — `evaluateTrustState()` applies this at every enforcement/read point, so a temporary restriction ends predictably without any background job (the deployment is single-node SQLite; a sweeper would add a scheduler without changing any visible outcome). Consequence (recorded honestly): expired rows keep `isActive=true` in storage until touched by REINSTATE or the next evaluation — stored flags can lag, but enforcement is always correct because every check is expiry-aware. REINSTATE deactivates currently-enforcing rows at write time and records itself as a decision (`isActive=false`), so reinstatements are explicit, individually audited events.

## ADR-026 — Self-review ban via server-captured `originalDecisionById` (2026-11-19)

Status: accepted. Every appeal records WHO made the original decision, captured SERVER-SIDE at filing time from the append-only evidence (the RESOLVED/DISMISSED ComplaintEvent actor, the REVIEW_HIDDEN audit actor, or the TrustAction's `createdByAdminId`) — never from client input. The DECIDE action refuses when the deciding admin equals `originalDecisionById` (403) and requires a pre-assigned reviewer (only the assigned reviewer may decide). This makes "check your own complaint/review/trust action" structurally impossible rather than policy advice, and it works because the underlying decisions are already audited — no new trusted client surface was added. Consequence: the ban is only as complete as the audit trail (a missing audit actor degrades to no ban), which the append-only design makes a non-issue in practice.

## ADR-027 — EMERGENCY_STOP is the only complaint-adjacent path that can block live classrooms, and it is never automatic (2026-11-19)

Status: accepted. Teaching confirmed students continues while investigations run — ordinary complaints NEVER reach the live-start/token path. The single exception is EMERGENCY_STOP, an explicit admin-issued TrustAction with a mandatory documented reason, which blocks `live/start` (before any budget reservation) and `live/token` (no join tokens) for that teacher. Rationale: blocking a classroom is a disruptive, immediate-safeguarding measure that must be a deliberate human decision with an audit trail, not a side effect of report volume; automation here would also contradict the no-automated-disciplinary-decisions rule. Confirmed bookings are never revoked — the halt ends on REINSTATE (or expiry), and the user-facing message says so.

## ADR-028 — Teachers never see complaint content beyond an anonymous open count (2026-11-19)

Status: accepted. `TeacherTrustSummaryDTO` carries `openComplaintCount` (a COUNT query — no complaint rows are read into teacher space) and nothing else about complaints: no content, category, status, timeline or reporter identity ever appears in a teacher-facing DTO or route; public DTOs carry no complaint data at all. Reporter identity exists only in ADMIN-guarded DTOs (justified for investigation). Rationale: a teacher who could see reports (even sanitized) could retaliate or infer identities; the anonymous count preserves the teacher's legitimate need to know their standing without creating that risk. Complaints also never change ratings, reviews or bookings — enforced by static tests, not convention.

## ADR-029 — No Razorpay/payment code in Phase 6; refunds deferred to Phase 8 (2026-11-19)

Status: accepted. Trust & Quality deliberately ships zero money logic: no payment provider in package.json, no payment variables in .env.example, no payment/checkout/order/refund/wallet route anywhere, and no refund rules even partially implemented — planned prices remain metadata (ADR-019) and refund policy language stays a Phase 8 deliverable (ADR-006). This is not accidental scope-cutting: connecting a negative review (or a complaint outcome) to money before a payments milestone exists would create undeclared financial consequences. `tests/unit/free-pilot-protection.test.ts` statically guards the absence (comments are stripped before scanning, so documented phrases like "no refunds" cannot false-positive) — if Phase 8 adds Razorpay it must do so deliberately, not by accident through Trust code.

## ADR-030 — displayName consent is a flag on the review row, not the student profile (2026-11-19)

Status: accepted. `ClassReview.showDisplayName` (default false) records, per review, whether THAT review may show the author's chosen display name; public mappers read this flag (never the profile) and otherwise render "Verified student". Rationale: consent is per-publication, not global — a student may want their name on a rave review and anonymity on a critical one (the critical one is exactly where retaliation risk concentrates), and profile-level consent would silently retro-apply to every past review when toggled. Consequence: reviewers manage consent per review via the 7-day edit window; no surface ever derives identity from the flag (no email/account id is reachable from it — the mapper outputs only `displayName ?? null`).

## ADR-031 — Organization-scoped roles instead of new global roles (2026-11-19)

Status: accepted. Institution/employer power is carried by `OrganizationMembership.role` (OWNER/ADMIN/INSTRUCTOR/STAFF/LEARNER/CAREER_COORDINATOR/RECRUITER) scoped to one organization, checked server-side per request — never by new `Student.role` values. Rationale: a person can simultaneously be a learner in one institution, an approved BEAN teacher and an owner of another organization; global roles cannot express that without an explosion of mutually-exclusive states and a second authorization model. Consequence: every org route re-verifies membership; `Student.role` remains STUDENT | PYQ_CURATOR | ADMIN with no API able to raise it.

## ADR-032 — Invitation tokens stored hash-only; copy-link instead of email (2026-11-19)

Status: accepted. Invitations use 32-byte CSPRNG tokens whose SHA-256 hash is the only persisted form; the raw token appears exactly once in the create response for an explicitly-labelled copy-link workflow. Rationale: BEAN has no email infrastructure and must not pretend it does; a link-distribution flow is honest, and hash-only storage means a database leak exposes no redeemable tokens. OWNER/ADMIN are structurally not invitable — elevation always requires an existing administrator's audited action.

## ADR-033 — Private classes reuse ClassSession with a nullable audience (2026-11-19)

Status: accepted. Institution classes are `ClassSession` rows with nullable `audience/organizationId/organizationGroupId` (default PUBLIC) rather than a parallel class model. Rationale: they must reuse the seat-claim SQL, capacity guarantees, trust enforcement, live sessions, attendance evidence and reviews — a second model would fork all of that. Consequence: public discovery filters `audience='PUBLIC'`; booking re-checks eligibility inside the seat-claim transaction; live tokens re-check per request; suspended members lose new access while history is retained.

## ADR-034 — Adult-eligibility gate blocks employer discovery and applications server-side (2026-11-19)

Status: accepted. `CareerEligibilityReview` (admin-reviewed, `NOT_ELIGIBLE` default) is required IN ADDITION to the student's DISCOVERABLE choice before either candidate discovery or applications succeed; both routes re-check per request. Rationale: BEAN serves school-age students; no UI preference can protect a minor from an employer search — only a server gate can. No identity documents are collected (the review is procedural and privacy-minimizing); if reliable verification is unavailable, discovery stays disabled while private planning remains available. DPDP compliance questions are flagged for professional review, not assumed solved.

## ADR-035 — Application snapshots are frozen at submission (2026-11-19)

Status: accepted. `CareerApplication.snapshotJson` is built server-side from the candidate's explicit per-item selections (whitelisted keys, ≤8 KB), stored verbatim, and never re-derived from the live profile. Contact details enter only with an explicit per-application consent flag. Rationale: a snapshot is what the employer evaluated — silently rewriting it after profile edits would misrepresent the application and could expose data the candidate did not consent to share at that moment. Consequence: candidates keep control by withdrawing; employers see exactly what was shared at apply time.

## ADR-036 — The institution/career trust contexts stay separate from teacher TrustActions (2026-11-19)

Status: accepted. Organization verification, opportunity moderation and career safety use their own records (`OrganizationAuditEvent`, `CareerAuditEvent`, `CareerSafetyReport`) and never write teacher `TrustAction` rows or read teacher trust state as employer/institution state. Rationale: ADR-024's separation principle — mixing contexts would let one domain's decisions contaminate another's enforcement surface (e.g. an employer incident pausing a teacher's classes). Consequence: admins moderate each context in its own queue; a report never auto-suspends anything in any context.
