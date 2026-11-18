// ─── BEAN Teach (Phase 4A): the teacher's own classes ────────────────────────
// GET /api/teach/my-classes — classes owned by the approved teacher ONLY,
// including enrolled students (display names only — never emails) and private
// state transitions. bookedCount is reconciled against the actual number of
// seat-holding bookings (defensive consistency check; drift is corrected and
// logged — a documented requirement so counts can never silently rot).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApprovedTeacher, toPublicClass } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status, headers: { 'Cache-Control': 'no-store' } })
    }
    const { profile } = guard

    const sessions = await db.classSession.findMany({
      where: { teacherProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })

    // Reconcile bookedCount against seat-holding bookings (not CANCELLED).
    // The booking transaction keeps counts exact; this guards against any
    // manual/external corruption and satisfies the reconciliation requirement.
    const holdCounts = await db.classBooking.groupBy({
      by: ['classSessionId'],
      where: { classSessionId: { in: sessions.map((s) => s.id) }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    })
    const holdMap = new Map(holdCounts.map((c) => [c.classSessionId, c._count._all]))
    for (const s of sessions) {
      const actual = holdMap.get(s.id) ?? 0
      if (actual !== s.bookedCount) {
        console.warn(`[api/teach/my-classes] reconciling bookedCount drift for class ${s.id}: ${s.bookedCount} → ${actual}`)
        await db.classSession.update({ where: { id: s.id }, data: { bookedCount: actual } })
        s.bookedCount = actual
      }
    }

    // Enrolled students for the teacher's own classes (display name only).
    const bookings = await db.classBooking.findMany({
      where: { classSessionId: { in: sessions.map((s) => s.id) } },
      include: { student: { select: { displayName: true } } },
      orderBy: { bookedAt: 'asc' },
      take: 500,
    })
    const bookingsByClass = new Map<string, typeof bookings>()
    for (const b of bookings) {
      const list = bookingsByClass.get(b.classSessionId) ?? []
      list.push(b)
      bookingsByClass.set(b.classSessionId, list)
    }

    return NextResponse.json(
      {
        classes: sessions.map((s) => ({
          ...toPublicClass(s, profile),
          bookings: (bookingsByClass.get(s.id) ?? []).map((b) => ({
            id: b.id,
            status: b.status,
            bookedAt: b.bookedAt.toISOString(),
            cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
            attendanceMarkedAt: b.attendanceMarkedAt ? b.attendanceMarkedAt.toISOString() : null,
            studentName: b.student.displayName,
          })),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/teach/my-classes GET]', err)
    return NextResponse.json({ error: 'Could not load your classes — please try again.' }, { status: 500 })
  }
}
