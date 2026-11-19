// ─── Phase 7: Institution announcements (in-app only) ────────────────────────
// GET: active members see announcements targeted at the whole organization or
// at a group they are actively enrolled in. POST: instructor+/admin publish.
// There is NO email/notification service — visibility is in-app only, and no
// unmoderated public feed is created.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, GROUP_ENROLLMENT_STATE, requireActiveMembership, requireOrgInstructor } from '@/lib/institution'
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
    return NextResponse.json({ announcements: visible.map(toAnnouncementDTO) }, { headers: { 'Cache-Control': 'no-store' } })
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

    const now = new Date()
    const announcement = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.organizationAnnouncement.create({
        data: {
          organizationId: id,
          groupId: input.groupId ?? null,
          authorMembershipId: guard.membership.id,
          title: input.title,
          body: input.body,
          status: 'PUBLISHED',
          publishedAt: now,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'ANNOUNCEMENT',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'ANNOUNCEMENT_PUBLISHED',
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
