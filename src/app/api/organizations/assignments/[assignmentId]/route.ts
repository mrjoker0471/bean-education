// ─── Phase 7: Assignment detail (+ submissions for authorized staff) ─────────
// GET: learners see the assignment if actively enrolled (with their OWN
// submission only); instructors/admins see the assignment plus ALL submissions
// for grading. Other students' submissions are never exposed to a learner —
// privacy of grades and feedback is enforced here, not in the UI.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { ASSIGNMENT_STATUS, ORG_ADMIN_ROLES, ORG_INSTRUCTOR_ROLES, requireActiveMembership } from '@/lib/institution'
import { toAssignmentDTO } from '@/lib/institution-dto'

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
