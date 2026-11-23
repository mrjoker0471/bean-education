// ─── BEAN Classroom Intelligence (CI-1E): teacher disputes ───────────────────
// GET /api/teach/classroom-intelligence/disputes — the teacher's own disputes
// with their append-only history.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApprovedTeacher } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard

    const disputes = await db.classroomEvaluationDispute.findMany({
      where: { teacherId: profile.studentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        reportId: true,
        status: true,
        findingsJson: true,
        resolution: true,
        resolutionNote: true,
        resolvedAt: true,
        createdAt: true,
        report: {
          select: {
            version: true,
            job: { select: { classSession: { select: { id: true, title: true } } } },
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
        reportId: d.reportId,
        reportVersion: d.report.version,
        classTitle: d.report.job.classSession.title,
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
    console.error('[api/teach/classroom-intelligence/disputes GET]', err)
    return NextResponse.json({ error: 'Could not load your disputes.' }, { status: 500 })
  }
}
