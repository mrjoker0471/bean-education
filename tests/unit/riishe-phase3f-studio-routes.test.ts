import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── Phase 3F — Studio continuity routes: ownership, lifecycle, honesty ───────
// Covers /api/riishe/studio (GET history + POST generation-persistence) and
// /api/riishe/studio/[id] (GET resume + PATCH intents + DELETE) against the
// REAL route logic with the repo's standard mock architecture.
//
//   Ownership (fail-closed, Phase 3B.1/3D.1 contract — carried into 3F):
//   O1. a foreign claimant is 403 BEFORE any database read on EVERY endpoint —
//       including the same-ID foreign-account attack (a claimed guestId plus a
//       REAL activity id that belongs to that guest must never be readable,
//       updatable or deletable by another account)
//   O2. a thrown session lookup fails closed 503 with the generic message
//   O3. guest-bearer mode keeps working; the claimant keeps access
//   O4. a client-supplied activity id for another guest is 404 (no existence
//       leak) and changes nothing
//
//   Continuity:
//   C1. generation persists the validated snapshot and returns activityId
//   C2. persistence degradation is honest: the activity is still returned,
//       without a fabricated activityId
//   C3. resume restores the stored record (never regenerates — the provider is
//       not called on resume)
//   C4. lifecycle intents work; completion is idempotent; invalid transitions
//       are 409; malformed payloads are 400
//   C5. history lists records with statuses + honest evidence roll-up
//   C6. deletion removes the record; cross-account deletion is blocked
//
//   Hygiene:
//   H1. cross-origin mutations are 403; invalid bodies are 400
//   H2. error responses carry generic text only — no activity/answer/progress
//       data ever leaks

const state = {
  sessionStudent: null as { id: string } | null,
  sessionThrows: false,
  sameOrigin: true,
  documents: [] as Record<string, unknown>[],
  attempts: [] as Record<string, unknown>[],
  activities: [] as Record<string, unknown>[],
  activitySeq: 0,
  storeCreateThrows: false,
  studioJson: null as unknown,
  studioThrows: false,
}

const dbCalls: string[] = []
const call = (key: string) => dbCalls.push(key)
let nowMs = 1_700_000_000_000
const tick = () => new Date(nowMs++)

let guestSeq = 0
const newGuest = () => `p3f-guest-${++guestSeq}`

function resetState() {
  state.sessionStudent = null
  state.sessionThrows = false
  state.sameOrigin = true
  state.documents = []
  state.attempts = []
  state.activities = []
  state.activitySeq = 0
  state.storeCreateThrows = false
  state.studioJson = MAP_FIXTURE
  state.studioThrows = false
  dbCalls.length = 0
}

const PAGE1 =
  "Newton's first law of motion states that a body continues in its state of rest unless acted upon by an external net force. This property is called inertia and it explains everyday motion."

function seedDoc(guestId: string, id: string, title = 'Physics Essentials') {
  state.documents.push({
    id,
    guestId,
    title,
    status: 'READY',
    pageCount: 1,
    updatedAt: tick(),
    extractionJson: JSON.stringify([{ page: 1, chars: PAGE1.length, text: PAGE1, scanned: false, outcome: 'extracted' }]),
  })
}

function seedClaim(guestId: string, studentId: string) {
  state.attempts.push({
    id: `a-${guestId}`,
    guestId,
    studentId,
    status: 'SUBMITTED',
    startedAt: tick(),
    submittedAt: tick(),
    questionIdsJson: '[]',
    answersJson: '{}',
    source: 'BANK',
    perTopicJson: '{}',
  })
}

/** Seed a Studio activity row directly (list/record/lifecycle tests). */
function seedActivity(guestId: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id: `act-${++state.activitySeq}`,
    guestId,
    studentId: null,
    kind: 'steps',
    topic: 'Acceleration',
    status: 'IN_PROGRESS',
    grounding: 'document',
    documentId: null,
    documentTitle: null,
    responseLanguage: 'auto',
    activityVersion: 1,
    activityJson: JSON.stringify({
      kind: 'steps',
      title: 'Solving for acceleration',
      steps: [
        { title: 'Identify variables', body: 'Find F and m.' },
        { title: 'Substitute', body: 'Insert values.' },
      ],
    }),
    progressJson: null,
    responsesJson: null,
    resultJson: null,
    createdAt: tick(),
    updatedAt: tick(),
    lastAccessedAt: tick(),
    completedAt: null,
    ...overrides,
  }
  state.activities.push(row)
  return row
}

