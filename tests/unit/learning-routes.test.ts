import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

// ─── Learning API route proofs (Phase 3B) ─────────────────────────────────────
// guestId validation, strict ownership (a foreign guest's rows are invisible),
// CSRF-lite on mutations, the diagnostic thin-bank guard, and the immutability
// of completed plan history.

interface Row { id: string; guestId?: string; studentId?: string | null; [k: string]: unknown }

const state = {
  attempts: [] as Row[],
  mastery: [] as Row[],
  planTasks: [] as Row[],
  revision: [] as Row[],
  mistakes: [] as Row[],
  actions: [] as Row[],
  questions: [] as Row[],
  topics: [] as Row[],
  docs: [] as Row[],
  students: [] as Row[],
}

function resetState() {
  state.attempts = []
  state.mastery = []
  state.planTasks = []
  state.revision = []
  state.mistakes = []
  state.actions = []
  state.questions = []
  state.topics = []
  state.docs = []
  state.students = []
  state.topics.push({ id: 'topic-1', name: 'Kinematics', unit: { subject: { id: 'subj-1', stage: { exam: { id: 'exam-1', shortName: 'JEE', name: 'JEE Main' } } } } })
  state.questions.push({ id: 'q1', topicId: 'topic-1', correctIndex: 0, optionsJson: '["a","b","c","d"]', text: 'g?', explanation: 'x' })
  state.questions.push({ id: 'q2', topicId: 'topic-1', correctIndex: 1, optionsJson: '["a","b","c","d"]', text: 'v?', explanation: 'y' })
}

function byGuest(rows: Row[], guestId: string): Row[] {
  return rows.filter(r => r.guestId === guestId)
}

