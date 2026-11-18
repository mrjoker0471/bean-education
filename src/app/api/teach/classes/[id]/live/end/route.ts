// ─── BEAN Live Classroom (Phase 5): end a live session ────────────────────────
// POST /api/teach/classes/:id/live/end — approved class owner only.
//
// Responsibilities (spec §6):
//   • transactionally mark the session ENDED (single-use guard: the usage
//     reconciliation below can only ever run ONCE per live session)
//   • close any open participant intervals conservatively (webhook-safe)
//   • reconcile the reserved allowance: release the reservation, record the
//     verified actual participant-minutes once (never decremented twice)
//   • terminate the LiveKit room (best-effort — the room also self-closes via
//     its empty timeout, and a later room_finished webhook stays a safe no-op)
//   • append an audit event; duplicate calls are safe (200 with final state)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher, appendAudit, AUDIT_ENTITY } from '@/lib/teach'
import { LIVE_END_REASON, LIVE_SESSION_STATUS, AUDIT_LIVE_ACTION } from '@/lib/livekit/live'
import { deleteRoomGuarded } from '@/lib/livekit/room'
import { USAGE_RECONCILE_SQL } from '@/lib/livekit/usage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

type EndOutcome =
  | { kind: 'notFound' }
  | { kind: 'forbidden' }
  | { kind: 'noLive' }
  | { kind: 'ok'; alreadyEnded: boolean; live: { id: string; status: string; endedAt: string | null; actualParticipantMinutes: number | null } }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { student, profile } = guard
    const { id } = await params
    const now = new Date()

    const outcome = await db.$transaction(async (tx: Tx): Promise<EndOutcome> => {
      const cls = await tx.classSession.findUnique({
        where: { id },
        select: { id: true, teacherProfileId: true, liveSession: { select: { id: true, roomName: true, status: true, startedAt: true, endedAt: true, reservedParticipantMinutes: true, actualParticipantMinutes: true, usageMonthKey: true, usageFinalisedAt: true, participants: { select: { id: true, activeSince: true, totalConnectedSeconds: true } } } } },
      })
      if (!cls) return { kind: 'notFound' }
      if (cls.teacherProfileId !== profile.id) return { kind: 'forbidden' }
      if (!cls.liveSession) return { kind: 'noLive' }

      const live = cls.liveSession
      if (live.usageFinalisedAt) {
        // Duplicate end — already finalised; answer with the final state.
        return { kind: 'ok', alreadyEnded: true, live: { id: live.id, status: live.status, endedAt: live.endedAt?.toISOString() ?? null, actualParticipantMinutes: live.actualParticipantMinutes ?? null } }
      }

      // Close any open connection intervals conservatively at `now`.
      for (const p of live.participants) {
        if (p.activeSince) {
          const seconds = Math.max(0, Math.floor((now.getTime() - p.activeSince.getTime()) / 1000))
          await tx.liveClassParticipant.update({
            where: { id: p.id },
            data: { activeSince: null, lastLeftAt: now, totalConnectedSeconds: p.totalConnectedSeconds + seconds, lastEventAt: now, updatedAt: now },
          })
        }
      }

      // Verified actual usage: sum of all participant connected seconds → minutes (round up).
      const refreshed = await tx.liveClassSession.findUnique({
        where: { id: live.id },
        select: { participants: { select: { totalConnectedSeconds: true } } },
      })
      const totalSeconds = (refreshed?.participants ?? []).reduce((sum, p) => sum + p.totalConnectedSeconds, 0)
      const actualMinutes = Math.ceil(totalSeconds / 60)

      // Single-use finalisation: transition to ENDED with usageFinalisedAt set.
      await tx.liveClassSession.update({
        where: { id: live.id },
        data: {
          status: LIVE_SESSION_STATUS.ENDED,
          endedAt: now,
          endedById: student.id,
          endReason: LIVE_END_REASON.TEACHER,
          actualParticipantMinutes: actualMinutes,
          usageFinalisedAt: now,
          updatedAt: now,
        },
      })

      // Reconcile the monthly allowance exactly once (guarded above):
      // release the reservation, record verified usage.
      await tx.$executeRawUnsafe(USAGE_RECONCILE_SQL, live.reservedParticipantMinutes, actualMinutes, now.getTime(), live.usageMonthKey)

      await appendAudit(tx, {
        entityType: AUDIT_ENTITY.CLASS_SESSION,
        entityId: id,
        actorId: student.id,
        actorRole: student.role,
        action: AUDIT_LIVE_ACTION.ENDED,
        detail: `Live classroom ended by the teacher; verified usage ${actualMinutes} participant-minutes (reserved ${live.reservedParticipantMinutes})`,
      })

      return { kind: 'ok', alreadyEnded: false, live: { id: live.id, status: LIVE_SESSION_STATUS.ENDED, endedAt: now.toISOString(), actualParticipantMinutes: actualMinutes } }
    })

    if (outcome.kind !== 'ok') {
      const status = outcome.kind === 'notFound' ? 404 : outcome.kind === 'forbidden' ? 403 : 409
      const message = outcome.kind === 'notFound'
        ? 'Class not found'
        : outcome.kind === 'forbidden'
          ? 'You can only end your own class.'
          : 'The classroom has not been started yet.'
      return NextResponse.json({ error: message }, { status })
    }

    // Best-effort room termination AFTER the transaction committed. A provider
    // failure here is honest but not fatal: the room self-closes via empty
    // timeout and the room_finished webhook remains idempotent.
    if (!outcome.alreadyEnded) {
      const liveRow = await db.liveClassSession.findUnique({
        where: { classSessionId: id },
        select: { roomName: true },
      })
      if (liveRow) {
        await deleteRoomGuarded(liveRow.roomName)
      }
    }

    return NextResponse.json({ live: outcome.live, alreadyEnded: outcome.alreadyEnded })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/end POST]', err)
    return NextResponse.json({ error: 'Could not end the classroom — please try again.' }, { status: 500 })
  }
}
