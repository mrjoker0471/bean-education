// ─── Phase 7: Organization members list ──────────────────────────────────────
// Active members can see the roster (displayName + role + status only — no
// emails, no private student data). Admins additionally see counts.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireActiveMembership } from '@/lib/institution'
import { toMemberDTO } from '@/lib/institution-dto'

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

    const members = await db.organizationMembership.findMany({
      where: { organizationId: id },
      include: { student: { select: { displayName: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const counts = {
      total: members.length,
      active: members.filter((m) => m.status === 'ACTIVE').length,
      pending: members.filter((m) => m.status === 'INVITED').length,
      suspended: members.filter((m) => m.status === 'SUSPENDED').length,
    }
    return NextResponse.json({ members: members.map(toMemberDTO), counts }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/organizations/[id]/members GET]', err)
    return NextResponse.json({ error: 'Could not load members.' }, { status: 500 })
  }
}
