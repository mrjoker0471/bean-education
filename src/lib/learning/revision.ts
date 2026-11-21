// ─── Spaced revision engine (Phase 3B) ────────────────────────────────────────
// A deterministic SM-2-inspired interval ladder. This is a practical
// scheduling heuristic — it is NOT a scientific model of memory and nothing
// in the product claims otherwise (docs/PHASE3B_PERSONAL_LEARNING_INTELLIGENCE.md).
//
// Documented rules:
//   • ladder            — [1, 3, 7, 14, 30, 60] days indexed by repetition count
//   • SUCCESS (≥80%)    — repetitions + 1, interval = ladder[min(rep, 5)],
//                         next due = now + interval (longer each time)
//   • PARTIAL (60-79%)  — interval unchanged, next due = now +
//                         max(2, ceil(interval/2)) — sooner than a full success
//   • FAILURE (<60%)    — repetitions reset, lapses + 1, interval = 1 day,
//                         next due = now + 1 day (back to the start)
//   • misconception     — a grounded Riishe explanation flagging a misconception
//                         (or a repeated same-question miss) pulls the next due
//                         date to at most +1 day until a SUCCESS clears it
//   • first evidence    — a topic's first real evidence creates a schedule with
//                         a 1-day interval (revise tomorrow)
//   • overdue topics    — surface in the day plan and next-best actions;
//                         one schedule row per (owner, topic) prevents duplicates

import { db } from '@/lib/db'

export const REVISION_LADDER = [1, 3, 7, 14, 30, 60] as const
export const MISCONCEPTION_PULL_DAYS = 1

export type RevisionOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILURE'

export function outcomeFromAccuracy(accuracy: number): RevisionOutcome {
  if (accuracy >= 80) return 'SUCCESS'
  if (accuracy >= 60) return 'PARTIAL'
  return 'FAILURE'
}

export interface ScheduleState {
  intervalDays: number
  repetitions: number
  lapses: number
}

export interface ScheduleNext extends ScheduleState {
  nextDueAt: Date
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 3600_000)
}

/** Pure ladder movement — fully unit-tested. */
export function nextSchedule(current: ScheduleState, outcome: RevisionOutcome, now: Date): ScheduleNext {
  if (outcome === 'SUCCESS') {
    const repetitions = current.repetitions + 1
    const intervalDays = REVISION_LADDER[Math.min(repetitions, REVISION_LADDER.length - 1)]
    return { intervalDays, repetitions, lapses: current.lapses, nextDueAt: addDays(now, intervalDays) }
  }
  if (outcome === 'PARTIAL') {
    const intervalDays = Math.max(current.intervalDays, 1)
    const step = Math.max(2, Math.ceil(intervalDays / 2))
    return { intervalDays, repetitions: current.repetitions, lapses: current.lapses, nextDueAt: addDays(now, step) }
  }
  // FAILURE
  return { intervalDays: 1, repetitions: 0, lapses: current.lapses + 1, nextDueAt: addDays(now, 1) }
}

function pullInForMisconception(next: ScheduleNext, now: Date, misconception: boolean): ScheduleNext {
  if (!misconception) return next
  const earliest = addDays(now, MISCONCEPTION_PULL_DAYS)
  return next.nextDueAt > earliest ? { ...next, nextDueAt: earliest } : next
}

export interface RevisionOutcomeInput {
  guestId: string
  topicId: string
  topicName: string
  examLabel: string | null
  /** Topic accuracy (0-100) of the attempt that triggered this update. */
  accuracy: number
  answeredCount: number
  attemptedAt: Date
  misconception: boolean
}

/**
 * Create or move the schedule row for one topic after a real attempt outcome.
 * A single-schedule-row-per-topic invariant prevents duplicate revision tasks.
 */
export async function applyRevisionOutcome(input: RevisionOutcomeInput): Promise<'CREATED' | 'UPDATED' | 'SKIPPED'> {
  // With almost no answered questions the outcome is noise — don't move the ladder.
  if (input.answeredCount <= 0) return 'SKIPPED'

  const outcome = outcomeFromAccuracy(input.accuracy)
  const existing = await db.revisionScheduleItem.findUnique({
    where: { guestId_topicId: { guestId: input.guestId, topicId: input.topicId } },
  })

  if (!existing) {
    // First evidence — schedule the first revision for tomorrow (or sooner on a
    // misconception signal so the gap is closed while it is fresh).
    const now = input.attemptedAt
    const base: ScheduleNext = { intervalDays: 1, repetitions: 0, lapses: 0, nextDueAt: addDays(now, 1) }
    const next = pullInForMisconception(base, now, input.misconception)
    await db.revisionScheduleItem.create({
      data: {
        guestId: input.guestId,
        topicId: input.topicId,
        topicName: input.topicName,
        examLabel: input.examLabel,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        lastOutcome: outcome,
        lastReviewedAt: input.attemptedAt,
        nextDueAt: next.nextDueAt,
        misconceptionFlag: input.misconception,
      },
    })
    return 'CREATED'
  }

  const now = input.attemptedAt
  const moved = nextSchedule(
    { intervalDays: existing.intervalDays, repetitions: existing.repetitions, lapses: existing.lapses },
    outcome,
    now,
  )
  const misconceptionFlag = input.misconception ? true : outcome === 'SUCCESS' ? false : existing.misconceptionFlag
  const next = pullInForMisconception(moved, now, input.misconception)
  await db.revisionScheduleItem.update({
    where: { id: existing.id },
    data: {
      topicName: input.topicName,
      examLabel: input.examLabel,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      lapses: next.lapses,
      lastOutcome: outcome,
      lastReviewedAt: input.attemptedAt,
      nextDueAt: next.nextDueAt,
      misconceptionFlag,
    },
  })
  return 'UPDATED'
}

export interface RevisionItemLike {
  topicId: string
  topicName: string
  examLabel: string | null
  intervalDays: number
  repetitions: number
  lapses: number
  lastOutcome: string | null
  lastReviewedAt: Date | null
  nextDueAt: Date
  misconceptionFlag: boolean
}

/** Pure due-state classification (shared by the API and the planner). */
export function dueStateOf(item: RevisionItemLike, now: Date): { dueState: 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING'; daysUntilDue: number } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const due = item.nextDueAt.getTime()
  const days = Math.ceil((due - startOfToday) / (24 * 3600_000))
  if (due < startOfToday) return { dueState: 'OVERDUE', daysUntilDue: days }
  if (due < startOfToday + 24 * 3600_000) return { dueState: 'DUE_TODAY', daysUntilDue: 0 }
  return { dueState: 'UPCOMING', daysUntilDue: days }
}
