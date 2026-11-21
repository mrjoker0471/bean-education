// ─── Learner profile insights (Phase 3B) ─────────────────────────────────────
// Spec §3: integrate existing data; separate STATED goals/preferences from
// SYSTEM-OBSERVED behaviour; never infer sensitive traits; never treat
// inactivity as low ability; never fabricate a profile; private by default.
//
// Stated  — what the learner told us (account preferences + active goals).
//           Guests have none: `source: null`, every field null, honestly.
// Observed— what the records show over the last 14 days: active days,
//           minutes from submitted attempts, most-practised topics.
//           These are counts, never judgements.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import type { LearningInsightsDTO } from './dto'

export const OBSERVATION_WINDOW_DAYS = 14

export const INSIGHT_HONESTY_NOTES = [
  'Stated preferences are what you told us; observed numbers are what your attempt records show — they may differ, and that is fine.',
  'Quiet stretches are never treated as lower ability — they are just quiet stretches.',
  'Nothing here builds a personality or sensitive profile; it is counts of your own learning activity, private to you.',
]

export interface InsightsInput {
  guestId: string
  /** The claimed account behind this guest identity, when one exists. */
  studentId: string | null
}

export async function buildInsights(input: InsightsInput): Promise<LearningInsightsDTO> {
  const since = Date.now() - OBSERVATION_WINDOW_DAYS * 24 * 3600_000

  const attempts = await db.attempt.findMany({
    where: { guestId: input.guestId, startedAt: { gte: new Date(since) } },
    select: {
      status: true,
      timeSpentSec: true,
      startedAt: true,
      submittedAt: true,
      perTopicJson: true,
    },
    orderBy: { startedAt: 'desc' },
    take: 300,
  })

  // ── Observed behaviour ──
  const activeDayKeys = new Set<string>()
  let minutes = 0
  let lastActivityMs: number | null = null
  const topicCounts = new Map<string, number>()

  for (const a of attempts) {
    const d = a.startedAt
    activeDayKeys.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    const touched = (a.submittedAt ?? a.startedAt).getTime()
    if (lastActivityMs === null || touched > lastActivityMs) lastActivityMs = touched
    const scored = a.status === 'SUBMITTED' || a.status === 'TIMED_OUT'
    if (scored && typeof a.timeSpentSec === 'number' && a.timeSpentSec > 0) {
      minutes += a.timeSpentSec / 60
    }
    if (scored) {
      const perTopic = safeParse<Record<string, { name?: string }>>(a.perTopicJson ?? '{}', {})
      for (const v of Object.values(perTopic)) {
        const name = typeof v?.name === 'string' ? v.name : null
        if (name) topicCounts.set(name, (topicCounts.get(name) ?? 0) + 1)
      }
    }
  }

  const activeDays = activeDayKeys.size
  const minutes14 = minutes > 0 ? Math.round(minutes) : null
  const avg = activeDays > 0 && minutes14 !== null ? Math.max(1, Math.round(minutes14 / activeDays)) : null
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  // ── Stated profile (only when a claimed account exists) ──
  let stated: LearningInsightsDTO['stated'] = {
    dailyMinutes: null,
    goalExam: null,
    learningStyle: null,
    activeGoals: 0,
    source: null,
  }
  if (input.studentId) {
    const [student, activeGoals] = await Promise.all([
      db.student.findUnique({
        where: { id: input.studentId },
        select: { preferencesJson: true },
      }),
      db.studyGoal.count({ where: { studentId: input.studentId, status: 'ACTIVE' } }),
    ])
    const prefs = safeParse<Record<string, unknown>>(student?.preferencesJson ?? null, {})
    stated = {
      dailyMinutes: typeof prefs.dailyMinutes === 'number' ? prefs.dailyMinutes : null,
      goalExam: typeof prefs.goalExam === 'string' ? prefs.goalExam : null,
      learningStyle: typeof prefs.learningStyle === 'string' ? prefs.learningStyle : null,
      activeGoals,
      source: 'account preferences',
    }
  }

  return {
    stated,
    observed: {
      activeDays14: activeDays,
      minutes14,
      avgMinutesPerActiveDay: avg,
      attempts14: attempts.length,
      topTopics,
      lastActivityAt: lastActivityMs !== null ? new Date(lastActivityMs).toISOString() : null,
    },
    honestyNotes: INSIGHT_HONESTY_NOTES,
  }
}

