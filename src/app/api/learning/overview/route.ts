// GET /api/learning/overview — single aggregate powering the personal learning
// intelligence surfaces (Phase 3B): mastery summary, today's plan, revision
// due state, top next-best actions, diagnostic suggestions and honest
// stated-vs-observed insights. Guest-scoped via the app-wide guestId param
// convention; every section is an honest empty state when there is no data.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guestIdFromQuery, resolveLearnerTimezone, assertLearningOwner } from '@/lib/learning/scope'
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
    const owner = await assertLearningOwner(guestId)
    if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

    // Learner timezone: the client's IANA zone when it passes one, else the
    // documented product default — never the server container's zone.
    const tz = resolveLearnerTimezone(new URL(req.url).searchParams.get('tz'))
    const now = new Date()

    // Sequential by design: the plan (which may be generated now) must exist
    // before actions are computed, or the PLAN_TODAY check races the creation.
    const masteryRows = await db.topicMastery.findMany({ where: { guestId } })
    const anyLearningRow = await db.topicMastery.findFirst({ where: { guestId }, select: { studentId: true } })
    const plan = await getOrCreateDayPlan(guestId, currentPlanDate(tz), { tz })
    const actionsResult = await buildVisibleActions(guestId, now, tz)

    const masteryDTOs: TopicMasteryDTO[] = masteryRows.map(masteryRowToDTO)
    const summary = summarizeMastery(masteryDTOs)

    // Revision due state (from the schedule table — a small read).
    const scheduleItems = await db.revisionScheduleItem.findMany({
      where: { guestId },
      orderBy: { nextDueAt: 'asc' },
      take: 60,
    })
    const revisionDTOs: RevisionItemDTO[] = scheduleItems.map(item => {
      const { dueState, daysUntilDue } = dueStateOf(item, now, tz)
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

    // Broader baseline scopes (unit / subject / exam) derived from the SAME
    // thin-evidence topics — offered only where the verified bank actually
    // supports them, capped like the topic list. Scope selection goes through
    // the topic relation, so every suggested scope probes real topics.
    const broaderScopes: LearningOverviewDTO['diagnostics']['broaderScopes'] = []
    const thinTopicIds = masteryDTOs.filter(r => r.status === 'INSUFFICIENT_EVIDENCE').map(r => r.topicId)
    if (thinTopicIds.length > 0) {
      const thinTopics = await db.topic.findMany({
        where: { id: { in: thinTopicIds } },
        select: {
          unit: {
            select: {
              id: true, name: true,
              subject: {
                select: {
                  id: true, name: true,
                  stage: { select: { exam: { select: { id: true, shortName: true, name: true } } } },
                },
              },
            },
          },
        },
      })
      const seen = new Set<string>()
      const offer = (scopeType: 'UNIT' | 'SUBJECT' | 'EXAM', scopeId: string, label: string, examLabel: string | null, filter: Record<string, unknown>) => {
        const key = `${scopeType}:${scopeId}`
        if (seen.has(key) || broaderScopes.length >= 5) return
        seen.add(key)
        const bank = db.question.count({ where: { ...filter, verificationStatus: 'VERIFIED' } })
        pending.push({ scopeType, scopeId, label, examLabel, bank })
      }
      const pending: { scopeType: 'UNIT' | 'SUBJECT' | 'EXAM'; scopeId: string; label: string; examLabel: string | null; bank: Promise<number> }[] = []
      for (const t of thinTopics) {
        const { unit, subject, exam } = {
          unit: t.unit,
          subject: t.unit.subject,
          exam: t.unit.subject.stage.exam,
        }
        offer('UNIT', unit.id, `${unit.name} (unit)`, exam.shortName ?? exam.name, { topic: { unitId: unit.id } })
        offer('SUBJECT', subject.id, `${subject.name} (subject)`, exam.shortName ?? exam.name, { topic: { unit: { subjectId: subject.id } } })
        offer('EXAM', exam.id, `${exam.shortName ?? exam.name} (full syllabus)`, exam.shortName ?? exam.name, { topic: { unit: { subject: { stage: { examId: exam.id } } } } })
        if (pending.length >= 12) break // bounded: stop offering once enough candidates queued
      }
      const banks = await Promise.all(pending.map(p => p.bank))
      for (const [p, bank] of pending.map((p, i) => [p, banks[i]] as const)) {
        if (bank >= 6 && broaderScopes.length < 5) {
          broaderScopes.push({ scopeType: p.scopeType, scopeId: p.scopeId, label: p.label, examLabel: p.examLabel, questionBank: bank })
        }
      }
    }

    const insights = await buildInsights({ guestId, studentId: anyLearningRow?.studentId ?? null, tz })

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
      diagnostics: { availableTopics: diagnostics, broaderScopes },
      insights,
      generatedAt: now.toISOString(),
    }
    return NextResponse.json(dto)
  } catch (err) {
    console.error('[api/learning/overview]', err)
    return NextResponse.json({ error: 'Failed to load your learning overview' }, { status: 500 })
  }
}
