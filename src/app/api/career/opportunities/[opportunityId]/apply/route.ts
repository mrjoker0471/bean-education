// ─── Phase 7: Opportunity application (candidate-controlled sharing) ─────────
// POST applies to a PUBLISHED, unexpired opportunity. Safeguards (all
// server-enforced):
//   • adult-eligibility must be APPROVED (CareerEligibilityReview)
//   • one application per student/opportunity (unique constraint; P2002 → 409)
//   • the snapshot is built server-side from the student's EXPLICIT
//     selections (whitelisted keys, bounded size) — it is stored verbatim at
//     submission time and never re-derived from the live profile
//   • contact details enter the snapshot ONLY with explicit consent
//   • rate-limited per student; the submission is audited

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  appendCareerAudit,
  APPLICATION_STATUS,
  canApply,
  countRecentCareer,
  careerRateLimited,
  ELIGIBILITY_STATUS,
  isValidApplicationSnapshot,
} from '@/lib/career'
import { applicationCreateSchema } from '@/lib/career-schema'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: Promise<{ opportunityId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const { opportunityId } = await params
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = applicationCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid application' }, { status: 400 })
    const { snapshot, contactSharingConsent } = parsed.data
    if (!isValidApplicationSnapshot(snapshot)) {
      return NextResponse.json({ error: 'The shared profile selection is invalid or too large.' }, { status: 400 })
    }

    const opportunity = await db.careerOpportunity.findUnique({
      where: { id: opportunityId },
      include: { organization: { select: { id: true, verificationStatus: true, isActive: true } } },
    })
    if (!opportunity || opportunity.status !== 'PUBLISHED') {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }
    if (opportunity.applicationDeadline && opportunity.applicationDeadline.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'The application deadline has passed.' }, { status: 409 })
    }
    if (opportunity.organization.verificationStatus !== 'APPROVED' || !opportunity.organization.isActive) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const eligibility = await db.careerEligibilityReview.findUnique({ where: { studentId: student.id } })
    if (!eligibility || !canApply(eligibility.status)) {
      return NextResponse.json(
        { error: 'Applications open after BEAN approves your adult-eligibility review (safeguarding requirement).' },
        { status: 403 },
      )
    }

    const recent = await countRecentCareer('application', student.id, new Date())
    if (careerRateLimited('APPLICATIONS_PER_DAY', recent)) {
      return NextResponse.json({ error: 'Application limit reached for today — please try again tomorrow.' }, { status: 429 })
    }

    // Contact details are injected ONLY with explicit consent — nothing else
    // is ever added to the snapshot beyond what the student selected.
    const finalSnapshot: Record<string, unknown> = { ...snapshot }
    if (contactSharingConsent) {
      finalSnapshot['shareContact'] = { email: student.email }
    } else {
      delete finalSnapshot['shareContact']
    }

    const now = new Date()
    const application = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.careerApplication.create({
        data: {
          opportunityId,
          studentId: student.id,
          status: APPLICATION_STATUS.SUBMITTED,
          snapshotJson: JSON.stringify(finalSnapshot),
          contactSharingConsent,
          submittedAt: now,
        },
      })
      await appendCareerAudit(tx, {
        entityType: 'APPLICATION',
        entityId: created.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'APPLICATION_SUBMITTED',
        detail: `opportunity=${opportunityId}`,
      })
      return created
    })
    return NextResponse.json(
      { application: { id: application.id, status: application.status, submittedAt: application.submittedAt.toISOString() } },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'You have already applied to this opportunity.' }, { status: 409 })
    }
    console.error('[api/career/opportunities/[opportunityId]/apply POST]', err)
    return NextResponse.json({ error: 'Could not submit your application.' }, { status: 500 })
  }
}
