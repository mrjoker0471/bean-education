import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── Fail-closed ownership verification (Phase 3B.1) ──────────────────────────
// Phase 3B's assertLearningOwner caught errors from getSessionStudent() and
// treated them as "unauthenticated guest" — a failed session lookup is NOT
// proof that a request is unauthenticated, so that catch was a fail-open
// hole. This suite proves the fail-closed contract:
//   • session resolution completes with NO session → guest-bearer contract
//     preserved unchanged;
//   • claimant keeps access; a foreign signed-in account gets 403;
//   • a THROWN session-verification error → 503, never guest access;
//   • a claimed-account lookup failure → 503, never a guest fallback;
//   • protected reads and mutations never proceed after a failed check;
//   • Riishe chat never receives the learner digest when ownership
//     verification fails — while ordinary guest chat keeps working.
// Uses the complete '@/lib/auth' mock surface (tests/helpers/auth-mock.ts) so
// Bun's first-module-mock registration can never leak a partial surface.

const GUEST_CLAIMED_BY_ME = 'guest-claimed-by-me'
const GUEST_UNCLAIMED = 'guest-unclaimed-ok'
const GENERIC = 'Account ownership could not be verified. Please retry.'

const state = {
  sessionStudent: null as { id: string } | null,
  sessionThrows: false,
  claimLookupThrows: false,
  attempts: [] as Record<string, unknown>[],
  mastery: [] as Record<string, unknown>[],
  planTasks: [] as Record<string, unknown>[],
  revision: [] as Record<string, unknown>[],
  mistakes: [] as Record<string, unknown>[],
  actions: [] as Record<string, unknown>[],
  questions: [] as Record<string, unknown>[],
  topics: [{ id: 'topic-1', name: 'Kinematics', unit: { subject: { id: 'subj-1', stage: { exam: { id: 'exam-1', shortName: 'JEE', name: 'JEE Main' } } } } }] as Record<string, unknown>[],
  chatTurns: [] as Record<string, unknown>[],
  documents: [] as Record<string, unknown>[],
}

// Per-model call recorder — proves reads/mutations do not proceed after a
// failed ownership check and that the digest is never built when withheld.
const dbCalls: Record<string, number> = {}
const call = (key: string) => { dbCalls[key] = (dbCalls[key] ?? 0) + 1 }
const totalCalls = () => Object.values(dbCalls).reduce((a, b) => a + b, 0)

