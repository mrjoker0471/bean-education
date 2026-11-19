// ─── Phase 7: Employer application status change ─────────────────────────────
// PATCH moves an applicant through the pipeline (UNDER_REVIEW → … → SELECTED/
// REJECTED). Scoped to the employer's own opportunities; candidateVisible notes
// reach the applicant, employerNotes never do. WITHDRAWN applications are
// frozen. Every change is audited with the employer membership identity.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, APPLICATION_STATUS, EMPLOYER_APPLICATION_ACTIONS } from '@/lib/career'
import { employerApplicationStatusSchema } from '@/lib/career-schema'
import { ORG_EMPLOYER_ROLES, requireOrgRole } from '@/lib/institution'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ employerApplicationId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { employerApplicationId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const application = await db.careerApplication.findUnique({
      where: { id: employerApplicationId },
      include: { opportunity: { select: { employerOrganizationId: true, title: true } } },
    })
    if (!application) return NextResponse.json({ error: 'Application not found' }, { status: 404 })

    const guard = await requireOrgRole(student.id, application.opportunity.employerOrganizationId, ORG_EMPLOYER_ROLES)
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const parsed = employerApplicationStatusSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid status change' }, { status: 400 })
    const { status, candidateVisibleStatusNote, employerNotes } = parsed.data

    if (!(EMPLOYER_APPLICATION_ACTIONS as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status change' }, { status: 400 })
    }
    if (application.status === APPLICATION_STATUS.WITHDRAWN) {
      return NextResponse.json({ error: 'This application was withdrawn by the candidate.' }, { status: 409 })
    }
    if (application.status === APPLICATION_STATUS.SELECTED || application.status === APPLICATION_STATUS.REJECTED) {
      return NextResponse.json({ error: 'A final decision was already recorded for this application.' }, { status: 409 })
    }

    const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.careerApplication.update({
        where: { id: application.id },
        data: {
          status,
          candidateVisibleStatusNote: candidateVisibleStatusNote ?? undefined,
          employerNotes: employerNotes ?? undefined,
        },
      })
      await appendCareerAudit(tx, {
        entityType: 'APPLICATION',
        entityId: application.id,
        actorId: student.id,
        actorRole: `ORG_MEMBER:${guard.membership.role}`,
        action: 'APPLICATION_STATUS_CHANGED',
        detail: `${application.status}->${status}`,
      })
      return row
    })
    return NextResponse.json({ application: { id: updated.id, status: updated.status, candidateVisibleStatusNote: updated.candidateVisibleStatusNote } })
  } catch (err) {
    console.error('[api/career/employer/applications/[employerApplicationId]/status PATCH]', err)
    return NextResponse.json({ error: 'Could not update the application.' }, { status: 500 })
  }
}
