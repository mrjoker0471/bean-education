// ─── Phase 7: My applications (student's own, employer notes never present) ──

import { NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { toOwnApplicationDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const applications = await db.careerApplication.findMany({
      where: { studentId: student.id },
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
