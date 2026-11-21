// ─── Day-plan service (Phase 3B) ──────────────────────────────────────────────
// DB orchestration around the pure planner engine. Handles get-or-generate,
// regeneration (PLANNED rows only — completed history is immutable) and the
// task lifecycle actions (complete / skip / defer / reschedule / resize).

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import {
  buildPlanCandidates,
  clampAvailableMinutes,
  fillPlan,
  plannedMinutesOf,
  TASK_MINUTES,
  type PlanCandidate,
} from './planner'
import { dueStateOf } from './revision'
import { claimedStudentIdFor, dateKeyEnd, dateKeyStart, todayKey } from './scope'
import type { DayPlanDTO, PlanTaskDTO, PlanTaskStatus } from './dto'

function taskToDTO(row: {
  id: string
  planDate: string
  kind: string
  title: string
  topicId: string | null
  topicName: string | null
  examLabel: string | null
  estimatedMinutes: number
  priority: number
  rationale: string
  status: string
  completedAt: Date | null
}): PlanTaskDTO {
  return {
    id: row.id,
    planDate: row.planDate,
    kind: row.kind as PlanTaskDTO['kind'],
    title: row.title,
    topicId: row.topicId,
    topicName: row.topicName,
    examLabel: row.examLabel,
    estimatedMinutes: row.estimatedMinutes,
    priority: row.priority,
    rationale: row.rationale,
    status: row.status as PlanTaskStatus,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }
}

const PRIORITY_ORDER = { 1: 0, 2: 1, 3: 2 } as Record<number, number>

function sortTasks<T extends { priority: number; kind: string; createdAt: Date }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 3
    const pb = PRIORITY_ORDER[b.priority] ?? 3
    if (pa !== pb) return pa - pb
    const ra = TASK_MINUTES[a.kind as keyof typeof TASK_MINUTES] ?? 99
    const rb = TASK_MINUTES[b.kind as keyof typeof TASK_MINUTES] ?? 99
    return ra - rb || a.createdAt.getTime() - b.createdAt.getTime()
  })
}

async function availableMinutesFor(guestId: string): Promise<number> {
  // Stated preference when a claimed account carries one; 30 as the honest default.
  const studentId = await claimedStudentIdFor(guestId)
  let raw: number | null = null
  if (studentId) {
    const student = await db.student.findUnique({ where: { id: studentId }, select: { preferencesJson: true } })
    const prefs = safeParse<Record<string, unknown>>(student?.preferencesJson ?? null, {})
    raw = typeof prefs.dailyMinutes === 'number' ? prefs.dailyMinutes : null
  }
  return clampAvailableMinutes(raw ?? 30)
}

