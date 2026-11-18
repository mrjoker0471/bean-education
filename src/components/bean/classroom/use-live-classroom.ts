'use client'

// ─── BEAN Live Classroom (Phase 5): room lifecycle hook ───────────────────────
// Centralises ALL LiveKit interaction so the components stay presentational
// and BEAN-styled. Guarantees implemented here:
//   • connect only after an explicit user action, with a server-minted token
//   • adaptiveStream + dynacast + conservative 360p camera (low-bandwidth)
//   • reconnection state machine with a retry that mints a FRESH token and
//     re-applies the participant's previous consent (never force-enabling)
//   • whiteboard + raise-hand over reliable data messages; whiteboard
//     mutations are only accepted from participants whose BEAN metadata role
//     is TEACHER; late joiners fetch the persisted snapshot and ask for a sync
//   • screen share is teacher-only — the UI hides it for students AND the
//     token's canPublishSources already refused it server-side
//   • no recording anywhere — live-only by design (docs/PHASE5_SECURITY.md)

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  VideoPresets,
  type DisconnectReason,
  type RemoteParticipant,
  type LocalParticipant,
  type RemoteTrackPublication,
  type LocalTrackPublication,
} from 'livekit-client'
import { api } from '@/lib/api'
import type { LiveTokenResponse, WBSnapshotDTO, WBStrokeDTO } from '@/lib/types'
import { HAND_TOPIC, WB_TOPIC, handMessageSchema, snapshotByteSize, wbMessageSchema, WB_MAX_STROKES, WB_PROTOCOL_VERSION } from '@/lib/livekit/whiteboard'

export type ClassroomConnection =
  | 'IDLE'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'CONNECTION_FAILED'
  | 'SESSION_ENDED'

export interface ClassroomParticipant {
  identity: string
  name: string
  role: 'TEACHER' | 'STUDENT' | 'UNKNOWN'
  isLocal: boolean
  micEnabled: boolean
  cameraEnabled: boolean
  screenSharing: boolean
  handRaised: boolean
}

export interface RoomOptions {
  classId: string
  /** Fired when the teacher ends the room and BEAN confirms it. */
  onSessionEnded?: () => void
}

