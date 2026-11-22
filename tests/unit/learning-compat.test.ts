import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

// ─── Phase 3B compatibility proofs ────────────────────────────────────────────
// The five new learning tables must behave exactly like every other owned row:
// claimable on sign-in (studentId stamped, guestId untouched), included in the
// privacy export, and purged by both delete flows.

const state = {
  student: null as Record<string, unknown> | null,
  attempts: new Map<string, Record<string, unknown>>(),
  mastery: new Map<string, Record<string, unknown>>(),
  planTasks: new Map<string, Record<string, unknown>>(),
  revision: new Map<string, Record<string, unknown>>(),
  mistakes: new Map<string, Record<string, unknown>>(),
  actions: new Map<string, Record<string, unknown>>(),
  goals: new Map<string, Record<string, unknown>>(),
  docs: new Map<string, Record<string, unknown>>(),
  tests: new Map<string, Record<string, unknown>>(),
  chatTurns: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  students: new Map<string, Record<string, unknown>>(),
  research: new Map<string, Record<string, unknown>>(),
  pyqCandidates: new Map<string, Record<string, unknown>>(),
  // Phase 3F: Studio activity records (claim / export / delete flows).
  studioActivities: new Map<string, Record<string, unknown>>(),
  files: [] as { storedPath: string }[],
}

function resetState() {
  state.student = null
  for (const key of ['attempts', 'mastery', 'planTasks', 'revision', 'mistakes', 'actions', 'goals', 'docs', 'tests', 'chatTurns', 'sessions', 'students', 'research', 'pyqCandidates', 'studioActivities'] as const) {
    ;(state as unknown as Record<string, Map<string, Record<string, unknown>>>)[key].clear()
  }
  state.files = []
}

function mapOf(name: string): Map<string, Record<string, unknown>> {
  return (state as unknown as Record<string, Map<string, Record<string, unknown>>>)[name]
}

function stampableModel(name: string) {
  const map = mapOf(name)
  return {
    updateMany: async ({ where, data }: { where: { guestId: string; studentId: string | null }; data: { studentId: string } }) => {
      let n = 0
      for (const row of map.values()) {
        if (row.guestId === where.guestId && row.studentId === null) {
          row.studentId = data.studentId
          n++
        }
      }
      return { count: n }
    },
    findMany: async ({ where }: { where: { studentId?: string; guestId?: string } }) => {
      const rows = [...map.values()]
      if (where.studentId) return rows.filter(r => r.studentId === where.studentId)
      if (where.guestId) return rows.filter(r => r.guestId === where.guestId)
      return rows
    },
    deleteMany: async ({ where }: { where: { studentId?: string; guestId?: string } }) => {
      let n = 0
      for (const [id, row] of map) {
        if (where.studentId && row.studentId === where.studentId) { map.delete(id); n++ }
        else if (where.guestId && row.guestId === where.guestId) { map.delete(id); n++ }
      }
      return { count: n }
    },
  }
}

function findManyModel(name: string) {
  return stampableModel(name)
}

