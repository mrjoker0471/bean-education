// ─── Phase 7: Group detail + update ──────────────────────────────────────────
// GET returns one group with its full roster — ACTIVE and LEFT enrollment rows
// alike (history is never hidden) — joined with membership display names only
// (emails never leave the server). PATCH lets instructors edit the group's
// labels/capacity or archive/restore it: rows are never deleted, capacity can
// never drop below the current active enrollment, and every transition is
// audited (GROUP_UPDATED / GROUP_ARCHIVED / GROUP_RESTORED).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, isOperationalOrg, requireActiveMembership, requireOrgInstructor } from '@/lib/institution'
import { groupUpdateSchema } from '@/lib/institution-schema'
import { toGroupDTO, toGroupRosterEntry } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; groupId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id, groupId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const guard = await requireActiveMembership(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const group = await db.organizationGroup.findUnique({ where: { id: groupId } })
    if (!group || group.organizationId !== id) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

    const roster = await db.organizationGroupMembership.findMany({
      where: { groupId },
      include: { membership: { include: { student: { select: { displayName: true } } } } },
      orderBy: { joinedAt: 'asc' },
    })
    const activeCount = roster.filter(e => e.enrollmentState === 'ACTIVE').length
    return NextResponse.json(
      {
        group: toGroupDTO(group),
        roster: roster.map(toGroupRosterEntry),
        counts: { activeCount, capacity: group.capacity, totalEnrolled: roster.length },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/groups/[groupId] GET]', err)
    return NextResponse.json({ error: 'Could not load the group.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, groupId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgInstructor(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    if (!isOperationalOrg(guard.organization)) {
      return NextResponse.json({ error: 'This organization is not verified yet.' }, { status: 403 })
    }

    const parsed = groupUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid group update' }, { status: 400 })
    const input = parsed.data

    const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const group = await tx.organizationGroup.findUnique({ where: { id: groupId } })
      if (!group || group.organizationId !== id) return { kind: 'notFound' as const }

      // Capacity can never drop below the current active enrollment count.
      if (input.capacity !== undefined && input.capacity !== null) {
        const activeCount = await tx.organizationGroupMembership.count({
          where: { groupId, enrollmentState: 'ACTIVE' },
        })
        if (input.capacity < activeCount) return { kind: 'capacity' as const }
      }

      // The date range stays coherent when either bound changes.
      const nextStartsAt = input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : group.startsAt
      const nextEndsAt = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : group.endsAt
      if (nextStartsAt && nextEndsAt && nextEndsAt.getTime() <= nextStartsAt.getTime()) {
        return { kind: 'dates' as const }
      }

      const data: {
        name?: string
        academicYear?: string | null
        programmeLabel?: string | null
        batchLabel?: string | null
        sectionLabel?: string | null
        trackLabel?: string | null
        startsAt?: Date | null
        endsAt?: Date | null
        capacity?: number | null
        status?: string
      } = {}
      if (input.name !== undefined) data.name = input.name
      if (input.academicYear !== undefined) data.academicYear = input.academicYear ?? null
      if (input.programmeLabel !== undefined) data.programmeLabel = input.programmeLabel ?? null
      if (input.batchLabel !== undefined) data.batchLabel = input.batchLabel ?? null
      if (input.sectionLabel !== undefined) data.sectionLabel = input.sectionLabel ?? null
      if (input.trackLabel !== undefined) data.trackLabel = input.trackLabel ?? null
      if (input.startsAt !== undefined) data.startsAt = input.startsAt ? new Date(input.startsAt) : null
      if (input.endsAt !== undefined) data.endsAt = input.endsAt ? new Date(input.endsAt) : null
      if (input.capacity !== undefined) data.capacity = input.capacity
      if (input.status !== undefined) data.status = input.status

      const contentEdits = Object.keys(data).some(k => k !== 'status')
      const statusTransition =
        input.status !== undefined && input.status !== group.status
          ? ({ to: input.status } as const)
          : null

      const updated = Object.keys(data).length
        ? await tx.organizationGroup.update({
            where: { id: groupId },
            data,
            include: { _count: { select: { enrollments: { where: { enrollmentState: 'ACTIVE' } } } } },
          })
        : group

      if (contentEdits) {
        await appendOrgAudit(tx, {
          organizationId: id,
          entityType: 'GROUP',
          entityId: groupId,
          actorId: student.id,
          actorRole: student.role,
          action: 'GROUP_UPDATED',
          detail: `groupId=${groupId}`,
        })
      }
      if (statusTransition) {
        await appendOrgAudit(tx, {
          organizationId: id,
          entityType: 'GROUP',
          entityId: groupId,
          actorId: student.id,
          actorRole: student.role,
          action: statusTransition.to === 'ARCHIVED' ? 'GROUP_ARCHIVED' : 'GROUP_RESTORED',
          detail: `groupId=${groupId}`,
        })
      }
      return { kind: 'ok' as const, updated }
    })

    switch (result.kind) {
      case 'ok':
        return NextResponse.json({ group: toGroupDTO(result.updated) })
      case 'notFound':
        return NextResponse.json({ error: 'Group not found' }, { status: 404 })
      case 'capacity':
        return NextResponse.json({ error: 'Capacity cannot be below the current active enrollment count.' }, { status: 400 })
      case 'dates':
        return NextResponse.json({ error: 'The end date must be after the start date.' }, { status: 400 })
    }
  } catch (err) {
    console.error('[api/organizations/[id]/groups/[groupId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the group.' }, { status: 500 })
  }
}
