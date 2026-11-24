// ─── BEAN Classroom Intelligence (CI-2E): admin report inspection ────────────
// GET /api/admin/classroom-intelligence/reports/:reportId — ADMIN-only. The
// review workspace needs the ORIGINAL evaluation: the stored report JSON (all
// versions of the record), the evidence register, and the agent runs (the
// Learner/Judge outputs and any errors) so an administrator can judge a
// dispute against what the system actually produced.
//
// No report is modified here. Read-only; everything below is already stored.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { parseStoredReport } from '@/lib/ci/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { reportId } = await params

    const report = await db.classroomEvaluationReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        version: true,
        status: true,
        reportJson: true,
        insufficientEvidence: true,
        requiresHumanReview: true,
        modelId: true,
        createdAt: true,
        supersededAt: true,
        classSessionId: true,
        teacherProfileId: true,
        job: {
          select: {
            id: true,
            status: true,
            stage: true,
            trigger: true,
            attempts: true,
            error: true,
            classSession: { select: { id: true, title: true, subject: true, startsAt: true, timeZone: true } },
          },
        },
        evidenceRefs: { select: { kind: true, refId: true, summary: true, available: true } },
        disputes: {
          select: {
            id: true,
            status: true,
            findingsJson: true,
            resolution: true,
            createdAt: true,
          },
        },
      },
    })
    if (!report) {
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
    }

    const agentRuns = await db.classroomAgentRun.findMany({
      where: { jobId: report.job.id },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        agent: true,
        status: true,
        attempt: true,
        modelId: true,
        error: true,
        outputJson: true,
        startedAt: true,
        durationMs: true,
      },
    })

    // Agent outputs are included for the review workspace but truncated to a
    // sane size — the full outputs stay in the append-only audit rows.
    const parsed = parseStoredReport(report.reportJson)

    return NextResponse.json({
      report: {
        id: report.id,
        version: report.version,
        status: report.status,
        insufficientEvidence: report.insufficientEvidence,
        requiresHumanReview: report.requiresHumanReview,
        modelId: report.modelId,
        createdAt: report.createdAt.toISOString(),
        supersededAt: report.supersededAt?.toISOString() ?? null,
        report: parsed.report,
        reportError: parsed.reportError,
        classSession: {
          id: report.job.classSession.id,
          title: report.job.classSession.title,
          subject: report.job.classSession.subject,
          startsAt: report.job.classSession.startsAt.toISOString(),
          timeZone: report.job.classSession.timeZone,
        },
        job: {
          id: report.job.id,
          status: report.job.status,
          stage: report.job.stage,
          trigger: report.job.trigger,
          attempts: report.job.attempts,
          error: report.job.error,
        },
        evidenceRefs: report.evidenceRefs,
        disputes: report.disputes.map((d) => ({
          id: d.id,
          status: d.status,
          findingsJson: d.findingsJson,
          resolution: d.resolution,
          createdAt: d.createdAt.toISOString(),
        })),
        agentRuns: agentRuns.map((r) => ({
          id: r.id,
          agent: r.agent,
          status: r.status,
          attempt: r.attempt,
          modelId: r.modelId,
          error: r.error,
          startedAt: r.startedAt.toISOString(),
          durationMs: r.durationMs,
          outputPreview: r.outputJson ? r.outputJson.slice(0, 4000) : null,
        })),
      },
    })
  } catch (err) {
    console.error('[api/admin/classroom-intelligence/reports/:reportId GET]', err)
    return NextResponse.json({ error: 'Could not load the report.' }, { status: 500 })
  }
}
