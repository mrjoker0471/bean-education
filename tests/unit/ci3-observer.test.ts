// ─── CI-3D tests: consent-gated LiveKit observer (isolated real DB) ───────────
// Real database behaviour + a deterministic fake room behind the seam. Coverage:
//   EL1 eligibility matrix — every charter §11 Phase 0 check fails honestly:
//       class_not_found / no_live_session / room_not_live /
//       teacher_not_authorised / no_consent / already_observing /
//       observer_capacity_full / livekit_not_configured
//   D1 dispatch — durable row (one per room), eligibility snapshot, identity
//       never a student identity, consent withdrawn between dispatch and
//       connect → CANCELLED before the room is ever joined
//   R1 runtime — connect → OBSERVING, aggregate presence samples, reconnect
//       accounting (reconnectCount from the proven pure functions, gap
//       recorded), data-message counts (payloads never read), disconnect →
//       LEFT + validated identity-free evidence envelope, consent withdrawal
//       mid-class → observer leaves + CANCELLED, bounded connect attempts →
//       FAILED with a bounded explanation, cancellation of an in-process run
//   S1 structured-only guarantees — token grants canSubscribe/canPublish/
//       canPublishData all false, hidden=false (VISIBLE), disclosed name +
//       metadata, transcriptionEnabled false everywhere
//   B1 bounds & recovery — global observer pool bound, stale-row recovery,
//       failure isolation (observer failure never mutates classroom rows)

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3d-'))
const isolatedUrl = `file:${join(dir, 'ci3d.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const {
  getObserverEligibility,
  dispatchObserverForSession,
  runObserverSession,
  cancelObserverSession,
  cancelObserverForSession,
  recoverStaleObserverSessions,
  observerRunPromise,
  observerEvidenceSchema,
  observerPoolMax,
  setObserverRoomFactoryForTests,
  OBSERVER_STATUS,
  OBSERVER_LEFT_REASON,
  OBSERVER_CONSENT_MODE,
  OBSERVER_PRESENCE_SAMPLE_MAX,
} = await import('@/lib/ci/fleet/observer')
const { grantCiConsent, withdrawCiConsent } = await import('@/lib/ci/trigger')
const {
  observerIdentity,
  observerVideoGrant,
  createObserverToken,
  OBSERVER_DISPLAY_NAME,
} = await import('@/lib/livekit/config')
const { studentIdFromIdentity } = await import('@/lib/livekit/live')

beforeAll(() => {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
  // The happy paths need LiveKit to be "configured" — token minting is local
  // (no network); the room itself is the injected fake.
  process.env.LIVEKIT_WS_URL = 'wss://observer-test.example'
  process.env.LIVEKIT_API_KEY = 'test-key'
  process.env.LIVEKIT_API_SECRET = 'test-secret'
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Fake room (the deterministic seam) ───────────────────────────────────────

class FakeObserverRoom {
  handlers = new Map<string, Set<() => void>>()
  count = 0
  disconnected = false
  on(name: string, handler: () => void): void {
    let set = this.handlers.get(name)
    if (!set) {
      set = new Set()
      this.handlers.set(name, set)
    }
    set.add(handler)
  }
  emit(name: string): void {
    for (const h of [...(this.handlers.get(name) ?? [])]) h()
  }
  remoteParticipantCount(): number {
    return this.count
  }
  async disconnect(): Promise<void> {
    if (this.disconnected) return
    this.disconnected = true
    this.emit('disconnected')
  }
}

let rooms: FakeObserverRoom[]
let lastToken: string | null
let failConnect: number

beforeEach((): void => {
  rooms = []
  lastToken = null
  failConnect = 0
  setObserverRoomFactoryForTests(async ({ token }: { wsUrl: string; token: string }) => {
    if (failConnect > 0) {
      failConnect--
      throw new Error('simulated provider outage')
    }
    lastToken = token
    const room = new FakeObserverRoom()
    rooms.push(room)
    return room as never
  })
})

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const HOUR = 3600_000

async function seedTeacherAndLiveClass(opts?: { verificationStatus?: string; liveStatus?: string | null }) {
  const teacher = await client.student.create({
    data: {
      id: `t-${Math.random().toString(36).slice(2, 10)}`,
      email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Observer Teacher',
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 3,
          verificationStatus: opts?.verificationStatus ?? 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Observer-eligible class',
      description: 'A class used to verify the observer adapter.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 2 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
    },
  })
  let liveId: string | null = null
  if (opts?.liveStatus !== null) {
    const live = await client.liveClassSession.create({
      data: {
        classSessionId: cls.id,
        roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
        status: opts?.liveStatus ?? 'LIVE',
        startedById: teacher.id,
        startedAt: new Date(Date.now() - 2 * HOUR),
        usageMonthKey: new Date().toISOString().slice(0, 7),
      },
    })
    liveId = live.id
  }
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id, liveId }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } }) // cascades everything
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 4000, stepMs = 10): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return false
}

async function rowOf(observerSessionId: string) {
  return client.classroomObserverSession.findUniqueOrThrow({ where: { id: observerSessionId } })
}

async function waitStatus(observerSessionId: string, status: string): Promise<boolean> {
  return waitFor(async () => (await rowOf(observerSessionId)).status === status)
}

// ─── EL1: eligibility matrix ──────────────────────────────────────────────────

describe('CI-3D observer eligibility (charter §11 Phase 0)', () => {
  test('unknown class → class_not_found', async () => {
    const e = await getObserverEligibility('does-not-exist')
    expect(e.ok).toBe(false)
    expect(e.reasons[0]).toBe('class_not_found')
    expect(e.checks.classFound).toBe(false)
  })

  test('class without a live session → no_live_session', async () => {
    const s = await seedTeacherAndLiveClass({ liveStatus: null })
    try {
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(false)
      expect(e.reasons[0]).toBe('no_live_session')
      expect(e.checks.liveFound).toBe(false)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('room not LIVE (READY) → room_not_live', async () => {
    const s = await seedTeacherAndLiveClass({ liveStatus: 'READY' })
    try {
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(false)
      expect(e.reasons[0]?.startsWith('room_not_live')).toBe(true)
      expect(e.checks.roomLive).toBe(false)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('unapproved teacher → teacher_not_authorised', async () => {
    const s = await seedTeacherAndLiveClass({ verificationStatus: 'PENDING' })
    try {
      await grantCiConsent(s.teacherId)
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(false)
      expect(e.reasons[0]).toBe('teacher_not_authorised')
      expect(e.checks.teacherAuthorised).toBe(false)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('no CI consent → no_consent (consent gates everything, §5/§9)', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(false)
      expect(e.reasons[0]).toBe('no_consent')
      expect(e.checks.consentCurrent).toBe(false)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('already observing (non-terminal row on the room) → already_observing', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      expect(d.dispatched).toBe(true)
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(false)
      expect(e.reasons[0]).toBe('already_observing')
      expect(e.checks.notAlreadyObserving).toBe(false)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('a terminal (LEFT) row does not block a fresh explicit dispatch', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      expect(d.dispatched).toBe(true)
      await client.classroomObserverSession.update({
        where: { id: (d as { observerSessionId: string }).observerSessionId },
        data: { status: OBSERVER_STATUS.LEFT, leftReason: OBSERVER_LEFT_REASON.ROOM_CLOSED, leftAt: new Date() },
      })
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(true)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('pool at capacity → observer_capacity_full (bounded pool, §4.3)', async () => {
    const prev = process.env.BEAN_CI_OBSERVER_MAX_ACTIVE
    process.env.BEAN_CI_OBSERVER_MAX_ACTIVE = '1'
    const a = await seedTeacherAndLiveClass()
    const b = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(a.teacherId)
      await grantCiConsent(b.teacherId)
      const first = await dispatchObserverForSession({ classSessionId: a.classId, dispatchedBy: a.teacherId, startRun: false })
      expect(first.dispatched).toBe(true)
      expect(observerPoolMax()).toBe(1)
      const second = await getObserverEligibility(b.classId)
      expect(second.ok).toBe(false)
      expect(second.reasons[0]?.startsWith('observer_capacity_full')).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.BEAN_CI_OBSERVER_MAX_ACTIVE
      else process.env.BEAN_CI_OBSERVER_MAX_ACTIVE = prev
      await cleanupTeacher(a.teacherId)
      await cleanupTeacher(b.teacherId)
    }
  })

  test('LiveKit not configured → livekit_not_configured (honest failure, never a fake join)', async () => {
    const saved = {
      ws: process.env.LIVEKIT_WS_URL,
      key: process.env.LIVEKIT_API_KEY,
      secret: process.env.LIVEKIT_API_SECRET,
    }
    delete process.env.LIVEKIT_WS_URL
    delete process.env.LIVEKIT_API_KEY
    delete process.env.LIVEKIT_API_SECRET
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const e = await getObserverEligibility(s.classId)
      expect(e.ok).toBe(false)
      expect(e.reasons[0]).toBe('livekit_not_configured')
      expect(e.checks.livekitConfigured).toBe(false)
    } finally {
      process.env.LIVEKIT_WS_URL = saved.ws
      process.env.LIVEKIT_API_KEY = saved.key
      process.env.LIVEKIT_API_SECRET = saved.secret
      await cleanupTeacher(s.teacherId)
    }
  })
})

// ─── D1: dispatch ─────────────────────────────────────────────────────────────

describe('CI-3D observer dispatch (explicit, durable, one per room)', () => {
  test('happy dispatch creates the row with honest defaults and never a student identity', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      expect(d.dispatched).toBe(true)
      const row = await rowOf((d as { observerSessionId: string }).observerSessionId)
      expect(row.status).toBe(OBSERVER_STATUS.PLANNED)
      expect(row.liveClassSessionId).toBe(s.liveId)
      expect(row.roomName.startsWith('bean-live-')).toBe(true)
      expect(row.observerIdentity).toBe(observerIdentity(row.id))
      expect(row.observerIdentity.startsWith('bean-observer:')).toBe(true)
      // The observer is never a "bean:" student identity — the webhook and the
      // attendance accounting must never count it as a participant.
      expect(studentIdFromIdentity(row.observerIdentity)).toBeNull()
      expect(row.consentMode).toBe(OBSERVER_CONSENT_MODE.STRUCTURED_ONLY)
      expect(row.transcriptionEnabled).toBe(false)
      expect(row.canPublishMedia).toBe(false)
      expect(row.maxAttempts).toBe(5)
      const snapshot = JSON.parse(row.eligibilityJson ?? '{}') as { checks: Record<string, boolean>; consentMode: string }
      expect(snapshot.consentMode).toBe(OBSERVER_CONSENT_MODE.STRUCTURED_ONLY)
      expect(snapshot.checks.consentCurrent).toBe(true)
      expect(snapshot.checks.roomLive).toBe(true)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('consent withdrawn between dispatch and connect → CANCELLED before joining', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      await withdrawCiConsent(s.teacherId)
      await runObserverSession(observerId)
      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.CANCELLED)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.CONSENT_WITHDRAWN)
      expect(rooms.length).toBe(0) // the observer never joined the room
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('dispatch startRun registers the run and reaches OBSERVING with the fake room', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      expect(await waitStatus(observerId, OBSERVER_STATUS.OBSERVING)).toBe(true)
      expect(rooms.length).toBe(1)
      expect(lastToken).toBeTruthy()
      const row = await rowOf(observerId)
      expect(row.connectedAt).not.toBeNull()
      // cancel the in-process run deterministically and await its promise
      expect(await cancelObserverSession(observerId, OBSERVER_LEFT_REASON.TEACHER_CANCELLED)).toBe(true)
      await observerRunPromise(observerId)
      const done = await rowOf(observerId)
      expect(done.status).toBe(OBSERVER_STATUS.CANCELLED)
      expect(done.leftReason).toBe(OBSERVER_LEFT_REASON.TEACHER_CANCELLED)
      expect(rooms[0].disconnected).toBe(true)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })
})

// ─── R1: runtime lifecycle ────────────────────────────────────────────────────

describe('CI-3D observer runtime (fake room seam)', () => {
  test('connect → OBSERVING → aggregate samples, data counts, disconnect → LEFT with valid evidence', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId

      // whiteboard structure signal (structure only — version count)
      await client.liveWhiteboardState.create({
        data: {
          liveClassSessionId: s.liveId as string,
          snapshotJson: '{"version":1}',
          version: 7,
          updatedById: s.teacherId,
        },
      })

      const runP = runObserverSession(observerId)
      expect(await waitStatus(observerId, OBSERVER_STATUS.OBSERVING)).toBe(true)
      const room = rooms[0]

      // two participants join, one leaves — aggregate counts only
      room.count = 2
      room.emit('participant_connected')
      room.count = 1
      room.emit('participant_disconnected')
      // data messages: counted, payloads never read
      room.emit('data_received')
      room.emit('data_received')
      room.emit('data_received')

      // a real reconnect cycle
      room.emit('reconnecting')
      room.emit('reconnected')

      room.disconnect()
      await runP

      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.LEFT)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.ROOM_CLOSED)
      expect(row.reconnectCount).toBe(1)
      expect(row.evidenceJson).toBeTruthy()

      const evidence = JSON.parse(row.evidenceJson as string) as Record<string, unknown>
      const parsed = observerEvidenceSchema.safeParse(evidence)
      expect(parsed.success).toBe(true)
      expect(evidence.consentMode).toBe(OBSERVER_CONSENT_MODE.STRUCTURED_ONLY)
      expect(evidence.transcriptionEnabled).toBe(false)
      expect(evidence.reconnectCount).toBe(1)
      expect(evidence.dataMessageCount).toBe(3)
      expect(evidence.whiteboardSnapshotVersion).toBe(7)
      const samples = evidence.presenceSamples as { participantCount: number }[]
      expect(samples.length).toBeGreaterThanOrEqual(2)
      // identity-free evidence: no student identity ever appears
      expect(row.evidenceJson as string).not.toContain('"bean:')
      const gaps = evidence.evidenceGaps as { reason: string }[]
      expect(gaps.length).toBe(1)
      expect(gaps[0].reason).toContain('reconnecting')
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('consent withdrawn mid-class → the observer leaves immediately and cancels', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      const runP = runObserverSession(observerId, { heartbeatMs: 25 })
      expect(await waitStatus(observerId, OBSERVER_STATUS.OBSERVING)).toBe(true)

      await withdrawCiConsent(s.teacherId)
      expect(await waitStatus(observerId, OBSERVER_STATUS.CANCELLED)).toBe(true)
      await runP

      const row = await rowOf(observerId)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.CONSENT_WITHDRAWN)
      expect(rooms[0].disconnected).toBe(true)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('bounded connect attempts → FAILED with a bounded, honest explanation', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      await client.classroomObserverSession.update({ where: { id: observerId }, data: { maxAttempts: 2 } })
      failConnect = 5 // every attempt fails
      await runObserverSession(observerId, { backoffMs: 1 })
      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.FAILED)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.CONNECTION_FAILED)
      expect(row.attempts).toBe(2)
      expect(row.error).toContain('could not connect after 2 attempt(s)')
      expect(row.error!.length).toBeLessThanOrEqual(500)
      expect(rooms.length).toBe(0)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('live session no longer LIVE when the run starts → CANCELLED session_ended', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      await client.liveClassSession.update({ where: { id: s.liveId as string }, data: { status: 'ENDED' } })
      await runObserverSession(observerId)
      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.CANCELLED)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.SESSION_ENDED)
      expect(rooms.length).toBe(0)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('cancelObserverForSession services a non-registered row directly (other process)', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      const n = await cancelObserverForSession(s.classId, OBSERVER_LEFT_REASON.SESSION_ENDED)
      expect(n).toBe(1)
      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.CANCELLED)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.SESSION_ENDED)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })
})

// ─── S1: structured-only guarantees ───────────────────────────────────────────

describe('CI-3D observer structured-only guarantees', () => {
  test('token grants are least-privilege and VISIBLE (audit surface)', () => {
    const grant = observerVideoGrant('bean-live-test')
    expect(grant.roomJoin).toBe(true)
    expect(grant.canSubscribe).toBe(false) // receives no media at all
    expect(grant.canPublish).toBe(false) // never publishes
    expect(grant.canPublishData).toBe(false) // never sends data
    expect(grant.roomAdmin).toBe(false)
    expect(grant.roomCreate).toBe(false)
    expect(grant.roomRecord).toBe(false)
    expect(grant.hidden).toBe(false) // visible — disclosed presence (§10.1)
  })

  test('minted token carries the fixed grants, the disclosed name and the disclosure metadata', async () => {
    const token = await createObserverToken({
      identity: 'bean-observer:tokentest',
      room: 'bean-live-tokentest',
      ttlSeconds: 600,
      metadata: JSON.stringify({ disclosure: 'structured observation only; no audio or video is processed' }),
    })
    const payloadB64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) as {
      sub?: string
      name?: string
      metadata?: string
      video?: Record<string, unknown>
    }
    expect(payload.sub).toBe('bean-observer:tokentest')
    expect(payload.name).toBe(OBSERVER_DISPLAY_NAME)
    expect(payload.metadata).toContain('no audio or video')
    expect(payload.video?.canPublish).toBe(false)
    expect(payload.video?.canPublishData).toBe(false)
    expect(payload.video?.canSubscribe).toBe(false)
    expect(payload.video?.hidden).toBe(false)
    expect(payload.video?.roomJoin).toBe(true)
  })

  test('the evidence contract hard-codes structured-only (no silent consent downgrade, §9.2)', () => {
    const bad = {
      consentMode: 'AUDIO', // any other mode is contract-invalid in CI-3D
      transcriptionEnabled: false,
      observerIdentity: 'bean-observer:x',
      roomName: 'bean-live-x',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      connectedSeconds: 0,
      reconnectCount: 0,
      presenceSamples: [],
      evidenceGaps: [],
      dataMessageCount: 0,
      whiteboardSnapshotVersion: 0,
    }
    expect(observerEvidenceSchema.safeParse(bad).success).toBe(false)
    const badTranscription = { ...bad, consentMode: OBSERVER_CONSENT_MODE.STRUCTURED_ONLY, transcriptionEnabled: true }
    expect(observerEvidenceSchema.safeParse(badTranscription).success).toBe(false)
  })

  test('presence samples are bounded (charter §6 data minimisation)', () => {
    const base = {
      consentMode: OBSERVER_CONSENT_MODE.STRUCTURED_ONLY,
      transcriptionEnabled: false,
      observerIdentity: 'bean-observer:x',
      roomName: 'bean-live-x',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      connectedSeconds: 0,
      reconnectCount: 0,
      presenceSamples: Array.from({ length: OBSERVER_PRESENCE_SAMPLE_MAX + 1 }, () => ({
        at: new Date().toISOString(),
        participantCount: 0,
      })),
      evidenceGaps: [],
      dataMessageCount: 0,
      whiteboardSnapshotVersion: 0,
    }
    expect(observerEvidenceSchema.safeParse(base).success).toBe(false)
  })
})

// ─── B1: bounds & recovery & failure isolation ────────────────────────────────

describe('CI-3D observer bounds, recovery and failure isolation', () => {
  test('stale rows are recovered honestly; fresh rows are untouched', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      // Make the row stale: no heartbeat, no recent write, still non-terminal.
      await client.classroomObserverSession.update({
        where: { id: observerId },
        data: {
          createdAt: new Date(Date.now() - 10 * 60_000),
          updatedAt: new Date(Date.now() - 10 * 60_000),
        },
      })
      const recovered = await recoverStaleObserverSessions()
      expect(recovered).toBeGreaterThanOrEqual(1)
      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.FAILED)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.SERVER_RESTART)
      expect(row.error).toBeTruthy()
      // A fresh row survives recovery.
      const d2 = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      expect(d2.dispatched).toBe(true)
      const recovered2 = await recoverStaleObserverSessions()
      expect(recovered2).toBe(0)
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })

  test('failure isolation: a failed observer never mutates the classroom rows (criterion 6)', async () => {
    const s = await seedTeacherAndLiveClass()
    try {
      await grantCiConsent(s.teacherId)
      const before = await client.liveClassSession.findUniqueOrThrow({ where: { id: s.liveId as string } })
      const d = await dispatchObserverForSession({ classSessionId: s.classId, dispatchedBy: s.teacherId, startRun: false })
      const observerId = (d as { observerSessionId: string }).observerSessionId
      await client.classroomObserverSession.update({ where: { id: observerId }, data: { maxAttempts: 1 } })
      failConnect = 3
      await runObserverSession(observerId, { backoffMs: 1 })
      const row = await rowOf(observerId)
      expect(row.status).toBe(OBSERVER_STATUS.FAILED)
      const after = await client.liveClassSession.findUniqueOrThrow({ where: { id: s.liveId as string } })
      expect(after.status).toBe(before.status)
      expect(after.usageFinalisedAt).toBeNull()
      const cls = await client.classSession.findUniqueOrThrow({ where: { id: s.classId } })
      expect(cls.status).toBe('PUBLISHED')
    } finally {
      await cleanupTeacher(s.teacherId)
    }
  })
})
