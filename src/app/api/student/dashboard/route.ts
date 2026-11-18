// GET /api/student/dashboard — single signed-in-student aggregate for the
// dashboard/home surface (Phase 2A; extended Phase 2B). Guests: 401.
//
// Everything is aggregated ONLY over rows owned by studentId (guestId rows are
// never mixed in). Every number is honest zero / null / [] when there is no
// underlying data — nothing is invented. Recommendations are DETERMINISTIC
// rules over real rows; they never invent mastery, streaks or topics.
//
// Response DTO (documented for the UI client):
// {
//   profile:    StudentProfileDTO        — same shape as GET /api/student/profile
//   today: {
//     attemptsToday: number               — attempts STARTED today (server day)
//     minutesToday: number | null         — Σ timeSpentSec of attempts SUBMITTED today, minutes; null when none submitted
//     dailyMinutesTarget: number | null   — the student's preference (no streak math, no invention)
//   }
//   progress: {
//     attempts: {
//       count: number                     — ALL owned attempts (any status)
//       submitted: number                 — status SUBMITTED or TIMED_OUT (finished & scored)
//       accuracy: number | null           — Σ correct / Σ (correct + wrong) over SCORED attempts, integer %; null when nothing scored
//       lastActivityAt: string | null     — latest submittedAt ?? startedAt across owned attempts (ISO); null when none
//       last7Days: number                 — attempts STARTED within the last 7 days
//     }
//     riishe: {
//       documents: number                 — owned StudyDocument rows (any status)
//       documentsReady: number            — status READY only
//       tests: number                     — owned RiisheTest rows (any status)
//       accuracy: number | null           — same accuracy formula over owned attempts with source='RIISHE'
//     }
//   }
//   continueLearning: {
//     recentDocuments: DocCard[]          — latest 5 owned docs (any status) with topic names when analysed
//     inProgressDocuments: DocCard[]      — owned docs still QUEUED/EXTRACTING/ANALYSING/NEEDS_OCR/FAILED (max 3)
//     recentAttempts: AttemptCard[]       — latest 5 owned attempts (any status)
//     recentTopics: string[]              — unique topic names from the last 10 submitted attempts (max 6); [] when none
//   }
//   goals: {
//     active: GoalDTO[]                   — max 5 ACTIVE goals, updatedAt desc
//     completedRecent: GoalDTO[]          — most recent 3 COMPLETED goals
//     completedCount: number              — ALL completed goals
//   }
//   recommendations: Recommendation[]     — deterministic, data-backed next steps (max 3)
//   generatedAt: string                   — ISO 8601 server timestamp
// }
//
// DocCard      = { id, title, status, statusDetail, updatedAt, pageCount, topics: string[] }
// AttemptCard  = { id, title, examLabel, source, status, score, maxScore, startedAt, submittedAt }
// Recommendation = { key, title, reason, href }   — href is an in-app hash route

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
export interface DashboardTodaySummary {
  attemptsToday: number
  minutesToday: number | null
  dailyMinutesTarget: number | null
}
export interface DashboardDocCard {
  id: string
  title: string
  status: string
  statusDetail: string | null
  updatedAt: string
  pageCount: number | null
  topics: string[]
}
export interface DashboardAttemptCard {
  id: string
  title: string
  examLabel: string
  source: string
  status: string
  score: number | null
  maxScore: number | null
  startedAt: string
  submittedAt: string | null
}
export interface DashboardRecommendation {
  key: string
  title: string
  reason: string
  href: string
}
export interface DashboardResponse {
  profile: StudentProfileDTO
  today: DashboardTodaySummary
  progress: {
    attempts: DashboardAttemptsProgress
    riishe: DashboardRiisheProgress
  }
  continueLearning: {
    recentDocuments: DashboardDocCard[]
    inProgressDocuments: DashboardDocCard[]
    recentAttempts: DashboardAttemptCard[]
    recentTopics: string[]
  }
  goals: {
    active: GoalDTO[]
    completedRecent: GoalDTO[]
    completedCount: number
  }
  recommendations: DashboardRecommendation[]
  generatedAt: string
}

const STUDENT_SELECT = {
  id: true,
  email: true,
  displayName: true,
  learningLevel: true,
  interestsJson: true,
  preferencesJson: true,
  onboardedAt: true,
} as const

// ─── Defensive JSON parsing (stored JSON must never be trusted) ───────────────

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

