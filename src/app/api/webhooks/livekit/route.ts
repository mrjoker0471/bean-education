// ─── BEAN Live Classroom (Phase 5): LiveKit webhook receiver ──────────────────
// POST /api/webhooks/livekit — the ONLY public provider callback.
//
// Security:
//   • The RAW request body is read with request.text() BEFORE any parsing.
//   • The Authorization header is verified with WebhookReceiver (LiveKit server
//     secret) — invalid or missing signatures are rejected with 401. The body
//     is never JSON-parsed before verification.
//   • Raw event bodies and secrets are never logged.
//
// Idempotency & ordering (spec §7):
//   • providerEventId (LiveKit's own event id) is UNIQUE — duplicate deliveries
//     can never double-apply accounting; FAILED events may be reprocessed on
//     genuine retries.
//   • Duplicate participant_joined while connected → no-op (no second interval).
//   • Duplicate participant_left → no-op (no double subtraction).
//   • Reconnections open a NEW interval and increment reconnectCount.
//   • Out-of-order timestamps are clamped — negative durations are impossible.
//   • room_finished closes open intervals conservatively and (if BEAN still
//     believed the room LIVE) marks the session INTERRUPTED and finalises its
//     usage exactly once.
//   • Unknown room names are recorded as SKIPPED — they can never mutate
//     another session.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { livekitWebhookReceiver } from '@/lib/livekit/config'
import {
  applyParticipantJoined,
  applyParticipantLeft,
  LIVE_END_REASON,
  LIVE_SESSION_STATUS,
  studentIdFromIdentity,
} from '@/lib/livekit/live'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HANDLED_EVENTS = new Set([
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
  'participant_connection_aborted',
])

