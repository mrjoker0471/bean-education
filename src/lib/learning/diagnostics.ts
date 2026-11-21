// ─── Diagnostic assessments (Phase 3B) ────────────────────────────────────────
// Diagnostics reuse the existing server-authoritative test engine end-to-end:
// questions are selected server-side from VERIFIED bank rows only, answers are
// never exposed before submission, scoring/timing protections stay in place,
// and submission flows through POST /api/attempts/[id] exactly like practice.
// The only new thing is the selection policy + the config marker that makes
// the attempt a diagnostic (mastery evidence + per-topic results come free
// via perTopicJson).
//
// Policy:
//   • one IN_PROGRESS diagnostic per topic (resume instead of stacking)
//   • needs ≥ DIAGNOSTIC_MIN_BANK VERIFIED questions, takes up to 10
//   • untimed-ish: 1 minute per question — diagnostics measure mastery, not
//     exam pace (documented difference from stage-pattern practice tests)
//   • skipped questions are honest gaps: they count as skipped, never wrong

import { db } from '@/lib/db'
import { safeParse, shuffle } from '@/lib/serialize'

export const DIAGNOSTIC_MIN_BANK = 6
export const DIAGNOSTIC_MAX_QUESTIONS = 10

// Same safeguard as /api/tests/start: UNVERIFIED and REJECTED PYQ rows must
// never reach a student-facing test. Kept as a local constant to avoid
// importing from a route file.
const SELECTABLE_QUESTION = { verificationStatus: 'VERIFIED' } as const

export interface DiagnosticConfig {
  count: number
  durationMin: number
  marksPerQuestion: number
  negativeMark: number
  kind: 'DIAGNOSTIC'
  topicId: string
}

export function isDiagnosticConfig(config: unknown): config is DiagnosticConfig {
  if (config === null || typeof config !== 'object') return false
  return (config as { kind?: unknown }).kind === 'DIAGNOSTIC'
}

export type DiagnosticStartResult =
  | { ok: true; attemptId: string; resumed: boolean; count: number }
  | { ok: false; error: string; status: number }

export async function startDiagnostic(guestId: string, topicId: string): Promise<DiagnosticStartResult> {
  const topic = await db.topic.findUnique({
    where: { id: topicId },
    select: {
      id: true,
      name: true,
      unit: { select: { subject: { select: { id: true, stage: { select: { exam: { select: { id: true, shortName: true, name: true } } } } } } } },
    },
  })
  if (!topic) return { ok: false, error: 'Topic not found', status: 404 }

  const available = await db.question.count({ where: { topicId, ...SELECTABLE_QUESTION } })
  if (available < DIAGNOSTIC_MIN_BANK) {
    return {
      ok: false,
      error: `A diagnostic needs at least ${DIAGNOSTIC_MIN_BANK} verified questions for this topic — ${available} available right now.`,
      status: 409,
    }
  }

  // Resume an in-progress diagnostic for the same topic instead of stacking.
  const existing = await db.attempt.findFirst({
    where: { guestId, status: 'IN_PROGRESS', topicId, source: 'BANK' },
    orderBy: { startedAt: 'desc' },
  })
  if (existing) {
    const config = safeParse<DiagnosticConfig | null>(existing.configJson, null)
    if (isDiagnosticConfig(config)) {
      const stillValid = Date.now() - existing.startedAt.getTime() < (config.durationMin + 5) * 60_000
      if (stillValid) return { ok: true, attemptId: existing.id, resumed: true, count: config.count }
      await db.attempt.update({ where: { id: existing.id }, data: { status: 'ABANDONED' } })
    } else {
      // A non-diagnostic practice attempt on the same topic — leave it alone.
      // Diagnostics stack on top of practice, never overwrite it.
    }
  }

  const rows = await db.question.findMany({
    where: { topicId, ...SELECTABLE_QUESTION },
    select: { id: true },
  })
  const chosen = shuffle(rows.map(r => r.id)).slice(0, DIAGNOSTIC_MAX_QUESTIONS)
  if (chosen.length < DIAGNOSTIC_MIN_BANK) {
    return { ok: false, error: 'Not enough verified questions available right now.', status: 409 }
  }

  const config: DiagnosticConfig = {
    count: chosen.length,
    durationMin: chosen.length, // 1 minute per question — mastery probe, not exam simulation
    marksPerQuestion: 1,
    negativeMark: 0,
    kind: 'DIAGNOSTIC',
    topicId,
  }

  const attempt = await db.attempt.create({
    data: {
      guestId,
      examId: topic.unit.subject.stage.exam.id,
      title: `Diagnostic — ${topic.name}`,
      examLabel: topic.unit.subject.stage.exam.shortName ?? topic.unit.subject.stage.exam.name,
      topicId,
      subjectId: topic.unit.subject.id,
      configJson: JSON.stringify(config),
      questionIdsJson: JSON.stringify(chosen),
      answersJson: JSON.stringify({}),
      status: 'IN_PROGRESS',
      source: 'BANK',
    },
  })
  return { ok: true, attemptId: attempt.id, resumed: false, count: chosen.length }
}
