// ─── BEAN Live Classroom (Phase 5): whiteboard snapshot persistence ───────────
// GET  /api/teach/classes/:id/live/whiteboard — restore for late joiners.
// POST /api/teach/classes/:id/live/whiteboard — teacher-owner saves a snapshot.
//
// Authorisation:
//   • POST: ONLY the approved owner teacher of a LIVE session. Students (and
//     everyone else) can never alter the saved board state.
//   • GET: the owner teacher OR a student holding a CONFIRMED booking for the
//     class — the board is classroom content, not public data.
//
// Validation: the snapshot must satisfy the bounded WB protocol (zod) and its
// serialised size must stay under the hard cap. Server truth — the client's
// validation is only a convenience.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireStudent } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'
import { LIVE_SESSION_STATUS } from '@/lib/livekit/live'
import { WB_MAX_SNAPSHOT_BYTES, wbSnapshotSchema } from '@/lib/livekit/whiteboard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    }
    const { id } = await params

    const live = await db.liveClassSession.findUnique({
      where: { classSessionId: id },
      select: {
        id: true, status: true,
        classSession: { select: { id: true, teacherProfile: { select: { studentId: true } } } },
        whiteboard: { select: { snapshotJson: true, version: true, updatedAt: true } },
      },
    })
    if (!live) {
      return NextResponse.json({ error: 'No live session for this class yet.' }, { status: 404 })
    }

    const isOwner = live.classSession.teacherProfile.studentId === student.id
    if (!isOwner) {
      const booking = await db.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId: id, studentId: student.id } },
        select: { status: true },
      })
      if (!booking || booking.status !== 'CONFIRMED') {
        return NextResponse.json({ error: 'Only confirmed students can read the classroom whiteboard.' }, { status: 403 })
      }
    }

    if (!live.whiteboard) {
      return NextResponse.json({ snapshot: null, version: 0 })
    }
    return NextResponse.json({
      snapshot: JSON.parse(live.whiteboard.snapshotJson),
      version: live.whiteboard.version,
      updatedAt: live.whiteboard.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/whiteboard GET]', err)
    return NextResponse.json({ error: 'Could not load the whiteboard snapshot — please try again.' }, { status: 500 })
  }
}

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

    const body = await req.json().catch(() => null)
    const parsed = wbSnapshotSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid whiteboard snapshot.' }, { status: 400 })
    }
    const json = JSON.stringify(parsed.data)
    if (json.length > WB_MAX_SNAPSHOT_BYTES) {
      return NextResponse.json(
        { error: `Whiteboard snapshot too large — the board keeps at most ${WB_MAX_STROKES_LABEL} strokes.` },
        { status: 400 },
      )
    }

    const live = await db.liveClassSession.findUnique({
      where: { classSessionId: id },
      select: { id: true, status: true, classSession: { select: { teacherProfileId: true } } },
    })
    if (!live || live.classSession.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found or not yours to save.' }, { status: 404 })
    }
    if (live.status !== LIVE_SESSION_STATUS.LIVE) {
      return NextResponse.json({ error: 'The classroom is not live — snapshots save only during the session.' }, { status: 409 })
    }

    const now = new Date()
    const saved = await db.liveWhiteboardState.upsert({
      where: { liveClassSessionId: live.id },
      create: { liveClassSessionId: live.id, snapshotJson: json, version: 1, updatedById: student.id, updatedAt: now },
      update: { snapshotJson: json, version: { increment: 1 }, updatedById: student.id, updatedAt: now },
    })

    return NextResponse.json({ ok: true, version: saved.version })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/whiteboard POST]', err)
    return NextResponse.json({ error: 'Could not save the whiteboard snapshot — please try again.' }, { status: 500 })
  }
}

const WB_MAX_STROKES_LABEL = '500'
