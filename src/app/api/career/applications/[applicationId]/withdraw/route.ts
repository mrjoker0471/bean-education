// ─── Phase 7: Application withdrawal (applicant-only) ────────────────────────
// WITHDRAWN is a student-only status. Employers can never withdraw on the
// student's behalf; withdrawing stops employer progression from that point
// (the application stays visible to both sides as WITHDRAWN — history kept).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, APPLICATION_STATUS } from '@/lib/career'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ applicationId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { applicationId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const application = await db.careerApplication.findFirst({
      where: { id: applicationId, studentId: student.id },
    })
    if (!application) return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    if (
      application.status === APPLICATION_STATUS.WITHDRAWN ||
      application.status === APPLICATION_STATUS.SELECTED ||
      application.status === APPLICATION_STATUS.REJECTED
    ) {
      return NextResponse.json({ error: 'This application can no longer be withdrawn.' }, { status: 409 })
    }

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.careerApplication.update({
        where: { id: application.id },
        data: { status: APPLICATION_STATUS.WITHDRAWN, withdrawnAt: new Date() },
      })
      await appendCareerAudit(tx, {
        entityType: 'APPLICATION',
        entityId: application.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'APPLICATION_WITHDRAWN',
      })
      return row
    })
    return NextResponse.json({ application: { id: updated.id, status: updated.status } })
  } catch (err) {
    console.error('[api/career/applications/[applicationId]/withdraw PATCH]', err)
    return NextResponse.json({ error: 'Could not withdraw the application.' }, { status: 500 })
  }
}
