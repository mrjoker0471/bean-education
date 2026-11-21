import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── Phase 3D — Riishe conversation continuity & preference isolation ────────
// Covers the required Phase 3D persistence behaviours against the REAL route
// logic (src/app/api/riishe/chat/route.ts) and the REAL lifecycle routes:
//   A1. the assistant turn stores the tutorMode + responseLanguage in force
//   A2. omitted fields store the documented defaults (EXPLAIN / auto)
//   A3. the user turn never carries preference metadata
//   A4. GET (chat-history API) returns the stored preferences
//   A5. legacy rows (missing/unknown preference values) normalise to null
//   A6. the most recent assistant-turn preference wins on reload
//   A7. preferences never transfer between document scopes (strict where)
//   A8. per-question review chat stores its own scoped preferences
//   A9. hub chat (all-materials and explicit multi-document scope) stores
//       preferences under the hub scope (documentId null)
//  D1. account claim preserves the preference fields untouched (studentId only)
//  D2. account export includes the preference fields
//  D3. account data deletion removes turns and their preferences (whole row)
//  D5. old conversation records with missing preference fields keep working
//  D6. preference metadata never grants access: fail-closed ownership still
//      withholds the learner digest, and history stays guest-scoped
//  D7. research follow-ups stay on their independent pathway (no preferences)
//
// Repo conventions: only '@/lib/db' is ever module-mocked (bun first-mock
// leaks); '@/lib/auth' gets the complete surface via tests/helpers/auth-mock;
// the Riishe provider module is spread with only the chat/webSearch boundary
// stubbed. No paid provider is contacted.

const state = {
  sessionStudent: null as { id: string } | null,
  sessionThrows: false,
  chatReply: '[SOURCES: GENERAL] Mocked tutor reply for the Phase 3D suite.',
  documents: [] as Record<string, unknown>[],
  attempts: [] as Record<string, unknown>[],
  questions: [] as Record<string, unknown>[],
  mastery: [] as Record<string, unknown>[],
  chatTurns: [] as Record<string, unknown>[],
  researchSessions: [] as Record<string, unknown>[],
}

const dbCalls: Record<string, number> = {}
const call = (key: string) => { dbCalls[key] = (dbCalls[key] ?? 0) + 1 }

/** Last where-clause the chat route handed to riisheChatTurn.findMany. */
let lastChatFindWhere: Record<string, unknown> | null = null
/** Last data payload handed to riisheChatTurn.updateMany (claim semantics). */
let lastChatUpdateData: Record<string, unknown> | null = null

let guestSeq = 0
const newGuest = () => `p3d-guest-${++guestSeq}`

let turnSeq = 0
const nextTurnId = () => `turn-${++turnSeq}`

function resetState() {
  state.sessionStudent = null
  state.sessionThrows = false
  state.chatReply = '[SOURCES: GENERAL] Mocked tutor reply for the Phase 3D suite.'
  for (const k of Object.keys(dbCalls)) delete dbCalls[k]
  state.documents = []
  state.attempts = []
  state.questions = []
  state.mastery = []
  state.chatTurns = []
  state.researchSessions = []
  lastChatFindWhere = null
  lastChatUpdateData = null
}

const PAGE1 =
  "Newton's first law of motion states that a body continues in its state of rest or of uniform motion in a straight line unless acted upon by an external net force. This property of matter is called inertia."

function seedDoc(guestId: string, id: string, title = 'Physics Essentials') {
  state.documents.push({
    id,
    guestId,
    title,
    status: 'READY',
    pageCount: 1,
    updatedAt: new Date(),
    extractionJson: JSON.stringify([
      { page: 1, chars: PAGE1.length, text: PAGE1, scanned: false, outcome: 'extracted' },
    ]),
  })
  return id
}

