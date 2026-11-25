// ─── BEAN Classroom Intelligence (CI-5B): my reviewer profile ─────────────────
// GET /api/ci5/reviewers/me — the signed-in account's own reviewer profile,
// scope (as recorded server-side) and lifecycle events. Only the OWNER sees
// their profile — no other reviewer's data is exposed through this route.

import { NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { resolveReviewerProfile, listReviewerEvents, reviewerDbFromPrisma, parseReviewerScope } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ profile: null })
    const events = await listReviewerEvents(reviewerDbFromPrisma(db), profile.id)
    return NextResponse.json({
      profile: {
        id: profile.id,
        reviewerCode: profile.reviewerCode,
        category: profile.category,
        status: profile.status,
        scope: parseReviewerScope(profile),
        qualificationCategory: profile.qualificationCategory,
        professionalExperience: profile.professionalExperience,
        verificationStatus: profile.verificationStatus,
        issuingBody: profile.issuingBody,
        scopeNote: profile.scopeNote,
        expiresAt: profile.expiresAt,
        suspendedReason: profile.suspendedReason,
        revokedReason: profile.revokedReason,
        createdAt: profile.createdAt,
      },
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorKind: e.actorKind,
        rationale: e.rationale,
        createdAt: e.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me GET]', err)
    return NextResponse.json({ error: 'Could not load the reviewer profile — please try again.' }, { status: 500 })
  }
}
