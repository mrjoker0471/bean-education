// ─── BEAN Classroom Intelligence (CI-1D): teacher consent + summary ──────────
// GET  /api/teach/classroom-intelligence — consent state + the teacher's
//        evaluated/pending/eligible classes. Ownership: every row is scoped by
//        the APPROVED TeacherProfile resolved from the session cookie.
// POST /api/teach/classroom-intelligence/consent — grant or withdraw CI
//        consent. Withdrawal stops future evaluations immediately (checked at
//        enqueue AND claim time); existing reports remain until deleted or the
//        account is deleted.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'
import { getCiConsentState, grantCiConsent, withdrawCiConsent } from '@/lib/ci/trigger'
import { toConsentDTO, type CiClassEvaluationSummaryDTO, type CiTeacherSummaryResponse } from '@/lib/ci/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TERMINAL_LIVE = ['ENDED', 'INTERRUPTED']

function toSummary(
  cls: {
    id: string
    title: string
    subject: string
    startsAt: Date
    timeZone: string
    durationMinutes: number
    classroomEvaluationJob: {
      id: string
      status: string
      stage: string
      trigger: string
      error: string | null
      updatedAt: Date
      reports: { version: number; status: string; insufficientEvidence: boolean; requiresHumanReview: boolean }[]
    } | null
  },
): CiClassEvaluationSummaryDTO {
  const job = cls.classroomEvaluationJob
  const current = job?.reports.find((r) => r.status === 'CURRENT') ?? null
  return {
    classSessionId: cls.id,
    title: cls.title,
    subject: cls.subject,
    startsAt: cls.startsAt.toISOString(),
    timeZone: cls.timeZone,
    durationMinutes: cls.durationMinutes,
    evaluation: job
      ? {
          jobId: job.id,
          status: job.status,
          stage: job.stage,
          trigger: job.trigger,
          error: job.error,
          updatedAt: job.updatedAt.toISOString(),
        }
      : null,
    currentVersion: current?.version ?? null,
    insufficientEvidence: current?.insufficientEvidence ?? false,
    requiresHumanReview: current?.requiresHumanReview ?? false,
  }
}

export async function GET() {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard

    const consent = toConsentDTO(await getCiConsentState(profile.studentId))

    const classes = await db.classSession.findMany({
      where: { teacherProfileId: profile.id, liveSession: { status: { in: TERMINAL_LIVE } } },
      orderBy: { startsAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        subject: true,
        startsAt: true,
        timeZone: true,
        durationMinutes: true,
        classroomEvaluationJob: {
          select: {
            id: true,
            status: true,
            stage: true,
            trigger: true,
            error: true,
            updatedAt: true,
            reports: {
              select: { version: true, status: true, insufficientEvidence: true, requiresHumanReview: true },
            },
          },
        },
      },
    })

    const summaries = classes.map(toSummary)
    const evaluated = summaries.filter((s) => s.evaluation?.status === 'COMPLETED')
    const pending = summaries.filter((s) => s.evaluation && (s.evaluation.status === 'QUEUED' || s.evaluation.status === 'RUNNING'))
    const eligible = summaries.filter((s) => !s.evaluation || ['FAILED', 'SKIPPED'].includes(s.evaluation.status))

    const response: CiTeacherSummaryResponse = {
      consent,
      evaluated,
      pending,
      eligible,
      totals: {
        evaluatedClasses: evaluated.length,
        requiresReview: evaluated.filter((s) => s.requiresHumanReview).length,
      },
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/teach/classroom-intelligence GET]', err)
    return NextResponse.json({ error: 'Could not load Classroom Intelligence.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { profile } = guard

    const body = (await req.json().catch(() => null)) as { granted?: unknown } | null
    if (!body || typeof body.granted !== 'boolean') {
      return NextResponse.json({ error: 'Invalid consent request.' }, { status: 400 })
    }

    const state = body.granted ? await grantCiConsent(profile.studentId) : await withdrawCiConsent(profile.studentId)
    return NextResponse.json({ consent: toConsentDTO(state) })
  } catch (err) {
    console.error('[api/teach/classroom-intelligence POST]', err)
    return NextResponse.json({ error: 'Could not update Classroom Intelligence consent.' }, { status: 500 })
  }
}
