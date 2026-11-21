// ─── BEAN Trust & Quality (Phase 6): private complaints / incident reports ───
// GET  /api/teach/complaints — the caller's OWN complaint list (complainant
//      view; admin notes redacted by the mapper). Teachers never appear here.
// POST /api/teach/complaints — file a private report. Legitimate-relationship
//      rule: class-linked categories require the caller to hold a booking in
//      that class OR be that class's teacher (student-conduct reports).
//      Platform-level reports (no class) are allowed only for SAFEGUARDING /
//      HARASSMENT / OTHER. Severity and sensitivity are SERVER-DERIVED from
//      the category — clients cannot assert them. Complaints are private:
//      no public endpoint exposes them, and the concerned teacher never sees
//      reporter identity or content. Filing NEVER changes bookings, reviews,
//      ratings or teacher status (no automatic consequences).
//      Sensitive cases get elevated priority and safe-guarding guidance in UI.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  deriveComplaintSeverity,
  isSensitiveCategory,
  rateLimited,
  countRecent,
  RATE_LIMITS,
  COMPLAINT_STATUS,
} from '@/lib/trust'
import { complaintCreateSchema } from '@/lib/trust-schema'
import { toOwnComplaint } from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const complaints = await db.teachComplaint.findMany({
      where: { complainantId: student.id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const classIds = [...new Set(complaints.map((c) => c.classSessionId).filter((v): v is string => !!v))]
    const classRows = classIds.length
      ? await db.classSession.findMany({ where: { id: { in: classIds } }, select: { id: true, title: true } })
      : []
    const titleMap = new Map(classRows.map((c) => [c.id, c.title]))
    return NextResponse.json({
      complaints: complaints.map((c) =>
        toOwnComplaint({
          ...c,
          classSession: c.classSessionId ? { title: titleMap.get(c.classSessionId) ?? '' } : null,
        }),
      ),
    })
  } catch (err) {
    console.error('[api/teach/complaints GET]', err)
    return NextResponse.json({ error: 'Could not load your reports — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in to file a report.' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const parsed = complaintCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid report' }, { status: 400 })
    }

    const recent = await countRecent('teachComplaint', student.id, new Date())
    if (rateLimited('COMPLAINTS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'You have reached the report limit for today — please try again later.' }, { status: 429 })
    }

    const { category, classSessionId, subject, description } = parsed.data
    const isSensitive = isSensitiveCategory(category)

    // Legitimate product relationship: a class-linked report needs the caller
    // to be a booked student of that class or the class's teacher.
    let classBookingId: string | null = null
    let teacherProfileId: string | null = null
    if (classSessionId) {
      const classSession = await db.classSession.findUnique({
        where: { id: classSessionId },
        include: { teacherProfile: { select: { id: true, studentId: true } } },
      })
      if (!classSession || classSession.status === 'DRAFT') {
        return NextResponse.json({ error: 'Class not found' }, { status: 404 })
      }
      const booking = await db.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId, studentId: student.id } },
      })
      const isClassTeacher = classSession.teacherProfile.studentId === student.id
      if (!booking && !isClassTeacher) {
        return NextResponse.json(
          { error: 'You can only report classes you booked or taught.' },
          { status: 403 },
        )
      }
      classBookingId = booking?.id ?? null
      teacherProfileId = isClassTeacher ? null : classSession.teacherProfile.id
    }

    const severity = deriveComplaintSeverity(category, false)

    const complaint = await db.$transaction(async (tx) => {
      const created = await tx.teachComplaint.create({
        data: {
          complainantId: student.id,
          classSessionId: classSessionId ?? null,
          classBookingId,
          teacherProfileId,
          category,
          severity,
          isSensitive,
          subject,
          description,
          status: COMPLAINT_STATUS.OPEN,
        },
      })
      await tx.complaintEvent.create({
        data: {
          complaintId: created.id,
          actorId: student.id,
          actorRole: student.role,
          action: 'CREATED',
          detail: null, // the description lives on the complaint row — events stay lean
        },
      })
      return created
    })

    // Privacy-conscious response: id + status only; full case returned via GET.
    return NextResponse.json(
      { complaint: { id: complaint.id, status: complaint.status, isSensitive: complaint.isSensitive } },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/teach/complaints POST]', err)
    return NextResponse.json({ error: 'Could not file your report — please try again.' }, { status: 500 })
  }
}
