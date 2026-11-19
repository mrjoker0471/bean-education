// ─── Phase 7: Group update / archive (PATCH, instructor+) ────────────────────
// PATCH edits any subset of a group's details, or flips its status
// ACTIVE ⇄ ARCHIVED. Archiving is allowed even with active enrollments —
// archived groups simply stop appearing in active surfaces (the dashboard
// counts only ACTIVE groups) while every historical record (enrollments,
// assignments, attendance) is preserved. Re-activating restores visibility.
// Every change is audited inside the same transaction.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, requireOrgInstructor } from '@/lib/institution'
import { groupUpdateSchema } from '@/lib/institution-schema'
import { toGroupDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; groupId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, groupId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgInstructor(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = groupUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid group details' }, { status: 400 })
    const input = parsed.data

    const group = await db.organizationGroup.findUnique({ where: { id: groupId } })
    if (!group || group.organizationId !== id) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    if (input.startsAt && input.endsAt) {
      if (new Date(input.endsAt) <= new Date(input.startsAt)) {
        return NextResponse.json({ error: 'The end date must be after the start date.' }, { status: 400 })
      }
    }

    const data: Record<string, unknown> = {}
    if (input.name !== undefined) data.name = input.name
    if (input.academicYear !== undefined) data.academicYear = input.academicYear
    if (input.programmeLabel !== undefined) data.programmeLabel = input.programmeLabel
    if (input.batchLabel !== undefined) data.batchLabel = input.batchLabel
    if (input.sectionLabel !== undefined) data.sectionLabel = input.sectionLabel
    if (input.trackLabel !== undefined) data.trackLabel = input.trackLabel
    if (input.startsAt !== undefined) data.startsAt = input.startsAt ? new Date(input.startsAt) : null
    if (input.endsAt !== undefined) data.endsAt = input.endsAt ? new Date(input.endsAt) : null
    if (input.capacity !== undefined) data.capacity = input.capacity
    if (input.status !== undefined) data.status = input.status

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.organizationGroup.update({
        where: { id: group.id },
        data,
      })
      const activeEnrollments = await tx.organizationGroupMembership.count({
        where: { groupId: group.id, enrollmentState: 'ACTIVE' },
      })
      const statusChanged = input.status !== undefined && input.status !== group.status
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'GROUP',
        entityId: group.id,
        actorId: student.id,
        actorRole: student.role,
        action: statusChanged ? (input.status === 'ARCHIVED' ? 'GROUP_ARCHIVED' : 'GROUP_REACTIVATED') : 'GROUP_UPDATED',
        detail: `${input.name ? `name=${input.name.slice(0, 60)},` : ''}activeEnrollments=${activeEnrollments}`,
      })
      return { group: row, activeEnrollments }
    })

    return NextResponse.json({ group: toGroupDTO({ ...updated.group, _count: { enrollments: updated.activeEnrollments } }) })
  } catch (err) {
    console.error('[api/organizations/[id]/groups/[groupId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the group.' }, { status: 500 })
  }
}