async function gatherCandidates(guestId: string, dateKey: string): Promise<PlanCandidate[]> {
  const dayStart = dateKeyStart(dateKey)
  const dayEnd = dateKeyEnd(dateKey)
  const now = new Date()

  const [dueItems, masteryRows, repeatGapCount, inProgressDocs, plannedTasks] = await Promise.all([
    db.revisionScheduleItem.findMany({ where: { guestId, nextDueAt: { lt: dayEnd ?? now } }, take: 20 }),
    db.topicMastery.findMany({ where: { guestId } }),
    db.mistakeRecord.count({ where: { guestId, category: 'REPEAT_GAP' } }),
    db.studyDocument.findMany({
      where: { guestId, status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING', 'NEEDS_OCR'] } },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { id: true, title: true },
    }),
    db.studyPlanTask.findMany({ where: { guestId, planDate: dateKey, status: 'PLANNED' }, select: { topicId: true } }),
  ])

  const dayStartMs = dayStart?.getTime() ?? now.getTime()

  // Goals are account-scoped (studentId) — they participate only after claim.
  const goalStudentId = await claimedStudentIdFor(guestId)
  const goals = goalStudentId
    ? await db.studyGoal.findMany({ where: { studentId: goalStudentId, status: 'ACTIVE' } })
    : []
  const dueRevisions = dueItems
    .filter(i => i.nextDueAt.getTime() < (dayEnd?.getTime() ?? now.getTime()))
    .map(i => {
      const { dueState } = dueStateOf(i, new Date(dayStartMs))
      return {
        topicId: i.topicId,
        topicName: i.topicName,
        examLabel: i.examLabel,
        daysOverdue: dueState === 'OVERDUE' ? Math.max(1, -Math.ceil((i.nextDueAt.getTime() - dayStartMs) / (24 * 3600_000))) : 0,
        lastOutcome: i.lastOutcome,
        misconceptionFlag: i.misconceptionFlag,
      }
    })

  const needsRevision = masteryRows
    .filter(r => r.status === 'NEEDS_REVISION')
    .map(r => ({ topicId: r.topicId, topicName: r.topicName, examLabel: r.examLabel, accuracy: r.accuracy, evidenceQuestions: r.evidenceQuestions, statusReason: r.statusReason }))

  // Diagnostics only for topics that actually have a question bank to probe.
  const insufficientRows = masteryRows.filter(r => r.status === 'INSUFFICIENT_EVIDENCE')
  const insufficient: { topicId: string; topicName: string; examLabel: string | null; evidenceQuestions: number; questionBank: number }[] = []
  for (const r of insufficientRows.slice(0, 12)) {
    const bank = await db.question.count({ where: { topicId: r.topicId, verificationStatus: 'VERIFIED' } })
    if (bank >= 6) {
      insufficient.push({ topicId: r.topicId, topicName: r.topicName, examLabel: r.examLabel, evidenceQuestions: r.evidenceQuestions, questionBank: bank })
    }
  }

  const weakTopics = masteryRows
    .filter(r => r.status === 'LEARNING')
    .map(r => ({ topicId: r.topicId, topicName: r.topicName, examLabel: r.examLabel, accuracy: r.accuracy, evidenceQuestions: r.evidenceQuestions, attemptCount: r.attemptCount }))

  const goalRows = goals.map(g => {
    const daysLeft = g.targetDate ? Math.ceil((g.targetDate.getTime() - dayStartMs) / (24 * 3600_000)) : 365
    return { id: g.id, title: g.title, topicId: g.topicId, topicName: null, daysLeft }
  })
  // Resolve goal topic names in one batch (goals carry plain topicId FKs).
  const goalTopicIds = [...new Set(goals.map(g => g.topicId).filter((v): v is string => !!v))]
  const goalTopics = goalTopicIds.length > 0
    ? await db.topic.findMany({ where: { id: { in: goalTopicIds } }, select: { id: true, name: true } })
    : []
  const goalTopicNames = new Map(goalTopics.map(t => [t.id, t.name]))
  const goalsNearTarget = goalRows
    .filter(g => g.daysLeft <= 14)
    .map(g => ({ ...g, topicName: g.topicId ? goalTopicNames.get(g.topicId) ?? null : null }))

  return buildPlanCandidates({
    dueRevisions,
    needsRevision,
    insufficient,
    weakTopics,
    repeatGapMistakes: repeatGapCount,
    goalsNearTarget,
    inProgressDocs,
    plannedTopicIds: new Set(plannedTasks.map(t => t.topicId).filter((v): v is string => !!v)),
  })
}

export async function getOrCreateDayPlan(guestId: string, dateKey: string, opts?: { regenerate?: boolean }): Promise<DayPlanDTO> {
  const availableMinutes = await availableMinutesFor(guestId)
  const existing = await db.studyPlanTask.findMany({ where: { guestId, planDate: dateKey } })

  if (opts?.regenerate) {
    // History rule: only PLANNED rows are replaced. COMPLETED / SKIPPED /
    // DEFERRED rows for this date are immutable.
    await db.studyPlanTask.deleteMany({ where: { guestId, planDate: dateKey, status: 'PLANNED' } })
  } else if (existing.some(t => t.status === 'PLANNED')) {
    return dayPlanDTO(dateKey, availableMinutes, existing, false)
  } else if (existing.length > 0) {
    // All rows are history (fully completed day) — nothing to regenerate silently.
    return dayPlanDTO(dateKey, availableMinutes, existing, false)
  }

  const candidates = await gatherCandidates(guestId, dateKey)
  const picked = fillPlan(candidates, availableMinutes)
  if (picked.length > 0) {
    await db.studyPlanTask.createMany({
      data: picked.map(c => ({
        guestId,
        planDate: dateKey,
        kind: c.kind,
        title: c.title,
        topicId: c.topicId,
        topicName: c.topicName,
        examLabel: c.examLabel,
        estimatedMinutes: c.estimatedMinutes,
        priority: c.priority,
        rationale: c.rationale,
        evidenceJson: JSON.stringify(c.evidence),
        status: 'PLANNED' as const,
      })),
    })
  }
  const rows = await db.studyPlanTask.findMany({ where: { guestId, planDate: dateKey } })
  return dayPlanDTO(dateKey, availableMinutes, rows, true)
}

function dayPlanDTO(dateKey: string, availableMinutes: number, rows: {
  id: string
  planDate: string
  kind: string
  title: string
  topicId: string | null
  topicName: string | null
  examLabel: string | null
  estimatedMinutes: number
  priority: number
  rationale: string
  status: string
  completedAt: Date | null
  createdAt: Date
}[], generated: boolean): DayPlanDTO {
  const planned = sortTasks(rows.filter(r => r.status === 'PLANNED')).map(taskToDTO)
  const history = rows
    .filter(r => r.status !== 'PLANNED')
    .sort((a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime())
    .map(taskToDTO)
  return {
    date: dateKey,
    generated,
    availableMinutes,
    plannedMinutes: planned.reduce((s, t) => s + t.estimatedMinutes, 0),
    completedMinutes: rows.filter(r => r.status === 'COMPLETED').reduce((s, t) => s + t.estimatedMinutes, 0),
    tasks: planned,
    history,
  }
}

export type TaskAction = 'COMPLETE' | 'SKIP' | 'DEFER' | 'RESCHEDULE' | 'RESIZE'

export interface TaskActionResult {
  ok: boolean
  error?: string
  status?: number
  task?: PlanTaskDTO
}

/** Apply a lifecycle action. PLANNED-only mutations; completed history is immutable. */
export async function applyTaskAction(
  guestId: string,
  taskId: string,
  action: TaskAction,
  payload: { date?: string; minutes?: number },
): Promise<TaskActionResult> {
  const task = await db.studyPlanTask.findUnique({ where: { id: taskId } })
  if (!task || task.guestId !== guestId) return { ok: false, error: 'Plan task not found', status: 404 }
  if (task.status !== 'PLANNED') {
    return { ok: false, error: 'Completed, skipped and deferred activities are history and cannot be rewritten.', status: 409 }
  }

  if (action === 'COMPLETE') {
    const updated = await db.studyPlanTask.update({ where: { id: task.id }, data: { status: 'COMPLETED', completedAt: new Date() } })
    return { ok: true, task: taskToDTO(updated) }
  }
  if (action === 'SKIP') {
    const updated = await db.studyPlanTask.update({ where: { id: task.id }, data: { status: 'SKIPPED' } })
    return { ok: true, task: taskToDTO(updated) }
  }
  if (action === 'DEFER') {
    const updated = await db.studyPlanTask.update({ where: { id: task.id }, data: { status: 'DEFERRED' } })
    return { ok: true, task: taskToDTO(updated) }
  }
  if (action === 'RESCHEDULE') {
    if (!payload.date || !dateKeyStart(payload.date)) {
      return { ok: false, error: 'A valid target date (YYYY-MM-DD) is required to reschedule.', status: 400 }
    }
    const updated = await db.studyPlanTask.update({ where: { id: task.id }, data: { planDate: payload.date } })
    return { ok: true, task: taskToDTO(updated) }
  }
  // RESIZE
  const minutes = Math.round(payload.minutes ?? 0)
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) {
    return { ok: false, error: 'Estimated minutes must be between 5 and 180.', status: 400 }
  }
  const updated = await db.studyPlanTask.update({ where: { id: task.id }, data: { estimatedMinutes: minutes } })
  return { ok: true, task: taskToDTO(updated) }
}

export function currentPlanDate(): string {
  return todayKey()
}
