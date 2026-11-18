// ─── BEAN Live Classroom (Phase 5): participant token minting ─────────────────
// POST /api/teach/classes/:id/live/token
//
// Every token request re-derives the caller's role from BEAN database state —
// the client can never assert a role, ownership or booking status:
//   • owner teacher (approved profile that owns this class) → TEACHER grants
//     (camera + microphone + screen share publish sources)
//   • student with a CONFIRMED booking → STUDENT grants (camera + microphone)
//   • everyone else → 401/403 (guests, unbooked, cancelled, foreign classes)
//
// Additional gates: the session must be LIVE, the request must be inside the
// scheduled access window, and a usage reservation must exist. The LiveKit JWT
// is minted server-side (AccessToken) with the student's opaque database
// identity (`bean:<studentId>`) — never an email. The API secret never leaves
// this module; responses contain only the JWT + public ws URL + safe metadata.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireStudent } from '@/lib/auth'
import {
  isInsideLiveWindow,
  LIVE_SESSION_STATUS,
  participantIdentity,
  safeDisplayName,
  TOKEN_TAIL_MINUTES,
} from '@/lib/livekit/live'
import { createParticipantToken, isLivekitConfigured, lastLivekitConnectionError } from '@/lib/livekit/config'
import { trustStateFor, restrictionMessage } from '@/lib/trust'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in to join the live classroom — guests can browse classes freely.' }, { status: 401 })
    }
    if (!isLivekitConfigured()) {
      return NextResponse.json({ error: 'The live classroom is not configured yet — BEAN operators need to add LiveKit credentials.' }, { status: 503 })
    }

    const { id } = await params
    const now = new Date()

    const cls = await db.classSession.findUnique({
      where: { id },
      select: {
        id: true, title: true, status: true, startsAt: true, durationMinutes: true, timeZone: true,
        teacherProfile: { select: { id: true, studentId: true, teachingName: true, verificationStatus: true } },
        liveSession: { select: { id: true, roomName: true, status: true } },
      },
    })
    if (!cls || cls.status === 'DRAFT') {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    // Phase 6 EMERGENCY_STOP: while the immediate-safeguarding halt is active
    // for this teacher, no tokens are issued (start and join are both closed).
    // Confirmed bookings are preserved — the halt ends on admin reinstatement.
    {
      const trust = await trustStateFor(cls.teacherProfile.id, now)
      if (trust.emergencyStop) {
        return NextResponse.json({ error: restrictionMessage(trust) }, { status: 403 })
      }
    }

    const isOwner = cls.teacherProfile.studentId === student.id && cls.teacherProfile.verificationStatus === 'APPROVED'

    let role: 'TEACHER' | 'STUDENT'
    if (isOwner) {
      role = 'TEACHER'
    } else {
      const booking = await db.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId: id, studentId: student.id } },
        select: { id: true, status: true },
      })
      if (!booking || booking.status !== 'CONFIRMED') {
        // A cancelled / absent booking never gets a token; other students'
        // booking details are never revealed beyond this honest message.
        return NextResponse.json(
          { error: booking?.status === 'CANCELLED'
            ? 'Your reservation was cancelled — rebook from the class page while seats remain.'
            : 'Only confirmed students can enter the live classroom.' },
          { status: 403 },
        )
      }
      role = 'STUDENT'
    }

    if (cls.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This class was cancelled.' }, { status: 409 })
    }
    if (!cls.liveSession || cls.liveSession.status !== LIVE_SESSION_STATUS.LIVE) {
      return NextResponse.json({ error: 'The classroom is not live yet — the teacher has not started it.' }, { status: 409 })
    }
    if (!isInsideLiveWindow(cls.startsAt, cls.durationMinutes, now)) {
      return NextResponse.json({ error: 'The scheduled class access window is closed.' }, { status: 409 })
    }

    // Token TTL covers the scheduled duration plus a reconnect tail margin.
    const ttlSeconds = Math.min(Math.max(cls.durationMinutes + TOKEN_TAIL_MINUTES, 60) * 60, 8 * 3600)

    const identity = participantIdentity(student.id)
    const displayName = safeDisplayName(role === 'TEACHER' ? cls.teacherProfile.teachingName : student.displayName, role)
    const token = await createParticipantToken({
      identity,
      name: displayName,
      room: cls.liveSession.roomName,
      ttlSeconds,
      canPublishSources: role === 'TEACHER' ? ['camera', 'microphone', 'screen_share'] : ['camera', 'microphone'],
      metadata: JSON.stringify({ role, classId: cls.id, displayName }),
    })

    return NextResponse.json({
      token,
      wsUrl: (process.env.LIVEKIT_WS_URL ?? '').trim(),
      room: {
        // Safe room information only — the opaque server-generated name and
        // the class title. No secrets, no other participants' identities.
        name: cls.liveSession.roomName,
        classTitle: cls.title,
      },
      participant: { identity, displayName, role },
      expiresInSeconds: ttlSeconds,
      ...(lastLivekitConnectionError() ? { degraded: true } : {}),
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/token POST]', err)
    return NextResponse.json({ error: 'Could not issue a classroom token — please try again.' }, { status: 500 })
  }
}