/** Legacy-shaped row: only the pre-3D columns, no preference metadata. */
function seedLegacyTurn(guestId: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id: nextTurnId(),
    guestId,
    studentId: null,
    documentId: null,
    attemptId: null,
    questionId: null,
    researchSessionId: null,
    role: 'assistant',
    content: 'Legacy reply stored before Phase 3D existed.',
    pagesCitedJson: '[]',
    grounding: 'general',
    sourcesJson: '[]',
    createdAt: new Date(Date.now() - 90_000),
    ...overrides,
  }
  state.chatTurns.push(row)
  return row
}

/** Generic row filter honouring the where shapes the routes actually use. */
function filterRows(rows: Record<string, unknown>[], where: Record<string, unknown>): Record<string, unknown>[] {
  let out = rows
  const w = where ?? {}
  if (w.id?.in) out = out.filter(r => (w.id.in as string[]).includes(r.id as string))
  for (const key of ['guestId', 'studentId', 'status', 'documentId', 'attemptId', 'questionId', 'researchSessionId'] as const) {
    if (key in w) out = out.filter(r => r[key] === w[key])
  }
  return out
}

const crudFor = (label: string, rows: () => Record<string, unknown>[], replace: (next: Record<string, unknown>[]) => void) => ({
  findMany: async (args: { where?: Record<string, unknown>; take?: number }) => {
    call(`${label}.findMany`)
    const out = filterRows(rows(), args?.where ?? {})
    return out.slice(0, args?.take ?? out.length)
  },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    call(`${label}.updateMany`)
    if (label === 'riisheChatTurn') lastChatUpdateData = data
    return { where, data, count: filterRows(rows(), where).length }
  },
  deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
    call(`${label}.deleteMany`)
    const doomed = new Set(filterRows(rows(), where))
    replace(rows().filter(r => !doomed.has(r)))
    return { count: doomed.size }
  },
})

const fakeDb = {
  $transaction: async (input: unknown) => (Array.isArray(input) ? Promise.all(input as Promise<unknown>[]) : input),
  studyDocument: {
    ...crudFor('studyDocument', () => state.documents, next => { state.documents = next }),
    findUnique: async ({ where }: { where: { id: string } }) => {
      call('studyDocument.findUnique')
      return state.documents.find(d => d.id === where.id) ?? null
    },
  },
  attempt: {
    ...crudFor('attempt', () => state.attempts, next => { state.attempts = next }),
    findUnique: async ({ where }: { where: { id: string } }) => {
      call('attempt.findUnique')
      return state.attempts.find(a => a.id === where.id) ?? null
    },
  },
  riisheTest: crudFor('riisheTest', () => [], () => undefined),
  researchSession: {
    ...crudFor('researchSession', () => state.researchSessions, next => { state.researchSessions = next }),
    findFirst: async ({ where }: { where: { id: string; guestId: string } }) => {
      call('researchSession.findFirst')
      return state.researchSessions.find(s => s.id === where.id && s.guestId === where.guestId) ?? null
    },
  },
  researchPyqCandidate: crudFor('researchPyqCandidate', () => [], () => undefined),
  topicMastery: {
    ...crudFor('topicMastery', () => state.mastery, next => { state.mastery = next }),
    findMany: async ({ where }: { where: { guestId: string } }) => {
      call('topicMastery.findMany')
      return state.mastery.filter(r => r.guestId === where.guestId)
    },
  },
  studyPlanTask: crudFor('studyPlanTask', () => [], () => undefined),
  revisionScheduleItem: crudFor('revisionScheduleItem', () => [], () => undefined),
  mistakeRecord: crudFor('mistakeRecord', () => [], () => undefined),
  learningAction: crudFor('learningAction', () => [], () => undefined),
  riisheQuestion: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      call('riisheQuestion.findUnique')
      return state.questions.find(q => q.id === where.id) ?? null
    },
  },
  riisheExplanation: {
    findUnique: async () => { call('riisheExplanation.findUnique'); return null },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => { call('riisheExplanation.deleteMany'); return { where, count: 0 } },
  },
  riisheChatTurn: {
    ...crudFor('riisheChatTurn', () => state.chatTurns, next => { state.chatTurns = next }),
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
        createdAt: new Date(),
      }
      state.chatTurns.push(row)
      return row
    },
  },
  studyGoal: { findMany: async () => { call('studyGoal.findMany'); return [] } },
  student: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      call('student.findUnique')
      return state.sessionStudent?.id === where.id
        ? { id: where.id, email: 'me@bean.test', displayName: 'Me', learningLevel: null, interestsJson: null, preferencesJson: null, createdAt: new Date(), updatedAt: new Date() }
        : null
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/riishe/pipeline', () => ({ deleteStoredFile: async () => undefined }))
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

