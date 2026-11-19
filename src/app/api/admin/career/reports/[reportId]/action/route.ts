// ─── Phase 7: Admin — career safety report decision ──────────────────────────
// POST records a human decision (acknowledge/investigate/resolve/dismiss with
// note) and, where justified, restricts the opportunity (pause) — a report
// NEVER auto-suspends anything. Report descriptions and resolution notes stay
// admin-private. The reports listing lives at /api/admin/career/reports.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, OPPORTUNITY_STATUS, SAFETY_REPORT_STATUS } from '@/lib/career'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ reportId: string }> }

const actionSchema = z.object({
  action: z.enum(['ACKNOWLEDGE', 'INVESTIGATE', 'RESOLVE', 'DISMISS', 'PAUSE_OPPORTUNITY']),
  note: z.string().trim().max(2000).optional(),
})

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { reportId } = await params
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = actionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid report action' }, { status: 400 })
    const { action, note } = parsed.data
    if ((action === 'RESOLVE' || action === 'DISMISS') && (!note || note.length < 10)) {
      return NextResponse.json({ error: 'A written note (10+ characters) is required to resolve or dismiss.' }, { status: 400 })
    }

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const report = await tx.careerSafetyReport.findUnique({ where: { id: reportId } })
      if (!report) return { kind: 'notFound' as const }
      // Terminal-state freeze: RESOLVED / DISMISSED are final human decisions.
      // Nothing (not even another pause) may act on a closed report — the UI
      // hides the buttons and the server refuses with 409 (no client trust).
      if (report.status === SAFETY_REPORT_STATUS.RESOLVED || report.status === SAFETY_REPORT_STATUS.DISMISSED) {
        return { kind: 'conflict' as const, current: report.status }
      }

      let opportunityPaused = false
      if (action === 'PAUSE_OPPORTUNITY') {
        if (!note || note.length < 10) {
          return { kind: 'badRequest' as const, error: 'A written reason is required to pause a listing.' }
        }
        if (report.targetType !== 'OPPORTUNITY') {
          return { kind: 'badRequest' as const, error: 'This report does not target an opportunity.' }
        }
        const opportunity = await tx.careerOpportunity.findUnique({ where: { id: report.targetId } })
        if (opportunity && opportunity.status === OPPORTUNITY_STATUS.PUBLISHED) {
          await tx.careerOpportunity.update({
            where: { id: opportunity.id },
            data: { status: OPPORTUNITY_STATUS.PAUSED, reviewedByAdminId: guard.student.id, reviewedAt: new Date() },
          })
          await appendCareerAudit(tx, {
            entityType: 'OPPORTUNITY',
            entityId: opportunity.id,
            actorId: guard.student.id,
            actorRole: guard.student.role,
            action: 'OPPORTUNITY_PAUSED',
            detail: `safetyReport=${report.id},reason=${note.slice(0, 300)}`,
          })
          opportunityPaused = true
        }
      }

      const statusMap: Record<string, string> = {
        ACKNOWLEDGE: SAFETY_REPORT_STATUS.UNDER_REVIEW,
        INVESTIGATE: SAFETY_REPORT_STATUS.UNDER_REVIEW,
        RESOLVE: SAFETY_REPORT_STATUS.RESOLVED,
        DISMISS: SAFETY_REPORT_STATUS.DISMISSED,
      }
      const updated = action === 'PAUSE_OPPORTUNITY'
        ? report
        : await tx.careerSafetyReport.update({
            where: { id: reportId },
            data: {
              status: statusMap[action],
              assignedAdminId: guard.student.id,
              resolutionNote: note ?? undefined,
              resolvedAt: action === 'RESOLVE' || action === 'DISMISS' ? new Date() : undefined,
            },
          })
      await appendCareerAudit(tx, {
        entityType: 'SAFETY_REPORT',
        entityId: reportId,
        actorId: guard.student.id,
        actorRole: guard.student.role,
        action: `REPORT_${action}`,
        detail: note ? `note=${note.slice(0, 300)}` : null,
      })
      return { kind: 'ok' as const, report: updated, opportunityPaused }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ report: { id: outcome.report.id, status: outcome.report.status }, opportunityPaused: outcome.opportunityPaused })
      case 'notFound':
        return NextResponse.json({ error: 'Report not found' }, { status: 404 })
      case 'conflict':
        return NextResponse.json({ error: `This report is already ${outcome.current.toLowerCase()} — its decision is final.` }, { status: 409 })
      case 'badRequest':
        return NextResponse.json({ error: outcome.error }, { status: 400 })
    }
  } catch (err) {
    console.error('[api/admin/career/reports/[reportId]/action POST]', err)
    return NextResponse.json({ error: 'Could not record the report action.' }, { status: 500 })
  }
}
