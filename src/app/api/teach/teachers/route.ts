// ─── BEAN Teach (Phase 4A): public teacher discovery ─────────────────────────
// GET /api/teach/teachers — APPROVED + published teacher profiles only.
// Bounded search and filters; pagination capped. Responses never contain email
// addresses, private review notes or private account fields — only the fields
// an admin explicitly approved for the public marketplace.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TEACHERS_PAGE_SIZE_MAX, toPublicTeacher } from '@/lib/teach'
import { teacherQualityBatch } from '@/lib/trust-quality'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, 100).trim()
    const subject = (url.searchParams.get('subject') ?? '').slice(0, 60).trim()
    const level = (url.searchParams.get('level') ?? '').slice(0, 30).trim()
    const language = (url.searchParams.get('language') ?? '').slice(0, 30).trim()
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(1, Math.min(TEACHERS_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || 24))

    // Only approved AND published profiles are publicly discoverable.
    // Phase 6: teachers with an active PAUSE_LISTINGS restriction are excluded
    // from public discovery until reinstated (or the restriction expires).
    const now = new Date()
    const where = {
      verificationStatus: 'APPROVED' as const,
      isPublished: true,
      trustActions: {
        none: {
          action: 'PAUSE_LISTINGS',
          isActive: true,
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      },
      ...(q ? { OR: [{ teachingName: { contains: q } }, { headline: { contains: q } }] } : {}),
      ...(subject ? { subjectsJson: { contains: `"${subject}"` } } : {}),
      ...(level ? { levelsJson: { contains: `"${level}"` } } : {}),
      ...(language ? { languagesJson: { contains: language } } : {}),
    }

    const [profiles, total] = await Promise.all([
      db.teacherProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.teacherProfile.count({ where }),
    ])

    // Upcoming published class counts for this page of teachers (one grouped query).
    const ids = profiles.map((p) => p.id)
    const counts = ids.length
      ? await db.classSession.groupBy({
          by: ['teacherProfileId'],
          where: { teacherProfileId: { in: ids }, status: 'PUBLISHED', startsAt: { gt: new Date() } },
          _count: { _all: true },
        })
      : []
    const countMap = new Map(counts.map((c) => [c.teacherProfileId, c._count._all]))

    // Phase 6 verified quality metrics — server-computed from real records.
    const qualityMap = await teacherQualityBatch(ids)

    const teachers = profiles.map((p) => ({
      ...toPublicTeacher(p, countMap.get(p.id) ?? 0),
      quality: qualityMap.get(p.id),
    }))
    return NextResponse.json(
      { teachers, total, page, pageSize },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/teach/teachers GET]', err)
    return NextResponse.json({ error: 'Could not load teachers — please try again.' }, { status: 500 })
  }
}
