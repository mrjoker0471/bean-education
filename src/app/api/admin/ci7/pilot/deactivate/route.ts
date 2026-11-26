// ─── BEAN Classroom Intelligence (CI-7G): pilot kill switch / rollback ────────
// POST /api/admin/ci7/pilot/deactivate — DEACTIVATED (kill switch) or
// ROLLED_BACK event on the append-only activation ledger. Turning the pilot
// OFF is always available to authorised admins and never gated on anything —
// the safe state is one call away. The audit trail is preserved.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
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
    const result = await recordPilotActivationEvent(
      ci7ActivationDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      // the protocol version is the SERVER-side protocol in force — never a client value
      { ...body, eventType: body.eventType === 'ROLLED_BACK' ? 'ROLLED_BACK' : 'DEACTIVATED', packId: snap.domainId, packVersion: snap.pack.packVersion, packChecksum: checksum, protocolVersion: snap.protocolVersion },
      snap.pack,
      checksum,
      // kill switch / rollback are never gated on approval state
      null,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ eventId: result.eventId }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci7/pilot/deactivate POST]', err)
    return NextResponse.json({ error: 'Could not deactivate the pilot — please try again.' }, { status: 500 })
  }
}
