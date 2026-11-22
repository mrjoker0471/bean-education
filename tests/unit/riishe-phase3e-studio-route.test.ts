import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── Phase 3E — /api/riishe/studio route: ownership, scoping, honesty ─────────
// Covers the studio generation route against the REAL route logic with the
// repo's standard mock architecture (only '@/lib/db' is module-mocked, auth
// surface via tests/helpers/auth-mock, provider boundary stubbed):
//
//   Ownership (fail-closed, Phase 3B.1/3D.1 contract — Part 5 of the 3E spec):
//   O1. a foreign claimant is rejected 403 BEFORE any database read — a
//       client-supplied guestId alone can never reach another account's docs
//   O2. a thrown session lookup fails closed 503 with the generic message
//   O3. guest-bearer mode (no session) keeps working — guest compatibility
//   O4. the claimant keeps access; unclaimed guests keep access
//
//   Scoping:
//   S1. an unknown/foreign documentId is 404 'Material not found' (no leak)
//   S2. a document that is not READY is 409 with an honest message
//   S3. single-document scope grounds with that document's title + pages
//   S4. hub scope (no document ids) grounds across READY materials, or
//       honestly reports 'general' when none exist
//   S5. topic falls back to the document title when omitted
//
//   Honesty + limits:
//   H1. invalid bodies are 400 'Invalid request'
//   H2. cross-origin POSTs are blocked 403 (sameOrigin)
//   H3. per-owner rate limit kicks in at the documented budget (429)
//   H4. provider/validation failures surface as honest 502s, never fake data

const state = {
  sessionStudent: null as { id: string } | null,
  sessionThrows: false,
  sameOrigin: true,
  documents: [] as Record<string, unknown>[],
  attempts: [] as Record<string, unknown>[],
  studioJson: null as unknown, // fixture returned by the stubbed provider
  studioThrows: false as boolean | string,
}

const dbCalls: Record<string, number> = {}
const call = (key: string) => { dbCalls[key] = (dbCalls[key] ?? 0) + 1 }

let guestSeq = 0
const newGuest = () => `p3e-guest-${++guestSeq}`

function resetState() {
  state.sessionStudent = null
  state.sessionThrows = false
  state.sameOrigin = true
  state.documents = []
  state.attempts = []
  state.studioJson = VALID_MAP_FIXTURE
  state.studioThrows = false
  for (const k of Object.keys(dbCalls)) delete dbCalls[k]
}

const PAGE1 =
  "Newton's first law of motion states that a body continues in its state of rest or of uniform motion in a straight line unless acted upon by an external net force. This property of matter is called inertia."
const PAGE2 =
  'The second law connects force, mass and acceleration: a = F / m. A heavier body accelerates less under the same force because its inertia is larger.'

function seedDoc(guestId: string, id: string, opts: { title?: string; status?: string } = {}) {
  state.documents.push({
    id,
    guestId,
    title: opts.title ?? 'Physics Essentials',
    status: opts.status ?? 'READY',
    pageCount: 2,
    updatedAt: new Date(),
    extractionJson: JSON.stringify([
      { page: 1, chars: PAGE1.length, text: PAGE1, scanned: false, outcome: 'extracted' },
      { page: 2, chars: PAGE2.length, text: PAGE2, scanned: false, outcome: 'extracted' },
    ]),
  })
  return id
}

/** The claimed-guest rows assertLearningOwner resolves (newest attempt wins). */
function seedClaim(guestId: string, studentId: string) {
  state.attempts.push({
    id: `a-${guestId}`,
    guestId,
    studentId,
    status: 'SUBMITTED',
    startedAt: new Date(),
    submittedAt: new Date(),
    questionIdsJson: '[]',
    answersJson: '{}',
    source: 'BANK',
    perTopicJson: '{}',
  })
}

const VALID_MAP_FIXTURE = {
  title: 'Laws of motion',
  nodes: [
    { id: 'n1', label: 'Newton\u2019s laws', parent: null, explanation: 'The three laws describe how forces change motion.' },
    { id: 'n2', label: 'First law', parent: 'n1', explanation: 'A body stays at rest or in uniform motion without a net external force.' },
    { id: 'n3', label: 'Inertia', parent: 'n2', explanation: 'The resistance of a body to changes in its state of motion.' },
    { id: 'n4', label: 'Second law', parent: 'n1', explanation: 'Force equals mass times acceleration (a = F / m).' },
    { id: 'n5', label: 'Third law', parent: 'n1', explanation: 'Every action has an equal and opposite reaction.' },
    { id: 'n6', label: 'Momentum', parent: 'n4', explanation: 'Mass in motion; conserved in isolated systems.' },
  ],
}