const MINI_TEST_SNAPSHOT = {
  kind: 'mini-test',
  title: 'Quick check',
  questions: [
    { prompt: 'Q1?', options: ['a', 'b', 'c'], correctIndex: 1, explanation: 'Because b.' },
    { prompt: 'Q2?', options: ['x', 'y'], correctIndex: 0, explanation: 'Because x.' },
  ],
  honestyNote: 'Self-check note.',
}

const MAP_FIXTURE = {
  title: 'Laws of motion',
  nodes: [
    { id: 'n1', label: 'Newton\u2019s laws', parent: null, explanation: 'The three laws describe how forces change motion.' },
    { id: 'n2', label: 'First law', parent: 'n1', explanation: 'A body stays at rest without a net external force.' },
    { id: 'n3', label: 'Inertia', parent: 'n2', explanation: 'The resistance of a body to changes in its state of motion.' },
  ],
}

function filterActivities(where: Record<string, unknown>): Record<string, unknown>[] {
  const w = where ?? {}
  return state.activities.filter(r => {
    if (w.id !== undefined && r.id !== w.id) return false
    if (w.guestId !== undefined && r.guestId !== w.guestId) return false
    return true
  })
}

const fakeDb = {
  studyDocument: {
    findMany: async (args: { where?: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
      call('studyDocument.findMany')
      const w = args?.where ?? {}
      let out = state.documents.filter(d => (!('guestId' in w) || d.guestId === w.guestId) && (!('status' in w) || d.status === w.status) && (!(w.id as { in?: string[] })?.in || (w.id as { in: string[] }).in.includes(d.id as string)))
      if (args?.orderBy && typeof args.orderBy === 'object' && 'updatedAt' in (args.orderBy as Record<string, unknown>)) {
        out = [...out].sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime())
      }
      return out.slice(0, args?.take ?? out.length)
    },
  },
  attempt: {
    findFirst: async ({ where }: { where: { guestId: string } }) => {
      call('attempt.findFirst')
      return state.attempts
        .filter(a => a.guestId === where.guestId)
        .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())[0] ?? null
    },
  },
  riisheStudioActivity: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      call('riisheStudioActivity.create')
      if (state.storeCreateThrows) throw new Error('store unavailable')
      const row = {
        id: `act-${++state.activitySeq}`,
        studentId: null,
        documentId: null,
        documentTitle: null,
        responseLanguage: null,
        activityVersion: 1,
        progressJson: null,
        responsesJson: null,
        resultJson: null,
        createdAt: tick(),
        updatedAt: tick(),
        lastAccessedAt: tick(),
        completedAt: null,
        ...data,
      }
      state.activities.push(row)
      return row
    },
    findFirst: async ({ where }: { where: { id: string; guestId: string } }) => {
      call('riisheStudioActivity.findFirst')
      return filterActivities(where)[0] ?? null
    },
    findMany: async ({ where, orderBy, take }: { where: { guestId: string }; orderBy?: { updatedAt: string }; take?: number }) => {
      call('riisheStudioActivity.findMany')
      const out = filterActivities(where)
      if (orderBy?.updatedAt === 'desc') out.sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime())
      return out.slice(0, take ?? out.length)
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      call('riisheStudioActivity.update')
      const row = filterActivities(where)[0]
      if (!row) throw new Error('row missing')
      Object.assign(row, data)
      if (!('updatedAt' in data)) row.updatedAt = tick()
      return row
    },
    deleteMany: async ({ where }: { where: { id: string; guestId: string } }) => {
      call('riisheStudioActivity.deleteMany')
      const doomed = filterActivities(where)
      state.activities = state.activities.filter(r => !doomed.includes(r))
      return { count: doomed.length }
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () =>
  completeAuthMock({
    getSessionStudent: async () => {
      if (state.sessionThrows) throw new Error('session store unavailable')
      return state.sessionStudent
    },
    requireStudent: async () => {
      if (state.sessionThrows) throw new Error('session store unavailable')
      return state.sessionStudent
    },
    sameOrigin: () => state.sameOrigin,
  }),
)

