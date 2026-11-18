// GET /api/student/dashboard — single signed-in-student aggregate for the
// dashboard/home surface. Guests: 401.
//
// Everything is aggregated ONLY over rows owned by studentId (guestId rows are
// never mixed in). Every number is honest zero / null / [] when there is no
// underlying data — nothing is invented.
//
// Response DTO (documented for the UI client):
// {
//   profile:    StudentProfileDTO        — same shape as GET /api/student/profile
//   progress: {
//     attempts: {
//       count: number                   — ALL owned attempts (any status)
//       submitted: number               — status SUBMITTED or TIMED_OUT (finished & scored)
//       accuracy: number | null         — Σ correct / Σ (correct + wrong) over SCORED attempts, integer %; null when nothing scored
//       lastActivityAt: string | null   — latest submittedAt ?? startedAt across owned attempts (ISO); null when none
//       last7Days: number               — attempts STARTED within the last 7 days
//     }
//     riishe: {
//       documents: number               — owned StudyDocument rows (any status)
//       documentsReady: number          — status READY only
//       tests: number                   — owned RiisheTest rows (any status)
//       accuracy: number | null         — same accuracy formula over owned attempts with source='RIISHE'
//     }
//   }
//   goals:      GoalDTO[]               — max 5 ACTIVE goals, updatedAt desc (same shape as /api/student/goals)
//   generatedAt: string                 — ISO 8601 server timestamp
// }

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent } from '@/lib/auth'
import type { StudentProfileDTO } from '../profile/route'
import type { GoalDTO } from '../goals/route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Type-only exports — erased at compile time, safe for a Route Handler file.
export interface DashboardAttemptsProgress {
  count: number
  submitted: number
  accuracy: number | null
  lastActivityAt: string | null
  last7Days: number
}
export interface DashboardRiisheProgress {
  documents: number
  documentsReady: number
  tests: number
  accuracy: number | null
}
export interface DashboardResponse {
  profile: StudentProfileDTO
  progress: {
    attempts: DashboardAttemptsProgress
    riishe: DashboardRiisheProgress
  }
  goals: GoalDTO[]
  generatedAt: string
}

const STUDENT_SELECT = {
  id: true,
  email: true,
  displayName: true,
  learningLevel: true,
  interestsJson: true,
  preferencesJson: true,
} as const

// ─── Defensive JSON parsing (duplicated from the profile route — shared lib
//     files are outside this task's allowed file list) ─────────────────────────

function parseInterests(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function parsePreferences(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

function toStudentDTO(row: {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  interestsJson: string | null
  preferencesJson: string | null
}): StudentProfileDTO {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    learningLevel: row.learningLevel,
    interests: parseInterests(row.interestsJson),
    preferences: parsePreferences(row.preferencesJson),
  }
}

/** Σ correct / Σ (correct + wrong) as an integer percent — null when nothing was answered. */
function accuracyPct(correct: number, wrong: number): number | null {
  const answered = correct + wrong
  return answered > 0 ? Math.round((correct / answered) * 100) : null
}

// StudyGoal carries examId/topicId as plain FK columns (no Prisma relation),
// so labels are resolved with two small batched lookups (duplicated from the
// goals route — shared lib files are outside this task's allowed file list).
async function toGoalDTOs(rows: {
  id: string
  title: string
  examId: string | null
  topicId: string | null
  targetDate: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
}[]): Promise<GoalDTO[]> {
  const examIds = [...new Set(rows.map(r => r.examId).filter((v): v is string => typeof v === 'string'))]
  const topicIds = [...new Set(rows.map(r => r.topicId).filter((v): v is string => typeof v === 'string'))]
  const [exams, topics] = await Promise.all([
    examIds.length > 0
      ? db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, slug: true, name: true, shortName: true } })
      : Promise.resolve([] as { id: string; slug: string; name: string; shortName: string | null }[]),
    topicIds.length > 0
      ? db.topic.findMany({ where: { id: { in: topicIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ])
  const examById = new Map(exams.map(e => [e.id, e]))
  const topicById = new Map(topics.map(t => [t.id, t]))
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    examId: r.examId,
    topicId: r.topicId,
    targetDate: r.targetDate ? r.targetDate.toISOString() : null,
    status: r.status as GoalDTO['status'],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    exam: r.examId ? examById.get(r.examId) ?? null : null,
    topic: r.topicId ? topicById.get(r.topicId) ?? null : null,
  }))
}

function unauthorized() {
  return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const auth = await requireStudent()
    if (!auth) return unauthorized()

    const [studentRow, attempts, documents, documentsReady, tests, goalRows] = await Promise.all([
      db.student.findUnique({ where: { id: auth.id }, select: STUDENT_SELECT }),
      db.attempt.findMany({
        where: { studentId: auth.id }, // student-owned only — guestId rows are deliberately excluded
        select: { status: true, source: true, correctCount: true, wrongCount: true, startedAt: true, submittedAt: true },
      }),
      db.studyDocument.count({ where: { studentId: auth.id } }),
      db.studyDocument.count({ where: { studentId: auth.id, status: 'READY' } }),
      db.riisheTest.count({ where: { studentId: auth.id } }),
      db.studyGoal.findMany({
        where: { studentId: auth.id, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ])
    if (!studentRow) return unauthorized()

    const now = Date.now()
    const sevenDaysAgoMs = now - 7 * 24 * 3600_000

    let submitted = 0
    let last7Days = 0
    let lastActivityMs: number | null = null
    let sumCorrect = 0
    let sumWrong = 0
    let riisheCorrect = 0
    let riisheWrong = 0

    for (const a of attempts) {
      if (a.status === 'SUBMITTED' || a.status === 'TIMED_OUT') submitted++
      if (a.startedAt.getTime() >= sevenDaysAgoMs) last7Days++
      const touchedMs = (a.submittedAt ?? a.startedAt).getTime()
      if (lastActivityMs === null || touchedMs > lastActivityMs) lastActivityMs = touchedMs
      // Scored attempts only: both counts are set exactly when the attempt was graded.
      if (a.correctCount !== null && a.wrongCount !== null) {
        sumCorrect += a.correctCount
        sumWrong += a.wrongCount
        if (a.source === 'RIISHE') {
          riisheCorrect += a.correctCount
          riisheWrong += a.wrongCount
        }
      }
    }

    const response: DashboardResponse = {
      profile: toStudentDTO(studentRow),
      progress: {
        attempts: {
          count: attempts.length,
          submitted,
          accuracy: accuracyPct(sumCorrect, sumWrong),
          lastActivityAt: lastActivityMs !== null ? new Date(lastActivityMs).toISOString() : null,
          last7Days,
        },
        riishe: {
          documents,
          documentsReady,
          tests,
          accuracy: accuracyPct(riisheCorrect, riisheWrong),
        },
      },
      goals: await toGoalDTOs(goalRows),
      generatedAt: new Date(now).toISOString(),
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/student/dashboard GET]', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
