// ─── BEAN Trust & Quality (Phase 6): issue teacher trust actions ─────────────
// POST /api/admin/trust/teachers/:teacherProfileId/actions — ADMIN-only.
//   NOTICE / WARNING        — recorded, no server-side enforcement.
//   PAUSE_LISTINGS          — hides the teacher's current listings and blocks
//                             new bookings (existing reservations untouched).
//   SUSPEND_PUBLISHING      — blocks new class creation and publishing.
//   EMERGENCY_STOP          — immediate safeguarding halt: additionally blocks
//                             live classroom start/token for this teacher.
//   REINSTATE               — ends every currently-active enforcing
//                             restriction (individually audited) and records
//                             the reinstatement decision.
// Non-admin callers are refused (403) — a teacher cannot restrict themselves
// or anyone else. Decisions never fire automatically from complaints.
// Filing a complaint alone suspends nobody. Every row + audit is append-only.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { sameOrigin } from '@/lib/auth'
import { ENFORCING_ACTIONS, TRUST_ACTION } from '@/lib/trust'
import { adminTrustActionSchema } from '@/lib/trust-schema'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ teacherProfileId: string }> },
) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json().catch(() => null)
    const parsed = adminTrustActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid action' }, { status: 400 })
    }

    const { teacherProfileId } = await params
    const { action, reason, endsAt } = parsed.data
    const now = new Date()
    const expiresAt = endsAt ? new Date(endsAt) : null

    const profile = await db.teacherProfile.findUnique({
      where: { id: teacherProfileId },
      select: { id: true },
    })
    if (!profile) return NextResponse.json({ error: 'Teacher profile not found' }, { status: 404 })

    const outcome = await db.$transaction(async (tx) => {
      if (action === TRUST_ACTION.REINSTATE) {
        // End every currently-enforcing restriction (expiry-aware), audit each.
        const active = await tx.trustAction.findMany({
          where: {
            teacherProfileId,
            isActive: true,
            action: { in: [...ENFORCING_ACTIONS] },
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        })
        for (const row of active) {
          await tx.trustAction.update({
            where: { id: row.id },
            data: { isActive: false, endedAt: now, endedById: guard.student.id },
          })
        }
        const record = await tx.trustAction.create({
          data: {
            teacherProfileId,
            action: TRUST_ACTION.REINSTATE,
            reason,
            startsAt: now,
            isActive: false, // reinstatements are decisions, not restrictions
            createdByAdminId: guard.student.id,
          },
        })
        await appendAudit(tx, {
          entityType: 'TRUST_ACTION',
          entityId: record.id,
          actorId: guard.student.id,
          actorRole: guard.student.role,
          action: 'TRUST_REINSTATE',
          detail: reason,
        })
        return { kind: 'ok' as const, reinstated: active.length, id: record.id }
      }

      const record = await tx.trustAction.create({
        data: {
          teacherProfileId,
          action,
          reason,
          startsAt: now,
          endsAt: expiresAt,
          isActive: true,
          createdByAdminId: guard.student.id,
        },
      })
      await appendAudit(tx, {
        entityType: 'TRUST_ACTION',
        entityId: record.id,
        actorId: guard.student.id,
        actorRole: guard.student.role,
        action: 'TRUST_ACTION_ISSUED',
        detail: `${action}: ${reason}`,
      })
      return { kind: 'ok' as const, reinstated: 0, id: record.id }
    })

    return NextResponse.json({ ok: true, id: outcome.id, reinstated: outcome.reinstated }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/trust/teachers/:id/actions POST]', err)
    return NextResponse.json({ error: 'Could not record the trust action — please try again.' }, { status: 500 })
  }
}
