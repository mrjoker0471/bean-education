// ─── Next-best-actions service (Phase 3B) ────────────────────────────────────
// DB orchestration around the pure ranking engine: gathers real evidence,
// builds candidates with evidence-cited reasons, applies lifecycle rows and
// outcome boosts, and records decisions (dismiss / snooze / complete).

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { dateKeyOf, claimedStudentIdFor, PRODUCT_TIMEZONE } from './scope'
import {
  actionKeys,
  computeOutcomeBoost,
  rankActions,
  type ActionCandidate,
  type ActionLifecycle,
  type ActionOutcomeRecord,
  type RankedAction,
} from './actions'
import { dueStateOf } from './revision'

export interface VisibleActions {
  actions: RankedAction[]
  note: string
}

const ACTIONS_NOTE =
  'Every suggestion is computed from your own records with a fixed, documented priority rule — no randomness, no urgency theatre, and nothing here is a paid API decision.'

export async function buildVisibleActions(guestId: string, now = new Date(), tz: string = PRODUCT_TIMEZONE): Promise<VisibleActions> {
  // Goals are account-scoped (studentId) — they participate only after claim.
  const actionGoalStudentId = await claimedStudentIdFor(guestId)
  const [dueItems, masteryRows, repeatMistakes, inProgressDocs, planToday, lifecycleRows, outcomeRows, attempts, goals] =
    await Promise.all([
      db.revisionScheduleItem.findMany({ where: { guestId }, take: 50 }),
      db.topicMastery.findMany({ where: { guestId } }),
      db.mistakeRecord.findMany({ where: { guestId, category: 'REPEAT_GAP' }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, createdAt: true } }),
      db.studyDocument.findMany({
        where: { guestId, status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING', 'NEEDS_OCR'] } },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { id: true, title: true },
      }),
      db.studyPlanTask.findFirst({ where: { guestId, planDate: dateKeyOf(now, tz) }, select: { id: true } }),
      db.learningAction.findMany({ where: { guestId } }),
      db.learningAction.findMany({ where: { guestId, status: 'COMPLETED' }, orderBy: { resolvedAt: 'desc' }, take: 50 }),
      db.attempt.findMany({
        where: { guestId, status: { in: ['SUBMITTED', 'TIMED_OUT'] } },
        orderBy: { submittedAt: 'desc' },
        take: 100,
        select: { perTopicJson: true, submittedAt: true, startedAt: true },
      }),
      actionGoalStudentId
        ? db.studyGoal.findMany({ where: { studentId: actionGoalStudentId, status: 'ACTIVE' } })
        : Promise.resolve([]),
    ])

  // ── Evidence state ──
  const topicLastActivity = new Map<string, Date>()
  const currentTopicAccuracy = new Map<string, number>()
  for (const m of masteryRows) {
    currentTopicAccuracy.set(m.topicId, m.accuracy)
    if (m.lastActivityAt) topicLastActivity.set(m.topicId, m.lastActivityAt)
  }
  const lastMistakeAt = repeatMistakes[0]?.createdAt ?? null

  // ── Candidates ──
  const candidates: ActionCandidate[] = []

  for (const item of dueItems) {
    const { dueState, daysUntilDue } = dueStateOf(item, now, tz)
    if (dueState === 'UPCOMING') continue
    const overdueDays = dueState === 'OVERDUE' ? Math.max(1, -daysUntilDue) : 0
    candidates.push({
      actionKey: actionKeys.reviewDue(item.topicId),
      type: 'REVIEW_DUE',
      title: `Revise ${item.topicName}`,
      reason:
        dueState === 'OVERDUE'
          ? `Scheduled revision is ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue (last outcome: ${item.lastOutcome ?? 'not scored'}).`
          : 'Scheduled revision is due today — the interval comes from your own last result on this topic.',
      topicId: item.topicId,
      href: '#/learning',
      urgency: overdueDays,
    })
  }

  for (const m of masteryRows.filter(r => r.status === 'NEEDS_REVISION').slice(0, 3)) {
    candidates.push({
      actionKey: actionKeys.needsRevision(m.topicId),
      type: 'NEEDS_REVISION_PRACTICE',
      title: `Rebuild ${m.topicName}`,
      reason: m.statusReason ?? `Your latest attempt here fell below 60% (evidence: ${m.evidenceQuestions} distinct questions).`,
      topicId: m.topicId,
      href: `#/topic/${m.topicId}`,
      urgency: 0,
    })
  }

  for (const m of masteryRows.filter(r => r.status === 'LEARNING').slice(0, 3)) {
    candidates.push({
      actionKey: actionKeys.weakTopic(m.topicId),
      type: 'WEAK_TOPIC_PRACTICE',
      title: `Practice ${m.topicName}`,
      reason: `${m.accuracy}% over ${m.evidenceQuestions} distinct questions across ${m.attemptCount} attempt${m.attemptCount === 1 ? '' : 's'} — targeted practice moves this fastest.`,
      topicId: m.topicId,
      href: `#/topic/${m.topicId}`,
      urgency: 0,
    })
  }

  const diagTopic = masteryRows.find(r => r.status === 'INSUFFICIENT_EVIDENCE')
  if (diagTopic) {
    const bank = await db.question.count({ where: { topicId: diagTopic.topicId, verificationStatus: 'VERIFIED' } })
    if (bank >= 6) {
      candidates.push({
        actionKey: actionKeys.diagnostic(diagTopic.topicId),
        type: 'DIAGNOSTIC',
        title: `Diagnose ${diagTopic.topicName}`,
        reason: `Only ${diagTopic.evidenceQuestions} distinct question${diagTopic.evidenceQuestions === 1 ? '' : 's'} answered so far — a short diagnostic gives this topic a reliable baseline.`,
        topicId: diagTopic.topicId,
        href: '#/learning',
        urgency: 0,
      })
    }
  }

  if (repeatMistakes.length > 0) {
    candidates.push({
      actionKey: actionKeys.reviewMistakes(),
      type: 'REVIEW_MISTAKES',
      title: 'Review your repeat mistakes',
      reason: `${repeatMistakes.length} question${repeatMistakes.length === 1 ? '' : 's'} you have missed more than once — worth ten focused minutes.`,
      topicId: null,
      href: '#/learning',
      urgency: repeatMistakes.length,
    })
  }

  const nearGoal = goals
    .map(g => ({ g, daysLeft: g.targetDate ? Math.ceil((g.targetDate.getTime() - now.getTime()) / (24 * 3600_000)) : 365 }))
    .filter(x => x.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft)[0]
  if (nearGoal) {
    candidates.push({
      actionKey: actionKeys.goalWork(nearGoal.g.id),
      type: 'GOAL_WORK',
      title: `Work toward ${nearGoal.g.title}`,
      reason:
        nearGoal.daysLeft >= 0
          ? `Your goal is due in ${nearGoal.daysLeft} day${nearGoal.daysLeft === 1 ? '' : 's'} — today's plan has a slot for it.`
          : `Your goal passed its target date ${-nearGoal.daysLeft} day${nearGoal.daysLeft === 1 ? '' : 's'} ago — revisit or set a new date.`,
      topicId: nearGoal.g.topicId,
      href: '#/goals',
      urgency: 0,
    })
  }

  if (!planToday) {
    // Honest rule: suggest generating a plan only when there is real evidence
    // to plan from — a fresh guest with zero records gets an honest empty
    // state instead of an invented "plan your day" nudge.
    const hasEvidence = dueItems.length > 0 || masteryRows.length > 0 || repeatMistakes.length > 0 || goals.length > 0
    if (hasEvidence) {
      candidates.push({
        actionKey: actionKeys.planToday(),
        type: 'PLAN_TODAY',
        title: 'Generate today’s plan',
        reason: 'No plan exists for today yet — the planner fits your revision, weak topics and goals into your available minutes.',
        topicId: null,
        href: '#/learning',
        urgency: 0,
      })
    }
  }

  if (inProgressDocs.length > 0) {
    candidates.push({
      actionKey: actionKeys.continueDoc(inProgressDocs[0].id),
      type: 'CONTINUE_DOC',
      title: `Check on “${inProgressDocs[0].title}”`,
      reason: 'This material is still being processed — once ready it feeds topics, notes and practice sets.',
      topicId: null,
      href: `#/riishe/${inProgressDocs[0].id}`,
      urgency: 0,
    })
  }

  // ── Lifecycle + outcome boost ──
  const lifecycle = new Map<string, ActionLifecycle>(
    lifecycleRows.map(r => [r.actionKey, { actionKey: r.actionKey, status: r.status, snoozedUntil: r.snoozedUntil, resolvedAt: r.resolvedAt }]),
  )
  const outcomes: ActionOutcomeRecord[] = outcomeRows.map(r => {
    const snap = safeParse<{ accuracySnapshot?: number | null }>(r.outcomeJson ?? '{}', {})
    return {
      type: r.type,
      topicId: r.topicId,
      accuracySnapshot: typeof snap.accuracySnapshot === 'number' ? snap.accuracySnapshot : null,
      resolvedAt: r.resolvedAt ?? r.updatedAt,
    }
  })
  const outcomeBoost = computeOutcomeBoost(outcomes, currentTopicAccuracy)

  const ranked = rankActions(candidates, {
    now,
    lifecycle,
    outcomeBoost,
    evidence: { topicLastActivity, lastMistakeAt },
  })
  return { actions: ranked, note: ACTIONS_NOTE }
}

