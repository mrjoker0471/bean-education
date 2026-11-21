// GET /api/learning/overview — single aggregate powering the personal learning
// intelligence surfaces (Phase 3B): mastery summary, today's plan, revision
// due state, top next-best actions, diagnostic suggestions and honest
// stated-vs-observed insights. Guest-scoped via the app-wide guestId param
// convention; every section is an honest empty state when there is no data.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guestIdFromQuery } from '@/lib/learning/scope'
import { masteryRowToDTO, summarizeMastery, sortMasteryRows } from '@/lib/learning/mastery'
import { getOrCreateDayPlan, currentPlanDate } from '@/lib/learning/plan-service'
import { buildVisibleActions } from '@/lib/learning/actions-service'
import { buildInsights } from '@/lib/learning/insights'
import { dueStateOf } from '@/lib/learning/revision'
import type { LearningOverviewDTO, RevisionItemDTO, TopicMasteryDTO } from '@/lib/learning/dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guestId = guestIdFromQuery(req)
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const now = new Date()

    // Sequential by design: the plan (which may be generated now) must exist
    // before actions are computed, or the PLAN_TODAY check races the creation.
    const masteryRows = await db.topicMastery.findMany({ where: { guestId } })
    const anyLearningRow = await db.topicMastery.findFirst({ where: { guestId }, select: { studentId: true } })
    const plan = await getOrCreateDayPlan(guestId, currentPlanDate())
    const actionsResult = await buildVisibleActions(guestId, now)

    const masteryDTOs: TopicMasteryDTO[] = masteryRows.map(masteryRowToDTO)
    const summary = summarizeMastery(masteryDTOs)

    // Revision due state (from the schedule table — a small read).
    const scheduleItems = await db.revisionScheduleItem.findMany({
      where: { guestId },
      orderBy: { nextDueAt: 'asc' },
      take: 60,
    })
    const revisionDTOs: RevisionItemDTO[] = scheduleItems.map(item => {
      const { dueState, daysUntilDue } = dueStateOf(item, now)
      return {
        topicId: item.topicId,
        topicName: item.topicName,
        examLabel: item.examLabel,
        intervalDays: item.intervalDays,
        repetitions: item.repetitions,
        lapses: item.lapses,
        lastOutcome: (item.lastOutcome as RevisionItemDTO['lastOutcome']) ?? null,
        lastReviewedAt: item.lastReviewedAt ? item.lastReviewedAt.toISOString() : null,
        nextDueAt: item.nextDueAt.toISOString(),
        dueState,
        daysUntilDue,
        misconceptionFlag: item.misconceptionFlag,
      }
    })
    const dueRevision = revisionDTOs.filter(r => r.dueState !== 'UPCOMING')

    // Diagnostic suggestions: insufficient-evidence topics with a real bank.
    const diagnostics: LearningOverviewDTO['diagnostics']['availableTopics'] = []
    for (const row of sortMasteryRows(masteryDTOs).filter(r => r.status === 'INSUFFICIENT_EVIDENCE').slice(0, 6)) {
      const bank = await db.question.count({ where: { topicId: row.topicId, verificationStatus: 'VERIFIED' } })
      if (bank >= 6) diagnostics.push({ topicId: row.topicId, topicName: row.topicName, examLabel: row.examLabel, questionBank: bank })
      if (diagnostics.length >= 5) break
    }

    const insights = await buildInsights({ guestId, studentId: anyLearningRow?.studentId ?? null })

    const dto: LearningOverviewDTO = {
      mastery: summary,
      plan: {
        date: plan.date,
        availableMinutes: plan.availableMinutes,
        plannedMinutes: plan.plannedMinutes,
        completedMinutes: plan.completedMinutes,
        openTasks: plan.tasks.length,
        completedToday: plan.history.filter(h => h.status === 'COMPLETED').length,
        tasks: plan.tasks.slice(0, 6),
      },
      revision: {
        dueCount: dueRevision.length,
        overdueCount: dueRevision.filter(r => r.dueState === 'OVERDUE').length,
        next: dueRevision.slice(0, 3),
      },
      actions: actionsResult.actions.map(a => ({
        actionKey: a.actionKey,
        type: a.type,
        title: a.title,
        reason: a.reason,
        topicId: a.topicId,
        href: a.href,
        priority: a.priority,
      })),
      diagnostics: { availableTopics: diagnostics },
      insights,
      generatedAt: now.toISOString(),
    }
    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/learning/overview]', err)
    return NextResponse.json({ error: 'Failed to load your learning overview' }, { status: 500 })
  }
}
