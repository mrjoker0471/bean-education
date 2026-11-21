// ─── Phase 7: Submission grading / rework (PATCH) ────────────────────────────
// Two authorized paths, enforced server-side by role + group:
//   • Instructor/org-admin of the owning group → grade or return (grades and
//     feedback stay private to the student and permitted staff — never public).
//   • Authoring student → rework a RETURNED submission (grades untouched).
// Everyone else gets 403/404. Every grading decision is audited.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  ASSIGNMENT_STATUS,
  GROUP_ENROLLMENT_STATE,
  ORG_ADMIN_ROLES,
  ORG_INSTRUCTOR_ROLES,
  requireActiveMembership,
  SUBMISSION_STATUS,
} from '@/lib/institution'
import { gradeSubmissionSchema } from '@/lib/institution-schema'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ assignmentId: string; submissionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { assignmentId, submissionId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = gradeSubmissionSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid grading details' }, { status: 400 })
    const { gradeValue, teacherFeedback, markReturned } = parsed.data

    const submission = await db.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: true },
    })
    if (!submission || submission.assignmentId !== assignmentId) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }
    const assignment = submission.assignment
    const guard = await requireActiveMembership(student.id, assignment.organizationId)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const isStaff =
      (ORG_INSTRUCTOR_ROLES as readonly string[]).includes(guard.membership.role) ||
      (ORG_ADMIN_ROLES as readonly string[]).includes(guard.membership.role)

    if (isStaff) {
      // Staff must belong to the owning group (instructors manage only their
      // groups; admins may manage any group in the organization).
      if (guard.membership.role !== 'ADMIN' && guard.membership.role !== 'OWNER') {
        const enrollment = await db.organizationGroupMembership.findUnique({
          where: { groupId_membershipId: { groupId: assignment.groupId, membershipId: guard.membership.id } },
        })
        if (!enrollment || enrollment.enrollmentState !== GROUP_ENROLLMENT_STATE.ACTIVE) {
          return NextResponse.json({ error: 'You can grade only submissions from your assigned groups.' }, { status: 403 })
        }
      }
      if (assignment.status === ASSIGNMENT_STATUS.ARCHIVED) {
        return NextResponse.json({ error: 'This assignment is archived.' }, { status: 409 })
      }
      const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        const next = await tx.assignmentSubmission.update({
          where: { id: submissionId },
          data: {
            status: markReturned ? SUBMISSION_STATUS.RETURNED : SUBMISSION_STATUS.GRADED,
            gradeValue: gradeValue ?? null,
            teacherFeedback: teacherFeedback ?? null,
            gradedByMembershipId: guard.membership.id,
            gradedAt: new Date(),
          },
        })
        await appendOrgAudit(tx, {
          organizationId: assignment.organizationId,
          entityType: 'ASSIGNMENT',
          entityId: assignmentId,
          actorId: student.id,
          actorRole: student.role,
          action: markReturned ? 'SUBMISSION_RETURNED' : 'SUBMISSION_GRADED',
          detail: `submissionId=${submissionId}`,
        })
        return next
      })
      return NextResponse.json({
        submission: { id: updated.id, status: updated.status, gradedAt: updated.gradedAt?.toISOString() ?? null },
      })
    }

    // Student path: only the author, only rework of a RETURNED submission.
    if (submission.studentId !== student.id) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 })
    }
    if (submission.status !== SUBMISSION_STATUS.RETURNED) {
      return NextResponse.json({ error: 'This submission is not open for rework.' }, { status: 409 })
    }
    if (assignment.status !== ASSIGNMENT_STATUS.PUBLISHED) {
      return NextResponse.json({ error: 'This assignment is not open.' }, { status: 409 })
    }
    const reworked = await db.assignmentSubmission.update({
      where: { id: submissionId },
      data: { status: SUBMISSION_STATUS.SUBMITTED, submittedAt: new Date() },
    })
    return NextResponse.json({
      submission: { id: reworked.id, status: reworked.status, submittedAt: reworked.submittedAt?.toISOString() ?? null },
    })
  } catch (err) {
    console.error('[api/organizations/assignments/[assignmentId]/submissions/[submissionId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the submission.' }, { status: 500 })
  }
}