const fakeDb = {
  attempt: {
    findFirst: async ({ where }: { where: { guestId?: string; status?: unknown } }) => byGuest(state.attempts, where.guestId as string)[0] ?? null,
    findMany: async ({ where }: { where: { guestId?: string } }) => byGuest(state.attempts, where.guestId as string),
    findUnique: async ({ where }: { where: { id: string } }) => state.attempts.find(r => r.id === where.id) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, id: `a-${state.attempts.length + 1}`, startedAt: new Date() } as Row
      state.attempts.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = state.attempts.find(r => r.id === where.id)
      if (!row) throw new Error('missing')
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: { guestId: string }; data: Row }) => {
      let n = 0
      for (const r of byGuest(state.attempts, where.guestId)) if (!r.studentId) { Object.assign(r, data); n++ }
      return { count: n }
    },
    deleteMany: async ({ where }: { where: { guestId?: string } }) => {
      const before = state.attempts.length
      state.attempts = state.attempts.filter(r => where.guestId ? r.guestId !== where.guestId : true)
      return { count: before - state.attempts.length }
    },
    count: async () => state.attempts.length,
  },
  question: {
    findMany: async ({ where }: { where: { id?: unknown; topicId?: string; verificationStatus?: string } }) =>
      state.questions.filter(q => (where.topicId ? q.topicId === where.topicId : true)),
    count: async ({ where }: { where: { topicId?: string } }) =>
      state.questions.filter(q => (where.topicId ? q.topicId === where.topicId : true)).length,
  },
  topic: {
    findUnique: async ({ where }: { where: { id: string } }) => state.topics.find(t => t.id === where.id) ?? null,
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => state.topics.filter(t => where.id.in.includes(t.id)),
  },
  exam: { findMany: async () => [], findUnique: async () => null },
  topicMastery: {
    findMany: async ({ where }: { where: { guestId?: string; topicId?: unknown } }) => byGuest(state.mastery, where.guestId as string),
    findFirst: async ({ where }: { where: { guestId?: string } }) => byGuest(state.mastery, where.guestId as string)[0] ?? null,
    findUnique: async ({ where }: { where: { guestId_topicId: { guestId: string; topicId: string } } }) =>
      state.mastery.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId) ?? null,
    upsert: async ({ where, create, update }: { where: { guestId_topicId: { guestId: string; topicId: string } }; create: Row; update: Row }) => {
      const existing = state.mastery.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId)
      if (existing) {
        Object.assign(existing, update, { computedAt: new Date() })
        return existing
      }
      const row = { ...create, id: `tm-${state.mastery.length + 1}` } as Row
      state.mastery.push(row)
      return row
    },
    updateMany: async ({ where, data }: { where: { guestId: string }; data: Row }) => {
      let n = 0
      for (const r of byGuest(state.mastery, where.guestId)) if (!r.studentId) { Object.assign(r, data); n++ }
      return { count: n }
    },
    deleteMany: async ({ where }: { where: { guestId: string } }) => {
      const before = state.mastery.length
      state.mastery = state.mastery.filter(r => r.guestId !== where.guestId)
      return { count: before - state.mastery.length }
    },
    count: async () => state.mastery.length,
  },
  studyPlanTask: {
    findMany: async ({ where }: { where: { guestId?: string; planDate?: string; status?: string } }) => {
      let rows = byGuest(state.planTasks, where.guestId as string)
      if (where.planDate) rows = rows.filter(r => r.planDate === where.planDate)
      if (where.status) rows = rows.filter(r => r.status === where.status)
      return rows
    },
    findFirst: async ({ where }: { where: { guestId?: string; planDate?: string } }) => {
      const rows = byGuest(state.planTasks, where.guestId as string).filter(r => (where.planDate ? r.planDate === where.planDate : true))
      return rows[0] ?? null
    },
    findUnique: async ({ where }: { where: { id: string } }) => state.planTasks.find(r => r.id === where.id) ?? null,
    createMany: async ({ data }: { data: Row[] }) => {
      for (const d of data) state.planTasks.push({ ...d, id: `pt-${state.planTasks.length + 1}`, createdAt: new Date(), updatedAt: new Date() } as Row)
      return { count: data.length }
    },
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, id: `pt-${state.planTasks.length + 1}`, createdAt: new Date(), updatedAt: new Date() } as Row
      state.planTasks.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = state.planTasks.find(r => r.id === where.id)
      if (!row) throw new Error('missing')
      Object.assign(row, data)
      return row
    },
    deleteMany: async ({ where }: { where: { guestId?: string; planDate?: string; status?: string } }) => {
      const before = state.planTasks.length
      state.planTasks = state.planTasks.filter(r => {
        if (where.guestId && r.guestId !== where.guestId) return true
        if (where.planDate && r.planDate !== where.planDate) return true
        if (where.status && r.status !== where.status) return true
        return false
      })
      return { count: before - state.planTasks.length }
    },
    updateMany: async ({ where, data }: { where: { guestId: string }; data: Row }) => {
      let n = 0
      for (const r of byGuest(state.planTasks, where.guestId)) if (!r.studentId) { Object.assign(r, data); n++ }
      return { count: n }
    },
  },
  revisionScheduleItem: {
    findMany: async ({ where }: { where: { guestId?: string } }) => byGuest(state.revision, where.guestId as string),
    findUnique: async ({ where }: { where: { guestId_topicId: { guestId: string; topicId: string } } }) =>
      state.revision.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = { ...data, id: `rs-${state.revision.length + 1}` } as Row
      state.revision.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = state.revision.find(r => r.id === where.id)
      if (!row) throw new Error('missing')
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: { guestId: string }; data: Row }) => {
      let n = 0
      for (const r of byGuest(state.revision, where.guestId)) if (!r.studentId) { Object.assign(r, data); n++ }
      return { count: n }
    },
    deleteMany: async ({ where }: { where: { guestId: string } }) => {
      const before = state.revision.length
      state.revision = state.revision.filter(r => r.guestId !== where.guestId)
      return { count: before - state.revision.length }
    },
  },
  mistakeRecord: {
    findMany: async ({ where }: { where: { guestId?: string; category?: string; attemptId?: string; questionId?: unknown } }) => {
      let rows = byGuest(state.mistakes, where.guestId as string)
      if (where.category) rows = rows.filter(r => r.category === where.category)
      if (where.attemptId) rows = rows.filter(r => r.attemptId === where.attemptId)
      if (where.questionId && (where.questionId as { in?: string[] }).in) rows = rows.filter(r => (where.questionId as { in: string[] }).in.includes(r.questionId as string))
      return rows
    },
    count: async ({ where }: { where: { guestId?: string; questionId?: string; topicId?: string } }) => {
      let rows = byGuest(state.mistakes, where.guestId as string)
      if (where.questionId) rows = rows.filter(r => r.questionId === where.questionId)
      if (where.topicId) rows = rows.filter(r => r.topicId === where.topicId)
      return rows.length
    },
    findUnique: async ({ where }: { where: { id: string } }) => state.mistakes.find(r => r.id === where.id) ?? null,
    groupBy: async ({ by, where }: { by: string[]; where: { guestId?: string; questionId?: unknown } }) => {
      let rows = byGuest(state.mistakes, where.guestId as string)
      if (where.questionId && (where.questionId as { in?: string[] }).in) rows = rows.filter(r => (where.questionId as { in: string[] }).in.includes(r.questionId as string))
      const counts = new Map<string, number>()
      for (const r of rows) counts.set(r.questionId as string, (counts.get(r.questionId as string) ?? 0) + 1)
      return [...counts.entries()].map(([questionId, n]) => ({ questionId, _count: { _all: n } }))
    },
    upsert: async ({ where, create }: { where: { attemptId_questionId: { attemptId: string; questionId: string } }; create: Row; update: Row }) => {
      const existing = state.mistakes.find(r => r.attemptId === where.attemptId_questionId.attemptId && r.questionId === where.attemptId_questionId.questionId)
      if (existing) return existing
      const row = { ...create, id: `mr-${state.mistakes.length + 1}`, createdAt: new Date() } as Row
      state.mistakes.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const row = state.mistakes.find(r => r.id === where.id)
      if (!row) throw new Error('missing')
      Object.assign(row, data)
      return row
    },
    deleteMany: async ({ where }: { where: { guestId?: string; studentId?: string } }) => {
      const before = state.mistakes.length
      state.mistakes = state.mistakes.filter(r => (where.guestId ? r.guestId !== where.guestId : r.studentId !== where.studentId))
      return { count: before - state.mistakes.length }
    },
  },
  learningAction: {
    findMany: async ({ where }: { where: { guestId?: string; status?: string } }) => {
      let rows = byGuest(state.actions, where.guestId as string)
      if (where.status) rows = rows.filter(r => r.status === where.status)
      return rows
    },
    upsert: async ({ where, create, update }: { where: { guestId_actionKey: { guestId: string; actionKey: string } }; create: Row; update: Row }) => {
      const existing = state.actions.find(r => r.guestId === where.guestId_actionKey.guestId && r.actionKey === where.guestId_actionKey.actionKey)
      if (existing) {
        Object.assign(existing, update)
        return existing
      }
      const row = { ...create, id: `la-${state.actions.length + 1}`, createdAt: new Date(), updatedAt: new Date() } as Row
      state.actions.push(row)
      return row
    },
    deleteMany: async ({ where }: { where: { guestId: string; studentId?: string } }) => {
      const before = state.actions.length
      state.actions = state.actions.filter(r => (where.guestId ? r.guestId !== where.guestId : r.studentId !== where.studentId))
      return { count: before - state.actions.length }
    },
    updateMany: async ({ where, data }: { where: { guestId: string }; data: Row }) => {
      let n = 0
      for (const r of byGuest(state.actions, where.guestId)) if (!r.studentId) { Object.assign(r, data); n++ }
      return { count: n }
    },
  },
  studyDocument: {
    findMany: async ({ where }: { where: { guestId?: string; status?: unknown } }) => byGuest(state.docs, where.guestId as string),
    deleteMany: async ({ where }: { where: { guestId?: string; studentId?: string } }) => {
      const before = state.docs.length
      state.docs = state.docs.filter(r => (where.guestId ? r.guestId !== where.guestId : r.studentId !== where.studentId))
      return { count: before - state.docs.length }
    },
  },
  studyGoal: { findMany: async () => [], count: async () => 0 },
  student: { findUnique: async ({ where }: { where: { id: string } }) => state.students.find(s => s.id === where.id) ?? null },
  $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : await (arg as (tx: unknown) => Promise<unknown>)(fakeDb)),
}

