// ─── Phase 7: Institution announcement lifecycle (PATCH) ─────────────────────
// Content edits (title/body/groupId/expiresAt) are instructor-only and are
// blocked once the announcement is archived. Status transitions are explicit
// and role-gated — an announcement never jumps states untracked:
//   DRAFT → PUBLISHED   (org instructor; sets publishedAt)
//   PUBLISHED → ARCHIVED (author or org admin)
//   ARCHIVED → ACTIVE    (author or org admin; restores to PUBLISHED)
// Every mutation is audited inside the same transaction.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, ORG_ADMIN_ROLES, ORG_INSTRUCTOR_ROLES, requireActiveMembership } from '@/lib/institution'
import { announcementUpdateSchema } from '@/lib/institution-schema'
import { toAnnouncementDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; announcementId: string }> }

/** Resolve authoring members' display names (id → membership → student) — display
 *  names only, never emails. Additive to the lifecycle route; guards untouched. */
async function authorNamesByMembershipId(organizationId: string, membershipIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(membershipIds)]
  if (ids.length === 0) return new Map()
  const rows = await db.organizationMembership.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, student: { select: { displayName: true } } },
  })
  return new Map(rows.map((m) => [m.id, m.student.displayName]))
}

/** Allowed next statuses per current status ('ACTIVE' = restore ARCHIVED). */
const ANNOUNCEMENT_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, announcementId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireActiveMembership(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const announcement = await db.organizationAnnouncement.findUnique({ where: { id: announcementId } })
    if (!announcement || announcement.organizationId !== id) {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
    }

    const parsed = announcementUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid announcement details' }, { status: 400 })
    const input = parsed.data

    const wantsContentEdit =
      input.title !== undefined ||
      input.body !== undefined ||
      input.groupId !== undefined ||
      input.expiresAt !== undefined

    const current = announcement.status
    if (input.status) {
      const allowed = ANNOUNCEMENT_TRANSITIONS[current] ?? []
      if (!(allowed as readonly string[]).includes(input.status)) {
        return NextResponse.json(
          {
            error: `Invalid status transition. Allowed from ${current}: ${allowed.length > 0 ? allowed.join(', ') : 'none'}.`,
          },
          { status: 400 },
        )
      }
    }

    const isInstructor = (ORG_INSTRUCTOR_ROLES as readonly string[]).includes(guard.membership.role)
    const isAdmin = (ORG_ADMIN_ROLES as readonly string[]).includes(guard.membership.role)
    const isAuthor = announcement.authorMembershipId === guard.membership.id

    // Content is instructor-only while the announcement is live (DRAFT/PUBLISHED).
    if (wantsContentEdit) {
      if (!isInstructor) {
        return NextResponse.json({ error: 'Only instructors can edit announcement content.' }, { status: 403 })
      }
      if (current === 'ARCHIVED') {
        return NextResponse.json({ error: 'Archived announcements cannot be edited.' }, { status: 409 })
      }
    }

    let statusAction: 'PUBLISH' | 'ARCHIVE' | 'RESTORE' | null = null
    if (input.status === 'PUBLISHED') {
      if (!isInstructor) {
        return NextResponse.json({ error: 'Only instructors can publish announcements.' }, { status: 403 })
      }
      statusAction = 'PUBLISH'
    } else if (input.status === 'ARCHIVED' || input.status === 'ACTIVE') {
      if (!isAuthor && !isAdmin) {
        return NextResponse.json(
          { error: 'Only the announcement author or organization admins can archive or restore it.' },
          { status: 403 },
        )
      }
      statusAction = input.status === 'ARCHIVED' ? 'ARCHIVE' : 'RESTORE'
    }

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
    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const data: Record<string, unknown> = {}
      if (input.title !== undefined) data.title = input.title
      if (input.body !== undefined) data.body = input.body
      if (input.groupId !== undefined) data.groupId = input.groupId ?? null
      if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
      if (statusAction === 'PUBLISH' || statusAction === 'RESTORE') {
        data.status = 'PUBLISHED'
        data.publishedAt = now
      } else if (statusAction === 'ARCHIVE') {
        data.status = 'ARCHIVED'
      }

      const next = await tx.organizationAnnouncement.update({ where: { id: announcementId }, data })
      if (wantsContentEdit) {
        const fields = (['title', 'body', 'groupId', 'expiresAt'] as const).filter((f) => input[f] !== undefined)
        await appendOrgAudit(tx, {
          organizationId: id,
          entityType: 'ANNOUNCEMENT',
          entityId: announcementId,
          actorId: student.id,
          actorRole: student.role,
          action: 'ANNOUNCEMENT_UPDATED',
          detail: `fields=${fields.join(',')}`,
        })
      }
      if (statusAction) {
        await appendOrgAudit(tx, {
          organizationId: id,
          entityType: 'ANNOUNCEMENT',
          entityId: announcementId,
          actorId: student.id,
          actorRole: student.role,
          action:
            statusAction === 'PUBLISH'
              ? 'ANNOUNCEMENT_PUBLISHED'
              : statusAction === 'ARCHIVE'
                ? 'ANNOUNCEMENT_ARCHIVED'
                : 'ANNOUNCEMENT_RESTORED',
          detail: `from=${current}`,
        })
      }
      return next
    })
    const authorNames = await authorNamesByMembershipId(id, [updated.authorMembershipId])
    return NextResponse.json({ announcement: toAnnouncementDTO(updated, authorNames.get(updated.authorMembershipId) ?? null) })
  } catch (err) {
    console.error('[api/organizations/[id]/announcements/[announcementId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the announcement.' }, { status: 500 })
  }
}
