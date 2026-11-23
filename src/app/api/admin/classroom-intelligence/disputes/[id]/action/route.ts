// ─── BEAN Classroom Intelligence (CI-1E): admin dispute action ──────────────
// POST /api/admin/classroom-intelligence/disputes/:id/action — ADMIN-only.
//
//   ASSIGN        — take the dispute (append-only event; never silent)
//   UNDER_REVIEW  — mark the human review in progress
//   RESOLVE       — the human decision:
//     UPHELD     findings stand; dispute closes
//     CORRECTED  the report is rebuilt WITHOUT the disputed findings by the
//                deterministic pure orchestrator (no new model output) as a
//                new version; the disputed version becomes SUPERSEDED
//     RETRACTED  the report is marked RETRACTED (hidden from dashboards and
//                aggregates); nothing is silently deleted
//   DISMISS       — close without a report change (documented grounds required)
//
// Every action appends to the append-only dispute history. RESOLVE/DISMISS
// require a note (documented grounds) — decisions are never silent.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireAdmin } from '@/lib/teach'
import { ciDisputeActionSchema } from '@/lib/ci/schemas'
import { buildFinalReport } from '@/lib/ci/agents/orchestrator'
import { parseFinalReport } from '@/lib/ci/schemas'
import type { EvidenceRefSpec } from '@/lib/ci/evidence'
import { CI_DISPUTE_EVENT_ACTION, CI_DISPUTE_RESOLUTION, CI_REPORT_STATUS } from '@/lib/ci/constants'
import type { LearnerOutput, JudgeOutput } from '@/lib/ci/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ActionOutcome =
  | { kind: 'notFound' }
  | { kind: 'invalid'; message: string }
  | { kind: 'rebuildImpossible' }
  | { kind: 'ok'; status: string; resolution?: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireAdmin()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { student } = guard
    const { id } = await params

    const parsedAction = ciDisputeActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsedAction.success) {
      return NextResponse.json({ error: 'Invalid action request.' }, { status: 400 })
    }
    const { action, resolution, note } = parsedAction.data
    if ((action === 'RESOLVE' || action === 'DISMISS') && !note) {
      return NextResponse.json({ error: 'A documented note is required to resolve or dismiss a dispute.' }, { status: 400 })
    }
    if (action === 'RESOLVE' && !resolution) {
      return NextResponse.json({ error: 'A resolution (UPHELD | CORRECTED | RETRACTED) is required.' }, { status: 400 })
    }

    const outcome = await db.$transaction(async (tx): Promise<ActionOutcome> => {
      const dispute = await tx.classroomEvaluationDispute.findUnique({
        where: { id },
        include: {
          report: {
            include: {
              evidenceRefs: { select: { kind: true, refId: true, summary: true, available: true } },
              job: { select: { id: true } },
            },
          },
        },
      })
      if (!dispute) return { kind: 'notFound' }
      if (['RESOLVED', 'DISMISSED'].includes(dispute.status)) {
        return { kind: 'invalid', message: 'This dispute is already closed.' }
      }

      const now = new Date()
      const appendEvent = (actionName: string, detail: string | null) =>
        tx.classroomDisputeEvent.create({
          data: { disputeId: dispute.id, actorId: student.id, actorRole: student.role, action: actionName, detail },
        })

      if (action === 'ASSIGN') {
        await tx.classroomEvaluationDispute.update({
          where: { id: dispute.id },
          data: { assignedAdminId: student.id, status: 'SUBMITTED' },
        })
        await appendEvent(CI_DISPUTE_EVENT_ACTION.ASSIGNED, `Assigned to admin ${student.id}.`)
        return { kind: 'ok', status: 'SUBMITTED' }
      }

      if (action === 'UNDER_REVIEW') {
        await tx.classroomEvaluationDispute.update({
          where: { id: dispute.id },
          data: { status: 'UNDER_REVIEW', assignedAdminId: dispute.assignedAdminId ?? student.id },
        })
        await appendEvent(CI_DISPUTE_EVENT_ACTION.UNDER_REVIEW, note ?? null)
        return { kind: 'ok', status: 'UNDER_REVIEW' }
      }

      if (action === 'DISMISS') {
        await tx.classroomEvaluationDispute.update({
          where: { id: dispute.id },
          data: { status: 'DISMISSED', resolutionNote: note ?? null, resolvedAt: now, resolvedById: student.id },
        })
        await appendEvent(CI_DISPUTE_EVENT_ACTION.DISMISSED, note ?? null)
        return { kind: 'ok', status: 'DISMISSED' }
      }

      // ── RESOLVE ──
      if (resolution === CI_DISPUTE_RESOLUTION.UPHELD) {
        await tx.classroomEvaluationDispute.update({
          where: { id: dispute.id },
          data: { status: 'RESOLVED', resolution, resolutionNote: note ?? null, resolvedAt: now, resolvedById: student.id },
        })
        await appendEvent(CI_DISPUTE_EVENT_ACTION.RESOLVED, `UPHELD — ${note}`)
        return { kind: 'ok', status: 'RESOLVED', resolution }
      }

      if (resolution === CI_DISPUTE_RESOLUTION.RETRACTED) {
        await tx.classroomEvaluationReport.update({
          where: { id: dispute.report.id },
          data: { status: CI_REPORT_STATUS.RETRACTED },
        })
        await tx.classroomEvaluationDispute.update({
          where: { id: dispute.id },
          data: { status: 'RESOLVED', resolution, resolutionNote: note ?? null, resolvedAt: now, resolvedById: student.id },
        })
        await appendEvent(CI_DISPUTE_EVENT_ACTION.RESOLVED, `RETRACTED — ${note}`)
        return { kind: 'ok', status: 'RESOLVED', resolution }
      }

      // resolution === CORRECTED — deterministic rebuild without disputed findings.
      const disputedIds = (JSON.parse(dispute.findingsJson || '[]') as { findingId: string }[]).map((f) => f.findingId)
      const [learnerRun, judgeRun] = await Promise.all([
        tx.classroomAgentRun.findFirst({
          where: { jobId: dispute.report.job.id, agent: 'LEARNER', status: 'COMPLETED' },
          orderBy: { startedAt: 'desc' },
          select: { outputJson: true },
        }),
        tx.classroomAgentRun.findFirst({
          where: { jobId: dispute.report.job.id, agent: 'TEACHER_JUDGE', status: 'COMPLETED' },
          orderBy: { startedAt: 'desc' },
          select: { outputJson: true },
        }),
      ])
      if (!learnerRun?.outputJson || !judgeRun?.outputJson) {
        return { kind: 'rebuildImpossible' }
      }
      let learner: LearnerOutput
      let judge: JudgeOutput
      try {
        learner = JSON.parse(learnerRun.outputJson) as LearnerOutput
        judge = JSON.parse(judgeRun.outputJson) as JudgeOutput
      } catch {
        return { kind: 'rebuildImpossible' }
      }
      const evidenceRefs: EvidenceRefSpec[] = dispute.report.evidenceRefs.map((r) => ({
        kind: r.kind as EvidenceRefSpec['kind'],
        refId: r.refId,
        summary: r.summary,
        available: r.available,
      }))
      const corrected = parseFinalReport(
        buildFinalReport({ evidenceRefs, learner, judge, excludedFindingIds: disputedIds }, now),
      )
      const previous = await tx.classroomEvaluationReport.findMany({
        where: { classSessionId: dispute.report.classSessionId },
        select: { version: true },
      })
      const nextVersion = previous.reduce((m, r) => Math.max(m, r.version), 0) + 1
      await tx.classroomEvaluationReport.create({
        data: {
          jobId: dispute.report.jobId,
          classSessionId: dispute.report.classSessionId,
          teacherProfileId: dispute.report.teacherProfileId,
          version: nextVersion,
          status: CI_REPORT_STATUS.CURRENT,
          reportJson: JSON.stringify(corrected),
          insufficientEvidence: corrected.insufficientEvidence,
          requiresHumanReview: corrected.requiresHumanReview,
          modelId: null, // pure deterministic rebuild — no model output involved
        },
      })
      await tx.classroomEvaluationReport.update({
        where: { id: dispute.report.id },
        data: { status: CI_REPORT_STATUS.SUPERSEDED, supersededAt: now },
      })
      await tx.classroomEvaluationDispute.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED', resolution, resolutionNote: note ?? null, resolvedAt: now, resolvedById: student.id },
      })
      await appendEvent(CI_DISPUTE_EVENT_ACTION.RESOLVED, `CORRECTED — report rebuilt as v${nextVersion} without ${disputedIds.join(', ')}. ${note}`)
      return { kind: 'ok', status: 'RESOLVED', resolution }
    })

    if (outcome.kind === 'notFound') {
      return NextResponse.json({ error: 'Dispute not found.' }, { status: 404 })
    }
    if (outcome.kind === 'invalid') {
      return NextResponse.json({ error: outcome.message }, { status: 409 })
    }
    if (outcome.kind === 'rebuildImpossible') {
      return NextResponse.json(
        { error: 'The corrected rebuild is impossible because the original agent outputs are unavailable — use RETRACTED instead.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ status: outcome.status, resolution: outcome.resolution ?? null })
  } catch (err) {
    console.error('[api/admin/classroom-intelligence/disputes/:id/action POST]', err)
    return NextResponse.json({ error: 'Could not apply the dispute action.' }, { status: 500 })
  }
}
