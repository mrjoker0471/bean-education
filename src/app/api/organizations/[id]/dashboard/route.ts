// ─── Phase 7: Institution dashboard aggregates ───────────────────────────────
// GET returns authorized, institution-owned aggregates for the workspace
// overview: verification state, membership counts, group counts, upcoming
// private classes, assignment stats, open announcements and the latest
// organization audit activity. Privacy: every number derives from
// institution-owned activity only — no personal learning data (Riishe chats,
// documents, goals, notes, attempts) is ever included, and roster-style data
// never exposes emails (audit actor names resolve to display names only).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireActiveMembership, ORG_ADMIN_ROLES, ORG_INSTRUCTOR_ROLES, ORG_VERIFICATION_STATUS } from '@/lib/institution'
import { toPublicOrganization } from '@/lib/institution-dto'

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
    const isAdmin = (ORG_ADMIN_ROLES as readonly string[]).includes(guard.membership.role)
    const isStaff = (ORG_INSTRUCTOR_ROLES as readonly string[]).includes(guard.membership.role)
    const now = new Date()

    const [
      org,
      activeMembers,
      pendingMembers,
      activeGroups,
      archivedGroups,
      upcomingClasses,
      publishedAssignments,
      closedAssignments,
      draftAssignments,
      submissionsAwaitingGrading,
      submissionsGraded,
      resourcesTotal,
      activeAnnouncements,
      auditEvents,
    ] = await Promise.all([
      db.organization.findUnique({ where: { id } }),
      db.organizationMembership.count({ where: { organizationId: id, status: 'ACTIVE' } }),
      db.organizationMembership.count({ where: { organizationId: id, status: 'INVITED' } }),
      db.organizationGroup.count({ where: { organizationId: id, status: 'ACTIVE' } }),
      db.organizationGroup.count({ where: { organizationId: id, status: 'ARCHIVED' } }),
      db.classSession.count({
        where: { organizationId: id, status: 'PUBLISHED', startsAt: { gt: now } },
      }),
      db.organizationAssignment.count({
        where: { organizationId: id, status: 'PUBLISHED' },
      }),
      db.organizationAssignment.count({
        where: { organizationId: id, status: 'CLOSED' },
      }),
      db.organizationAssignment.count({
        where: { organizationId: id, status: 'DRAFT' },
      }),
      db.assignmentSubmission.count({
        where: { assignment: { organizationId: id }, status: 'SUBMITTED' },
      }),
      db.assignmentSubmission.count({
        where: { assignment: { organizationId: id }, status: 'GRADED' },
      }),
      db.organizationResource.count({ where: { organizationId: id } }),
      db.organizationAnnouncement.count({
        where: { organizationId: id, status: 'PUBLISHED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      }),
      db.organizationAuditEvent.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ])
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    // Resolve audit actor display names via the membership → student join when
    // the actor is (or was) a member of this organization. Display names only —
    // audit trails never expose account emails.
    const actorStudentIds = [
      ...new Set(auditEvents.map(e => e.actorId).filter((v): v is string => typeof v === 'string' && v.length > 0)),
    ]
    const actorMemberships = actorStudentIds.length
      ? await db.organizationMembership.findMany({
          where: { organizationId: id, studentId: { in: actorStudentIds } },
          include: { student: { select: { displayName: true } } },
        })
      : []
    const actorNameByStudentId = new Map(actorMemberships.map(m => [m.studentId, m.student.displayName]))
    const recentActivity = auditEvents.map(e => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      summary: e.detail,
      actorRole: e.actorRole,
      createdAt: e.createdAt.toISOString(),
      actorDisplayName: e.actorId ? (actorNameByStudentId.get(e.actorId) ?? null) : null,
    }))

    return NextResponse.json(
      {
        organization: toPublicOrganization(org),
        membership: { id: guard.membership.id, role: guard.membership.role, status: guard.membership.status },
        role: guard.membership.role,
        isAdmin,
        isStaff,
        verification: {
          status: guard.organization.verificationStatus,
          operational: guard.organization.verificationStatus === ORG_VERIFICATION_STATUS.APPROVED && guard.organization.isActive,
        },
        overview: {
          activeMembers,
          pendingMembers,
          activeGroups,
          archivedGroups,
          upcomingClasses,
          publishedAssignments,
          closedAssignments,
          draftAssignments,
          openSubmissions: submissionsAwaitingGrading,
          submissionsAwaitingGrading,
          submissionsGraded,
          activeAnnouncements,
          announcementsActive: activeAnnouncements,
          resourcesTotal,
          recentActivity,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/dashboard GET]', err)
    return NextResponse.json({ error: 'Could not load the institution dashboard.' }, { status: 500 })
  }
}
