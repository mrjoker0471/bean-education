// ─── BEAN Live Classroom (Phase 5): shared domain logic ───────────────────────
// Server-side source of truth for the live classroom: access windows,
// participant identity rules, webhook interval accounting (PURE functions so
// the idempotency/out-of-order guarantees are unit-testable), audit actions
// and DTO mappers. Never trusts client-supplied identity — the current user
// always comes from the httpOnly session cookie (src/lib/auth.ts).

import type { ClassSession, LiveClassParticipant, LiveClassSession } from '@prisma/client'

// ─── Statuses ────────────────────────────────────────────────────────────────

export const LIVE_SESSION_STATUS = {
  READY: 'READY', // reserved, room creation pending/failed retry
  LIVE: 'LIVE', // room running
  ENDED: 'ENDED', // finalised (usage reconciled once)
  INTERRUPTED: 'INTERRUPTED', // provider reported room finished while BEAN still expected LIVE
  FAILED: 'FAILED', // room creation failed — retry reuses this row
} as const

export const LIVE_END_REASON = {
  TEACHER: 'teacher_ended',
  PROVIDER: 'provider_room_finished',
  FAILED_CREATE: 'failed_room_creation',
} as const

export const AUDIT_LIVE_ACTION = {
  STARTED: 'LIVE_STARTED',
  ENDED: 'LIVE_ENDED',
  MUTED: 'LIVE_PARTICIPANT_MUTED',
  REMOVED: 'LIVE_PARTICIPANT_REMOVED',
  RESUMED: 'LIVE_RESUMED_AFTER_FAILURE',
} as const

// ─── Windows & limits (documented in docs/PHASE5_LIVE_CLASSROOM.md) ──────────

/** A room may START / participants may JOIN this many minutes before the scheduled start. */
export const JOIN_WINDOW_BEFORE_MINUTES = 15
/** Tokens stay valid this many minutes beyond the scheduled end (reconnect margin). */
export const TOKEN_TAIL_MINUTES = 60
/** LiveKit room empty-timeout: auto-close after everyone has left this long. */
export const ROOM_EMPTY_TIMEOUT_SECONDS = 300
/** Minimum confirmed bookings required before a teacher may start the room. */
export const MIN_CONFIRMED_TO_START = 1
/** Attendance suggestion threshold: share of the class duration actually connected. */
export const ATTENDANCE_SUGGESTION_THRESHOLD = 0.6
/** Moderator reason length bound. */
export const MODERATION_REASON_MAX = 200

/**
 * True when `now` is inside the start/join window:
 *   startsAt − JOIN_WINDOW_BEFORE_MINUTES ≤ now < startsAt + durationMinutes
 */
export function isInsideLiveWindow(startsAt: Date, durationMinutes: number, now: Date = new Date()): boolean {
  const startMs = startsAt.getTime()
  const windowOpens = startMs - JOIN_WINDOW_BEFORE_MINUTES * 60_000
  const windowCloses = startMs + durationMinutes * 60_000
  return now.getTime() >= windowOpens && now.getTime() < windowCloses
}

// ─── Identity & room naming ──────────────────────────────────────────────────

/**
 * Opaque LiveKit participant identity derived from the authenticated BEAN
 * database identity. NEVER an email, display name or client-supplied value.
 */
export function participantIdentity(studentId: string): string {
  return `bean:${studentId}`
}

/** Parse an identity back to the BEAN student id (null for foreign shapes). */
export function studentIdFromIdentity(identity: string): string | null {
  if (!identity.startsWith('bean:')) return null
  const id = identity.slice(5)
  return id.length > 0 ? id : null
}

/**
 * Server-generated opaque room name. Contains no email, display name or class
 * title — just an unguessable id prefix. LiveKit room names are server secrets
 * in practice (join tokens are minted per class by BEAN).
 */
export function generateRoomName(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `bean-live-${hex}`
}

