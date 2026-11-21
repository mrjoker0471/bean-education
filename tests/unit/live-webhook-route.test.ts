// ─── BEAN Live Classroom (Phase 5): webhook receiver — signature & idempotency ─
// Uses the REAL WebhookReceiver (valid JWT with sha256 body digest signed by
// the test credentials) against the real route module with a fake db:
//   • valid signature accepted / invalid signature rejected / missing rejected
//   • providerEventId dedupe — no repeated accounting
//   • duplicate join while connected → no second interval; duplicate left →
//     no double subtraction; reconnection opens a new interval
//   • out-of-order events never create negative durations
//   • room_finished closes open intervals and finalises usage exactly once
//   • unknown rooms are recorded as SKIPPED without mutating other sessions

import { describe, it, expect, mock, beforeEach, beforeAll } from 'bun:test'
import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { AccessToken } from 'livekit-server-sdk'

const API_KEY = 'test-key'
const API_SECRET = 'test-secret-for-webhook-signing'

interface FakeLive {
  id: string
  classSessionId: string
  roomName: string
  status: string
  startedAt: Date | null
  endedAt: Date | null
  startedById: string
  reservedParticipantMinutes: number
  actualParticipantMinutes: number | null
  usageFinalisedAt: Date | null
  usageMonthKey: string
  participants: FakeParticipant[]
}

interface FakeParticipant {
  id: string
  studentId: string
  participantIdentity: string
  participantRole: string
  firstJoinedAt: Date | null
  activeSince: Date | null
  lastLeftAt: Date | null
  totalConnectedSeconds: number
  reconnectCount: number
}

const state = {
  lives: new Map<string, FakeLive>(), // by roomName
  webhookEvents: new Map<string, { providerEventId: string; eventName: string; roomName: string; processingStatus: string; errorCode: string | null }>(),
  reconciles: [] as { reserved: number; actual: number; monthKey: string }[],
}

function resetState() {
  state.lives.clear()
  state.webhookEvents.clear()
  state.reconciles = []
  state.lives.set('bean-live-wh', {
    id: 'live-1',
    classSessionId: 'c1',
    roomName: 'bean-live-wh',
    status: 'LIVE',
    startedAt: new Date(Date.now() - 600_000),
    endedAt: null,
    startedById: 'teacher-1',
    reservedParticipantMinutes: 120,
    actualParticipantMinutes: null,
    usageFinalisedAt: null,
    usageMonthKey: '2026-11',
    participants: [],
  })
}

