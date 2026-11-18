# Live classroom security (Phase 5)

Companion to `docs/BEAN_TEACH_SECURITY.md` (Phase 4A rules all still apply). This doc covers what Phase 5 adds and what it deliberately does not do.

## Identity & authorisation

- No new role exists. Teacher capability remains an APPROVED `TeacherProfile` on the authenticated Student; `Student.role` (STUDENT | PYQ_CURATOR | ADMIN) is untouched.
- The current user is ALWAYS derived from the httpOnly session cookie (`src/lib/auth.ts`). Client-supplied `studentId` / `teacherProfileId` / role / ownership claims are never trusted anywhere in the live classroom paths.
- Token route (`POST /live/token`) re-derives the role from BEAN DB state on **every** request: approved owner → TEACHER; CONFIRMED booking holder → STUDENT; guests 401; unbooked/cancelled 403; foreign classes 403/404; not-live or out-of-window 409. A cancelled booking can never obtain a token.
- A teacher cannot join or moderate another teacher's class; moderation and whiteboard persistence check ownership server-side.

## Token security

- JWTs are minted server-side only (`AccessToken` in `src/lib/livekit/config.ts`). Participant identity = `bean:<studentId>` — opaque, never an email or display name.
- Grants are role-scoped: roomJoin, canSubscribe, canPublish, canPublishData, `canPublishSources` = camera+microphone+screen_share (TEACHER) or camera+microphone (STUDENT). `roomAdmin`, `roomCreate`, `roomList`, `roomRecord`, `ingressAdmin` are explicitly false — no participant can create rooms, list rooms, mute others or remove participants; all moderation goes through the BEAN server SDK and is audited.
- TTL = scheduled duration + 60 min reconnect tail (capped 8 h) — short-lived, per participant, per room.
- `LIVEKIT_API_SECRET` never leaves the server: it is read in `src/lib/livekit/config.ts` only; no response ever contains it (proven by `tests/unit/live-token-route.test.ts`).

## Webhook endpoint (the only public provider callback)

- `POST /api/webhooks/livekit` authenticates by signature, not cookies: the raw body is read with `request.text()` BEFORE parsing; the `Authorization` JWT (HS256 by the API secret) is verified with `TokenVerifier` (issuer + expiry), and the token's `sha256` claim must equal the SHA-256 of the exact bytes received — the same checks `WebhookReceiver.receive()` performs (see `src/lib/livekit/webhook-verify.ts` for why the tolerant parse exists). Invalid or missing signatures → 401; malformed bodies → 400.
- Raw payloads and secrets are never logged; only the minimal event ledger (provider id, event name, room name, status) is stored.
- Processing is idempotent by `providerEventId` (unique): duplicate deliveries are answered 200 `duplicate:true` without touching accounting; FAILED events may be reprocessed on genuine retries; unknown rooms are recorded SKIPPED and can never mutate another session.

## Classroom privacy

- Room names are server-generated opaque ids (`bean-live-<32 hex>`); no emails, names or titles in room metadata. Participant display names come from teaching names / display names only — never emails.
- `GET /live/status` exposes: state, schedule window, a participant COUNT while live (no identities), whether the current user may join, and the configuration status. Attendee identity is visible only to the owner teacher through the evidence endpoint (display names + connection times — never emails or contact data).
- The whiteboard accepts only validated, palette-bounded vector strokes — no images, no arbitrary payloads, nothing scriptable.
- No private 1:1 messaging exists (teacher↔student communication stays in class-wide surfaces); no contact data is exchanged; minors' safeguarding rules from Phase 4A continue to apply.

## Recording — none

- There is no recording, egress, transcription or replay anywhere in Phase 5. No participant token carries `roomRecord`; no egress API is called; no media bytes are stored. The UI states "live only — nothing is recorded" in the classroom header, pre-join screen and control bar.

## Rate limits & abuse controls

- Monthly participant-minute budget enforced atomically BEFORE a room starts (see `docs/PHASE5_USAGE_BUDGET.md`); rejection is a clear 429.
- Per-room `maxParticipants` = confirmed bookings + teacher, capped by `BEAN_LIVEKIT_MAX_ROOM_PARTICIPANTS`; bookings freeze once a room exists, so attendance-capacity cannot drift.
- Every mutation endpoint (start/end/moderate/whiteboard save) enforces same-origin, Zod validation, and correct 401/403/404/409/429 semantics; every start/end/mute/remove action appends an append-only `TeachAuditEvent`.
- Whiteboard snapshots are hard-capped (≤500 strokes, ≤200 KB) and re-validated server-side on every save.
