// ─── Phase 7: Institution resource lifecycle (PATCH / DELETE) ────────────────
// The author (OrganizationResource.authorMembershipId) or organization admins
// may edit or remove a shared resource. New URLs stay HTTPS-only and a new
// groupId must belong to the same organization. Resources carry no status
// column and nothing references them by FK — removal is a hard delete, with
// the title + url captured in the append-only audit trail beforehand.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, isValidHttpUrl, ORG_ADMIN_ROLES, requireActiveMembership } from '@/lib/institution'
import { resourceUpdateSchema } from '@/lib/institution-schema'
import { toResourceDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'
import type { OrganizationResource } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; resourceId: string }> }

type ResourceAccess =
  | { ok: false; status: 403 | 404; error: string }
  | { ok: true; resource: OrganizationResource }

/**
 * ACTIVE membership in `id` plus author-or-admin authority over the resource.
 * A resource that exists but belongs to another organization is 404 — no
 * cross-organization existence oracle.
 */
async function authorizeResourceAccess(
  studentId: string,
  organizationId: string,
  resourceId: string,
): Promise<ResourceAccess> {
  const guard = await requireActiveMembership(studentId, organizationId)
  if (!guard.ok) return { ok: false, status: 403, error: guard.error }
  const resource = await db.organizationResource.findUnique({ where: { id: resourceId } })
  if (!resource || resource.organizationId !== organizationId) {
    return { ok: false, status: 404, error: 'Resource not found' }
  }
  const isAdmin = (ORG_ADMIN_ROLES as readonly string[]).includes(guard.membership.role)
  if (resource.authorMembershipId !== guard.membership.id && !isAdmin) {
    return { ok: false, status: 403, error: 'Only the resource author or organization admins can manage this resource.' }
  }
  return { ok: true, resource }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, resourceId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const access = await authorizeResourceAccess(student.id, id, resourceId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const parsed = resourceUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid resource details' }, { status: 400 })
    const input = parsed.data

    const changed = (['title', 'description', 'url', 'groupId'] as const).filter((f) => input[f] !== undefined)
    if (changed.length === 0) {
      return NextResponse.json({ error: 'No resource changes provided.' }, { status: 400 })
    }
    if (input.url !== undefined && !isValidHttpUrl(input.url)) {
      return NextResponse.json({ error: 'Resource links must be valid HTTPS URLs.' }, { status: 400 })
    }
    if (input.groupId) {
      const group = await db.organizationGroup.findUnique({ where: { id: input.groupId } })
      if (!group || group.organizationId !== id) {
        return NextResponse.json({ error: 'Group not found in this organization' }, { status: 404 })
      }
    }

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const data: Record<string, unknown> = {}
      if (input.title !== undefined) data.title = input.title
      if (input.description !== undefined) data.description = input.description ?? null
      if (input.url !== undefined) data.url = input.url
      if (input.groupId !== undefined) data.groupId = input.groupId ?? null
      const next = await tx.organizationResource.update({ where: { id: resourceId }, data })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'RESOURCE',
        entityId: resourceId,
        actorId: student.id,
        actorRole: student.role,
        action: 'RESOURCE_UPDATED',
        detail: `fields=${changed.join(',')}`,
      })
      return next
    })
    return NextResponse.json({ resource: toResourceDTO(updated) })
  } catch (err) {
    console.error('[api/organizations/[id]/resources/[resourceId] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the resource.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id, resourceId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const access = await authorizeResourceAccess(student.id, id, resourceId)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.organizationResource.delete({ where: { id: resourceId } })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'RESOURCE',
        entityId: resourceId,
        actorId: student.id,
        actorRole: student.role,
        action: 'RESOURCE_REMOVED',
        detail: `title=${access.resource.title}; url=${access.resource.url}`,
      })
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/organizations/[id]/resources/[resourceId] DELETE]', err)
    return NextResponse.json({ error: 'Could not remove the resource.' }, { status: 500 })
  }
}