let sameOriginOk = true

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => null,
  sameOrigin: () => sameOriginOk,
  resolveOwnerScope: async () => ({ guestId: null, studentId: null }),
  ownedBy: () => ({ id: '___no_owner___' }),
}))

const overviewRoute = await import('@/app/api/learning/overview/route')
const masteryRoute = await import('@/app/api/learning/mastery/route')
const planRoute = await import('@/app/api/learning/plan/route')
const planTaskRoute = await import('@/app/api/learning/plan/[id]/route')
const revisionRoute = await import('@/app/api/learning/revision/route')
const mistakesRoute = await import('@/app/api/learning/mistakes/route')
const mistakeIdRoute = await import('@/app/api/learning/mistakes/[id]/route')
const actionsRoute = await import('@/app/api/learning/actions/route')
const diagnosticRoute = await import('@/app/api/learning/diagnostic/route')

const GUEST = 'guest-aaaaaaaa-1'
const OTHER = 'guest-bbbbbbbb-2'

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(() => {
  resetState()
  sameOriginOk = true
})

describe('learning routes — guestId validation', () => {
  it('every GET refuses a missing or malformed guestId (400)', async () => {
    expect((await overviewRoute.GET(req('http://x/api/learning/overview'))).status).toBe(400)
    expect((await masteryRoute.GET(req('http://x/api/learning/mastery?guestId=x'))).status).toBe(400)
    expect((await planRoute.GET(req('http://x/api/learning/plan'))).status).toBe(400)
    expect((await revisionRoute.GET(req('http://x/api/learning/revision'))).status).toBe(400)
    expect((await mistakesRoute.GET(req('http://x/api/learning/mistakes'))).status).toBe(400)
    expect((await actionsRoute.GET(req('http://x/api/learning/actions'))).status).toBe(400)
  })

  it('overview is an honest empty state for a fresh guest (and generates an empty plan)', async () => {
    const res = await overviewRoute.GET(req(`http://x/api/learning/overview?guestId=${GUEST}`))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.mastery.totalTracked).toBe(0)
    expect(dto.revision.dueCount).toBe(0)
    expect(dto.actions).toEqual([])
    expect(dto.plan.tasks).toEqual([])
    expect(dto.insights.stated.source).toBeNull()
    expect(dto.insights.observed.attempts14).toBe(0)
  })
})

