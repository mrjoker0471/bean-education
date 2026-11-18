// ─── BEAN Trust & Quality (Phase 6): appeal review and decision ──────────────
// POST /api/admin/trust/appeals/:appealId/action — ADMIN-only.
//   ASSIGN — assign an ADMIN reviewer (event ASSIGNED).
//   DECIDE — UPHELD (original decision stands) or OVERTURNED (documented
//            restoration). Rules enforced server-side:
//              • a reviewer must be assigned first;
//              • only the assigned reviewer may decide;
//              • the deciding admin may NOT be the admin who made the
//                original decision (originalDecisionById captured at appeal
//                creation) — self-review and self-approval are prohibited;
//              • a written explanation is mandatory.
//   OVERTURNED applies a DOCUMENTED restoration — it never silently rewrites
//   the original investigation:
//     REVIEW_MODERATION    → the hidden review returns to PUBLISHED (audited).
//     TRUST_ACTION         → that restriction is deactivated (audited).
//     COMPLAINT_DECISION   → the complaint returns to UNDER_REVIEW with an
//                            event; the original RESOLVED/DISMISSED events
//                            remain in the append-only history.
//   Appeals never create payments or refunds.
//   CLOSE_WITHOUT_DECISION — admin closes without a decision (event CLOSED).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import {
  APPEAL_STATUS,
  APPEAL_TARGET,
} from '@/lib/trust'
import { adminAppealActionSchema } from '@/lib/trust-schema'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function POST(req: NextRequest, { params }: { params: Promise<{ appealId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json().catch(() => null)
    const parsed = adminAppealActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid action' }, { status: 400 })
    }

    const { appealId } = await params
    const { action, reviewerId, decision, decisionNote } = parsed.data
    const now = new Date()

    if (action === 'ASSIGN') {
      const target = await db.student.findUnique({ where: { id: reviewerId! }, select: { role: true } })
      if (!target || target.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Appeals can only be assigned to BEAN administrators.' }, { status: 400 })
      }
      const outcome = await db.$transaction(async (tx: Tx) => {
        const appeal = await tx.teachAppeal.findUnique({ where: { id: appealId } })
        if (!appeal) return { kind: 'notFound' as const }
        if (appeal.status !== APPEAL_STATUS.SUBMITTED && appeal.status !== APPEAL_STATUS.UNDER_REVIEW) {
          return { kind: 'closed' as const }
        }
        await tx.teachAppeal.update({
          where: { id: appeal.id },
          data: {
            assignedReviewerId: reviewerId!,
            ...(appeal.status === APPEAL_STATUS.SUBMITTED ? { status: APPEAL_STATUS.UNDER_REVIEW } : {}),
          },
        })
        await tx.appealEvent.create({
          data: {
            appealId: appeal.id,
            actorId: guard.student.id,
            actorRole: guard.student.role,
            action: 'ASSIGNED',
            detail: `reviewer=${reviewerId}`,
          },
        })
        return { kind: 'ok' as const }
      })
      if (outcome.kind !== 'ok') {
        return NextResponse.json(
          { error: outcome.kind === 'notFound' ? 'Appeal not found' : 'This appeal is already decided.' },
          { status: outcome.kind === 'notFound' ? 404 : 409 },
        )
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'DECIDE') {
      const outcome = await db.$transaction(async (tx: Tx) => {
        const appeal = await tx.teachAppeal.findUnique({ where: { id: appealId } })
        if (!appeal) return { kind: 'notFound' as const, code: 404 }
        if (appeal.status !== APPEAL_STATUS.SUBMITTED && appeal.status !== APPEAL_STATUS.UNDER_REVIEW) {
          return { kind: 'conflict' as const, code: 409, message: 'This appeal is already decided.' }
        }
        if (!appeal.assignedReviewerId) {
          return { kind: 'conflict' as const, code: 409, message: 'Assign a reviewer before deciding.' }
        }
        // Only the assigned reviewer may decide.
        if (appeal.assignedReviewerId !== guard.student.id) {
          return { kind: 'forbidden' as const, code: 403, message: 'Only the assigned reviewer can decide this appeal.' }
        }
        // Self-review ban: the deciding admin must differ from the admin who
        // made the original decision (server-captured at appeal creation).
        if (appeal.originalDecisionById && appeal.originalDecisionById === guard.student.id) {
          return {
            kind: 'forbidden' as const,
            code: 403,
            message: 'You made the original decision — another administrator must review this appeal.',
          }
        }

        if (decision === 'OVERTURNED') {
          // Documented restoration per target type.
          if (appeal.targetType === APPEAL_TARGET.REVIEW_MODERATION) {
            const review = await tx.classReview.findUnique({ where: { id: appeal.targetId } })
            if (review && review.status === 'HIDDEN') {
              await tx.classReview.update({
                where: { id: review.id },
                data: { status: 'PUBLISHED', moderatedAt: now, moderationReason: `Appeal ${appeal.id} overturned the hiding decision` },
              })
              await appendAudit(tx, {
                entityType: 'CLASS_REVIEW',
                entityId: review.id,
                actorId: guard.student.id,
                actorRole: guard.student.role,
                action: 'REVIEW_RESTORED',
                detail: `appeal ${appeal.id} overturned`,
              })
            }
          } else if (appeal.targetType === APPEAL_TARGET.TRUST_ACTION) {
            const actionRow = await tx.trustAction.findUnique({ where: { id: appeal.targetId } })
            if (actionRow && actionRow.isActive) {
              await tx.trustAction.update({
                where: { id: actionRow.id },
                data: { isActive: false, endedAt: now, endedById: guard.student.id },
              })
              await appendAudit(tx, {
                entityType: 'TRUST_ACTION',
                entityId: actionRow.id,
                actorId: guard.student.id,
                actorRole: guard.student.role,
                action: 'TRUST_REINSTATE',
                detail: `appeal ${appeal.id} overturned the action`,
              })
            }
          } else if (appeal.targetType === APPEAL_TARGET.COMPLAINT_DECISION) {
            const complaint = await tx.teachComplaint.findUnique({ where: { id: appeal.targetId } })
            if (complaint && (complaint.status === 'RESOLVED' || complaint.status === 'DISMISSED')) {
              // Re-open for another review — original decision events remain
              // in the append-only history (nothing is overwritten).
              await tx.teachComplaint.update({
                where: { id: complaint.id },
                data: { status: 'UNDER_REVIEW', resolvedAt: null, updatedAt: now },
              })
              await tx.complaintEvent.create({
                data: {
                  complaintId: complaint.id,
                  actorId: guard.student.id,
                  actorRole: guard.student.role,
                  action: 'UNDER_REVIEW',
                  detail: `Re-opened by appeal ${appeal.id} (OVERTURNED)`,
                },
              })
            }
          }
        }

        await tx.teachAppeal.update({
          where: { id: appeal.id },
          data: {
            status: decision === 'OVERTURNED' ? APPEAL_STATUS.OVERTURNED : APPEAL_STATUS.UPHELD,
            decision,
            decisionNote: decisionNote!,
            decidedAt: now,
          },
        })
        await tx.appealEvent.create({
          data: {
            appealId: appeal.id,
            actorId: guard.student.id,
            actorRole: guard.student.role,
            action: 'DECIDED',
            detail: `${decision}: ${decisionNote}`,
          },
        })
        return { kind: 'ok' as const }
      })

      if (outcome.kind !== 'ok') {
        return NextResponse.json(
          { error: 'message' in outcome ? outcome.message : 'Appeal not found' },
          { status: outcome.code },
        )
      }
      return NextResponse.json({ ok: true, decision })
    }

    // CLOSE_WITHOUT_DECISION
    const outcome = await db.$transaction(async (tx: Tx) => {
      const appeal = await tx.teachAppeal.findUnique({ where: { id: appealId } })
      if (!appeal) return { kind: 'notFound' as const }
      if (appeal.status !== APPEAL_STATUS.SUBMITTED && appeal.status !== APPEAL_STATUS.UNDER_REVIEW) {
        return { kind: 'conflict' as const }
      }
      await tx.teachAppeal.update({
        where: { id: appeal.id },
        data: { status: APPEAL_STATUS.CLOSED, decidedAt: now },
      })
      await tx.appealEvent.create({
        data: {
          appealId: appeal.id,
          actorId: guard.student.id,
          actorRole: guard.student.role,
          action: 'CLOSED',
          detail: decisionNote ?? null,
        },
      })
      return { kind: 'ok' as const }
    })
    if (outcome.kind !== 'ok') {
      return NextResponse.json(
        { error: outcome.kind === 'notFound' ? 'Appeal not found' : 'This appeal is already decided.' },
        { status: outcome.kind === 'notFound' ? 404 : 409 },
      )
    }
    return NextResponse.json({ ok: true, decision: 'CLOSED' })
  } catch (err) {
    console.error('[api/admin/trust/appeals/:appealId/action POST]', err)
    return NextResponse.json({ error: 'Could not record the appeal action — please try again.' }, { status: 500 })
  }
}
