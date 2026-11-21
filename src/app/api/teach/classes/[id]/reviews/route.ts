// ─── BEAN Trust & Quality (Phase 6): verified class reviews ──────────────────
// GET  /api/teach/classes/:id/reviews — public review list for a class.
//      Public visibility: PUBLISHED and FLAGGED (flagging is never auto-hiding)
//      plus the viewer's OWN review in any state. Author-only fields (their
//      moderation status/reason) are unlocked for the author alone. Every row
//      is privacy-mapped by toPublicReview — no emails, no account ids, no
//      complaint data, reviewer shown as "Verified student" (+ consented
//      displayName only when the author opted in).
// POST /api/teach/classes/:id/reviews — create a review tied to the caller's
//      OWN booking. Server-validated: booking ATTENDED, class ended, one
//      review per booking (DB unique bookingId + in-transaction check).
//      Nothing about the client is trusted — identity comes from the session
//      cookie, and the teacher attribution comes from the class row.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  evaluateReviewEligibility,
  rateLimited,
  countRecent,
  RATE_LIMITS,
  REVIEW_STATUS,
} from '@/lib/trust'
import { reviewCreateSchema } from '@/lib/trust-schema'
import { toPublicReview } from '@/lib/trust-dto'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const viewer = await requireStudent()
    const now = new Date()

    const classSession = await db.classSession.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!classSession || classSession.status === 'DRAFT') {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    // Public list: PUBLISHED + FLAGGED (flagged stays visible while under
    // moderation). The author additionally sees their own HIDDEN review.
    const reviews = await db.classReview.findMany({
      where: {
        classSessionId: id,
        ...(viewer
          ? { OR: [{ status: { in: [REVIEW_STATUS.PUBLISHED, REVIEW_STATUS.FLAGGED] } }, { studentId: viewer.id }] }
          : { status: { in: [REVIEW_STATUS.PUBLISHED, REVIEW_STATUS.FLAGGED] } }),
      },
      include: {
        response: true,
        student: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    // Composer eligibility for the signed-in viewer (guests get sign-in hint).
    let myEligibility: { canReview: boolean; bookingId?: string; reason?: string } = {
      canReview: false,
      reason: viewer ? undefined : 'Sign in to review this class.',
    }
    if (viewer) {
      const booking = await db.classBooking.findUnique({
        where: { classSessionId_studentId: { classSessionId: id, studentId: viewer.id } },
      })
      const classFull = await db.classSession.findUnique({
        where: { id },
        select: { id: true, teacherProfileId: true, startsAt: true, durationMinutes: true, status: true },
      })
      const existing = booking
        ? await db.classReview.findUnique({ where: { bookingId: booking.id }, select: { id: true } })
        : null
      const verdict = evaluateReviewEligibility({
        studentId: viewer.id,
        booking,
        classSession: classFull,
        existingReview: existing,
        now,
      })
      myEligibility = verdict.ok
        ? { canReview: true, bookingId: booking!.id }
        : { canReview: false, reason: verdict.error }
    }

    return NextResponse.json({
      reviews: reviews.map((r) => toPublicReview(r, viewer?.id, now)),
      myEligibility,
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/reviews GET]', err)
    return NextResponse.json({ error: 'Could not load reviews — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) {
      return NextResponse.json({ error: 'Sign in to review this class.' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const parsed = reviewCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid review' },
        { status: 400 },
      )
    }

    // Anti-spam: rolling 24 h cap on reviews written by this account.
    const recent = await countRecent('classReview', student.id, new Date())
    if (rateLimited('REVIEWS_PER_DAY', recent)) {
      return NextResponse.json(
        { error: 'You have reached the review limit for today — please try again later.' },
        { status: 429 },
      )
    }

    const { id } = await params
    const now = new Date()

    try {
      const outcome = await db.$transaction(async (tx: Tx) => {
        const classSession = await tx.classSession.findUnique({
          where: { id },
          select: { id: true, teacherProfileId: true, startsAt: true, durationMinutes: true, status: true },
        })
        const booking = await tx.classBooking.findUnique({
          where: { classSessionId_studentId: { classSessionId: id, studentId: student.id } },
        })
        const existingReview = booking
          ? await tx.classReview.findUnique({ where: { bookingId: booking.id }, select: { id: true } })
          : null

        const verdict = evaluateReviewEligibility({
          studentId: student.id,
          booking,
          classSession,
          existingReview,
          now,
        })
        if (!verdict.ok) return verdict

        const review = await tx.classReview.create({
          data: {
            bookingId: booking!.id,
            classSessionId: id,
            teacherProfileId: classSession!.teacherProfileId,
            studentId: student.id,
            rating: parsed.data.rating,
            title: parsed.data.title ?? null,
            reviewText: parsed.data.reviewText,
            showDisplayName: parsed.data.showDisplayName ?? false,
            status: REVIEW_STATUS.PUBLISHED,
            isVerified: true,
            publishedAt: now,
          },
        })
        await appendAudit(tx, {
          entityType: 'CLASS_REVIEW',
          entityId: review.id,
          actorId: student.id,
          actorRole: student.role,
          action: 'REVIEW_CREATED',
          detail: `rating=${review.rating}`,
        })
        return { ok: true as const, review }
      })

      if (!outcome.ok) {
        return NextResponse.json({ error: outcome.error }, { status: outcome.status })
      }

      const full = await db.classReview.findUnique({
        where: { id: outcome.review.id },
        include: { response: true, student: { select: { displayName: true } } },
      })
      return NextResponse.json(
        { review: toPublicReview(full!, student.id, now) },
        { status: 201 },
      )
    } catch (err) {
      // Concurrent duplicate create: the bookingId unique index is the last line
      // of defence — exactly one of two racing reviews can exist.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'You have already reviewed this class.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('[api/teach/classes/:id/reviews POST]', err)
    return NextResponse.json({ error: 'Could not submit your review — please try again.' }, { status: 500 })
  }
}