describe('ownership — learning rows never leak across guests', () => {
  it('mastery rows of another guest are invisible', async () => {
    state.mastery.push({ id: 'm1', guestId: OTHER, topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', status: 'LEARNING', accuracy: 30, evidenceQuestions: 6, attemptCount: 1, correctDistinct: 2, statusReason: 'x', lastActivityAt: new Date() })
    const res = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST}`))
    const dto = await res.json()
    expect(dto.topics.length).toBe(0)
    const resOther = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${OTHER}`))
    const dtoOther = await resOther.json()
    expect(dtoOther.topics.length).toBe(1)
  })

  it('mistake lists are scoped by guestId', async () => {
    state.mistakes.push({ id: 'mr1', guestId: OTHER, attemptId: 'a1', questionId: 'q1', source: 'BANK', topicId: 'topic-1', topicName: 'Kinematics', chosenIndex: 1, correctIndex: 0, snapshotJson: '{"text":"g?","options":["a","b"]}', category: 'UNCLASSIFIED', categoryReason: null, studentTag: null, note: null, createdAt: new Date() })
    const mine = await (await mistakesRoute.GET(req(`http://x/api/learning/mistakes?guestId=${GUEST}`))).json()
    expect(mine.mistakes.length).toBe(0)
    const theirs = await (await mistakesRoute.GET(req(`http://x/api/learning/mistakes?guestId=${OTHER}`))).json()
    expect(theirs.mistakes.length).toBe(1)
    expect(theirs.mistakes[0].text).toBe('g?')
    expect(theirs.mistakes[0].timesWrong).toBe(1)
  })

  it('PATCHing another guest’s mistake record is 404; self-tagging stores the self-report', async () => {
    state.mistakes.push({ id: 'mr-own', guestId: GUEST, attemptId: 'a1', questionId: 'q1', source: 'BANK', topicId: null, topicName: null, chosenIndex: 1, correctIndex: 0, snapshotJson: '{}', category: 'UNCLASSIFIED', categoryReason: null, studentTag: null, note: null, createdAt: new Date() })
    const foreign = await mistakeIdRoute.PATCH(req(`http://x/api/learning/mistakes/mr-own`, 'PATCH', { guestId: OTHER, studentTag: 'FACT' }), { params: Promise.resolve({ id: 'mr-own' }) })
    expect(foreign.status).toBe(404)
    const own = await mistakeIdRoute.PATCH(req(`http://x/api/learning/mistakes/mr-own`, 'PATCH', { guestId: GUEST, studentTag: 'FORMULA' }), { params: Promise.resolve({ id: 'mr-own' }) })
    expect(own.status).toBe(200)
    const dto = await own.json()
    expect(dto.mistake.studentTag).toBe('FORMULA')
  })
})

