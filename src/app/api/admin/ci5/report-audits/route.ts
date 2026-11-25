// ─── BEAN Classroom Intelligence (CI-5G): admin report-audit registry + pilot fixture ──
// GET  /api/admin/ci5/report-audits — the audit register (verdicts, findings
//      counts, unobservable markers) for the governance workspace.
// POST /api/admin/ci5/report-audits — record an audit through the service
//      (admin path, same checksum + findings rules).
// PUT  /api/admin/ci5/report-audits — create a clearly-labelled SYNTHETIC
//      pilot fixture report (CI-5F charter: pilot uses synthetic classroom
//      fixtures; no hidden recording, no transcription, no real student data).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { recordClassroomReportAuditReview, reportAuditDbFromPrisma } from '@/lib/ci/fleet/report-audit'
import { resolveReviewerProfileById, reviewerDbFromPrisma } from '@/lib/ci/fleet/reviewers'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const reviews = await db.classroomReportAuditReview.findMany({ orderBy: { createdAt: 'asc' as const } })
    return NextResponse.json({
      audits: reviews.map((r) => ({
        id: r.id,
        reportId: r.reportId,
        reportVersion: r.reportVersion,
        reportChecksum: r.reportChecksum,
        reviewerCode: r.reviewerCode,
        verdict: r.verdict,
        supportedCount: (JSON.parse(r.supportedFindings) as string[]).length,
        unsupportedCount: (JSON.parse(r.unsupportedFindings) as string[]).length,
        ambiguousCount: (JSON.parse(r.ambiguousFindings) as string[]).length,
        unobservableMarkers: JSON.parse(r.unobservableMarkers) as string[],
        evidenceAuditorFindingsPreserved: r.evidenceAuditorFindingsPreserved,
        rationale: r.rationale,
        createdAt: r.createdAt,
      })),
    })
  } catch (err) {
    console.error('[api/admin/ci5/report-audits GET]', err)
    return NextResponse.json({ error: 'Could not load the audit register — please try again.' }, { status: 500 })
  }
}

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
    const reviewerProfileId = typeof body.reviewerProfileId === 'string' ? body.reviewerProfileId : ''
    const reviewer = reviewerProfileId ? await resolveReviewerProfileById(reviewerDbFromPrisma(db), reviewerProfileId) : null
    if (!reviewer) return NextResponse.json({ error: 'reviewerProfileId must reference an existing reviewer profile' }, { status: 400 })
    const result = await recordClassroomReportAuditReview(reportAuditDbFromPrisma(db), reviewer, {
      reportId: body.reportId,
      reportChecksum: body.reportChecksum,
      verdict: body.verdict,
      supportedFindings: body.supportedFindings,
      unsupportedFindings: body.unsupportedFindings,
      ambiguousFindings: body.ambiguousFindings,
      unobservableMarkers: body.unobservableMarkers,
      rationale: body.rationale,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ reviewId: result.reviewId }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/report-audits POST]', err)
    return NextResponse.json({ error: 'Could not record the audit — please try again.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    // Clearly-labelled synthetic pilot fixture: a minimal ClassroomEvaluationJob
    // + ClassSession + ClassroomEvaluationReport chain, flagged as a CI-5 pilot
    // fixture. No real student data exists in it (all names are placeholder text
    // the masking layer removes before any reviewer sees them).
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      body = {}
    }
    const student = await db.student.findFirst({ where: { id: guard.student.id } })
    if (!student) return NextResponse.json({ error: 'admin account not found' }, { status: 404 })
    const teacherProfile = await db.teacherProfile.findFirst({ where: { studentId: student.id } })
      ?? await db.teacherProfile.create({
        data: {
          studentId: student.id,
          teachingName: 'CI-5 Pilot Fixture Teacher',
          headline: 'synthetic pilot fixture — not a real teacher profile',
          bio: 'fixture',
          subjectsJson: '[]',
          levelsJson: '[]',
          languagesJson: '[]',
          qualificationsText: 'fixture',
          experienceYears: 0,
          verificationStatus: 'REJECTED', // never published — fixture only
        },
      })
    const classSession = await db.classSession.create({
      data: {
        teacherProfileId: teacherProfile.id,
        title: '[CI-5 PILOT FIXTURE] Synthetic classroom — report-audit pilot',
        description: 'Synthetic fixture for the CI-5G classroom-report audit pilot. No real class occurred; all evidence is BEAN-authored placeholder material.',
        subject: 'Mathematics (fixture)',
        targetLevel: 'CLASS_10',
        language: 'English',
        durationMinutes: 60,
        startsAt: new Date(),
        timeZone: 'UTC',
        capacity: 1,
        minimumStudents: 1,
        status: 'COMPLETED',
      },
    })
    const job = await db.classroomEvaluationJob.create({
      data: {
        classSessionId: classSession.id,
        teacherProfileId: teacherProfile.id,
        trigger: 'SESSION_END',
        status: 'COMPLETED',
        stage: 'DONE',
        requestedById: student.id,
      },
    })
    const reportJson = JSON.stringify({
      classMetadata: { subject: 'Mathematics (fixture)', declaredLanguage: 'English', mode: 'ONLINE', durationMinutes: 40, studentName: 'Fixture Student Name', studentEmail: 'fixture-student@example.invalid' },
      evidence: {
        observer: { present: true, structuredOnly: true, transcriptionEnabled: false },
        teacherNotes: 'worked two algebra examples on the board; used a shared document (fixture notes)',
        whiteboard: { strokes: 14, dimensions: 'structured geometry only — no text' },
      },
      findings: {
        summary: 'The class covered two worked examples; pacing appeared uneven in the second half based on the structured timeline.',
        claims: [
          'two algebra examples were worked through',
          'pacing changed in the second half',
          'students asked five questions', // NOT in the evidence — a report over-claim the audit must catch
        ],
        insufficientEvidence: false,
      },
      auditor: { verdict: 'PASS_WITH_NOTES', notes: ['teacher notes are teacher-authoritative, not independently verified'] },
    })
    const report = await db.classroomEvaluationReport.create({
      data: {
        jobId: job.id,
        classSessionId: classSession.id,
        teacherProfileId: teacherProfile.id,
        version: 1,
        status: 'CURRENT',
        reportJson,
        insufficientEvidence: false,
        requiresHumanReview: true,
      },
    })
    return NextResponse.json({
      pilotFixture: {
        reportId: report.id,
        reportVersion: report.version,
        label: 'SYNTHETIC CI-5 PILOT FIXTURE — clearly labelled; not a real classroom',
        maskedKeys: ['studentName', 'studentEmail'],
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/report-audits PUT]', err)
    return NextResponse.json({ error: 'Could not create the pilot fixture — please try again.' }, { status: 500 })
  }
}
