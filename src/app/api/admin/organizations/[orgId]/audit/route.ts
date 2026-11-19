// ─── Phase 7: BEAN admin — organization audit trail (read-only) ──────────────
// GET returns the organization (id, name, verificationStatus) plus its last 50
// append-only OrganizationAuditEvent rows, newest first. Actor display names
// are resolved through the organization's memberships where the actor is (or
// was) a member — unknown actors stay null. Read-only: no mutations, no
// sameOrigin requirement (GET), guarded by requireAdmin.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ orgId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { orgId } = await params
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const org = await db.organization.findUnique({ where: { id: orgId } })
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    const events = await db.organizationAuditEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const actorIds = [...new Set(events.map((e) => e.actorId).filter((v): v is string => Boolean(v)))]
    const actors = actorIds.length
      ? await db.organizationMembership.findMany({
          where: { organizationId: orgId, studentId: { in: actorIds } },
          select: { studentId: true, student: { select: { displayName: true } } },
        })
      : []
    const displayNameByStudentId = new Map(actors.map((a) => [a.studentId, a.student.displayName]))

    return NextResponse.json(
      {
        organization: { id: org.id, name: org.name, verificationStatus: org.verificationStatus },
        audit: events.map((e) => ({
          id: e.id,
          entityType: e.entityType,
          entityId: e.entityId,
          action: e.action,
          actorId: e.actorId,
          actorRole: e.actorRole,
          actorDisplayName: e.actorId ? (displayNameByStudentId.get(e.actorId) ?? null) : null,
          detail: e.detail,
          createdAt: e.createdAt.toISOString(),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/admin/organizations/[orgId]/audit GET]', err)
    return NextResponse.json({ error: 'Could not load the audit trail.' }, { status: 500 })
  }
}
