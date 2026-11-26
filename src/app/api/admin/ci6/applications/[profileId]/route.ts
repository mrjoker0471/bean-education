// ─── BEAN Classroom Intelligence (CI-6C): verification workbench detail ───────
// GET /api/admin/ci6/applications/[profileId] — everything an authorised
// administrator needs to independently verify one applicant: identity/account
// association, application detail, evidence METADATA (content served only via
// the restricted /api/admin/ci6/evidence/[evidenceId] route), the information
// request loop and the append-only verification records + lifecycle events.
// Admin-only (requireAdmin). Evidence file bytes are NEVER in this response.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { verificationDbFromPrisma, listVerificationRecords, resolveVerificationState } from '@/lib/ci/fleet/verification'
import { applicationsDbFromPrisma, listApplicationEvidence, listApplicationInfoRequests } from '@/lib/ci/fleet/applications'
import { listReviewerEvents, reviewerDbFromPrisma, parseReviewerScope } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { profileId } = await params
    const profile = await db.expertReviewerProfile.findUnique({ where: { id: profileId } })
    if (!profile) return NextResponse.json({ error: 'expert application not found' }, { status: 404 })
    const account = await db.student.findUnique({
      where: { id: profile.studentId },
      select: { id: true, email: true, displayName: true, createdAt: true, role: true },
    })
    const adb = applicationsDbFromPrisma(db)
    const vdb = verificationDbFromPrisma(db)
    const [evidence, infoRequests, records, events] = await Promise.all([
      listApplicationEvidence(adb, profile.id),
      listApplicationInfoRequests(adb, profile.id),
      listVerificationRecords(vdb, profile.id),
      listReviewerEvents(reviewerDbFromPrisma(db), profile.id),
    ])
    const state = resolveVerificationState(records)
    return NextResponse.json({
      profile: {
        id: profile.id,
        reviewerCode: profile.reviewerCode,
        category: profile.category,
        status: profile.status,
        qualificationCategory: profile.qualificationCategory,
        professionalExperience: profile.professionalExperience,
        issuingBody: profile.issuingBody,
        institutionAffiliation: profile.institutionAffiliation,
        specialties: JSON.parse(profile.specialtiesJson || '[]') as string[],
        conflictOfInterest: profile.conflictOfInterest,
        verificationStatus: profile.verificationStatus,
        applicationConsentAt: profile.applicationConsentAt,
        scope: parseReviewerScope(profile),
        expiresAt: profile.expiresAt,
        createdAt: profile.createdAt,
      },
      account,
      evidence: evidence.map((e) => ({
        id: e.id,
        kind: e.kind,
        fileName: e.fileName,
        byteSize: e.byteSize,
        sha256: e.sha256,
        mimeType: e.mimeType,
        retentionState: e.retentionState,
        createdAt: e.createdAt,
      })),
      infoRequests: infoRequests.map((r) => ({
        id: r.id,
        requestText: r.requestText,
        status: r.status,
        responseText: r.responseText,
        requestedByAdminId: r.requestedByAdminId,
        requestedAt: r.requestedAt,
        answeredAt: r.answeredAt,
      })),
      verificationRecords: records.map((r) => ({
        id: r.id,
        credentialType: r.credentialType,
        issuingInstitution: r.issuingInstitution,
        qualificationScope: r.qualificationScope,
        evidenceIds: JSON.parse(r.evidenceIds || '[]') as string[],
        verificationMethod: r.verificationMethod,
        referenceDetail: r.referenceDetail,
        decision: r.decision,
        reason: r.reason,
        expiresAt: r.expiresAt,
        verifiedByAdminId: r.verifiedByAdminId,
        verifiedAt: r.verifiedAt,
      })),
      verificationState: state,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorKind: e.actorKind,
        actorId: e.actorId,
        rationale: e.rationale,
        createdAt: e.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/admin/ci6/applications/[profileId] GET]', err)
    return NextResponse.json({ error: 'Could not load the application — please try again.' }, { status: 500 })
  }
}
