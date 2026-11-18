import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

// ─── Route-level proofs for student data isolation & goal ownership (2B) ───────
// The StudyGoal routes must never let a student read, change or delete another
// student's goal (404 for foreign/missing), and must refuse guests (401).

const state = {
  student: null as Record<string, unknown> | null,
  goals: new Map<string, { id: string; studentId: string; title: string; examId: string | null; topicId: string | null; targetDate: Date | null; status: string; createdAt: Date; updatedAt: Date }>(),
}

function resetState() {
  state.student = null
  state.goals = new Map()
  state.goals.set('mine-1', {
    id: 'mine-1',
    studentId: 'me',
    title: 'Understand calculus basics',
    examId: null,
    topicId: null,
    targetDate: new Date('2030-01-01'),
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  state.goals.set('foreign-1', {
    id: 'foreign-1',
    studentId: 'someone-else',
    title: 'Someone else’s private goal',
    examId: null,
    topicId: null,
    targetDate: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

const fakeDb = {
  studyGoal: {
    findUnique: async ({ where }: { where: { id: string } }) => state.goals.get(where.id) ?? null,
    findMany: async ({ where }: { where: { studentId: string } }) =>
      [...state.goals.values()].filter(g => g.studentId === where.studentId),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `g-${state.goals.size + 1}`,
        studentId: data.studentId as string,
        title: data.title as string,
        examId: (data.examId as string | null) ?? null,
        topicId: (data.topicId as string | null) ?? null,
        targetDate: (data.targetDate as Date | null) ?? null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      state.goals.set(row.id, row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.goals.get(where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data)
      row.updatedAt = new Date()
      return row
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const row = state.goals.get(where.id)
      if (!row) throw new Error('not found')
      state.goals.delete(where.id)
      return row
    },
    count: async () => 0,
  },
  exam: { findUnique: async () => null, findMany: async () => [] },
  topic: { findUnique: async () => null, findMany: async () => [] },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
}))

const goalsRoute = await import('@/app/api/student/goals/route')
const goalIdRoute = await import('@/app/api/student/goals/[id]/route')

const ME = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function req(url: string, method: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

async function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/student/goals — student data isolation', () => {
  beforeEach(resetState)

  it('a guest receives 401', async () => {
    const res = await goalsRoute.GET()
    expect(res.status).toBe(401)
  })

  it('a signed-in student sees ONLY their own goals', async () => {
    state.student = ME
    const res = await goalsRoute.GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { goals: { id: string; title: string }[] }
    expect(body.goals.length).toBe(1)
    expect(body.goals[0].id).toBe('mine-1')
    expect(body.goals[0].title).not.toContain('Someone else')
  })
})

describe('POST /api/student/goals — creation', () => {
  beforeEach(resetState)

  it('a signed-in student creates a general learning goal (no exam needed)', async () => {
    state.student = ME
    const res = await goalsRoute.POST(req('http://localhost:3000/api/student/goals', 'POST', { title: 'Complete a Python course' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { goal: { title: string; status: string; examId: string | null } }
    expect(body.goal.title).toBe('Complete a Python course')
    expect(body.goal.status).toBe('ACTIVE')
    expect(body.goal.examId).toBeNull()
  })

  it('a goal title shorter than 3 chars is refused (400)', async () => {
    state.student = ME
    const res = await goalsRoute.POST(req('http://localhost:3000/api/student/goals', 'POST', { title: 'hi' }))
    expect(res.status).toBe(400)
  })

  it('a guest cannot create goals (401)', async () => {
    const res = await goalsRoute.POST(req('http://localhost:3000/api/student/goals', 'POST', { title: 'Complete a Python course' }))
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/student/goals/[id] — ownership enforcement', () => {
  beforeEach(resetState)

  it('a student can complete their own goal', async () => {
    state.student = ME
    const res = await goalIdRoute.PATCH(req('http://localhost:3000/api/student/goals/mine-1', 'PATCH', { status: 'COMPLETED' }), await params('mine-1'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { goal: { status: string } }
    expect(body.goal.status).toBe('COMPLETED')
  })

  it('a foreign goal is indistinguishable from a missing one (404)', async () => {
    state.student = ME
    const res = await goalIdRoute.PATCH(req('http://localhost:3000/api/student/goals/foreign-1', 'PATCH', { status: 'COMPLETED' }), await params('foreign-1'))
    expect(res.status).toBe(404)
    expect(state.goals.get('foreign-1')?.status).toBe('ACTIVE') // untouched
  })

  it('editing another student’s title is refused (404) — no data leak, no mutation', async () => {
    state.student = ME
    const res = await goalIdRoute.PATCH(req('http://localhost:3000/api/student/goals/foreign-1', 'PATCH', { title: 'hijacked' }), await params('foreign-1'))
    expect(res.status).toBe(404)
    expect(state.goals.get('foreign-1')?.title).toBe('Someone else’s private goal')
  })
})

describe('DELETE /api/student/goals/[id] — ownership enforcement', () => {
  beforeEach(resetState)

  it('a student can delete their own goal', async () => {
    state.student = ME
    const res = await goalIdRoute.DELETE(req('http://localhost:3000/api/student/goals/mine-1', 'DELETE'), await params('mine-1'))
    expect(res.status).toBe(200)
    expect(state.goals.has('mine-1')).toBe(false)
  })

  it('another student’s goal cannot be deleted (404)', async () => {
    state.student = ME
    const res = await goalIdRoute.DELETE(req('http://localhost:3000/api/student/goals/foreign-1', 'DELETE'), await params('foreign-1'))
    expect(res.status).toBe(404)
    expect(state.goals.has('foreign-1')).toBe(true)
  })
})
