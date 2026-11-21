// ─── PYQ candidate curation bridge tests (Phase 3A) ───────────────────────────
// Proves the security core of the research→curation lifecycle:
//   • students/guests can NEVER promote (401/403)
//   • promotion creates PYQ_UNVERIFIED / UNVERIFIED ONLY
//   • duplicate detection reuses the import contract's pyqHash
//   • rights: reference-only candidates require curator-supplied verbatim text
//   • PROMOTED/DISCARDED/SOURCE_CHECKED state machine is enforced
//   • candidates can never bypass /api/pyq/review (no verify path exists here)
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { NextRequest } from 'next/server'

interface FakeCandidate {
  id: string
  guestId: string
  studentId: string | null
  sessionId: string | null
  status: string
  examSlug: string | null
  examLabel: string | null
  year: number | null
  sessionLabel: string | null
  questionNumber: string | null
  paperTitle: string | null
  sourceUrl: string
  sourcePublisher: string | null
  retrievedAt: Date | null
  locator: string | null
  proposedCorrectIndex: number | null
  optionsJson: string | null
  verbatimText: string | null
  evidenceJson: string
  rightsStatus: string
  rightsNote: string | null
  pyqHash: string | null
  promotedQuestionId: string | null
  promotedAt: Date | null
  verificationNote: string | null
  createdAt: Date
}

const state: {
  candidates: FakeCandidate[]
  exams: { id: string; slug: string; name: string }[]
  questions: Record<string, unknown>[]
  batches: Record<string, unknown>[]
  student: Record<string, unknown> | null
  seq: number
} = { candidates: [], exams: [], questions: [], batches: [], student: null, seq: 0 }

function resetState() {
  state.candidates = []
  state.exams = [{ id: 'exam-1', slug: 'tnpsc-group-4', name: 'TNPSC Group 4' }]
  state.questions = []
  state.batches = []
  state.student = null
  state.seq = 0
}

function newCandidate(overrides: Partial<FakeCandidate> = {}): FakeCandidate {
  state.seq++
  return {
    id: `cand-${state.seq}`,
    guestId: 'guest-1234567890',
    studentId: null,
    sessionId: 'sess-1',
    status: 'SOURCE_CHECKED',
    examSlug: 'tnpsc-group-4',
    examLabel: 'TNPSC Group 4',
    year: 2019,
    sessionLabel: 'Group 4, 2019',
    questionNumber: 'Q.47',
    paperTitle: 'TNPSC Group 4 2019 official paper',
    sourceUrl: 'https://www.tnpsc.gov.in/paper-2019',
    sourcePublisher: 'TNPSC',
    retrievedAt: new Date(),
    locator: 'page 12',
    proposedCorrectIndex: null,
    optionsJson: null,
    verbatimText: null,
    evidenceJson: JSON.stringify([{ excerpt: 'Question 47 asks about the south-west monsoon.', pageRef: 'page 12' }]),
    rightsStatus: 'REFERENCE_ONLY',
    rightsNote: 'no reuse licence detected on the source — reference only',
    pyqHash: null,
    promotedQuestionId: null,
    promotedAt: null,
    verificationNote: 'source checked; verbatim could NOT be confirmed verbatim',
    createdAt: new Date(),
    ...overrides,
  }
}

const fakeDb = {
  researchPyqCandidate: {
    findUnique: async ({ where }: { where: { id: string } }) => state.candidates.find(c => c.id === where.id) ?? null,
    findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: Record<string, string> }) => {
      let rows = [...state.candidates]
      const status = where.status
      if (status) {
        if (typeof status === 'string') rows = rows.filter(c => c.status === status)
        else if (status.in) rows = rows.filter(c => status.in.includes(c.status))
      }
      if (orderBy?.createdAt === 'desc') rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return rows
    },
    groupBy: async ({ by }: { by: string[] }) => {
    const counts = new Map<string, number>()
    for (const c of state.candidates) counts.set(c.status, (counts.get(c.status) ?? 0) + 1)
    return [...counts.entries()].map(([status, _count]) => ({ status, _count: { _all: _count } }))
  },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.candidates.find(c => c.id === where.id)
      if (!row) throw new Error('candidate missing')
      Object.assign(row, data)
      return row
    },
  },
  exam: {
    findUnique: async ({ where }: { where: { slug: string } }) => state.exams.find(e => e.slug === where.slug) ?? null,
  },
  stage: { findUnique: async () => null },
  subject: { findUnique: async () => null },
  topic: { findUnique: async () => null },
  question: {
    findFirst: async ({ where }: { where: { pyqHash: string } }) => state.questions.find(q => q.pyqHash === where.pyqHash) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.seq++
      const row = { id: `q-${state.seq}`, ...data }
      state.questions.push(row)
      return row
    },
  },
  pyqImportBatch: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.seq++
      const row = { id: `batch-${state.seq}`, ...data }
      state.batches.push(row)
      return row
    },
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
}))