// Provider boundary only (generation tests); everything else stays real.
const realAi = await import('@/lib/riishe/ai')
let providerCallCount = 0
mock.module('@/lib/riishe/ai', () => ({
  ...realAi,
  chatJson: async <T,>(): Promise<T> => {
    providerCallCount++
    if (state.studioThrows) throw new Error('empty provider response')
    return state.studioJson as T
  },
}))

const { GET: listRoute, POST: generateRoute } = await import('@/app/api/riishe/studio/route')
const { GET: recordRoute, PATCH: patchRoute, DELETE: deleteRoute } = await import('@/app/api/riishe/studio/[id]/route')

function req(url: string, init: RequestInit = {}): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

function getReq(url: string): NextRequest {
  return req(url, { headers: { 'content-type': 'application/json' } })
}

function postReq(url: string, body: unknown): NextRequest {
  return req(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  })
}

function patchReq(url: string, body: unknown): NextRequest {
  return req(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  })
}

function deleteReq(url: string, body: unknown): NextRequest {
  return req(url, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  })
}

function idCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  resetState()
  providerCallCount = 0
})

// ─── Ownership: fail-closed on every new endpoint ─────────────────────────────

describe('Phase 3F routes — fail-closed ownership on every endpoint', () => {
  it('O1-history. foreign claimant is 403 before any read on the history list', async () => {
    const victimGuest = 'guest-owned-by-victim'
    seedClaim(victimGuest, 'someone-else')
    state.sessionStudent = { id: 'attacker' }

    const res = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${victimGuest}`))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('This learning history belongs to a different account.')
    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])
  })

  it('O1-record. SAME-ID foreign-account attack: a claimed guestId plus a real activity id is 403 before any read', async () => {
    const victimGuest = 'guest-owned-by-victim'
    const row = seedActivity(victimGuest)
    seedClaim(victimGuest, 'victim-account')
    state.sessionStudent = { id: 'attacker-account' }

    const res = await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=${victimGuest}`), idCtx(row.id))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('This learning history belongs to a different account.')
    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])

    // The same attack on the mutation endpoints.
    const patchRes = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: victimGuest, progress: { stepIndex: 0, maxStepReached: 0 } }), idCtx(row.id))
    expect(patchRes.status).toBe(403)
    const deleteRes = await deleteRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: victimGuest }), idCtx(row.id))
    expect(deleteRes.status).toBe(403)
    const completeRes = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: victimGuest, action: 'complete' }), idCtx(row.id))
    expect(completeRes.status).toBe(403)
    // Nothing changed, nothing was read.
    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])
    expect(state.activities[0].status).toBe('IN_PROGRESS')
    expect(state.activities[0].progressJson).toBeNull()
  })

  it('O2. a thrown session lookup fails closed 503 with the generic message on GET/PATCH/DELETE', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)
    state.sessionThrows = true

    const list = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}`))
    expect(list.status).toBe(503)
    expect(await (list.json() as Promise<{ error: string }>)).toEqual({ error: 'Account ownership could not be verified. Please retry.' })

    const record = await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=${gid}`), idCtx(row.id))
    expect(record.status).toBe(503)

    const patch = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, action: 'abandon' }), idCtx(row.id))
    expect(patch.status).toBe(503)

    const del = await deleteRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid }), idCtx(row.id))
    expect(del.status).toBe(503)

    expect(dbCalls.filter(c => c.startsWith('riisheStudioActivity'))).toEqual([])
    expect(state.activities[0].status).toBe('IN_PROGRESS')
  })

  it('O3. guest-bearer mode keeps working and the claimant keeps access', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)

    const guestList = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}`))
    expect(guestList.status).toBe(200)

    const guestRecord = await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=${gid}`), idCtx(row.id))
    expect(guestRecord.status).toBe(200)

    // Claimed by the signed-in session owner — still accessible.
    seedClaim(gid, 'me')
    state.sessionStudent = { id: 'me' }
    const claimantRecord = await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=${gid}`), idCtx(row.id))
    expect(claimantRecord.status).toBe(200)
  })

  it('O4. a client-supplied activity id for ANOTHER guest is 404 and changes nothing (no session = guest bearer)', async () => {
    const victim = newGuest()
    const row = seedActivity(victim)
    const attacker = newGuest()

    const record = await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=${attacker}`), idCtx(row.id))
    expect(record.status).toBe(404)
    expect(await (record.json() as Promise<{ error: string }>)).toEqual({ error: 'Activity not found' })

    const patch = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: attacker, action: 'abandon' }), idCtx(row.id))
    expect(patch.status).toBe(404)

    const del = await deleteRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: attacker }), idCtx(row.id))
    expect(del.status).toBe(404)

    expect(state.activities[0].status).toBe('IN_PROGRESS')
    expect(state.activities).toHaveLength(1)
  })
})

