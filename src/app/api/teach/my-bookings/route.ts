// ─── BEAN Teach (Phase 4A): the student's own bookings ───────────────────────
// GET /api/teach/my-bookings — the signed-in student's reservations ONLY,
// newest first (bounded). Each entry carries its class summary and the
// teacher's public teaching name. Other students' bookings are never exposed;
// attendance status (ATTENDED / NO_SHOW) appears once the teacher marks it.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent } from '@/lib/auth'
import { toMyBookingDTO } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }

    const bookings = await db.classBooking.findMany({
      where: { studentId: student.id },
      include: {
        classSession: {
          select: {
            id: true,
            title: true,
            subject: true,
            startsAt: true,
            durationMinutes: true,
            timeZone: true,
            language: true,
            targetLevel: true,
            status: true,
            teacherProfile: { select: { teachingName: true } },
          },
        },
      },
      orderBy: { bookedAt: 'desc' },
      take: 200,
    })

    return NextResponse.json(
      {
        bookings: bookings.map((b) => toMyBookingDTO(b, b.classSession, b.classSession.teacherProfile.teachingName)),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/teach/my-bookings GET]', err)
    return NextResponse.json({ error: 'Could not load your bookings — please try again.' }, { status: 500 })
  }
}
