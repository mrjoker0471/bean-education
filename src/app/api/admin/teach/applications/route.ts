// ─── BEAN Teach (Phase 4A): admin — teacher application queue ────────────────
// GET /api/admin/teach/applications — ADMIN only. Paginated list of teacher
// applications (pending / approved / rejected / all) with applicant account
// basics and the append-only review history for each. Bounded search by
// applicant email, display name or teaching name.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ADMIN_PAGE_SIZE_DEFAULT, ADMIN_PAGE_SIZE_MAX, MAX_QUERY_LENGTH, toAdminApplicationDTO } from '@/lib/teach'
import { requireAdmin } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status, headers: { 'Cache-Control': 'no-store' } })
    }

    const url = new URL(req.url)
    const status = (url.searchParams.get('status') ?? 'ALL').toUpperCase()
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(1, Math.min(ADMIN_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || ADMIN_PAGE_SIZE_DEFAULT))

    const where = {
      ...(status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? { verificationStatus: status } : {}),
      ...(q
        ? {
            OR: [
              { teachingName: { contains: q } },
              { student: { email: { contains: q } } },
              { student: { displayName: { contains: q } } },
            ],
          }
        : {}),
    }

    const [profiles, total] = await Promise.all([
      db.teacherProfile.findMany({
        where,
        include: { student: { select: { displayName: true, email: true, learningLevel: true } } },
        orderBy: [{ verificationStatus: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.teacherProfile.count({ where }),
    ])

    // Append-only history for the page's applications (one bounded query).
    const ids = profiles.map((p) => p.id)
    const events = ids.length
      ? await db.teachAuditEvent.findMany({
          where: { entityType: 'TEACHER_PROFILE', entityId: { in: ids } },
          orderBy: { createdAt: 'asc' },
          take: 1000,
        })
      : []
    const eventsByProfile = new Map<string, typeof events>()
    for (const e of events) {
      const list = eventsByProfile.get(e.entityId) ?? []
      list.push(e)
      eventsByProfile.set(e.entityId, list)
    }

    const applications = profiles.map((p) =>
      toAdminApplicationDTO(p, { displayName: p.student.displayName, email: p.student.email, learningLevel: p.student.learningLevel }, eventsByProfile.get(p.id) ?? []),
    )

    return NextResponse.json({ applications, total, page, pageSize }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/admin/teach/applications GET]', err)
    return NextResponse.json({ error: 'Could not load applications — please try again.' }, { status: 500 })
  }
}
