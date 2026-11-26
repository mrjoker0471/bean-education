// ─── BEAN Classroom Intelligence (CI-6C): credential verification queue ────────
// GET /api/admin/ci6/applications?status= — the administrator workbench queue:
// applications in their OPEN states (APPLICATION_PENDING / QUALIFICATION_REVIEW)
// by default, with the applicant's ACCOUNT ASSOCIATION (email — authorised
// personnel only), application detail, evidence metadata and verification
// state. No evidence content, no file paths, no other reviewers' records.

import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { verificationDbFromPrisma, listVerificationRecords, resolveVerificationState } from '@/lib/ci/fleet/verification'
import { applicationsDbFromPrisma } from '@/lib/ci/fleet/applications'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const QUEUE_STATUSES = ['APPLICATION_PENDING', 'QUALIFICATION_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'EXPIRED']

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const statusFilter = new URL(req.url).searchParams.get('status')
    const statuses = statusFilter && QUEUE_STATUSES.includes(statusFilter) ? [statusFilter] : ['APPLICATION_PENDING', 'QUALIFICATION_REVIEW']
    const profiles = await db.expertReviewerProfile.findMany({
      where: { status: { in: statuses } },
      orderBy: { createdAt: 'asc' },
    })
    const accounts = await db.student.findMany({
      where: { id: { in: profiles.map((p) => p.studentId) } },
      select: { id: true, email: true, displayName: true, createdAt: true },
    })
    const accountById = new Map(accounts.map((a) => [a.id, a]))
    const vdb = verificationDbFromPrisma(db)
    const adb = applicationsDbFromPrisma(db)
    const queue = await Promise.all(
      profiles.map(async (p) => {
        const [evidence, records] = await Promise.all([
          adb.expertCredentialEvidence.findMany({ where: { profileId: p.id } }),
          listVerificationRecords(vdb, p.id),
        ])
        const state = resolveVerificationState(records)
        const account = accountById.get(p.studentId)
        return {
          profileId: p.id,
          reviewerCode: p.reviewerCode,
          category: p.category,
          status: p.status,
          account: account ? { email: account.email, displayName: account.displayName, createdAt: account.createdAt } : null,
          qualificationCategory: p.qualificationCategory,
          professionalExperience: p.professionalExperience,
          institutionAffiliation: p.institutionAffiliation,
          issuingBody: p.issuingBody,
          specialties: JSON.parse(p.specialtiesJson || '[]') as string[],
          conflictOfInterest: p.conflictOfInterest,
          applicationConsentAt: p.applicationConsentAt,
          evidenceCount: evidence.filter((e) => e.retentionState === 'ACTIVE').length,
          verification: {
            verified: state.verified,
            latestDecision: state.latestDecision,
            recordCount: records.length,
          },
          createdAt: p.createdAt,
        }
      }),
    )
    return NextResponse.json({ queue })
  } catch (err) {
    console.error('[api/admin/ci6/applications GET]', err)
    return NextResponse.json({ error: 'Could not load the verification queue — please try again.' }, { status: 500 })
  }
}
