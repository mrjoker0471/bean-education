// ─── BEAN Trust & Quality (Phase 6): teacher responses to reviews ────────────
// POST  /api/teach/reviews/:reviewId/response — the reviewed class's OWNER
//       teacher answers a review once (unique reviewId). Students can never
//       create teacher responses; a foreign teacher can never respond to a
//       review outside their own classes. Teachers cannot edit the student's
//       review through this or any route.
// PATCH /api/teach/reviews/:reviewId/response — edit own response within the
//       7-day window. Every create/edit is audited. Response text is bounded,
//       plain-text, and the policy forbids threats/harassment/retaliation
//       (enforced by moderation, not by client claims).

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import {
  isWithinEditWindow,
  RESPONSE_EDIT_WINDOW_DAYS,
  requireOwnTeacherProfile,
} from '@/lib/trust'
import { reviewResponseCreateSchema, reviewResponseEditSchema } from '@/lib/trust-schema'
import { toResponseDTO } from '@/lib/trust-dto'
import { appendAudit } from '@/lib/teach'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profileGuard = await requireOwnTeacherProfile(student)
    if (!profileGuard.ok) {
      return NextResponse.json({ error: profileGuard.error }, { status: profileGuard.status })
    }

    const body = await req.json().catch(() => null)
    const parsed = reviewResponseCreateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid response' }, { status: 400 })
    }

    const { reviewId } = await params

    try {
      const outcome = await db.$transaction(async (tx) => {
        const review = await tx.classReview.findUnique({ where: { id: reviewId } })
        if (!review) return { kind: 'notFound' as const }
        // Only the reviewed class's owner teacher may respond.
        if (review.teacherProfileId !== profileGuard.profileId) {
          return { kind: 'forbidden' as const }
        }
        const existing = await tx.teacherReviewResponse.findUnique({ where: { reviewId } })
        if (existing) return { kind: 'duplicate' as const }

        const response = await tx.teacherReviewResponse.create({
          data: {
            reviewId,
            teacherProfileId: profileGuard.profileId,
            responseText: parsed.data.responseText,
          },
        })
        await appendAudit(tx, {
          entityType: 'CLASS_REVIEW',
          entityId: reviewId,
          actorId: student.id,
          actorRole: student.role,
          action: 'TEACHER_RESPONSE_CREATED',
          detail: `response=${response.id}`,
        })
        return { kind: 'ok' as const, response }
      })

      if (outcome.kind !== 'ok') {
        const status = outcome.kind === 'notFound' ? 404 : outcome.kind === 'forbidden' ? 403 : 409
        const message =
          outcome.kind === 'notFound'
            ? 'Review not found'
            : outcome.kind === 'forbidden'
              ? 'Only the teacher who taught this class can respond.'
              : 'You have already responded to this review.'
        return NextResponse.json({ error: message }, { status })
      }

      return NextResponse.json({ response: toResponseDTO(outcome.response) }, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'You have already responded to this review.' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('[api/teach/reviews/:reviewId/response POST]', err)
    return NextResponse.json({ error: 'Could not post your response — please try again.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ reviewId: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profileGuard = await requireOwnTeacherProfile(student)
    if (!profileGuard.ok) {
      return NextResponse.json({ error: profileGuard.error }, { status: profileGuard.status })
    }

    const body = await req.json().catch(() => null)
    const parsed = reviewResponseEditSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid edit' }, { status: 400 })
    }

    const { reviewId } = await params
    const now = new Date()

    const outcome = await db.$transaction(async (tx) => {
      const response = await tx.teacherReviewResponse.findUnique({ where: { reviewId } })
      if (!response) return { kind: 'notFound' as const }
      if (response.teacherProfileId !== profileGuard.profileId) {
        return { kind: 'forbidden' as const }
      }
      if (!isWithinEditWindow(response.createdAt, now, RESPONSE_EDIT_WINDOW_DAYS)) {
        return { kind: 'windowClosed' as const }
      }
      const updated = await tx.teacherReviewResponse.update({
        where: { id: response.id },
        data: { responseText: parsed.data.responseText, editedAt: now },
      })
      await appendAudit(tx, {
        entityType: 'CLASS_REVIEW',
        entityId: reviewId,
        actorId: student.id,
        actorRole: student.role,
        action: 'TEACHER_RESPONSE_EDITED',
        detail: `response=${response.id} within 7-day window`,
      })
      return { kind: 'ok' as const, response: updated }
    })

    if (outcome.kind !== 'ok') {
      const status = outcome.kind === 'notFound' ? 404 : outcome.kind === 'forbidden' ? 403 : 409
      const message =
        outcome.kind === 'notFound'
          ? 'Response not found'
          : outcome.kind === 'forbidden'
            ? 'You can only edit your own response.'
            : `Responses can be edited for ${RESPONSE_EDIT_WINDOW_DAYS} days after posting.`
      return NextResponse.json({ error: message }, { status })
    }

    return NextResponse.json({ response: toResponseDTO(outcome.response) })
  } catch (err) {
    console.error('[api/teach/reviews/:reviewId/response PATCH]', err)
    return NextResponse.json({ error: 'Could not update your response — please try again.' }, { status: 500 })
  }
}
