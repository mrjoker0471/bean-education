// ─── BEAN Classroom Intelligence (CI-1E): dispute a report's findings ───────
// POST /api/teach/classroom-intelligence/reports/:reportId/dispute — the
// report's owner teacher disputes specific findings. Server verifies every
// disputed finding id exists in the stored report; one open dispute per
// report; the original report is never edited by this endpoint — a human
// admin decides the outcome later.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'
import { ciDisputeSchema } from '@/lib/ci/schemas'
import { CI_DISPUTE_EVENT_ACTION } from '@/lib/ci/constants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { student, profile } = guard
    const { reportId } = await params

    const parsed = ciDisputeSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Provide 1-10 findings, each with the finding id and a reason (20-1000 characters).' },
        { status: 400 },
      )
    }

    // Ownership: the report must belong to the caller's own profile.
    const report = await db.classroomEvaluationReport.findUnique({
      where: { id: reportId },
      select: { id: true, teacherProfileId: true, status: true, reportJson: true },
    })
    if (!report || report.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }
    if (report.status === 'RETRACTED') {
      return NextResponse.json({ error: 'This report is retracted and can no longer be disputed.' }, { status: 409 })
    }

    // Every disputed finding id must actually exist in the report.
    let reportData: { strengths: { findingId: string }[]; improvements: { findingId: string }[]; otherFindings: { findingId: string }[] } | null = null
    try {
      reportData = JSON.parse(report.reportJson)
    } catch {
      return NextResponse.json({ error: 'The stored report could not be read — please request a re-run instead.' }, { status: 409 })
    }
    const knownIds = new Set(
      [...(reportData?.strengths ?? []), ...(reportData?.improvements ?? []), ...(reportData?.otherFindings ?? [])].map((f) => f.findingId),
    )
    const unknown = parsed.data.findings.filter((f) => !knownIds.has(f.findingId))
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown finding id(s): ${unknown.map((f) => f.findingId).join(', ')}` }, { status: 400 })
    }

    // One open dispute per report at a time — transparency over pile-ups.
    const open = await db.classroomEvaluationDispute.findFirst({
      where: { reportId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      select: { id: true },
    })
    if (open) {
      return NextResponse.json({ error: 'This report already has an open dispute under review.' }, { status: 409 })
    }

    const dispute = await db.$transaction(async (tx) => {
      const created = await tx.classroomEvaluationDispute.create({
        data: {
          reportId,
          teacherId: profile.studentId,
          status: 'SUBMITTED',
          findingsJson: JSON.stringify(parsed.data.findings),
        },
      })
      await tx.classroomDisputeEvent.create({
        data: {
          disputeId: created.id,
          actorId: profile.studentId,
          actorRole: student.role,
          action: CI_DISPUTE_EVENT_ACTION.SUBMITTED,
          detail: `Disputed ${parsed.data.findings.length} finding(s): ${parsed.data.findings.map((f) => f.findingId).join(', ')}.`,
        },
      })
      return created
    })

    return NextResponse.json({
      dispute: {
        id: dispute.id,
        reportId,
        status: dispute.status,
        createdAt: dispute.createdAt.toISOString(),
      },
    })
  } catch (err) {
    console.error('[api/teach/classroom-intelligence/reports/:reportId/dispute POST]', err)
    return NextResponse.json({ error: 'Could not submit the dispute.' }, { status: 500 })
  }
}