const fakeDb = {
  attempt: {
    ...stampableModel('attempts'),
    findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('attempts').findMany({ where }),
  },
  studyDocument: {
    ...stampableModel('docs'),
    findMany: async ({ where, select }: { where: { studentId?: string }; select?: unknown }) => findManyModel('docs').findMany({ where }),
  },
  riisheTest: { ...stampableModel('tests'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('tests').findMany({ where }) },
  riisheChatTurn: { ...stampableModel('chatTurns'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('chatTurns').findMany({ where }) },
  studyGoal: { ...stampableModel('goals'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('goals').findMany({ where }) },
  topicMastery: { ...stampableModel('mastery'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('mastery').findMany({ where }) },
  studyPlanTask: { ...stampableModel('planTasks'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('planTasks').findMany({ where }) },
  revisionScheduleItem: { ...stampableModel('revision'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('revision').findMany({ where }) },
  mistakeRecord: { ...stampableModel('mistakes'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('mistakes').findMany({ where }) },
  learningAction: { ...stampableModel('actions'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('actions').findMany({ where }) },
  session: stampableModel('sessions'),
  student: {
    findUnique: async ({ where }: { where: { id: string } }) => state.students.get(where.id) ?? null,
    delete: async ({ where }: { where: { id: string } }) => {
      const row = state.students.get(where.id)
      state.students.delete(where.id)
      return row
    },
  },
  riisheExplanation: { deleteMany: async () => ({ count: 0 }) },
  researchSession: stampableModel('research'),
  researchPyqCandidate: stampableModel('pyqCandidates'),
  // Phase 3F: Studio activity records join claim / export / delete flows.
  riisheStudioActivity: { ...stampableModel('studioActivities'), findMany: async ({ where }: { where: { studentId?: string } }) => findManyModel('studioActivities').findMany({ where }) },
  $transaction: async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : await (arg as (tx: unknown) => Promise<unknown>)(fakeDb)),
}

const STUDENT = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: null }

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  destroyCurrentSession: async () => undefined,
}))
mock.module('@/lib/riishe/pipeline', () => ({ deleteStoredFile: async () => undefined }))

const claimRoute = await import('@/app/api/auth/claim-guest/route')
const exportRoute = await import('@/app/api/auth/account/export/route')
const deleteRoute = await import('@/app/api/auth/account/delete/route')
const guestPurgeRoute = await import('@/app/api/account/route')

const GUEST = 'guest-aaaaaaaa-1'

function req(url: string, method = 'GET', body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

function seedGuestRows() {
  const g = { guestId: GUEST, studentId: null }
  mapOf('attempts').set('a1', { id: 'a1', ...g, title: 'T', questionIdsJson: '[]', answersJson: '{}', status: 'SUBMITTED', score: 4, maxScore: 10, correctCount: 4, wrongCount: 3, skippedCount: 3, startedAt: new Date(), submittedAt: new Date() })
  mapOf('mastery').set('m1', { id: 'm1', ...g, topicId: 't1', topicName: 'Kinematics', status: 'LEARNING', accuracy: 40, computedAt: new Date(), lastActivityAt: new Date() })
  mapOf('planTasks').set('p1', { id: 'p1', ...g, planDate: '2026-04-01', kind: 'REVISE_TOPIC', title: 'Revise', status: 'PLANNED', createdAt: new Date(), completedAt: null })
  mapOf('revision').set('r1', { id: 'r1', ...g, topicId: 't1', topicName: 'Kinematics', intervalDays: 1, nextDueAt: new Date(), lastReviewedAt: new Date() })
  mapOf('mistakes').set('k1', { id: 'k1', ...g, attemptId: 'a1', questionId: 'q1', snapshotJson: '{}', category: 'UNCLASSIFIED', createdAt: new Date() })
  mapOf('actions').set('la1', { id: 'la1', ...g, actionKey: 'REVIEW_DUE:t1', type: 'REVIEW_DUE', status: 'DISMISSED', resolvedAt: new Date(), snoozedUntil: null, outcomeJson: null, updatedAt: new Date() })
  // Another student's rows must never be touched by this guest's claim.
  mapOf('mastery').set('m2', { id: 'm2', guestId: GUEST, studentId: 'someone-else', topicId: 't2', topicName: 'X', status: 'STRONG', accuracy: 90, computedAt: new Date(), lastActivityAt: new Date() })
}

beforeEach(() => {
  resetState()
  state.students.set(STUDENT.id, { ...STUDENT, preferencesJson: null, createdAt: new Date(), updatedAt: new Date() })
  state.student = STUDENT
  seedGuestRows()
})

describe('claim-guest — learning rows join the claim', () => {
  it('stamps studentId on unclaimed rows and never touches other students’ rows', async () => {
    const res = await claimRoute.POST(req('http://x/api/auth/claim-guest', 'POST', { guestId: GUEST }))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.claims.learningRows).toBe(5) // m1, p1, r1, k1, la1 — NOT m2
    for (const [name, id] of [['mastery', 'm1'], ['planTasks', 'p1'], ['revision', 'r1'], ['mistakes', 'k1'], ['actions', 'la1']] as const) {
      expect(mapOf(name).get(id)!.studentId).toBe(STUDENT.id)
      expect(mapOf(name).get(id)!.guestId).toBe(GUEST) // guestId is never rewritten
    }
    expect(mapOf('mastery').get('m2')!.studentId).toBe('someone-else')
  })

  it('is idempotent (re-claiming claims nothing)', async () => {
    await claimRoute.POST(req('http://x/api/auth/claim-guest', 'POST', { guestId: GUEST }))
    const res = await claimRoute.POST(req('http://x/api/auth/claim-guest', 'POST', { guestId: GUEST }))
    const dto = await res.json()
    expect(dto.claims.learningRows).toBe(0)
  })
})

describe('privacy export — learning state is included', () => {
  it('carries a learning section with all five kinds after claim', async () => {
    await claimRoute.POST(req('http://x/api/auth/claim-guest', 'POST', { guestId: GUEST }))
    const res = await exportRoute.GET(req('http://x/api/auth/account/export'))
    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload.learning.mastery.length).toBe(1) // m1 only — m2 belongs to another student
    expect(payload.learning.planTasks.length).toBe(1)
    expect(payload.learning.revisionSchedule.length).toBe(1)
    expect(payload.learning.mistakes.length).toBe(1)
    expect(payload.learning.actions.length).toBe(1)
    expect(payload.learning.actions[0].actionKey).toBe('REVIEW_DUE:t1')
  })

  it('guests without an account get 401 (no anonymous export)', async () => {
    state.student = null
    const res = await exportRoute.GET(req('http://x/api/auth/account/export'))
    expect(res.status).toBe(401)
  })
})

describe('account deletion — learning rows are purged', () => {
  it('the student delete flow removes every claimed learning row', async () => {
    await claimRoute.POST(req('http://x/api/auth/claim-guest', 'POST', { guestId: GUEST }))
    const res = await deleteRoute.POST(req('http://x/api/auth/account/delete', 'POST', { confirm: 'DELETE' }))
    expect(res.status).toBe(200)
    for (const name of ['planTasks', 'revision', 'mistakes', 'actions'] as const) {
      expect(mapOf(name).size).toBe(0)
    }
    // Only m2 survives — it belongs to another student and must never be touched.
    expect(mapOf('mastery').size).toBe(1)
    expect(mapOf('mastery').get('m2')!.studentId).toBe('someone-else')
  })

  it('the guest purge flow removes every learning row by guestId', async () => {
    const res = await guestPurgeRoute.DELETE(req('http://x/api/account', 'DELETE', { guestId: GUEST }))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.deleted.learningRows).toBe(6) // 5 unclaimed + m2 (other student's row keeps guestId too)
    for (const name of ['mastery', 'planTasks', 'revision', 'mistakes', 'actions'] as const) {
      expect(mapOf(name).size).toBe(0)
    }
  })
})
