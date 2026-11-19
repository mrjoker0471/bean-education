// ─── Phase 7: Admin — organization verification queue ────────────────────────
// GET lists organizations by verification status (pending by default) with
// the application evidence summary. Non-admins are rejected by the session
// guard. Every decision lands in the separate decision route (append-only).

import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { toPublicOrganization } from '@/lib/institution-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const status = (url.searchParams.get('status') ?? 'PENDING_REVIEW').toUpperCase()
    const allowed = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT', 'ALL']
    const where = allowed.includes(status) && status !== 'ALL' ? { verificationStatus: status } : {}

    const [organizations, total] = await Promise.all([
      db.organization.findMany({
        where,
        include: { memberships: { where: { role: 'OWNER' }, include: { student: { select: { displayName: true } } } }, _count: { select: { memberships: true, groups: true, classes: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 100,
      }),
      db.organization.count({ where }),
    ])

    return NextResponse.json(
      {
        organizations: organizations.map(o => ({
          ...toPublicOrganization(o),
          owner: o.memberships[0]?.student.displayName ?? null,
          memberCount: o._count.memberships,
          groupCount: o._count.groups,
          classCount: o._count.classes,
        })),
        total,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/admin/organizations GET]', err)
    return NextResponse.json({ error: 'Could not load the verification queue.' }, { status: 500 })
  }
}
