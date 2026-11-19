// ─── Phase 7: Assignment detail (+ submissions for authorized staff) ─────────
// GET: learners see the assignment if actively enrolled (with their OWN
// submission only); instructors/admins see the assignment plus ALL submissions
// for grading. Other students' submissions are never exposed to a learner —
// privacy of grades and feedback is enforced here, not in the UI.
//
// PATCH (instructor+ of the owning org): edits draft/published details and
// drives the status state machine DRAFT → PUBLISHED → CLOSED → ARCHIVED.
// Learners never see non-published assignments; every transition is audited.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  ASSIGNMENT_STATUS,
  isOperationalOrg,
  ORG_ADMIN_ROLES,
  ORG_INSTRUCTOR_ROLES,
  requireActiveMembership,
  requireOrgInstructor,
} from '@/lib/institution'
import { assignmentUpdateSchema } from '@/lib/institution-schema'
import { toAssignmentDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ assignmentId: string }> }

/** Pure: the only legal status transitions (adjacent steps — no skipping). */
function isLegalAssignmentTransition(from: string, to: string): boolean {
  if (from === to) return false
  if (from === ASSIGNMENT_STATUS.DRAFT && to === ASSIGNMENT_STATUS.PUBLISHED) return true
  if (from === ASSIGNMENT_STATUS.PUBLISHED && to === ASSIGNMENT_STATUS.CLOSED) return true
  if (from === ASSIGNMENT_STATUS.CLOSED && to === ASSIGNMENT_STATUS.ARCHIVED) return true
  return false
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { assignmentId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const assignment = await db.organizationAssignment.findUnique({ where: { id: assignmentId } })
    if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

    const guard = await requireActiveMembership(student.id, assignment.organizationId)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const isStaff =
      (ORG_INSTRUCTOR_ROLES as readonly string[]).includes(guard.membership.role) ||
      (ORG_ADMIN_ROLES as readonly string[]).includes(guard.membership.role)

    if (!isStaff) {
      if (assignment.status !== ASSIGNMENT_STATUS.PUBLISHED) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
      }
      const enrollment = await db.organizationGroupMembership.findUnique({
        where: { groupId_membershipId: { groupId: assignment.groupId, membershipId: guard.membership.id } },
      })
      if (!enrollment || enrollment.enrollmentState !== 'ACTIVE') {
        return NextResponse.json({ error: 'This assignment belongs to a group you are not enrolled in.' }, { status: 403 })
      }
      const own = await db.assignmentSubmission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
      })
      return NextResponse.json(
        {
          assignment: toAssignmentDTO(assignment),
          viewerRole: guard.membership.role,
          mySubmission: own
            ? {
                id: own.id,
                status: own.status,
                responseText: own.responseText,
                externalLink: own.externalLink,
                submittedAt: own.submittedAt?.toISOString() ?? null,
                gradeValue: own.gradeValue,
                teacherFeedback: own.gradedAt ? own.teacherFeedback : null,
                gradedAt: own.gradedAt?.toISOString() ?? null,
              }
            : null,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const submissions = await db.assignmentSubmission.findMany({
      where: { assignmentId },
      include: { student: { select: { displayName: true } } },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json(
      {
        assignment: toAssignmentDTO(assignment),
        viewerRole: guard.membership.role,
        submissions: submissions.map((s) => ({
          id: s.id,
          student: { displayName: s.student.displayName },
          status: s.status,
          responseText: s.responseText,
          externalLink: s.externalLink,
          submittedAt: s.submittedAt?.toISOString() ?? null,
          gradeValue: s.gradeValue,
          teacherFeedback: s.teacherFeedback,
          gradedAt: s.gradedAt?.toISOString() ?? null,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/assignments/[assignmentId] GET]', err)
    return NextResponse.json({ error: 'Could not load the assignment.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { assignmentId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const assignment = await db.organizationAssignment.findUnique({ where: { id: assignmentId } })
    if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

    const guard = await requireOrgInstructor(student.id, assignment.organizationId)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    if (!isOperationalOrg(guard.organization)) {
      return NextResponse.json({ error: 'This organization is not verified yet.' }, { status: 403 })
    }

    const parsed = assignmentUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid assignment details' }, { status: 400 })
    const input = parsed.data

    // Status changes must follow the state machine; field edits are allowed
    // only while the assignment can still receive edits (DRAFT or PUBLISHED).
    if (input.status && !isLegalAssignmentTransition(assignment.status, input.status)) {
      return NextResponse.json(
        { error: `Cannot move this assignment from ${assignment.status} to ${input.status}.` },
        { status: 409 },
      )
    }
    const editable = assignment.status === ASSIGNMENT_STATUS.DRAFT || assignment.status === ASSIGNMENT_STATUS.PUBLISHED
    const touchesFields =
      input.title !== undefined ||
      input.instructions !== undefined ||
      input.subjectLabel !== undefined ||
      input.dueAt !== undefined ||
      input.maxScore !== undefined
    if (touchesFields && !editable) {
      return NextResponse.json({ error: 'Closed or archived assignments can no longer be edited.' }, { status: 409 })
    }
    if (input.dueAt) {
      const due = new Date(input.dueAt)
      if (due.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'The due date must be in the future.' }, { status: 400 })
      }
    }

    const data: Record<string, unknown> = {}
    if (input.title !== undefined) data.title = input.title
    if (input.instructions !== undefined) data.instructions = input.instructions
    if (input.subjectLabel !== undefined) data.subjectLabel = input.subjectLabel
    if (input.dueAt !== undefined) data.dueAt = input.dueAt ? new Date(input.dueAt) : null
    if (input.maxScore !== undefined) data.maxScore = input.maxScore
    if (input.status) {
      data.status = input.status
      if (input.status === ASSIGNMENT_STATUS.PUBLISHED && !assignment.publishedAt) data.publishedAt = new Date()
    }

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.organizationAssignment.update({ where: { id: assignment.id }, data })
      await appendOrgAudit(tx, {
        organizationId: assignment.organizationId,
        entityType: 'ASSIGNMENT',
        entityId: assignment.id,
        actorId: student.id,
        actorRole: student.role,
        action: input.status
          ? input.status === ASSIGNMENT_STATUS.PUBLISHED
            ? 'ASSIGNMENT_PUBLISHED'
            : input.status === ASSIGNMENT_STATUS.CLOSED
              ? 'ASSIGNMENT_CLOSED'
              : 'ASSIGNMENT_ARCHIVED'
          : 'ASSIGNMENT_UPDATED',
        detail: `groupId=${assignment.groupId}`,
      })
      return row
    })

    return NextResponse.json({ assignment: toAssignmentDTO(updated) })
  } catch (err) {
    console.error('[api/organizations/assignments/[assignmentId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the assignment.' }, { status: 500 })
  }
}
