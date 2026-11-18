// ─── LiveKit configuration (Phase 5, SERVER-ONLY) ─────────────────────────────
// Single source of truth for LiveKit credentials and BEAN-side pilot caps.
// Security rules enforced here:
//   • The API secret is NEVER returned from this module to a route that sends
//     data to the browser. Routes may read status flags only.
//   • Nothing here is imported by client components — livekit-server-sdk is a
//     Node dependency and must never reach the browser bundle.
//   • Missing configuration fails honestly: classroom endpoints return a clear
//     "live classroom is not configured" state instead of faking a connection.

import { AccessToken, RoomServiceClient, TokenVerifier } from 'livekit-server-sdk'
import type { VideoGrant } from 'livekit-server-sdk'
import { TrackSource } from '@livekit/protocol'

// ─── BEAN-side safety caps (defaults documented in docs/PHASE5_USAGE_BUDGET.md)
// These are BEAN product decisions, NOT LiveKit provider quotas. The free
// pilot keeps a safety buffer below any provider allowance on purpose.

export const LIVE_BUDGET_DEFAULTS = {
  /** Monthly participant-minute allowance (all rooms combined). */
  monthlyBudgetMinutes: 4000,
  /** Global ceiling on simultaneously connected participants. */
  maxConcurrentParticipants: 80,
  /** Per-room participant ceiling (confirmed bookings + teacher). */
  maxRoomParticipants: 51,
} as const

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function liveBudgetConfig() {
  return {
    monthlyBudgetMinutes: intFromEnv('BEAN_LIVEKIT_MONTHLY_BUDGET_MINUTES', LIVE_BUDGET_DEFAULTS.monthlyBudgetMinutes),
    maxConcurrentParticipants: intFromEnv('BEAN_LIVEKIT_MAX_CONCURRENT_PARTICIPANTS', LIVE_BUDGET_DEFAULTS.maxConcurrentParticipants),
    maxRoomParticipants: intFromEnv('BEAN_LIVEKIT_MAX_ROOM_PARTICIPANTS', LIVE_BUDGET_DEFAULTS.maxRoomParticipants),
  }
}

// ─── Credential management ─────────────────────────────────────────────────────

export interface LiveKitCredentials {
  wsUrl: string
  hostUrl: string
  apiKey: string
  apiSecret: string
}

/**
 * Read + validate credentials from the environment. Returns null when the
 * mandatory trio (wsUrl / apiKey / apiSecret) is absent or malformed — callers
 * then surface an honest NOT_CONFIGURED state. Never throws for missing config.
 */
export function livekitCredentials(): LiveKitCredentials | null {
  const wsUrl = (process.env.LIVEKIT_WS_URL ?? '').trim()
  const apiKey = (process.env.LIVEKIT_API_KEY ?? '').trim()
  const apiSecret = (process.env.LIVEKIT_API_SECRET ?? '').trim()
  if (!wsUrl || !apiKey || !apiSecret) return null
  // The browser needs a websocket URL; the server needs an HTTP URL. Accept the
  // common shapes and derive the host URL when LIVEKIT_HOST_URL is unset.
  const wsOk = /^wss?:\/\//i.test(wsUrl)
  if (!wsOk) return null
  const hostUrl =
    (process.env.LIVEKIT_HOST_URL ?? '').trim() ||
    wsUrl.replace(/^ws(s)?:\/\//i, (_m, s) => (s ? 'https://' : 'http://'))
  if (!/^https?:\/\//i.test(hostUrl)) return null
  return { wsUrl, hostUrl, apiKey, apiSecret }
}

/** True when LiveKit credentials are present and well-formed. */
export function isLivekitConfigured(): boolean {
  return livekitCredentials() !== null
}

/**
 * Configuration status surfaced to the frontend (never includes credentials):
 *   NOT_CONFIGURED   — no credentials in the environment
 *   CONFIGURED       — credentials present; rooms may start if budget allows
 *   CONNECTION_ERROR — the last server-side LiveKit API call failed
 *   AVAILABLE        — configured AND the monthly allowance can host a new session
 */
export type LivekitConfigStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'CONNECTION_ERROR' | 'AVAILABLE'

/**
 * Transient failure flag set by route handlers when a LiveKit server API call
 * fails. Cleared on the next successful call. Kept in module scope (per
 * server instance) — an honest best-effort signal, not durable state.
 */
let lastConnectionError: { at: number; operation: string } | null = null

export function reportLivekitConnectionError(operation: string): void {
  lastConnectionError = { at: Date.now(), operation }
}

export function reportLivekitConnectionSuccess(): void {
  lastConnectionError = null
}

export function lastLivekitConnectionError(): { at: number; operation: string } | null {
  return lastConnectionError
}

/**
 * Publish-source allow-lists use the LiveKit TrackSource enum (the SDK's
 * serialiser throws on plain strings).
 */
const PUBLISH_SOURCES = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
} as const

export type PublishSourceName = keyof typeof PUBLISH_SOURCES

function toTrackSources(names: PublishSourceName[]): TrackSource[] {
  return names.map((name) => PUBLISH_SOURCES[name])
}

// ─── SDK singletons (created lazily; credentials stay server-side) ────────────

let roomService: RoomServiceClient | null = null

/** RoomServiceClient for room create/delete/moderation. Server-only. */
export function livekitRoomService(): RoomServiceClient | null {
  const creds = livekitCredentials()
  if (!creds) return null
  if (!roomService) roomService = new RoomServiceClient(creds.hostUrl, creds.apiKey, creds.apiSecret)
  return roomService
}

/**
 * Issue a short-lived LiveKit access token for a participant. The API secret is
 * used HERE ONLY and never leaves the server. Grants are caller-controlled so
 * the role matrix lives in the token route (see src/lib/livekit/live.ts).
 */
export async function createParticipantToken(opts: {
  identity: string
  name: string
  room: string
  ttlSeconds: number
  canPublishSources?: PublishSourceName[]
  metadata?: string
}): Promise<string> {
  const creds = livekitCredentials()
  if (!creds) throw new Error('LiveKit is not configured')
  const grant: VideoGrant = {
    room: opts.room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    // Room administration stays on the BEAN server — participants never get
    // roomAdmin/roomCreate, so no client can mute, remove or create rooms.
    roomAdmin: false,
    roomCreate: false,
    roomList: false,
    roomRecord: false,
    ingressAdmin: false,
    hidden: false,
  }
  if (opts.canPublishSources) {
    grant.canPublishSources = toTrackSources(opts.canPublishSources)
  }
  const token = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: opts.ttlSeconds,
    metadata: opts.metadata,
  })
  token.addGrant(grant)
  return await token.toJwt()
}
