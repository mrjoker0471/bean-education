// ─── BEAN Classroom Intelligence (CI-7G): restricted pilot activation ─────────
// POST /api/admin/ci7/pilot/activate — record an ACTIVATED/REACTIVATED event
// on the append-only pilot activation ledger. THE GATE: the pack's existing
// CI-4/CI-5 approval authority must have recorded the required genuine
// approvals (curated status VERIFIED at the exact checksum) — this route can
// never bypass an approval threshold, never activate another pack, never
// enable global use (the activation names its exact bounded scope).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { resolveCuratedStatus, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { computePackChecksum } from '@/lib/ci/fleet/domain-packs'
import {
  ci7ActivationDbFromPrisma,
  pilotPackSnapshot,
  recordPilotActivationEvent,
} from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const snap = pilotPackSnapshot()
    const checksum = computePackChecksum(snap.pack)
    const reviews = await curatorDbFromPrisma(db).classroomPackReview.findMany({ where: { packId: snap.domainId } })
    const curated = resolveCuratedStatus(snap.pack, reviews)
    const result = await recordPilotActivationEvent(
      ci7ActivationDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      // the protocol version is the SERVER-side protocol in force — never a client value
      { ...body, eventType: body.eventType === 'REACTIVATED' ? 'REACTIVATED' : 'ACTIVATED', packId: snap.domainId, packVersion: snap.pack.packVersion, packChecksum: checksum, protocolVersion: snap.protocolVersion },
      snap.pack,
      checksum,
      curated,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ eventId: result.eventId, curated: curated.status }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci7/pilot/activate POST]', err)
    return NextResponse.json({ error: 'Could not record the pilot activation — please try again.' }, { status: 500 })
  }
}
