// ─── BEAN Trust & Quality (Phase 6): admin complaints search ─────────────────
// GET /api/admin/trust/complaints?status=&category=&severity=&q=&sensitive=
// ADMIN-only case search. This is the ONLY endpoint that returns complaint
// content — there are no public complaint endpoints anywhere.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { COMPLAINT_CATEGORIES, COMPLAINT_SEVERITY, COMPLAINT_STATUS } from '@/lib/trust'
import { toAdminComplaint } from '@/lib/trust-dto'
import { MAX_QUERY_LENGTH } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? ''
    const category = url.searchParams.get('category') ?? ''
    const severity = url.searchParams.get('severity') ?? ''
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const sensitive = url.searchParams.get('sensitive')

    const complaints = await db.teachComplaint.findMany({
      where: {
        ...(status && (COMPLAINT_STATUS as Record<string, string>)[status] ? { status } : {}),
        ...(category && (COMPLAINT_CATEGORIES as readonly string[]).includes(category) ? { category } : {}),
        ...(severity && (COMPLAINT_SEVERITY as Record<string, string>)[severity] ? { severity } : {}),
        ...(sensitive === '1' ? { isSensitive: true } : {}),
        ...(q
          ? {
              OR: [
                { subject: { contains: q } },
                { description: { contains: q } },
                { category: { contains: q } },
              ],
            }
          : {}),
      },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        complainant: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    })

    // Class titles joined separately — complaints deliberately carry no FK to
    // ClassSession so investigation history survives class deletion.
    const classIds = [...new Set(complaints.map((c) => c.classSessionId).filter((v): v is string => !!v))]
    const classRows = classIds.length
      ? await db.classSession.findMany({ where: { id: { in: classIds } }, select: { id: true, title: true } })
      : []
    const titleMap = new Map(classRows.map((c) => [c.id, c.title]))

    return NextResponse.json({
      complaints: complaints.map((c) =>
        toAdminComplaint({
          ...c,
          classSession: c.classSessionId ? { title: titleMap.get(c.classSessionId) ?? '' } : null,
        }),
      ),
    })
  } catch (err) {
    console.error('[api/admin/trust/complaints GET]', err)
    return NextResponse.json({ error: 'Could not load complaints — please try again.' }, { status: 500 })
  }
}
