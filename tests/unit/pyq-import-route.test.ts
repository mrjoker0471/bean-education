import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

// ─── Route-level proofs for POST /api/pyq/import (Phase 2B Milestone A/F) ──────
// Mocked collaborators: '@/lib/db' (in-memory fake), '@/lib/auth' (controllable
// signed-in student). The REAL '@/lib/roles' logic runs on top of the mocked
// requireStudent, so the full guest→401 / student→403 / curator→allowed chain
// is exercised end-to-end, including honest row validation and provenance.

const state = {
  student: null as Record<string, unknown> | null,
  exams: new Map<string, { id: string; slug: string }>(),
  questions: [] as Record<string, unknown>[],
  batches: [] as Record<string, unknown>[],
  batchSeq: 0,
  questionSeq: 0,
}

function resetState() {
  state.student = null
  state.exams = new Map([['qa-demo-exam', { id: 'exam-1', slug: 'qa-demo-exam' }]])
  state.questions = []
  state.batches = []
  state.batchSeq = 0
  state.questionSeq = 0
}

const fakeDb = {
  exam: {
    findUnique: async ({ where }: { where: { slug: string } }) => state.exams.get(where.slug) ?? null,
  },
  stage: { findMany: async () => [] },
  subject: { findMany: async () => [] },
  topic: { findMany: async () => [] },
  question: {
    findFirst: async ({ where }: { where: { pyqHash: string } }) =>
      state.questions.find(q => q.pyqHash === where.pyqHash) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `q-${++state.questionSeq}`, ...data }
      state.questions.push(row)
      return row
    },
  },
  pyqImportBatch: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `batch-${++state.batchSeq}`, ...data }
      state.batches.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.batches.find(b => b.id === where.id)
      if (row) Object.assign(row, data)
      return row
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
}))

const { POST } = await import('@/app/api/pyq/import/route')

const CURATOR = { id: 'cur-1', email: 'curator@bean.example', displayName: null, learningLevel: null, role: 'PYQ_CURATOR', onboardedAt: null }
const STUDENT = { id: 'stu-1', email: 'student@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }

function request(body: unknown): NextRequest {
  return new Request('http://localhost:3000/api/pyq/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function paperPayload(overrides: Record<string, unknown> = {}) {
  return {
    paperTitle: 'QA Demo Paper 2025 — Demo subject',
    fileName: 'qa-demo-2025.json',
    examSlug: 'qa-demo-exam',
    year: 2025,
    session: '2025',
    sourceCitation: 'QA fixture citation',
    items: [
      {
        text: 'Which demo topic does this fixture question belong to?',
        options: ['Demo topic 1', 'None', 'Other', 'All of these'],
        correctIndex: 0,
        explanation: 'Fixture row used by automated QA.',
        year: 2025,
        sourceRef: 'QA fixture, Q.1',
      },
    ],
    ...overrides,
  }
}

describe('POST /api/pyq/import — authorization', () => {
  beforeEach(resetState)

  it('a signed-out guest is refused (401) — no guest import path', async () => {
    const res = await POST(request(paperPayload()))
    expect(res.status).toBe(401)
    expect(state.batches.length).toBe(0)
    expect(state.questions.length).toBe(0)
  })

  it('a plain STUDENT receives 403 and nothing is written', async () => {
    state.student = STUDENT
    const res = await POST(request(paperPayload()))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('curator')
    expect(state.batches.length).toBe(0)
    expect(state.questions.length).toBe(0)
  })

  it('a PYQ_CURATOR can import; provenance records the curator id', async () => {
    state.student = CURATOR
    const res = await POST(request(paperPayload()))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { createdCount: number; batchId: string }
    expect(body.createdCount).toBe(1)
    expect(state.batches[0].importedBy).toBe('cur-1')
    expect(state.questions[0].importedBatchId).toBe(body.batchId)
  })

  it('an ADMIN can import too', async () => {
    state.student = { ...CURATOR, id: 'adm-1', role: 'ADMIN' }
    const res = await POST(request(paperPayload()))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/pyq/import — honesty rules', () => {
  beforeEach(resetState)

  it('every created row is PYQ_UNVERIFIED + UNVERIFIED — never auto-verified', async () => {
    state.student = CURATOR
    const res = await POST(request(paperPayload()))
    expect(res.status).toBe(200)
    const q = state.questions[0]
    expect(q.sourceType).toBe('PYQ_UNVERIFIED')
    expect(q.verificationStatus).toBe('UNVERIFIED')
  })

  it('an unknown examSlug fails honestly (400) — no invented attachments', async () => {
    state.student = CURATOR
    const res = await POST(request(paperPayload({ examSlug: 'ghost-exam' })))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('Unknown examSlug')
  })

  it('duplicate content is counted, never re-inserted', async () => {
    state.student = CURATOR
    const first = await POST(request(paperPayload()))
    expect(((await first.json()) as { createdCount: number }).createdCount).toBe(1)
    const second = await POST(request(paperPayload()))
    const body = (await second.json()) as { createdCount: number; duplicateCount: number }
    expect(body.createdCount).toBe(0)
    expect(body.duplicateCount).toBe(1)
    expect(state.questions.length).toBe(1)
  })

  it('a malformed row fails that ROW with an honest error, the rest still import', async () => {
    state.student = CURATOR
    const payload = paperPayload({
      items: [
        { text: 'Short', options: ['a'], correctIndex: 0 }, // invalid: short text, 1 option
        {
          text: 'A second, perfectly valid fixture question about the demo topic?',
          options: ['A', 'B'],
          correctIndex: 1,
        },
      ],
    })
    const res = await POST(request(payload))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { createdCount: number; failedCount: number; errors: { row: number; error: string }[] }
    expect(body.createdCount).toBe(1)
    expect(body.failedCount).toBe(1)
    expect(body.errors[0].row).toBe(0)
    expect(body.errors[0].error).toContain('text') // honest, row-scoped message
  })

  it('an out-of-range correctIndex fails the row (never a valid answer)', async () => {
    state.student = CURATOR
    const res = await POST(
      request(
        paperPayload({
          items: [{ text: 'Fixture question with a broken answer key?', options: ['A', 'B'], correctIndex: 5 }],
        }),
      ),
    )
    const body = (await res.json()) as { failedCount: number }
    expect(body.failedCount).toBe(1)
  })

  it('the batch audit row exists even when every row fails', async () => {
    state.student = CURATOR
    const res = await POST(
      request(
        paperPayload({
          items: [{ text: 'Short', options: ['a'], correctIndex: 0 }],
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(state.batches.length).toBe(1)
    expect(state.batches[0].failedCount).toBe(1)
    expect(state.batches[0].createdCount).toBe(0)
  })
})
