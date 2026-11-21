// ─── BEAN Trust & Quality (Phase 6): admin complaint case actions ────────────
// POST /api/admin/trust/complaints/:id/action — ADMIN-only investigation
// workflow. Every action appends exactly one event inside the same
// transaction as any state change; identical repeat requests are idempotent
// no-ops (no duplicate events). Adverse consequences (trust actions) are
// NEVER automatic here — an investigation ends in a documented decision, and
// any restriction is a separate, explicitly issued TrustAction.
//
//   ACKNOWLEDGE  OPEN → ACKNOWLEDGED
//   START_REVIEW → UNDER_REVIEW
//   REQUEST_INFO → WAITING_FOR_INFORMATION (+ note)
//   NOTE         internal note (status unchanged; complainant sees redacted)
//   ASSIGN       set assignedAdminId (+ event)
//   ESCALATE     severity → CRITICAL (+ event; safeguarding priority)
//   RESOLVE      decided (+ mandatory reason; resolvedAt; event)
//   DISMISS      decided without action (+ mandatory reason; resolvedAt)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { COMPLAINT_SEVERITY, COMPLAINT_STATUS } from '@/lib/trust'
import { adminComplaintActionSchema } from '@/lib/trust-schema'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

/** Map an action to (next status | event action); null event = idempotent no-op. */
function plan(
  action: string,
  current: string,
): { status: string | null; event: string | null } {
  switch (action) {
    case 'ACKNOWLEDGE':
      return current === COMPLAINT_STATUS.OPEN
        ? { status: COMPLAINT_STATUS.ACKNOWLEDGED, event: 'ACKNOWLEDGED' }
        : { status: null, event: null }
    case 'START_REVIEW':
      return current === COMPLAINT_STATUS.ACKNOWLEDGED || current === COMPLAINT_STATUS.OPEN
        ? { status: COMPLAINT_STATUS.UNDER_REVIEW, event: 'UNDER_REVIEW' }
        : { status: null, event: null }
    case 'REQUEST_INFO':
      return { status: COMPLAINT_STATUS.WAITING_FOR_INFORMATION, event: 'WAITING_FOR_INFORMATION' }
    case 'NOTE':
      return { status: null, event: 'NOTE_ADDED' }
    case 'ASSIGN':
      return { status: null, event: 'ASSIGNMENT_CHANGED' }
    case 'ESCALATE':
      return { status: null, event: 'ESCALATED' }
    case 'RESOLVE':
      return { status: COMPLAINT_STATUS.RESOLVED, event: 'RESOLVED' }
    case 'DISMISS':
      return { status: COMPLAINT_STATUS.DISMISSED, event: 'DISMISSED' }
    default:
      return { status: null, event: null }
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json().catch(() => null)
    const parsed = adminComplaintActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid action' }, { status: 400 })
    }

    const { id } = await params
    const { action, note, assignedAdminId } = parsed.data
    const now = new Date()

    // ASSIGN target must be an actual ADMIN (assignment to a non-admin would
    // silently break the authorization model).
    if (action === 'ASSIGN' && assignedAdminId) {
      const target = await db.student.findUnique({ where: { id: assignedAdminId }, select: { role: true } })
      if (!target || target.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Cases can only be assigned to BEAN administrators.' }, { status: 400 })
      }
    }

    const outcome = await db.$transaction(async (tx: Tx) => {
      const complaint = await tx.teachComplaint.findUnique({ where: { id } })
      if (!complaint) return { kind: 'notFound' as const }

      const p = plan(action, complaint.status)
      if (action === 'RESOLVE' && complaint.status === COMPLAINT_STATUS.RESOLVED) {
        return { kind: 'noop' as const }
      }
      if (action === 'DISMISS' && complaint.status === COMPLAINT_STATUS.DISMISSED) {
        return { kind: 'noop' as const }
      }
      if (action === 'ASSIGN' && complaint.assignedAdminId === assignedAdminId) {
        return { kind: 'noop' as const }
      }
      if (action === 'ESCALATE' && complaint.severity === COMPLAINT_SEVERITY.CRITICAL) {
        return { kind: 'noop' as const }
      }

      const data: Record<string, unknown> = { updatedAt: now }
      if (p.status) data.status = p.status
      if (action === 'ASSIGN' && assignedAdminId) data.assignedAdminId = assignedAdminId
      if (action === 'ESCALATE') data.severity = COMPLAINT_SEVERITY.CRITICAL
      if (p.status === COMPLAINT_STATUS.RESOLVED || p.status === COMPLAINT_STATUS.DISMISSED) {
        data.resolvedAt = now
      }

      await tx.teachComplaint.update({ where: { id: complaint.id }, data })

      if (p.event) {
        await tx.complaintEvent.create({
          data: {
            complaintId: complaint.id,
            actorId: guard.student.id,
            actorRole: guard.student.role,
            action: p.event,
            detail: note ?? null,
          },
        })
        // Mirror decisive investigation steps into the BEAN Teach audit trail
        // (append-only, polymorphic entity) so admin decisions are provable
        // alongside reviews and trust actions.
        if (p.status === COMPLAINT_STATUS.RESOLVED || p.status === COMPLAINT_STATUS.DISMISSED || action === 'ESCALATE') {
          await appendAudit(tx, {
            entityType: 'COMPLAINT',
            entityId: complaint.id,
            actorId: guard.student.id,
            actorRole: guard.student.role,
            action: p.event,
            detail: note ?? null,
          })
        }
      }
      return { kind: 'ok' as const, status: (p.status ?? complaint.status) as string }
    })

    switch (outcome.kind) {
      case 'notFound':
        return NextResponse.json({ error: 'Complaint not found' }, { status: 404 })
      case 'noop':
        return NextResponse.json({ ok: true, status: undefined, unchanged: true })
    }

    return NextResponse.json({ ok: true, status: outcome.status })
  } catch (err) {
    console.error('[api/admin/trust/complaints/:id/action POST]', err)
    return NextResponse.json({ error: 'Could not record the case action — please try again.' }, { status: 500 })
  }
}