const promoteRoute = await import('@/app/api/pyq/candidates/[id]/promote/route')
const discardRoute = await import('@/app/api/pyq/candidates/[id]/discard/route')
const listRoute = await import('@/app/api/pyq/candidates/route')

function req(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest
}

const CURATOR = { id: 'cur-1', email: 'c@bean.example', displayName: 'Cur', learningLevel: null, role: 'PYQ_CURATOR', onboardedAt: null }
const ADMIN = { id: 'adm-1', email: 'a@bean.example', displayName: 'Adm', learningLevel: null, role: 'ADMIN', onboardedAt: null }
const STUDENT = { id: 'stu-1', email: 's@bean.example', displayName: 'Stu', learningLevel: null, role: 'STUDENT', onboardedAt: null }
const GUEST = 'guest-1234567890'

const PROMOTE_BODY = {
  text: 'Which one of the following is the correct statement about the south-west monsoon?',
  options: ['Coromandel coast', 'Western ghats', 'Nilgiris snowfall', 'None of the above'],
  correctIndex: 1,
}

describe('POST /api/pyq/candidates/[id]/promote — the only door into the bank', () => {
  beforeEach(resetState)

  test('401 for guests — promotion is accountable curation', async () => {
    const c = newCandidate()
    state.candidates.push(c)
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(401)
    expect(state.questions).toHaveLength(0)
  })

  test('403 for plain students — even the candidate’s own owner', async () => {
    const c = newCandidate()
    state.candidates.push(c)
    state.student = STUDENT
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(403)
    expect(state.questions).toHaveLength(0)
    expect(state.batches).toHaveLength(0)
  })

  test('409 for a candidate that has not passed the source check', async () => {
    const c = newCandidate({ status: 'DISCOVERED' })
    state.candidates.push(c)
    state.student = CURATOR
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/source-check/)
  })

  test('409 for already-promoted and discarded candidates', async () => {
    const promoted = newCandidate({ status: 'PROMOTED', promotedQuestionId: 'q-old', promotedAt: new Date() })
    const discarded = newCandidate({ status: 'DISCARDED' })
    state.candidates.push(promoted, discarded)
    state.student = CURATOR
    const r1 = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${promoted.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: promoted.id }) })
    expect(r1.status).toBe(409)
    const r2 = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${discarded.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: discarded.id }) })
    expect(r2.status).toBe(409)
  })

  test('400 when reference-only and the curator supplies no verbatim text (rights rule)', async () => {
    const c = newCandidate({ rightsStatus: 'REFERENCE_ONLY', verbatimText: null, proposedCorrectIndex: 1 })
    state.candidates.push(c)
    state.student = CURATOR
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify({ options: ['a', 'b'], correctIndex: 0 }) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Paste the question text verbatim/)
  })

  test('400 when the exam cannot be determined', async () => {
    const c = newCandidate({ examSlug: null, examLabel: null })
    state.candidates.push(c)
    state.student = CURATOR
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/examination could not be determined/)
  })

  test('409 duplicate detection reuses the import contract’s global pyqHash', async () => {
    const c = newCandidate()
    state.candidates.push(c)
    state.student = CURATOR
    const { computePyqHash } = await import('@/lib/pyq')
    state.questions.push({ id: 'q-existing', pyqHash: computePyqHash(PROMOTE_BODY.text, PROMOTE_BODY.options, PROMOTE_BODY.correctIndex) })
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.duplicateOf).toBe('q-existing')
    expect(state.batches).toHaveLength(0)
  })

  test('curator promotion creates PYQ_UNVERIFIED/UNVERIFIED with full provenance + candidate PROMOTED (admin too)', async () => {
    const c = newCandidate({ verbatimText: 'Stored verbatim from a licenced source.', rightsStatus: 'VERBATIM_PERMITTED', proposedCorrectIndex: 1, optionsJson: JSON.stringify(['Coromandel coast', 'Western ghats', 'Nilgiris snowfall', 'None of the above']) })
    state.candidates.push(c)
    state.student = CURATOR
    const res = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/promote`, { method: 'POST', body: JSON.stringify({}) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.questionId).toBeTruthy()
    expect(body.batchId).toBeTruthy()

    const q = state.questions[0]
    expect(q.sourceType).toBe('PYQ_UNVERIFIED') // NEVER verified by promotion
    expect(q.verificationStatus).toBe('UNVERIFIED')
    expect(q.examId).toBe('exam-1')
    expect(q.sessionLabel).toBe('Group 4, 2019')
    expect(q.questionNumber).toBe('Q.47')
    expect(q.sourceUrl).toBe('https://www.tnpsc.gov.in/paper-2019')
    expect(q.sourcePublisher).toBe('TNPSC')
    expect(q.retrievedAt).toBeTruthy()
    expect(q.pyqHash).toBeTruthy()

    const batch = state.batches[0]
    expect(batch.importedBy).toBe('cur-1')
    expect(batch.totalRows).toBe(1)
    expect(batch.sourceCitation).toContain('https://www.tnpsc.gov.in/paper-2019')
    expect(c.status).toBe('PROMOTED')
    expect(c.promotedQuestionId).toBe(body.questionId)

    // Admin may also promote (same role family)
    state.student = ADMIN
    const c2 = newCandidate()
    state.candidates.push(c2)
    const res2 = await promoteRoute.POST(req(`http://localhost/api/pyq/candidates/${c2.id}/promote`, { method: 'POST', body: JSON.stringify(PROMOTE_BODY) }), { params: Promise.resolve({ id: c2.id }) })
    expect(res2.status).toBe(200)
  })
})

