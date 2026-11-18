// ─── BEAN Live Classroom (Phase 5): guarded LiveKit server operations ─────────
// Thin wrappers around RoomServiceClient that translate provider failures into
// honest BEAN states (CONNECTION_ERROR flag + typed results) without ever
// leaking credentials. Server-only: imports livekit-server-sdk transitively.

import { TrackSource } from '@livekit/protocol'
import { livekitRoomService, reportLivekitConnectionError, reportLivekitConnectionSuccess } from './config'

/**
 * Create a LiveKit room. Returns a discriminated result instead of throwing so
 * the start route can release the usage reservation on failure.
 */
export async function createRoomGuarded(
  roomName: string,
  maxParticipants: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const svc = livekitRoomService()
  if (!svc) return { ok: false, error: 'not_configured' }
  try {
    await svc.createRoom({
      name: roomName,
      maxParticipants,
      emptyTimeout: 300, // ROOM_EMPTY_TIMEOUT_SECONDS — allows temporary disconnects
      departureTimeout: 20,
    })
    reportLivekitConnectionSuccess()
    return { ok: true }
  } catch (err) {
    reportLivekitConnectionError('createRoom')
    console.error('[livekit] createRoom failed', err instanceof Error ? err.message : err)
    return { ok: false, error: 'room_creation_failed' }
  }
}

/**
 * Delete (terminate) a LiveKit room. Best-effort: if the provider call fails
 * the BEAN-side end still proceeds (the room also self-closes via its empty
 * timeout), and the room_finished webhook remains a safe no-op.
 */
export async function deleteRoomGuarded(roomName: string): Promise<{ ok: boolean; error?: string }> {
  const svc = livekitRoomService()
  if (!svc) return { ok: false, error: 'not_configured' }
  try {
    await svc.deleteRoom(roomName)
    reportLivekitConnectionSuccess()
    return { ok: true }
  } catch (err) {
    reportLivekitConnectionError('deleteRoom')
    console.error('[livekit] deleteRoom failed', err instanceof Error ? err.message : err)
    return { ok: false, error: 'room_deletion_failed' }
  }
}

/** List participants currently in a room (used for moderation + counts). */
export async function listParticipantsGuarded(roomName: string) {
  const svc = livekitRoomService()
  if (!svc) return { ok: false as const, error: 'not_configured' as const }
  try {
    const participants = await svc.listParticipants(roomName)
    reportLivekitConnectionSuccess()
    return { ok: true as const, participants }
  } catch (err) {
    reportLivekitConnectionError('listParticipants')
    console.error('[livekit] listParticipants failed', err instanceof Error ? err.message : err)
    return { ok: false as const, error: 'list_participants_failed' as const }
  }
}

/**
 * Mute a participant's published audio track. When trackSid is unknown the
 * participant's first active microphone track is used.
 */
export async function muteParticipantAudioGuarded(roomName: string, identity: string, trackSid?: string) {
  const svc = livekitRoomService()
  if (!svc) return { ok: false as const, error: 'not_configured' as const }
  try {
    let sid = trackSid
    if (!sid) {
      const participants = await svc.listParticipants(roomName)
      const target = participants.find((p) => p.identity === identity)
      const micTrack = target?.tracks.find((t) => t.source === TrackSource.MICROPHONE && !t.muted)
      if (!micTrack) return { ok: false as const, error: 'no_audio_track' as const }
      sid = micTrack.sid
    }
    await svc.mutePublishedTrack(roomName, identity, sid, true)
    reportLivekitConnectionSuccess()
    return { ok: true as const }
  } catch (err) {
    reportLivekitConnectionError('mutePublishedTrack')
    console.error('[livekit] mutePublishedTrack failed', err instanceof Error ? err.message : err)
    return { ok: false as const, error: 'mute_failed' as const }
  }
}

/** Remove a participant from the room (moderation). */
export async function removeParticipantGuarded(roomName: string, identity: string) {
  const svc = livekitRoomService()
  if (!svc) return { ok: false as const, error: 'not_configured' as const }
  try {
    await svc.removeParticipant(roomName, identity)
    reportLivekitConnectionSuccess()
    return { ok: true as const }
  } catch (err) {
    reportLivekitConnectionError('removeParticipant')
    console.error('[livekit] removeParticipant failed', err instanceof Error ? err.message : err)
    return { ok: false as const, error: 'remove_failed' as const }
  }
}