function roleFromMetadata(metadata: string | undefined): 'TEACHER' | 'STUDENT' | 'UNKNOWN' {
  try {
    if (!metadata) return 'UNKNOWN'
    const parsed = JSON.parse(metadata) as { role?: string }
    return parsed.role === 'TEACHER' ? 'TEACHER' : parsed.role === 'STUDENT' ? 'STUDENT' : 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

function nameFromMetadata(metadata: string | undefined, fallbackName: string | null | undefined): string {
  try {
    if (metadata) {
      const parsed = JSON.parse(metadata) as { displayName?: string }
      if (parsed.displayName) return parsed.displayName
    }
  } catch { /* fall through */ }
  return (fallbackName ?? '').trim() || 'Student'
}

export function useLiveClassroom({ classId, onSessionEnded }: RoomOptions) {
  const roomRef = useRef<Room | null>(null)
  const accessRef = useRef<LiveTokenResponse | null>(null)
  const consentRef = useRef({ mic: false, cam: false })
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localHandRef = useRef(false)

  const [connection, setConnection] = useState<ClassroomConnection>('IDLE')
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<ClassroomParticipant[]>([])
  const [hands, setHands] = useState<Record<string, boolean>>({})
  const [strokes, setStrokes] = useState<WBStrokeDTO[]>([])
  const [boardVersion, setBoardVersion] = useState(0)
  const [micEnabled, setMicEnabled] = useState(false)
  const [camEnabled, setCamEnabled] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)
  const [localHandRaised, setLocalHandRaised] = useState(false)

  // ─── Participant list projection ────────────────────────────────────────────
  const refreshParticipants = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    const local = room.localParticipant
    const list: ClassroomParticipant[] = [
      {
        identity: local.identity,
        name: nameFromMetadata(local.metadata, local.name),
        role: roleFromMetadata(local.metadata),
        isLocal: true,
        micEnabled: local.isMicrophoneEnabled,
        cameraEnabled: local.isCameraEnabled,
        screenSharing: local.isScreenShareEnabled,
        handRaised: localHandRef.current,
      },
    ]
    for (const p of room.remoteParticipants.values()) {
      list.push({
        identity: p.identity,
        name: nameFromMetadata(p.metadata, p.name),
        role: roleFromMetadata(p.metadata),
        isLocal: false,
        micEnabled: p.isMicrophoneEnabled,
        cameraEnabled: p.isCameraEnabled,
        screenSharing: !!p.getTrackPublication(Track.Source.ScreenShare),
        handRaised: false, // merged from hands state by the shell (compiler-safe)
      })
    }
    // Teacher first, then alphabetical by identity for stable order.
    list.sort((a, b) => {
      if (a.role === 'TEACHER' && b.role !== 'TEACHER') return -1
      if (b.role === 'TEACHER' && a.role !== 'TEACHER') return 1
      return a.identity.localeCompare(b.identity)
    })
    setParticipants(list)
  }, [])

  const strokesRef = useRef<WBStrokeDTO[]>([])
  // Hands live purely in state (updater-based — compiler-safe). strokesRef
  // mirrors board strokes for teacher mutation ops and is written only inside
  // event handlers / async callbacks (never during render).

  // ─── Data channel: whiteboard + hands ──────────────────────────────────────
  const publishJson = useCallback((payload: unknown, topic: string) => {
    const room = roomRef.current
    if (!room) return
    const encoder = new TextEncoder()
    void room.localParticipant.publishData(encoder.encode(JSON.stringify(payload)), {
      reliable: true,
      topic,
    })
  }, [])

  const schedulePersist = useCallback(() => {
    if (accessRef.current?.participant.role !== 'TEACHER') return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(async () => {
      const snapshot: WBSnapshotDTO = { v: WB_PROTOCOL_VERSION, strokes: strokesRef.current }
      try {
        await api.liveSaveWhiteboard(classId, snapshot)
        setBoardVersion((v) => v + 1)
      } catch {
        // Persistence is debounced and best-effort; the data channel keeps the
        // live class in sync and the next change retries the save.
      }
    }, 2500)
  }, [classId])

  const applyRemoteWbMessage = useCallback((fromIdentity: string, raw: unknown) => {
    const parsed = wbMessageSchema.safeParse(raw)
    if (!parsed.success) return // unknown/invalid shapes are dropped
    const msg = parsed.data
    // Authorisation: only a TEACHER-metadata participant may mutate the board.
    const senderRole = roomRef.current?.remoteParticipants.get(fromIdentity)
      ? roleFromMetadata(roomRef.current.remoteParticipants.get(fromIdentity)!.metadata)
      : 'UNKNOWN'
    if (msg.type === 'sync') {
      if (senderRole !== 'TEACHER') return
      strokesRef.current = msg.snapshot.strokes
      setStrokes(msg.snapshot.strokes)
      return
    }
    if (senderRole !== 'TEACHER') return
    if (msg.type === 'stroke') {
      const next = [...strokesRef.current, msg.stroke].slice(-WB_MAX_STROKES)
      strokesRef.current = next
      setStrokes(next)
    } else if (msg.type === 'undo') {
      const next = strokesRef.current.slice(0, -1)
      strokesRef.current = next
      setStrokes(next)
    } else if (msg.type === 'clear') {
      strokesRef.current = []
      setStrokes([])
    }
  }, [])

  const handleDataReceived = useCallback(
    (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (!participant) return
      try {
        const raw = JSON.parse(new TextDecoder().decode(payload)) as unknown
        if (topic === WB_TOPIC) {
          applyRemoteWbMessage(participant.identity, raw)
        } else if (topic === HAND_TOPIC) {
          const parsed = handMessageSchema.safeParse(raw)
          if (parsed.success) {
            setHands((prev) => ({ ...prev, [participant.identity]: parsed.data.raised }))
            refreshParticipants()
          }
        }
      } catch { /* malformed payloads are dropped */ }
    },
    [applyRemoteWbMessage, refreshParticipants],
  )

  // ─── Connection ────────────────────────────────────────────────────────────
  const connect = useCallback(async (): Promise<boolean> => {
    setError(null)
    setConnection('CONNECTING')
    try {
      const access = await api.liveToken(classId)
      accessRef.current = access

      // Tear down any previous room cleanly (retry path).
      const previous = roomRef.current
      if (previous) {
        previous.removeAllListeners()
        await previous.disconnect().catch(() => undefined)
        roomRef.current = null
      }

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h360.resolution,
        },
      })
      roomRef.current = room

      room
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
            setConnection('RECONNECTING')
          } else if (state === ConnectionState.Connected) {
            setConnection('CONNECTED')
          } else if (state === ConnectionState.Disconnected) {
            setConnection((current) => (current === 'SESSION_ENDED' ? current : 'DISCONNECTED'))
          }
        })
        .on(RoomEvent.ParticipantConnected, refreshParticipants)
        .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          setHands((prev) => {
            const next = { ...prev }
            delete next[p.identity]
            return next
          })
          refreshParticipants()
        })
        .on(RoomEvent.TrackSubscribed, refreshParticipants)
        .on(RoomEvent.TrackUnsubscribed, refreshParticipants)
        .on(RoomEvent.TrackMuted, refreshParticipants)
        .on(RoomEvent.TrackUnmuted, refreshParticipants)
        .on(RoomEvent.LocalTrackPublished, refreshParticipants)
        .on(RoomEvent.LocalTrackUnpublished, refreshParticipants)
        .on(RoomEvent.DataReceived, handleDataReceived)
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          // ROOM_DELETED (teacher ended) / PARTICIPANT_REMOVED (moderation)
          if (reason === 5 || reason === 4) {
            setConnection('SESSION_ENDED')
            onSessionEnded?.()
          } else {
            setConnection((current) => (current === 'SESSION_ENDED' ? current : 'DISCONNECTED'))
          }
        })
        .on(RoomEvent.MediaDevicesError, () => {
          setError('A media device failed — check camera/microphone permissions in your browser.')
        })

      await room.connect(access.wsUrl, access.token)

      // Late-join restore: fetch the teacher-authored snapshot, then ask the
      // live teacher for a sync (covers strokes not yet persisted).
      try {
        const wb = await api.liveWhiteboard(classId)
        if (wb.snapshot) {
          strokesRef.current = wb.snapshot.strokes
          setStrokes(wb.snapshot.strokes)
        }
      } catch { /* board stays empty; sync request below covers it */ }
      publishJson({ type: 'request-sync', v: WB_PROTOCOL_VERSION }, WB_TOPIC)

      // Re-apply the participant's previous consent (reconnect path) — never
      // force-enable anything the user did not choose.
      setMicEnabled(consentRef.current.mic)
      setCamEnabled(consentRef.current.cam)
      if (consentRef.current.mic) await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined)
      if (consentRef.current.cam) await room.localParticipant.setCameraEnabled(true).catch(() => undefined)

      setConnection('CONNECTED')
      refreshParticipants()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the classroom.')
      setConnection('CONNECTION_FAILED')
      return false
    }
  }, [classId, handleDataReceived, onSessionEnded, publishJson, refreshParticipants])

  const leave = useCallback(async () => {
    const room = roomRef.current
    if (room) {
      room.removeAllListeners()
      await room.disconnect().catch(() => undefined)
      roomRef.current = null
    }
    setConnection((current) => (current === 'SESSION_ENDED' ? current : 'IDLE'))
    setParticipants([])
    setHands({})
  }, [])

  // ─── Media controls ────────────────────────────────────────────────────────
  const toggleMic = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !room.localParticipant.isMicrophoneEnabled
    try {
      await room.localParticipant.setMicrophoneEnabled(next)
      consentRef.current.mic = next
      setMicEnabled(next)
      refreshParticipants()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access failed — check browser permissions.')
    }
  }, [refreshParticipants])

  const toggleCam = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !room.localParticipant.isCameraEnabled
    try {
      await room.localParticipant.setCameraEnabled(next)
      consentRef.current.cam = next
      setCamEnabled(next)
      refreshParticipants()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Camera access failed — check browser permissions.')
    }
  }, [refreshParticipants])

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room || accessRef.current?.participant.role !== 'TEACHER') return
    try {
      await room.localParticipant.setScreenShareEnabled(!room.localParticipant.isScreenShareEnabled)
      setScreenSharing(room.localParticipant.isScreenShareEnabled)
      refreshParticipants()
    } catch {
      // The browser independently stops captures (esc key, OS dialog) — honest error.
      setError('Screen sharing was stopped by the browser or was not permitted.')
    }
  }, [refreshParticipants])

  const toggleHand = useCallback(() => {
    localHandRef.current = !localHandRef.current
    setLocalHandRaised(localHandRef.current)
    publishJson({ type: 'hand', raised: localHandRef.current } satisfies { type: 'hand'; raised: boolean }, HAND_TOPIC)
    refreshParticipants()
  }, [publishJson, refreshParticipants])

  // ─── Device selection (where the browser supports it) ─────────────────────
  const switchDevice = useCallback(async (kind: 'videoinput' | 'audioinput', deviceId: string) => {
    const room = roomRef.current
    if (!room) return
    try {
      await room.switchActiveDevice(kind, deviceId)
    } catch { /* device may have disappeared */ }
  }, [])

  // ─── Whiteboard (teacher mutates; students view) ───────────────────────────
  const addStroke = useCallback((stroke: WBStrokeDTO) => {
    if (accessRef.current?.participant.role !== 'TEACHER') return
    const next = [...strokesRef.current, stroke].slice(-WB_MAX_STROKES)
    strokesRef.current = next
    setStrokes(next)
    publishJson({ type: 'stroke', v: WB_PROTOCOL_VERSION, stroke }, WB_TOPIC)
    schedulePersist()
  }, [publishJson, schedulePersist])

  const undoStroke = useCallback(() => {
    if (accessRef.current?.participant.role !== 'TEACHER') return
    const next = strokesRef.current.slice(0, -1)
    strokesRef.current = next
    setStrokes(next)
    publishJson({ type: 'undo', v: WB_PROTOCOL_VERSION }, WB_TOPIC)
    schedulePersist()
  }, [publishJson, schedulePersist])

  const clearBoard = useCallback(() => {
    if (accessRef.current?.participant.role !== 'TEACHER') return
    const next: WBStrokeDTO[] = []
    strokesRef.current = next
    setStrokes(next)
    publishJson({ type: 'clear', v: WB_PROTOCOL_VERSION }, WB_TOPIC)
    schedulePersist()
  }, [publishJson, schedulePersist])

  const sendBoardSync = useCallback(() => {
    if (accessRef.current?.participant.role !== 'TEACHER') return
    if (snapshotByteSize({ strokes: strokesRef.current }) > 180_000) return // bounded payloads
    publishJson({ type: 'sync', v: WB_PROTOCOL_VERSION, snapshot: { v: WB_PROTOCOL_VERSION, strokes: strokesRef.current } }, WB_TOPIC)
  }, [publishJson])

  // ─── Moderation (teacher-only UI; server re-checks everything) ─────────────
  const muteParticipant = useCallback(async (identity: string, trackSid?: string) => {
    try {
      await api.liveModerate(classId, { action: 'MUTE_AUDIO', identity, trackSid })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mute failed.')
      return false
    }
  }, [classId])

  const removeParticipant = useCallback(async (identity: string, reason: string) => {
    try {
      await api.liveModerate(classId, { action: 'REMOVE_PARTICIPANT', identity, reason })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Removal failed.')
      return false
    }
  }, [classId])

  // ─── Track accessors for the video components ──────────────────────────────
  const getCameraTrack = useCallback((identity: string, isLocal: boolean): LocalTrackPublication | RemoteTrackPublication | undefined => {
    const room = roomRef.current
    if (!room) return undefined
    if (isLocal) return room.localParticipant.getTrackPublication(Track.Source.Camera)
    return room.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.Camera)
  }, [])

  const getMicrophoneTrack = useCallback((identity: string, isLocal: boolean): LocalTrackPublication | RemoteTrackPublication | undefined => {
    const room = roomRef.current
    if (!room) return undefined
    if (isLocal) return room.localParticipant.getTrackPublication(Track.Source.Microphone)
    return room.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.Microphone)
  }, [])

  const getScreenShareTrack = useCallback((identity: string, isLocal: boolean): LocalTrackPublication | RemoteTrackPublication | undefined => {
    const room = roomRef.current
    if (!room) return undefined
    if (isLocal) return room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
    return room.remoteParticipants.get(identity)?.getTrackPublication(Track.Source.ScreenShare)
  }, [])

  const getLocalParticipant = useCallback((): LocalParticipant | null => roomRef.current?.localParticipant ?? null, [])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const room = roomRef.current
      if (room) {
        room.removeAllListeners()
        void room.disconnect().catch(() => undefined)
        roomRef.current = null
      }
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [])

  return {
    connection,
    error,
    setError,
    participants,
    hands,
    strokes,
    boardVersion,
    micEnabled,
    camEnabled,
    screenSharing,
    localHandRaised,
    connect,
    leave,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    toggleHand,
    switchDevice,
    addStroke,
    undoStroke,
    clearBoard,
    sendBoardSync,
    muteParticipant,
    removeParticipant,
    getCameraTrack,
    getMicrophoneTrack,
    getScreenShareTrack,
    getLocalParticipant,
  }
}
