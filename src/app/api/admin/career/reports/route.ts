// ─── Phase 7: Admin — career safety reports queue ────────────────────────────
// GET lists candidate/employer safety reports for the moderation workbench,
// newest first. Status filter: OPEN | UNDER_REVIEW | RESOLVED | DISMISSED
// (default OPEN) or ALL. Report descriptions stay admin-private — they are
// never surfaced to the reported party through this queue. Nothing here
// auto-suspends anyone: decisions happen on the per-report action route and
// are audited there.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REPORT_STATUSES = ['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] as const
const QUEUE_PAGE_SIZE = 100

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const statusRaw = (req.nextUrl.searchParams.get('status') ?? '').trim().toUpperCase()
    if (statusRaw && statusRaw !== 'ALL' && !(REPORT_STATUSES as readonly string[]).includes(statusRaw)) {
      return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 })
    }

    const where = statusRaw && statusRaw !== 'ALL' ? { status: statusRaw } : {}
    const [rows, total] = await Promise.all([
      db.careerSafetyReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: QUEUE_PAGE_SIZE,
      }),
      db.careerSafetyReport.count({ where }),
    ])

    return NextResponse.json(
      {
        reports: rows.map(r => ({
          id: r.id,
          reporterId: r.reporterId,
          targetType: r.targetType,
          targetId: r.targetId,
          category: r.category,
          subject: r.subject,
          description: r.description,
          status: r.status,
          assignedAdminId: r.assignedAdminId,
          resolutionNote: r.resolutionNote,
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/admin/career/reports GET]', err)
    return NextResponse.json({ error: 'Could not load safety reports.' }, { status: 500 })
  }
}
