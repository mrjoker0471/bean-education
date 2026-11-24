// ─── BEAN Classroom Intelligence (CI-2E): teacher reconsideration (appeal) ──
// POST /api/teach/classroom-intelligence/disputes/:id/reconsider — the
// dispute's owner teacher requests ONE reconsideration of a closed dispute
// (RESOLVED or DISMISSED). Rules:
//   • ownership: only the teacher who opened the dispute can request it;
//   • at most ONE reconsideration per dispute (checked against the
//     append-only event history — a second request is refused 409);
//   • a documented note (20-1000 chars) is mandatory — appeals are never
//     silent;
//   • the dispute returns to SUBMITTED with the previous assignee cleared;
//   • GOVERNANCE: the administrator whose decision is being reconsidered is
//     recorded in the event history, and the admin action route refuses that
//     administrator (and any AI process) from deciding the reconsidered case.
//     Every step appends to the append-only history; nothing is rewritten.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'
import { CI_DISPUTE_EVENT_ACTION } from '@/lib/ci/constants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

    const body = (await req.json().catch(() => null)) as { note?: unknown } | null
    const note = typeof body?.note === 'string' ? body.note.trim() : ''
    if (note.length < 20 || note.length > 1000) {
      return NextResponse.json({ error: 'A reconsideration note of 20-1000 characters is required.' }, { status: 400 })
    }

    const dispute = await db.classroomEvaluationDispute.findUnique({
      where: { id },
      select: {
        id: true,
        teacherId: true,
        status: true,
        resolvedById: true,
        report: { select: { id: true, teacherProfileId: true, status: true } },
        events: { select: { action: true }, orderBy: { createdAt: 'asc' } },
      },
    })
    if (!dispute || dispute.teacherId !== profile.studentId) {
      return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 })
    }
    if (!['RESOLVED', 'DISMISSED'].includes(dispute.status)) {
      return NextResponse.json({ error: 'Only a resolved or dismissed dispute can be reconsidered.' }, { status: 409 })
    }
    if (dispute.events.some((e) => e.action === CI_DISPUTE_EVENT_ACTION.RECONSIDER_REQUESTED)) {
      return NextResponse.json(
        { error: 'This dispute has already had its one reconsideration — the current decision stands or a fresh dispute may be filed on a later report version.' },
        { status: 409 },
      )
    }

    const updated = await db.$transaction(async (tx) => {
      await tx.classroomDisputeEvent.create({
        data: {
          disputeId: dispute.id,
          actorId: student.id,
          actorRole: student.role,
          action: CI_DISPUTE_EVENT_ACTION.RECONSIDER_REQUESTED,
          detail: `Teacher requested reconsideration of the ${dispute.status.toLowerCase()} decision (original decider: ${dispute.resolvedById ?? 'unknown'}). Grounds: ${note}`,
        },
      })
      return tx.classroomEvaluationDispute.update({
        where: { id: dispute.id },
        data: { status: 'SUBMITTED', assignedAdminId: null },
      })
    })

    return NextResponse.json({
      dispute: { id: updated.id, status: updated.status, createdAt: updated.createdAt.toISOString() },
      note: 'A different administrator will review this reconsideration; the original decision-maker is barred from reviewing it.',
    })
  } catch (err) {
    console.error('[api/teach/classroom-intelligence/disputes/:id/reconsider POST]', err)
    return NextResponse.json({ error: 'Could not submit the reconsideration.' }, { status: 500 })
  }
}
