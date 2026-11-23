// ─── BEAN Classroom Intelligence (CI-1D): per-class evaluation ───────────────
// GET  /api/teach/classes/:id/evaluation — the owner teacher sees the job
//        status and ALL report versions of their own class (404 otherwise).
// POST /api/teach/classes/:id/evaluation — owner teacher requests an
//        evaluation (first run or explicit re-run → a new report VERSION).
//        Consent-gated server-side (403 with a clear message otherwise).
//        Optional opt-in teacher notes (30..4000 chars) become authorised
//        evidence for this evaluation only, provided by the teacher itself.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'
import { enqueueEvaluation } from '@/lib/ci/queue'
import { hasCiConsent } from '@/lib/ci/queue'
import { CI_TEACHER_NOTES_MAX, CI_TEACHER_NOTES_MIN, CI_TRIGGER } from '@/lib/ci/constants'
import { parseStoredReport, type CiClassEvaluationResponse, type CiEvaluationStatusDTO, type CiReportVersionDTO } from '@/lib/ci/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type VersionRow = {
  id: string
  version: number
  status: string
  createdAt: Date
  insufficientEvidence: boolean
  requiresHumanReview: boolean
  modelId: string | null
  reportJson: string
}

function toVersionDTO(row: VersionRow): CiReportVersionDTO {
  const { report, reportError } = parseStoredReport(row.reportJson)
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    insufficientEvidence: row.insufficientEvidence,
    requiresHumanReview: row.requiresHumanReview,
    modelId: row.modelId,
    report,
    reportError,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard
    const { id } = await params

    const cls = await db.classSession.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        subject: true,
        startsAt: true,
        timeZone: true,
        durationMinutes: true,
        teacherProfileId: true,
        classroomEvaluationJob: {
          select: {
            id: true,
            status: true,
            stage: true,
            trigger: true,
            error: true,
            updatedAt: true,
            reports: {
              orderBy: { version: 'desc' },
              select: {
                id: true,
                version: true,
                status: true,
                createdAt: true,
                insufficientEvidence: true,
                requiresHumanReview: true,
                modelId: true,
                reportJson: true,
              },
            },
          },
        },
      },
    })
    // Ownership: only the class's own teacher can read its evaluation — and a
    // missing class is indistinguishable from someone else's class (404).
    if (!cls || cls.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }

    const job = cls.classroomEvaluationJob
    const response: CiClassEvaluationResponse = {
      classSession: {
        id: cls.id,
        title: cls.title,
        subject: cls.subject,
        startsAt: cls.startsAt.toISOString(),
        timeZone: cls.timeZone,
        durationMinutes: cls.durationMinutes,
      },
      job: job
        ? ({
            jobId: job.id,
            status: job.status,
            stage: job.stage,
            trigger: job.trigger,
            error: job.error,
            updatedAt: job.updatedAt.toISOString(),
          } satisfies CiEvaluationStatusDTO)
        : null,
      versions: (job?.reports ?? []).map(toVersionDTO),
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/teach/classes/:id/evaluation GET]', err)
    return NextResponse.json({ error: 'Could not load the class evaluation.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { student, profile } = guard
    const { id } = await params

    // Class ownership is verified BEFORE anything else is read or written.
    const cls = await db.classSession.findUnique({
      where: { id },
      select: { id: true, teacherProfileId: true },
    })
    if (!cls || cls.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as { teacherNotes?: unknown } | null
    let teacherNotes: string | null = null
    if (body && typeof body.teacherNotes === 'string' && body.teacherNotes.trim().length > 0) {
      const notes = body.teacherNotes.trim()
      if (notes.length < CI_TEACHER_NOTES_MIN || notes.length > CI_TEACHER_NOTES_MAX) {
        return NextResponse.json(
          { error: `Lesson notes must be between ${CI_TEACHER_NOTES_MIN} and ${CI_TEACHER_NOTES_MAX} characters.` },
          { status: 400 },
        )
      }
      teacherNotes = notes
    }

    if (!(await hasCiConsent(student.id))) {
      return NextResponse.json(
        { error: 'Classroom Intelligence consent is not granted. Enable it from the Classroom Intelligence tab first.' },
        { status: 403 },
      )
    }

    const outcome = await enqueueEvaluation({
      classSessionId: id,
      trigger: CI_TRIGGER.TEACHER_REQUEST,
      requestedById: student.id,
      teacherNotes,
    })

    if (!outcome.queued) {
      const status = outcome.reason === 'no_consent' ? 403 : outcome.reason === 'class_not_found' ? 404 : 409
      const message =
        outcome.reason === 'no_consent'
          ? 'Classroom Intelligence consent is not granted.'
          : outcome.reason === 'class_not_found'
            ? 'Class not found.'
            : outcome.reason === 'no_live_session'
              ? 'This class never had a live session, so there is nothing to evaluate.'
              : outcome.reason === 'class_not_terminal'
                ? 'The live session for this class has not finished yet.'
                : outcome.reason === 'already_evaluated'
                  ? 'This class already has a completed evaluation.'
                  : 'The evaluation could not be queued.'
      return NextResponse.json({ error: message, reason: outcome.reason }, { status })
    }

    return NextResponse.json({ queued: true, jobId: outcome.jobId, alreadyQueued: outcome.alreadyQueued })
  } catch (err) {
    console.error('[api/teach/classes/:id/evaluation POST]', err)
    return NextResponse.json({ error: 'Could not request the evaluation.' }, { status: 500 })
  }
}