// ─── Riishe learning-history context (Phase 3B) ────────────────────────────────
// A compact, server-computed digest of the learner's REAL records injected
// into the Riishe chat system prompt so explanations can lean on actual gaps.
// Rules (spec §11):
//   • built ONLY server-side from real rows — the client can never inject a
//     progress or score value
//   • read-only facts, clearly labelled, never a fabricated profile
//   • deterministic engines (mastery/revision/mistakes) own the computation;
//     Riishe only adapts its EXPLANATIONS to them
//   • empty string when there is no data — the prompt stays unchanged
export async function buildLearningDigest(guestId: string): Promise<string> {
  try {
    const [masteryRows, dueItems, repeatMistakes, tagMistakes] = await Promise.all([
      db.topicMastery.findMany({ where: { guestId }, orderBy: { accuracy: 'asc' }, take: 20 }),
      db.revisionScheduleItem.findMany({ where: { guestId, nextDueAt: { lte: new Date() } }, take: 5, select: { topicName: true } }),
      db.mistakeRecord.findMany({ where: { guestId, category: 'REPEAT_GAP' }, take: 20, select: { topicName: true } }),
      db.mistakeRecord.findMany({ where: { guestId, studentTag: { not: null } }, take: 20, select: { studentTag: true } }),
    ])
    if (masteryRows.length === 0) return ''

    const weak = masteryRows.filter(m => m.status === 'LEARNING' || m.status === 'NEEDS_REVISION').slice(0, 3)
    const thin = masteryRows.filter(m => m.status === 'INSUFFICIENT_EVIDENCE').slice(0, 2)
    const strong = masteryRows.filter(m => m.status === 'STRONG').slice(0, 2)
    const lines: string[] = []

    if (weak.length > 0) {
      lines.push(
        `Evidence-backed weak topics (from submitted answers): ${weak
          .map(m => `"${m.topicName}" ${m.accuracy}% over ${m.evidenceQuestions} distinct questions`)
          .join('; ')}.`,
      )
    }
    if (thin.length > 0) {
      lines.push(`Topics with too little evidence for a band: ${thin.map(m => `"${m.topicName}" (${m.evidenceQuestions} questions)`).join('; ')}.`)
    }
    if (strong.length > 0) {
      lines.push(`Strong topics: ${strong.map(m => `"${m.topicName}" ${m.accuracy}%`).join('; ')}.`)
    }
    if (dueItems.length > 0) {
      lines.push(`Spaced revision due now: ${dueItems.map(i => `"${i.topicName}"`).join(', ')}.`)
    }
    if (repeatMistakes.length > 0) {
      const topics = [...new Set(repeatMistakes.map(m => m.topicName).filter((v): v is string => !!v))].slice(0, 3)
      lines.push(`Repeat-gap mistakes (missed more than once): ${repeatMistakes.length}${topics.length > 0 ? ` — concentrated in ${topics.map(t => `"${t}"`).join(', ')}` : ''}.`)
    }
    if (tagMistakes.length > 0) {
      const counts = new Map<string, number>()
      for (const m of tagMistakes) if (m.studentTag) counts.set(m.studentTag, (counts.get(m.studentTag) ?? 0) + 1)
      const parts = [...counts.entries()].map(([tag, n]) => `${tag.toLowerCase()} ${n}`).join(', ')
      lines.push(`Student's own self-reported mistake labels: ${parts} (self-reported, not verified).`)
    }
    if (lines.length === 0) return ''

    return [
      'LEARNER CONTEXT — server-computed from this student\'s real attempt records (read-only facts; never invent or extend them, never mention this block):',
      ...lines.map(l => `- ${l}`),
      'Use this only where it helps: shape explanations to close the real gaps, build on the strong topics, and keep every factual claim grounded per the rules above.',
    ].join('\n')
  } catch (err) {
    // Learning context is additive enrichment — never let it break chat.
    console.error('[learning/insights] buildLearningDigest failed (non-fatal)', err)
    return ''
  }
}