// ─── Continuity: generation persistence, resume, lifecycle ────────────────────

describe('Phase 3F routes — continuity', () => {
  it('C1. generation persists the validated snapshot IN_PROGRESS and returns activityId', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-c1')
    const res = await generateRoute(postReq('http://x/api/riishe/studio', { guestId: gid, kind: 'concept-map', documentId: 'doc-c1', topic: 'Laws of motion' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { activityId?: string; activity: { kind: string } }
    expect(body.activityId).toBeTruthy()
    expect(providerCallCount).toBe(1)
    expect(state.activities).toHaveLength(1)
    expect(state.activities[0].status).toBe('IN_PROGRESS')
    expect(state.activities[0].guestId).toBe(gid)
    expect(JSON.parse(state.activities[0].activityJson as string).kind).toBe('concept-map')
    expect(state.activities[0].documentId).toBe('doc-c1')
    expect(state.activities[0].documentTitle).toBe('Physics Essentials')
  })

  it('C2. persistence degradation is honest: generation still succeeds with NO fabricated activityId', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-c2')
    state.storeCreateThrows = true
    const res = await generateRoute(postReq('http://x/api/riishe/studio', { guestId: gid, kind: 'concept-map', documentId: 'doc-c2', topic: 'Motion' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { activityId?: string }
    expect(body.activityId).toBeUndefined()
    expect(state.activities).toHaveLength(0)
  })

  it('C3. resume restores the stored record and NEVER calls the provider', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)
    const res = await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=${gid}`), idCtx(row.id))
    expect(res.status).toBe(200)
    const body = await res.json() as { record: { id: string; activity: { kind: string }; status: string } }
    expect(body.record.id).toBe(row.id)
    expect(body.record.activity.kind).toBe('steps')
    expect(body.record.status).toBe('IN_PROGRESS')
    expect(providerCallCount).toBe(0)
  })

  it('C4a. PATCH progress saves; PATCH complete records once; repeated completion is idempotent', async () => {
    const gid = newGuest()
    seedActivity(gid, {
      kind: 'mini-test',
      activityJson: JSON.stringify(MINI_TEST_SNAPSHOT),
    })
    const row = state.activities[0]

    const save = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, progress: { index: 0, answers: [1, null], submitted: [true, false], finished: false }, responses: { answers: [1, null] } }), idCtx(row.id as string))
    expect(save.status).toBe(200)

    const complete = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, action: 'complete', responses: { answers: [1, 1] } }), idCtx(row.id as string))
    expect(complete.status).toBe(200)
    const done = await complete.json() as { record: { status: string; result: { type: string; percent: number } }; alreadyCompleted: boolean }
    expect(done.alreadyCompleted).toBe(false)
    expect(done.record.status).toBe('COMPLETED')
    // SERVER-recomputed from the snapshot: Q1 correct (index 1), Q2 wrong
    // (index 1 ≠ correctIndex 0) → 1 of 2 = 50%.
    expect(done.record.result.percent).toBe(50)

    // Repeat submission: idempotent, unchanged, no duplicate.
    const repeat = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, action: 'complete', responses: { answers: [0, 0] } }), idCtx(row.id as string))
    expect(repeat.status).toBe(200)
    const again = await repeat.json() as { record: { result: { percent: number } }; alreadyCompleted: boolean }
    expect(again.alreadyCompleted).toBe(true)
    expect(again.record.result.percent).toBe(50)
  })

  it('C4b. invalid transitions are 409 and malformed payloads are 400 (no client status field exists)', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)

    // Abandon, then try to complete → 409.
    const abandon = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, action: 'abandon' }), idCtx(row.id))
    expect(abandon.status).toBe(200)
    const completeAfterAbandon = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, action: 'complete' }), idCtx(row.id))
    expect(completeAfterAbandon.status).toBe(409)

    // Progress on an abandoned row → 409.
    const progressAfterAbandon = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, progress: { stepIndex: 0, maxStepReached: 0 } }), idCtx(row.id))
    expect(progressAfterAbandon.status).toBe(409)

    // Malformed progress → 400.
    const row2 = seedActivity(gid)
    const badProgress = await patchRoute(patchReq(`http://x/api/riishe/studio/${row2.id}`, { guestId: gid, progress: 'garbage' }), idCtx(row2.id))
    expect(badProgress.status).toBe(400)

    // An empty PATCH (no intent) → 400.
    const empty = await patchRoute(patchReq(`http://x/api/riishe/studio/${row2.id}`, { guestId: gid }), idCtx(row2.id))
    expect(empty.status).toBe(400)
  })

  it('C5. history lists records with statuses and honest evidence roll-up', async () => {
    const gid = newGuest()
    seedActivity(gid, { topic: 'Done deal', kind: 'mini-test', activityJson: JSON.stringify(MINI_TEST_SNAPSHOT), status: 'COMPLETED', resultJson: JSON.stringify({ type: 'mini-test', correct: 1, answered: 2, total: 2, percent: 50 }), completedAt: tick() })
    seedActivity(gid, { topic: 'WIP', status: 'IN_PROGRESS' })

    const res = await listRoute(getReq(`http://x/api/riishe/studio?guestId=${gid}`))
    expect(res.status).toBe(200)
    const body = await res.json() as { items: { id: string; status: string; topic: string }[]; evidence: { completed: number; inProgress: number; miniTestsCompleted: number; miniTestPercentAvg: number | null } }
    expect(body.items).toHaveLength(2)
    const statuses = body.items.map(i => i.status).sort()
    expect(statuses).toEqual(['COMPLETED', 'IN_PROGRESS'])
    expect(body.evidence.completed).toBe(1)
    expect(body.evidence.inProgress).toBe(1)
    expect(body.evidence.miniTestsCompleted).toBe(1)
    expect(body.evidence.miniTestPercentAvg).toBe(50)
  })

  it('C6. DELETE removes the owned record; cross-account deletion is blocked', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)

    const foreign = await deleteRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: 'g-not-the-owner' }), idCtx(row.id))
    expect(foreign.status).toBe(404)
    expect(state.activities).toHaveLength(1)

    const ok = await deleteRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid }), idCtx(row.id))
    expect(ok.status).toBe(200)
    expect(state.activities).toHaveLength(0)
  })
})

