// ─── BEAN Classroom Intelligence (CI-1D): student class summaries ────────────
// GET /api/learn/class-summaries — the signed-in student's class-level
// learning summaries for classes they ATTENDED. Ownership is enforced by the
// database relationship itself (summary rows join through the caller's own
// bookings); a student can never see another student's rows because the query
// is scoped by booking.studentId from the session — never a client-supplied id.
//
// Content discipline: summaries are CLASS-LEVEL material (same content for
// every attendee of the class) with a fixed scope note. No individual
// assessment, no engagement scores, no ranking.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent } from '@/lib/auth'
import type { CiStudentSummariesResponse, CiStudentSummaryDTO } from '@/lib/ci/dto'
import { studentSummarySchema, type StudentSummary } from '@/lib/ci/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in to see your class summaries.' }, { status: 401 })
    }

    const rows = await db.classroomStudentSummary.findMany({
      where: { booking: { studentId: student.id } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        bookingId: true,
        classSessionId: true,
        summaryJson: true,
        createdAt: true,
        booking: {
          select: {
            classSession: {
              select: { id: true, title: true, subject: true, startsAt: true, timeZone: true },
            },
          },
        },
      },
    })

    const summaries: CiStudentSummaryDTO[] = []
    for (const row of rows) {
      // Defensive parse: a malformed stored summary is skipped honestly
      // (never guessed at); the rest of the list still renders.
      let summary: StudentSummary | null = null
      try {
        const parsed = studentSummarySchema.safeParse(JSON.parse(row.summaryJson))
        if (parsed.success) summary = parsed.data
      } catch {
        // fall through with summary = null
      }
      if (!summary) continue
      summaries.push({
        bookingId: row.bookingId,
        classSessionId: row.classSessionId,
        title: row.booking.classSession.title,
        subject: row.booking.classSession.subject,
        startsAt: row.booking.classSession.startsAt.toISOString(),
        timeZone: row.booking.classSession.timeZone,
        summary,
        generatedAt: row.createdAt.toISOString(),
      })
    }

    const response: CiStudentSummariesResponse = { summaries }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/learn/class-summaries GET]', err)
    return NextResponse.json({ error: 'Could not load your class summaries.' }, { status: 500 })
  }
}
