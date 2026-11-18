// ─── BEAN Teach (Phase 4A): class marketplace + creation ─────────────────────
// GET  /api/teach/classes — PUBLISHED, upcoming classes of APPROVED+published
//      teachers only. Drafts and cancelled classes are hidden from discovery.
//      Bounded filters (subject / level / language / date range / teacher /
//      duration bucket), search and pagination. Available-seat counts are
//      always server-computed.
// POST /api/teach/classes — approved teacher only. Creates a DRAFT class.
//      Validation: duration 60–360 in 30-minute steps, capacity 1–50,
//      minimumStudents ≤ capacity, future schedule, valid IANA time zone,
//      anti-spam cap on active classes. Planned price is stored as METADATA
//      ONLY — the free pilot never charges anything.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import {
  CAPACITY_MAX,
  CLASSES_PAGE_SIZE_DEFAULT,
  CLASSES_PAGE_SIZE_MAX,
  DURATION_MAX,
  DURATION_MIN,
  MAX_ACTIVE_CLASSES_PER_TEACHER,
  MAX_QUERY_LENGTH,
  isValidDuration,
  isValidTimeZone,
  requireApprovedTeacher,
  toPublicClass,
} from '@/lib/teach'
import { teachClassCreateSchema } from '@/lib/teach-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const subject = (url.searchParams.get('subject') ?? '').slice(0, 60).trim()
    const level = (url.searchParams.get('level') ?? '').slice(0, 30).trim()
    const language = (url.searchParams.get('language') ?? '').slice(0, 30).trim()
    const teacherName = (url.searchParams.get('teacher') ?? '').slice(0, MAX_QUERY_LENGTH).trim()
    const teacherId = (url.searchParams.get('teacherId') ?? '').slice(0, 40).trim()
    const fromRaw = url.searchParams.get('from')
    const toRaw = url.searchParams.get('to')
    const duration = (url.searchParams.get('duration') ?? '').trim().toUpperCase()
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get('page')) || 1))
    const pageSize = Math.max(1, Math.min(CLASSES_PAGE_SIZE_MAX, Number(url.searchParams.get('pageSize')) || CLASSES_PAGE_SIZE_DEFAULT))

    // Duration buckets (minutes): SHORT 60–90, MEDIUM 120–180, LONG 210–360.
    let durationGte: number | undefined
    let durationLte: number | undefined
    if (duration === 'SHORT') [durationGte, durationLte] = [60, 90]
    else if (duration === 'MEDIUM') [durationGte, durationLte] = [120, 180]
    else if (duration === 'LONG') [durationGte, durationLte] = [210, DURATION_MAX]

    let from: Date | undefined
    let to: Date | undefined
    if (fromRaw) {
      const d = new Date(fromRaw)
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid from date' }, { status: 400 })
      from = d
    }
    if (toRaw) {
      const d = new Date(toRaw)
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid to date' }, { status: 400 })
      to = d
    }

    const now = new Date()
    const where = {
      status: 'PUBLISHED' as const,
      startsAt: { gt: now, ...(from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : {}) },
      teacherProfile: {
        verificationStatus: 'APPROVED' as const,
        isPublished: true,
        ...(teacherName ? { teachingName: { contains: teacherName } } : {}),
      },
      ...(teacherId ? { teacherProfileId: teacherId } : {}),
      ...(subject ? { subject: { contains: subject } } : {}),
      ...(level ? { targetLevel: level } : {}),
      ...(language ? { language: { contains: language } } : {}),
      ...(durationGte || durationLte
        ? { durationMinutes: { ...(durationGte ? { gte: durationGte } : {}), ...(durationLte ? { lte: durationLte } : {}) } }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { subject: { contains: q } },
              { teacherProfile: { teachingName: { contains: q } } },
            ],
          }
        : {}),
    }

    const [sessions, total] = await Promise.all([
      db.classSession.findMany({
        where,
        include: { teacherProfile: { select: { id: true, teachingName: true, headline: true } } },
        orderBy: { startsAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.classSession.count({ where }),
    ])

    return NextResponse.json(
      { classes: sessions.map((s) => toPublicClass(s, s.teacherProfile)), total, page, pageSize },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/teach/classes GET]', err)
    return NextResponse.json({ error: 'Could not load classes — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { student, profile } = guard

    const parsed = teachClassCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid class details — check the form and try again.' }, { status: 400 })
    }
    const data = parsed.data

    if (!isValidDuration(data.durationMinutes)) {
      return NextResponse.json(
        { error: `Duration must be between ${DURATION_MIN} and ${DURATION_MAX} minutes in 30-minute steps.` },
        { status: 400 },
      )
    }
    if (data.capacity < 1 || data.capacity > CAPACITY_MAX) {
      return NextResponse.json({ error: `Capacity must be between 1 and ${CAPACITY_MAX}.` }, { status: 400 })
    }
    if (data.minimumStudents > data.capacity) {
      return NextResponse.json({ error: 'Minimum enrolment cannot exceed capacity.' }, { status: 400 })
    }
    if (!isValidTimeZone(data.timeZone)) {
      return NextResponse.json({ error: 'Unknown time zone — pick one from the list.' }, { status: 400 })
    }
    const startsAt = new Date(data.startsAt)
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Schedule must be a future date and time.' }, { status: 400 })
    }

    // Anti-spam: cap concurrent active (DRAFT + PUBLISHED) classes per teacher.
    const activeCount = await db.classSession.count({
      where: { teacherProfileId: profile.id, status: { in: ['DRAFT', 'PUBLISHED'] } },
    })
    if (activeCount >= MAX_ACTIVE_CLASSES_PER_TEACHER) {
      return NextResponse.json(
        { error: `You already have ${MAX_ACTIVE_CLASSES_PER_TEACHER} active classes — complete or cancel some first.` },
        { status: 409 },
      )
    }

    const created = await db.classSession.create({
      data: {
        teacherProfileId: profile.id,
        title: data.title,
        description: data.description,
        subject: data.subject,
        targetLevel: data.targetLevel,
        language: data.language,
        durationMinutes: data.durationMinutes,
        startsAt,
        timeZone: data.timeZone,
        capacity: data.capacity,
        minimumStudents: data.minimumStudents,
        plannedPricePaise: data.plannedPricePaise ?? 0,
        status: 'DRAFT', // every new class starts as a draft — publish is explicit
      },
    })
    return NextResponse.json({ class: toPublicClass(created, profile) }, { status: 201 })
  } catch (err) {
    console.error('[api/teach/classes POST]', err)
    return NextResponse.json({ error: 'Could not create the class — please try again.' }, { status: 500 })
  }
}
