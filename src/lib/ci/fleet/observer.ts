// ─── BEAN Classroom Intelligence (CI-3D): consent-gated LiveKit observer ──────
// The visible, explicit-dispatch, structured-only classroom observer
// (charter §4.1, §5 Agent 01, §9.1 Mode A, §11 Phases 0–1).
//
// Honesty and safety rules implemented here:
//   • ONE visible observer per room — the liveClassSessionId UNIQUE constraint
//     is a DB guarantee, not a best effort.
//   • EXPLICIT dispatch only: a row exists only after every charter §11
//     Phase 0 eligibility check passed server-side (never auto-attach on room
//     start, never client-authorised identity).
//   • STRUCTURED-ONLY mode is the only mode in CI-3D: the observer subscribes
//     to NO media (autoSubscribe:false + token canSubscribe/canPublish/
//     canPublishData=false), reads no payloads, and records only aggregate,
//     identity-free signals (presence counts, lifecycle, own connection
//     intervals, evidence gaps). `transcriptionEnabled` is an honest column
//     that stays false — audio processing needs the separate §9.2 milestone.
//   • Consent is re-checked at dispatch, at every connect attempt and on every
//     heartbeat step — a withdrawal mid-class makes the observer LEAVE
//     immediately and cancels its work (§10.2).
//   • Failure isolation: an observer failure can never break attendance,
//     bookings or class completion (acceptance criterion 6). Every failure is
//     an honest terminal status with a bounded reason.
//   • The observer's own presence accounting reuses the proven webhook pure
//     functions (applyParticipantJoined/Left) so reconnect intervals are
//     clamped, never negative, never double-counted.
//
// The LiveKit Room is behind a narrow seam (ObserverRoomHandle) so the full
// lifecycle/reconnect behaviour is deterministically testable without a live
// provider; the default seam implementation uses @livekit/rtc-node (CI-3A
// probe: A1/A2 PASS) with autoSubscribe disabled.

import { z } from 'zod'
import { db } from '@/lib/db'
import { hasCiConsent } from '../queue'
import {
  applyParticipantJoined,
  applyParticipantLeft,
  closeOpenInterval,
  LIVE_SESSION_STATUS,
  type ParticipantEvidenceState,
} from '@/lib/livekit/live'
import {
  createObserverToken,
  livekitCredentials,
  observerIdentity,
} from '@/lib/livekit/config'

// ─── Constants ────────────────────────────────────────────────────────────────

