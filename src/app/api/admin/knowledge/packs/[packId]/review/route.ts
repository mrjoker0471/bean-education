// ─── BEAN Classroom Intelligence (CI-4C): record a curator decision ──────────
// POST /api/admin/knowledge/packs/[packId]/review — ADMIN-only, append-only.
// A REAL human reviewer records APPROVED / REJECTED / CHANGES_REQUESTED /
// RE_REVIEW_REQUESTED with required rationale + evidence. The reviewer
// identity is resolved SERVER-SIDE from the session (requireAdmin) — the body
// can never supply or forge it. The decision binds to the pack's CURRENT
// version + checksum (409 on mismatch — the reviewer must re-inspect changed
// content). Benchmarks, CI workflows and agents have no session: this route is
// structurally unreachable for them, so no machine can promote a pack.
//
// Note a reviewer CANNOT approve a source licence here: source records are
// read-only in this API family and live in code under owner review.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { recordPackReview, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const { packId } = await params
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    // packId from the URL path is authoritative; a mismatched body packId is ignored.
    const input = {
      packId,
      packVersion: typeof body.packVersion === 'string' ? body.packVersion : '',
      packChecksum: typeof body.packChecksum === 'string' ? body.packChecksum : '',
      decision: typeof body.decision === 'string' ? body.decision : '',
      rationale: typeof body.rationale === 'string' ? body.rationale : '',
      evidence: typeof body.evidence === 'string' ? body.evidence : '',
    }

    const result = await recordPackReview(
      curatorDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      input,
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({
      reviewId: result.reviewId,
      curated: result.curatedStatus,
    })
  } catch (err) {
    console.error('[api/admin/knowledge/packs/[packId]/review POST]', err)
    return NextResponse.json({ error: 'Could not record the review — please try again.' }, { status: 500 })
  }
}
