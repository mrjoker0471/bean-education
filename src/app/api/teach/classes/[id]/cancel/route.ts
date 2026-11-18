// ─── BEAN Teach (Phase 4A): cancel a class (teacher owner or admin) ──────────
// POST /api/teach/classes/:id/cancel — the owner teacher or an ADMIN.
// Transactional: the class becomes CANCELLED, every seat-holding booking is
// cancelled (students see the cancellation in My bookings), and bookedCount is
// reset to 0. The cancellation is audited in the append-only TeachAuditEvent
// trail (actor, role, time). Draft classes are simply deleted-adjacent —
// cancelling a draft makes no sense, so drafts return 409 (edit/delete instead).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { appendAudit, AUDIT_ACTION, AUDIT_ENTITY } from '@/lib/teach'
import { hasRole } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const { id } = await params
    const session = await db.classSession.findUnique({
      include: { teacherProfile: { select: { id: true, studentId: true, teachingName: true } } },
      where: { id },
    })
    if (!session) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    const isAdmin = hasRole(student.role, ['ADMIN'])
    const isOwner = session.teacherProfile.studentId === student.id
    if (!isAdmin && !isOwner) {
      // 404, not 403: do not reveal classes the caller has no relationship with.
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    if (session.status === 'CANCELLED') {
      return NextResponse.json({ error: 'This class is already cancelled.' }, { status: 409 })
    }
    if (session.status === 'COMPLETED') {
      return NextResponse.json({ error: 'A completed class cannot be cancelled.' }, { status: 409 })
    }
    if (session.status === 'DRAFT') {
      return NextResponse.json({ error: 'Draft classes are not published — edit or discard the draft instead.' }, { status: 409 })
    }

    const now = new Date()
    const cancelled = await db.$transaction(async (tx: Tx) => {
      // Cancel every seat-holding booking so affected students are informed
      // through My bookings (and seat counts stay consistent).
      const affected = await tx.classBooking.updateMany({
        where: { classSessionId: id, status: { not: 'CANCELLED' } },
        data: { status: 'CANCELLED', cancelledAt: now, updatedAt: now },
      })
      const row = await tx.classSession.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: now, bookedCount: 0 },
      })
      await appendAudit(tx, {
        entityType: AUDIT_ENTITY.CLASS_SESSION,
        entityId: id,
        actorId: student.id,
        actorRole: student.role,
        action: AUDIT_ACTION.CLASS_CANCELLED,
        detail: `${affected.count} reservation(s) were released when the class was cancelled.`,
      })
      return { row, affected: affected.count }
    })

    return NextResponse.json({
      class: {
        id: cancelled.row.id,
        status: cancelled.row.status,
        cancelledAt: cancelled.row.cancelledAt?.toISOString() ?? null,
        releasedBookings: cancelled.affected,
      },
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/cancel POST]', err)
    return NextResponse.json({ error: 'Could not cancel the class — please try again.' }, { status: 500 })
  }
}
