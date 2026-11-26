// ─── BEAN Classroom Intelligence (CI-7G): pilot activation status ─────────────
// GET /api/admin/ci7/pilot/status — the current activation state derived from
// the append-only event ledger: DEFAULT DISABLED; ACTIVE (restricted, exact
// version + checksum binding); DEACTIVATED (kill switch); ROLLED_BACK; STALE
// (pack content changed — activation no longer applies, re-review required).
// Includes the full event history and the pack's current curated status so
// reporting never has to guess.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { resolveCuratedStatus, curatorDbFromPrisma } from '@/lib/ci/fleet/curator'
import { computePackChecksum } from '@/lib/ci/fleet/domain-packs'
import {
  ci7ActivationDbFromPrisma,
  pilotPackSnapshot,
  resolvePilotActivationState,
} from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const snap = pilotPackSnapshot()
    const checksum = computePackChecksum(snap.pack)
    const events = await db.ci7PilotActivation.findMany({ where: { packId: snap.domainId }, orderBy: { createdAt: 'asc' } })
    const reviews = await curatorDbFromPrisma(db).classroomPackReview.findMany({ where: { packId: snap.domainId } })
    const curated = resolveCuratedStatus(snap.pack, reviews)
    const state = resolvePilotActivationState(events, checksum)
    return NextResponse.json({
      state,
      curated: {
        status: curated.status,
        explanation: curated.explanation,
        approvalsRecorded: curated.approvalsRecorded,
        approvalsRequired: curated.approvalsRequired,
      },
      pilot: { domainId: snap.domainId, packVersion: snap.pack.packVersion, checksum, protocolVersion: snap.protocolVersion },
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        packVersion: e.packVersion,
        packChecksum: e.packChecksum,
        pilotScope: e.pilotScope,
        protocolVersion: e.protocolVersion,
        reason: e.reason,
        actorAdminName: e.actorAdminName,
        createdAt: e.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/admin/ci7/pilot/status GET]', err)
    return NextResponse.json({ error: 'Could not load the pilot activation status — please try again.' }, { status: 500 })
  }
}