// ─── Hygiene ──────────────────────────────────────────────────────────────────

describe('Phase 3F routes — request hygiene and leak-safety', () => {
  it('H1. cross-origin mutations are 403; invalid bodies are 400', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)

    state.sameOrigin = false
    const crossOrigin = await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, action: 'abandon' }), idCtx(row.id))
    expect(crossOrigin.status).toBe(403)
    expect(await (crossOrigin.json() as Promise<{ error: string }>)).toEqual({ error: 'Cross-origin request blocked' })
    const crossOriginDelete = await deleteRoute(deleteReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid }), idCtx(row.id))
    expect(crossOriginDelete.status).toBe(403)
    state.sameOrigin = true

    expect((await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=short`), idCtx(row.id))).status).toBe(400)
    expect((await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, 'not json at all' as unknown as Record<string, unknown>), idCtx(row.id))).status).toBe(400)
    expect((await listRoute(getReq('http://x/api/riishe/studio'))).status).toBe(400)
    // Generation still rejects invalid bodies (3E contract preserved).
    expect((await generateRoute(postReq('http://x/api/riishe/studio', { guestId: gid, kind: 'not-a-kind' }))).status).toBe(400)
  })

  it('H2. error responses carry generic text only — no activity, answer or progress data', async () => {
    const gid = newGuest()
    const row = seedActivity(gid)
    const responses = [
      await recordRoute(getReq(`http://x/api/riishe/studio/${row.id}?guestId=g-foreign-guest`), idCtx(row.id)),
      await patchRoute(patchReq(`http://x/api/riishe/studio/${row.id}`, { guestId: gid, progress: 'garbage' }), idCtx(row.id)),
    ]
    for (const res of responses) {
      const body = JSON.stringify(await res.json())
      expect(body).not.toContain('acceleration')
      expect(body).not.toContain('Identify variables')
      expect(body).not.toContain('answers')
      expect(body).not.toContain('stepIndex')
    }
  })
})
