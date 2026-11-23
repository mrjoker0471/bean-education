// ─── BEAN Classroom Intelligence (CI-1E): admin dispute queue ────────────────
// GET /api/admin/classroom-intelligence/disputes — ADMIN-only queue of teacher
// disputes against AI report findings. AI reports are advisory evidence: this
// queue is where a HUMAN decides whether disputed findings stand (UPHELD),
// the report is rebuilt without them (CORRECTED), or the report is retracted.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const disputes = await db.classroomEvaluationDispute.findMany({
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        id: true,
        status: true,
        findingsJson: true,
        resolution: true,
        resolutionNote: true,
        resolvedAt: true,
        createdAt: true,
        assignedAdminId: true,
        teacherId: true,
        report: {
          select: {
            id: true,
            version: true,
            status: true,
            requiresHumanReview: true,
            job: { select: { classSession: { select: { id: true, title: true, subject: true } } } },
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, action: true, detail: true, actorRole: true, createdAt: true },
        },
      },
    })

    return NextResponse.json({
      disputes: disputes.map((d) => ({
        id: d.id,
        reportId: d.report.id,
        reportVersion: d.report.version,
        reportStatus: d.report.status,
        classTitle: d.report.job.classSession.title,
        classSubject: d.report.job.classSession.subject,
        requiresHumanReview: d.report.requiresHumanReview,
        teacherId: d.teacherId,
        assignedAdminId: d.assignedAdminId,
        status: d.status,
        findings: JSON.parse(d.findingsJson || '[]') as { findingId: string; reason: string }[],
        resolution: d.resolution,
        resolutionNote: d.resolutionNote,
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        events: d.events.map((e) => ({ id: e.id, action: e.action, detail: e.detail, actorRole: e.actorRole, createdAt: e.createdAt.toISOString() })),
      })),
    })
  } catch (err) {
    console.error('[api/admin/classroom-intelligence/disputes GET]', err)
    return NextResponse.json({ error: 'Could not load the dispute queue.' }, { status: 500 })
  }
}