function filterRows(rows: Record<string, unknown>[], where: Record<string, unknown>): Record<string, unknown>[] {
  let out = rows
  const w = where ?? {}
  if (w.id?.in) out = out.filter(r => (w.id.in as string[]).includes(r.id as string))
  for (const key of ['guestId', 'status'] as const) {
    if (key in w) out = out.filter(r => r[key] === w[key])
  }
  return out
}

const fakeDb = {
  $transaction: async (input: unknown) => (Array.isArray(input) ? Promise.all(input as Promise<unknown>[]) : input),
  studyDocument: {
    findMany: async (args: { where?: Record<string, unknown>; orderBy?: unknown; take?: number }) => {
      call('studyDocument.findMany')
      const out = filterRows(state.documents, args?.where ?? {})
      if (args?.orderBy && typeof args.orderBy === 'object' && 'updatedAt' in (args.orderBy as Record<string, unknown>)) {
        out.sort((a, b) => (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime())
      }
      return out.slice(0, args?.take ?? out.length)
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      call('studyDocument.findUnique')
      return state.documents.find(d => d.id === where.id) ?? null
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

// Provider boundary only: the studio generation path reads chatJson from this
// module. Real helpers (fence, extractJson, …) stay untouched.
const realAi = await import('@/lib/riishe/ai')
let providerCallCount = 0
mock.module('@/lib/riishe/ai', () => ({
  ...realAi,
  chatJson: async <T,>(opts: { system: string; user: string }): Promise<T> => {
    providerCallCount++
    if (typeof state.studioThrows === 'string') throw new Error(state.studioThrows)
    if (state.studioThrows) throw new Error('empty provider response')
    return state.studioJson as T
  },
}))

const { POST } = await import('@/app/api/riishe/studio/route')

function req(body: unknown, origin = 'http://x'): NextRequest {
  return new Request('http://x/api/riishe/studio', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(() => {
  resetState()
  providerCallCount = 0
})

// ─── Part H: request hygiene ──────────────────────────────────────────────────

describe('Phase 3E studio route — request hygiene', () => {
  it('H1. rejects invalid bodies with 400 Invalid request', async () => {
    expect((await POST(req({ guestId: 'short' }))).status).toBe(400)
    expect((await POST(req({ guestId: newGuest(), kind: 'not-a-kind' }))).status).toBe(400)
    expect((await POST(req({ guestId: newGuest(), kind: 'concept-map', documentIds: ['x', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'] }))).status).toBe(400)
    expect((await POST(req('not json at all'))).status).toBe(400)
  })

  it('H2. blocks cross-origin POSTs with 403', async () => {
    state.sameOrigin = false
    const res = await POST(req({ guestId: newGuest(), kind: 'concept-map' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cross-origin request blocked' })
    expect(providerCallCount).toBe(0)
  })

  it('H3. enforces the per-owner rate limit honestly (429 after the budget)', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-rl')
    let lastStatus = 200
    for (let i = 0; i < 13; i++) {
      state.studioJson = { ...VALID_MAP_FIXTURE }
      const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-rl', topic: `attempt ${i}` }))
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-rl' }))
    expect(res.status).toBe(429)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/short break/)
  })
})

// ─── Part O: fail-closed ownership (BEFORE any database read) ─────────────────

describe('Phase 3E studio route — fail-closed ownership', () => {
  it('O1. rejects a foreign claimant 403 before reading any document', async () => {
    const victimGuest = 'guest-owned-by-victim'
    seedDoc(victimGuest, 'doc-victim')
    seedClaim(victimGuest, 'someone-else')
    state.sessionStudent = { id: 'me' }

    const res = await POST(req({ guestId: victimGuest, kind: 'concept-map' }))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('This learning history belongs to a different account.')
    expect(dbCalls['studyDocument.findMany']).toBeUndefined()
    expect(providerCallCount).toBe(0)
  })

  it('O2. fails closed 503 with the generic message when the session lookup throws', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-ok')
    state.sessionThrows = true
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-ok' }))
    expect(res.status).toBe(503)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Account ownership could not be verified. Please retry.')
    expect(dbCalls['studyDocument.findMany']).toBeUndefined()
    expect(providerCallCount).toBe(0)
  })

  it('O3. guest-bearer mode (no session) keeps working — guest compatibility preserved', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-ok')
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-ok' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { grounding: string; docTitle?: string }
    expect(body.grounding).toBe('document')
    expect(body.docTitle).toBe('Physics Essentials')
  })

  it('O4. the claimant keeps access to their own claimed guest scope', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-own')
    seedClaim(gid, 'me')
    state.sessionStudent = { id: 'me' }
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-own' }))
    expect(res.status).toBe(200)
  })
})

// ─── Part S: grounding scope resolution ───────────────────────────────────────

describe('Phase 3E studio route — grounding scope', () => {
  it('S1. returns 404 Material not found for unknown or foreign document ids', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-mine')
    const foreign = await POST(req({ guestId: gid, kind: 'steps', documentId: 'doc-someone-else' }))
    expect(foreign.status).toBe(404)
    expect(await (foreign).json()).toEqual({ error: 'Material not found' })
  })

  it('S2. refuses documents that are not READY with an honest 409', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-pending', { status: 'ANALYSING' })
    const res = await POST(req({ guestId: gid, kind: 'steps', documentId: 'doc-pending' }))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/not ready yet/)
    expect(providerCallCount).toBe(0)
  })

  it('S3. single-document scope grounds in that document and falls back to its title as topic', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-solo', { title: 'Physics Essentials' })
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-solo' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { grounding: string; topic: string; docTitle?: string; activity: { kind: string } }
    expect(body.topic).toBe('Physics Essentials')
    expect(body.docTitle).toBe('Physics Essentials')
    expect(body.activity.kind).toBe('concept-map')
    expect(body.grounding).toBe('document')
  })

  it('S4. hub scope honestly reports general grounding when no READY materials exist', async () => {
    const gid = newGuest()
    const res = await POST(req({ guestId: gid, kind: 'concept-map', topic: 'Laws of motion' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { grounding: string; docTitle?: string }
    expect(body.grounding).toBe('general')
    expect(body.docTitle).toBeUndefined()
  })

  it('S5. hub scope with materials grounds across them (no docTitle for multi-doc)', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-a', { title: 'Physics Essentials' })
    seedDoc(gid, 'doc-b', { title: 'Chemistry Notes' })
    const res = await POST(req({ guestId: gid, kind: 'concept-map', topic: 'Laws of motion' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { grounding: string; docTitle?: string }
    expect(body.grounding).toBe('document')
    expect(body.docTitle).toBeUndefined()
    // Both documents were consulted in one query
    expect(dbCalls['studyDocument.findMany']).toBeGreaterThanOrEqual(1)
  })
})

// ─── Part H4: honest failure surfacing ────────────────────────────────────────

describe('Phase 3E studio route — honest failures', () => {
  it('H4a. provider failure surfaces as 502 with a human message — no fake activity', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-ok')
    state.studioThrows = true
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-ok' }))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/could not reach the AI provider/)
    expect(body.error).toMatch(/no concept map was generated/)
  })

  it('H4b. double validation failure surfaces as 502 with the activity name', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-ok')
    state.studioJson = { title: 'broken', nodes: [{ id: 'n1', label: 'only one', parent: null, explanation: 'x' }] }
    const res = await POST(req({ guestId: gid, kind: 'concept-map', documentId: 'doc-ok' }))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/failed validation twice/)
  })

  it('H4c. a valid payload returns the validated activity with honest badges', async () => {
    const gid = newGuest()
    seedDoc(gid, 'doc-ok')
    state.studioJson = {
      title: 'Motion check',
      questions: [
        {
          prompt: 'A book rests on a table. Which pair of forces balances?',
          options: ['Weight and normal reaction', 'Weight and friction', 'Normal reaction and air resistance', 'Weight and tension'],
          correctIndex: 0,
          explanation: 'The table pushes up with the normal reaction, which balances the book\u2019s weight; no horizontal forces act.',
          difficulty: 'foundation',
        },
        {
          prompt: 'A trolley accelerates at 2 m/s\u00b2 under a 6 N force. What is its mass?',
          options: ['3 kg', '12 kg', '1.5 kg', '8 kg'],
          correctIndex: 0,
          explanation: 'Rearranging F = ma gives m = F/a = 6/2 = 3 kg, using the second-law relation from the material.',
          difficulty: 'application',
        },
        {
          prompt: 'Two skaters push off each other. What can be said about their momenta?',
          options: ['They are equal and opposite', 'Only the lighter one moves', 'Both stay at rest', 'The heavier one moves faster'],
          correctIndex: 0,
          explanation: 'The third law gives equal and opposite forces, so the gained momenta are equal and opposite (conservation).',
          difficulty: 'advanced',
        },
      ],
    }
    const res = await POST(req({ guestId: gid, kind: 'mini-test', documentId: 'doc-ok', topic: 'Laws of motion' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { activity: { kind: string; honestyNote: string }; grounding: string; responseLanguage: string; topic: string }
    expect(body.activity.kind).toBe('mini-test')
    expect(body.activity.honestyNote).toMatch(/does not create attempt records/)
    expect(body.grounding).toBe('document')
    expect(body.responseLanguage).toBe('auto')
    expect(body.topic).toBe('Laws of motion')
  })
})
