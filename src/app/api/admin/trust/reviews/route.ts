// ─── BEAN Trust & Quality (Phase 6): admin review moderation queue ───────────
// GET /api/admin/trust/reviews?filter=flagged|hidden|published|all — ADMIN-only
// moderation queue with full context (class, teacher, reviewer identity — the
// admin DTO may include reviewer email; this is never exposed publicly).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { REVIEW_STATUS } from '@/lib/trust'
import { toAdminReview, type AdminReviewDTO } from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const filter = (url.searchParams.get('filter') ?? 'flagged').toLowerCase()
    const statusFilter =
      filter === 'hidden'
        ? [REVIEW_STATUS.HIDDEN]
        : filter === 'published'
          ? [REVIEW_STATUS.PUBLISHED]
          : filter === 'all'
            ? [REVIEW_STATUS.PUBLISHED, REVIEW_STATUS.FLAGGED, REVIEW_STATUS.HIDDEN]
            : [REVIEW_STATUS.FLAGGED] // default: the actionable queue

    const rows = await db.classReview.findMany({
      where: { status: { in: statusFilter } },
      include: {
        student: { select: { id: true, displayName: true, email: true } },
        classSession: { select: { id: true, title: true } },
        teacherProfile: { select: { id: true, teachingName: true } },
        response: { select: { responseText: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({ reviews: rows.map((r) => toAdminReview(r) as AdminReviewDTO) })
  } catch (err) {
    console.error('[api/admin/trust/reviews GET]', err)
    return NextResponse.json({ error: 'Could not load the moderation queue — please try again.' }, { status: 500 })
  }
}