export const OBSERVER_STATUS = {
  PLANNED: 'PLANNED',
  CONNECTING: 'CONNECTING',
  OBSERVING: 'OBSERVING',
  LEFT: 'LEFT',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const
export type ObserverStatus = (typeof OBSERVER_STATUS)[keyof typeof OBSERVER_STATUS]

/** Charter §9.1 — Mode A is the ONLY consent mode implemented in CI-3D. */
export const OBSERVER_CONSENT_MODE = {
  STRUCTURED_ONLY: 'STRUCTURED_ONLY',
} as const

export const OBSERVER_LEFT_REASON = {
  SESSION_ENDED: 'session_ended',
  TEACHER_CANCELLED: 'teacher_cancelled',
  CONSENT_WITHDRAWN: 'consent_withdrawn',
  PROVIDER_FINISHED: 'provider_finished',
  CONNECTION_FAILED: 'connection_failed',
  SERVER_RESTART: 'server_restart',
  ROOM_CLOSED: 'room_closed',
} as const

export const OBSERVER_HEARTBEAT_MS = 60_000
/** A non-terminal row with no heartbeat for this long is a dead observer run. */
export const OBSERVER_STALE_MS = 3 * OBSERVER_HEARTBEAT_MS
/** Bounded identity-free presence samples (4h at the 60s heartbeat). */
export const OBSERVER_PRESENCE_SAMPLE_MAX = 240
export const OBSERVER_MAX_GAPS = 20
export const OBSERVER_TOKEN_TTL_SECONDS = 4 * 3600

export const OBSERVER_POOL_DEFAULT = 4
export const OBSERVER_POOL_MIN = 1
export const OBSERVER_POOL_MAX = 16

/** Global bound on simultaneously non-terminal observer sessions (§4.3 pool). */
export function observerPoolMax(): number {
  const raw = Number.parseInt(process.env.BEAN_CI_OBSERVER_MAX_ACTIVE ?? '', 10)
  if (!Number.isFinite(raw)) return OBSERVER_POOL_DEFAULT
  return Math.min(OBSERVER_POOL_MAX, Math.max(OBSERVER_POOL_MIN, raw))
}

const NON_TERMINAL: ObserverStatus[] = [OBSERVER_STATUS.PLANNED, OBSERVER_STATUS.CONNECTING, OBSERVER_STATUS.OBSERVING]

// ─── Room seam (dependency inversion — deterministic tests) ───────────────────

export type ObserverRoomEventName =
  | 'participant_connected'
  | 'participant_disconnected'
  | 'reconnecting'
  | 'reconnected'
  | 'disconnected'
  | 'data_received'

export interface ObserverRoomHandle {
  on(name: ObserverRoomEventName, handler: () => void): void
  /** Aggregate count only — the observer never reads participant identities. */
  remoteParticipantCount(): number
  disconnect(): Promise<void>
}

export type ObserverRoomFactory = (opts: { wsUrl: string; token: string }) => Promise<ObserverRoomHandle>

let roomFactory: ObserverRoomFactory | null = null

/** Test hook: inject a deterministic fake room (null restores the default). */
export function setObserverRoomFactoryForTests(factory: ObserverRoomFactory | null): void {
  roomFactory = factory
}

/**
 * Default seam: a real @livekit/rtc-node Room with autoSubscribe disabled —
 * the transport-level guarantee that structured-only mode receives no media.
 * The import is lazy so unit tests that inject a fake never load the native
 * binding.
 */
const defaultRoomFactory: ObserverRoomFactory = async (opts) => {
  const rtc = await import('@livekit/rtc-node')
  const { Room, RoomEvent } = rtc
  const room = new Room()
  // autoSubscribe: false — the observer never subscribes to any media track.
  await room.connect(opts.wsUrl, opts.token, { autoSubscribe: false, dynacast: false })
  const EVENT_MAP = {
    participant_connected: RoomEvent.ParticipantConnected,
    participant_disconnected: RoomEvent.ParticipantDisconnected,
    reconnecting: RoomEvent.Reconnecting,
    reconnected: RoomEvent.Reconnected,
    disconnected: RoomEvent.Disconnected,
    data_received: RoomEvent.DataReceived,
  } as const
  const handle: ObserverRoomHandle = {
    on(name, handler) {
      room.on(EVENT_MAP[name], () => handler())
    },
    remoteParticipantCount() {
      return room.remoteParticipants.size
    },
    disconnect() {
      return room.disconnect()
    },
  }
  return handle
}

// ─── Evidence schema (strict, identity-free) ──────────────────────────────────

export const observerEvidenceSchema = z
  .object({
    consentMode: z.literal(OBSERVER_CONSENT_MODE.STRUCTURED_ONLY),
    transcriptionEnabled: z.literal(false),
    observerIdentity: z.string().min(3).max(80),
    roomName: z.string().min(3).max(120),
    startedAt: z.string(),
    finishedAt: z.string(),
    connectedSeconds: z.number().int().min(0),
    reconnectCount: z.number().int().min(0),
    presenceSamples: z
      .array(
        z.object({
          at: z.string(),
          participantCount: z.number().int().min(0),
        }),
      )
      .max(OBSERVER_PRESENCE_SAMPLE_MAX),
    evidenceGaps: z
      .array(z.object({ from: z.string(), to: z.string(), reason: z.string().min(3).max(200) }))
      .max(OBSERVER_MAX_GAPS),
    dataMessageCount: z.number().int().min(0),
    whiteboardSnapshotVersion: z.number().int().min(0),
  })
  .strict()
export type ObserverEvidence = z.infer<typeof observerEvidenceSchema>

// ─── Eligibility (charter §11 Phase 0 — all server-side) ──────────────────────

export interface ObserverEligibilityChecks {
  classFound: boolean
  liveFound: boolean
  roomLive: boolean
  teacherAuthorised: boolean
  consentCurrent: boolean
  notAlreadyObserving: boolean
  capacityAvailable: boolean
  livekitConfigured: boolean
}

export interface ObserverEligibility {
  ok: boolean
  reasons: string[]
  checks: ObserverEligibilityChecks
  liveClassSessionId: string | null
  roomName: string | null
  teacherStudentId: string | null
  teacherProfileId: string | null
  /** Terminal observer row on this room (re-dispatch resets it). */
  existingObserverSessionId: string | null
}

export async function getObserverEligibility(classSessionId: string): Promise<ObserverEligibility> {
  const checks: ObserverEligibilityChecks = {
    classFound: false,
    liveFound: false,
    roomLive: false,
    teacherAuthorised: false,
    consentCurrent: false,
    notAlreadyObserving: false,
    capacityAvailable: false,
    // Derived from the credential triple itself (never from a cached flag).
    livekitConfigured: livekitCredentials() !== null,
  }
  const reasons: string[] = []

  const cls = await db.classSession.findUnique({
    where: { id: classSessionId },
    select: {
      id: true,
      teacherProfileId: true,
      teacherProfile: { select: { studentId: true, verificationStatus: true } },
      liveSession: {
        select: {
          id: true,
          roomName: true,
          status: true,
          observerSession: { select: { id: true, status: true } },
        },
      },
    },
  })
  const partial = {
    checks,
    liveClassSessionId: cls?.liveSession?.id ?? null,
    roomName: cls?.liveSession?.roomName ?? null,
    teacherStudentId: cls?.teacherProfile.studentId ?? null,
    teacherProfileId: cls?.teacherProfileId ?? null,
    existingObserverSessionId: cls?.liveSession?.observerSession?.id ?? null,
  }
  if (!cls) {
    reasons.push('class_not_found')
    return { ok: false, reasons, ...partial }
  }
  checks.classFound = true

  if (!cls.liveSession) {
    reasons.push('no_live_session')
    return { ok: false, reasons, ...partial }
  }
  checks.liveFound = true

  if (cls.liveSession.status !== LIVE_SESSION_STATUS.LIVE) {
    reasons.push(`room_not_live (${cls.liveSession.status})`)
    return { ok: false, reasons, ...partial }
  }
  checks.roomLive = true

  if (cls.teacherProfile.verificationStatus !== 'APPROVED') {
    reasons.push('teacher_not_authorised')
    return { ok: false, reasons, ...partial }
  }
  checks.teacherAuthorised = true

  if (!(await hasCiConsent(cls.teacherProfile.studentId))) {
    reasons.push('no_consent')
    return { ok: false, reasons, ...partial }
  }
  checks.consentCurrent = true

  const existing = cls.liveSession.observerSession
  if (existing && NON_TERMINAL.includes(existing.status as ObserverStatus)) {
    reasons.push('already_observing')
    return { ok: false, reasons, ...partial }
  }
  checks.notAlreadyObserving = true

  const activeCount = await db.classroomObserverSession.count({ where: { status: { in: NON_TERMINAL } } })
  if (activeCount >= observerPoolMax()) {
    reasons.push(`observer_capacity_full (${activeCount}/${observerPoolMax()})`)
    return { ok: false, reasons, ...partial }
  }
  checks.capacityAvailable = true

  if (!checks.livekitConfigured) {
    reasons.push('livekit_not_configured')
    return { ok: false, reasons, ...partial }
  }

  return { ok: true, reasons, ...partial }
}

// ─── Dispatch (explicit, durable, one per room) ───────────────────────────────

export type ObserverDispatchOutcome =
  | { dispatched: true; observerSessionId: string; status: string }
  | {
      dispatched: false
      reason:
        | 'class_not_found'
        | 'no_live_session'
        | 'room_not_live'
        | 'teacher_not_authorised'
        | 'no_consent'
        | 'already_observing'
        | 'observer_capacity_full'
        | 'livekit_not_configured'
    }

function mapEligibilityReason(reason: string): Exclude<ObserverDispatchOutcome, { dispatched: true }>['reason'] {
  if (reason.startsWith('class_not_found')) return 'class_not_found'
  if (reason.startsWith('no_live_session')) return 'no_live_session'
  if (reason.startsWith('room_not_live')) return 'room_not_live'
  if (reason.startsWith('teacher_not_authorised')) return 'teacher_not_authorised'
  if (reason.startsWith('no_consent')) return 'no_consent'
  if (reason.startsWith('already_observing')) return 'already_observing'
  if (reason.startsWith('observer_capacity_full')) return 'observer_capacity_full'
  return 'livekit_not_configured'
}

/** Visible, human-readable in-room disclosure (charter §10.1). */
export function observerRoomMetadata(observerSessionId: string): string {
  return JSON.stringify({
    agentId: 'BEAN_CLASSROOM_OBSERVER',
    observerSessionId,
    consentMode: OBSERVER_CONSENT_MODE.STRUCTURED_ONLY,
    disclosure:
      'BEAN Classroom Observer (AI) — visible automated participant. Structured observation only: no audio or video is processed, recorded or stored. The teacher can remove this participant at any time.',
  })
}

export async function dispatchObserverForSession(opts: {
  classSessionId: string
  dispatchedBy: string
  /** Tests drive the run directly for determinism when false. */
  startRun?: boolean
}): Promise<ObserverDispatchOutcome> {
  // Recover stale rows FIRST so the capacity count reflects reality.
  await recoverStaleObserverSessions()

  const eligibility = await getObserverEligibility(opts.classSessionId)
  if (!eligibility.ok) {
    return { dispatched: false, reason: mapEligibilityReason(eligibility.reasons[0] ?? 'class_not_found') }
  }

  const eligibilitySnapshot = JSON.stringify({
    checks: eligibility.checks,
    dispatchedBy: opts.dispatchedBy,
    consentMode: OBSERVER_CONSENT_MODE.STRUCTURED_ONLY,
    poolMax: observerPoolMax(),
    resetsTerminalRun: eligibility.existingObserverSessionId !== null,
  })

  let observerSessionId: string
  if (eligibility.existingObserverSessionId) {
    // A terminal row exists on this room (LEFT/FAILED/CANCELLED — the room can
    // hold at most ONE observer row, ever). RESET it for the new explicit run
    // via CAS: only a caller that transitions the terminal row owns the reset,
    // so a concurrent dispatch is reported honestly as already observing.
    const reset = await db.classroomObserverSession.updateMany({
      where: {
        id: eligibility.existingObserverSessionId,
        status: { notIn: NON_TERMINAL },
      },
      data: {
        status: OBSERVER_STATUS.PLANNED,
        leftReason: null,
        error: null,
        evidenceJson: null, // the new run writes its own envelope at finalisation
        eligibilityJson: eligibilitySnapshot,
        dispatchedBy: opts.dispatchedBy,
        attempts: 0,
        reconnectCount: 0,
        connectedSeconds: 0,
        lastHeartbeatAt: null,
        connectedAt: null,
        leftAt: null,
      },
    })
    if (reset.count !== 1) {
      return { dispatched: false, reason: 'already_observing' }
    }
    observerSessionId = eligibility.existingObserverSessionId
  } else {
    const row = await db.classroomObserverSession
      .create({
        data: {
          liveClassSessionId: eligibility.liveClassSessionId as string,
          classSessionId: opts.classSessionId,
          roomName: eligibility.roomName as string,
          observerIdentity: `pending:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, // replaced below with the row id
          status: OBSERVER_STATUS.PLANNED,
          consentMode: OBSERVER_CONSENT_MODE.STRUCTURED_ONLY,
          transcriptionEnabled: false,
          canPublishMedia: false,
          maxAttempts: 5,
          eligibilityJson: eligibilitySnapshot,
          dispatchedBy: opts.dispatchedBy,
        },
      })
      .catch((err) => {
        // Concurrent dispatch race: the winner's row is reported honestly.
        if ((err as { code?: string }).code === 'P2002') return null
        throw err
      })
    if (!row) return { dispatched: false, reason: 'already_observing' }
    // The observer identity embeds the row id — set it as a second step.
    await db.classroomObserverSession.update({
      where: { id: row.id },
      data: { observerIdentity: observerIdentity(row.id) },
    })
    observerSessionId = row.id
  }

  if (opts.startRun !== false) {
    const run = runObserverSession(observerSessionId)
    observerRuns.set(observerSessionId, run)
    void run.catch(() => undefined).finally(() => observerRuns.delete(observerSessionId))
  }

  return { dispatched: true, observerSessionId, status: OBSERVER_STATUS.PLANNED }
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

interface ObserverRunState {
  rowId: string
  handle: ObserverRoomHandle | null
  /** The observer's OWN presence — rejoin accounting (reconnectCount) is
   * handled inside the proven pure functions, never tracked separately. */
  presence: ParticipantEvidenceState
  samples: { at: string; participantCount: number }[]
  gaps: { from: string; to: string; reason: string }[]
  dataMessageCount: number
  closeRequested: { status: ObserverStatus; reason: string } | null
  finished: boolean
  /** Single-flight finalisation — concurrent callers share one DB write. */
  finalisePromise: Promise<void> | null
}

/** In-process registry of started runs (graceful cancellation by id). */
const observerRuns = new Map<string, Promise<void>>()
/** Cancellations requested by another code path for runs in THIS process. */
const pendingCancels = new Map<string, string>()

/** Test observability: the exact promise of a dispatch-started run (or null). */
export function observerRunPromise(observerSessionId: string): Promise<void> | null {
  return observerRuns.get(observerSessionId) ?? null
}

function sampleCount(state: ObserverRunState, at: Date): void {
  if (state.samples.length >= OBSERVER_PRESENCE_SAMPLE_MAX) return
  state.samples.push({
    at: at.toISOString(),
    participantCount: state.handle ? state.handle.remoteParticipantCount() : 0,
  })
}

function markGap(state: ObserverRunState, from: Date, to: Date, reason: string): void {
  if (state.gaps.length >= OBSERVER_MAX_GAPS) return
  state.gaps.push({ from: from.toISOString(), to: to.toISOString(), reason: reason.slice(0, 200) })
}

async function classTeacherConsentCurrent(classSessionId: string): Promise<boolean> {
  const cls = await db.classSession.findUnique({
    where: { id: classSessionId },
    select: { teacherProfile: { select: { studentId: true } } },
  })
  if (!cls) return false
  return hasCiConsent(cls.teacherProfile.studentId)
}

async function rowConsentCurrent(rowId: string): Promise<boolean> {
  const row = await db.classroomObserverSession.findUnique({
    where: { id: rowId },
    select: { classSessionId: true },
  })
  if (!row) return false
  return classTeacherConsentCurrent(row.classSessionId)
}

/**
 * Finalise a run exactly once: close the open presence interval, build the
 * strict identity-free evidence envelope, persist the terminal state.
 * Single-flight — concurrent callers (disconnect handler, cancel poller,
 * heartbeat) share one DB write, and `finished` flips only AFTER the write
 * lands so awaiters of the run promise always read the final row.
 */
function finaliseObserverRun(state: ObserverRunState, now: Date): Promise<void> {
  if (state.finished) return Promise.resolve()
  if (!state.finalisePromise) {
    state.finalisePromise = doFinaliseObserverRun(state, now)
  }
  return state.finalisePromise
}

async function doFinaliseObserverRun(state: ObserverRunState, now: Date): Promise<void> {
  try {
    const row = await db.classroomObserverSession.findUnique({
      where: { id: state.rowId },
      select: { observerIdentity: true, roomName: true, connectedAt: true, liveClassSessionId: true },
    })
    if (row) {
      const connectedSeconds = closeOpenInterval(state.presence, now).totalConnectedSeconds
      const requested = state.closeRequested
      const status = requested?.status ?? OBSERVER_STATUS.LEFT
      const leftReason = requested?.reason ?? OBSERVER_LEFT_REASON.ROOM_CLOSED
      const reconnectCount = state.presence.reconnectCount

      let whiteboardSnapshotVersion = 0
      try {
        const wb = await db.liveWhiteboardState.findUnique({
          where: { liveClassSessionId: row.liveClassSessionId },
          select: { version: true },
        })
        whiteboardSnapshotVersion = wb?.version ?? 0
      } catch {
        whiteboardSnapshotVersion = 0
      }

      const evidenceCandidate: ObserverEvidence = {
        consentMode: OBSERVER_CONSENT_MODE.STRUCTURED_ONLY,
        transcriptionEnabled: false,
        observerIdentity: row.observerIdentity,
        roomName: row.roomName,
        startedAt: (row.connectedAt ?? now).toISOString(),
        finishedAt: now.toISOString(),
        connectedSeconds,
        reconnectCount,
        presenceSamples: state.samples,
        evidenceGaps: state.gaps,
        dataMessageCount: state.dataMessageCount,
        whiteboardSnapshotVersion,
      }
      const parsed = observerEvidenceSchema.safeParse(evidenceCandidate)
      const evidenceJson = parsed.success ? JSON.stringify(parsed.data) : null

      await db.classroomObserverSession.updateMany({
        where: { id: state.rowId, status: { in: NON_TERMINAL } },
        data: {
          status,
          leftReason,
          connectedSeconds,
          reconnectCount,
          ...(evidenceJson ? { evidenceJson } : {}),
          leftAt: now,
        },
      })
    }
  } catch (err) {
    console.error('[ci observer] finalise failed', err instanceof Error ? err.message : err)
  } finally {
    state.finished = true
  }
}

/**
 * One heartbeat step: consent re-check → heartbeat → presence sample.
 * Exported for deterministic tests; the interval calls the same code.
 */
export async function observerHeartbeatStep(state: ObserverRunState, now: Date): Promise<void> {
  if (state.finished) return
  if (!(await rowConsentCurrent(state.rowId))) {
    state.closeRequested = { status: OBSERVER_STATUS.CANCELLED, reason: OBSERVER_LEFT_REASON.CONSENT_WITHDRAWN }
    if (state.handle) {
      await state.handle.disconnect().catch(() => undefined)
    }
    state.presence = closeOpenInterval(state.presence, now)
    await finaliseObserverRun(state, now)
    return
  }
  await db.classroomObserverSession.update({
    where: { id: state.rowId },
    data: { lastHeartbeatAt: now, reconnectCount: state.presence.reconnectCount },
  }).catch(() => undefined)
  sampleCount(state, now)
}

/** Expose the run state type for tests that drive heartbeat steps directly. */
export type { ObserverRunState }

/**
 * Run one observer session to completion. Bounded connect attempts, consent
 * re-checks, honest terminal states. Never throws into the dispatch caller.
 */
export async function runObserverSession(
  observerSessionId: string,
  opts?: { heartbeatMs?: number; backoffMs?: number },
): Promise<void> {
  const backoffMs = opts?.backoffMs ?? 500
  const heartbeatMs = opts?.heartbeatMs ?? OBSERVER_HEARTBEAT_MS
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const state: ObserverRunState = {
    rowId: observerSessionId,
    handle: null,
    presence: { firstJoinedAt: null, activeSince: null, lastLeftAt: null, totalConnectedSeconds: 0, reconnectCount: 0 },
    samples: [],
    gaps: [],
    dataMessageCount: 0,
    closeRequested: null,
    finished: false,
    finalisePromise: null,
  }

  try {
    const row0 = await db.classroomObserverSession.findUnique({
      where: { id: observerSessionId },
      select: {
        classSessionId: true,
        roomName: true,
        observerIdentity: true,
        status: true,
        maxAttempts: true,
        attempts: true,
        liveSession: { select: { status: true } },
      },
    })
    if (!row0 || !NON_TERMINAL.includes(row0.status as ObserverStatus)) return

    if (row0.liveSession.status !== LIVE_SESSION_STATUS.LIVE) {
      state.closeRequested = { status: OBSERVER_STATUS.CANCELLED, reason: OBSERVER_LEFT_REASON.SESSION_ENDED }
      await finaliseObserverRun(state, new Date())
      return
    }

    // Consent re-check at connect time (withdrawal between dispatch and
    // connect stops the observer before it ever joins — claim-time honesty).
    if (!(await classTeacherConsentCurrent(row0.classSessionId))) {
      state.closeRequested = { status: OBSERVER_STATUS.CANCELLED, reason: OBSERVER_LEFT_REASON.CONSENT_WITHDRAWN }
      await finaliseObserverRun(state, new Date())
      return
    }

    const creds = livekitCredentials()
    if (!creds) {
      await db.classroomObserverSession.updateMany({
        where: { id: observerSessionId, status: { in: NON_TERMINAL } },
        data: {
          status: OBSERVER_STATUS.FAILED,
          leftReason: OBSERVER_LEFT_REASON.CONNECTION_FAILED,
          error: 'LiveKit is not configured in this deployment',
          leftAt: new Date(),
        },
      })
      return
    }

    await db.classroomObserverSession.updateMany({
      where: { id: observerSessionId, status: { in: NON_TERMINAL } },
      data: { status: OBSERVER_STATUS.CONNECTING },
    })

    // Bounded connect attempts; consent is re-checked before every attempt.
    let handle: ObserverRoomHandle | null = null
    let lastError = ''
    let attempts = row0.attempts
    for (; attempts < row0.maxAttempts; attempts++) {
      if (!(await classTeacherConsentCurrent(row0.classSessionId))) {
        state.closeRequested = { status: OBSERVER_STATUS.CANCELLED, reason: OBSERVER_LEFT_REASON.CONSENT_WITHDRAWN }
        await db.classroomObserverSession.update({
          where: { id: observerSessionId },
          data: { attempts },
        }).catch(() => undefined)
        await finaliseObserverRun(state, new Date())
        return
      }
      try {
        const token = await createObserverToken({
          identity: row0.observerIdentity,
          room: row0.roomName,
          ttlSeconds: OBSERVER_TOKEN_TTL_SECONDS,
          metadata: observerRoomMetadata(observerSessionId),
        })
        const factory = roomFactory ?? defaultRoomFactory
        handle = await factory({ wsUrl: creds.wsUrl, token })
        break
      } catch (err) {
        lastError = (err instanceof Error ? err.message : String(err)).slice(0, 300)
        handle = null
        await db.classroomObserverSession.update({
          where: { id: observerSessionId },
          data: { attempts: attempts + 1 },
        }).catch(() => undefined)
        if (attempts + 1 < row0.maxAttempts) {
          await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, Math.min(attempts, 4))))
        }
      }
    }

    if (!handle) {
      await db.classroomObserverSession.updateMany({
        where: { id: observerSessionId, status: { in: NON_TERMINAL } },
        data: {
          status: OBSERVER_STATUS.FAILED,
          leftReason: OBSERVER_LEFT_REASON.CONNECTION_FAILED,
          attempts,
          error: `could not connect after ${attempts} attempt(s): ${lastError || 'unknown error'}`,
          leftAt: new Date(),
        },
      })
      console.error(`[ci observer] connect failed for session ${observerSessionId}: ${lastError}`)
      return
    }

    state.handle = handle
    const now = new Date()
    state.presence = applyParticipantJoined(state.presence, now).state
    await db.classroomObserverSession.updateMany({
      where: { id: observerSessionId, status: { in: NON_TERMINAL } },
      data: {
        status: OBSERVER_STATUS.OBSERVING,
        connectedAt: now,
        lastHeartbeatAt: now,
        attempts: attempts + 1,
      },
    })
    sampleCount(state, now)

    // ─── Event wiring (aggregate-only, identity-free) ───
    handle.on('participant_connected', () => sampleCount(state, new Date()))
    handle.on('participant_disconnected', () => sampleCount(state, new Date()))
    handle.on('data_received', () => {
      // Counts only — payloads are never read, decoded or stored.
      state.dataMessageCount++
    })
    handle.on('reconnecting', () => {
      const at = new Date()
      if (state.presence.activeSince) {
        state.presence = applyParticipantLeft(state.presence, at).state
        markGap(state, at, at, 'connection lost — reconnecting')
      }
      // reconnectCount is incremented by applyParticipantJoined on the
      // subsequent reconnected event — never counted twice.
    })
    handle.on('reconnected', () => {
      const at = new Date()
      state.presence = applyParticipantJoined(state.presence, at).state
      sampleCount(state, at)
    })
    handle.on('disconnected', () => {
      const at = new Date()
      state.presence = applyParticipantLeft(state.presence, at).state
      void (async () => {
        if (!state.closeRequested) {
          state.closeRequested = { status: OBSERVER_STATUS.LEFT, reason: OBSERVER_LEFT_REASON.ROOM_CLOSED }
        }
        await finaliseObserverRun(state, at)
      })().catch((err) => console.error('[ci observer] finalise after disconnect failed', err instanceof Error ? err.message : err))
    })

    heartbeat = setInterval(() => {
      void observerHeartbeatStep(state, new Date()).catch((err) =>
        console.error('[ci observer] heartbeat failed', err instanceof Error ? err.message : err),
      )
    }, heartbeatMs)
    heartbeat.unref?.()

    // Resolve when terminal; also service pending cancellations quickly so an
    // end-of-class hook in this process never waits a full heartbeat. The
    // poller AWAITS finalisation — an awaiter of the run promise reads the
    // final DB row, never a pre-write snapshot.
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        void (async () => {
          const pending = pendingCancels.get(state.rowId)
          if (pending && !state.closeRequested && !state.finished) {
            pendingCancels.delete(state.rowId)
            state.closeRequested = { status: OBSERVER_STATUS.CANCELLED, reason: pending }
            void state.handle?.disconnect().catch(() => undefined)
            // Finalise now (idempotent — concurrent finalise calls are
            // single-flight and the disconnect handler's call is a no-op).
            await finaliseObserverRun(state, new Date())
          }
          if (state.finished) {
            clearInterval(poll)
            resolve()
          }
        })().catch((err) => console.error('[ci observer] poll failed', err instanceof Error ? err.message : err))
      }, 25)
      poll.unref?.()
    })
  } catch (err) {
    console.error('[ci observer] run failed', err instanceof Error ? err.message : err)
    state.closeRequested = state.closeRequested ?? { status: OBSERVER_STATUS.FAILED, reason: OBSERVER_LEFT_REASON.CONNECTION_FAILED }
    await finaliseObserverRun(state, new Date()).catch(() => undefined)
  } finally {
    if (heartbeat) clearInterval(heartbeat)
  }
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

/**
 * Cancel every non-terminal observer session for a class (teacher withdraw,
 * session end, provider room finish). In-process runs receive the cancel
 * through pendingCancels and finalise honestly; rows owned by another process
 * are marked CANCELLED directly (a stale remote run never resurrects —
 * recoverStaleObserverSessions skips terminal rows).
 */
export async function cancelObserverForSession(classSessionId: string, reason: string): Promise<number> {
  const rows = await db.classroomObserverSession.findMany({
    where: { classSessionId, status: { in: NON_TERMINAL } },
    select: { id: true },
  })
  let cancelled = 0
  for (const row of rows) {
    if (observerRuns.has(row.id)) {
      pendingCancels.set(row.id, reason.slice(0, 60))
      cancelled++
      continue
    }
    const result = await db.classroomObserverSession.updateMany({
      where: { id: row.id, status: { in: NON_TERMINAL } },
      data: { status: OBSERVER_STATUS.CANCELLED, leftReason: reason.slice(0, 60), leftAt: new Date() },
    })
    cancelled += result.count
  }
  return cancelled
}

/**
 * Fire-and-forget cancellation hook for the classroom lifecycle — the
 * observer can never fail, delay or invalidate the classroom operation.
 */
export function cancelObserverForEndedSession(classSessionId: string, reason: string): void {
  void (async () => {
    try {
      await cancelObserverForSession(classSessionId, reason)
    } catch (err) {
      console.error('[ci observer] cancel after session end failed (classroom operation unaffected)', err instanceof Error ? err.message : err)
    }
  })()
}

/**
 * Cancel one observer session explicitly (DELETE route / tests). Returns true
 * when a non-terminal row was transitioned (or will be, by its own run).
 */
export async function cancelObserverSession(observerSessionId: string, reason: string): Promise<boolean> {
  const row = await db.classroomObserverSession.findUnique({
    where: { id: observerSessionId },
    select: { id: true, status: true },
  })
  if (!row || !NON_TERMINAL.includes(row.status as ObserverStatus)) return false
  if (observerRuns.has(observerSessionId)) {
    pendingCancels.set(observerSessionId, reason.slice(0, 60))
    return true
  }
  const result = await db.classroomObserverSession.updateMany({
    where: { id: observerSessionId, status: { in: NON_TERMINAL } },
    data: { status: OBSERVER_STATUS.CANCELLED, leftReason: reason.slice(0, 60), leftAt: new Date() },
  })
  return result.count === 1
}

// ─── Recovery ─────────────────────────────────────────────────────────────────

/**
 * Recover stale non-terminal rows: an observer run died with its server
 * process (no heartbeat within OBSERVER_STALE_MS). Marked FAILED honestly —
 * re-dispatch after recovery is an explicit new dispatch, never a resurrection.
 */
export async function recoverStaleObserverSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - OBSERVER_STALE_MS)
  const stale = await db.classroomObserverSession.findMany({
    where: {
      status: { in: NON_TERMINAL },
      // A row without any heartbeat yet (PLANNED/CONNECTING) is alive only
      // while it is being written to — updatedAt is the last sign of life.
      OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true },
  })
  for (const row of stale) {
    if (observerRuns.has(row.id)) continue // alive in this process
    await db.classroomObserverSession.updateMany({
      where: { id: row.id, status: { in: NON_TERMINAL } },
      data: {
        status: OBSERVER_STATUS.FAILED,
        leftReason: OBSERVER_LEFT_REASON.SERVER_RESTART,
        error: 'observer run lost (server restart or crash) — evidence gap recorded',
        leftAt: new Date(),
      },
    })
  }
  return stale.length
}

// ─── DTO ──────────────────────────────────────────────────────────────────────

export interface ClassroomObserverDTO {
  observerSessionId: string
  status: string
  leftReason: string | null
  consentMode: string
  transcriptionEnabled: boolean
  canPublishMedia: boolean
  reconnectCount: number
  connectedSeconds: number
  dispatchedAt: string
  connectedAt: string | null
  leftAt: string | null
  hasEvidence: boolean
}

export function toObserverDTO(row: {
  id: string
  status: string
  leftReason: string | null
  consentMode: string
  transcriptionEnabled: boolean
  canPublishMedia: boolean
  reconnectCount: number
  connectedSeconds: number
  createdAt: Date
  connectedAt: Date | null
  leftAt: Date | null
  evidenceJson: string | null
}): ClassroomObserverDTO {
  return {
    observerSessionId: row.id,
    status: row.status,
    leftReason: row.leftReason,
    consentMode: row.consentMode,
    transcriptionEnabled: row.transcriptionEnabled,
    canPublishMedia: row.canPublishMedia,
    reconnectCount: row.reconnectCount,
    connectedSeconds: row.connectedSeconds,
    dispatchedAt: row.createdAt.toISOString(),
    connectedAt: row.connectedAt?.toISOString() ?? null,
    leftAt: row.leftAt?.toISOString() ?? null,
    hasEvidence: !!row.evidenceJson,
  }
}