// Provider boundary only — fence/tag/citation/disclosure helpers stay real.
const realAi = await import('@/lib/riishe/ai')
const capturedChats: { role: string; content: string }[][] = []
mock.module('@/lib/riishe/ai', () => ({
  ...realAi,
  chat: async (messages: { role: string; content: string }[]) => {
    call('ai.chat')
    capturedChats.push(messages)
    return state.chatReply
  },
  webSearch: async () => [],
}))

const { POST, GET } = await import('@/app/api/riishe/chat/route')
const { GET: exportGET } = await import('@/app/api/auth/account/export/route')
const { POST: claimPOST } = await import('@/app/api/auth/claim-guest/route')
const { DELETE: accountDataDELETE } = await import('@/app/api/account/route')
const { answerResearchFollowUp } = await import('@/lib/riishe/research-followup')
const { DEFAULT_TUTOR_MODE } = await import('@/lib/riishe/tutor')

function req(body: unknown, url = 'http://x/api/riishe/chat'): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://x' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function getReq(params: Record<string, string>): NextRequest {
  const q = new URLSearchParams(params).toString()
  return new Request(`http://x/api/riishe/chat?${q}`, { headers: { origin: 'http://x' } }) as unknown as NextRequest
}

/** Mirror of the UI reload rule: the most recent assistant turn carrying
 *  preference metadata wins; null/absent falls back to the defaults. */
const MODES = ['EXPLAIN', 'SOCRATIC', 'WORKED_EXAMPLE', 'EXAM_COACH', 'ASSIGNMENT_COACH', 'PROJECT_GUIDE']
const LANGS = ['auto', 'en', 'ta', 'hi', 'te', 'ml', 'kn', 'bn', 'mr', 'gu', 'pa', 'ur']
function clientReloadRule(turns: { role: string; tutorMode?: string | null; responseLanguage?: string | null }[]) {
  const withPrefs = [...turns].reverse().find(t => t.role === 'assistant' && (t.tutorMode != null || t.responseLanguage != null))
  const mode = withPrefs && MODES.includes(withPrefs.tutorMode ?? '') ? withPrefs.tutorMode! : DEFAULT_TUTOR_MODE
  const lang = withPrefs && LANGS.includes(withPrefs.responseLanguage ?? '') ? withPrefs.responseLanguage! : 'auto'
  return { mode, lang }
}

beforeEach(resetState)

// ─── Part A: conversation-scoped persistence ─────────────────────────────────