/** Safe display name for a participant tile — falls back to a neutral label. */
export function safeDisplayName(name: string | null | undefined, role: 'TEACHER' | 'STUDENT'): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return role === 'TEACHER' ? 'Teacher' : 'Student'
  return trimmed.slice(0, 60)
}

// ─── Webhook interval accounting (PURE — unit-tested) ────────────────────────

export interface ParticipantEvidenceState {
  firstJoinedAt: Date | null
  activeSince: Date | null
  lastLeftAt: Date | null
  totalConnectedSeconds: number
  reconnectCount: number
}

export type WebhookParticipantOutcome = {
  state: ParticipantEvidenceState
  /** 'joined' opened a new interval; 'left' closed one; 'noop' = idempotent duplicate. */
  kind: 'joined' | 'left' | 'noop'
}

/**
 * Handle participant_joined idempotently and out-of-order safely.
 *   • first join          → open interval (activeSince), reconnectCount 0
 *   • repeat join while   → NO-OP (duplicate delivery must not create a second
 *     an interval is open   interval or inflate reconnectCount)
 *   • rejoin after leave  → open a NEW interval; reconnectCount+1
 *   • out-of-order event  → clamp activeSince to at least lastLeftAt so no
 *                           negative duration can ever be accumulated
 */
export function applyParticipantJoined(state: ParticipantEvidenceState, eventAt: Date): WebhookParticipantOutcome {
  if (state.activeSince) {
    return { state, kind: 'noop' } // duplicate join while already connected
  }
  const since = state.lastLeftAt && eventAt.getTime() < state.lastLeftAt.getTime() ? state.lastLeftAt : eventAt
  const isRejoin = state.lastLeftAt !== null // a completed prior interval exists
  return {
    kind: 'joined',
    state: {
      firstJoinedAt: state.firstJoinedAt ?? since,
      activeSince: since,
      lastLeftAt: state.lastLeftAt,
      totalConnectedSeconds: state.totalConnectedSeconds,
      reconnectCount: state.reconnectCount + (isRejoin ? 1 : 0),
    },
  }
}

/**
 * Handle participant_left / participant_connection_aborted idempotently.
 *   • open interval  → close it (accumulate clamped ≥ 0 seconds)
 *   • no interval    → NO-OP (duplicate/out-of-order delivery)
 */
export function applyParticipantLeft(state: ParticipantEvidenceState, eventAt: Date): WebhookParticipantOutcome {
  if (!state.activeSince) {
    return { state, kind: 'noop' }
  }
  const sinceMs = state.activeSince.getTime()
  const untilMs = Math.max(eventAt.getTime(), sinceMs) // out-of-order clamp
  const seconds = Math.floor((untilMs - sinceMs) / 1000)
  return {
    kind: 'left',
    state: {
      firstJoinedAt: state.firstJoinedAt,
      activeSince: null,
      lastLeftAt: new Date(untilMs),
      totalConnectedSeconds: state.totalConnectedSeconds + seconds,
      reconnectCount: state.reconnectCount,
    },
  }
}

/**
 * Close any open interval conservatively (room_finished / end). Never
 * negative; uses the event time as the close boundary.
 */
export function closeOpenInterval(state: ParticipantEvidenceState, eventAt: Date): ParticipantEvidenceState {
  if (!state.activeSince) return state
  return applyParticipantLeft(state, eventAt).state
}

/** Total verified connected seconds including an open interval up to `until`. */
export function effectiveConnectedSeconds(participant: Pick<LiveClassParticipant, 'activeSince' | 'totalConnectedSeconds'>, until: Date): number {
  if (!participant.activeSince) return participant.totalConnectedSeconds
  const sinceMs = participant.activeSince.getTime()
  const untilMs = Math.max(until.getTime(), sinceMs)
  return participant.totalConnectedSeconds + Math.floor((untilMs - sinceMs) / 1000)
}

/**
 * Attendance suggestion from verified evidence: attended when the student's
 * connected time covers at least ATTENDANCE_SUGGESTION_THRESHOLD of the class
 * duration. Advisory only — the teacher always confirms or overrides.
 */
