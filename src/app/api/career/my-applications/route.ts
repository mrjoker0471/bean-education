// ─── Phase 7: My applications (student's own, employer notes never present) ──
// Optional `status` filter (application enum or ALL — anything else is 400).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { APPLICATION_STATUS } from '@/lib/career'
import { toOwnApplicationDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const APPLICATION_STATUSES = Object.values(APPLICATION_STATUS)

export async function GET(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    // Optional owner-side status filter: enum value or ALL (default — unchanged
    // behavior). An unrecognized value is a client error, never silently ignored.
    const statusRaw = ((new URL(req.url).searchParams.get('status') ?? '') as string).trim().toUpperCase()
    if (statusRaw && statusRaw !== 'ALL' && !APPLICATION_STATUSES.includes(statusRaw as (typeof APPLICATION_STATUS)[keyof typeof APPLICATION_STATUS])) {
      return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 })
    }
    const applications = await db.careerApplication.findMany({
      where: {
        studentId: student.id,
        ...(statusRaw && statusRaw !== 'ALL' ? { status: statusRaw } : {}),
      },
      include: { opportunity: { include: { organization: true } } },
      orderBy: { submittedAt: 'desc' },
    })
    return NextResponse.json(
      { applications: applications.map(toOwnApplicationDTO) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/my-applications GET]', err)
    return NextResponse.json({ error: 'Could not load your applications.' }, { status: 500 })
  }
}
