// ─── BEAN Classroom Intelligence (CI-5G): masked report view for assigned reviewers ──
// POST /api/ci5/reviewer/report-view — returns the privacy-masked evidence view
// of a classroom report ONLY to reviewers holding an assignment for it. No
// student names, emails, private messages, individual histories or unrelated
// profile details leave the server; unobservable dimensions are marked
// honestly. No new route around ownership checks exists — the assignment is
// the ownership proof for this restricted view.

import { NextRequest, NextResponse } from 'next/server'
import { requireStudent } from '@/lib/auth'
import { buildMaskedReportView, reportAuditDbFromPrisma } from '@/lib/ci/fleet/report-audit'
import { resolveReviewerProfile, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { listAssignments, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(db), student.id)
    if (!profile) return NextResponse.json({ error: 'no reviewer profile for this account' }, { status: 403 })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const reportId = typeof body.reportId === 'string' ? body.reportId : ''
    if (!reportId) return NextResponse.json({ error: 'reportId required' }, { status: 400 })
    // Restricted-view ownership proof: the reviewer must hold an assignment
    // for this exact report (open or completed — completed auditors may
    // re-inspect their own evidence).
    const mine = await listAssignments(assignmentDbFromPrisma(db), { reviewerProfileId: profile.id, subjectType: 'CLASSROOM_REPORT', subjectKey: reportId })
    if (mine.length === 0) {
      return NextResponse.json({ error: 'no assignment for this report — the masked view is restricted to assigned reviewers' }, { status: 403 })
    }
    const result = await buildMaskedReportView(reportAuditDbFromPrisma(db), reportId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ maskedView: result.view })
  } catch (err) {
    console.error('[api/ci5/reviewer/report-view POST]', err)
    return NextResponse.json({ error: 'Could not load the masked view — please try again.' }, { status: 500 })
  }
}
