// ─── BEAN Live Classroom (Phase 5): start a live session ──────────────────────
// POST /api/teach/classes/:id/live/start — approved owner teacher only.
//
// Responsibilities (spec §6):
//   • validate class ownership + PUBLISHED status + the scheduled window
//   • require at least one confirmed booking
//   • ensure the monthly usage reserve can cover (confirmed + 1) × duration —
//     ATOMICALLY, so concurrent room starts can never oversubscribe (§3)
//   • generate an opaque room name and create the LiveKit room via the
//     RoomServiceClient with maxParticipants = confirmed + teacher, capped
//   • create/repair the single LiveClassSession row (unique per class — the
//     reviewed retry design reuses the row for FAILED/READY/INTERRUPTED
//     resumes; an ENDED session can never restart)
//   • append a TeachAuditEvent; release the reservation when room creation fails
//
// Duplicate start is SAFE: a LIVE session is returned as-is (200), never a
// second room, never a second reservation.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher, appendAudit, AUDIT_ENTITY } from '@/lib/teach'
import { trustStateFor, restrictionMessage } from '@/lib/trust'
import {
  isInsideLiveWindow,
  LIVE_END_REASON,
  LIVE_SESSION_STATUS,
  MIN_CONFIRMED_TO_START,
  generateRoomName,
  AUDIT_LIVE_ACTION,
  JOIN_WINDOW_BEFORE_MINUTES,
} from '@/lib/livekit/live'
import { createRoomGuarded } from '@/lib/livekit/room'
import {
  estimateParticipantMinutes,
  usageMonthKey,
  USAGE_MONTH_UPSERT_SQL,
  USAGE_RELEASE_SQL,
  USAGE_RESERVE_SQL,
  budgetRejectionMessage,
  usageSnapshot,
} from '@/lib/livekit/usage'
import { liveBudgetConfig } from '@/lib/livekit/config'
import { ROOM_EMPTY_TIMEOUT_SECONDS } from '@/lib/livekit/live'


export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