/** Event creation timestamp → Date (handles protobufjs seconds as number|Long). */
function eventDate(seconds: unknown, fallback: Date): Date {
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return new Date(seconds * 1000)
  }
  if (typeof seconds === 'bigint') {
    const n = Number(seconds)
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000)
  }
  return fallback
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function POST(req: NextRequest) {
  // No session-cookie auth here: this endpoint authenticates by webhook
  // signature only (it is the provider's callback, not a browser route).
  try {
    const receiver = livekitWebhookReceiver()
    if (!receiver) {
      return NextResponse.json({ error: 'Webhook receiver is not configured.' }, { status: 503 })
    }

    const rawBody = await req.text()
    const authHeader = req.headers.get('authorization') ?? undefined

    let event: {
      event?: string
      id?: string
      createdAt?: { seconds?: unknown }
      room?: { name?: string }
      participant?: { identity?: string }
    }
    try {
      // Verifies the signed JWT (sha256 over the raw body) using the server
      // secret. Throws on invalid/missing signatures.
      event = receiver.receive(rawBody, authHeader) as typeof event
    } catch {
      return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 })
    }

    const eventName = event.event ?? ''
    const providerEventId = (event.id ?? '').trim()
    const roomName = event.room?.name ?? ''
    const occurredAt = eventDate(event.createdAt?.seconds, new Date())

    if (!providerEventId || !roomName) {
      return NextResponse.json({ error: 'Malformed webhook event.' }, { status: 400 })
    }

    // ── Idempotency gate ──
    const existing = await db.liveKitWebhookEvent.findUnique({ where: { providerEventId } })
    if (existing && existing.processingStatus !== 'FAILED') {
      // Duplicate delivery of an already-handled event — no repeated accounting.
      return NextResponse.json({ ok: true, duplicate: true })
    }
    if (!existing) {
      await db.liveKitWebhookEvent.create({
        data: {
          providerEventId,
          eventName,
          roomName,
          receivedAt: new Date(),
          processingStatus: 'PROCESSED', // provisional; updated below
        },
      })
    }

    if (!HANDLED_EVENTS.has(eventName)) {
      await db.liveKitWebhookEvent.update({
        where: { providerEventId },
        data: { processedAt: new Date(), processingStatus: 'SKIPPED', errorCode: 'unhandled_event' },
      })
      return NextResponse.json({ ok: true, skipped: 'unhandled_event' })
    }

    // ── Processing ──
    try {
      await db.$transaction(async (tx: Tx) => {
        const live = await tx.liveClassSession.findUnique({ where: { roomName } })
        if (!live) {
          // Unknown room: recorded (SKIPPED), never mutates another session.
          return 'unknown_room' as const
        }
        const now = new Date()

        if (eventName === 'room_started') {
          // Provider-side reconciliation: if BEAN's row is still READY (crash
          // between reserve and the LIVE update), promote it to LIVE.
          if (live.status === LIVE_SESSION_STATUS.READY) {
            await tx.liveClassSession.update({
              where: { id: live.id },
              data: { status: LIVE_SESSION_STATUS.LIVE, startedAt: live.startedAt ?? occurredAt, updatedAt: now },
            })
          }
          return 'processed' as const
        }

        if (eventName === 'room_finished') {
          // Close open intervals conservatively.
          const participants = await tx.liveClassParticipant.findMany({ where: { liveClassSessionId: live.id } })
          for (const p of participants) {
            if (!p.activeSince) continue
            const sinceMs = p.activeSince.getTime()
            const untilMs = Math.max(occurredAt.getTime(), sinceMs)
            const seconds = Math.floor((untilMs - sinceMs) / 1000)
            await tx.liveClassParticipant.update({
              where: { id: p.id },
              data: { activeSince: null, lastLeftAt: new Date(untilMs), totalConnectedSeconds: p.totalConnectedSeconds + seconds, lastEventAt: occurredAt, updatedAt: now },
            })
          }

          // If BEAN still expects the room to be running, finalise as
          // INTERRUPTED. A session the teacher already ended (ENDED +
          // usageFinalisedAt set) is untouched — finalisation stays single-use.
          const fresh = await tx.liveClassSession.findUnique({ where: { id: live.id } })
          if (!fresh || fresh.usageFinalisedAt) return 'processed' as const
          if (fresh.status === LIVE_SESSION_STATUS.LIVE || fresh.status === LIVE_SESSION_STATUS.READY) {
            const refreshed = await tx.liveClassParticipant.findMany({
              where: { liveClassSessionId: fresh.id },
              select: { totalConnectedSeconds: true },
            })
            const actualMinutes = Math.ceil(refreshed.reduce((s, p) => s + p.totalConnectedSeconds, 0) / 60)
            await tx.liveClassSession.update({
              where: { id: fresh.id },
              data: {
                status: LIVE_SESSION_STATUS.INTERRUPTED,
                endedAt: occurredAt,
                endReason: LIVE_END_REASON.PROVIDER,
                actualParticipantMinutes: actualMinutes,
                usageFinalisedAt: now,
                updatedAt: now,
              },
            })
            await tx.$executeRawUnsafe(
              // Release the reservation + record verified usage exactly once
              // (guarded by the usageFinalisedAt transition above).
              `UPDATE "LiveUsageMonth" SET "reservedParticipantMinutes" = MAX("reservedParticipantMinutes" - ?, 0), "usedParticipantMinutes" = "usedParticipantMinutes" + ?, "updatedAt" = ? WHERE "monthKey" = ?`,
              fresh.reservedParticipantMinutes,
              actualMinutes,
              now.getTime(),
              fresh.usageMonthKey,
            )
          }
          return 'processed' as const
        }

        // participant_joined / participant_left / participant_connection_aborted
        const identity = event.participant?.identity ?? ''
        const studentId = studentIdFromIdentity(identity)
        if (!studentId) {
          return 'unknown_identity' as const
        }
        const participant = await tx.liveClassParticipant.findUnique({
          where: { liveClassSessionId_participantIdentity: { liveClassSessionId: live.id, participantIdentity: identity } },
        })
        const baseState = participant
          ? {
              firstJoinedAt: participant.firstJoinedAt,
              activeSince: participant.activeSince,
              lastLeftAt: participant.lastLeftAt,
              totalConnectedSeconds: participant.totalConnectedSeconds,
              reconnectCount: participant.reconnectCount,
            }
          : { firstJoinedAt: null, activeSince: null, lastLeftAt: null, totalConnectedSeconds: 0, reconnectCount: 0 }

        if (eventName === 'participant_joined') {
          const outcome = applyParticipantJoined(baseState, occurredAt)
          if (!participant) {
            await tx.liveClassParticipant.create({
              data: {
                liveClassSessionId: live.id,
                studentId,
                participantIdentity: identity,
                participantRole: identity === `bean:${live.startedById}` ? 'TEACHER' : 'STUDENT',
                firstJoinedAt: outcome.state.firstJoinedAt,
                activeSince: outcome.state.activeSince,
                lastLeftAt: outcome.state.lastLeftAt,
                totalConnectedSeconds: outcome.state.totalConnectedSeconds,
                reconnectCount: outcome.state.reconnectCount,
                lastEventAt: occurredAt,
                updatedAt: now,
              },
            })
          } else {
            await tx.liveClassParticipant.update({
              where: { id: participant.id },
              data: { ...outcome.state, lastEventAt: occurredAt, updatedAt: now },
            })
          }
          return 'processed' as const
        }

        // participant_left / participant_connection_aborted
        const outcome = applyParticipantLeft(baseState, occurredAt)
        if (!participant) {
          return 'unknown_identity' as const
        }
        await tx.liveClassParticipant.update({
          where: { id: participant.id },
          data: { ...outcome.state, lastEventAt: occurredAt, updatedAt: now },
        })
        return 'processed' as const
      })

      return NextResponse.json({ ok: true })
    } catch (processErr) {
      // Transient failure — record FAILED and let the provider retry; the
      // idempotency gate above will reprocess this same row.
      await db.liveKitWebhookEvent.update({
        where: { providerEventId },
        data: { processedAt: new Date(), processingStatus: 'FAILED', errorCode: 'processing_error' },
      }).catch(() => undefined)
      console.error('[api/webhooks/livekit POST] processing failed', processErr instanceof Error ? processErr.message : processErr)
      return NextResponse.json({ error: 'Webhook processing failed — the event will be reprocessed on retry.' }, { status: 500 })
    }
  } catch (err) {
    console.error('[api/webhooks/livekit POST]', err)
    return NextResponse.json({ error: 'Webhook handling failed.' }, { status: 500 })
  }
}
