# BEAN Live Classroom — Phase 5 implementation

Source of truth: `src/lib/livekit/*` (config, usage, live, room, whiteboard, webhook-verify), `src/app/api/teach/classes/[id]/live/*`, `src/app/api/webhooks/livekit/route.ts`, `src/components/bean/classroom/*`, `src/components/bean/views/classroom-view.tsx`, and `prisma/migrations/20261118040000_phase5_live_classroom/migration.sql`. Everything below describes what is actually committed.

## What Phase 5 is

Real, functional live classrooms on top of the Phase 4A marketplace. Realtime media (audio, video, screen share) is carried by **LiveKit Cloud**; BEAN owns identity, authorisation, scheduling, usage budgeting, attendance evidence and audit. The classroom is **live-only**: there is no recording, no storage, no replay, no transcription, and no payment anywhere in the flow.

The existing UI design system (obsidian background, champagne-gold accents, cards, radii, typography) is untouched — the classroom is built from BEAN tokens and existing shadcn primitives, not an imported generic conference UI.

## Architecture in one picture

```
Browser (BEAN classroom UI, livekit-client SDK)
   │  token = short-lived LiveKit JWT, minted server-side per request
   │  media = WebRTC/SRTP direct to LiveKit Cloud (never through BEAN)
   ▼
BEAN Next.js API (Node runtime)
   ├── live/start    → validate → atomic budget reserve → LiveClassSession row
   │                   → RoomServiceClient.createRoom (opaque room name)
   ├── live/token    → re-derive role from DB → AccessToken (role-scoped grants)
   ├── live/status   → safe public status (no identities)
   ├── live/end      → single-use finalisation (usage reconcile once) → deleteRoom
   ├── live/moderate → mute/remove via server SDK → audited
   ├── live/whiteboard → teacher-only snapshot persistence (bounded)
   ├── live/attendance → verified evidence + advisory suggestion
   └── webhooks/livekit → signed provider events → idempotent accounting
SQLite (Prisma): LiveClassSession, LiveClassParticipant, LiveKitWebhookEvent,
                 LiveUsageMonth, LiveWhiteboardState (all additive)
```

## Session lifecycle & state machine

One `LiveClassSession` row exists per scheduled `ClassSession` (unique FK). States:

```
READY ──(room created, teacher connected)──▶ LIVE ──(teacher ends)──▶ ENDED
  │                                            │
  │ room creation failed                       │ provider room_finished while BEAN
  ▼                                            ▼  still expected LIVE
FAILED ──(retry reuses the same row)──▶ READY   INTERRUPTED (finalised once)
```

- **Start** (`POST /live/start`, owner teacher only): class must be `PUBLISHED`, inside the window (opens 15 min before `startsAt`, closes at `startsAt + duration`), at least 1 confirmed booking, LiveKit configured, and the monthly allowance must cover `(confirmed + 1) × duration` participant-minutes — reserved atomically. Duplicate start returns the existing LIVE session (200) — never a second room or reservation. FAILED/READY/INTERRUPTED resumes release the stale reservation and re-reserve the fresh estimate; **ENDED can never restart**.
- **Join** (`POST /live/token`): role re-derived from BEAN DB state on every request. Owner-approved teacher → TEACHER; student with a `CONFIRMED` booking → STUDENT; everyone else 401/403. The session must be LIVE and the window open. Cancelled bookings never receive tokens.
- **End** (`POST /live/end`, owner only): transactional transition to ENDED with a `usageFinalisedAt` single-use guard — open participant intervals are closed conservatively, verified actual usage is recorded once, the reservation is released once, then `deleteRoom` runs best-effort (a later `room_finished` webhook is a safe no-op).
- **Bookings freeze** once a live session exists (READY/LIVE/INTERRUPTED): the Phase 4A booking transaction checks for a live row before handing out seats, so no seat is sold after the room is reserved, and a cancelled booking can never rejoin.

## Whiteboard protocol

Transport: LiveKit **reliable data messages**, topics `bean.wb.v1` (board) and `bean.hand.v1` (raise hand). Contract in `src/lib/livekit/whiteboard.ts` (zod, shared client+server):

