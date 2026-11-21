// ─── Phase 7: Assignment submission (student) ────────────────────────────────
// POST creates or updates the caller's single submission row (unique per
// assignment+student). Policy: submission allowed while the assignment is
// PUBLISHED (or RETURNED for rework) and before dueAt; resubmission updates
// the same row (documented resubmission policy — one live record per student).
// External links must be valid HTTPS. Rate-limited per student.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  ASSIGNMENT_STATUS,
  countRecentOrg,
  isValidHttpUrl,
  ORG_ADMIN_ROLES,
  ORG_INSTRUCTOR_ROLES,
  ORG_MEMBERSHIP_STATUS,
  orgRateLimited,
  requireActiveMembership,
  SUBMISSION_STATUS,
} from '@/lib/institution'
import { submissionCreateSchema } from '@/lib/institution-schema'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ assignmentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { assignmentId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = submissionCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.data ? 'Invalid submission' : 'Invalid submission' }, { status: 400 })
    const input = parsed.data

    const assignment = await db.organizationAssignment.findUnique({ where: { id: assignmentId } })
    if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

    const guard = await requireActiveMembership(student.id, assignment.organizationId)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    // Learners only — staff use the grading endpoint.
    if (
      (ORG_INSTRUCTOR_ROLES as readonly string[]).includes(guard.membership.role) &&
      !(await db.organizationGroupMembership.findUnique({
        where: { groupId_membershipId: { groupId: assignment.groupId, membershipId: guard.membership.id } },
      }))
    ) {
      return NextResponse.json({ error: 'Instructors grade submissions through the assignment panel.' }, { status: 403 })
    }

    const enrollment = await db.organizationGroupMembership.findUnique({
      where: { groupId_membershipId: { groupId: assignment.groupId, membershipId: guard.membership.id } },
    })
    if (!enrollment || enrollment.enrollmentState !== 'ACTIVE') {
      return NextResponse.json({ error: 'You must be actively enrolled in the assignment group.' }, { status: 403 })
    }

    if (assignment.status !== ASSIGNMENT_STATUS.PUBLISHED) {
      return NextResponse.json({ error: 'This assignment is not open for submissions.' }, { status: 409 })
    }
    if (assignment.dueAt && assignment.dueAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'The submission deadline has passed.' }, { status: 409 })
    }

    if (input.externalLink && !isValidHttpUrl(input.externalLink)) {
      return NextResponse.json({ error: 'External links must be valid HTTPS URLs.' }, { status: 400 })
    }

    const recent = await countRecentOrg('submissionEdit', student.id, null, new Date())
    if (orgRateLimited('SUBMISSION_EDITS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Submission limit reached for today — please try again tomorrow.' }, { status: 429 })
    }

    const now = new Date()
    const submission = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.assignmentSubmission.findUnique({
        where: { assignmentId_studentId: { assignmentId, studentId: student.id } },
      })
      // A RETURNED submission may be reworked (goes back to SUBMITTED on save).
      const nextStatus = SUBMISSION_STATUS.SUBMITTED
      if (existing) {
        return tx.assignmentSubmission.update({
          where: { id: existing.id },
          data: {
            responseText: input.responseText ?? null,
            externalLink: input.externalLink ?? null,
            status: nextStatus,
            submittedAt: now,
          },
        })
      }
      return tx.assignmentSubmission.create({
        data: {
          assignmentId,
          studentId: student.id,
          responseText: input.responseText ?? null,
          externalLink: input.externalLink ?? null,
          status: nextStatus,
          submittedAt: now,
        },
      })
    })
    return NextResponse.json(
      {
        submission: {
          id: submission.id,
          status: submission.status,
          submittedAt: submission.submittedAt?.toISOString() ?? null,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/organizations/assignments/[assignmentId]/submissions POST]', err)
    return NextResponse.json({ error: 'Could not save the submission.' }, { status: 500 })
  }
}
