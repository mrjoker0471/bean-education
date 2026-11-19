// ─── Phase 7: Application detail (applicant's own view) ──────────────────────
// GET returns ONE application to its OWNER only (row-scoped findFirst — any
// other id resolves as 404, no existence oracle). The response carries the
// submission-time snapshot, the consent flag, the candidate-visible status
// note and the hosting opportunity/organization — employerNotes NEVER appear
// here (employer-private field).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { db } from '@/lib/db'
import { toApplicationDetailDTO } from '@/lib/career-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ applicationId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { applicationId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const application = await db.careerApplication.findFirst({
      where: { id: applicationId, studentId: student.id },
      include: {
        opportunity: {
          include: { organization: { select: { id: true, name: true, verificationStatus: true } } },
        },
      },
    })
    if (!application) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

    return NextResponse.json(
      { application: toApplicationDetailDTO(application) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    console.error('[api/career/applications/[applicationId] GET]', err)
    return NextResponse.json({ error: 'Could not load the application.' }, { status: 500 })
  }
}
