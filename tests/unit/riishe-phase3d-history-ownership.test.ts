import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── Phase 3D.1 — Riishe conversation-history ownership hardening ─────────────
// Phase 3D gave the chat-history GET a persisted, content-bearing payload
// (turns, sources, preference metadata) but the GET still trusted the raw
// guestId param: a signed-in account that knew (or guessed) a guest identity
// CLAIMED by someone else could read that identity's whole conversation.
// This suite proves the correction — assertLearningOwner runs BEFORE the
// protected riisheChatTurn.findMany — for every ownership outcome:
//   1. genuine unauthenticated guest keeps loading their history;
//   2. the signed-in claimant keeps access to their own claimed identity;
//   3. a foreign signed-in account requesting the SAME claimed guest ID
//      receives 403 (the existing ownership response, nothing else leaked);
//   4. that 403 happens before riisheChatTurn.findMany;
//   5. a thrown session-verification error returns 503 (generic message);
//   6. a session-verification failure causes ZERO history database reads;
//   7. a claimed-account lookup failure returns 503;
//   8. a claim-lookup failure never falls back to guest access;
//   9. same-ID protection is proven against the SAME claimed guest ID — a
//      different random guest ID (the decoy pattern) proves nothing;
//  10. the document / hub / per-question scope filters are unchanged;
//  11. Phase 3D preference restoration through the history GET still works;
//  13. ordinary guest POST chat still works end-to-end (Phase 3B.1 contract:
//      chat proceeds when ownership cannot be verified, digest withheld).
// Scenarios 11/12 are additionally covered by RUNNING the existing suites:
// riishe-phase3d-chat-preferences.test.ts (Phase 3D) and
// learning-ownership-fail-closed.test.ts (Phase 3B.1), plus
// riishe-tutor-chat.test.ts (Phase 3C) in the verification step.
//
// Uses the REAL '@/lib/learning/scope' ownership helper (only '@/lib/db' and
// '@/lib/auth' are module-mocked — the auth mock is the complete surface from
// tests/helpers/auth-mock.ts) and never contacts a paid AI provider (the
// provider boundary alone is stubbed).

const GUEST_CLAIMED = 'p3d1-guest-claimed-identity'
const GUEST_UNCLAIMED = 'p3d1-guest-unclaimed-ok'
const DECOY_GUEST = 'p3d1-decoy-random-guest'
const CLAIMANT_ID = 'owner-1'
const INTRUDER_ID = 'intruder-9'
const FOREIGN_403 = 'This learning history belongs to a different account.'
const GENERIC = 'Account ownership could not be verified. Please retry.'
const CLAIMANT_ONLY_MARKER = 'CLAIMANT-ONLY-CONTEXT-7f3a'

const state = {
  sessionStudent: null as { id: string } | null,
  sessionThrows: false,
  claimLookupThrows: false,
  attempts: [] as Record<string, unknown>[],
  chatTurns: [] as Record<string, unknown>[],
  documents: [] as Record<string, unknown>[],
  mastery: [] as Record<string, unknown>[],
}

// Per-model call recorder — proves the protected history read never happens
// after a failed ownership check.
const dbCalls: Record<string, number> = {}
const call = (key: string) => { dbCalls[key] = (dbCalls[key] ?? 0) + 1 }
const totalCalls = () => Object.values(dbCalls).reduce((a, b) => a + b, 0)
function dbCallsClear() { for (const k of Object.keys(dbCalls)) delete dbCalls[k] }

/** Last where-clause the GET handed to riisheChatTurn.findMany. */
let lastChatFindWhere: Record<string, unknown> | null = null

let turnSeq = 0
const nextTurnId = () => `p3d1-turn-${++turnSeq}`

// Monotonic fake clock for rows created through the mocked create(): two turns
// written in the same millisecond must never tie on createdAt (the route sorts
// desc then reverses, so a tie would make the reload order ambiguous).
let fakeClockMs = Date.now()

function resetState() {
  state.sessionStudent = null
  state.sessionThrows = false
  state.claimLookupThrows = false
  dbCallsClear()
  lastChatFindWhere = null
  fakeClockMs = Date.now()
  state.attempts = []
  state.chatTurns = []
  state.documents = []
  state.mastery = []
  // The claim under test: GUEST_CLAIMED was claimed by CLAIMANT_ID — its most
  // recent attempt carries the claimant's studentId (the real claim model).
  state.attempts.push({ id: 'a-claim', guestId: GUEST_CLAIMED, studentId: CLAIMANT_ID, status: 'SUBMITTED', startedAt: new Date(Date.now() - 60_000), submittedAt: new Date(), questionIdsJson: '[]', answersJson: '{}', source: 'BANK', perTopicJson: '{}' })
}

