// ─── Diagnostic assessments (Phase 3B, release-review scope extension) ────────
// Diagnostics reuse the existing server-authoritative test engine end-to-end:
// questions are selected server-side from VERIFIED bank rows only, answers are
// never exposed before submission, scoring/timing protections stay in place,
// and submission flows through POST /api/attempts/[id] exactly like practice.
// The only new thing is the selection policy + the config marker that makes
// the attempt a diagnostic (mastery evidence + per-topic results come free
// via perTopicJson).
//
// Scope: a diagnostic can probe ONE topic, one UNIT (chapter), one SUBJECT or
// one whole EXAM/syllabus area — wherever the verified question bank actually
// supports it. Non-topic scopes select questions THROUGH the topic relation
// (topic → unit → subject → stage → exam), so every selected question still
// carries a catalogue topic: per-topic results, mastery evidence and mistake
// records work identically for all four scopes. Insufficient verified
// coverage is an honest 409 — coverage is never fabricated.
//
// Policy:
//   • one IN_PROGRESS diagnostic per scope (resume instead of stacking)
//   • needs ≥ DIAGNOSTIC_MIN_BANK VERIFIED questions, takes up to 10
//   • untimed-ish: 1 minute per question — diagnostics measure mastery, not
//     exam pace (documented difference from stage-pattern practice tests)
//   • skipped questions are honest gaps: they count as skipped, never wrong
//   • scope metadata (scopeType/scopeId/scopeLabel) is persisted in the
//     attempt's configJson so topic, unit, subject and exam diagnostics are
//     distinguishable afterwards; the topicId column mirrors TOPIC scopes

import { db } from '@/lib/db'
import { safeParse, shuffle } from '@/lib/serialize'
import type { DiagnosticScopeType } from './dto'

export const DIAGNOSTIC_MIN_BANK = 6
export const DIAGNOSTIC_MAX_QUESTIONS = 10

export type { DiagnosticScopeType }

export interface DiagnosticScopeRef {
  scopeType: DiagnosticScopeType
  scopeId: string
}

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
  scopeType: DiagnosticScopeType
  scopeId: string
  scopeLabel: string
  /** Present only for TOPIC scope (mirrored on the Attempt.topicId column). */
  topicId?: string
}

export function isDiagnosticConfig(config: unknown): config is DiagnosticConfig {
  if (config === null || typeof config !== 'object') return false
  return (config as { kind?: unknown }).kind === 'DIAGNOSTIC'
}

/** Prisma question filter for one diagnostic scope. Every non-topic filter
 *  goes through the topic relation so selected questions always have topics. */
export function questionScopeFilter(scope: DiagnosticScopeRef): Record<string, unknown> {
  switch (scope.scopeType) {
    case 'TOPIC':
      return { topicId: scope.scopeId }
    case 'UNIT':
      return { topic: { unitId: scope.scopeId } }
    case 'SUBJECT':
      return { topic: { unit: { subjectId: scope.scopeId } } }
    case 'EXAM':
      return { topic: { unit: { subject: { stage: { examId: scope.scopeId } } } } }
  }
}

interface ResolvedScope {
  label: string
  examId: string | null
  examLabel: string
  /** Set when the scope resolves to a single subject; null for exam scope. */
  subjectId: string | null
}

