// ─── Phase 7: Institution announcements (in-app only) ────────────────────────
// GET: learners see PUBLISHED, non-expired announcements targeted at the whole
// organization or at a group they are actively enrolled in; org staff
// (OWNER/ADMIN/INSTRUCTOR) additionally receive DRAFT + ARCHIVED items for
// management (includeAll: true). POST: instructor+/admin publish or draft.
// There is NO email/notification service — visibility is in-app only, and no
// unmoderated public feed is created.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, GROUP_ENROLLMENT_STATE, ORG_ADMIN_ROLES, ORG_INSTRUCTOR_ROLES, requireActiveMembership, requireOrgInstructor } from '@/lib/institution'
import { announcementCreateSchema } from '@/lib/institution-schema'
import { toAnnouncementDTO } from '@/lib/institution-dto'
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

    // Staff manage announcements: DRAFT and ARCHIVED items are included too.
    if (isStaff) {
      const all = await db.organizationAnnouncement.findMany({
        where: { organizationId: id },
        orderBy: { createdAt: 'desc' },
      })
      return NextResponse.json(
        { announcements: all.map(toAnnouncementDTO), includeAll: true },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const enrollments = await db.organizationGroupMembership.findMany({
      where: { membershipId: guard.membership.id, enrollmentState: GROUP_ENROLLMENT_STATE.ACTIVE },
      select: { groupId: true },
    })
    const now = new Date()
    const announcements = await db.organizationAnnouncement.findMany({
      where: {
        organizationId: id,
        status: 'PUBLISHED',
        OR: [
          { groupId: null },
          { groupId: { in: enrollments.map((e) => e.groupId) } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
    })
    const visible = announcements.filter((a) => !a.expiresAt || a.expiresAt.getTime() > now.getTime())
    return NextResponse.json(
      { announcements: visible.map(toAnnouncementDTO), includeAll: false },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/announcements GET]', err)
    return NextResponse.json({ error: 'Could not load announcements.' }, { status: 500 })
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

    const parsed = announcementCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid announcement details' }, { status: 400 })
    const input = parsed.data

    if (input.groupId) {
      const group = await db.organizationGroup.findUnique({ where: { id: input.groupId } })
      if (!group || group.organizationId !== id) {
        return NextResponse.json({ error: 'Group not found in this organization' }, { status: 404 })
      }
    }

    if (input.expiresAt) {
      const expiry = new Date(input.expiresAt)
      if (expiry.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'The expiry must be in the future.' }, { status: 400 })
      }
    }

    const now = new Date()
    const isDraft = input.status === 'DRAFT'
    const announcement = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.organizationAnnouncement.create({
        data: {
          organizationId: id,
          groupId: input.groupId ?? null,
          authorMembershipId: guard.membership.id,
          title: input.title,
          body: input.body,
          status: isDraft ? 'DRAFT' : 'PUBLISHED',
          publishedAt: isDraft ? null : now,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'ANNOUNCEMENT',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: isDraft ? 'ANNOUNCEMENT_DRAFTED' : 'ANNOUNCEMENT_PUBLISHED',
        detail: input.groupId ? `groupId=${input.groupId}` : 'audience=ORGANIZATION',
      })
      return created
    })
    return NextResponse.json({ announcement: toAnnouncementDTO(announcement) }, { status: 201 })
  } catch (err) {
    console.error('[api/organizations/[id]/announcements POST]', err)
    return NextResponse.json({ error: 'Could not publish the announcement.' }, { status: 500 })
  }
}
