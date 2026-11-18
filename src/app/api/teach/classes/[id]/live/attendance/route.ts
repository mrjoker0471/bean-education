// ─── BEAN Live Classroom (Phase 5): verified attendance evidence ──────────────
// GET /api/teach/classes/:id/live/attendance — owner teacher only.
//
// Returns per-student verified live participation evidence (from signed
// webhook events only — never client claims) plus a documented attendance
// SUGGESTION. The suggestion is advisory: the teacher always confirms or
// overrides the final status through the existing Phase 4A attendance
// endpoint, which keeps its audit trail intact.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApprovedTeacher } from '@/lib/teach'
import { toLiveEvidenceDTO } from '@/lib/livekit/live'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard
    const { id } = await params

    const cls = await db.classSession.findUnique({
      where: { id },
      select: {
        id: true, teacherProfileId: true, durationMinutes: true, startsAt: true, status: true,
        bookings: { select: { studentId: true, status: true, bookedAt: true } },
        liveSession: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            endedAt: true,
            participants: {
              select: {
                studentId: true,
                firstJoinedAt: true,
                lastLeftAt: true,
                activeSince: true,
                totalConnectedSeconds: true,
                reconnectCount: true,
                student: { select: { displayName: true } },
              },
            },
          },
        },
      },
    })
    if (!cls || cls.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found or not yours to review.' }, { status: 404 })
    }

    const now = new Date()
    const evidence = toLiveEvidenceDTO(cls.liveSession?.participants ?? [], cls.bookings, cls.durationMinutes, now)

    return NextResponse.json({
      attendance: evidence,
      liveSession: cls.liveSession
        ? {
            status: cls.liveSession.status,
            startedAt: cls.liveSession.startedAt?.toISOString() ?? null,
            endedAt: cls.liveSession.endedAt?.toISOString() ?? null,
          }
        : null,
      // Evidence is advisory; the teacher confirms via the Phase 4A endpoint.
      note: 'Attendance suggestions come from verified connection evidence — review and confirm each student.',
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/attendance GET]', err)
    return NextResponse.json({ error: 'Could not load attendance evidence — please try again.' }, { status: 500 })
  }
}