async function resolveScope(scope: DiagnosticScopeRef): Promise<{ ok: true; resolved: ResolvedScope } | { ok: false; error: string; status: number }> {
  if (scope.scopeType === 'TOPIC') {
    const topic = await db.topic.findUnique({
      where: { id: scope.scopeId },
      select: {
        id: true,
        name: true,
        unit: { select: { subject: { select: { id: true, stage: { select: { exam: { select: { id: true, shortName: true, name: true } } } } } } } },
      },
    })
    if (!topic) return { ok: false, error: 'Topic not found', status: 404 }
    return {
      ok: true,
      resolved: {
        label: topic.name,
        examId: topic.unit.subject.stage.exam.id,
        examLabel: topic.unit.subject.stage.exam.shortName ?? topic.unit.subject.stage.exam.name,
        subjectId: topic.unit.subject.id,
      },
    }
  }
  if (scope.scopeType === 'UNIT') {
    const unit = await db.unit.findUnique({
      where: { id: scope.scopeId },
      select: {
        name: true,
        subject: { select: { id: true, stage: { select: { exam: { select: { id: true, shortName: true, name: true } } } } } },
      },
    })
    if (!unit) return { ok: false, error: 'Unit not found', status: 404 }
    return {
      ok: true,
      resolved: {
        label: `${unit.name} (unit)`,
        examId: unit.subject.stage.exam.id,
        examLabel: unit.subject.stage.exam.shortName ?? unit.subject.stage.exam.name,
        subjectId: unit.subject.id,
      },
    }
  }
  if (scope.scopeType === 'SUBJECT') {
    const subject = await db.subject.findUnique({
      where: { id: scope.scopeId },
      select: { id: true, name: true, stage: { select: { exam: { select: { id: true, shortName: true, name: true } } } } },
    })
    if (!subject) return { ok: false, error: 'Subject not found', status: 404 }
    return {
      ok: true,
      resolved: {
        label: `${subject.name} (subject)`,
        examId: subject.stage.exam.id,
        examLabel: subject.stage.exam.shortName ?? subject.stage.exam.name,
        subjectId: subject.id,
      },
    }
  }
  const exam = await db.exam.findUnique({
    where: { id: scope.scopeId },
    select: { id: true, shortName: true, name: true },
  })
  if (!exam) return { ok: false, error: 'Exam not found', status: 404 }
  return {
    ok: true,
    resolved: { label: `${exam.shortName ?? exam.name} (full syllabus)`, examId: exam.id, examLabel: exam.shortName ?? exam.name, subjectId: null },
  }
}

/** Find a still-valid IN_PROGRESS diagnostic for THIS scope (resume, not stack). */
async function findResumableDiagnostic(guestId: string, scope: DiagnosticScopeRef) {
  if (scope.scopeType === 'TOPIC') {
    // Topic diagnostics resume by the dedicated column (existing behaviour).
    return db.attempt.findFirst({
      where: { guestId, status: 'IN_PROGRESS', topicId: scope.scopeId, source: 'BANK' },
      orderBy: { startedAt: 'desc' },
    })
  }
  // Unit/subject/exam diagnostics carry their scope in configJson — prefilter
  // with contains (cheap, indexed-less but bounded), then verify by parsing.
  const candidates = await db.attempt.findMany({
    where: {
      guestId,
      status: 'IN_PROGRESS',
      source: 'BANK',
      AND: [
        { configJson: { contains: `"scopeType":"${scope.scopeType}"` } },
        { configJson: { contains: `"scopeId":"${scope.scopeId}"` } },
      ],
    },
    orderBy: { startedAt: 'desc' },
    take: 3,
  })
  return (
    candidates.find(a => {
      const config = safeParse<DiagnosticConfig | null>(a.configJson, null)
      return isDiagnosticConfig(config) && config.scopeType === scope.scopeType && config.scopeId === scope.scopeId
    }) ?? null
  )
}

export type DiagnosticStartResult =
  | { ok: true; attemptId: string; resumed: boolean; count: number }
  | { ok: false; error: string; status: number }

export async function startDiagnostic(guestId: string, scope: DiagnosticScopeRef): Promise<DiagnosticStartResult> {
  const resolvedScope = await resolveScope(scope)
  if (!resolvedScope.ok) return resolvedScope
  const { label, examId, examLabel, subjectId } = resolvedScope.resolved

  const scopeWhere = questionScopeFilter(scope)
  const available = await db.question.count({ where: { ...scopeWhere, ...SELECTABLE_QUESTION } })
  if (available < DIAGNOSTIC_MIN_BANK) {
    return {
      ok: false,
      error: `A diagnostic needs at least ${DIAGNOSTIC_MIN_BANK} verified questions for ${label} — ${available} available right now.`,
      status: 409,
    }
  }

  // Resume an in-progress diagnostic for the same scope instead of stacking.
  const existing = await findResumableDiagnostic(guestId, scope)
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
    where: { ...scopeWhere, ...SELECTABLE_QUESTION },
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
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    scopeLabel: label,
    ...(scope.scopeType === 'TOPIC' ? { topicId: scope.scopeId } : {}),
  }

  const attempt = await db.attempt.create({
    data: {
      guestId,
      examId,
      title: `Diagnostic — ${label}`,
      examLabel,
      topicId: scope.scopeType === 'TOPIC' ? scope.scopeId : null,
      subjectId,
      configJson: JSON.stringify(config),
      questionIdsJson: JSON.stringify(chosen),
      answersJson: JSON.stringify({}),
      status: 'IN_PROGRESS',
      source: 'BANK',
    },
  })
  return { ok: true, attemptId: attempt.id, resumed: false, count: chosen.length }
}