export type ActionDecision = 'DISMISS' | 'SNOOZE' | 'COMPLETE'

export interface ActionDecisionResult {
  ok: boolean
  error?: string
  status?: number
}

/**
 * Record a decision on a stable action key. The title/reason snapshot is taken
 * from the current computed evidence so the history rows stay readable.
 */
export async function applyActionDecision(
  guestId: string,
  actionKey: string,
  decision: ActionDecision,
  opts: { snoozeDays?: number; accuracySnapshot?: number | null; title?: string; reason?: string; type?: string; topicId?: string | null; href?: string } = {},
): Promise<ActionDecisionResult> {
  // Stable keys look like TYPE:<cuid|open> — anything else is rejected.
  if (!/^[A-Z_]+:(open|[A-Za-z0-9_-]{3,64})$/.test(actionKey)) {
    return { ok: false, error: 'Unknown action key.', status: 400 }
  }

  const now = new Date()
  const base = {
    type: opts.type ?? 'CONTINUE_DOC',
    title: opts.title ?? 'Suggested next step',
    reason: opts.reason ?? '',
    topicId: opts.topicId ?? null,
    href: opts.href ?? '#/learning',
  }

  if (decision === 'SNOOZE') {
    const days = Math.min(14, Math.max(1, Math.round(opts.snoozeDays ?? 1)))
    const snoozedUntil = new Date(now.getTime() + days * 24 * 3600_000)
    await db.learningAction.upsert({
      where: { guestId_actionKey: { guestId, actionKey } },
      create: { guestId, actionKey, ...base, priority: 0, status: 'SNOOZED', snoozedUntil, resolvedAt: now },
      update: { status: 'SNOOZED', snoozedUntil, resolvedAt: now },
    })
    return { ok: true }
  }

  if (decision === 'DISMISS') {
    await db.learningAction.upsert({
      where: { guestId_actionKey: { guestId, actionKey } },
      create: { guestId, actionKey, ...base, priority: 0, status: 'DISMISSED', resolvedAt: now },
      update: { status: 'DISMISSED', snoozedUntil: null, resolvedAt: now },
    })
    return { ok: true }
  }

  // COMPLETE — capture what the evidence looked like at completion so the
  // ranking can later tell whether completing this type of action helped.
  const outcomeJson = JSON.stringify({ accuracySnapshot: opts.accuracySnapshot ?? null, completedAt: now.toISOString() })
  await db.learningAction.upsert({
    where: { guestId_actionKey: { guestId, actionKey } },
    create: { guestId, actionKey, ...base, priority: 0, status: 'COMPLETED', resolvedAt: now, outcomeJson },
    update: { status: 'COMPLETED', resolvedAt: now, outcomeJson, snoozedUntil: null },
  })
  return { ok: true }
}
