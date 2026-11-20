// ─── Research follow-up route tests (Phase 3A) ───────────────────────────────
// Ownership, completion gate, honest grounding decisions and citation
// verification — the follow-up chat is grounded on the session dossier only.
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NextRequest } from 'next/server'

interface FakeTurn {
  id: string
  guestId: string
  researchSessionId: string | null
  role: string
  content: string
  grounding: string | null
  sourcesJson: string | null
  createdAt: Date
}

const state: {
  session: { id: string; guestId: string; status: string; title: string; findingsJson: string; summaryJson: string | null } | null
  sources: { id: string; sessionId: string; url: string; title: string | null; host: string; kind: string; documentId: string | null; sourceClass: string; status: string; evidenceJson: string | null; snippet: string | null; createdAt: Date }[]
  turns: FakeTurn[]
  chatReply: string | Error
  seq: number
} = { session: null, sources: [], turns: [], chatReply: '', seq: 0 }

function resetState() {
  state.session = {
    id: 'sess-1',
    guestId: 'guest-1234567890',
    status: 'COMPLETE',
    title: 'UPSC research',
    findingsJson: JSON.stringify([{ topic: 'papers', summary: 'Grounded finding [1].', citationIds: [1] }]),
    summaryJson: JSON.stringify({ text: 'Summary [1].', citationIds: [1], generatedAt: new Date().toISOString() }),
  }
  state.sources = [
    { id: 'src-1', sessionId: 'sess-1', url: 'https://example.org/upsc', title: 'UPSC IAS Exam', host: 'example.org', kind: 'web', documentId: null, sourceClass: 'UNVERIFIED', status: 'CHECKED', evidenceJson: JSON.stringify([{ excerpt: 'The exam has two objective papers.', pageRef: 'page 1' }]), snippet: null, createdAt: new Date() },
  ]
  state.turns = []
  state.chatReply = '[SOURCES: DOCUMENT]\nIt is grounded [1].'
  state.seq = 0
}

const fakeDb = {
  researchSession: {
    findFirst: async ({ where }: { where: { id: string; guestId: string } }) => {
      if (!state.session || state.session.id !== where.id || state.session.guestId !== where.guestId) return null
      // the route queries with include: { sources } — the fake mirrors Prisma
      return { ...state.session, sources: state.sources.filter(s => s.sessionId === state.session!.id) }
    },
  },
  researchSource: {
    findMany: async ({ where }: { where: { sessionId: string } }) => state.sources.filter(s => s.sessionId === where.sessionId),
  },
  riisheChatTurn: {
    findMany: async ({ where, orderBy }: { where: { researchSessionId: string; guestId: string }; orderBy?: Record<string, string> }) => {
      const rows = state.turns.filter(t => t.researchSessionId === where.researchSessionId && t.guestId === where.guestId)
      return orderBy?.createdAt === 'desc' ? [...rows].reverse() : rows
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.seq++
      const row: FakeTurn = {
        id: `turn-${state.seq}`,
        guestId: String(data.guestId),
        researchSessionId: (data.researchSessionId as string) ?? null,
        role: String(data.role),
        content: String(data.content),
        grounding: (data.grounding as string) ?? null,
        sourcesJson: (data.sourcesJson as string) ?? null,
        createdAt: new Date(),
      }
      state.turns.push(row)
      return row
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
// NO module mock for '@/lib/riishe/ai' — the chat collaborator comes through
// the FollowUpDeps seam (module mocks leak across bun test files in one
// process). parseSourceTag/fenceDocumentText run for real below.

const { GET, POST } = await import('@/app/api/riishe/research/[id]/followup/route')
const { answerResearchFollowUp } = await import('@/lib/riishe/research-followup')

function scriptedDeps() {
  return {
    chat: async () => {
      if (state.chatReply instanceof Error) throw state.chatReply
      return state.chatReply
    },
  }
}
const deps = scriptedDeps()

function req(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

const GUEST = 'guest-1234567890'
const OTHER = 'guest-9999999999'

describe('answerResearchFollowUp — the follow-up core', () => {
  beforeEach(resetState)

  test('404 for a foreign guest (owner-scoped dossier)', async () => {
    const r = await answerResearchFollowUp('sess-1', OTHER, 'hi', deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
    expect(state.turns).toHaveLength(0)
  })

  test('409 while the run is not COMPLETE — follow-ups need a finished dossier', async () => {
    state.session!.status = 'RESEARCHING'
    const r = await answerResearchFollowUp('sess-1', GUEST, 'hi', deps)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/still in progress/)
  })

  test('grounded reply: citations resolve, grounding document, both turns persisted', async () => {
    state.chatReply = '[SOURCES: DOCUMENT]\nThe exam has two objective papers per the dossier [1] and a phantom [9] that must be stripped.'
    const r = await answerResearchFollowUp('sess-1', GUEST, 'What does the research say about paper structure?', deps)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.grounding).toBe('document')
      expect(r.sources).toHaveLength(1)
      expect(r.sources[0].title).toBe('UPSC IAS Exam')
      expect(r.reply).toContain('[1]')
      expect(r.reply).not.toContain('[9]') // unresolvable citation stripped
    }
    expect(state.turns).toHaveLength(2)
    expect(state.turns[0].role).toBe('user')
    expect(state.turns[1].grounding).toBe('document')
  })

  test('general-knowledge reply is honestly labelled when the tag says GENERAL', async () => {
    state.chatReply = '[SOURCES: GENERAL]\nThat is outside the retrieved evidence.'
    const r = await answerResearchFollowUp('sess-1', GUEST, 'What is for dinner?', deps)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.grounding).toBe('general')
      expect(r.sources).toHaveLength(0)
    }
  })

  test('502 on provider failure with an honest message (no fabricated reply)', async () => {
    state.chatReply = new Error('provider down')
    const r = await answerResearchFollowUp('sess-1', GUEST, 'hi', deps)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(502)
      expect(r.error).toMatch(/could not reach the AI provider/)
    }
    expect(state.turns).toHaveLength(0)
  })
})

describe('GET /api/riishe/research/[id]/followup — thread endpoint', () => {
  beforeEach(resetState)

  test('returns the persisted thread owner-only', async () => {
    state.turns.push({ id: 't1', guestId: GUEST, researchSessionId: 'sess-1', role: 'user', content: 'q', grounding: null, sourcesJson: null, createdAt: new Date() })
    const ok = await GET(req('http://localhost/api/riishe/research/sess-1/followup?guestId=' + GUEST), { params: Promise.resolve({ id: 'sess-1' }) })
    expect(ok.status).toBe(200)
    const okBody = await ok.json()
    expect(okBody.turns).toHaveLength(1)
    const foreign = await GET(req('http://localhost/api/riishe/research/sess-1/followup?guestId=' + OTHER), { params: Promise.resolve({ id: 'sess-1' }) })
    expect(foreign.status).toBe(404)
  })
})