function resetState() {
  state.sessionStudent = null
  state.sessionThrows = false
  state.claimLookupThrows = false
  dbCallsClear()
  state.attempts = []
  state.mastery = []
  state.planTasks = []
  state.revision = []
  state.mistakes = []
  state.actions = []
  state.questions = []
  state.chatTurns = []
  state.documents = []
  state.topics = [{ id: 'topic-1', name: 'Kinematics', unit: { subject: { id: 'subj-1', stage: { exam: { id: 'exam-1', shortName: 'JEE', name: 'JEE Main' } } } } }]
  // A claimed guest identity: its most recent attempt carries the claimant's studentId.
  state.attempts.push({ id: 'a-claim', guestId: GUEST_CLAIMED_BY_ME, studentId: 'me', status: 'SUBMITTED', startedAt: new Date(), submittedAt: new Date(), questionIdsJson: '[]', answersJson: '{}', source: 'BANK', perTopicJson: '{}' })
  // Mastery rows so buildLearningDigest produces a non-empty digest for both
  // the guest and the claimant identity (positive controls for the Riishe gate).
  for (const gid of [GUEST_CLAIMED_BY_ME, GUEST_UNCLAIMED]) {
    state.mastery.push({ id: `m-${gid}`, guestId: gid, topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', status: 'LEARNING', accuracy: 40, evidenceQuestions: 6, attemptCount: 1, correctDistinct: 2, statusReason: 'x', lastActivityAt: new Date() })
  }
  state.mistakes.push({ id: 'mk1', guestId: GUEST_CLAIMED_BY_ME, questionId: 'q1', attemptId: 'a-claim', topicId: 'topic-1', topicName: 'Kinematics', examLabel: 'JEE', selected: 1, correctIndex: 0, category: 'UNCLASSIFIED', studentTag: null, note: null, createdAt: new Date(), snapshotJson: '{"id":"q1","text":"x","options":["a","b"],"correctIndex":0,"explanation":"e"}' })
}

function dbCallsClear() { for (const k of Object.keys(dbCalls)) delete dbCalls[k] }

const fakeDb = {
  attempt: {
    findFirst: async ({ where }: { where: { guestId: string } }) => {
      call('attempt.findFirst')
      if (state.claimLookupThrows) throw new Error('db unavailable: attempt lookup failed')
      return state.attempts.filter(a => a.guestId === where.guestId).sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())[0] ?? null
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => { call('attempt.findMany'); return state.attempts.filter(a => a.guestId === where.guestId) },
    findUnique: async ({ where }: { where: { id: string } }) => { call('attempt.findUnique'); return state.attempts.find(a => a.id === where.id) ?? null },
    count: async () => { call('attempt.count'); return state.attempts.length },
    update: async () => { call('attempt.update'); return {} },
    updateMany: async () => { call('attempt.updateMany'); return { count: 0 } },
    deleteMany: async () => { call('attempt.deleteMany'); return { count: 0 } },
  },
  question: {
    findMany: async () => { call('question.findMany'); return state.questions },
    count: async ({ where }: { where: { topicId?: string } }) => { call('question.count'); return state.questions.filter(q => (where.topicId ? q.topicId === where.topicId : true)).length },
  },
  topic: {
    findUnique: async ({ where }: { where: { id: string } }) => { call('topic.findUnique'); return state.topics.find(t => t.id === where.id) ?? null },
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => { call('topic.findMany'); return state.topics.filter(t => where.id.in.includes(t.id as string)) },
  },
  topicMastery: {
    findMany: async ({ where }: { where: { guestId: string } }) => { call('topicMastery.findMany'); return state.mastery.filter(r => r.guestId === where.guestId) },
    findFirst: async ({ where }: { where: { guestId: string } }) => { call('topicMastery.findFirst'); return state.mastery.filter(r => r.guestId === where.guestId)[0] ?? null },
    findUnique: async ({ where }: { where: { guestId_topicId: { guestId: string; topicId: string } } }) => {
      call('topicMastery.findUnique')
      return state.mastery.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId) ?? null
    },
    upsert: async ({ where, create }: { where: { guestId_topicId: { guestId: string; topicId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      call('topicMastery.upsert')
      const existing = state.mastery.find(r => r.guestId === where.guestId_topicId.guestId && r.topicId === where.guestId_topicId.topicId)
      if (existing) { Object.assign(existing, create); return existing }
      const row = { ...create, id: `tm-${state.mastery.length + 1}` }
      state.mastery.push(row)
      return row
    },
    updateMany: async () => { call('topicMastery.updateMany'); return { count: 0 } },
    deleteMany: async () => { call('topicMastery.deleteMany'); return { count: 0 } },
    count: async () => { call('topicMastery.count'); return state.mastery.length },
  },
  studyPlanTask: {
    findMany: async ({ where }: { where: { guestId: string; planDate?: string } }) => {
      call('studyPlanTask.findMany')
      return state.planTasks.filter(t => t.guestId === where.guestId && (!where.planDate || t.planDate === where.planDate))
    },
    findFirst: async () => { call('studyPlanTask.findFirst'); return null },
    findUnique: async ({ where }: { where: { id: string } }) => { call('studyPlanTask.findUnique'); return state.planTasks.find(t => t.id === where.id) ?? null },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => { call('studyPlanTask.createMany'); for (const d of data) state.planTasks.push({ ...d, id: `pt-${state.planTasks.length + 1}`, createdAt: new Date(), completedAt: null }); return { count: data.length } },
    deleteMany: async ({ where }: { where: { guestId: string; planDate: string; status: string } }) => {
      call('studyPlanTask.deleteMany')
      const before = state.planTasks.length
      state.planTasks = state.planTasks.filter(t => !(t.guestId === where.guestId && t.planDate === where.planDate && t.status === where.status))
      return { count: before - state.planTasks.length }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      call('studyPlanTask.update')
      const row = state.planTasks.find(t => t.id === where.id)
      if (!row) throw new Error('missing task')
      Object.assign(row, data)
      return row
    },
  },
  revisionScheduleItem: {
    findMany: async ({ where }: { where: { guestId: string } }) => { call('revisionScheduleItem.findMany'); return state.revision.filter(r => r.guestId === where.guestId) },
    findUnique: async () => { call('revisionScheduleItem.findUnique'); return null },
    create: async ({ data }: { data: Record<string, unknown> }) => { call('revisionScheduleItem.create'); const row = { ...data, id: `rs-${state.revision.length + 1}` }; state.revision.push(row); return row },
    update: async () => { call('revisionScheduleItem.update'); return {} },
  },
  mistakeRecord: {
    findMany: async ({ where }: { where: { guestId: string } }) => { call('mistakeRecord.findMany'); return state.mistakes.filter(r => r.guestId === where.guestId) },
    findUnique: async ({ where }: { where: { id: string } }) => { call('mistakeRecord.findUnique'); return state.mistakes.find(r => r.id === where.id) ?? null },
    groupBy: async () => { call('mistakeRecord.groupBy'); return [] },
    count: async () => { call('mistakeRecord.count'); return 1 },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => { call('mistakeRecord.createMany'); for (const d of data) state.mistakes.push({ ...d, id: `mk-${state.mistakes.length + 1}`, createdAt: new Date() }); return { count: data.length } },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      call('mistakeRecord.update')
      const row = state.mistakes.find(r => r.id === where.id)
      if (!row) throw new Error('missing mistake')
      Object.assign(row, data)
      return row
    },
  },
  learningAction: {
    findMany: async ({ where }: { where: { guestId: string; status?: string } }) => {
      call('learningAction.findMany')
      return state.actions.filter(a => a.guestId === where.guestId && (!where.status || a.status === where.status))
    },
    findFirst: async () => { call('learningAction.findFirst'); return null },
    findUnique: async () => { call('learningAction.findUnique'); return null },
    upsert: async ({ where, create }: { where: { guestId_actionKey: { guestId: string; actionKey: string } }; create: Record<string, unknown> }) => {
      call('learningAction.upsert')
      const row = { ...create, id: `la-${state.actions.length + 1}` }
      state.actions.push(row)
      return row
    },
    deleteMany: async () => { call('learningAction.deleteMany'); return { count: 0 } },
  },
  studyGoal: { findMany: async () => { call('studyGoal.findMany'); return [] } },
  studyDocument: {
    findMany: async () => { call('studyDocument.findMany'); return state.documents },
    findUnique: async () => { call('studyDocument.findUnique'); return null },
  },
  riisheChatTurn: {
    findMany: async () => { call('riisheChatTurn.findMany'); return state.chatTurns },
    create: async ({ data }: { data: Record<string, unknown> }) => { call('riisheChatTurn.create'); const row = { ...data, id: `turn-${state.chatTurns.length + 1}` }; state.chatTurns.push(row); return row },
  },
  riisheExplanation: {
    findUnique: async () => { call('riisheExplanation.findUnique'); return null },
    findMany: async () => { call('riisheExplanation.findMany'); return [] },
  },
  riisheQuestion: {
    findUnique: async () => { call('riisheQuestion.findUnique'); return null },
    findMany: async () => { call('riisheQuestion.findMany'); return [] },
  },
  student: { findUnique: async () => { call('student.findUnique'); return null } },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  getSessionStudent: async () => {
    if (state.sessionThrows) throw new Error('session store unavailable')
    return state.sessionStudent
  },
  requireStudent: async () => {
    if (state.sessionThrows) throw new Error('session store unavailable')
    return state.sessionStudent
  },
}))

// Riishe provider: real module spread (complete export surface — fence/parse/
// style helpers stay REAL) with only the provider boundary stubbed. The SDK
// client is created lazily inside chat(), so importing the real module here is
// side-effect free and the provider is never contacted.
const realAi = await import('@/lib/riishe/ai')
const capturedChats: { role: string; content: string }[][] = []
mock.module('@/lib/riishe/ai', () => ({
  ...realAi,
  chat: async (messages: { role: string; content: string }[]) => {
    call('ai.chat')
    capturedChats.push(messages)
    return '[SOURCES: GENERAL] Mocked tutor reply for the hardening suite.'
  },
  webSearch: async () => [],
}))

const { assertLearningOwner, OWNERSHIP_UNVERIFIED_MESSAGE } = await import('@/lib/learning/scope')
const masteryRoute = await import('@/app/api/learning/mastery/route')
const actionsRoute = await import('@/app/api/learning/actions/route')
const mistakeTagRoute = await import('@/app/api/learning/mistakes/[id]/route')
const chatRoute = await import('@/app/api/riishe/chat/route')

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(method !== 'GET' ? { origin: 'http://x' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(resetState)

describe('assertLearningOwner — fail-closed outcomes (Phase 3B.1)', () => {
  it('a genuine unauthenticated guest still works (session resolves to null)', async () => {
    state.sessionStudent = null
    await expect(assertLearningOwner(GUEST_UNCLAIMED)).resolves.toEqual({ ok: true })
    await expect(assertLearningOwner(GUEST_CLAIMED_BY_ME)).resolves.toEqual({ ok: true })
    // The guest-bearer contract holds end-to-end on a protected read.
    const res = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_UNCLAIMED}`))
    expect(res.status).toBe(200)
  })

  it('the authenticated claimant still works', async () => {
    state.sessionStudent = { id: 'me' }
    await expect(assertLearningOwner(GUEST_CLAIMED_BY_ME)).resolves.toEqual({ ok: true })
    const res = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(res.status).toBe(200)
    // And the claimant can still mutate their own rows.
    const resTag = await mistakeTagRoute.PATCH(
      req('http://x/api/learning/mistakes/mk1', 'PATCH', { guestId: GUEST_CLAIMED_BY_ME, studentTag: 'CONCEPT' }),
      { params: Promise.resolve({ id: 'mk1' }) },
    )
    expect(resTag.status).toBe(200)
    expect(state.mistakes.find(m => m.id === 'mk1')?.studentTag).toBe('CONCEPT')
  })

  it('a foreign signed-in account gets 403', async () => {
    state.sessionStudent = { id: 'intruder' }
    const result = await assertLearningOwner(GUEST_CLAIMED_BY_ME)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
    const res = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(res.status).toBe(403)
  })

  it('a thrown session-verification error never grants guest access (503)', async () => {
    // Even with NO session row present, a THROW is not "no session".
    state.sessionThrows = true
    state.sessionStudent = null
    const result = await assertLearningOwner(GUEST_CLAIMED_BY_ME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.error).toBe(OWNERSHIP_UNVERIFIED_MESSAGE)
      // Generic message only — no internal error text leaks to the client.
      expect(result.error).not.toContain('session store')
    }
    // The same outcome holds when a session WAS expected to exist.
    state.sessionStudent = { id: 'me' }
    const result2 = await assertLearningOwner(GUEST_CLAIMED_BY_ME)
    expect(result2.ok).toBe(false)
    if (!result2.ok) expect(result2.status).toBe(503)
    // Route level: 503 with the generic body, and zero database access
    // (the guard fails before the claim lookup, so nothing is queried).
    const res = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toBe(GENERIC)
    expect(totalCalls()).toBe(0)
  })

  it('a claimed-account lookup failure never grants guest access (503)', async () => {
    state.sessionStudent = { id: 'me' }
    state.claimLookupThrows = true
    const result = await assertLearningOwner(GUEST_CLAIMED_BY_ME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(503)
      expect(result.error).toBe(OWNERSHIP_UNVERIFIED_MESSAGE)
    }
    // Exactly the failing lookup ran — nothing else, no fallback, no leak.
    expect(dbCalls['attempt.findFirst']).toBe(1)
    expect(dbCalls['topicMastery.findMany']).toBeUndefined()
  })
})

describe('learning routes fail closed before reads and mutations', () => {
  it('session-verification failure: no protected read or mutation proceeds', async () => {
    state.sessionThrows = true
    const read = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(read.status).toBe(503)
    const mutate = await actionsRoute.POST(req('http://x/api/learning/actions', 'POST', { guestId: GUEST_CLAIMED_BY_ME, actionKey: 'REVIEW_DUE:topic-1', decision: 'DISMISS' }))
    expect(mutate.status).toBe(503)
    const tag = await mistakeTagRoute.PATCH(
      req('http://x/api/learning/mistakes/mk1', 'PATCH', { guestId: GUEST_CLAIMED_BY_ME, studentTag: 'CONCEPT' }),
      { params: Promise.resolve({ id: 'mk1' }) },
    )
    expect(tag.status).toBe(503)
    // Zero database access in total, and the stored rows are untouched.
    expect(totalCalls()).toBe(0)
    expect(state.mistakes.find(m => m.id === 'mk1')?.studentTag).toBeNull()
    expect(state.actions).toHaveLength(0)
  })

  it('claim-lookup failure: the failing lookup runs, nothing else proceeds', async () => {
    state.sessionStudent = { id: 'me' }
    state.claimLookupThrows = true
    const read = await masteryRoute.GET(req(`http://x/api/learning/mastery?guestId=${GUEST_CLAIMED_BY_ME}`))
    expect(read.status).toBe(503)
    const mutate = await actionsRoute.POST(req('http://x/api/learning/actions', 'POST', { guestId: GUEST_CLAIMED_BY_ME, actionKey: 'REVIEW_DUE:topic-1', decision: 'DISMISS' }))
    expect(mutate.status).toBe(503)
    // Only the (failing) ownership lookups happened — no data read or write.
    expect(dbCalls['attempt.findFirst']).toBe(2)
    expect(dbCalls['topicMastery.findMany']).toBeUndefined()
    expect(dbCalls['topicMastery.upsert']).toBeUndefined()
    expect(dbCalls['learningAction.upsert']).toBeUndefined()
    expect(state.actions).toHaveLength(0)
  })
})

describe('Riishe learner-digest gating (fail closed, chat preserved)', () => {
  const chatBody = { guestId: GUEST_CLAIMED_BY_ME, messages: [{ role: 'user', content: 'Explain Newton First Law' }] }

  it('genuine guest chat keeps the digest (pre-existing contract preserved)', async () => {
    state.sessionStudent = null
    const res = await chatRoute.POST(req('http://x/api/riishe/chat', 'POST', { ...chatBody, guestId: GUEST_UNCLAIMED }))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply?: string }
    expect(body.reply).toBeTruthy()
    expect(dbCalls['ai.chat']).toBeGreaterThanOrEqual(1)
    // The digest WAS built from real rows and entered the model context.
    expect(dbCalls['topicMastery.findMany']).toBeGreaterThanOrEqual(1)
    const system = capturedChats.at(-1)?.[0]?.content ?? ''
    expect(system).toContain('LEARNER CONTEXT')
    expect(system).toContain('Kinematics')
  })

  it('ownership verification failure: Riishe never receives the learner digest, chat still works', async () => {
    state.sessionThrows = true
    const res = await chatRoute.POST(req('http://x/api/riishe/chat', 'POST', chatBody))
    // Ordinary chat is not broken by an ownership-verification failure.
    expect(res.status).toBe(200)
    const body = await res.json() as { reply?: string }
    expect(body.reply).toBeTruthy()
    expect(dbCalls['ai.chat']).toBeGreaterThanOrEqual(1)
    // The digest was never built and never entered the model context.
    expect(dbCalls['topicMastery.findMany']).toBeUndefined()
    expect(dbCalls['revisionScheduleItem.findMany']).toBeUndefined()
    expect(dbCalls['mistakeRecord.findMany']).toBeUndefined()
    const system = capturedChats.at(-1)?.[0]?.content ?? ''
    expect(system).not.toContain('LEARNER CONTEXT')
    expect(system).not.toContain('Kinematics')
  })

  it('foreign signed-in account: digest withheld, chat still works', async () => {
    state.sessionStudent = { id: 'intruder' }
    const res = await chatRoute.POST(req('http://x/api/riishe/chat', 'POST', chatBody))
    expect(res.status).toBe(200)
    expect(dbCalls['ai.chat']).toBeGreaterThanOrEqual(1)
    expect(dbCalls['topicMastery.findMany']).toBeUndefined()
    const system = capturedChats.at(-1)?.[0]?.content ?? ''
    expect(system).not.toContain('LEARNER CONTEXT')
  })
})
