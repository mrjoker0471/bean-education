// ─── Phase 7: Organization groups (batches / cohorts) ────────────────────────
// GET lists groups (any active member), POST creates a group (instructor+).
// Rate-limited per organization; every creation is audited.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  countRecentOrg,
  isOperationalOrg,
  orgRateLimited,
  requireActiveMembership,
  requireOrgInstructor,
} from '@/lib/institution'
import { groupCreateSchema } from '@/lib/institution-schema'
import { toGroupDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const guard = await requireActiveMembership(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const groups = await db.organizationGroup.findMany({
      where: { organizationId: id },
      include: { _count: { select: { enrollments: { where: { enrollmentState: 'ACTIVE' } } } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ groups: groups.map(toGroupDTO) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/organizations/[id]/groups GET]', err)
    return NextResponse.json({ error: 'Could not load groups.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgInstructor(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    if (!isOperationalOrg(guard.organization)) {
      return NextResponse.json({ error: 'This organization is not verified yet.' }, { status: 403 })
    }

    const parsed = groupCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid group details' }, { status: 400 })
    const input = parsed.data
    if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
      return NextResponse.json({ error: 'The end date must be after the start date.' }, { status: 400 })
    }

    const recent = await countRecentOrg('group', student.id, id, new Date())
    if (orgRateLimited('GROUPS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Group creation limit reached for today.' }, { status: 429 })
    }

    const group = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.organizationGroup.create({
        data: {
          organizationId: id,
          name: input.name,
          academicYear: input.academicYear ?? null,
          programmeLabel: input.programmeLabel ?? null,
          batchLabel: input.batchLabel ?? null,
          sectionLabel: input.sectionLabel ?? null,
          trackLabel: input.trackLabel ?? null,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          capacity: input.capacity ?? null,
          createdByMembershipId: guard.membership.id,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'GROUP',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'GROUP_CREATED',
        detail: `name=${created.name.slice(0, 60)}`,
      })
      return created
    })
    return NextResponse.json({ group: toGroupDTO(group) }, { status: 201 })
  } catch (err) {
    console.error('[api/organizations/[id]/groups POST]', err)
    return NextResponse.json({ error: 'Could not create the group.' }, { status: 500 })
  }
}
