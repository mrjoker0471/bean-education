// ─── Phase 7: Assignment detail (+ submissions for authorized staff) ─────────
// GET: learners see the assignment if actively enrolled (with their OWN
// submission only); instructors/admins see the assignment plus ALL submissions
// for grading. Other students' submissions are never exposed to a learner —
// privacy of grades and feedback is enforced here, not in the UI.
// PATCH: org-instructor lifecycle management. Content edits (title,
// instructions, subjectLabel, submissionType, dueAt, maxScore) are allowed
// ONLY while DRAFT; status transitions are an explicit machine:
//   DRAFT → PUBLISHED (sets publishedAt) | ARCHIVED
//   PUBLISHED → CLOSED | ARCHIVED
//   CLOSED → ARCHIVED
//   ARCHIVED → ACTIVE (recovery: returns to DRAFT, clears publishedAt)
// Every mutation is audited inside the same transaction.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, ASSIGNMENT_STATUS, ORG_ADMIN_ROLES, ORG_INSTRUCTOR_ROLES, requireActiveMembership, requireOrgInstructor } from '@/lib/institution'
import { assignmentUpdateSchema } from '@/lib/institution-schema'
import { toAssignmentDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ assignmentId: string }> }

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

/** Allowed next statuses per current status ('ACTIVE' = recover ARCHIVED to DRAFT). */
const ASSIGNMENT_TRANSITIONS: Record<string, readonly string[]> = {
  [ASSIGNMENT_STATUS.DRAFT]: ['PUBLISHED', 'ARCHIVED'],
  [ASSIGNMENT_STATUS.PUBLISHED]: ['CLOSED', 'ARCHIVED'],
  [ASSIGNMENT_STATUS.CLOSED]: ['ARCHIVED'],
  [ASSIGNMENT_STATUS.ARCHIVED]: ['ACTIVE'],
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { assignmentId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const assignment = await db.organizationAssignment.findUnique({ where: { id: assignmentId } })
    if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

    // Org-level instructor guard on the owning organization — POST grants
    // org-wide assignment rights, so PATCH matches that scope exactly
    // (requireOrgInstructor includes the ACTIVE-membership check).
    const guard = await requireOrgInstructor(student.id, assignment.organizationId)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = assignmentUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid assignment details' }, { status: 400 })
    const input = parsed.data

    const wantsContentEdit =
      input.title !== undefined ||
      input.instructions !== undefined ||
      input.subjectLabel !== undefined ||
      input.submissionType !== undefined ||
      input.dueAt !== undefined ||
      input.maxScore !== undefined
    if (!input.status && !wantsContentEdit) {
      return NextResponse.json({ error: 'No assignment changes provided.' }, { status: 400 })
    }

    const current = assignment.status

    // Content is frozen once published — keeps the learner-facing contract stable.
    if (wantsContentEdit && current !== ASSIGNMENT_STATUS.DRAFT) {
      return NextResponse.json({ error: 'Only draft assignments can be edited.' }, { status: 409 })
    }

    if (input.status) {
      const allowed = ASSIGNMENT_TRANSITIONS[current] ?? []
      if (!(allowed as readonly string[]).includes(input.status)) {
        return NextResponse.json(
          {
            error: `Invalid status transition. Allowed from ${current}: ${allowed.length > 0 ? allowed.join(', ') : 'none'}.`,
          },
          { status: 400 },
        )
      }
    }

    if (input.dueAt) {
      const due = new Date(input.dueAt)
      if (due.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'The due date must be in the future.' }, { status: 400 })
      }
    }

    const now = new Date()
    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const data: Record<string, unknown> = {}
      if (input.title !== undefined) data.title = input.title
      if (input.instructions !== undefined) data.instructions = input.instructions ?? null
      if (input.subjectLabel !== undefined) data.subjectLabel = input.subjectLabel ?? null
      if (input.submissionType !== undefined) data.submissionType = input.submissionType
      if (input.dueAt !== undefined) data.dueAt = input.dueAt ? new Date(input.dueAt) : null
      if (input.maxScore !== undefined) data.maxScore = input.maxScore ?? null

      const audits: { action: string; detail: string }[] = []
      if (wantsContentEdit) {
        const fields = (['title', 'instructions', 'subjectLabel', 'submissionType', 'dueAt', 'maxScore'] as const)
          .filter((f) => input[f] !== undefined)
        audits.push({ action: 'ASSIGNMENT_UPDATED', detail: `fields=${fields.join(',')}` })
      }
      if (input.status === ASSIGNMENT_STATUS.PUBLISHED) {
        data.status = ASSIGNMENT_STATUS.PUBLISHED
        data.publishedAt = now
        audits.push({ action: 'ASSIGNMENT_PUBLISHED', detail: `groupId=${assignment.groupId}` })
      } else if (input.status === ASSIGNMENT_STATUS.CLOSED) {
        data.status = ASSIGNMENT_STATUS.CLOSED
        audits.push({ action: 'ASSIGNMENT_CLOSED', detail: `groupId=${assignment.groupId}` })
      } else if (input.status === ASSIGNMENT_STATUS.ARCHIVED) {
        data.status = ASSIGNMENT_STATUS.ARCHIVED
        audits.push({ action: 'ASSIGNMENT_ARCHIVED', detail: `groupId=${assignment.groupId}` })
      } else if (input.status === 'ACTIVE') {
        data.status = ASSIGNMENT_STATUS.DRAFT
        data.publishedAt = null
        audits.push({ action: 'ASSIGNMENT_RESTORED', detail: `groupId=${assignment.groupId}` })
      }

      const next = await tx.organizationAssignment.update({ where: { id: assignmentId }, data })
      for (const audit of audits) {
        await appendOrgAudit(tx, {
          organizationId: assignment.organizationId,
          entityType: 'ASSIGNMENT',
          entityId: assignmentId,
          actorId: student.id,
          actorRole: student.role,
          action: audit.action,
          detail: audit.detail,
        })
      }
      return next
    })
    return NextResponse.json({ assignment: toAssignmentDTO(updated) })
  } catch (err) {
    console.error('[api/organizations/assignments/[assignmentId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the assignment.' }, { status: 500 })
  }
}
