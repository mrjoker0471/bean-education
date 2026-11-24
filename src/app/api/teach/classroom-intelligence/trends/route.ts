// ─── BEAN Classroom Intelligence (CI-2C): teacher improvement trends ─────────
// GET /api/teach/classroom-intelligence/trends — the teacher's own longitudinal
// view across their CURRENT, non-retracted evaluation reports. Ownership: the
// approved TeacherProfile is resolved from the session cookie; the query is
// scoped by teacherProfileId — never a client-supplied id.
//
// The aggregation itself is the PURE, DETERMINISTIC buildTeacherTrends() — no
// model call, no invented analytics. Sample-size gates, per-subject grouping
// and missing-evidence separation are enforced there (see trends.ts).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApprovedTeacher } from '@/lib/teach'
import { buildTeacherTrends, type TrendReportInput } from '@/lib/ci/trends'
import { finalReportSchema, type FinalReport } from '@/lib/ci/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard

    // Only CURRENT, non-retracted reports feed trends (RETRACTED rows are
    // excluded from every aggregate; superseded history stays open to the
    // teacher through the per-class evaluation view and the dispute process).
    const rows = await db.classroomEvaluationReport.findMany({
      where: { teacherProfileId: profile.id, status: 'CURRENT' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        version: true,
        createdAt: true,
        reportJson: true,
        job: { select: { classSession: { select: { subject: true } } } },
      },
    })

    const inputs: TrendReportInput[] = []
    for (const row of rows) {
      // Defensive: only schema-valid reports feed trends — a malformed or
      // structurally invalid stored row is skipped honestly, never guessed.
      let parsedReport: FinalReport | null = null
      try {
        const candidate = finalReportSchema.safeParse(JSON.parse(row.reportJson ?? 'null'))
        if (candidate.success) parsedReport = candidate.data
      } catch {
        // fall through with parsedReport = null
      }
      if (!parsedReport) continue
      inputs.push({
        reportId: row.id,
        version: row.version,
        createdAtIso: row.createdAt.toISOString(),
        subject: row.job.classSession.subject,
        report: parsedReport,
      })
    }

    const trends = buildTeacherTrends(inputs)
    return NextResponse.json({
      trends,
      generatedAt: new Date().toISOString(),
      scopeNote:
        'Trends are advisory, computed only from your own classroom evaluation reports. They are not visible to students, never part of public ratings or rankings, and every number shows how many evaluated classes stand behind it. You can dispute any underlying finding from the report view.',
    })
  } catch (err) {
    console.error('[api/teach/classroom-intelligence/trends GET]', err)
    return NextResponse.json({ error: 'Could not load your teaching trends.' }, { status: 500 })
  }
}