const fakeDb = {
  liveClassSession: {
    findUnique: async ({ where }: { where: { roomName?: string; id?: string } }) => {
      const row = where.roomName ? state.lives.get(where.roomName) : where.id ? [...state.lives.values()].find((l) => l.id === where.id) : null
      if (!row) return null
      return { ...row, participants: [...row.participants] }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...state.lives.values()].find((l) => l.id === where.id)
      if (!row) throw new Error('live not found')
      Object.assign(row, data)
      return { ...row }
    },
  },
  liveClassParticipant: {
    findMany: async ({ where }: { where: { liveClassSessionId: string } }) => {
      const row = [...state.lives.values()].find((l) => l.id === where.liveClassSessionId)
      return row ? [...row.participants] : []
    },
    findUnique: async ({ where }: { where: { liveClassSessionId_participantIdentity: { liveClassSessionId: string; participantIdentity: string } } }) => {
      const row = [...state.lives.values()].find((l) => l.id === where.liveClassSessionId_participantIdentity.liveClassSessionId)
      const p = row?.participants.find((p) => p.participantIdentity === where.liveClassSessionId_participantIdentity.participantIdentity)
      return p ? { ...p } : null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = [...state.lives.values()].find((l) => l.id === data.liveClassSessionId)
      if (!row) throw new Error('live not found')
      const p: FakeParticipant = {
        id: `p-${row.participants.length + 1}`,
        studentId: String(data.studentId),
        participantIdentity: String(data.participantIdentity),
        participantRole: String(data.participantRole),
        firstJoinedAt: (data.firstJoinedAt as Date) ?? null,
        activeSince: (data.activeSince as Date) ?? null,
        lastLeftAt: (data.lastLeftAt as Date) ?? null,
        totalConnectedSeconds: Number(data.totalConnectedSeconds ?? 0),
        reconnectCount: Number(data.reconnectCount ?? 0),
      }
      row.participants.push(p)
      return { ...p }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...state.lives.values()].find((l) => l.participants.some((p) => p.id === where.id))
      const p = row?.participants.find((p) => p.id === where.id)
      if (!p) throw new Error('participant not found')
      Object.assign(p, data)
      return { ...p }
    },
  },
  liveKitWebhookEvent: {
    findUnique: async ({ where }: { where: { providerEventId: string } }) => state.webhookEvents.get(where.providerEventId) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (state.webhookEvents.has(String(data.providerEventId))) {
        const err = new Error('Unique constraint failed') as Error & { code?: string }
        err.code = 'P2002'
        throw err
      }
      const row = { providerEventId: String(data.providerEventId), eventName: String(data.eventName), roomName: String(data.roomName), processingStatus: 'PROCESSED', errorCode: null as string | null }
      state.webhookEvents.set(row.providerEventId, row)
      return row
    },
    update: async ({ where, data }: { where: { providerEventId: string }; data: Record<string, unknown> }) => {
      const row = state.webhookEvents.get(where.providerEventId)
      if (!row) throw new Error('webhook event not found')
      if (data.processingStatus !== undefined) row.processingStatus = String(data.processingStatus)
      if (data.errorCode !== undefined) row.errorCode = (data.errorCode as string | null) ?? null
      return row
    },
  },
  $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
    if (sql.includes('UPDATE "LiveUsageMonth" SET') && sql.includes('"usedParticipantMinutes"')) {
      state.reconciles.push({ reserved: Number(params[0]), actual: Number(params[1]), monthKey: String(params[3]) })
      return 1
    }
    throw new Error(`unexpected raw SQL: ${sql.slice(0, 60)}`)
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

const webhookRoute = await import('@/app/api/webhooks/livekit/route')

beforeAll(() => {
  process.env.LIVEKIT_WS_URL = 'wss://bean-test.livekit.cloud'
  process.env.LIVEKIT_API_KEY = API_KEY
  process.env.LIVEKIT_API_SECRET = API_SECRET
})

function signedHeader(rawBody: string, room = 'bean-live-wh'): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity: 'livekit-webhook', ttl: 60 })
  token.sha256 = createHash('sha256').update(rawBody).digest('base64')
  void room
  return token.toJwt()
}

function webhookReq(rawBody: string, authHeader?: string): NextRequest {
  const headers = new Headers()
  if (authHeader !== undefined) headers.set('authorization', authHeader)
  return new Request('http://localhost/api/webhooks/livekit', { method: 'POST', headers, body: rawBody }) as unknown as NextRequest
}

