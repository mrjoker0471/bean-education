// ─── Phase 7: Member management action ───────────────────────────────────────
// POST performs one role/status action on a member. Every rule is enforced
// server-side: only OWNER manages OWNERs, the last active OWNER can never be
// removed/demoted/suspended, membership invitations (INVITED → ACTIVE) require
// an admin action, and every change is audited inside the same transaction.
// Organization role edits NEVER touch Student.role.
//
// (The dynamic segment is `orgMemberId` — an infrastructure constraint of the
// delivery environment, not a product decision; the URL shape is unchanged:
// /api/organizations/:id/members/:memberId.)

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  evaluateMemberAction,
  ORG_MEMBERSHIP_STATUS,
  requireOrgAdmin,
} from '@/lib/institution'
import { memberActionSchema } from '@/lib/institution-schema'
import { toMemberDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; orgMemberId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, orgMemberId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgAdmin(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = memberActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid member action' }, { status: 400 })
    const { action, role, note } = parsed.data

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const target = await tx.organizationMembership.findUnique({
        where: { id: orgMemberId },
        include: { student: { select: { displayName: true } } },
      })
      if (!target || target.organizationId !== id) return { kind: 'notFound' as const }

      const activeOwners = await tx.organizationMembership.count({
        where: { organizationId: id, role: 'OWNER', status: ORG_MEMBERSHIP_STATUS.ACTIVE },
      })
      const rule = evaluateMemberAction(guard.membership.role, target.role, action, activeOwners)
      if (!rule.ok) return { kind: 'forbidden' as const, error: rule.error }

      const now = new Date()
      const full = { student: { select: { displayName: true } } } as const
      let updated: Prisma.OrganizationMembershipGetPayload<{ include: typeof full }>
      let auditAction: string
      switch (action) {
        case 'APPROVE_OWNER': // pending invitation approval by an administrator
          if (target.status !== ORG_MEMBERSHIP_STATUS.INVITED) {
            return { kind: 'conflict' as const, error: 'This member has already been approved or is not pending.' }
          }
          updated = await tx.organizationMembership.update({
            where: { id: orgMemberId },
            data: { status: ORG_MEMBERSHIP_STATUS.ACTIVE, activatedAt: now },
            include: full,
          })
          auditAction = 'MEMBER_ACTIVATED'
          break
        case 'APPOINT_ADMIN':
          if (target.status !== ORG_MEMBERSHIP_STATUS.ACTIVE) {
            return { kind: 'conflict' as const, error: 'Only active members can be appointed.' }
          }
          updated = await tx.organizationMembership.update({
            where: { id: orgMemberId },
            data: { role: 'ADMIN' },
            include: full,
          })
          auditAction = 'MEMBER_ROLE_CHANGED'
          break
        case 'SET_ROLE': {
          if (!role) return { kind: 'badRequest' as const }
          if (target.status !== ORG_MEMBERSHIP_STATUS.ACTIVE) {
            return { kind: 'conflict' as const, error: 'Only active members can be reassigned.' }
          }
          updated = await tx.organizationMembership.update({
            where: { id: orgMemberId },
            data: { role },
            include: full,
          })
          auditAction = 'MEMBER_ROLE_CHANGED'
          break
        }
        case 'SUSPEND':
          if (target.status !== ORG_MEMBERSHIP_STATUS.ACTIVE) {
            return { kind: 'conflict' as const, error: 'Only active members can be suspended.' }
          }
          updated = await tx.organizationMembership.update({
            where: { id: orgMemberId },
            data: { status: ORG_MEMBERSHIP_STATUS.SUSPENDED, suspendedAt: now },
            include: full,
          })
          auditAction = 'MEMBER_SUSPENDED'
          break
        case 'REINSTATE':
          if (target.status !== ORG_MEMBERSHIP_STATUS.SUSPENDED) {
            return { kind: 'conflict' as const, error: 'Only suspended members can be reinstated.' }
          }
          updated = await tx.organizationMembership.update({
            where: { id: orgMemberId },
            data: { status: ORG_MEMBERSHIP_STATUS.ACTIVE, suspendedAt: null },
            include: full,
          })
          auditAction = 'MEMBER_REINSTATED'
          break
        case 'REMOVE':
          updated = await tx.organizationMembership.update({
            where: { id: orgMemberId },
            data: { status: ORG_MEMBERSHIP_STATUS.LEFT, leftAt: now },
            include: full,
          })
          auditAction = 'MEMBER_LEFT'
          break
        default:
          return { kind: 'badRequest' as const }
      }

      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'MEMBERSHIP',
        entityId: orgMemberId,
        actorId: student.id,
        actorRole: student.role,
        action: auditAction,
        detail: `targetRole=${target.role}${role ? `,to=${role}` : ''}${note ? `,note=${note.slice(0, 200)}` : ''}`,
      })
      return { kind: 'ok' as const, member: updated }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ member: toMemberDTO(outcome.member) })
      case 'notFound':
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      case 'badRequest':
        return NextResponse.json({ error: 'Invalid member action' }, { status: 400 })
      case 'forbidden':
        return NextResponse.json({ error: outcome.error }, { status: 403 })
      case 'conflict':
        return NextResponse.json({ error: outcome.error }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/organizations/[id]/members/[orgMemberId] POST]', err)
    return NextResponse.json({ error: 'Could not update the member.' }, { status: 500 })
  }
}
