// ─── BEAN Trust & Quality (Phase 6): admin teacher trust list ────────────────
// GET /api/admin/trust/teachers?q= — ADMIN-only list of approved teachers with
// trust context: review aggregates (server-computed), anonymous complaint
// counts (total + open — content stays in the complaints module), active
// restrictions and verification status (kept separate from misconduct state).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { MAX_QUERY_LENGTH } from '@/lib/teach'
import {
  computeTeacherQuality,
  OPEN_COMPLAINT_STATUSES,
  type TrustActionRow,
} from '@/lib/trust'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const now = new Date()

    const profiles = await db.teacherProfile.findMany({
      where: { verificationStatus: 'APPROVED', ...(q ? { teachingName: { contains: q } } : {}) },
      orderBy: { teachingName: 'asc' },
      take: 100,
      select: {
        id: true,
        studentId: true,
        teachingName: true,
        verificationStatus: true,
        isPublished: true,
      },
    })
    if (profiles.length === 0) return NextResponse.json({ teachers: [] })

    const profileIds = profiles.map((p) => p.id)

    // Aggregate queries — N+1-free and complaint-content-free.
    const [reviewRows, classRows, complaintRows, actionRows] = await Promise.all([
      db.classReview.findMany({
        where: { teacherProfileId: { in: profileIds } },
        select: { teacherProfileId: true, rating: true, status: true, isVerified: true },
      }),
      db.classSession.groupBy({
        by: ['teacherProfileId', 'status'],
        where: { teacherProfileId: { in: profileIds }, status: { in: ['COMPLETED', 'CANCELLED', 'PUBLISHED'] } },
        _count: { _all: true },
      }),
      db.teachComplaint.groupBy({
        by: ['teacherProfileId', 'status'],
        where: { teacherProfileId: { in: profileIds } },
        _count: { _all: true },
      }),
      db.trustAction.findMany({
        where: { teacherProfileId: { in: profileIds }, isActive: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const teachers = profiles.map((p) => {
      const reviews = reviewRows.filter((r) => r.teacherProfileId === p.id)
      const classes = classRows.filter((c) => c.teacherProfileId === p.id)
      const complaints = complaintRows.filter((c) => c.teacherProfileId === p.id)
      const actionRowsForTeacher = actionRows.filter((a) => a.teacherProfileId === p.id) as unknown as TrustActionRow[]
      const quality = computeTeacherQuality(reviews, {
        completedClasses: classes.find((c) => c.status === 'COMPLETED')?._count._all ?? 0,
        cancelledClasses: classes.find((c) => c.status === 'CANCELLED')?._count._all ?? 0,
        publishedClasses: classes.find((c) => c.status === 'PUBLISHED')?._count._all ?? 0,
      })
      const activeRestrictions = actionRowsForTeacher
        .filter(
          (a) =>
            a.isActive &&
            (a.endsAt === null || a.endsAt.getTime() > now.getTime()),
        )
        .map((a) => a.action)
      return {
        teacherProfileId: p.id,
        teachingName: p.teachingName,
        studentId: p.studentId,
        verificationStatus: p.verificationStatus,
        isPublished: p.isPublished,
        reviewCount: quality.reviewCount,
        averageRating: quality.averageRating,
        openComplaints: complaints
          .filter((c) => (OPEN_COMPLAINT_STATUSES as readonly string[]).includes(c.status))
          .reduce((sum, c) => sum + c._count._all, 0),
        totalComplaints: complaints.reduce((sum, c) => sum + c._count._all, 0),
        activeRestrictions,
        restrictions: actionRowsForTeacher.map((a) => ({
          id: (a as unknown as { id: string }).id,
          action: a.action,
          reason: (a as unknown as { reason: string }).reason,
          startsAt: a.startsAt.toISOString(),
          endsAt: a.endsAt ? a.endsAt.toISOString() : null,
          isActive: a.isActive,
          currentlyEnforced:
            a.isActive && (a.endsAt === null || a.endsAt.getTime() > now.getTime()),
        })),
      }
    })
    return NextResponse.json({ teachers })
  } catch (err) {
    console.error('[api/admin/trust/teachers GET]', err)
    return NextResponse.json({ error: 'Could not load teacher trust data — please try again.' }, { status: 500 })
  }
}