describe('mutations — CSRF-lite and rate limits', () => {
  it('plan regeneration rejects cross-origin POSTs (403)', async () => {
    sameOriginOk = false
    const res = await planRoute.POST(req('http://x/api/learning/plan', 'POST', { guestId: GUEST }))
    expect(res.status).toBe(403)
  })

  it('diagnostic start rejects cross-origin POSTs (403)', async () => {
    sameOriginOk = false
    const res = await diagnosticRoute.POST(req('http://x/api/learning/diagnostic', 'POST', { guestId: GUEST, topicId: 'topic-1' }))
    expect(res.status).toBe(403)
  })

  it('action decisions reject cross-origin POSTs (403)', async () => {
    sameOriginOk = false
    const res = await actionsRoute.POST(req('http://x/api/learning/actions', 'POST', { guestId: GUEST, actionKey: 'REVIEW_DUE:topic-1', decision: 'DISMISS' }))
    expect(res.status).toBe(403)
  })

  it('action decisions validate the action key (400 on junk)', async () => {
    const res = await actionsRoute.POST(req('http://x/api/learning/actions', 'POST', { guestId: GUEST, actionKey: 'not a key', decision: 'DISMISS' }))
    expect(res.status).toBe(400)
  })

  it('diagnostic start 409s honestly when the verified bank is too thin', async () => {
    // Only 2 questions in the topic → below DIAGNOSTIC_MIN_BANK (6).
    const res = await diagnosticRoute.POST(req('http://x/api/learning/diagnostic', 'POST', { guestId: GUEST, topicId: 'topic-1' }))
    expect(res.status).toBe(409)
    const dto = await res.json()
    expect(dto.error).toContain('verified questions')
  })

  it('diagnostic start creates a diagnostic-marked attempt (VERIFIED-only bank permitting)', async () => {
    for (let i = 0; i < 6; i++) state.questions.push({ id: `qx${i}`, topicId: 'topic-1', correctIndex: 0, optionsJson: '["a","b"]', verificationStatus: 'VERIFIED' })
    const res = await diagnosticRoute.POST(req('http://x/api/learning/diagnostic', 'POST', { guestId: GUEST, topicId: 'topic-1' }))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.resumed).toBe(false)
    expect(state.attempts.length).toBe(1)
    expect(state.attempts[0].guestId).toBe(GUEST)
    expect(JSON.parse(state.attempts[0].configJson as string).kind).toBe('DIAGNOSTIC')
    expect(state.attempts[0].title).toContain('Diagnostic')
    // Resuming returns the same attempt instead of stacking.
    const again = await diagnosticRoute.POST(req('http://x/api/learning/diagnostic', 'POST', { guestId: GUEST, topicId: 'topic-1' }))
    const againDto = await again.json()
    expect(againDto.resumed).toBe(true)
    expect(againDto.attemptId).toBe(dto.attemptId)
  })
})

