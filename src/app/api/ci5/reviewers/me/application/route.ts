// ─── BEAN Classroom Intelligence (CI-6B): my expert application detail ────────
// GET  /api/ci5/reviewers/me/application — the signed-in applicant's own
//   application: detail fields, credential-evidence METADATA (never content,
//   never paths) and the administrator information-request loop.
// PUT  /api/ci5/reviewers/me/application — update the open application's own
//   detail fields. No status/verification/scope field is writable here; those
//   remain CI-5B admin authorities. Editing freezes once a decision exists.

import { NextResponse, type NextRequest } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { applicationsDbFromPrisma, getApplicationDetail, updateExpertApplication } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type ApplicationDetail = NonNullable<ReturnType<typeof getApplicationDetail>> extends Promise<infer T> ? (T extends null ? never : T) : never

function serializeDetail(detail: ApplicationDetail) {
  return {
    profile: {
      id: detail.profile.id,
      reviewerCode: detail.profile.reviewerCode,
      category: detail.profile.category,
      status: detail.profile.status,
      qualificationCategory: detail.profile.qualificationCategory,
      professionalExperience: detail.profile.professionalExperience,
      issuingBody: detail.profile.issuingBody,
      institutionAffiliation: detail.profile.institutionAffiliation,
      specialties: detail.specialties,
      conflictOfInterest: detail.profile.conflictOfInterest,
      verificationStatus: detail.profile.verificationStatus,
      applicationConsentAt: detail.profile.applicationConsentAt,
      createdAt: detail.profile.createdAt,
    },
    evidence: detail.evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      fileName: e.fileName,
      byteSize: e.byteSize,
      sha256: e.sha256,
      mimeType: e.mimeType,
      retentionState: e.retentionState,
      createdAt: e.createdAt,
    })),
    infoRequests: detail.infoRequests.map((r) => ({
      id: r.id,
      requestText: r.requestText,
      status: r.status,
      responseText: r.responseText,
      requestedAt: r.requestedAt,
      answeredAt: r.answeredAt,
    })),
  }
}

export async function GET() {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const detail = await getApplicationDetail(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' })
    if (!detail) return NextResponse.json({ profile: null })
    return NextResponse.json(serializeDetail(detail))
  } catch (err) {
    console.error('[api/ci5/reviewers/me/application GET]', err)
    return NextResponse.json({ error: 'Could not load the application — please try again.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await updateExpertApplication(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    if (!result.profile) return NextResponse.json({ error: 'unexpected missing profile' }, { status: 500 })
    const detail = await getApplicationDetail(applicationsDbFromPrisma(db), { studentId: student.id, displayName: student.displayName ?? 'BEAN member' })
    return NextResponse.json(detail ? serializeDetail(detail) : { profile: result.profile })
  } catch (err) {
    console.error('[api/ci5/reviewers/me/application PUT]', err)
    return NextResponse.json({ error: 'Could not update the application — please try again.' }, { status: 500 })
  }
}
