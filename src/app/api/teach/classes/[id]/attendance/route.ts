// ─── BEAN Teach (Phase 4A): class attendance marking ─────────────────────────
// POST /api/teach/classes/:id/attendance — teacher owner ONLY.
//   • booking must belong to the caller's own class (404 otherwise)
//   • attendance can only be marked AFTER the scheduled class has ended
//     (startsAt + durationMinutes < now, checked server-side) → 409 before end
//   • only CONFIRMED bookings can be marked ATTENDED or NO_SHOW; re-marking is
//     allowed while the class remains, and every change appends an audit event
//     to the append-only TeachAuditEvent trail (old → new, actor, role, time).
// Students and unrelated teachers can never reach this endpoint's effects.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { appendAudit, AUDIT_ACTION, AUDIT_ENTITY, requireApprovedTeacher } from '@/lib/teach'
import { teachAttendanceSchema } from '@/lib/teach-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { student, profile } = guard

    const parsed = teachAttendanceSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid attendance request.' }, { status: 400 })
    }
    const { bookingId, status } = parsed.data

    const { id } = await params
    const now = new Date()

    const result = await db.$transaction(async (tx: Tx) => {
      const booking = await tx.classBooking.findUnique({
        where: { id: bookingId },
        include: { classSession: { select: { id: true, teacherProfileId: true, startsAt: true, durationMinutes: true, status: true } } },
      })
      // The booking must belong to the caller's own class — anything else is 404.
      if (!booking || booking.classSessionId !== id || booking.classSession.teacherProfileId !== profile.id) {
        return { kind: 'notFound' as const }
      }
      if (booking.classSession.status !== 'COMPLETED' && booking.classSession.status !== 'PUBLISHED') {
        return { kind: 'notFound' as const }
      }
      // Attendance only after the class has fully ended.
      const endsAt = booking.classSession.startsAt.getTime() + booking.classSession.durationMinutes * 60_000
      if (now.getTime() < endsAt) {
        return { kind: 'tooEarly' as const, endsAt }
      }
      if (booking.status === 'CANCELLED') {
        return { kind: 'cancelledBooking' as const }
      }
      if (booking.status === status) {
        return { kind: 'unchanged' as const, booking }
      }
      const previous = booking.status
      const updated = await tx.classBooking.update({
        where: { id: booking.id },
        data: { status, attendanceMarkedAt: now, updatedAt: now },
      })
      await appendAudit(tx, {
        entityType: AUDIT_ENTITY.CLASS_BOOKING,
        entityId: booking.id,
        actorId: student.id,
        actorRole: student.role,
        action: AUDIT_ACTION.ATTENDANCE_MARKED,
        detail: `${previous} → ${status} (class ${id})`,
      })
      return { kind: 'ok' as const, booking: updated, previous }
    })

    switch (result.kind) {
      case 'ok':
        return NextResponse.json({ booking: { id: result.booking.id, status: result.booking.status, attendanceMarkedAt: result.booking.attendanceMarkedAt?.toISOString() ?? null } })
      case 'unchanged':
        return NextResponse.json({ booking: { id: result.booking.id, status: result.booking.status, attendanceMarkedAt: result.booking.attendanceMarkedAt?.toISOString() ?? null } })
      case 'notFound':
        return NextResponse.json({ error: 'Booking not found for this class.' }, { status: 404 })
      case 'cancelledBooking':
        return NextResponse.json({ error: 'A cancelled reservation cannot be marked for attendance.' }, { status: 409 })
      case 'tooEarly':
        return NextResponse.json({ error: 'Attendance can only be marked after the class has ended.' }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/teach/classes/:id/attendance POST]', err)
    return NextResponse.json({ error: 'Could not mark attendance — please try again.' }, { status: 500 })
  }
}