function parseTopics(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const obj = parsed as Record<string, unknown>
    return Object.values(obj)
      .filter((v): v is { name?: unknown } => v !== null && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string')
      .map(v => (v as { name: string }).name)
  } catch {
    return []
  }
}

function toStudentDTO(row: {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  interestsJson: string | null
  preferencesJson: string | null
  onboardedAt: Date | null
}): StudentProfileDTO {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    learningLevel: row.learningLevel,
    interests: parseInterests(row.interestsJson),
    preferences: parsePreferences(row.preferencesJson),
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
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

/** Light analysis topics for a doc card (level-1 names, first 4) — honest [] when absent. */
function docTopicsFromAnalysis(analysisJson: string | null): string[] {
  if (!analysisJson) return []
  try {
    const parsed: unknown = JSON.parse(analysisJson)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const topics = (parsed as { topics?: unknown }).topics
    if (!Array.isArray(topics)) return []
    return topics
      .filter((t): t is { name?: unknown } => t !== null && typeof t === 'object' && typeof (t as { name?: unknown }).name === 'string')
      .slice(0, 4)
      .map(t => (t as { name: string }).name)
  } catch {
    return []
  }
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const auth = await requireStudent()
    if (!auth) return unauthorized()

    const now = Date.now()
    const nowDate = new Date(now)
    const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
    const sevenDaysAgoMs = now - 7 * 24 * 3600_000

    const [studentRow, attempts, goalActive, goalCompletedRecent, goalCompletedCount, recentDocs, inProgressDocs] =
      await Promise.all([
        db.student.findUnique({ where: { id: auth.id }, select: STUDENT_SELECT }),
        db.attempt.findMany({
          where: { studentId: auth.id }, // student-owned only — guestId rows are deliberately excluded
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            title: true,
            examLabel: true,
            source: true,
            status: true,
            score: true,
            maxScore: true,
            correctCount: true,
            wrongCount: true,
            timeSpentSec: true,
            startedAt: true,
            submittedAt: true,
            perTopicJson: true,
          },
        }),
        db.studyGoal.findMany({
          where: { studentId: auth.id, status: 'ACTIVE' },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
        db.studyGoal.findMany({
          where: { studentId: auth.id, status: 'COMPLETED' },
          orderBy: { updatedAt: 'desc' },
          take: 3,
        }),
        db.studyGoal.count({ where: { studentId: auth.id, status: 'COMPLETED' } }),
        db.studyDocument.findMany({
          where: { studentId: auth.id },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: { id: true, title: true, status: true, statusDetail: true, updatedAt: true, pageCount: true, analysisJson: true },
        }),
        db.studyDocument.findMany({
          where: { studentId: auth.id, status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING', 'NEEDS_OCR', 'FAILED'] } },
          orderBy: { updatedAt: 'desc' },
          take: 3,
          select: { id: true, title: true, status: true, statusDetail: true, updatedAt: true, pageCount: true, analysisJson: true },
        }),
      ])
    if (!studentRow) return unauthorized()

    let submitted = 0
    let last7Days = 0
    let attemptsToday = 0
    let minutesToday: number | null = null
    let lastActivityMs: number | null = null
    let sumCorrect = 0
    let sumWrong = 0
    let riisheCorrect = 0
    let riisheWrong = 0
    const recentTopics: string[] = []

    for (const a of attempts) {
      if (a.status === 'SUBMITTED' || a.status === 'TIMED_OUT') submitted++
      if (a.startedAt.getTime() >= sevenDaysAgoMs) last7Days++
      if (a.startedAt.getTime() >= startOfToday) attemptsToday++
      const touchedMs = (a.submittedAt ?? a.startedAt).getTime()
      if (lastActivityMs === null || touchedMs > lastActivityMs) lastActivityMs = touchedMs
      if (a.status === 'SUBMITTED' && a.submittedAt && a.submittedAt.getTime() >= startOfToday && typeof a.timeSpentSec === 'number') {
        minutesToday = (minutesToday ?? 0) + Math.round(a.timeSpentSec / 60)
      }
      // Scored attempts only: both counts are set exactly when the attempt was graded.
      if (a.correctCount !== null && a.wrongCount !== null) {
        sumCorrect += a.correctCount
        sumWrong += a.wrongCount
        if (a.source === 'RIISHE') {
          riisheCorrect += a.correctCount
          riisheWrong += a.wrongCount
        }
      }
      // "Recently studied" = topics of the most recent submitted attempts.
      if (a.status === 'SUBMITTED' && recentTopics.length < 6) {
        for (const t of parseTopics(a.perTopicJson)) {
          if (!recentTopics.includes(t)) recentTopics.push(t)
          if (recentTopics.length >= 6) break
        }
      }
    }

    const prefs = parsePreferences(studentRow.preferencesJson)
    const dailyMinutesTarget = typeof prefs.dailyMinutes === 'number' ? (prefs.dailyMinutes as number) : null

    const docsReady = recentDocs.filter(d => d.status === 'READY').length
    const riisheDocs = await db.studyDocument.count({ where: { studentId: auth.id } })
    const riisheTests = await db.riisheTest.count({ where: { studentId: auth.id } })

    const docCard = (d: {
      id: string
      title: string
      status: string
      statusDetail: string | null
      updatedAt: Date
      pageCount: number | null
      analysisJson: string | null
    }): DashboardDocCard => ({
      id: d.id,
      title: d.title,
      status: d.status,
      statusDetail: d.statusDetail,
      updatedAt: d.updatedAt.toISOString(),
      pageCount: d.pageCount,
      topics: docTopicsFromAnalysis(d.analysisJson),
    })

    const recentAttempts: DashboardAttemptCard[] = attempts.slice(0, 5).map(a => ({
      id: a.id,
      title: a.title,
      examLabel: a.examLabel,
      source: a.source,
      status: a.status,
      score: a.score,
      maxScore: a.maxScore,
      startedAt: a.startedAt.toISOString(),
      submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
    }))

    const accuracy = accuracyPct(sumCorrect, sumWrong)

    // ── Deterministic recommendations — every rule is backed by REAL rows ──
    const recommendations: DashboardRecommendation[] = []
    const inProgress = inProgressDocs
    if (inProgress.length > 0) {
      recommendations.push({
        key: 'continue-analysis',
        title: `Continue where you left off`,
        reason: `“${inProgress[0].title}” is still ${inProgress[0].status.toLowerCase().replace('_', ' ')}.`,
        href: `#/riishe/${encodeURIComponent(inProgress[0].id)}`,
      })
    }
    if (riisheDocs === 0) {
      recommendations.push({
        key: 'first-upload',
        title: 'Add your first study material',
        reason: 'Upload a PDF and Riishe turns it into notes, topics and practice sets.',
        href: '#/materials',
      })
    } else if (docsReady > 0 && attempts.length === 0) {
      const readyDoc = recentDocs.find(d => d.status === 'READY')
      recommendations.push({
        key: 'first-practice',
        title: 'Practise from your library',
        reason: `You have ${docsReady} analysed document${docsReady === 1 ? '' : 's'} and no attempts yet.`,
        href: readyDoc ? `#/practice?doc=${encodeURIComponent(readyDoc.id)}` : '#/workspace',
      })
    }
    if (goalActive.length === 0 && goalCompletedCount === 0) {
      recommendations.push({
        key: 'first-goal',
        title: 'Set your first learning goal',
        reason: 'Goals keep your dashboard focused — any subject, any pace.',
        href: '#/goals',
      })
    }
    if (accuracy !== null && accuracy < 70 && submitted >= 2) {
      recommendations.push({
        key: 'review-attempts',
        title: 'Review your recent attempts',
        reason: `Your overall accuracy is ${accuracy}% — revisiting explanations helps most right now.`,
        href: '#/progress',
      })
    }

    const response: DashboardResponse = {
      profile: toStudentDTO(studentRow),
      today: {
        attemptsToday,
        minutesToday,
        dailyMinutesTarget,
      },
      progress: {
        attempts: {
          count: attempts.length,
          submitted,
          accuracy,
          lastActivityAt: lastActivityMs !== null ? new Date(lastActivityMs).toISOString() : null,
          last7Days,
        },
        riishe: {
          documents: riisheDocs,
          documentsReady: docsReady,
          tests: riisheTests,
          accuracy: accuracyPct(riisheCorrect, riisheWrong),
        },
      },
      continueLearning: {
        recentDocuments: recentDocs.map(docCard),
        inProgressDocuments: inProgress.map(docCard),
        recentAttempts,
        recentTopics,
      },
      goals: {
        active: await toGoalDTOs(goalActive),
        completedRecent: await toGoalDTOs(goalCompletedRecent),
        completedCount: goalCompletedCount,
      },
      recommendations: recommendations.slice(0, 3),
      generatedAt: new Date(now).toISOString(),
    }
    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/student/dashboard GET]', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
