// ─── Phase 7: Organizations — list mine / register a new organization ────────
// POST creates a DRAFT organization and makes the creator its pending OWNER
// (the workspace stays gated until a BEAN administrator approves the org).
// No client-supplied role is trusted.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendOrgAudit,
  ORG_VERIFICATION_STATUS,
  ORG_MEMBERSHIP_STATUS,
  countRecentOrg,
  orgRateLimited,
  slugify,
} from '@/lib/institution'
import { organizationCreateSchema } from '@/lib/institution-schema'
import { toOwnOrganization, toPublicOrganization } from '@/lib/institution-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET: organizations the caller belongs to (with the caller's own membership). */
export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const memberships = await db.organizationMembership.findMany({
      where: { studentId: student.id },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(
      {
        organizations: memberships.map((m) => ({
          organization: toPublicOrganization(m.organization),
          membership: { id: m.id, role: m.role, status: m.status },
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/organizations GET]', err)
    return NextResponse.json({ error: 'Could not load your organizations.' }, { status: 500 })
  }
}

/** POST: register a new organization (creator becomes its pending OWNER). */
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = organizationCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid organization details' }, { status: 400 })
    }
    const input = parsed.data

    const recent = await countRecentOrg('org', student.id, null, new Date())
    if (orgRateLimited('ORGS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'You have registered several organizations recently. Please try again tomorrow.' }, { status: 429 })
    }

    // Slug: derived from name, uniquified by short random suffix on collision.
    const base = slugify(input.name)
    const now = new Date()
    const created = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      let slug = base
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await tx.organization.findUnique({ where: { slug }, select: { id: true } })
        if (!clash) break
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
      }
      const org = await tx.organization.create({
        data: {
          name: input.name,
          displayName: input.displayName ?? null,
          orgType: input.orgType,
          description: input.description ?? null,
          website: input.website ?? null,
          publicContact: input.publicContact ?? null,
          country: input.country ?? null,
          state: input.state ?? null,
          city: input.city ?? null,
          logoText: input.logoText ?? null,
          slug,
          verificationStatus: ORG_VERIFICATION_STATUS.DRAFT,
        },
      })
      await tx.organizationMembership.create({
        data: {
          organizationId: org.id,
          studentId: student.id,
          role: 'OWNER',
          status: ORG_MEMBERSHIP_STATUS.ACTIVE, // workspace functions stay gated on APPROVED status
          activatedAt: now,
        },
      })
      await appendOrgAudit(tx, {
        organizationId: org.id,
        entityType: 'ORGANIZATION',
        entityId: org.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'ORGANIZATION_REGISTERED',
        detail: `type=${org.orgType}`,
      })
      return org
    })

    return NextResponse.json({ organization: toOwnOrganization(created) }, { status: 201 })
  } catch (err) {
    console.error('[api/organizations POST]', err)
    return NextResponse.json({ error: 'Could not register the organization.' }, { status: 500 })
  }
}
