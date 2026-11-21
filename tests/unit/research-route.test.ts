// ─── /api/riishe/research route tests (Phase 3A) ──────────────────────────────
// Ownership follows the Riishe guest model; quota/exam/document gates are
// server-authoritative. The real route handler runs against fake db + fake jobs.
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NextRequest } from 'next/server'

interface FakeSession {
  id: string
  guestId: string
  studentId: string | null
  title: string
  kind: string
  status: string
  statusDetail: string | null
  inputJson: string
  progressJson: string | null
  findingsJson: string | null
  summaryJson: string | null
  followUpsJson: string | null
  documentIdsJson: string | null
  searchesUsed: number
  fetchesUsed: number
  llmCallsUsed: number
  error: string | null
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

const state: { sessions: FakeSession[]; docs: { id: string; guestId: string; status: string }[]; exams: { slug: string; name: string }[]; quotaOk: boolean; enqueued: { kind: string; refId: string; ownerId: string }[]; seq: number } = {
  sessions: [],
  docs: [],
  exams: [],
  quotaOk: true,
  enqueued: [],
  seq: 0,
}

function resetState() {
  state.sessions = []
  state.docs = []
  state.exams = [{ slug: 'tnpsc-group-4', name: 'TNPSC Group 4' }]
  state.quotaOk = true
  state.enqueued = []
  state.seq = 0
}

const fakeDb = {
  researchSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.sessions.find(s => s.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { id?: string; guestId?: string } }) => {
      const row = state.sessions.find(s => (!where.id || s.id === where.id) && (!where.guestId || s.guestId === where.guestId)) ?? null
      return row ? { ...row, _count: { sources: 0 } } : null
    },
    findMany: async ({ where, orderBy }: { where: { guestId: string }; orderBy?: Record<string, string> }) => {
      const rows = state.sessions.filter(s => s.guestId === where.guestId).map(s => ({ ...s, _count: { sources: 0 } }))
      return orderBy?.createdAt === 'desc' ? rows.reverse() : rows
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.seq++
      const row: FakeSession = {
        id: `sess-${state.seq}`,
        guestId: String(data.guestId),
        studentId: null,
        title: String(data.title),
        kind: String(data.kind),
        status: String(data.status ?? 'QUEUED'),
        statusDetail: null,
        inputJson: String(data.inputJson),
        progressJson: (data.progressJson as string) ?? null,
        findingsJson: null,
        summaryJson: null,
        followUpsJson: null,
        documentIdsJson: (data.documentIdsJson as string) ?? null,
        searchesUsed: 0,
        fetchesUsed: 0,
        llmCallsUsed: 0,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        finishedAt: null,
      }
      state.sessions.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.sessions.find(s => s.id === where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data)
      return row
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const idx = state.sessions.findIndex(s => s.id === where.id)
      if (idx >= 0) state.sessions.splice(idx, 1)
      return {}
    },
  },
  researchSource: {
    count: async () => 0,
    findMany: async () => [],
    create: async ({ data }: { data: Record<string, unknown> }) => data,
    update: async ({ data }: { data: Record<string, unknown> }) => data,
  },
  researchPyqCandidate: {
    groupBy: async () => [],
    count: async () => 0,
    findMany: async () => [],
    findUnique: async () => null,
    update: async ({ data }: { data: Record<string, unknown> }) => data,
    create: async ({ data }: { data: Record<string, unknown> }) => data,
  },
  exam: {
    findUnique: async ({ where }: { where: { slug: string } }) => state.exams.find(e => e.slug === where.slug) ?? null,
  },
  studyDocument: {
    findMany: async ({ where }: { where: { id: { in: string[] }; guestId: string } }) => state.docs.filter(d => where.id.in.includes(d.id) && d.guestId === where.guestId),
  },
  riisheJob: {
    findFirst: async () => null,
  },
}