function seedTurn(guestId: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id: nextTurnId(),
    guestId,
    studentId: null,
    documentId: null,
    attemptId: null,
    questionId: null,
    researchSessionId: null,
    role: 'assistant',
    content: 'Seeded conversation turn for the Phase 3D.1 ownership suite.',
    pagesCitedJson: '[]',
    grounding: 'general',
    sourcesJson: '[]',
    tutorMode: null,
    responseLanguage: null,
    createdAt: new Date(Date.now() - 30_000),
    ...overrides,
  }
  state.chatTurns.push(row)
  return row
}

/** Row filter honouring the exact where shapes the chat-history GET builds. */
function filterRows(rows: Record<string, unknown>[], where: Record<string, unknown>): Record<string, unknown>[] {
  let out = rows
  const w = where ?? {}
  for (const key of ['guestId', 'studentId', 'documentId', 'attemptId', 'questionId', 'researchSessionId'] as const) {
    if (key in w) out = out.filter(r => r[key] === w[key])
  }
  return out
}

const fakeDb = {
  $transaction: async (input: unknown) => (Array.isArray(input) ? Promise.all(input as Promise<unknown>[]) : input),
  attempt: {
    findFirst: async ({ where }: { where: { guestId: string } }) => {
      call('attempt.findFirst')
      if (state.claimLookupThrows) throw new Error('db unavailable: attempt lookup failed')
      return state.attempts
        .filter(a => a.guestId === where.guestId)
        .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())[0] ?? null
    },
    findUnique: async ({ where }: { where: { id: string } }) => { call('attempt.findUnique'); return state.attempts.find(a => a.id === where.id) ?? null },
    findMany: async ({ where }: { where: Record<string, unknown> }) => { call('attempt.findMany'); return state.attempts.filter(a => a.guestId === where.guestId) },
    count: async () => { call('attempt.count'); return state.attempts.length },
  },
  studyDocument: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => { call('studyDocument.findMany'); return state.documents.filter(d => d.guestId === where.guestId && (!where.status || d.status === where.status)) },
    findUnique: async ({ where }: { where: { id: string } }) => { call('studyDocument.findUnique'); return state.documents.find(d => d.id === where.id) ?? null },
  },
  riisheTest: { findMany: async () => [], findUnique: async () => null },
  researchSession: { findFirst: async () => { call('researchSession.findFirst'); return null }, findMany: async () => [] },
  researchPyqCandidate: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
  topicMastery: {
    findMany: async ({ where }: { where: { guestId: string } }) => { call('topicMastery.findMany'); return state.mastery.filter(r => r.guestId === where.guestId) },
    findFirst: async ({ where }: { where: { guestId: string } }) => { call('topicMastery.findFirst'); return state.mastery.filter(r => r.guestId === where.guestId)[0] ?? null },
    findUnique: async () => { call('topicMastery.findUnique'); return null },
    upsert: async ({ create }: { create: Record<string, unknown> }) => { call('topicMastery.upsert'); const row = { ...create, id: `tm-${state.mastery.length + 1}` }; state.mastery.push(row); return row },
    updateMany: async () => { call('topicMastery.updateMany'); return { count: 0 } },
    deleteMany: async () => { call('topicMastery.deleteMany'); return { count: 0 } },
    count: async () => { call('topicMastery.count'); return state.mastery.length },
  },
  studyPlanTask: { findMany: async () => { call('studyPlanTask.findMany'); return [] }, createMany: async () => { call('studyPlanTask.createMany'); return { count: 0 } }, deleteMany: async () => { call('studyPlanTask.deleteMany'); return { count: 0 } } },
  revisionScheduleItem: {
    findMany: async () => { call('revisionScheduleItem.findMany'); return [] },
    findUnique: async () => { call('revisionScheduleItem.findUnique'); return null },
    create: async ({ data }: { data: Record<string, unknown> }) => { call('revisionScheduleItem.create'); return { ...data, id: 'rs-1' } },
    update: async () => { call('revisionScheduleItem.update'); return {} },
  },
  mistakeRecord: {
    findMany: async () => { call('mistakeRecord.findMany'); return [] },
    findUnique: async () => { call('mistakeRecord.findUnique'); return null },
    groupBy: async () => { call('mistakeRecord.groupBy'); return [] },
    count: async () => { call('mistakeRecord.count'); return 0 },
    createMany: async () => { call('mistakeRecord.createMany'); return { count: 0 } },
  },
  learningAction: { findMany: async () => { call('learningAction.findMany'); return [] }, findFirst: async () => { call('learningAction.findFirst'); return null }, upsert: async ({ create }: { create: Record<string, unknown> }) => { call('learningAction.upsert'); return { ...create, id: 'la-1' } }, deleteMany: async () => { call('learningAction.deleteMany'); return { count: 0 } } },
  studyGoal: { findMany: async () => { call('studyGoal.findMany'); return [] } },
  riisheQuestion: { findUnique: async ({ where }: { where: { id: string } }) => { call('riisheQuestion.findUnique'); return null }, findMany: async () => [] },
  riisheExplanation: { findUnique: async () => { call('riisheExplanation.findUnique'); return null }, findMany: async () => [] },
  riisheChatTurn: {
    findMany: async (args: { where: Record<string, unknown>; orderBy?: { createdAt: string }; take?: number }) => {
      call('riisheChatTurn.findMany')
      lastChatFindWhere = args.where
      const rows = filterRows(state.chatTurns, args.where)
      return [...rows]
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
        .slice(0, args?.take ?? rows.length)
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      call('riisheChatTurn.create')
      const row = {
        studentId: null,
        researchSessionId: null,
        pagesCitedJson: null,
        grounding: null,
        sourcesJson: null,
        tutorMode: null,
        responseLanguage: null,
        ...data,
        id: nextTurnId(),
        createdAt: new Date(fakeClockMs++),
      }
      state.chatTurns.push(row)
      return row
    },
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

// Provider boundary only — the real fence/tag/citation/disclosure helpers stay
// active; no paid AI provider is ever contacted.
const realAi = await import('@/lib/riishe/ai')
const capturedChats: { role: string; content: string }[][] = []
mock.module('@/lib/riishe/ai', () => ({
  ...realAi,
  chat: async (messages: { role: string; content: string }[]) => {
    call('ai.chat')
    capturedChats.push(messages)
    return '[SOURCES: GENERAL] Mocked tutor reply for the Phase 3D.1 ownership suite.'
  },
  webSearch: async () => [],
}))

const { POST, GET } = await import('@/app/api/riishe/chat/route')
// The REAL ownership helper — asserted to be the genuine implementation.
const { assertLearningOwner, OWNERSHIP_UNVERIFIED_MESSAGE } = await import('@/lib/learning/scope')

function getReq(params: Record<string, string>): NextRequest {
  const q = new URLSearchParams(params).toString()
  return new Request(`http://x/api/riishe/chat?${q}`, { headers: { origin: 'http://x' } }) as unknown as NextRequest
}

function chatReq(body: unknown): NextRequest {
  return new Request('http://x/api/riishe/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(resetState)

// ─── Guard sanity: the real helper is in the loop ─────────────────────────────

describe('Phase 3D.1 setup — real ownership helper, real claim model', () => {
  it('assertLearningOwner is the real fail-closed helper (not a stub)', async () => {
    // Guest-bearer completes; a thrown session check fails closed with 503.
    state.sessionStudent = null
    await expect(assertLearningOwner(GUEST_UNCLAIMED)).resolves.toEqual({ ok: true })
    state.sessionThrows = true
    const result = await assertLearningOwner(GUEST_CLAIMED)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(503)
    expect(OWNERSHIP_UNVERIFIED_MESSAGE).toBe(GENERIC)
    state.sessionThrows = false
    state.sessionStudent = { id: INTRUDER_ID }
    const foreign = await assertLearningOwner(GUEST_CLAIMED)
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.status).toBe(403)
  })
})

// ─── Allowed outcomes ──────────────────────────────────────────────────────────

describe('Phase 3D.1 — history access that must keep working', () => {
  it('1. a genuine unauthenticated guest can load their persisted history', async () => {
    seedTurn(GUEST_UNCLAIMED, { role: 'user', content: 'What is Newton First Law?', documentId: 'doc-a', createdAt: new Date(Date.now() - 20_000) })
    seedTurn(GUEST_UNCLAIMED, { role: 'assistant', content: 'Newton First Law states that inertia...', documentId: 'doc-a', createdAt: new Date(Date.now() - 10_000) })
    const res = await GET(getReq({ guestId: GUEST_UNCLAIMED, documentId: 'doc-a' }))
    expect(res.status).toBe(200)
    const { turns } = await res.json() as { turns: { role: string; content: string }[] }
    expect(turns).toHaveLength(2)
    // Newest last (the documented reload order).
    expect(turns[0].role).toBe('user')
    expect(turns[1].role).toBe('assistant')
    expect(turns[1].content).toContain('Newton First Law states')
  })

  it('2. the signed-in claimant can load their own claimed guest history', async () => {
    state.sessionStudent = { id: CLAIMANT_ID }
    seedTurn(GUEST_CLAIMED, { role: 'assistant', content: `Answer for the claimant ${CLAIMANT_ONLY_MARKER}`, createdAt: new Date(Date.now() - 5_000) })
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res.status).toBe(200)
    const { turns } = await res.json() as { turns: { content: string }[] }
    expect(turns).toHaveLength(1)
    expect(turns[0].content).toContain(CLAIMANT_ONLY_MARKER)
    expect(dbCalls['riisheChatTurn.findMany']).toBe(1)
  })
})

// ─── Foreign claimant → 403 before the protected read ─────────────────────────

describe('Phase 3D.1 — foreign signed-in account is rejected', () => {
  it('3. a foreign account requesting the SAME claimed guest ID gets the existing 403 ownership response', async () => {
    state.sessionStudent = { id: INTRUDER_ID }
    seedTurn(GUEST_CLAIMED, { role: 'assistant', content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error?: string; turns?: unknown[] }
    expect(body.error).toBe(FOREIGN_403)
    // No conversation contents, preference metadata or account details leak.
    expect(body.turns).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain(CLAIMANT_ONLY_MARKER)
    expect(JSON.stringify(body)).not.toContain(CLAIMANT_ID)
    expect(JSON.stringify(body)).not.toContain('tutorMode')
    // The stored rows are untouched.
    expect(state.chatTurns).toHaveLength(1)
  })

  it('4. the foreign-account 403 happens before riisheChatTurn.findMany', async () => {
    state.sessionStudent = { id: INTRUDER_ID }
    seedTurn(GUEST_CLAIMED, { content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    dbCallsClear()
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res.status).toBe(403)
    // Exactly ONE database call ran — the guard's own claim lookup that detects
    // the foreign claimant — and the protected history read never did.
    expect(dbCalls['attempt.findFirst']).toBe(1)
    expect(dbCalls['riisheChatTurn.findMany']).toBeUndefined()
    expect(totalCalls()).toBe(1)
  })

  it('9. same-ID ownership protection is proven against the SAME claimed guest ID — not a random decoy ID', async () => {
    state.sessionStudent = { id: INTRUDER_ID }
    seedTurn(GUEST_CLAIMED, { content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    // Decoy first: a DIFFERENT random guest ID is unclaimed, so guest-bearer
    // returns 200 with an empty list. That response proves NOTHING about
    // same-ID protection — which is exactly why this suite also fires the
    // same-ID request below.
    const decoy = await GET(getReq({ guestId: DECOY_GUEST }))
    expect(decoy.status).toBe(200)
    const decoyBody = await decoy.json() as { turns: { content: string }[] }
    expect(decoyBody.turns).toHaveLength(0)
    expect(dbCalls['riisheChatTurn.findMany']).toBe(1)
    // Now the critical request: the SAME guest ID the claimant owns.
    dbCallsClear()
    lastChatFindWhere = null
    const sameId = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(sameId.status).toBe(403)
    const body = await sameId.json() as { error: string }
    expect(body.error).toBe(FOREIGN_403)
    // The same-ID 403 fired BEFORE any protected read for that identity.
    expect(dbCalls['riisheChatTurn.findMany']).toBeUndefined()
    expect(lastChatFindWhere).toBeNull()
  })
})

// ─── Fail-closed outcomes (503) ───────────────────────────────────────────────

describe('Phase 3D.1 — verification failures fail closed', () => {
  it('5. a thrown session-verification error returns 503 with the generic message', async () => {
    seedTurn(GUEST_CLAIMED, { content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    // Even with NO session row present, a throw is not "no session".
    state.sessionThrows = true
    state.sessionStudent = null
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toBe(GENERIC)
    expect(body.error).not.toContain('session store')
    // The same outcome when a session WAS expected to exist.
    state.sessionStudent = { id: CLAIMANT_ID }
    const res2 = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res2.status).toBe(503)
    const body2 = await res2.json() as { error: string }
    expect(body2.error).toBe(GENERIC)
  })

  it('6. a session-verification failure causes ZERO history database reads', async () => {
    seedTurn(GUEST_CLAIMED, { content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    state.sessionThrows = true
    dbCallsClear()
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res.status).toBe(503)
    // The guard fails at the session step — no history read, no claim lookup.
    expect(dbCalls['riisheChatTurn.findMany']).toBeUndefined()
    expect(dbCalls['attempt.findFirst']).toBeUndefined()
    expect(totalCalls()).toBe(0)
    // The rows were never touched.
    expect(state.chatTurns).toHaveLength(1)
  })

  it('7. a claimed-account lookup failure returns 503 with the generic message', async () => {
    state.sessionStudent = { id: CLAIMANT_ID }
    state.claimLookupThrows = true
    seedTurn(GUEST_CLAIMED, { content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toBe(OWNERSHIP_UNVERIFIED_MESSAGE)
    expect(body.error).toBe(GENERIC)
  })

  it('8. a claim-lookup failure never falls back to guest access', async () => {
    state.sessionStudent = { id: CLAIMANT_ID }
    state.claimLookupThrows = true
    seedTurn(GUEST_CLAIMED, { content: `Secret reply ${CLAIMANT_ONLY_MARKER}` })
    dbCallsClear()
    const res = await GET(getReq({ guestId: GUEST_CLAIMED }))
    // Not 200, not 403-as-unclaimed — an explicit 503.
    expect(res.status).toBe(503)
    // Exactly the (failing) ownership lookup ran; the protected read never did.
    expect(dbCalls['attempt.findFirst']).toBe(1)
    expect(dbCalls['riisheChatTurn.findMany']).toBeUndefined()
    // The identity's history is intact and was never returned as guest data.
    expect(state.chatTurns).toHaveLength(1)
    const body = await res.json() as { error: string; turns?: unknown[] }
    expect(body.turns).toBeUndefined()
  })
})

// ─── Unchanged scope contract + preference restoration + guest chat ──────────

describe('Phase 3D.1 — existing behaviour preserved', () => {
  it('10. document, hub and per-question history scope filters remain unchanged', async () => {
    seedTurn(GUEST_UNCLAIMED, { role: 'user', content: 'doc question', documentId: 'doc-a', createdAt: new Date(Date.now() - 40_000) })
    seedTurn(GUEST_UNCLAIMED, { role: 'assistant', content: 'doc answer', documentId: 'doc-a', createdAt: new Date(Date.now() - 39_000) })
    seedTurn(GUEST_UNCLAIMED, { role: 'assistant', content: 'hub answer', documentId: null, attemptId: null, createdAt: new Date(Date.now() - 20_000) })
    seedTurn(GUEST_UNCLAIMED, { role: 'user', content: 'review question', attemptId: 'att-1', questionId: 'q-1', createdAt: new Date(Date.now() - 10_000) })

    // Document scope: only that document's turns, no attempt rows.
    const docRes = await GET(getReq({ guestId: GUEST_UNCLAIMED, documentId: 'doc-a' }))
    expect(docRes.status).toBe(200)
    expect(lastChatFindWhere).toEqual({ guestId: GUEST_UNCLAIMED, documentId: 'doc-a', attemptId: null })
    const docTurns = (await docRes.json() as { turns: { content: string }[] }).turns
    expect(docTurns.map(t => t.content)).toEqual(['doc question', 'doc answer'])

    // Hub scope: documentId null AND attemptId null.
    const hubRes = await GET(getReq({ guestId: GUEST_UNCLAIMED }))
    expect(hubRes.status).toBe(200)
    expect(lastChatFindWhere).toEqual({ guestId: GUEST_UNCLAIMED, documentId: null, attemptId: null })
    const hubTurns = (await hubRes.json() as { turns: { content: string }[] }).turns
    expect(hubTurns.map(t => t.content)).toEqual(['hub answer'])

    // Per-question review scope: attemptId + questionId together.
    const qRes = await GET(getReq({ guestId: GUEST_UNCLAIMED, attemptId: 'att-1', questionId: 'q-1' }))
    expect(qRes.status).toBe(200)
    expect(lastChatFindWhere).toEqual({ guestId: GUEST_UNCLAIMED, attemptId: 'att-1', questionId: 'q-1' })
    const qTurns = (await qRes.json() as { turns: { content: string }[] }).turns
    expect(qTurns.map(t => t.content)).toEqual(['review question'])
  })

  it('11. Phase 3D preference restoration through the history GET still works after the guard', async () => {
    seedTurn(GUEST_UNCLAIMED, { role: 'assistant', content: 'older reply', tutorMode: 'EXPLAIN', responseLanguage: 'en', createdAt: new Date(Date.now() - 60_000) })
    seedTurn(GUEST_UNCLAIMED, { role: 'assistant', content: 'newer reply', tutorMode: 'SOCRATIC', responseLanguage: 'ta', createdAt: new Date(Date.now() - 10_000) })
    // A legacy pre-3D row normalises to null, never to a fabricated value.
    seedTurn(GUEST_UNCLAIMED, { role: 'assistant', content: 'legacy reply', tutorMode: undefined, responseLanguage: undefined, createdAt: new Date(Date.now() - 5_000) })
    const res = await GET(getReq({ guestId: GUEST_UNCLAIMED }))
    expect(res.status).toBe(200)
    const { turns } = await res.json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    expect(turns).toHaveLength(3)
    // User turns never carry preference metadata; assistant turns carry the
    // stored values, unknown/missing values normalise to null.
    for (const t of turns) {
      if (t.role !== 'assistant') {
        expect(t.tutorMode).toBeNull()
        expect(t.responseLanguage).toBeNull()
      }
    }
    expect(turns[0].tutorMode).toBe('EXPLAIN')
    expect(turns[0].responseLanguage).toBe('en')
    expect(turns[1].tutorMode).toBe('SOCRATIC')
    expect(turns[1].responseLanguage).toBe('ta')
    expect(turns[2].tutorMode).toBeNull()
    expect(turns[2].responseLanguage).toBeNull()
  })

  it('13. ordinary guest POST chat still works end-to-end, then loads through the guarded history GET', async () => {
    // Genuine guest (session resolution completes, no session).
    const res = await POST(chatReq({ guestId: GUEST_UNCLAIMED, messages: [{ role: 'user', content: 'Explain Newton First Law' }] }))
    expect(res.status).toBe(200)
    const body = await res.json() as { reply?: string; tutorMode?: string; responseLanguage?: string }
    expect(body.reply).toBeTruthy()
    expect(body.tutorMode).toBe('EXPLAIN')
    expect(body.responseLanguage).toBe('auto')
    expect(dbCalls['ai.chat']).toBeGreaterThanOrEqual(1)
    const stored = state.chatTurns.filter(t => t.guestId === GUEST_UNCLAIMED)
    expect(stored.map(t => t.role)).toEqual(['user', 'assistant'])
    // The very same turns come back through the guarded history read.
    const hist = await GET(getReq({ guestId: GUEST_UNCLAIMED }))
    expect(hist.status).toBe(200)
    const { turns } = await hist.json() as { turns: { role: string; content: string }[] }
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant'])
    expect(turns[1].content).toContain('Mocked tutor reply for the Phase 3D.1 ownership suite.')
  })

  it('12. Phase 3B.1 chat contract intact: ownership verification failure never breaks guest chat and never leaks the digest', async () => {
    state.sessionThrows = true
    state.mastery.push({ id: 'm-1', guestId: GUEST_UNCLAIMED, topicId: 'topic-1', topicName: 'Laws of Motion', examLabel: 'JEE', status: 'LEARNING', accuracy: 40, evidenceQuestions: 6, attemptCount: 1, correctDistinct: 2, statusReason: 'x', lastActivityAt: new Date() })
    const res = await POST(chatReq({ guestId: GUEST_UNCLAIMED, messages: [{ role: 'user', content: 'Explain inertia' }] }))
    // Chat still answers under its documented conditions.
    expect(res.status).toBe(200)
    const body = await res.json() as { reply?: string }
    expect(body.reply).toBeTruthy()
    expect(dbCalls['ai.chat']).toBeGreaterThanOrEqual(1)
    // The private learner digest was never built and never entered the prompt.
    expect(dbCalls['topicMastery.findMany']).toBeUndefined()
    const system = capturedChats.at(-1)?.[0]?.content ?? ''
    expect(system).not.toContain('LEARNER CONTEXT')
    expect(system).not.toContain('Laws of Motion')
  })
})
