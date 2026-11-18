// ─── BEAN Teach (Phase 4A): seat reservation & cancellation ──────────────────
// POST   /api/teach/classes/:id/book   — signed-in student reserves a FREE seat.
// DELETE /api/teach/classes/:id/book   — the booking owner cancels (releases seat).
//
// Concurrency guarantee: the seat is claimed with a single conditional SQL
// update inside the booking transaction (see src/lib/teach-booking.ts):
//   UPDATE "ClassSession" SET bookedCount = bookedCount + 1
//   WHERE id = ? AND status = 'PUBLISHED' AND startsAt > ? AND bookedCount < capacity
// Two students racing for the last seat can never both win — SQLite
// serialises the writes and the loser's predicate matches zero rows, so no
// booking row is created for them and bookedCount never exceeds capacity.
//
// State rules (all enforced server-side, transactionally):
//   • class must exist, be PUBLISHED and scheduled in the future
//   • a student can NEVER book their own class (403)
//   • one booking record per student per class (unique constraint) — a
//     CANCELLED booking is re-activated, never duplicated, and history is kept
//   • cancellation window: any time before the class starts; after start the
//     window is closed (documented in docs/BEAN_TEACH_IMPLEMENTATION.md)
//   • no money is involved anywhere — bookings are always free during the pilot

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { SEAT_CLAIM_SQL, SEAT_RELEASE_SQL } from '@/lib/teach-booking'
import { toMyBookingDTO } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in to reserve your seat — guests can browse freely.' }, { status: 401 })
    }

    const { id } = await params
    const now = new Date()

    const outcome = await db.$transaction(async (tx: Tx) => {
      const session = await tx.classSession.findUnique({
        where: { id },
        include: { teacherProfile: { select: { studentId: true, teachingName: true } } },
      })
      if (!session) return { kind: 'notFound' as const }
      // Drafts are invisible; cancelled classes cannot take bookings.
      if (session.status === 'DRAFT') return { kind: 'notFound' as const }
      if (session.status === 'CANCELLED') return { kind: 'cancelled' as const }
      if (session.status === 'COMPLETED') return { kind: 'notFound' as const }
      if (session.startsAt.getTime() <= now.getTime()) return { kind: 'started' as const }
      // Self-booking is forbidden — a teacher cannot seat their own class.
      if (session.teacherProfile.studentId === student.id) return { kind: 'self' as const }

      const existing = await tx.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId: id, studentId: student.id } },
      })
      if (existing && existing.status !== 'CANCELLED') {
        return { kind: 'duplicate' as const }
      }

      // Atomic conditional seat claim — the ONLY place a seat is handed out.
      const claimed = await tx.$executeRawUnsafe(SEAT_CLAIM_SQL, now.getTime(), id, now.getTime())
      if (claimed !== 1) {
        return { kind: 'full' as const }
      }

      const booking = existing
        ? await tx.classBooking.update({
            where: { id: existing.id },
            data: { status: 'CONFIRMED', bookedAt: now, cancelledAt: null, attendanceMarkedAt: null, updatedAt: now },
          })
        : await tx.classBooking.create({
            data: { classSessionId: id, studentId: student.id, status: 'CONFIRMED', bookedAt: now },
          })
      return { kind: 'ok' as const, booking, session }
    })

    if (outcome.kind !== 'ok') {
      const status: Record<Exclude<typeof outcome.kind, 'ok'>, number> = {
        notFound: 404,
        cancelled: 409,
        started: 409,
        self: 403,
        duplicate: 409,
        full: 409,
      }
      const message: Record<Exclude<typeof outcome.kind, 'ok'>, string> = {
        notFound: 'Class not found',
        cancelled: 'This class has been cancelled by the teacher.',
        started: 'This class has already started — reservations are closed.',
        self: 'You cannot reserve a seat in your own class.',
        duplicate: 'You already hold a seat in this class.',
        full: 'All seats are taken — check back if someone cancels.',
      }
      return NextResponse.json({ error: message[outcome.kind] }, { status: status[outcome.kind] })
    }

    return NextResponse.json(
      {
        booking: toMyBookingDTO(outcome.booking, outcome.session, outcome.session.teacherProfile.teachingName),
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/teach/classes/:id/book POST]', err)
    return NextResponse.json({ error: 'Could not reserve your seat — please try again.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const { id } = await params
    const now = new Date()

    const outcome = await db.$transaction(async (tx: Tx) => {
      // Ownership is inherent: the booking is looked up by (class, session user) —
      // another student's booking is simply not reachable here.
      const booking = await tx.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId: id, studentId: student.id } },
        include: { classSession: { select: { id: true, startsAt: true, status: true } } },
      })
      if (!booking || booking.status === 'CANCELLED') return { kind: 'notFound' as const }
      if (booking.classSession.status === 'CANCELLED') return { kind: 'notFound' as const }
      // Cancellation window: strictly before the scheduled start.
      if (booking.classSession.startsAt.getTime() <= now.getTime()) {
        return { kind: 'windowClosed' as const }
      }
      const updated = await tx.classBooking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', cancelledAt: now, updatedAt: now },
      })
      // Atomically release the seat (no-op safe against double release).
      await tx.$executeRawUnsafe(SEAT_RELEASE_SQL, now.getTime(), id)
      return { kind: 'ok' as const, booking: updated, session: booking.classSession }
    })

    if (outcome.kind !== 'ok') {
      const message = outcome.kind === 'windowClosed'
        ? 'The cancellation window has closed — this class has already started.'
        : 'No active reservation found for this class.'
      return NextResponse.json({ error: message }, { status: outcome.kind === 'windowClosed' ? 409 : 404 })
    }

    return NextResponse.json({ booking: { id: outcome.booking.id, status: outcome.booking.status } })
  } catch (err) {
    console.error('[api/teach/classes/:id/book DELETE]', err)
    return NextResponse.json({ error: 'Could not cancel your reservation — please try again.' }, { status: 500 })
  }
}