const fakeJobs = {
  reserveQuota: async () => state.quotaOk,
  enqueueJob: async (opts: { kind: string; refId: string; ownerId: string }) => {
    state.enqueued.push(opts)
    return { jobId: `job-${state.enqueued.length}`, alreadyQueued: false }
  },
  recoverStaleResearch: async () => undefined,
  cancelJob: async () => true,
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/riishe/jobs', () => fakeJobs)

const { POST, GET } = await import('@/app/api/riishe/research/route')
const { GET: GET_DETAIL, DELETE: DELETE_DETAIL } = await import('@/app/api/riishe/research/[id]/route')

const GUEST = 'guest-1234567890'
const OTHER = 'guest-9999999999'

function req(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

describe('POST /api/riishe/research', () => {
  beforeEach(resetState)

  test('400 on an invalid guest identity', async () => {
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: 'x', kind: 'TOPIC' }) }))
    expect(res.status).toBe(400)
  })

  test('400 when EXAM_PYQ has no examination', async () => {
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: GUEST, kind: 'EXAM_PYQ' }) }))
    expect(res.status).toBe(400)
  })

  test('400 on an unknown exam slug (honest catalogue enforcement)', async () => {
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: GUEST, kind: 'EXAM_PYQ', examSlug: 'nope' }) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Unknown examination/)
  })

  test('404 when an attached document belongs to another guest', async () => {
    state.docs.push({ id: 'doc1', guestId: OTHER, status: 'READY' })
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: GUEST, kind: 'TOPIC', question: 'monsoon', documentIds: ['doc1'] }) }))
    expect(res.status).toBe(404)
  })

  test('409 when an attached document is still processing', async () => {
    state.docs.push({ id: 'doc1', guestId: GUEST, status: 'ANALYSING' })
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: GUEST, kind: 'TOPIC', question: 'monsoon', documentIds: ['doc1'] }) }))
    expect(res.status).toBe(409)
  })

  test('429 when the hourly research quota is exhausted', async () => {
    state.quotaOk = false
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: GUEST, kind: 'TOPIC', question: 'monsoon' }) }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/Hourly limit/)
  })

  test('201 happy path: creates a QUEUED session and enqueues a durable job', async () => {
    const res = await POST(req('http://localhost/api/riishe/research', { method: 'POST', body: JSON.stringify({ guestId: GUEST, kind: 'EXAM_PYQ', examSlug: 'tnpsc-group-4', yearFrom: 2015, yearTo: 2020 }) }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.sessionId).toBe('sess-1')
    expect(state.enqueued).toHaveLength(1)
    expect(state.enqueued[0]).toEqual({ kind: 'DEEP_RESEARCH', refId: 'sess-1', ownerId: GUEST })
    const row = state.sessions[0]
    expect(row.status).toBe('QUEUED')
    expect(row.kind).toBe('EXAM_PYQ')
    expect(row.title).toContain('TNPSC Group 4')
    const input = JSON.parse(row.inputJson)
    expect(input.examSlug).toBe('tnpsc-group-4')
    expect(JSON.parse(row.progressJson ?? '{}').stages[0].stage).toBe('plan')
  })
})

describe('GET /api/riishe/research — owner-scoped listing', () => {
  beforeEach(() => {
    resetState()
    state.seq = 1
    state.sessions.push({ id: 's1', guestId: GUEST, studentId: null, title: 'A', kind: 'TOPIC', status: 'COMPLETE', statusDetail: null, inputJson: '{}', progressJson: JSON.stringify({ stages: [], sourcesDiscovered: 0, sourcesChecked: 0, sourcesUnavailable: 0, searchesUsed: 3, fetchesUsed: 2, llmCallsUsed: 5, candidatesFound: 0, updatedAt: new Date().toISOString() }), findingsJson: null, summaryJson: null, followUpsJson: null, documentIdsJson: null, searchesUsed: 3, fetchesUsed: 2, llmCallsUsed: 5, error: null, createdAt: new Date(), updatedAt: new Date(), finishedAt: null })
    state.sessions.push({ id: 's2', guestId: OTHER, studentId: null, title: 'B', kind: 'TOPIC', status: 'COMPLETE', statusDetail: null, inputJson: '{}', progressJson: null, findingsJson: null, summaryJson: null, followUpsJson: null, documentIdsJson: null, searchesUsed: 1, fetchesUsed: 0, llmCallsUsed: 2, error: null, createdAt: new Date(), updatedAt: new Date(), finishedAt: null })
  })

  test('returns only the caller’s sessions with real counters', async () => {
    const res = await GET(req(`http://localhost/api/riishe/research?guestId=${GUEST}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].id).toBe('s1')
    expect(body.sessions[0].progress.searchesUsed).toBe(3)
  })

  test('400 without a valid guestId (no session isolation leak)', async () => {
    const res = await GET(req('http://localhost/api/riishe/research'))
    expect(res.status).toBe(400)
  })
})

describe('GET/DELETE /api/riishe/research/[id] — ownership enforced', () => {
  beforeEach(() => {
    resetState()
    state.sessions.push({ id: 's1', guestId: GUEST, studentId: null, title: 'A', kind: 'TOPIC', status: 'COMPLETE', statusDetail: null, inputJson: '{}', progressJson: null, findingsJson: null, summaryJson: null, followUpsJson: null, documentIdsJson: null, searchesUsed: 0, fetchesUsed: 0, llmCallsUsed: 0, error: null, createdAt: new Date(), updatedAt: new Date(), finishedAt: null })
  })

  test('foreign guest gets 404 (missing == foreign)', async () => {
    const res = await GET_DETAIL(req(`http://localhost/api/riishe/research/s1?guestId=${OTHER}`), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(404)
  })

  test('owner gets the full dossier shape', async () => {
    const res = await GET_DETAIL(req(`http://localhost/api/riishe/research/s1?guestId=${GUEST}`), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.session.id).toBe('s1')
    expect(body.session.findings).toEqual([])
    expect(body.sources).toEqual([])
    expect(body.candidates).toEqual([])
  })

  test('owner can delete; the delete is real', async () => {
    const res = await DELETE_DETAIL(req(`http://localhost/api/riishe/research/s1?guestId=${GUEST}`, { method: 'DELETE' }), { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)
    expect(state.sessions).toHaveLength(0)
  })
})
