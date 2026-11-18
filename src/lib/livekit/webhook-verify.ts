// ─── BEAN Live Classroom (Phase 5): webhook signature verification ────────────
// Performs EXACTLY the checks WebhookReceiver.receive() performs:
//   1. verify the Authorization JWT (HS256, issued by the LiveKit API key,
//      unexpired) with the server secret via TokenVerifier
//   2. verify the token's sha256 claim equals the SHA-256 of the raw body —
//      binding the signature to the exact bytes we received
//   3. JSON-parse the body AFTER verification (never before)
//
// Why not WebhookReceiver.receive() directly? The @livekit/protocol codegen
// inlines google.protobuf.Timestamp into a bigint scalar, so its JSON decoder
// rejects every real-world createdAt shape (RFC 3339 string AND {seconds}
// objects) — receive() throws before returning the event. The steps here are
// the same cryptographic checks with a tolerant parse; nothing about the
// security model changes: invalid or missing signatures are still rejected.

import { createHash } from 'node:crypto'
import { TokenVerifier } from 'livekit-server-sdk'
import { livekitCredentials } from './config'

export interface LivekitWebhookPayload {
  event: string
  id: string
  roomName: string
  /** Event creation time (epoch milliseconds) — best-effort from the payload. */
  occurredAt: Date
  participantIdentity: string | null
}

export type WebhookVerifyResult =
  | { ok: true; payload: LivekitWebhookPayload }
  | { ok: false; reason: 'missing_signature' | 'invalid_signature' | 'bad_body' | 'not_configured' }

function timestampToMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value // seconds vs ms heuristics
  }
  if (typeof value === 'bigint') {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n < 10_000_000_000 ? n * 1000 : n
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value) // RFC 3339 form
    if (Number.isFinite(parsed)) return parsed
    const asNum = Number(value)
    if (Number.isFinite(asNum) && asNum > 0) return asNum < 10_000_000_000 ? asNum * 1000 : asNum
  }
  if (value && typeof value === 'object') {
    const seconds = (value as { seconds?: unknown }).seconds
    return timestampToMs(seconds)
  }
  return null
}

/** Verify a LiveKit webhook request; returns the safely-extracted payload. */
export async function verifyLivekitWebhook(rawBody: string, authHeader: string | undefined): Promise<WebhookVerifyResult> {
  const creds = livekitCredentials()
  if (!creds) return { ok: false, reason: 'not_configured' }
  if (!authHeader) return { ok: false, reason: 'missing_signature' }

  // LiveKit may send "Bearer <jwt>" or the bare JWT — accept both shapes.
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader

  try {
    const verifier = new TokenVerifier(creds.apiKey, creds.apiSecret)
    const claims = (await verifier.verify(token)) as { sha256?: string }
    if (!claims.sha256) return { ok: false, reason: 'invalid_signature' }
    // Bind the signature to the exact bytes received (same check as the SDK).
    const bodyHash = createHash('sha256').update(rawBody).digest('base64')
    if (claims.sha256 !== bodyHash) return { ok: false, reason: 'invalid_signature' }
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }

  let body: {
    event?: string
    id?: string
    room?: { name?: string }
    participant?: { identity?: string }
    createdAt?: unknown
  }
  try {
    body = JSON.parse(rawBody) as typeof body
  } catch {
    return { ok: false, reason: 'bad_body' }
  }

  const occurredAtMs = timestampToMs(body.createdAt) ?? Date.now()
  return {
    ok: true,
    payload: {
      event: body.event ?? '',
      id: body.id ?? '',
      roomName: body.room?.name ?? '',
      occurredAt: new Date(occurredAtMs),
      participantIdentity: body.participant?.identity ?? null,
    },
  }
}
