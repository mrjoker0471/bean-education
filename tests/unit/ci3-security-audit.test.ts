// ─── CI-3H tests: role-based access + privacy audit (isolated real DB) ────────
//   A1  observer route RBAC — unauthenticated 401; non-owner 404; owner
//       golden path through the REAL route (dispatch → GET → DELETE); honest
//       409/503 states; DELETE with nothing attached 409
//   P1  privacy sweep — every persisted fleet/observer output for a drained
//       session is identity-free (no "bean:" student identities anywhere);
//       the observer evidence envelope carries no payload fields
//   L1  load/recovery benchmark exists, runs and satisfies its terminal
//       invariants (spawned as a subprocess against an isolated DB)

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3h-'))
const isolatedUrl = `file:${join(dir, 'ci3h.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const authState = { student: null as unknown }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

const observerRoute = await import('@/app/api/teach/classes/[id]/live/observer/route')
const { dispatchFleetForSession } = await import('@/lib/ci/fleet/dispatcher')
const {
  setObserverRoomFactoryForTests: setRoomFactory,
  dispatchObserverForSession,
  cancelObserverSession,
  observerRunPromise,
  OBSERVER_STATUS,
  OBSERVER_LEFT_REASON,
} = await import('@/lib/ci/fleet/observer')
const { claimNextFleetTask, runFleetTask } = await import('@/lib/ci/fleet/worker')
const { grantCiConsent } = await import('@/lib/ci/trigger')
const { registerFleetRuntime } = await import('@/lib/ci/fleet/runtime')
const { setCiModelAdapterForProcess, resetCiModelAdapterForTests } = await import('@/lib/ci/model-adapter')

beforeAll(() => {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
  registerFleetRuntime()
  process.env.LIVEKIT_WS_URL = 'wss://audit-test.example'
  process.env.LIVEKIT_API_KEY = 'audit-key'
  process.env.LIVEKIT_API_SECRET = 'audit-secret'
})

afterAll(async () => {
  setRoomFactory(null)
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

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
beforeEach(() => {
  rooms = []
  setRoomFactory(async () => {
    const room = new FakeObserverRoom()
    rooms.push(room)
    return room as never
  })
})

const HOUR = 3600_000

async function seedClass(opts?: { liveStatus?: string }) {
  const teacher = await client.student.create({
    data: {
      id: `t-${Math.random().toString(36).slice(2, 10)}`,
      email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Audit Teacher',
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 3,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  const other = await client.student.create({
    data: {
      id: `o-${Math.random().toString(36).slice(2, 10)}`,
      email: `o-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Other Teacher',
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 1,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Audit class',
      description: 'd',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 2 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
      liveSession: {
        create: {
          roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
          status: opts?.liveStatus ?? 'LIVE',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: opts?.liveStatus === 'ENDED' ? new Date(Date.now() - 1 * HOUR) : null,
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  return { teacherId: teacher.id, otherId: other.id, profileId: profile.id, classId: cls.id }
}

async function cleanup(teacherId: string, otherId: string) {
  await client.student.deleteMany({ where: { id: { in: [teacherId, otherId] } } })
}

function req(method: string, classId: string) {
  return new Request(`http://localhost/api/teach/classes/${classId}/live/observer`, { method }) as unknown as Parameters<typeof observerRoute.POST>[0]
}

// ─── A1: observer route RBAC ──────────────────────────────────────────────────

describe('CI-3H observer route RBAC (A1)', () => {
  test('A1.1 unauthenticated → 401 on GET/POST/DELETE (no observer action without a session)', async () => {
    const seeded = await seedClass()
    try {
      authState.student = null
      const g = await observerRoute.GET(req('GET', seeded.classId), { params: Promise.resolve({ id: seeded.classId }) })
      const p = await observerRoute.POST(req('POST', seeded.classId), { params: Promise.resolve({ id: seeded.classId }) })
      const d = await observerRoute.DELETE(req('DELETE', seeded.classId), { params: Promise.resolve({ id: seeded.classId }) })
      expect(g.status).toBe(401)
      expect(p.status).toBe(401)
      expect(d.status).toBe(401)
    } finally {
      await cleanup(seeded.teacherId, seeded.otherId)
    }
  })

  test('A1.2 a non-owner approved teacher gets 404 (ownership scoped, not enumerable)', async () => {
    const seeded = await seedClass()
    try {
      await grantCiConsent(seeded.otherId)
      authState.student = await client.student.findUniqueOrThrow({ where: { id: seeded.otherId } })
      const res = await observerRoute.POST(req('POST', seeded.classId), { params: Promise.resolve({ id: seeded.classId }) })
      expect(res.status).toBe(404)
      const g = await observerRoute.GET(req('GET', seeded.classId), { params: Promise.resolve({ id: seeded.classId }) })
      expect(g.status).toBe(404)
    } finally {
      authState.student = null
      await cleanup(seeded.teacherId, seeded.otherId)
    }
  })

  test('A1.3 honest states through the real route: not-live 409, unconfigured 503, golden path 200 → DELETE', async () => {
    const seeded = await seedClass({ liveStatus: 'ENDED' })
    try {
      await grantCiConsent(seeded.teacherId)
      authState.student = await client.student.findUniqueOrThrow({ where: { id: seeded.teacherId } })

      // ended room → 409 room_not_live
      const ended = await observerRoute.POST(req('POST', seeded.classId), { params: Promise.resolve({ id: seeded.classId }) })
      expect(ended.status).toBe(409)
      const endedBody = (await ended.json()) as { reason?: string }
      expect(endedBody.reason).toBe('room_not_live')

      // live room but provider unconfigured → 503
      const saved = process.env.LIVEKIT_WS_URL
      delete process.env.LIVEKIT_WS_URL
      const live = await seedClass({ liveStatus: 'LIVE' })
      await grantCiConsent(live.teacherId)
      authState.student = await client.student.findUniqueOrThrow({ where: { id: live.teacherId } })
      try {
        const unconfigured = await observerRoute.POST(req('POST', live.classId), { params: Promise.resolve({ id: live.classId }) })
        expect(unconfigured.status).toBe(503)
        const unBody = (await unconfigured.json()) as { reason?: string }
        expect(unBody.reason).toBe('livekit_not_configured')
      } finally {
        process.env.LIVEKIT_WS_URL = saved
        await cleanup(live.teacherId, live.otherId)
      }

      // golden path: LIVE + configured → 200, OBSERVING; GET reflects it; DELETE leaves
      const golden = await seedClass({ liveStatus: 'LIVE' })
      await grantCiConsent(golden.teacherId)
      authState.student = await client.student.findUniqueOrThrow({ where: { id: golden.teacherId } })
      const dispatch = await observerRoute.POST(req('POST', golden.classId), { params: Promise.resolve({ id: golden.classId }) })
      expect(dispatch.status).toBe(200)
      const dBody = (await dispatch.json()) as { observer?: { status: string; transcriptionEnabled: boolean; canPublishMedia: boolean } }
      expect(dBody.observer?.status).toBe(OBSERVER_STATUS.OBSERVING)
      expect(dBody.observer?.transcriptionEnabled).toBe(false)
      expect(dBody.observer?.canPublishMedia).toBe(false)

      const status = await observerRoute.GET(req('GET', golden.classId), { params: Promise.resolve({ id: golden.classId }) })
      expect(status.status).toBe(200)
      const sBody = (await status.json()) as { observer?: { status: string } | null }
      expect(sBody.observer?.status).toBe(OBSERVER_STATUS.OBSERVING)

      const del = await observerRoute.DELETE(req('DELETE', golden.classId), { params: Promise.resolve({ id: golden.classId }) })
      expect(del.status).toBe(200)
      const row = await client.classroomObserverSession.findFirstOrThrow({ where: { classSessionId: golden.classId } })
      expect(row.status).toBe(OBSERVER_STATUS.CANCELLED)
      expect(row.leftReason).toBe(OBSERVER_LEFT_REASON.TEACHER_CANCELLED)
      expect(rooms[0]?.disconnected).toBe(true)

      // DELETE again → 409 (nothing attached)
      const del2 = await observerRoute.DELETE(req('DELETE', golden.classId), { params: Promise.resolve({ id: golden.classId }) })
      expect(del2.status).toBe(409)
      await cleanup(golden.teacherId, golden.otherId)
    } finally {
      authState.student = null
      await cleanup(seeded.teacherId, seeded.otherId)
    }
  })
})

// ─── P1: privacy sweep ────────────────────────────────────────────────────────

describe('CI-3H privacy sweep (P1)', () => {
  test('P1.1 every persisted fleet + observer output for a drained session is identity-free', async () => {
    const seeded = await seedClass({ liveStatus: 'ENDED' })
    try {
      await grantCiConsent(seeded.teacherId)
      // observer attach on the LIVE room + graceful cancel through its own run
      // → finalisation writes the evidence envelope
      const liveId = (await client.liveClassSession.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })).id
      await client.liveClassSession.update({ where: { id: liveId }, data: { status: 'LIVE', usageFinalisedAt: null } })
      const d = await dispatchObserverForSession({ classSessionId: seeded.classId, dispatchedBy: seeded.teacherId })
      expect(d.dispatched).toBe(true)
      const observerId = (d as { observerSessionId: string }).observerSessionId
      expect(await (async () => {
        for (let i = 0; i < 100; i++) {
          const row = await client.classroomObserverSession.findUniqueOrThrow({ where: { id: observerId } })
          if (row.status === OBSERVER_STATUS.OBSERVING) return true
          await new Promise((r) => setTimeout(r, 10))
        }
        return false
      })()).toBe(true)
      await cancelObserverSession(observerId, OBSERVER_LEFT_REASON.SESSION_ENDED)
      const runP = observerRunPromise(observerId)
      if (runP) await runP

      // fleet drain on the TERMINAL session (no adapter → honest
      // abstentions/failures, but persisted envelopes)
      setCiModelAdapterForProcess(null)
      await client.liveClassSession.update({ where: { id: liveId }, data: { status: 'ENDED' } })
      await dispatchFleetForSession({ classSessionId: seeded.classId, dispatchedBy: seeded.teacherId })
      for (let i = 0; i < 60; i++) {
        const task = await claimNextFleetTask()
        if (!task) break
        await runFleetTask(task)
      }

      // sweep every persisted output: no "bean:<id>" student identity anywhere
      const fleetRows = await client.classroomFleetTask.findMany({ where: { classSessionId: seeded.classId }, select: { outputJson: true, error: true } })
      for (const row of fleetRows) {
        if (row.outputJson) expect(row.outputJson).not.toContain('"bean:')
        if (row.error) expect(row.error).not.toContain('"bean:')
      }
      const observerRow = await client.classroomObserverSession.findUniqueOrThrow({ where: { id: observerId } })
      expect(observerRow.observerIdentity.startsWith('bean-observer:')).toBe(true)
      if (observerRow.evidenceJson) {
        expect(observerRow.evidenceJson).not.toContain('"bean:')
        const evidence = JSON.parse(observerRow.evidenceJson) as Record<string, unknown>
        // the envelope carries ONLY the allowed structural fields
        const allowed = new Set([
          'consentMode', 'transcriptionEnabled', 'observerIdentity', 'roomName', 'startedAt', 'finishedAt',
          'connectedSeconds', 'reconnectCount', 'presenceSamples', 'evidenceGaps', 'dataMessageCount', 'whiteboardSnapshotVersion',
        ])
        for (const key of Object.keys(evidence)) expect(allowed.has(key)).toBe(true)
        expect(evidence.transcriptionEnabled).toBe(false)
        expect(evidence.consentMode).toBe('STRUCTURED_ONLY')
      }
    } finally {
      resetCiModelAdapterForTests()
      await cleanup(seeded.teacherId, seeded.otherId)
    }
  })
})

// ─── L1: load/recovery benchmark ──────────────────────────────────────────────

describe('CI-3H load/recovery benchmark (L1)', () => {
  test('L1.1 the benchmark runs green and satisfies its terminal invariants', () => {
    const run = spawnSync('bun', ['scripts/ci3-load-benchmark.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: 'file:/tmp/ci3-load-audit.db' },
      timeout: 240_000,
      encoding: 'utf8',
    })
    const out = run.stdout + run.stderr
    expect(run.status).toBe(0)
    expect(out.includes('INVARIANT FAIL')).toBe(false)
    expect(out).toContain('tasks claimed+run')
    expect(out).toContain('lease recovery')
  }, 300_000)
})
