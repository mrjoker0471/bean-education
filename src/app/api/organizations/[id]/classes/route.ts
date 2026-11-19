// ─── Phase 7: Organization classes (including private institution classes) ───
// GET: lists classes owned by the institution. Public classes that merely
// reference the org (none in normal use) plus ORGANIZATION/GROUP-audience
// classes filtered by the caller's active membership / group enrollment.
// Group-only classes are visible ONLY to actively-enrolled group members.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { GROUP_ENROLLMENT_STATE, ORG_AUDIENCE, requireActiveMembership, ORG_ADMIN_ROLES, ORG_INSTRUCTOR_ROLES } from '@/lib/institution'

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

    const enrollments = await db.organizationGroupMembership.findMany({
      where: { membershipId: guard.membership.id, enrollmentState: GROUP_ENROLLMENT_STATE.ACTIVE },
      select: { groupId: true },
    })
    const activeGroupIds = enrollments.map((e) => e.groupId)

    const classes = await db.classSession.findMany({
      where: { organizationId: id, status: 'PUBLISHED' },
      include: { teacherProfile: { select: { teachingName: true } } },
      orderBy: { startsAt: 'asc' },
    })

    // Visibility filter (defense in depth — the same rule as the pure evaluator).
    const visible = classes.filter((c) => {
      const audience = c.audience ?? ORG_AUDIENCE.PUBLIC
      if (audience === ORG_AUDIENCE.PUBLIC) return true
      if (audience === ORG_AUDIENCE.ORGANIZATION) return true // caller has an ACTIVE membership (guard passed)
      if (audience === ORG_AUDIENCE.GROUP) return isStaff || activeGroupIds.includes(c.organizationGroupId ?? '')
      return false
    })

    return NextResponse.json(
      {
        classes: visible.map((c) => ({
          id: c.id,
          title: c.title,
          subject: c.subject,
          startsAt: c.startsAt.toISOString(),
          durationMinutes: c.durationMinutes,
          audience: c.audience ?? ORG_AUDIENCE.PUBLIC,
          organizationGroupId: c.organizationGroupId,
          teacherName: c.teacherProfile.teachingName,
          status: c.status,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/classes GET]', err)
    return NextResponse.json({ error: 'Could not load institution classes.' }, { status: 500 })
  }
}
