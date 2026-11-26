// ─── BEAN Classroom Intelligence (CI-5B): admin reviewer registry ─────────────
// GET /api/admin/ci5/reviewers — ADMIN-only registry view: reviewer
// applications, qualification state, approved scopes and lifecycle position.
// Reviewer personal data is minimal by design (reviewerCode + qualification
// facts + scope) — no identity documents, no government identity numbers.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { listReviewerProfiles, reviewerDbFromPrisma, parseReviewerScope } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)
    const status = url.searchParams.get('status') ?? undefined
    const category = url.searchParams.get('category') ?? undefined

    const profiles = await listReviewerProfiles(reviewerDbFromPrisma(db), { status, category })
    return NextResponse.json({
      reviewers: profiles.map((p) => ({
        id: p.id,
        reviewerCode: p.reviewerCode,
        category: p.category,
        status: p.status,
        scope: parseReviewerScope(p),
        qualificationCategory: p.qualificationCategory,
        professionalExperience: p.professionalExperience,
        verificationStatus: p.verificationStatus,
        issuingBody: p.issuingBody,
        expiresAt: p.expiresAt,
        conflictOfInterest: p.conflictOfInterest,
        suspendedReason: p.suspendedReason,
        revokedReason: p.revokedReason,
        availability: p.availability,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    })
  } catch (err) {
    console.error('[api/admin/ci5/reviewers GET]', err)
    return NextResponse.json({ error: 'Could not load the reviewer registry — please try again.' }, { status: 500 })
  }
}
