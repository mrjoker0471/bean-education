// ─── BEAN Trust & Quality (Phase 6): server-side teacher quality lookup ──────
// Single shared implementation for the public teacher list/detail APIs and the
// teacher trust dashboard: aggregates are ALWAYS recomputed from authoritative
// database rows (never accepted from the browser), hidden/unverified reviews
// are excluded, and complaint data is never an input.

import { db } from '@/lib/db'
import { computeTeacherQuality } from '@/lib/trust'
import { toPublicQuality, type PublicQualityDTO } from '@/lib/trust-dto'

export async function teacherQualityFor(teacherProfileId: string): Promise<PublicQualityDTO> {
  const [reviewRows, completed, cancelled, published] = await Promise.all([
    db.classReview.findMany({
      where: { teacherProfileId },
      select: { rating: true, status: true, isVerified: true },
    }),
    db.classSession.count({ where: { teacherProfileId, status: 'COMPLETED' } }),
    db.classSession.count({ where: { teacherProfileId, status: 'CANCELLED' } }),
    db.classSession.count({ where: { teacherProfileId, status: 'PUBLISHED' } }),
  ])
  return toPublicQuality(
    computeTeacherQuality(reviewRows, {
      completedClasses: completed,
      cancelledClasses: cancelled,
      publishedClasses: published,
    }),
  )
}

/** Batch variant for list endpoints (N+1-free: 3 grouped queries total). */
export async function teacherQualityBatch(
  teacherProfileIds: string[],
): Promise<Map<string, PublicQualityDTO>> {
  const map = new Map<string, PublicQualityDTO>()
  if (teacherProfileIds.length === 0) return map
  const [reviewRows, classRows] = await Promise.all([
    db.classReview.findMany({
      where: { teacherProfileId: { in: teacherProfileIds } },
      select: { teacherProfileId: true, rating: true, status: true, isVerified: true },
    }),
    db.classSession.groupBy({
      by: ['teacherProfileId', 'status'],
      where: {
        teacherProfileId: { in: teacherProfileIds },
        status: { in: ['COMPLETED', 'CANCELLED', 'PUBLISHED'] },
      },
      _count: { _all: true },
    }),
  ])
  for (const id of teacherProfileIds) {
    const reviews = reviewRows.filter((r) => r.teacherProfileId === id)
    const countFor = (status: string) =>
      classRows.find((c) => c.teacherProfileId === id && c.status === status)?._count._all ?? 0
    map.set(
      id,
      toPublicQuality(
        computeTeacherQuality(reviews, {
          completedClasses: countFor('COMPLETED'),
          cancelledClasses: countFor('CANCELLED'),
          publishedClasses: countFor('PUBLISHED'),
        }),
      ),
    )
  }
  return map
}