export function suggestedAttendance(
  connectedSeconds: number,
  durationMinutes: number,
): 'ATTENDED' | 'NO_SHOW' | null {
  if (durationMinutes <= 0) return null
  const ratio = connectedSeconds / (durationMinutes * 60)
  if (ratio >= ATTENDANCE_SUGGESTION_THRESHOLD) return 'ATTENDED'
  if (connectedSeconds >= 30) return 'NO_SHOW'
  return null
}

// ─── DTO mappers (server rows → safe client payloads) ────────────────────────

export interface LiveEvidenceDTO {
  studentId: string
  displayName: string | null
  bookingStatus: string
  firstJoinedAt: string | null
  lastLeftAt: string | null
  totalConnectedSeconds: number
  reconnectCount: number
  currentlyConnected: boolean
  suggestedAttendance: 'ATTENDED' | 'NO_SHOW' | null
}

/**
 * Owner-teacher attendance evidence for one class: verified live participation
 * per enrolled student + the (documented, configurable) suggestion.
 */
export function toLiveEvidenceDTO(
  participants: (Pick<LiveClassParticipant, 'studentId' | 'firstJoinedAt' | 'lastLeftAt' | 'activeSince' | 'totalConnectedSeconds' | 'reconnectCount'> & { student: { displayName: string | null } })[],
  bookings: { studentId: string; status: string }[],
  durationMinutes: number,
  now: Date = new Date(),
): LiveEvidenceDTO[] {
  const byStudent = new Map(participants.map((p) => [p.studentId, p]))
  return bookings.map((booking) => {
    const p = byStudent.get(booking.studentId)
    const seconds = p ? effectiveConnectedSeconds(p, now) : 0
    return {
      studentId: booking.studentId,
      displayName: p?.student.displayName ?? null,
      bookingStatus: booking.status,
      firstJoinedAt: p?.firstJoinedAt ? p.firstJoinedAt.toISOString() : null,
      lastLeftAt: p?.lastLeftAt ? p.lastLeftAt.toISOString() : null,
      totalConnectedSeconds: seconds,
      reconnectCount: p?.reconnectCount ?? 0,
      currentlyConnected: !!p?.activeSince,
      suggestedAttendance: suggestedAttendance(seconds, durationMinutes),
    }
  })
}

export interface LiveStatusDTO {
  classId: string
  liveState: 'NOT_STARTED' | 'LIVE' | 'ENDED' | 'FAILED' | 'INTERRUPTED'
  scheduledStart: string
  scheduledEnd: string
  windowOpens: string
  windowCloses: string
  participantCount: number | null // only while LIVE; no identities
  mayJoin: boolean
  joinBlockReason: string | null
  configurationStatus: 'NOT_CONFIGURED' | 'CONFIGURED' | 'CONNECTION_ERROR' | 'AVAILABLE'
}

/** Map a class + live session row to the safe public status DTO. */
export function toLiveStatusDTO(
  cls: Pick<ClassSession, 'id' | 'startsAt' | 'durationMinutes' | 'status'>,
  live: LiveClassSession | null,
  participantCount: number | null,
  mayJoin: boolean,
  joinBlockReason: string | null,
  configurationStatus: LiveStatusDTO['configurationStatus'],
): LiveStatusDTO {
  const startMs = cls.startsAt.getTime()
  const scheduledEnd = new Date(startMs + cls.durationMinutes * 60_000)
  return {
    classId: cls.id,
    liveState: !live ? 'NOT_STARTED' : (live.status as LiveStatusDTO['liveState']),
    scheduledStart: cls.startsAt.toISOString(),
    scheduledEnd: scheduledEnd.toISOString(),
    windowOpens: new Date(startMs - JOIN_WINDOW_BEFORE_MINUTES * 60_000).toISOString(),
    windowCloses: scheduledEnd.toISOString(),
    participantCount,
    mayJoin,
    joinBlockReason,
    configurationStatus,
  }
}
