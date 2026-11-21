# LiveKit setup guide (Phase 5)

How the BEAN owner enables real live classrooms. Without credentials the app stays fully usable and every classroom surface shows an honest "not configured" state — no fake rooms, no dead buttons pretending to work.

## 1. Create a LiveKit Cloud project (free tier)

1. Sign up at <https://cloud.livekit.io> (no credit card required for the free tier).
2. Create a project and open **Settings → Keys**.
3. Note three values:
   - **WebSocket URL** — looks like `wss://<project>.livekit.cloud`
   - **HTTP/Host URL** — looks like `https://<project>.livekit.cloud` (often derivable from the WebSocket URL)
   - **API key / API secret** — one key pair per project

Free-tier allowances are hard caps; BEAN keeps its own safety buffer below them (see `docs/PHASE5_USAGE_BUDGET.md`).

## 2. Add the environment variables (never commit them)

`.env.example` documents placeholders. Copy them into the real `.env` (gitignored):

```bash
LIVEKIT_WS_URL=wss://<your-project>.livekit.cloud
LIVEKIT_HOST_URL=https://<your-project>.livekit.cloud   # optional; derived from WS URL when unset
LIVEKIT_API_KEY=<your key>
LIVEKIT_API_SECRET=<your secret>
BEAN_LIVEKIT_MONTHLY_BUDGET_MINUTES=4000
BEAN_LIVEKIT_MAX_CONCURRENT_PARTICIPANTS=80
BEAN_LIVEKIT_MAX_ROOM_PARTICIPANTS=51
```

Rules enforced by the code (`src/lib/livekit/config.ts`, server-only):
- `LIVEKIT_API_SECRET` never reaches the browser, never appears in an API response, and is never logged.
- The browser receives ONLY the WebSocket URL, a short-lived per-participant JWT, and safe room metadata.
- Missing/malformed config ⇒ status `NOT_CONFIGURED`; classroom endpoints return 503 with a clear message instead of faking success.

## 3. Register the webhook (recommended, enables verified attendance)

In LiveKit Cloud → **Settings → Webhooks**, add endpoint:

```
POST https://<your-bean-domain>/api/webhooks/livekit
```

Select the events BEAN consumes: `room_started`, `room_finished`, `participant_joined`, `participant_left`, `participant_connection_aborted`. LiveKit signs every delivery (`Authorization` header, JWT with a SHA-256 digest of the exact body); BEAN verifies the signature and the body binding before parsing anything and rejects invalid deliveries with 401. Redeliveries are idempotent (unique provider event id).

If webhooks are not configured, classrooms still work — teacher "End class" remains the primary finalisation path; verified attendance evidence will be partial (documented limitation).

## 4. Verify the integration

1. `bun run dev`, open a published class as the owner teacher → "Start Live Class" inside the scheduled window (the reservation needs ≥1 confirmed booking).
2. As a student with a confirmed seat → class page shows "Join Live Classroom" while the room is live.
3. Expect camera/microphone permission prompts; the pre-join screen previews devices BEFORE joining, and nothing activates until you press Join.
4. Check LiveKit Cloud → project → **Rooms** while the class is live, and **Usage** afterwards to see BEAN's reservations reconciling against real usage.

## 5. Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Status chip says NOT_CONFIGURED | env vars missing/malformed | complete step 2; WS URL must start `wss://` or `ws://` |
| Start fails with 502 "could not be created" | provider rejected `createRoom`; the BEAN reservation was released and the session marked FAILED | retry after a short wait; check LiveKit Cloud status/quota |
| Token request returns 503 | configuration check failed server-side | re-check credentials; restart `bun run dev` |
| No attendance evidence | webhook not registered / unreachable | register the webhook (step 3); confirm the events above |
| 429 "free pilot allowance" | BEAN monthly budget exhausted | raise `BEAN_LIVEKIT_MONTHLY_BUDGET_MINUTES` deliberately, or wait for the next month (documented in the usage-budget doc) |

## Production notes

- Run `bun run build && bun run start` with the same env vars present; the Next.js server (Node runtime) performs all LiveKit server-API calls.
- Secrets belong in the deployment platform's secret store — never in the repository.
- Rotate the API key/secret from LiveKit Cloud when staff changes; BEAN reads them at call time.
