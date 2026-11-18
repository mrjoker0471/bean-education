// ─── BEAN Live Classroom (Phase 5): public-safe status ────────────────────────
// GET /api/teach/classes/:id/live/status
//
// Returns whether the teacher has started the room, the scheduled window,
// whether the CURRENT user may join (re-derived from the session cookie —
// never from client input), a participant count while LIVE (a number only —
// no identities) and the LiveKit configuration status. Private attendee
// information is never exposed; guests receive the same safe shape.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionStudent } from '@/lib/auth'
import {
  isInsideLiveWindow,
  LIVE_SESSION_STATUS,
  toLiveStatusDTO,
  type LiveStatusDTO,
} from '@/lib/livekit/live'
import { isLivekitConfigured, lastLivekitConnectionError } from '@/lib/livekit/config'
import { usageMonthKey, usageSnapshot } from '@/lib/livekit/usage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CONNECTION_ERROR_TTL_MS = 10 * 60_000 // transient flag validity window

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const student = await getSessionStudent()

    const cls = await db.classSession.findUnique({
      where: { id },
      select: {
        id: true, status: true, startsAt: true, durationMinutes: true,
        teacherProfile: { select: { studentId: true } },
        liveSession: {
          select: { id: true, roomName: true, status: true, startedAt: true, endedAt: true },
          include: { participants: { select: { activeSince: true } } },
        },
      },
    })
    if (!cls || cls.status === 'DRAFT') {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    const now = new Date()
    const isOwner = !!student && cls.teacherProfile.studentId === student.id

    // Role-specific join decision (server-derived; guests may browse but not join).
    let mayJoin = false
    let joinBlockReason: string | null = null
    const live = cls.liveSession
    const isLive = !!live && live.status === LIVE_SESSION_STATUS.LIVE && isInsideLiveWindow(cls.startsAt, cls.durationMinutes, now)

    if (!student) {
      joinBlockReason = 'Sign in and reserve a seat to join the live classroom.'
    } else if (isOwner) {
      mayJoin = isLive
      if (!mayJoin) {
        joinBlockReason = !live
          ? 'Your classroom has not started yet — use “Start Live Class” when you are ready.'
          : live.status === LIVE_SESSION_STATUS.ENDED
            ? 'This classroom has ended.'
            : 'The classroom is not live inside the scheduled window yet.'
      }
    } else {
      const booking = await db.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId: id, studentId: student.id } },
        select: { status: true },
      })
      if (!booking || booking.status !== 'CONFIRMED') {
        mayJoin = false
        joinBlockReason = booking?.status === 'CANCELLED'
          ? 'Your reservation was cancelled — rebook while seats remain.'
          : 'Only confirmed students can enter the live classroom.'
      } else {
        mayJoin = isLive
        if (!mayJoin) {
          joinBlockReason = !live
            ? 'Classroom not started yet'
            : live.status === LIVE_SESSION_STATUS.ENDED
              ? 'Class completed'
              : 'The classroom is not live inside the scheduled window yet.'
        }
      }
    }

    // Configuration status: honest, credential-free.
    let configurationStatus: LiveStatusDTO['configurationStatus']
    if (!isLivekitConfigured()) {
      configurationStatus = 'NOT_CONFIGURED'
    } else if (lastLivekitConnectionError() && Date.now() - lastLivekitConnectionError()!.at < CONNECTION_ERROR_TTL_MS) {
      configurationStatus = 'CONNECTION_ERROR'
    } else {
      const snapshot = await usageSnapshot(usageMonthKey(now))
      configurationStatus = snapshot.availableParticipantMinutes > 0 ? 'AVAILABLE' : 'CONFIGURED'
    }

    const participantCount = live && live.status === LIVE_SESSION_STATUS.LIVE
      ? live.participants.filter((p) => p.activeSince !== null).length
      : null

    const dto = toLiveStatusDTO(cls, live, participantCount, mayJoin, joinBlockReason, configurationStatus)
    return NextResponse.json({ status: dto })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/status GET]', err)
    return NextResponse.json({ error: 'Could not load the classroom status — please try again.' }, { status: 500 })
  }
}

