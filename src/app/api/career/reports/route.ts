// ─── Phase 7: Career safety reports (private) ────────────────────────────────
// POST files a private report against an opportunity or organization. Reports
// NEVER auto-suspend anything — enforcement is a recorded human decision in
// the admin career view. Rate-limited; reporter identity is admin-only.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, countRecentCareer, careerRateLimited } from '@/lib/career'
import { safetyReportSchema } from '@/lib/career-schema'
import { toOwnReportDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const reports = await db.careerSafetyReport.findMany({
      where: { reporterId: student.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ reports: reports.map(toOwnReportDTO) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/career/reports GET]', err)
    return NextResponse.json({ error: 'Could not load your reports.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = safetyReportSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid report details' }, { status: 400 })
    const input = parsed.data

    // The target must exist (opportunity or organization) — no free-form
    // accusations against unidentifiable entities.
    if (input.targetType === 'OPPORTUNITY') {
      const target = await db.careerOpportunity.findUnique({ where: { id: input.targetId }, select: { id: true } })
      if (!target) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    } else {
      const target = await db.organization.findUnique({ where: { id: input.targetId }, select: { id: true } })
      if (!target) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const recent = await countRecentCareer('report', student.id, new Date())
    if (careerRateLimited('REPORTS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Report limit reached for today — please try again tomorrow.' }, { status: 429 })
    }

    const report = await db.$transaction(async tx => {
      const created = await tx.careerSafetyReport.create({
        data: {
          reporterId: student.id,
          targetType: input.targetType,
          targetId: input.targetId,
          category: input.category,
          subject: input.subject,
          description: input.description,
        },
      })
      await appendCareerAudit(tx, {
        entityType: 'SAFETY_REPORT',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'REPORT_FILED',
        detail: `type=${input.targetType},category=${input.category}`,
      })
      return created
    })
    return NextResponse.json(
      { report: { id: report.id, status: report.status, createdAt: report.createdAt.toISOString() } },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/career/reports POST]', err)
    return NextResponse.json({ error: 'Could not file the report.' }, { status: 500 })
  }
}
