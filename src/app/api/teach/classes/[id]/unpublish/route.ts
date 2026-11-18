// ─── BEAN Teach (Phase 4A): unpublish a class ────────────────────────────────
// POST /api/teach/classes/:id/unpublish — approved owner teacher only.
// Safe unpublish: allowed only while NO seat is held (no active bookings) —
// students must never lose a reservation through an unpublish. Otherwise 409
// with guidance to cancel the class instead (which notifies booked students).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher, toPublicClass } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { profile } = guard

    const { id } = await params
    const session = await db.classSession.findUnique({ where: { id } })
    if (!session || session.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    if (session.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Only published classes can be unpublished.' }, { status: 409 })
    }
    const heldSeats = await db.classBooking.count({
      where: { classSessionId: session.id, status: { not: 'CANCELLED' } },
    })
    if (heldSeats > 0) {
      return NextResponse.json(
        { error: `${heldSeats} seat(s) are reserved — cancel the class instead so students are informed.` },
        { status: 409 },
      )
    }

    const updated = await db.classSession.update({
      where: { id: session.id },
      data: { status: 'DRAFT', publishedAt: null },
    })
    return NextResponse.json({ class: toPublicClass(updated, profile) })
  } catch (err) {
    console.error('[api/teach/classes/:id/unpublish POST]', err)
    return NextResponse.json({ error: 'Could not unpublish the class — please try again.' }, { status: 500 })
  }
}