type StartOutcome =
  | { kind: 'notFound' }
  | { kind: 'forbidden' }
  | { kind: 'notPublished' }
  | { kind: 'cancelled' }
  | { kind: 'completed' }
  | { kind: 'tooEarly' }
  | { kind: 'windowClosed' }
  | { kind: 'noBookings' }
  | { kind: 'ended' }
  | { kind: 'budget'; needed: number; monthKey: string }
  | { kind: 'ok'; mode: 'started' | 'alreadyLive' | 'resumed'; live: { id: string; roomName: string; status: string; startedAt: Date | null } }

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

    // Phase 6 EMERGENCY_STOP: the immediate-safeguarding procedure blocks any
    // new live room for this teacher until an admin reinstates. Ordinary
    // complaints NEVER reach this path — teaching confirmed students continues
    // while investigations run.
    const trust = await trustStateFor(profile.id, now)
    if (trust.emergencyStop) {
      return NextResponse.json({ error: restrictionMessage(trust) }, { status: 403 })
    }

    const monthKey = usageMonthKey(now)
    const budget = liveBudgetConfig().monthlyBudgetMinutes

    // ── Phase 1 (transactional): validate + reserve the allowance ──
    const outcome = await db.$transaction(async (tx: Tx): Promise<StartOutcome> => {
      const cls = await tx.classSession.findUnique({
        where: { id },
        select: {
          id: true, status: true, startsAt: true, durationMinutes: true, teacherProfileId: true,
          bookings: { where: { status: 'CONFIRMED' }, select: { id: true } },
        },
      })
      if (!cls) return { kind: 'notFound' }
      if (cls.teacherProfileId !== profile.id) return { kind: 'forbidden' }
      if (cls.status === 'DRAFT') return { kind: 'notPublished' }
      if (cls.status === 'CANCELLED') return { kind: 'cancelled' }
      if (cls.status === 'COMPLETED') return { kind: 'completed' }
      if (cls.startsAt.getTime() - JOIN_WINDOW_BEFORE_MINUTES * 60_000 > now.getTime()) return { kind: 'tooEarly' }
      if (!isInsideLiveWindow(cls.startsAt, cls.durationMinutes, now)) return { kind: 'windowClosed' }
      if (cls.bookings.length < MIN_CONFIRMED_TO_START) return { kind: 'noBookings' }

      const estimate = estimateParticipantMinutes(cls.bookings.length, cls.durationMinutes)
      const existing = await tx.liveClassSession.findUnique({ where: { classSessionId: id } })

      if (existing) {
        if (existing.status === LIVE_SESSION_STATUS.LIVE) {
          return { kind: 'ok', mode: 'alreadyLive', live: existing }
        }
        if (existing.status === LIVE_SESSION_STATUS.ENDED) {
          return { kind: 'ended' }
        }
        // FAILED / READY / INTERRUPTED resume: release any unspent reservation
        // from the previous attempt, then re-reserve the fresh estimate. The
        // usageFinalisedAt guard decides whether INTERRUPTED already reconciled.
        if (existing.usageFinalisedAt || existing.status === LIVE_SESSION_STATUS.ENDED) {
          return { kind: 'ended' }
        }
        if (existing.reservedParticipantMinutes > 0) {
          await tx.$executeRawUnsafe(USAGE_RELEASE_SQL, existing.reservedParticipantMinutes, now.getTime(), existing.usageMonthKey)
        }
        // Ensure the month row exists, then atomically reserve. The conditional
        // UPDATE re-checks the budget AT COMMIT TIME against the row itself —
        // no oversubscription. (The budget is on the row, not a bind param.)
        await tx.$executeRawUnsafe(USAGE_MONTH_UPSERT_SQL, monthKey, budget, now.getTime(), now.getTime())
        const reserved = await tx.$executeRawUnsafe(USAGE_RESERVE_SQL, estimate, now.getTime(), monthKey, estimate)
        if (reserved !== 1) {
          return { kind: 'budget', needed: estimate, monthKey }
        }
        const updated = await tx.liveClassSession.update({
          where: { id: existing.id },
          data: {
            status: LIVE_SESSION_STATUS.READY,
            reservedParticipantMinutes: estimate,
            usageMonthKey: monthKey,
            startedById: student.id,
            updatedAt: now,
          },
        })
        await appendAudit(tx, {
          entityType: AUDIT_ENTITY.CLASS_SESSION,
          entityId: id,
          actorId: student.id,
          actorRole: student.role,
          action: AUDIT_LIVE_ACTION.RESUMED,
          detail: `Live session resumed after ${existing.status.toLowerCase()} attempt; reserved ${estimate} participant-minutes for ${monthKey}`,
        })
        return { kind: 'ok', mode: 'resumed', live: updated }
      }

      // First start: ensure month row + atomic reservation.
      await tx.$executeRawUnsafe(USAGE_MONTH_UPSERT_SQL, monthKey, budget, now.getTime(), now.getTime())
      const reserved = await tx.$executeRawUnsafe(USAGE_RESERVE_SQL, estimate, now.getTime(), monthKey, estimate)
      if (reserved !== 1) {
        return { kind: 'budget', needed: estimate, monthKey }
      }
      const live = await tx.liveClassSession.create({
        data: {
          classSessionId: id,
          roomName: generateRoomName(),
          status: LIVE_SESSION_STATUS.READY,
          startedById: student.id,
          reservedParticipantMinutes: estimate,
          usageMonthKey: monthKey,
        },
      })
      await appendAudit(tx, {
        entityType: AUDIT_ENTITY.CLASS_SESSION,
        entityId: id,
        actorId: student.id,
        actorRole: student.role,
        action: AUDIT_LIVE_ACTION.STARTED,
        detail: `Live classroom starting; reserved ${estimate} participant-minutes for ${monthKey}`,
      })
      return { kind: 'ok', mode: 'started', live }
    })

    if (outcome.kind !== 'ok') {
      const status: Record<Exclude<StartOutcome['kind'], 'ok'>, number> = {
        notFound: 404,
        forbidden: 403,
        notPublished: 404,
        cancelled: 409,
        completed: 409,
        tooEarly: 409,
        windowClosed: 409,
        noBookings: 409,
        ended: 409,
        budget: 429,
      }
      const messages: Record<Exclude<StartOutcome['kind'], 'ok'>, string> = {
        notFound: 'Class not found',
        forbidden: 'You can only start your own class.',
        notPublished: 'Publish this class before starting the live classroom.',
        cancelled: 'This class was cancelled — the live classroom cannot start.',
        completed: 'This class is already completed.',
        tooEarly: `The classroom opens ${JOIN_WINDOW_BEFORE_MINUTES} minutes before the scheduled start time.`,
        windowClosed: 'The scheduled class time window has closed.',
        noBookings: 'No confirmed bookings yet — at least one student must reserve a seat before the live classroom can start.',
        ended: 'This classroom already ended — a session cannot restart after it has ended.',
        budget: 'Live classroom capacity has reached the current free pilot allowance — the reservation could not be made.',
      }
      if (outcome.kind === 'budget') {
        const snapshot = await usageSnapshot(outcome.monthKey)
        return NextResponse.json(
          { error: budgetRejectionMessage(snapshot, outcome.needed), usage: { monthKey: snapshot.monthKey, availableParticipantMinutes: snapshot.availableParticipantMinutes, budgetParticipantMinutes: snapshot.budgetParticipantMinutes } },
          { status: 429 },
        )
      }
      return NextResponse.json({ error: messages[outcome.kind] }, { status: status[outcome.kind] })
    }

    // ── Phase 2 (after commit): create the LiveKit room ──
    const liveRow = await db.liveClassSession.findUnique({
      where: { classSessionId: id },
      include: { classSession: { select: { id: true, durationMinutes: true, bookings: { where: { status: 'CONFIRMED' }, select: { id: true } } } } },
    })
    if (!liveRow) {
      return NextResponse.json({ error: 'Live session row disappeared unexpectedly.' }, { status: 500 })
    }
    if (outcome.mode === 'alreadyLive') {
      return NextResponse.json({ live: { id: liveRow.id, status: liveRow.status, startedAt: liveRow.startedAt?.toISOString() ?? null }, alreadyLive: true })
    }

    const confirmed = liveRow.classSession.bookings.length
    const maxParticipants = Math.min(confirmed + 1, liveBudgetConfig().maxRoomParticipants)
    const created = await createRoomGuarded(liveRow.roomName, maxParticipants)

    if (!created.ok) {
      // Roll the reservation back honestly: mark FAILED and release the budget.
      const nowFail = new Date()
      await db.$transaction(async (tx: Tx) => {
        await tx.liveClassSession.update({
          where: { id: liveRow.id },
          data: { status: LIVE_SESSION_STATUS.FAILED, endReason: LIVE_END_REASON.FAILED_CREATE, updatedAt: nowFail },
        })
        if (liveRow.reservedParticipantMinutes > 0) {
          await tx.$executeRawUnsafe(USAGE_RELEASE_SQL, liveRow.reservedParticipantMinutes, nowFail.getTime(), liveRow.usageMonthKey)
        }
      })
      return NextResponse.json(
        { error: 'The live classroom could not be created on the realtime provider. No usage was charged — please try again shortly.' },
        { status: 502 },
      )
    }

    const nowLive = new Date()
    const updated = await db.liveClassSession.update({
      where: { id: liveRow.id },
      data: { status: LIVE_SESSION_STATUS.LIVE, startedAt: nowLive, updatedAt: nowLive },
    })
    return NextResponse.json({
      live: { id: updated.id, status: updated.status, startedAt: updated.startedAt?.toISOString() ?? null, reservedParticipantMinutes: updated.reservedParticipantMinutes },
      room: { maxParticipants, emptyTimeoutSeconds: ROOM_EMPTY_TIMEOUT_SECONDS },
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/start POST]', err)
    return NextResponse.json({ error: 'Could not start the live classroom — please try again.' }, { status: 500 })
  }
}
