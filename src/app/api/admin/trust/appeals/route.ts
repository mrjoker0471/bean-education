// ─── BEAN Trust & Quality (Phase 6): admin appeals queue ─────────────────────
// GET /api/admin/trust/appeals?status= — ADMIN-only appeal queue with appellant
// identity and the captured original decision maker (drives the self-review
// ban on the client side and the server side alike).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { APPEAL_STATUS } from '@/lib/trust'
import { toAdminAppeal } from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? ''

    const appeals = await db.teachAppeal.findMany({
      where: {
        ...(status && (APPEAL_STATUS as Record<string, string>)[status] ? { status } : {}),
      },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        appellant: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({ appeals: appeals.map(toAdminAppeal) })
  } catch (err) {
    console.error('[api/admin/trust/appeals GET]', err)
    return NextResponse.json({ error: 'Could not load appeals — please try again.' }, { status: 500 })
  }
}
