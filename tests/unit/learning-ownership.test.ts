import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

// ─── Ownership & privacy for /api/learning/* (Phase 3B release review) ────────
// The learning API is guest-first: the guestId is an opaque bearer identifier
// (documented product contract — the same model as /api/progress and
// /api/attempts). These tests prove the claim-model layer that sits on top of
// it: when a SIGNED-IN session exists, a guest identity CLAIMED by a different
// account is rejected (403) on every learning route — including reads — while
// unclaimed guests keep working (guest mode) and the claimant keeps access.
// No client-supplied studentId exists in any learning request schema.

const state = {
  sessionStudent: null as { id: string } | null,
  attempts: [] as Record<string, unknown>[],
  mastery: [] as Record<string, unknown>[],
  planTasks: [] as Record<string, unknown>[],
  revision: [] as Record<string, unknown>[],
  mistakes: [] as Record<string, unknown>[],
  actions: [] as Record<string, unknown>[],
  questions: [] as Record<string, unknown>[],
  topics: [] as Record<string, unknown>[],
}

function resetState() {
  state.sessionStudent = null
  state.attempts = []
  state.mastery = []
  state.planTasks = []
  state.revision = []
  state.mistakes = []
  state.actions = []
  state.questions = []
  state.topics = [{ id: 'topic-1', name: 'Kinematics', unit: { subject: { id: 'subj-1', stage: { exam: { id: 'exam-1', shortName: 'JEE', name: 'JEE Main' } } } } }]
  // A claimed guest identity: its most recent attempt carries the claimant's studentId.
  state.attempts.push({ id: 'a-claim', guestId: GUEST_CLAIMED_BY_ME, studentId: 'me', status: 'SUBMITTED', startedAt: new Date(), submittedAt: new Date(), questionIdsJson: '[]', answersJson: '{}', source: 'BANK', perTopicJson: '{}' })
  state.attempts.push({ id: 'a-foreign', guestId: GUEST_CLAIMED_BY_OTHER, studentId: 'someone-else', status: 'SUBMITTED', startedAt: new Date(), submittedAt: new Date(), questionIdsJson: '[]', answersJson: '{}', source: 'BANK', perTopicJson: '{}' })
  state.mastery.push({ id: 'm1', guestId: GUEST_CLAIMED_BY_ME, topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', status: 'LEARNING', accuracy: 50, evidenceQuestions: 6, attemptCount: 1, correctDistinct: 3, statusReason: 'x', lastActivityAt: new Date() })
  state.mistakes.push({ id: 'mk1', guestId: GUEST_CLAIMED_BY_ME, questionId: 'q1', attemptId: 'a-claim', topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', selected: 1, correctIndex: 0, category: 'UNCLASSIFIED', studentTag: null, note: null, createdAt: new Date(), snapshotJson: '{"id":"q1","text":"x","options":["a","b"],"correctIndex":0,"explanation":"e"}' })
  state.planTasks.push({ id: 'pt1', guestId: GUEST_CLAIMED_BY_ME, planDate: '2026-01-01', kind: 'REVISE_TOPIC', title: 'Revise Kinematics', topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', estimatedMinutes: 20, priority: 1, rationale: 'evidence', evidenceJson: '{}', status: 'PLANNED', createdAt: new Date(), completedAt: null })
}

const GUEST_CLAIMED_BY_ME = 'guest-claimed-by-me'
const GUEST_CLAIMED_BY_OTHER = 'guest-claimed-by-other'
const GUEST_UNCLAIMED = 'guest-unclaimed-ok'

const fakeDb = {
  attempt: {
    findFirst: async ({ where }: { where: { guestId: string } }) =>
      state.attempts.filter(a => a.guestId === where.guestId).sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())[0] ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => state.attempts.filter(a => a.guestId === where.guestId),
    findUnique: async ({ where }: { where: { id: string } }) => state.attempts.find(a => a.id === where.id) ?? null,
    count: async () => state.attempts.length,
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
    deleteMany: async () => ({ count: 0 }),
  },
  question: {
    findMany: async () => state.questions,
    count: async ({ where }: { where: { topicId?: string } }) => state.questions.filter(q => (where.topicId ? q.topicId === where.topicId : true)).length,
  },
  topic: {
    findUnique: async ({ where }: { where: { id: string } }) => state.topics.find(t => t.id === where.id) ?? null,
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => state.topics.filter(t => where.id.in.includes(t.id)),
  },
  topicMastery: {
    findMany: async ({ where }: { where: { guestId: string } }) => state.mastery.filter(r => r.guestId === where.guestId),
    findFirst: async ({ where }: { where: { guestId: string } }) => state.mastery.filter(r => r.guestId === where.guestId)[0] ?? null,
    findUnique: async ({ where }: { where: { guestId_topicId: { guestId: string; topicId: string } } }) =>
      state.mastery.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId) ?? null,
    upsert: async ({ where, create }: { where: { guestId_topicId: { guestId: string; topicId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = state.mastery.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId)
      if (existing) { Object.assign(existing, create); return existing }
      const row = { ...create, id: `tm-${state.mastery.length + 1}` }
      state.mastery.push(row)
      return row
    },
    updateMany: async () => ({ count: 0 }),
    deleteMany: async () => ({ count: 0 }),
    count: async () => state.mastery.length,
  },
  studyPlanTask: {
    findMany: async ({ where }: { where: { guestId: string; planDate?: string } }) =>
      state.planTasks.filter(t => t.guestId === where.guestId && (!where.planDate || t.planDate === where.planDate)),
    findFirst: async () => null,
    findUnique: async ({ where }: { where: { id: string } }) => state.planTasks.find(t => t.id === where.id) ?? null,
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => { for (const d of data) state.planTasks.push({ ...d, id: `pt-${state.planTasks.length + 1}`, createdAt: new Date(), completedAt: null }); return { count: data.length } },
    deleteMany: async ({ where }: { where: { guestId: string; planDate: string; status: string } }) => {
      const before = state.planTasks.length
      state.planTasks = state.planTasks.filter(t => !(t.guestId === where.guestId && t.planDate === where.planDate && t.status === where.status))
      return { count: before - state.planTasks.length }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.planTasks.find(t => t.id === where.id)
      if (!row) throw new Error('missing task')
      Object.assign(row, data)
      return row
    },
  },
  revisionScheduleItem: {
    findMany: async ({ where }: { where: { guestId: string } }) => state.revision.filter(r => r.guestId === where.guestId),
    findUnique: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => { const row = { ...data, id: `rs-${state.revision.length + 1}` }; state.revision.push(row); return row },
    update: async () => ({}),
  },
  mistakeRecord: {
    findMany: async ({ where }: { where: { guestId: string } }) => state.mistakes.filter(r => r.guestId === where.guestId),
    findUnique: async ({ where }: { where: { id: string } }) => state.mistakes.find(r => r.id === where.id) ?? null,
    groupBy: async () => [],
    count: async () => 1,
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => { for (const d of data) state.mistakes.push({ ...d, id: `mk-${state.mistakes.length + 1}`, createdAt: new Date() }); return { count: data.length } },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.mistakes.find(r => r.id === where.id)
      if (!row) throw new Error('missing mistake')
      Object.assign(row, data)
      return row
    },
  },
  learningAction: {
    findMany: async ({ where }: { where: { guestId: string; status?: string } }) => state.actions.filter(a => a.guestId === where.guestId && (!where.status || a.status === where.status)),
    findFirst: async () => null,
    findUnique: async () => null,
    upsert: async ({ where, create }: { where: { guestId_actionKey: { guestId: string; actionKey: string } }; create: Record<string, unknown> }) => {
      const row = { ...create, id: `la-${state.actions.length + 1}` }
      state.actions.push(row)
      return row
    },
    deleteMany: async () => ({ count: 0 }),
  },
  studyGoal: { findMany: async () => [] },
  studyDocument: { findMany: async () => [] },
  student: { findUnique: async () => null },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  sameOrigin: () => true,
  requireStudent: async () => state.sessionStudent,
  getSessionStudent: async () => state.sessionStudent,
  destroyCurrentSession: async () => undefined,
}))

const { assertLearningOwner } = await import('@/lib/learning/scope')
const overviewRoute = await import('@/app/api/learning/overview/route')
const masteryRoute = await import('@/app/api/learning/mastery/route')
const planRoute = await import('@/app/api/learning/plan/route')
const planTaskRoute = await import('@/app/api/learning/plan/[id]/route')
const diagnosticRoute = await import('@/app/api/learning/diagnostic/route')
const mistakesRoute = await import('@/app/api/learning/mistakes/route')
const mistakeTagRoute = await import('@/app/api/learning/mistakes/[id]/route')
const actionsRoute = await import('@/app/api/learning/actions/route')
const revisionRoute = await import('@/app/api/learning/revision/route')

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(method !== 'GET' ? { origin: 'http://x' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(resetState)

describe('assertLearningOwner — claim-model semantics', () => {
  it('signed-out: pure guest-bearer mode (guest-first operation preserved)', async () => {
    state.sessionStudent = null
    await expect(assertLearningOwner(GUEST_CLAIMED_BY_ME)).resolves.toEqual({ ok: true })
    await expect(assertLearningOwner(GUEST_UNCLAIMED)).resolves.toEqual({ ok: true })
  })

  it('signed-in claimant keeps access to their claimed identity', async () => {
    state.sessionStudent = { id: 'me' }
    await expect(assertLearningOwner(GUEST_CLAIMED_BY_ME)).resolves.toEqual({ ok: true })
  })

  it('signed-in BEFORE claiming keeps working on an unclaimed identity', async () => {
    state.sessionStudent = { id: 'me' }
    await expect(assertLearningOwner(GUEST_UNCLAIMED)).resolves.toEqual({ ok: true })
  })

  it('signed-in foreign account is rejected on a claimed identity (403)', async () => {
    state.sessionStudent = { id: 'someone-else-2' }
    const result = await assertLearningOwner(GUEST_CLAIMED_BY_ME)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })
})

describe('learning routes reject cross-account access when signed in', () => {
  it('GET overview — foreign account gets 403, claimant gets 200, guest gets 200', async () => {
    state.sessionStudent = { id: 'intruder' }
    const res = await overviewRoute.GET(req(`http://x/api/learning/overview?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(res.status).toBe(403)

    state.sessionStudent = { id: 'me' }
    const resMine = await overviewRoute.GET(req(`http://x/api/learning/overview?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(resMine.status).toBe(200)

    state.sessionStudent = null
    const resGuest = await overviewRoute.GET(req(`http://x/api/learning/overview?guestId=${GUEST_UNCLAIMED}`))
    expect(resGuest.status).toBe(200)
  })

  it('GET mastery and GET revision — reads are protected too', async () => {
    state.sessionStudent = { id: 'intruder' }
    expect((await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_CLAIMED_BY_ME}`))).status).toBe(403)
    expect((await revisionRoute.GET(req(`http://x/api/learning/revision?guestId=${GUEST_CLAIMED_BY_ME}`))).status).toBe(403)
    expect((await mistakesRoute.GET(req(`http://x/api/learning/mistakes?guestId=${GUEST_CLAIMED_BY_ME}`))).status).toBe(403)
  })

  it('POST diagnostic and POST plan regeneration — mutations get 403', async () => {
    state.sessionStudent = { id: 'intruder' }
    const resDiag = await diagnosticRoute.POST(req('http://x/api/learning/diagnostic', 'POST', { guestId: GUEST_CLAIMED_BY_ME, topicId: 'topic-1' }))
    expect(resDiag.status).toBe(403)
    const resPlan = await planRoute.POST(req('http://x/api/learning/plan', 'POST', { guestId: GUEST_CLAIMED_BY_ME, regenerate: true }))
    expect(resPlan.status).toBe(403)
    const resAction = await actionsRoute.POST(req('http://x/api/learning/actions', 'POST', { guestId: GUEST_CLAIMED_BY_ME, actionKey: 'REVIEW_DUE:topic-1', decision: 'DISMISS' }))
    expect(resAction.status).toBe(403)
  })

  it('PATCH plan task and PATCH mistake tag — 403 before any row mutation', async () => {
    state.sessionStudent = { id: 'intruder' }
    const resTask = await planTaskRoute.PATCH(req('http://x/api/learning/plan/pt1', 'PATCH', { guestId: GUEST_CLAIMED_BY_ME, action: 'COMPLETE' }), { params: Promise.resolve({ id: 'pt1' }) })
    expect(resTask.status).toBe(403)
    expect(state.planTasks.find(t => t.id === 'pt1')?.status).toBe('PLANNED') // untouched

    const resTag = await mistakeTagRoute.PATCH(req('http://x/api/learning/mistakes/mk1', 'PATCH', { guestId: GUEST_CLAIMED_BY_ME, studentTag: 'CONCEPT' }), { params: Promise.resolve({ id: 'mk1' }) })
    expect(resTag.status).toBe(403)
    expect(state.mistakes.find(m => m.id === 'mk1')?.studentTag).toBeNull() // untouched
  })

  it('the claimant can still mutate their own rows while signed in', async () => {
    state.sessionStudent = { id: 'me' }
    const resTag = await mistakeTagRoute.PATCH(req('http://x/api/learning/mistakes/mk1', 'PATCH', { guestId: GUEST_CLAIMED_BY_ME, studentTag: 'CONCEPT' }), { params: Promise.resolve({ id: 'mk1' }) })
    expect(resTag.status).toBe(200)
    expect(state.mistakes.find(m => m.id === 'mk1')?.studentTag).toBe('CONCEPT')
  })
})