function eventBody(input: { id: string; event: string; room: string; createdAtSec?: number; identity?: string }): string {
  // LiveKit serialises protobuf Timestamps as RFC 3339 strings in webhook JSON.
  const createdAt = new Date((input.createdAtSec ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
  return JSON.stringify({
    id: input.id,
    event: input.event,
    room: { name: input.room },
    createdAt,
    ...(input.identity ? { participant: { identity: input.identity } } : {}),
  })
}

function participantRow(identity: string) {
  const live = state.lives.get('bean-live-wh')!
  return live.participants.find((p) => p.participantIdentity === identity)
}

describe('POST /api/webhooks/livekit', () => {
  beforeEach(resetState)

  it('a valid signature is accepted and participant_joined opens one interval', async () => {
    const raw = eventBody({ id: 'evt-1', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-9' })
    const res = await webhookRoute.POST(webhookReq(raw, await signedHeader(raw)))
    expect(res.status).toBe(200)
    const p = participantRow('bean:student-9')!
    expect(p.activeSince).not.toBeNull()
    expect(p.firstJoinedAt).not.toBeNull()
    expect(p.reconnectCount).toBe(0)
  })

  it('a signed Bearer header is accepted too', async () => {
    const raw = eventBody({ id: 'evt-bearer', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-9' })
    const res = await webhookRoute.POST(webhookReq(raw, `Bearer ${await signedHeader(raw)}`))
    expect(res.status).toBe(200)
  })

  it('an invalid signature is rejected (401)', async () => {
    const raw = eventBody({ id: 'evt-bad', event: 'room_started', room: 'bean-live-wh' })
    // Signed by a DIFFERENT secret → verifier must refuse.
    const rogue = new AccessToken(API_KEY, 'a-completely-different-secret-value', { identity: 'rogue', ttl: 60 })
    rogue.sha256 = createHash('sha256').update(raw).digest('base64')
    const res = await webhookRoute.POST(webhookReq(raw, await rogue.toJwt()))
    expect(res.status).toBe(401)
    expect(participantRow('bean:student-9')).toBeUndefined()
  })

  it('a body/tampered after signing is rejected (401)', async () => {
    const signed = eventBody({ id: 'evt-tamper', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-9' })
    const tampered = signed.replace('student-9', 'student-HACKED')
    const res = await webhookRoute.POST(webhookReq(tampered, await signedHeader(signed)))
    expect(res.status).toBe(401)
  })

  it('a missing signature header is rejected (401)', async () => {
    const raw = eventBody({ id: 'evt-noauth', event: 'room_started', room: 'bean-live-wh' })
    const res = await webhookRoute.POST(webhookReq(raw, undefined))
    expect(res.status).toBe(401)
  })

  it('a duplicate event id is ignored safely — no repeated accounting', async () => {
    const raw = eventBody({ id: 'evt-dup', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-9', createdAtSec: Math.floor(Date.now() / 1000) - 60 })
    await webhookRoute.POST(webhookReq(raw, await signedHeader(raw)))
    const first = participantRow('bean:student-9')!
    expect(first.activeSince).not.toBeNull()
    // Same event delivered again (LiveKit retries) — must be a no-op.
    const res = await webhookRoute.POST(webhookReq(raw, await signedHeader(raw)))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicate).toBe(true)
    const second = participantRow('bean:student-9')!
    expect(second.activeSince!.getTime()).toBe(first.activeSince!.getTime()) // interval NOT replaced
    expect(second.reconnectCount).toBe(0)
  })

  it('duplicate participant_left cannot double-subtract; reconnection accumulates time', async () => {
    const t = Math.floor(Date.now() / 1000)
    const join = eventBody({ id: 'evt-j', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-9', createdAtSec: t - 120 })
    await webhookRoute.POST(webhookReq(join, await signedHeader(join)))
    const leave = eventBody({ id: 'evt-l', event: 'participant_left', room: 'bean-live-wh', identity: 'bean:student-9', createdAtSec: t - 60 })
    await webhookRoute.POST(webhookReq(leave, await signedHeader(leave)))
    let p = participantRow('bean:student-9')!
    const firstSpan = p.totalConnectedSeconds
    expect(firstSpan).toBeGreaterThan(0)
    // Redelivered leave — no double subtraction.
    await webhookRoute.POST(webhookReq(leave, await signedHeader(leave)))
    p = participantRow('bean:student-9')!
    expect(p.totalConnectedSeconds).toBe(firstSpan)
    // Reconnect opens a NEW interval and counts the reconnection.
    const rejoin = eventBody({ id: 'evt-r', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-9', createdAtSec: t - 30 })
    await webhookRoute.POST(webhookReq(rejoin, await signedHeader(rejoin)))
    p = participantRow('bean:student-9')!
    expect(p.activeSince).not.toBeNull()
    expect(p.reconnectCount).toBe(1)
    expect(p.firstJoinedAt!.getTime()).toBeLessThan(p.activeSince!.getTime()) // history preserved
  })

  it('out-of-order timestamps never produce negative durations', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const joinNow = eventBody({ id: 'evt-o1', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-7', createdAtSec: nowSec })
    await webhookRoute.POST(webhookReq(joinNow, await signedHeader(joinNow)))
    // A "leave" that claims to predate the join (clock skew / retry storm).
    const staleLeave = eventBody({ id: 'evt-o2', event: 'participant_left', room: 'bean-live-wh', identity: 'bean:student-7', createdAtSec: nowSec - 600 })
    await webhookRoute.POST(webhookReq(staleLeave, await signedHeader(staleLeave)))
    const p = participantRow('bean:student-7')!
    expect(p.totalConnectedSeconds).toBeGreaterThanOrEqual(0)
    expect(p.lastLeftAt!.getTime()).toBeGreaterThanOrEqual(p.firstJoinedAt!.getTime())
  })

  it('room_finished closes open intervals and finalises usage exactly once', async () => {
    const t = Math.floor(Date.now() / 1000)
    const join = eventBody({ id: 'evt-fj', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:student-5', createdAtSec: t - 300 })
    await webhookRoute.POST(webhookReq(join, await signedHeader(join)))
    const finish = eventBody({ id: 'evt-fr', event: 'room_finished', room: 'bean-live-wh', createdAtSec: t })
    const res = await webhookRoute.POST(webhookReq(finish, await signedHeader(finish)))
    expect(res.status).toBe(200)
    const live = state.lives.get('bean-live-wh')!
    expect(live.status).toBe('INTERRUPTED')
    expect(live.usageFinalisedAt).not.toBeNull()
    expect(live.actualParticipantMinutes).toBeGreaterThan(0)
    expect(state.reconciles.length).toBe(1)
    const p = participantRow('bean:student-5')!
    expect(p.activeSince).toBeNull() // interval closed conservatively
    // A redelivered room_finished touches nothing.
    await webhookRoute.POST(webhookReq(finish, await signedHeader(finish)))
    expect(state.reconciles.length).toBe(1)
  })

  it('an unknown room is recorded as SKIPPED and mutates nothing', async () => {
    const raw = eventBody({ id: 'evt-unknown', event: 'room_finished', room: 'bean-live-somebody-elses-room' })
    const res = await webhookRoute.POST(webhookReq(raw, await signedHeader(raw, 'bean-live-somebody-elses-room')))
    expect(res.status).toBe(200)
    const recorded = state.webhookEvents.get('evt-unknown')
    expect(recorded!.processingStatus).toBe('SKIPPED')
    expect(recorded!.errorCode).toBe('unknown_room')
    // Our own session was untouched.
    const live = state.lives.get('bean-live-wh')!
    expect(live.status).toBe('LIVE')
    expect(live.usageFinalisedAt).toBeNull()
  })

  it('a foreign identity shape is not processed', async () => {
    const raw = eventBody({ id: 'evt-foreign', event: 'participant_joined', room: 'bean-live-wh', identity: 'not-a-bean-identity' })
    const res = await webhookRoute.POST(webhookReq(raw, await signedHeader(raw)))
    expect(res.status).toBe(200)
    expect(state.lives.get('bean-live-wh')!.participants.length).toBe(0)
  })

  it('the teacher identity maps to the TEACHER participant role', async () => {
    const raw = eventBody({ id: 'evt-tch', event: 'participant_joined', room: 'bean-live-wh', identity: 'bean:teacher-1' })
    await webhookRoute.POST(webhookReq(raw, await signedHeader(raw)))
    expect(participantRow('bean:teacher-1')!.participantRole).toBe('TEACHER')
  })
})