describe('POST /api/pyq/candidates/[id]/discard — owner or curator, never promoted rows', () => {
  beforeEach(() => {
    resetState()
    state.student = null
  })

  test('owner can discard own candidate (guest-scoped)', async () => {
    const c = newCandidate()
    state.candidates.push(c)
    const res = await discardRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/discard`, { method: 'POST', body: JSON.stringify({ guestId: GUEST }) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(200)
    expect(c.status).toBe('DISCARDED')
  })

  test('another guest gets 403 — no cross-owner discard', async () => {
    const c = newCandidate()
    state.candidates.push(c)
    const res = await discardRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/discard`, { method: 'POST', body: JSON.stringify({ guestId: 'guest-other-999999' }) }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(403)
  })

  test('401 with no identity at all', async () => {
    const c = newCandidate()
    state.candidates.push(c)
    const res = await discardRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/discard`, { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(401)
  })

  test('promoted candidates can never be discarded (curation record)', async () => {
    const c = newCandidate({ status: 'PROMOTED', promotedQuestionId: 'q-9', promotedAt: new Date() })
    state.candidates.push(c)
    state.student = CURATOR
    const res = await discardRoute.POST(req(`http://localhost/api/pyq/candidates/${c.id}/discard`, { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: c.id }) })
    expect(res.status).toBe(409)
    expect(c.status).toBe('PROMOTED')
  })
})

describe('GET /api/pyq/candidates — curator queue', () => {
  beforeEach(resetState)

  test('401 guest / 403 student / 200 curator with counts', async () => {
    const c1 = newCandidate()
    const c2 = newCandidate({ status: 'PROMOTED', promotedQuestionId: 'q-1', promotedAt: new Date() })
    state.candidates.push(c1, c2)

    const r1 = await listRoute.GET(req('http://localhost/api/pyq/candidates'))
    expect(r1.status).toBe(401)

    state.student = STUDENT
    const r2 = await listRoute.GET(req('http://localhost/api/pyq/candidates'))
    expect(r2.status).toBe(403)

    state.student = CURATOR
    const r3 = await listRoute.GET(req('http://localhost/api/pyq/candidates'))
    expect(r3.status).toBe(200)
    const body = await r3.json()
    expect(body.candidates).toHaveLength(1) // default queue = active only
    expect(body.candidates[0].id).toBe(c1.id)
    expect(body.counts.PROMOTED).toBe(1)

    // verbatim is only exposed for rights-cleared candidates
    expect(body.candidates[0].verbatimText).toBeNull()
    const r4 = await listRoute.GET(req('http://localhost/api/pyq/candidates?status=PROMOTED'))
    const body4 = await r4.json()
    expect(body4.candidates).toHaveLength(1)
  })
})
