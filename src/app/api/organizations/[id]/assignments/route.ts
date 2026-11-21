// ─── Phase 7: Institution assignments — list / create ────────────────────────
// GET: instructors/org staff see all group assignments; learners see only
// PUBLISHED assignments for groups they are ACTIVELY enrolled in.
// POST: authorized group instructor publishes (or drafts) an assignment.
// Rate-limited per organization; publication is audited.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  ASSIGNMENT_STATUS,
  countRecentOrg,
  isOperationalOrg,
  ORG_ADMIN_ROLES,
  ORG_INSTRUCTOR_ROLES,
  orgRateLimited,
  requireActiveMembership,
  requireOrgInstructor,
} from '@/lib/institution'
import { assignmentCreateSchema } from '@/lib/institution-schema'
import { toAssignmentDTO } from '@/lib/institution-dto'
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

    const isStaff =
      (ORG_INSTRUCTOR_ROLES as readonly string[]).includes(guard.membership.role) ||
      (ORG_ADMIN_ROLES as readonly string[]).includes(guard.membership.role)

    if (isStaff) {
      const assignments = await db.organizationAssignment.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json(
        { assignments: assignments.map(toAssignmentDTO), viewerRole: guard.membership.role },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // Learner: only PUBLISHED assignments for actively-enrolled groups.
    const enrollments = await db.organizationGroupMembership.findMany({
      where: { membershipId: guard.membership.id, enrollmentState: 'ACTIVE' },
      select: { groupId: true },
    })
    const groupIds = enrollments.map((e) => e.groupId)
    const assignments = await db.organizationAssignment.findMany({
      where: { organizationId: id, status: ASSIGNMENT_STATUS.PUBLISHED, groupId: { in: groupIds } },
      orderBy: { publishedAt: 'desc' },
    })
    return NextResponse.json(
      { assignments: assignments.map(toAssignmentDTO), viewerRole: guard.membership.role },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/assignments GET]', err)
    return NextResponse.json({ error: 'Could not load assignments.' }, { status: 500 })
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

    const parsed = assignmentCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid assignment details' }, { status: 400 })
    const input = parsed.data

    const group = await db.organizationGroup.findUnique({ where: { id: input.groupId } })
    if (!group || group.organizationId !== id) {
      return NextResponse.json({ error: 'Group not found in this organization' }, { status: 404 })
    }
    if (input.dueAt) {
      const due = new Date(input.dueAt)
      if (due.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'The due date must be in the future.' }, { status: 400 })
      }
    }

    const recent = await countRecentOrg('assignment', student.id, id, new Date())
    if (orgRateLimited('ASSIGNMENTS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Assignment creation limit reached for today.' }, { status: 429 })
    }

    const now = new Date()
    const assignment = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.organizationAssignment.create({
        data: {
          organizationId: id,
          groupId: input.groupId,
          createdByMembershipId: guard.membership.id,
          title: input.title,
          instructions: input.instructions ?? null,
          subjectLabel: input.subjectLabel ?? null,
          submissionType: input.submissionType,
          status: input.publish ? ASSIGNMENT_STATUS.PUBLISHED : ASSIGNMENT_STATUS.DRAFT,
          publishedAt: input.publish ? now : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          maxScore: input.maxScore ?? null,
        },
      })
      if (input.publish) {
        await appendOrgAudit(tx, {
          organizationId: id,
          entityType: 'ASSIGNMENT',
          entityId: created.id,
          actorId: student.id,
          actorRole: student.role,
          action: 'ASSIGNMENT_PUBLISHED',
          detail: `groupId=${input.groupId}`,
        })
      }
      return created
    })
    return NextResponse.json({ assignment: toAssignmentDTO(assignment) }, { status: 201 })
  } catch (err) {
    console.error('[api/organizations/[id]/assignments POST]', err)
    return NextResponse.json({ error: 'Could not create the assignment.' }, { status: 500 })
  }
}