describe('Phase 3D — assistant turns store the preference in force', () => {
  it('A1. the assistant turn stores the selected tutorMode and responseLanguage', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    const res = await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: "Explain Newton's first law of motion" }],
      documentId: 'doc-a',
      tutorMode: 'SOCRATIC',
      responseLanguage: 'ta',
    }))
    expect(res.status).toBe(200)
    const assistantRows = state.chatTurns.filter(t => t.role === 'assistant')
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0].tutorMode).toBe('SOCRATIC')
    expect(assistantRows[0].responseLanguage).toBe('ta')
    expect(assistantRows[0].documentId).toBe('doc-a')
    const body = await res.json() as { tutorMode?: string; responseLanguage?: string }
    expect(body.tutorMode).toBe('SOCRATIC')
    expect(body.responseLanguage).toBe('ta')
  })

  it('A2. omitted fields store the documented defaults (EXPLAIN / auto)', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    const res = await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: "Explain Newton's first law of motion" }],
      documentId: 'doc-a',
    }))
    expect(res.status).toBe(200)
    const row = state.chatTurns.find(t => t.role === 'assistant')
    expect(row?.tutorMode).toBe('EXPLAIN')
    expect(row?.responseLanguage).toBe('auto')
    // An explicitly sent 'auto' is stored as 'auto' — never coerced.
    const gid2 = newGuest()
    seedDoc(gid2, 'doc-b')
    await POST(req({ guestId: gid2, messages: [{ role: 'user', content: 'Explain inertia' }], documentId: 'doc-b', responseLanguage: 'auto' }))
    expect(state.chatTurns.find(t => t.role === 'assistant' && t.guestId === gid2)?.responseLanguage).toBe('auto')
  })

  it('A3. the user turn never carries preference metadata', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    const res = await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: 'Explain inertia' }],
      documentId: 'doc-a',
      tutorMode: 'EXAM_COACH',
      responseLanguage: 'hi',
    }))
    expect(res.status).toBe(200)
    const userRow = state.chatTurns.find(t => t.role === 'user')
    expect(userRow).toBeTruthy()
    expect(userRow?.tutorMode).toBeNull()
    expect(userRow?.responseLanguage).toBeNull()
  })

  it('A4. the chat-history GET returns the stored preferences on assistant turns', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: 'Explain inertia' }],
      documentId: 'doc-a',
      tutorMode: 'WORKED_EXAMPLE',
      responseLanguage: 'kn',
    }))
    const res = await GET(getReq({ guestId: gid, documentId: 'doc-a' }))
    expect(res.status).toBe(200)
    const { turns } = await res.json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    const assistant = turns.find(t => t.role === 'assistant')
    expect(assistant?.tutorMode).toBe('WORKED_EXAMPLE')
    expect(assistant?.responseLanguage).toBe('kn')
    const user = turns.find(t => t.role === 'user')
    expect(user?.tutorMode).toBeNull()
    expect(user?.responseLanguage).toBeNull()
  })

  it('A5. legacy rows with missing/unknown preference values normalise to null', async () => {
    const gid = newGuest()
    seedLegacyTurn(gid, { documentId: 'doc-a' })
    // Out-of-union values (defensive) must never surface as a mode/language.
    seedLegacyTurn(gid, { documentId: 'doc-a', createdAt: new Date(), tutorMode: 'HYPNOTIZE', responseLanguage: 'klingon' })
    const res = await GET(getReq({ guestId: gid, documentId: 'doc-a' }))
    expect(res.status).toBe(200)
    const { turns } = await res.json() as { turns: { tutorMode: string | null; responseLanguage: string | null }[] }
    for (const t of turns) {
      expect(t.tutorMode).toBeNull()
      expect(t.responseLanguage).toBeNull()
    }
    // The client rule falls back to the documented defaults for such history.
    expect(clientReloadRule(turns)).toEqual({ mode: 'EXPLAIN', lang: 'auto' })
  })

  it('A6. reloading uses the most recent assistant-turn preference', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    await POST(req({ guestId: gid, messages: [{ role: 'user', content: 'Explain inertia' }], documentId: 'doc-a', tutorMode: 'SOCRATIC', responseLanguage: 'ta' }))
    const firstReply = state.chatTurns.find(t => t.role === 'assistant')!.content as string
    await POST(req({
      guestId: gid,
      messages: [
        { role: 'user', content: 'Explain inertia' },
        { role: 'assistant', content: firstReply },
        { role: 'user', content: 'and the second law?' },
      ],
      documentId: 'doc-a',
      tutorMode: 'EXAM_COACH',
      responseLanguage: 'hi',
    }))
    const res = await GET(getReq({ guestId: gid, documentId: 'doc-a' }))
    const { turns } = await res.json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    expect(turns.filter(t => t.role === 'assistant')).toHaveLength(2)
    // The LATEST stored preference is what a reload restores.
    expect(clientReloadRule(turns)).toEqual({ mode: 'EXAM_COACH', lang: 'hi' })
  })

  it('D5. old conversations keep working end-to-end alongside new ones', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    seedLegacyTurn(gid, { documentId: 'doc-a' })
    const res = await POST(req({ guestId: gid, messages: [{ role: 'user', content: 'Explain inertia' }], documentId: 'doc-a', tutorMode: 'PROJECT_GUIDE' }))
    expect(res.status).toBe(200)
    const res2 = await GET(getReq({ guestId: gid, documentId: 'doc-a' }))
    const { turns } = await res2.json() as { turns: { role: string; content: string; tutorMode: string | null }[] }
    // Legacy content untouched, new turn carries its preference.
    expect(turns.some(t => t.content === 'Legacy reply stored before Phase 3D existed.')).toBe(true)
    expect(turns.filter(t => t.role === 'assistant')).toHaveLength(2)
    expect(clientReloadRule(turns).mode).toBe('PROJECT_GUIDE')
    // No history row was rewritten: the legacy row still has no preference
    // metadata (undefined or null — both display as the defaults).
    const legacy = state.chatTurns.find(t => t.content === 'Legacy reply stored before Phase 3D existed.')
    expect(legacy?.tutorMode ?? null).toBeNull()
    expect(legacy?.responseLanguage ?? null).toBeNull()
  })
})

