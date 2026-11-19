// ─── Phase 7: Organization detail — view / update profile ────────────────────
// GET returns the org profile with the caller's membership context.
// PATCH is limited to OWNER/ADMIN of the organization. Verification status is
// never editable here — only the admin verification route can change it.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendOrgAudit, requireActiveMembership, requireOrgAdmin } from '@/lib/institution'
import { organizationUpdateSchema } from '@/lib/institution-schema'
import { toOwnOrganization, toPublicOrganization } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const org = await db.organization.findUnique({ where: { id } })
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    const membership = await db.organizationMembership.findUnique({
      where: { organizationId_studentId: { organizationId: id, studentId: student.id } },
    })
    // Non-members see the public profile only (no verification notes/reasons).
    if (!membership) {
      return NextResponse.json(
        { organization: toPublicOrganization(org), membership: null },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    return NextResponse.json(
      {
        organization: toOwnOrganization(org),
        membership: { id: membership.id, role: membership.role, status: membership.status },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations/[id] GET]', err)
    return NextResponse.json({ error: 'Could not load the organization.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { id } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const guard = await requireOrgAdmin(student.id, id)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = organizationUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid organization details' }, { status: 400 })
    const input = parsed.data

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const org = await tx.organization.update({
        where: { id },
        data: {
          displayName: input.displayName ?? undefined,
          description: input.description ?? undefined,
          website: input.website === undefined ? undefined : input.website,
          publicContact: input.publicContact ?? undefined,
          country: input.country ?? undefined,
          state: input.state ?? undefined,
          city: input.city ?? undefined,
          logoText: input.logoText ?? undefined,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: id,
        entityType: 'ORGANIZATION',
        entityId: id,
        actorId: student.id,
        actorRole: student.role,
        action: 'ORGANIZATION_PROFILE_UPDATED',
      })
      return org
    })
    return NextResponse.json({ organization: toOwnOrganization(updated) })
  } catch (err) {
    console.error('[api/organizations/[id] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the organization.' }, { status: 500 })
  }
}
