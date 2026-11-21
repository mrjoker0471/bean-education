// ─── Phase 7: Institution learning resources ─────────────────────────────────
// GET: members see org-wide resources plus resources scoped to their active
// groups. POST: instructor+ share an external HTTPS resource link. Private
// student documents stay inside the existing Riishe storage — resources here
// are link-only and never touch private uploads.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, GROUP_ENROLLMENT_STATE, isValidHttpUrl, requireActiveMembership, requireOrgInstructor } from '@/lib/institution'
import { resourceCreateSchema } from '@/lib/institution-schema'
import { toResourceDTO } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/** Resolve authoring members' display names (id → membership → student) — display
 *  names only, never emails. Kept additive: guards and visibility filters untouched. */
async function authorNamesByMembershipId(organizationId: string, membershipIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(membershipIds)]
  if (ids.length === 0) return new Map()
  const rows = await db.organizationMembership.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, student: { select: { displayName: true } } },
  })
  return new Map(rows.map((m) => [m.id, m.student.displayName]))
}

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
    const resources = await db.organizationResource.findMany({
      where: {
        organizationId: id,
        OR: [{ groupId: null }, { groupId: { in: enrollments.map((e) => e.groupId) } }],
      },
      orderBy: { createdAt: 'desc' },
    })
    const authorNames = await authorNamesByMembershipId(id, resources.map((r) => r.authorMembershipId))
    return NextResponse.json(
      { resources: resources.map((r) => toResourceDTO(r, authorNames.get(r.authorMembershipId) ?? null)) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/resources GET]', err)
    return NextResponse.json({ error: 'Could not load resources.' }, { status: 500 })
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

    const parsed = resourceCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid resource details' }, { status: 400 })
    const input = parsed.data
    if (!isValidHttpUrl(input.url)) {
      return NextResponse.json({ error: 'Resource links must be valid HTTPS URLs.' }, { status: 400 })
    }
    if (input.groupId) {
      const group = await db.organizationGroup.findUnique({ where: { id: input.groupId } })
      if (!group || group.organizationId !== id) {
        return NextResponse.json({ error: 'Group not found in this organization' }, { status: 404 })
      }
    }

    const resource = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.organizationResource.create({
        data: {
          organizationId: id,
          groupId: input.groupId ?? null,
          authorMembershipId: guard.membership.id,
          title: input.title,
          description: input.description ?? null,
          url: input.url,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'RESOURCE',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'RESOURCE_SHARED',
        detail: input.groupId ? `groupId=${input.groupId}` : 'audience=ORGANIZATION',
      })
      return created
    })
    const authorNames = await authorNamesByMembershipId(id, [guard.membership.id])
    return NextResponse.json(
      { resource: toResourceDTO(resource, authorNames.get(guard.membership.id) ?? null) },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/organizations/[id]/resources POST]', err)
    return NextResponse.json({ error: 'Could not share the resource.' }, { status: 500 })
  }
}
