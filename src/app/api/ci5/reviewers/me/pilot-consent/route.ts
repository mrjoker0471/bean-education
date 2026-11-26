// ─── BEAN Classroom Intelligence (CI-7C): pilot participation consent ─────────
// GET  /api/ci5/reviewers/me/pilot-consent — the reviewer's current pilot
//      participation state plus the exact participant information points they
//      must acknowledge (protocol §15), derived server-side from the
//      append-only event ledger.
// POST — record explicit consent (ACTIVE/APPROVED profiles only; every
//      information point acknowledged; protocol version must match the
//      current one; compensation status records the owner-approved terms).
//      Consent NEVER grants a privilege: eligibility still flows through the
//      CI-5B lifecycle and CI-5C assignment gates; the pilot assignment gate
//      (admin route) additionally requires this consent for pilot subjects.
// DELETE — withdraw pilot participation (append-only; latest event governs;
//      recorded decisions are retained per the retention rules).

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import {
  CI7_PILOT_CONSENT_POINTS,
  CI7_PILOT_PROTOCOL_VERSION,
  pilotPackSnapshot,
  recordPilotParticipationConsent,
  resolvePilotParticipation,
  withdrawPilotParticipation,
} from '@/lib/ci/fleet/pilot'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 404 })
    const events = await db.expertReviewerEvent.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'asc' },
    })
    const participation = resolvePilotParticipation(events)
    let snap: ReturnType<typeof pilotPackSnapshot> | null = null
    try {
      snap = pilotPackSnapshot()
    } catch {
      snap = null // protocol drift is reported by admin surfaces; the consent view stays readable
    }
    return NextResponse.json({
      participation,
      protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
      consentPoints: CI7_PILOT_CONSENT_POINTS,
      pilot: snap
        ? { domainId: snap.domainId, packVersion: snap.pack.packVersion, approvalsRequired: snap.approvalsRequired, declaredStatus: snap.declaredStatus }
        : null,
    })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/pilot-consent GET]', err)
    return NextResponse.json({ error: 'Could not load pilot participation — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 404 })
    const result = await recordPilotParticipationConsent(
      reviewerDbFromPrisma(db),
      profile,
      { kind: 'REVIEWER', studentId: student.id, displayName: student.displayName ?? 'BEAN member' },
      { protocolVersion: body.protocolVersion, acknowledged: body.acknowledged, compensationStatus: body.compensationStatus },
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const events = await db.expertReviewerEvent.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ participation: resolvePilotParticipation(events) }, { status: 201 })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/pilot-consent POST]', err)
    return NextResponse.json({ error: 'Could not record pilot consent — please try again.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 404 })
    const reason = typeof body.reason === 'string' ? body.reason : ''
    const result = await withdrawPilotParticipation(
      reviewerDbFromPrisma(db),
      profile,
      { kind: 'REVIEWER', studentId: student.id, displayName: student.displayName ?? 'BEAN member' },
      reason,
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    const events = await db.expertReviewerEvent.findMany({
      where: { profileId: profile.id },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ participation: resolvePilotParticipation(events) })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/pilot-consent DELETE]', err)
    return NextResponse.json({ error: 'Could not withdraw pilot participation — please try again.' }, { status: 500 })
  }
}
