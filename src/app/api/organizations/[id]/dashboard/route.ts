// ─── Phase 7: Institution dashboard aggregates ───────────────────────────────
// GET returns authorized, institution-owned aggregates for the workspace
// overview: verification state, membership counts, group counts, upcoming
// private classes, assignment stats and open announcements. Privacy: every
// number derives from institution-owned activity only — no personal learning
// data (Riishe chats, documents, goals, notes, attempts) is ever included.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireActiveMembership, ORG_ADMIN_ROLES, ORG_VERIFICATION_STATUS } from '@/lib/institution'
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
    const now = new Date()

    const [org, activeMembers, pendingMembers, groups, upcomingClasses, publishedAssignments, openSubmissions, announcements] =
      await Promise.all([
        db.organization.findUnique({ where: { id } }),
        db.organizationMembership.count({ where: { organizationId: id, status: 'ACTIVE' } }),
        db.organizationMembership.count({ where: { organizationId: id, status: 'INVITED' } }),
        db.organizationGroup.count({ where: { organizationId: id, status: 'ACTIVE' } }),
        db.classSession.count({
          where: { organizationId: id, status: 'PUBLISHED', startsAt: { gt: now } },
        }),
        db.organizationAssignment.count({
          where: { organizationId: id, status: 'PUBLISHED' },
        }),
        db.assignmentSubmission.count({
          where: { assignment: { organizationId: id }, status: 'SUBMITTED' },
        }),
        db.organizationAnnouncement.count({
          where: { organizationId: id, status: 'PUBLISHED', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        }),
      ])
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

    return NextResponse.json(
      {
        organization: toPublicOrganization(org),
        membership: { id: guard.membership.id, role: guard.membership.role, status: guard.membership.status },
        isAdmin,
        verification: {
          status: guard.organization.verificationStatus,
          operational: guard.organization.verificationStatus === ORG_VERIFICATION_STATUS.APPROVED && guard.organization.isActive,
        },
        overview: {
          activeMembers,
          pendingMembers,
          activeGroups: groups,
          upcomingClasses,
          publishedAssignments,
          openSubmissions,
          activeAnnouncements: announcements,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/dashboard GET]', err)
    return NextResponse.json({ error: 'Could not load the institution dashboard.' }, { status: 500 })
  }
}
