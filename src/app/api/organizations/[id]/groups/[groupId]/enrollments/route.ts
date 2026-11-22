// ─── Phase 7: Group enrollments — enroll an existing member / leave ──────────
// POST enrolls an ACTIVE organization member into the group (instructor+).
// DELETE lets the caller leave the group themselves (enrollment state flips to
// LEFT — the row is never deleted, so assignment and attendance history
// survives). The unique (groupId, membershipId) constraint prevents duplicate
// active enrollment at the database level.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  GROUP_ENROLLMENT_STATE,
  requireActiveMembership,
  requireOrgInstructor,
} from '@/lib/institution'
import { enrollmentActionSchema } from '@/lib/institution-schema'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; groupId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, groupId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgInstructor(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = enrollmentActionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid enrollment request' }, { status: 400 })
    const { membershipId } = parsed.data

    const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const group = await tx.organizationGroup.findUnique({ where: { id: groupId } })
      if (!group || group.organizationId !== id) return { kind: 'notFound' as const }
      if (group.status === 'ARCHIVED') return { kind: 'archived' as const }

      const target = await tx.organizationMembership.findUnique({ where: { id: membershipId } })
      if (!target || target.organizationId !== id) return { kind: 'notFound' as const }
      if (target.status !== 'ACTIVE') {
        return { kind: 'conflict' as const, error: 'Only active organization members can be enrolled.' }
      }

      const capacityReached =
        group.capacity !== null &&
        (await tx.organizationGroupMembership.count({
          where: { groupId, enrollmentState: GROUP_ENROLLMENT_STATE.ACTIVE },
        })) >= group.capacity
      if (capacityReached) return { kind: 'full' as const }

      const existing = await tx.organizationGroupMembership.findUnique({
        where: { groupId_membershipId: { groupId, membershipId } },
      })
      if (existing && existing.enrollmentState === GROUP_ENROLLMENT_STATE.ACTIVE) {
        return { kind: 'duplicate' as const }
      }
      const enrollment = existing
        ? await tx.organizationGroupMembership.update({
            where: { id: existing.id },
            data: { enrollmentState: GROUP_ENROLLMENT_STATE.ACTIVE, leftAt: null },
          })
        : await tx.organizationGroupMembership.create({
            data: { groupId, membershipId },
          })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'GROUP_MEMBERSHIP',
        entityId: enrollment.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'GROUP_ENROLLED',
        detail: `groupId=${groupId}`,
      })
      return { kind: 'ok' as const, enrollmentId: enrollment.id }
    })

    switch (outcome.kind) {
      case 'ok':
        return NextResponse.json({ ok: true, enrollmentId: outcome.enrollmentId }, { status: 201 })
      case 'notFound':
        return NextResponse.json({ error: 'Group or member not found' }, { status: 404 })
      case 'archived':
        return NextResponse.json({ error: 'Group is archived.' }, { status: 409 })
      case 'conflict':
        return NextResponse.json({ error: outcome.error }, { status: 409 })
      case 'full':
        return NextResponse.json({ error: 'This group is at capacity.' }, { status: 409 })
      case 'duplicate':
        return NextResponse.json({ error: 'This member is already enrolled in the group.' }, { status: 409 })
    }
  } catch (err) {
    console.error('[api/organizations/[id]/groups/[groupId]/enrollments POST]', err)
    return NextResponse.json({ error: 'Could not enroll the member.' }, { status: 500 })
  }
}

/** DELETE: the caller leaves the group themselves, or — when the body names
 *  another member's membershipId — an instructor removes that member. Either
 *  way the enrollment row flips to LEFT and is never deleted, so assignment
 *  and attendance history survives. Self-leave keeps its original behavior;
 *  removing someone else requires an instructor+ role (403 otherwise) and is
 *  audited as GROUP_MEMBER_REMOVED (actor + target). */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id, groupId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireActiveMembership(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const raw: unknown = await req.json().catch(() => null)
    const requestedId =
      typeof (raw as { membershipId?: unknown } | null)?.membershipId === 'string'
        ? (raw as { membershipId: string }).membershipId
        : null
    const removingOther = requestedId !== null && requestedId !== guard.membership.id
    if (removingOther) {
      const staffGuard = await requireOrgInstructor(student.id, id)
      if (!staffGuard.ok) return NextResponse.json({ error: staffGuard.error }, { status: staffGuard.status })
    }

    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const group = await tx.organizationGroup.findUnique({ where: { id: groupId } })
      if (!group || group.organizationId !== id) return { kind: 'notFound' as const }

      const membershipId = removingOther && requestedId ? requestedId : guard.membership.id
      const enrollment = await tx.organizationGroupMembership.findUnique({
        where: { groupId_membershipId: { groupId, membershipId } },
      })
      if (!enrollment || enrollment.enrollmentState !== GROUP_ENROLLMENT_STATE.ACTIVE) {
        return { kind: 'notFound' as const }
      }
      await tx.organizationGroupMembership.update({
        where: { id: enrollment.id },
        data: { enrollmentState: GROUP_ENROLLMENT_STATE.LEFT, leftAt: new Date() },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'GROUP_MEMBERSHIP',
        entityId: enrollment.id,
        actorId: student.id,
        actorRole: student.role,
        action: removingOther ? 'GROUP_MEMBER_REMOVED' : 'GROUP_LEFT',
        detail: removingOther ? `groupId=${groupId}, membershipId=${membershipId}` : `groupId=${groupId}`,
      })
      return { kind: 'ok' as const }
    })
    if (result.kind === 'notFound') {
      return NextResponse.json(
        { error: removingOther ? 'That member is not enrolled in this group.' : 'You are not enrolled in this group.' },
        { status: 404 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/organizations/[id]/groups/[groupId]/enrollments DELETE]', err)
    return NextResponse.json({ error: 'Could not leave the group.' }, { status: 500 })
  }
}