describe('day plan — generation, immutability and ownership', () => {
  it('generates tasks from due revisions and marks them PLANNED', async () => {
    state.revision.push({ id: 'rs1', guestId: GUEST, topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', intervalDays: 1, repetitions: 0, lapses: 0, lastOutcome: 'FAILURE', lastReviewedAt: new Date(), nextDueAt: new Date(Date.now() - 2 * 24 * 3600_000), misconceptionFlag: true })
    const res = await planRoute.GET(req(`http://x/api/learning/plan?guestId=${GUEST}`))
    const dto = await res.json()
    expect(dto.generated).toBe(true)
    expect(dto.tasks.length).toBeGreaterThan(0)
    expect(dto.tasks[0].kind).toBe('REVISE_TOPIC')
    expect(dto.tasks[0].title).toContain('Kinematics')
    expect(dto.tasks[0].rationale).toContain('overdue')
    expect(dto.tasks[0].priority).toBe(1)
    expect(state.planTasks.length).toBe(dto.tasks.length)
    // Second GET does NOT regenerate (stable for the day).
    const second = await (await planRoute.GET(req(`http://x/api/learning/plan?guestId=${GUEST}`))).json()
    expect(second.generated).toBe(false)
    expect(second.tasks.length).toBe(dto.tasks.length)
  })

  it('regeneration replaces only PLANNED rows — completed history survives untouched', async () => {
    state.revision.push({ id: 'rs1', guestId: GUEST, topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', intervalDays: 1, repetitions: 0, lapses: 0, lastOutcome: 'FAILURE', lastReviewedAt: new Date(), nextDueAt: new Date(Date.now() - 3600_000), misconceptionFlag: false })
    await planRoute.GET(req(`http://x/api/learning/plan?guestId=${GUEST}`))
    const planned = state.planTasks.find(r => r.status === 'PLANNED')!
    await fakeDb.studyPlanTask.update({ where: { id: planned.id as string }, data: { status: 'COMPLETED', completedAt: new Date() } })
    const regen = await (await planRoute.POST(req('http://x/api/learning/plan', 'POST', { guestId: GUEST }))).json()
    const completed = state.planTasks.filter(r => r.status === 'COMPLETED')
    expect(completed.length).toBe(1)
    expect(completed[0].title).toBe(regen.history[0].title)
    expect(regen.history.some(h => h.status === 'COMPLETED')).toBe(true)
  })

  it('completed tasks refuse every mutation (history is immutable)', async () => {
    state.planTasks.push({ id: 'pt-done', guestId: GUEST, planDate: '2026-04-01', kind: 'PRACTICE_TOPIC', title: 'T', topicId: null, topicName: null, examLabel: null, estimatedMinutes: 20, priority: 2, rationale: 'r', status: 'COMPLETED', completedAt: new Date(), createdAt: new Date(), updatedAt: new Date() })
    for (const action of ['COMPLETE', 'SKIP', 'DEFER', 'RESCHEDULE', 'RESIZE'] as const) {
      const res = await planTaskRoute.PATCH(req(`http://x/api/learning/plan/pt-done`, 'PATCH', { guestId: GUEST, action }), { params: Promise.resolve({ id: 'pt-done' }) })
      expect(res.status).toBe(409)
    }
  })

  it('foreign and missing tasks are 404; PLANNED tasks accept RESIZE/RESCHEDULE', async () => {
    state.planTasks.push({ id: 'pt-mine', guestId: GUEST, planDate: '2026-04-01', kind: 'PRACTICE_TOPIC', title: 'T', topicId: null, topicName: null, examLabel: null, estimatedMinutes: 20, priority: 2, rationale: 'r', status: 'PLANNED', completedAt: null, createdAt: new Date(), updatedAt: new Date() })
    const foreign = await planTaskRoute.PATCH(req(`http://x/api/learning/plan/pt-mine`, 'PATCH', { guestId: OTHER, action: 'RESIZE', minutes: 30 }), { params: Promise.resolve({ id: 'pt-mine' }) })
    expect(foreign.status).toBe(404)
    const resized = await planTaskRoute.PATCH(req(`http://x/api/learning/plan/pt-mine`, 'PATCH', { guestId: GUEST, action: 'RESIZE', minutes: 30 }), { params: Promise.resolve({ id: 'pt-mine' }) })
    expect(resized.status).toBe(200)
    expect((await resized.json()).task.estimatedMinutes).toBe(30)
    const moved = await planTaskRoute.PATCH(req(`http://x/api/learning/plan/pt-mine`, 'PATCH', { guestId: GUEST, action: 'RESCHEDULE', date: '2026-04-03' }), { params: Promise.resolve({ id: 'pt-mine' }) })
    expect((await moved.json()).task.planDate).toBe('2026-04-03')
    const badDate = await planTaskRoute.PATCH(req(`http://x/api/learning/plan/pt-mine`, 'PATCH', { guestId: GUEST, action: 'RESCHEDULE', date: '2026-13-99' }), { params: Promise.resolve({ id: 'pt-mine' }) })
    expect(badDate.status).toBe(400)
  })
})

describe('next-best actions — lifecycle recording', () => {
  it('COMPLETED captures an outcome snapshot; DISMISS/SNOOZE hide the action afterwards', async () => {
    state.mastery.push({ id: 'm1', guestId: GUEST, topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', status: 'LEARNING', accuracy: 40, evidenceQuestions: 8, attemptCount: 2, correctDistinct: 3, statusReason: 'r', lastActivityAt: new Date() })
    const list = await (await actionsRoute.GET(req(`http://x/api/learning/actions?guestId=${GUEST}`))).json()
    expect(list.actions.length).toBeGreaterThan(0)
    const key = list.actions[0].actionKey as string
    const done = await actionsRoute.POST(req('http://x/api/learning/actions', 'POST', { guestId: GUEST, actionKey: key, decision: 'COMPLETE' }))
    expect(done.status).toBe(200)
    const row = state.actions.find(r => r.actionKey === key)!
    expect(row.status).toBe('COMPLETED')
    expect(row.resolvedAt).toBeTruthy()
    if (key.endsWith(':topic-1')) {
      expect(JSON.parse(row.outcomeJson as string).accuracySnapshot).toBe(40)
    }
    const after = await (await actionsRoute.GET(req(`http://x/api/learning/actions?guestId=${GUEST}`))).json()
    expect(after.actions.some((a: { actionKey: string }) => a.actionKey === key)).toBe(false)
  })
})