- Versioned messages: `stroke | undo | clear | request-sync | sync` (board), `{type:'hand', raised}` (hands). Unknown versions/shapes are dropped.
- Strokes: `id`, `mode: pen|eraser`, color from a fixed 6-colour palette, `size 1..24`, `points: [x,y]` normalised floats in 0..1, ≤1000 points, ≤500 strokes per snapshot, ≤200 KB serialised.
- **Authorisation**: mutation messages are accepted only from participants whose BEAN metadata role is `TEACHER`; the persisted snapshot is written ONLY through the teacher-only API (server re-checks ownership, live status, and re-validates the payload). Students send only `request-sync`.
- **Late joiners**: on connect they fetch the persisted snapshot (`GET /live/whiteboard`) and broadcast `request-sync`; the teacher replies with a bounded full snapshot. The teacher client persists debounced (2.5 s) snapshots — not one write per pointer move.
- Canvas: normalised coordinates survive resizes; high-DPI aware; pen/eraser/colours/size/undo/clear; students get a view-only canvas. No images, no HTML — nothing can inject.

## Reconnection & failure states

`NOT_STARTED → CONNECTING → CONNECTED ⇄ RECONNECTING → CONNECTED | DISCONNECTED → (retry) CONNECTING`, plus `CONNECTION_FAILED` and `SESSION_ENDED`. Behaviour:

- Disconnection with reason `ROOM_DELETED`/`PARTICIPANT_REMOVED` → SESSION_ENDED (teacher ended / moderation); other disconnects offer an explicit **Retry** that mints a fresh token and re-applies the participant's previous media consent (never force-enabling).
- The whiteboard snapshot is re-fetched on reconnect; attendance intervals are additive — reconnections open new intervals (`reconnectCount++`) and never duplicate records.
- Permission errors (camera/mic denied, device missing), token expiry and provider unavailability surface as honest messages with a retry path.

## Classroom UI surface

`#/classroom/:classId` (hash route added to `Route`, `parseHash`, `routeToHash`, `page.tsx`). Flow: sign-in gate for guests → honest status gate (not started / completed / not configured / window closed) → pre-join screen (opt-in camera preview, mic level test, device list, permission explainer, class details) → live room (adaptive video grid, teacher-highlighted tiles, screen-share view, whiteboard, control bar, participant panel, raise hand, connection status, teacher end-class confirmation).

Entry points woven into existing pages (additive, no redesign):
- Class detail sidebar card — "Join Live Classroom" / "Classroom not started yet" / "Class completed" / owner "Start Live Class"/"Open Classroom".
- Teacher dashboard — per-class Start/Open/Ended action on upcoming published classes; verified live evidence inline in the attendance strip.
- My Bookings — Scheduled / Live now / Completed badges with a Join action only when the server says the seat is eligible.

## Attendance integration

Phase 4A attendance marking is preserved exactly. The teacher additionally receives **verified live evidence** per enrolled student (`GET /live/attendance`): first joined, last left, total connected seconds, reconnect count, currently-connected — sourced only from signed webhook events. A documented, configurable suggestion (≥60% of the scheduled duration → ATTENDED; 30 s–60% → NO_SHOW; below 30 s → no suggestion) is displayed as advisory text; the teacher always confirms or overrides via the existing endpoints, and the existing audit trail continues to apply. A student is never marked attended merely by opening the page, and provider/teacher technical failure never auto-penalises a student (the suggestion is advisory; the teacher decides).

## Known limitations (honest)

- Screen sharing is teacher-only in this milestone (enforced by token grants + UI).
- Audio-output device selection is not implemented (input devices are switchable); browsers govern output routing.
- The classroom requires LiveKit Cloud credentials; without them every surface shows an explicit "not configured" state and the rest of BEAN is unaffected.
- Webhooks are retried but not guaranteed by the provider — BEAN finalises usage on teacher end (primary path) and reconciles from webhooks; a `room_finished` for a room BEAN already finalised is a no-op.
- No recording, replay, chat or breakout rooms; no private teacher↔student messaging; planned for later milestones with safeguarding review.
