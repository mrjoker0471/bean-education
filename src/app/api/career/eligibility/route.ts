// ─── Phase 7: Adult-eligibility (safeguarding gate) ──────────────────────────
// GET returns the caller's eligibility state. POST requests a review — a
// BEAN administrator performs the actual review (admin career view). No
// identity documents or numbers are ever collected; the request is an
// acknowledgment only. Until APPROVED, candidate discovery and job
// applications are blocked server-side — private career planning and
// portfolio preparation remain fully available.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { db } from '@/lib/db'
import { appendCareerAudit, ELIGIBILITY_STATUS } from '@/lib/career'
import { eligibilityRequestSchema } from '@/lib/career-schema'
import { toEligibilityDTO } from '@/lib/career-dto'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const review = await db.careerEligibilityReview.findUnique({ where: { studentId: student.id } })
    return NextResponse.json({ eligibility: toEligibilityDTO(review) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/career/eligibility GET]', err)
    return NextResponse.json({ error: 'Could not load your eligibility status.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const parsed = eligibilityRequestSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Acknowledge the eligibility review policy to request a review.' }, { status: 400 })
    }

    const existing = await db.careerEligibilityReview.findUnique({ where: { studentId: student.id } })
    if (existing) {
      if (existing.status === ELIGIBILITY_STATUS.PENDING_REVIEW || existing.status === ELIGIBILITY_STATUS.APPROVED) {
        return NextResponse.json({ eligibility: toEligibilityDTO(existing), unchanged: true })
      }
    }

    const now = new Date()
    const review = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = existing
        ? await tx.careerEligibilityReview.update({
            where: { studentId: student.id },
            data: { status: ELIGIBILITY_STATUS.PENDING_REVIEW, requestedAt: now, decisionReason: null },
          })
        : await tx.careerEligibilityReview.create({
            data: { studentId: student.id, status: ELIGIBILITY_STATUS.PENDING_REVIEW, requestedAt: now },
          })
      await appendCareerAudit(tx, {
        entityType: 'ELIGIBILITY',
        entityId: row.id,
        actorId: student.id,
        actorRole: student.role,
        action: 'REVIEW_REQUESTED',
      })
      return row
    })
    return NextResponse.json({ eligibility: toEligibilityDTO(review) }, { status: 201 })
  } catch (err) {
    console.error('[api/career/eligibility POST]', err)
    return NextResponse.json({ error: 'Could not request the review.' }, { status: 500 })
  }
}
