// ─── BEAN Teach (Phase 4A): class detail + owner edits ───────────────────────
// GET   /api/teach/classes/:id — public detail for PUBLISHED (and CANCELLED,
//       so affected students can see the cancellation); DRAFT visible ONLY to
//       its owner. The requester's own booking is included when signed in; the
//       owner teacher additionally sees their class's bookings (display names
//       only — never student emails).
// PATCH /api/teach/classes/:id — approved owner teacher only. Completed and
//       cancelled classes are immutable; capacity can never be reduced below
//       the number of seats currently held; schedule changes must stay future.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  CAPACITY_MAX,
  CLASS_STATUS,
  isValidDuration,
  isValidTimeZone,
  requireApprovedTeacher,
  toMyBookingDTO,
  toPublicClass,
} from '@/lib/teach'
import { teachClassPatchSchema } from '@/lib/teach-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await db.classSession.findUnique({
      where: { id },
      include: {
        teacherProfile: { select: { id: true, studentId: true, teachingName: true, headline: true, qualificationsText: true, experienceYears: true, verificationStatus: true, isPublished: true } },
      },
    })
    if (!session) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    const student = await requireStudent()
    const isOwner = !!student && session.teacherProfile.studentId === student.id

    // Visibility: drafts are owner-only; everything else (published/cancelled)
    // is publicly viewable so booked students can always check their class.
    if (session.status === 'DRAFT' && !isOwner) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }

    const myBookingRow = student
      ? await db.classBooking.findUnique({
          where: { classSessionId_studentId: { classSessionId: session.id, studentId: student.id } },
        })
      : null

    // Owner sees enrolled students (display name only — never email/contact).
    const ownerBookings =
      isOwner && session.status !== CLASS_STATUS.DRAFT
        ? await db.classBooking.findMany({
            where: { classSessionId: session.id },
            include: { student: { select: { displayName: true } } },
            orderBy: { bookedAt: 'asc' },
            take: 100,
          })
        : []

    const base = toPublicClass(session, session.teacherProfile)
    return NextResponse.json(
      {
        class: {
          ...base,
          // Approved-teacher identity details (public part of the approved profile).
          teacherQualifications: session.teacherProfile.qualificationsText,
          teacherExperienceYears: session.teacherProfile.experienceYears,
          teacherVerified: session.teacherProfile.verificationStatus === 'APPROVED',
          isOwner,
          myBooking: myBookingRow
            ? toMyBookingDTO(myBookingRow, session, session.teacherProfile.teachingName)
            : null,
          ownerBookings: ownerBookings.map((b) => ({
            id: b.id,
            status: b.status,
            bookedAt: b.bookedAt.toISOString(),
            cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
            attendanceMarkedAt: b.attendanceMarkedAt ? b.attendanceMarkedAt.toISOString() : null,
            studentName: b.student.displayName,
          })),
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/teach/classes/:id GET]', err)
    return NextResponse.json({ error: 'Could not load the class — please try again.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { profile } = guard

    const { id } = await params
    const session = await db.classSession.findUnique({ where: { id } })
    // Ownership is decided server-side — a teacher can only touch their own class.
    if (!session || session.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    if (session.status === CLASS_STATUS.COMPLETED || session.status === CLASS_STATUS.CANCELLED) {
      return NextResponse.json({ error: `A ${session.status.toLowerCase()} class can no longer be edited.` }, { status: 409 })
    }

    const parsed = teachClassPatchSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid class details — check the form and try again.' }, { status: 400 })
    }
    const data = parsed.data
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    if (data.durationMinutes !== undefined && !isValidDuration(data.durationMinutes)) {
      return NextResponse.json({ error: 'Duration must be 60–360 minutes in 30-minute steps.' }, { status: 400 })
    }
    if (!isValidTimeZone(data.timeZone ?? 'UTC')) {
      return NextResponse.json({ error: 'Unknown time zone — pick one from the list.' }, { status: 400 })
    }

    const nextCapacity = data.capacity ?? session.capacity
    const nextMinimum = data.minimumStudents ?? session.minimumStudents
    if (nextCapacity < 1 || nextCapacity > CAPACITY_MAX) {
      return NextResponse.json({ error: `Capacity must be between 1 and ${CAPACITY_MAX}.` }, { status: 400 })
    }
    if (nextMinimum > nextCapacity) {
      return NextResponse.json({ error: 'Minimum enrolment cannot exceed capacity.' }, { status: 400 })
    }
    // Seats currently held (bookings that are not cancelled) must never be
    // evicted by a capacity edit.
    const heldSeats = await db.classBooking.count({
      where: { classSessionId: session.id, status: { not: 'CANCELLED' } },
    })
    if (nextCapacity < heldSeats) {
      return NextResponse.json(
        { error: `Capacity cannot go below the ${heldSeats} seat(s) already reserved.` },
        { status: 409 },
      )
    }

    let startsAt: Date | undefined
    if (data.startsAt !== undefined) {
      startsAt = new Date(data.startsAt)
      if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Schedule must be a future date and time.' }, { status: 400 })
      }
    }

    const updated = await db.classSession.update({
      where: { id: session.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.targetLevel !== undefined ? { targetLevel: data.targetLevel } : {}),
        ...(data.language !== undefined ? { language: data.language } : {}),
        ...(data.durationMinutes !== undefined ? { durationMinutes: data.durationMinutes } : {}),
        ...(startsAt ? { startsAt } : {}),
        ...(data.timeZone !== undefined ? { timeZone: data.timeZone } : {}),
        ...(data.capacity !== undefined ? { capacity: data.capacity } : {}),
        ...(data.minimumStudents !== undefined ? { minimumStudents: data.minimumStudents } : {}),
        ...(data.plannedPricePaise !== undefined ? { plannedPricePaise: data.plannedPricePaise } : {}),
      },
    })
    return NextResponse.json({ class: toPublicClass(updated, profile) })
  } catch (err) {
    console.error('[api/teach/classes/:id PATCH]', err)
    return NextResponse.json({ error: 'Could not update the class — please try again.' }, { status: 500 })
  }
}
