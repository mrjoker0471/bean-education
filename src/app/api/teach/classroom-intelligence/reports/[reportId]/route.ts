// ─── BEAN Classroom Intelligence (CI-1E): delete a report version ────────────
// DELETE /api/teach/classroom-intelligence/reports/:reportId — the report's
// owner teacher deletes ONE report version (and its evidence register, via
// cascade). Guardrails:
//   • refused while any dispute on THIS report is open (SUBMITTED/UNDER_REVIEW)
//     — dispute history is never destroyed behind an open review;
//   • the deletion is real (row removed), scoped by ownership (404 otherwise),
//     and never touches the class, bookings, attendance or other versions;
//   • student class summaries are job-anchored and are NOT removed by a
//     single-version deletion — the teacher can delete every version or wait
//     for account deletion for full erasure.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard
    const { reportId } = await params

    const report = await db.classroomEvaluationReport.findUnique({
      where: { id: reportId },
      select: { id: true, teacherProfileId: true },
    })
    if (!report || report.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }

    const openDispute = await db.classroomEvaluationDispute.findFirst({
      where: { reportId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      select: { id: true },
    })
    if (openDispute) {
      return NextResponse.json(
        { error: 'This report has an open dispute — the outcome of the human review must be recorded first.' },
        { status: 409 },
      )
    }

    await db.classroomEvaluationReport.delete({ where: { id: reportId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/teach/classroom-intelligence/reports/:reportId DELETE]', err)
    return NextResponse.json({ error: 'Could not delete the report.' }, { status: 500 })
  }
}
