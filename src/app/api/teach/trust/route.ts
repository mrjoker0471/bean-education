// ─── BEAN Trust & Quality (Phase 6): teacher trust dashboard ─────────────────
// GET /api/teach/trust — the approved teacher's own trust summary:
//   • verified quality metrics (server-computed, never client-supplied)
//   • recent public reviews with their responses
//   • an ANONYMOUS open-complaint count (never complaint content or reporter
//     identity — Phase 6 rule)
//   • active/past trust restrictions with reasons
//   • the status of any appeal they filed
// Private student information is never included.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent } from '@/lib/auth'
import {
  computeTeacherQuality,
  trustStateFor,
  OPEN_COMPLAINT_STATUSES,
  OPEN_APPEAL_STATUSES,
  APPEAL_STATUS,
  REVIEW_STATUS,
} from '@/lib/trust'
import {
  toPublicQuality,
  toPublicReview,
  toResponseDTO,
  toTrustActionDTO,
  responseEditable,
  type TeacherTrustSummaryDTO,
} from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await db.teacherProfile.findUnique({ where: { studentId: student.id } })
    if (!profile || profile.verificationStatus !== 'APPROVED') {
      return NextResponse.json({ error: 'You need an approved BEAN Teacher profile.' }, { status: 403 })
    }

    const now = new Date()

    // Authoritative aggregates — computed here, never accepted from the browser.
    const [reviews, responses, completed, cancelled, published, openComplaints, actions, appeal] =
      await Promise.all([
        db.classReview.findMany({
          where: { teacherProfileId: profile.id },
          select: { rating: true, status: true, isVerified: true },
        }),
        db.teacherReviewResponse.findMany({
          where: { teacherProfileId: profile.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        db.classSession.count({ where: { teacherProfileId: profile.id, status: 'COMPLETED' } }),
        db.classSession.count({ where: { teacherProfileId: profile.id, status: 'CANCELLED' } }),
        db.classSession.count({ where: { teacherProfileId: profile.id, status: 'PUBLISHED' } }),
        // Anonymous count only — no complaint rows are read into teacher space.
        db.teachComplaint.count({
          where: {
            teacherProfileId: profile.id,
            status: { in: [...OPEN_COMPLAINT_STATUSES] },
          },
        }),
        db.trustAction.findMany({
          where: { teacherProfileId: profile.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        db.teachAppeal.findFirst({
          where: { appellantId: student.id, status: { in: [...OPEN_APPEAL_STATUSES] } },
          orderBy: { createdAt: 'desc' },
        }),
      ])

    const quality = computeTeacherQuality(reviews, {
      completedClasses: completed,
      cancelledClasses: cancelled,
      publishedClasses: published,
    })

    // Recent reviews for the teacher's own reading (public-visible ones plus
    // moderation status of their flagged queue) — same privacy mapper as the
    // public list, so no private student fields leak here either.
    const recentRows = await db.classReview.findMany({
      where: { teacherProfileId: profile.id, status: { in: [REVIEW_STATUS.PUBLISHED, REVIEW_STATUS.FLAGGED] } },
      include: { response: true, student: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    const latestAppeal = appeal
      ? appeal
      : await db.teachAppeal.findFirst({
          where: { appellantId: student.id },
          orderBy: { createdAt: 'desc' },
        })

    const state = await trustStateFor(profile.id, now)

    const summary: TeacherTrustSummaryDTO = {
      quality: toPublicQuality(quality),
      recentReviews: recentRows.map((r) => toPublicReview(r, student.id, now)),
      responses: responses.map(toResponseDTO),
      openComplaintCount: openComplaints,
      restrictions: actions.map((a) => toTrustActionDTO(a, now)),
      appealStatus:
        latestAppeal?.status === APPEAL_STATUS.UPHELD
          ? 'UPHELD'
          : latestAppeal?.status === APPEAL_STATUS.OVERTURNED
            ? 'OVERTURNED'
            : latestAppeal?.status === APPEAL_STATUS.CLOSED
              ? 'CLOSED'
              : latestAppeal?.status === APPEAL_STATUS.UNDER_REVIEW
                ? 'UNDER_REVIEW'
                : latestAppeal
                  ? 'SUBMITTED'
                  : 'NONE',
    }
    void responseEditable // kept for future per-response edit gating in UI
    return NextResponse.json(summary)
  } catch (err) {
    console.error('[api/teach/trust GET]', err)
    return NextResponse.json({ error: 'Could not load your trust dashboard — please try again.' }, { status: 500 })
  }
}