// ─── Part D: scope isolation and lifecycle ───────────────────────────────────

describe('Phase 3D — preferences stay scoped to their conversation', () => {
  it('A7. switching between two document scopes never transfers preferences', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a', 'Physics')
    seedDoc(gid, 'doc-b', 'Chemistry')
    await POST(req({ guestId: gid, messages: [{ role: 'user', content: 'Explain inertia' }], documentId: 'doc-a', tutorMode: 'SOCRATIC', responseLanguage: 'ta' }))
    await POST(req({ guestId: gid, messages: [{ role: 'user', content: 'Explain acidity' }], documentId: 'doc-b', tutorMode: 'EXAM_COACH', responseLanguage: 'hi' }))
    // Doc A history restores doc A's preference — strict where-clause.
    const resA = await GET(getReq({ guestId: gid, documentId: 'doc-a' }))
    expect(lastChatFindWhere).toEqual({ guestId: gid, documentId: 'doc-a', attemptId: null })
    const { turns: turnsA } = await resA.json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    expect(turnsA).toHaveLength(2)
    expect(clientReloadRule(turnsA)).toEqual({ mode: 'SOCRATIC', lang: 'ta' })
    // Doc B history restores doc B's — nothing crossed over.
    const resB = await GET(getReq({ guestId: gid, documentId: 'doc-b' }))
    const { turns: turnsB } = await resB.json() as { turns: { role: string }[] }
    expect(turnsB).toHaveLength(2)
    expect(clientReloadRule(turnsB)).toEqual({ mode: 'EXAM_COACH', lang: 'hi' })
  })

  it('A7b. hub scope and document scope keep separate histories', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    await POST(req({ guestId: gid, messages: [{ role: 'user', content: 'Explain inertia' }], tutorMode: 'ASSIGNMENT_COACH', responseLanguage: 'bn' }))
    await POST(req({ guestId: gid, messages: [{ role: 'user', content: 'Explain inertia' }], documentId: 'doc-a', tutorMode: 'EXPLAIN', responseLanguage: 'gu' }))
    await GET(getReq({ guestId: gid }))
    expect(lastChatFindWhere).toEqual({ guestId: gid, documentId: null, attemptId: null })
    await GET(getReq({ guestId: gid, documentId: 'doc-a' }))
    expect(lastChatFindWhere).toEqual({ guestId: gid, documentId: 'doc-a', attemptId: null })
    const hub = await (await GET(getReq({ guestId: gid }))).json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    const doc = await (await GET(getReq({ guestId: gid, documentId: 'doc-a' }))).json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    expect(hub.turns).toHaveLength(2)
    expect(clientReloadRule(hub.turns)).toEqual({ mode: 'ASSIGNMENT_COACH', lang: 'bn' })
    expect(doc.turns).toHaveLength(2)
    expect(clientReloadRule(doc.turns)).toEqual({ mode: 'EXPLAIN', lang: 'gu' })
  })

  it('A8. per-question review chat stores its own scoped preferences', async () => {
    const gid = newGuest()
    const docId = seedDoc(gid, 'doc-a')
    state.attempts.push({ id: 'att-1', guestId: gid, source: 'RIISHE', status: 'SUBMITTED', startedAt: new Date(), submittedAt: new Date(), questionIdsJson: '["q-1"]', answersJson: '{"q-1":1}', perTopicJson: '{}' })
    state.questions.push({ id: 'q-1', documentId: docId, text: "Which statement matches Newton's first law?", optionsJson: JSON.stringify(['Inertia', 'F = ma', 'Action-reaction', 'Gravity']), correctIndex: 0, explanation: 'Inertia is the property in the first law.', evidence: PAGE1.slice(0, 120), pageRefsJson: '[1]' })
    const res = await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: 'why is my answer wrong?' }],
      attemptId: 'att-1',
      questionId: 'q-1',
      tutorMode: 'SOCRATIC',
      responseLanguage: 'mr',
    }))
    expect(res.status).toBe(200)
    const row = state.chatTurns.find(t => t.role === 'assistant')
    expect(row?.attemptId).toBe('att-1')
    expect(row?.questionId).toBe('q-1')
    expect(row?.tutorMode).toBe('SOCRATIC')
    expect(row?.responseLanguage).toBe('mr')
    const history = await (await GET(getReq({ guestId: gid, attemptId: 'att-1', questionId: 'q-1' }))).json() as { turns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    expect(lastChatFindWhere).toEqual({ guestId: gid, attemptId: 'att-1', questionId: 'q-1' })
    expect(clientReloadRule(history.turns)).toEqual({ mode: 'SOCRATIC', lang: 'mr' })
  })

  it('A9. hub chat with an explicit multi-document scope stores preferences under the hub scope', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    seedDoc(gid, 'doc-b')
    const res = await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: 'Explain inertia across my notes' }],
      documentIds: ['doc-a', 'doc-b'],
      tutorMode: 'EXPLAIN',
      responseLanguage: 'pa',
    }))
    expect(res.status).toBe(200)
    const row = state.chatTurns.find(t => t.role === 'assistant')
    expect(row?.documentId).toBeNull()
    expect(row?.tutorMode).toBe('EXPLAIN')
    expect(row?.responseLanguage).toBe('pa')
  })

  it('D1. account claim preserves the preference fields untouched (studentId only)', async () => {
    const gid = newGuest()
    seedLegacyTurn(gid, { tutorMode: 'SOCRATIC', responseLanguage: 'ta' })
    state.sessionStudent = { id: 'me' }
    const res = await claimPOST(req({ guestId: gid }, 'http://x/api/auth/claim-guest'))
    expect(res.status).toBe(200)
    const body = await res.json() as { claims: { chatTurns: number } }
    expect(body.claims.chatTurns).toBe(1)
    // The claim's update payload sets ONLY studentId — preference fields ride
    // along untouched in the database (never overwritten by the claim).
    expect(lastChatUpdateData).toEqual({ studentId: 'me' })
  })

  it('D2. account export includes the preference fields', async () => {
    const gid = newGuest()
    state.sessionStudent = { id: 'me' }
    state.chatTurns.push({
      id: 'turn-export-1', guestId: gid, studentId: 'me', documentId: null, attemptId: null, questionId: null,
      researchSessionId: null, role: 'assistant', content: 'Exported answer', pagesCitedJson: '[]', grounding: 'general',
      sourcesJson: '[]', tutorMode: 'EXAM_COACH', responseLanguage: 'ur', createdAt: new Date(),
    })
    const res = await exportGET(new Request('http://x/api/auth/account/export') as unknown as NextRequest)
    expect(res.status).toBe(200)
    const data = await res.json() as { riisheChatTurns: { role: string; tutorMode: string | null; responseLanguage: string | null }[] }
    const exported = data.riisheChatTurns.find(c => c.role === 'assistant')
    expect(exported?.tutorMode).toBe('EXAM_COACH')
    expect(exported?.responseLanguage).toBe('ur')
  })

  it('D3. account data deletion removes turns and their preferences (whole-row semantics)', async () => {
    const gid = newGuest()
    state.chatTurns.push({
      id: 'turn-del-1', guestId: gid, studentId: null, documentId: null, attemptId: null, questionId: null,
      researchSessionId: null, role: 'assistant', content: 'To be purged', pagesCitedJson: '[]', grounding: 'general',
      sourcesJson: '[]', tutorMode: 'SOCRATIC', responseLanguage: 'te', createdAt: new Date(),
    })
    const res = await accountDataDELETE(req({ guestId: gid }, 'http://x/api/account'))
    expect(res.status).toBe(200)
    expect(state.chatTurns).toHaveLength(0)
    expect(dbCalls['riisheChatTurn.deleteMany']).toBeGreaterThanOrEqual(1)
  })

  it('D6. preference metadata never grants access — fail-closed ownership still withholds the digest', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a')
    state.mastery.push({ id: 'm-1', guestId: gid, topicId: 'topic-1', topicName: 'Laws of Motion', examLabel: 'JEE', status: 'LEARNING', accuracy: 40, evidenceQuestions: 6, attemptCount: 1, correctDistinct: 2, statusReason: 'x', lastActivityAt: new Date() })
    state.sessionThrows = true
    const res = await POST(req({
      guestId: gid,
      messages: [{ role: 'user', content: 'Explain inertia' }],
      documentId: 'doc-a',
      tutorMode: 'SOCRATIC',
      responseLanguage: 'ta',
    }))
    // Chat still answers, but the private learner digest was never built.
    expect(res.status).toBe(200)
    expect(dbCalls['topicMastery.findMany']).toBeUndefined()
    const system = capturedChats.at(-1)?.[0]?.content ?? ''
    expect(system).not.toContain('LEARNER CONTEXT')
    expect(system).not.toContain('Laws of Motion')
    // The preference is still stored with the assistant turn.
    const row = state.chatTurns.find(t => t.role === 'assistant')
    expect(row?.tutorMode).toBe('SOCRATIC')
    expect(row?.responseLanguage).toBe('ta')
    // History stays guest-scoped: a foreign guestId sees none of it.
    const foreign = await GET(getReq({ guestId: newGuest(), documentId: 'doc-a' }))
    const { turns } = await foreign.json() as { turns: unknown[] }
    expect(turns).toHaveLength(0)
  })

  it('D7. research follow-ups remain on their independent pathway (no preference metadata)', async () => {
    const gid = newGuest()
    state.researchSessions.push({
      id: 'rs-1', guestId: gid, status: 'COMPLETE', title: 'Research',
      findingsJson: JSON.stringify([{ topic: 'Eligibility' }]),
      summaryJson: JSON.stringify({ text: 'Summary.' }),
      sources: [],
    })
    const result = await answerResearchFollowUp('rs-1', gid, 'Summarise', {
      chat: async () => '[SOURCES: DOCUMENT] Per source [1], eligibility requires enrollment.',
    })
    expect(result.ok).toBe(true)
    const rows = state.chatTurns.filter(t => t.researchSessionId === 'rs-1' && t.role === 'assistant')
    expect(rows).toHaveLength(1)
    // The research pathway never writes preference metadata — its stored
    // assistant turn leaves both fields untouched (absent → null in the DB).
    expect(rows[0].tutorMode ?? null).toBeNull()
    expect(rows[0].responseLanguage ?? null).toBeNull()
    expect(rows[0].documentId ?? null).toBeNull()
  })
})
