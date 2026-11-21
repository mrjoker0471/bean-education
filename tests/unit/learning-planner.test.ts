import { describe, it, expect, mock } from 'bun:test'

// ─── Planner candidates + capacity fill (Phase 3B, pure) ──────────────────────
// Priority order, per-topic dedupe, per-day caps and honest capacity fill.

mock.module('@/lib/db', () => ({ db: {} }))

import { buildPlanCandidates, fillPlan, plannedMinutesOf, clampAvailableMinutes, TASK_MINUTES, type PlannerInputs } from '@/lib/learning/planner'

function inputs(over: Partial<PlannerInputs> = {}): PlannerInputs {
  return {
    dueRevisions: [],
    needsRevision: [],
    insufficient: [],
    weakTopics: [],
    repeatGapMistakes: 0,
    goalsNearTarget: [],
    inProgressDocs: [],
    plannedTopicIds: new Set<string>(),
    ...over,
  }
}

describe('buildPlanCandidates — documented priority order', () => {
  it('due revisions come first as priority 1', () => {
    const c = buildPlanCandidates(inputs({
      dueRevisions: [{ topicId: 't1', topicName: 'Gravitation', examLabel: 'JEE', daysOverdue: 2, lastOutcome: 'FAILURE', misconceptionFlag: false }],
    }))
    expect(c[0].kind).toBe('REVISE_TOPIC')
    expect(c[0].priority).toBe(1)
    expect(c[0].rationale).toContain('overdue')
  })

  it('NEEDS_REVISION topics are priority 1 practice', () => {
    const c = buildPlanCandidates(inputs({
      needsRevision: [{ topicId: 't2', topicName: 'Thermodynamics', examLabel: null, accuracy: 55, evidenceQuestions: 9, statusReason: 'latest attempt scored 40%' }],
    }))
    expect(c[0].kind).toBe('PRACTICE_TOPIC')
    expect(c[0].priority).toBe(1)
    expect(c[0].title).toContain('Rebuild')
  })

  it('diagnostics cap at one per day and cite the evidence', () => {
    const c = buildPlanCandidates(inputs({
      insufficient: [
        { topicId: 't3', topicName: 'Optics', examLabel: null, evidenceQuestions: 2, questionBank: 20 },
        { topicId: 't4', topicName: 'Waves', examLabel: null, evidenceQuestions: 1, questionBank: 15 },
      ],
    }))
    const diags = c.filter(x => x.kind === 'DIAGNOSTIC')
    expect(diags.length).toBe(1)
    expect(diags[0].priority).toBe(2)
    expect(diags[0].rationale).toContain('Only 2 distinct questions')
  })

  it('weak topics order by lowest accuracy and cite real numbers', () => {
    const c = buildPlanCandidates(inputs({
      weakTopics: [
        { topicId: 't5', topicName: 'A', examLabel: null, accuracy: 40, evidenceQuestions: 8, attemptCount: 3 },
        { topicId: 't6', topicName: 'B', examLabel: null, accuracy: 30, evidenceQuestions: 6, attemptCount: 2 },
      ],
    }))
    const weak = c.filter(x => x.kind === 'PRACTICE_TOPIC' && x.priority === 2)
    expect(weak[0].topicId).toBe('t6') // 30% first
    expect(weak[0].rationale).toContain('30% over 6 distinct questions')
  })

  it('mistake review and goal work appear with citations', () => {
    const c = buildPlanCandidates(inputs({
      repeatGapMistakes: 3,
      goalsNearTarget: [{ id: 'g1', title: 'Finish mechanics', topicId: 't7', topicName: 'Kinematics', daysLeft: 5 }],
    }))
    const mistake = c.find(x => x.kind === 'REVIEW_MISTAKES')!
    expect(mistake.rationale).toContain('3 repeat-gap mistakes')
    const goal = c.find(x => x.kind === 'GOAL_WORK')!
    expect(goal.rationale).toContain('due in 5 days')
  })

  it('a topic already planned today is never duplicated', () => {
    const c = buildPlanCandidates(inputs({
      dueRevisions: [{ topicId: 't1', topicName: 'X', examLabel: null, daysOverdue: 0, lastOutcome: null, misconceptionFlag: false }],
      weakTopics: [{ topicId: 't1', topicName: 'X', examLabel: null, accuracy: 50, evidenceQuestions: 6, attemptCount: 2 }],
      plannedTopicIds: new Set(['t1']),
    }))
    expect(c.length).toBe(0)
  })

  it('capacity fill never exceeds the available minutes', () => {
    const c = buildPlanCandidates(inputs({
      dueRevisions: [{ topicId: 't1', topicName: 'A', examLabel: null, daysOverdue: 0, lastOutcome: null, misconceptionFlag: false }],
      needsRevision: [{ topicId: 't2', topicName: 'B', examLabel: null, accuracy: 40, evidenceQuestions: 9, statusReason: null }],
      weakTopics: [{ topicId: 't3', topicName: 'C', examLabel: null, accuracy: 50, evidenceQuestions: 6, attemptCount: 2 }],
    }))
    const picked = fillPlan(c, 35)
    expect(plannedMinutesOf(picked)).toBeLessThanOrEqual(35)
    expect(picked.length).toBe(2) // 10 + 20 = 30 fits, the third (20) does not
    expect(clampAvailableMinutes(null)).toBe(15)
    expect(clampAvailableMinutes(500)).toBe(180)
    expect(clampAvailableMinutes(45)).toBe(45)
    expect(TASK_MINUTES.REVISE_TOPIC).toBe(10)
  })
})
