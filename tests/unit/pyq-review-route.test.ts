import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

// ─── Route-level security proofs for POST /api/pyq/review (Phase 2B Milestone A)
// The route module is imported with its collaborators mocked:
//   • '@/lib/db'     → in-memory fake (question row + audit events)
//   • '@/lib/auth'   → controllable "current signed-in student" (the real
//                      implementation needs cookies()/Prisma, unavailable here)
// This proves the END-TO-END behavior a client experiences:
//   STUDENT → 403, guest → 401, curator → allowed, verified downgrade → 409,
//   justification validation → 400, audit event appended on every decision.

interface FakeQuestion {
  id: string
  sourceType: string
  verificationStatus: string
  reviewedBy: string | null
  reviewNote: string | null
  [key: string]: unknown
}

interface FakeEvent {
  questionId: string
  reviewerId: string
  reviewerRole: string
  action: string
  note: string | null
}

const state: { question: FakeQuestion | null; events: FakeEvent[]; student: Record<string, unknown> | null } = {
  question: null,
  events: [],
  student: null,
}

const fakeDb = {
  question: {
    findUnique: async () => state.question,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if (!state.question) return null
      state.question = { ...state.question, ...data }
      return state.question
    },
  },
  pyqReviewEvent: {
    create: async ({ data }: { data: FakeEvent }) => {
      state.events.push(data)
      return data
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  // Only what '@/lib/roles' + the route actually consume.
  requireStudent: async () => state.student,
  sameOrigin: () => true,
}))

const { POST } = await import('@/app/api/pyq/review/route')
const { requirePyqCurator } = await import('@/lib/roles')

function request(body: unknown): NextRequest {
  return new Request('http://localhost:3000/api/pyq/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function makeVerifiedRow(): FakeQuestion {
  return {
    id: 'q1',
    sourceType: 'PYQ_UNVERIFIED',
    verificationStatus: 'UNVERIFIED',
    reviewedBy: null,
    reviewNote: null,
  }
}

const CURATOR = { id: 'cur-1', email: 'curator@bean.example', displayName: 'Cur', learningLevel: null, role: 'PYQ_CURATOR', onboardedAt: null }
const STUDENT = { id: 'stu-1', email: 'student@bean.example', displayName: 'Stu', learningLevel: null, role: 'STUDENT', onboardedAt: null }

describe('POST /api/pyq/review — authorization', () => {
  beforeEach(() => {
    state.question = makeVerifiedRow()
    state.events = []
    state.student = null
  })

  it('a signed-out guest receives 401', async () => {
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'Matches the 2019 official key.' }))
    expect(res.status).toBe(401)
  })

  it('a plain STUDENT receives 403 and nothing is written', async () => {
    state.student = STUDENT
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'Matches the 2019 official key.' }))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain('curator')
    // No state change, no audit event: the refusal left no trace.
    expect(state.question?.verificationStatus).toBe('UNVERIFIED')
    expect(state.events.length).toBe(0)
  })

  it('a PYQ_CURATOR is allowed to approve', async () => {
    state.student = CURATOR
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'Checked against the official 2019 answer key, page 12.' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sourceType?: string; verificationStatus?: string }
    expect(body.sourceType).toBe('PYQ_VERIFIED')
    expect(body.verificationStatus).toBe('VERIFIED')
    expect(state.question?.reviewedBy).toBe('cur-1')
  })

  it('an ADMIN is allowed to approve', async () => {
    state.student = { ...CURATOR, id: 'adm-1', role: 'ADMIN' }
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'Admin re-review against the official key.' }))
    expect(res.status).toBe(200)
    expect(state.question?.sourceType).toBe('PYQ_VERIFIED')
  })

  it('the guard helper itself refuses students and guests', async () => {
    state.student = null
    expect((await requirePyqCurator()).ok).toBe(false)
    state.student = STUDENT
    const guard = await requirePyqCurator()
    expect(guard.ok).toBe(false)
    if (!guard.ok) expect(guard.status).toBe(403)
    state.student = CURATOR
    const ok = await requirePyqCurator()
    expect(ok.ok).toBe(true)
  })
})

describe('POST /api/pyq/review — verification integrity', () => {
  beforeEach(() => {
    state.question = makeVerifiedRow()
    state.events = []
    state.student = CURATOR
  })

  it('APPROVE without a written justification is refused (400)', async () => {
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE' }))
    expect(res.status).toBe(400)
    expect(state.question?.sourceType).toBe('PYQ_UNVERIFIED')
  })

  it('APPROVE with a too-short justification is refused (400)', async () => {
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'ok' }))
    expect(res.status).toBe(400)
  })

  it('REJECT of an already-verified PYQ is refused (409) — no casual downgrade', async () => {
    state.question = { ...makeVerifiedRow(), sourceType: 'PYQ_VERIFIED', verificationStatus: 'VERIFIED', reviewedBy: 'cur-1' }
    const res = await POST(request({ questionId: 'q1', action: 'REJECT', note: 'changed my mind' }))
    expect(res.status).toBe(409)
    expect(state.question?.verificationStatus).toBe('VERIFIED')
    expect(state.events.length).toBe(0)
  })

  it('ORIGINAL (AI-written) rows are untouchable (409)', async () => {
    state.question = { ...makeVerifiedRow(), sourceType: 'ORIGINAL', verificationStatus: 'VERIFIED' }
    const res = await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'not even a PYQ row' }))
    expect(res.status).toBe(409)
  })

  it('an unknown question id returns 404', async () => {
    state.question = null
    const res = await POST(request({ questionId: 'ghost', action: 'REJECT' }))
    expect(res.status).toBe(404)
  })

  it('an invalid action enum is refused (400)', async () => {
    const res = await POST(request({ questionId: 'q1', action: 'VERIFY_PLEASE' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/pyq/review — audit trail (reviewer identity, action, justification, time)', () => {
  beforeEach(() => {
    state.question = makeVerifiedRow()
    state.events = []
    state.student = CURATOR
  })

  it('approval records reviewer, role, action, justification — and re-approval keeps both events', async () => {
    await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'Verified against official key 2019.' }))
    expect(state.events.length).toBe(1)
    expect(state.events[0]).toMatchObject({
      questionId: 'q1',
      reviewerId: 'cur-1',
      reviewerRole: 'PYQ_CURATOR',
      action: 'APPROVE',
      note: 'Verified against official key 2019.',
    })

    // Re-confirmation (allowed from PYQ_VERIFIED) appends a SECOND event —
    // the first decision's record is never erased.
    await POST(request({ questionId: 'q1', action: 'APPROVE', note: 'Re-confirmed against booklet 2.' }))
    expect(state.events.length).toBe(2)
    expect(state.events[1].note).toBe('Re-confirmed against booklet 2.')
  })

  it('rejection records the action with an optional note', async () => {
    await POST(request({ questionId: 'q1', action: 'REJECT', note: 'Answer key mismatch — option 2 is keyed in the source.' }))
    expect(state.events.length).toBe(1)
    expect(state.events[0].action).toBe('REJECT')
    expect(state.question?.verificationStatus).toBe('REJECTED')
  })
})
