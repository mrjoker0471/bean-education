// ─── BEAN Classroom Intelligence (CI-5B): admin reviewer lifecycle actions ────
// POST /api/admin/ci5/reviewers/[profileId]/action — ADMIN-only, strict
// transition table, server-resolved admin identity. A reviewer can never act
// on their own qualification (self-review refused). Actions:
//   BEGIN_QUALIFICATION_REVIEW | DECIDE (APPROVED/REJECTED + scope +
//   verification result) | ACTIVATE | SUSPEND | REINSTATE | REVOKE | UPDATE_SCOPE.
// Scopes are written ONLY here — no reviewer or client payload can set them.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import {
  beginQualificationReview,
  decideReviewerQualification,
  activateReviewer,
  suspendReviewer,
  reinstateReviewer,
  revokeReviewer,
  updateReviewerScope,
  reviewerDbFromPrisma,
  listReviewerEvents,
  type AdminActor,
} from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const admin: AdminActor = { kind: 'ADMIN', studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' }

    const { profileId } = await params
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const action = typeof body.action === 'string' ? body.action : ''
    const rationale = typeof body.rationale === 'string' ? body.rationale : null

    const rdb = reviewerDbFromPrisma(db)
    let result: { ok: true; profile: { id: string; status: string; reviewerCode: string } } | { ok: false; status: number; error: string }
    switch (action) {
      case 'BEGIN_QUALIFICATION_REVIEW':
        result = await beginQualificationReview(rdb, admin, profileId, rationale)
        break
      case 'DECIDE': {
        const decision = typeof body.decision === 'string' ? body.decision : ''
        if (decision !== 'APPROVED' && decision !== 'REJECTED') {
          return NextResponse.json({ error: 'DECIDE requires decision APPROVED or REJECTED.' }, { status: 400 })
        }
        result = await decideReviewerQualification(rdb, admin, profileId, {
          decision,
          rationale: rationale ?? '',
          verificationStatus: body.verificationStatus,
          verificationNote: body.verificationNote,
          issuingBody: body.issuingBody,
          expiresAt: body.expiresAt,
          scope: body.scope,
        })
        break
      }
      case 'ACTIVATE':
        result = await activateReviewer(rdb, admin, profileId)
        break
      case 'SUSPEND':
        result = await suspendReviewer(rdb, admin, profileId, typeof body.reason === 'string' ? body.reason : '')
        break
      case 'REINSTATE':
        result = await reinstateReviewer(rdb, admin, profileId, typeof body.reason === 'string' ? body.reason : '')
        break
      case 'REVOKE':
        result = await revokeReviewer(rdb, admin, profileId, typeof body.reason === 'string' ? body.reason : '')
        break
      case 'UPDATE_SCOPE':
        result = await updateReviewerScope(rdb, admin, profileId, { scope: body.scope, rationale: rationale ?? '' })
        break
      default:
        return NextResponse.json({ error: `unknown action: ${action || '(none)'}` }, { status: 400 })
    }

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const events = await listReviewerEvents(rdb, profileId)
    return NextResponse.json({
      profile: { id: result.profile.id, reviewerCode: result.profile.reviewerCode, status: result.profile.status },
      eventCount: events.length,
    })
  } catch (err) {
    console.error('[api/admin/ci5/reviewers/[profileId]/action POST]', err)
    return NextResponse.json({ error: 'Could not apply the reviewer action — please try again.' }, { status: 500 })
  }
}
