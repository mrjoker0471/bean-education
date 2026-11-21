import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'

// ─── Route-level proofs for GET /api/student/dashboard (Phase 2B Milestone C) ──
// The critical property: EVERY aggregate query is scoped to studentId — a
// student can never see another student's attempts, documents or goals in any
// number, card or recommendation. Plus the honesty rules: fresh accounts get
// real zeros/nulls, accuracy math is correct, and recommendations are
// deterministic and data-backed.

const state = {
  student: null as Record<string, unknown> | null,
  attempts: [] as Record<string, unknown>[],
  documents: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.attempts = []
  state.documents = []
}

function attempt(over: Record<string, unknown>) {
  return {
    id: 'a',
    title: 'Attempt',
    examLabel: 'QA Demo',
    source: 'BANK',
    status: 'SUBMITTED',
    score: null,
    maxScore: null,
    correctCount: null,
    wrongCount: null,
    timeSpentSec: null,
    startedAt: new Date(Date.now() - 3 * 86_400_000),
    submittedAt: new Date(Date.now() - 3 * 86_400_000),
    perTopicJson: null,
    studentId: 'me',
    ...over,
  }
}

const capture = { attemptWhere: [] as unknown[], docWhere: [] as unknown[] }

const fakeDb = {
  student: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.student && where.id === state.student.id
        ? {
            id: state.student.id,
            email: 'me@bean.example',
            displayName: 'Me',
            learningLevel: 'UNDERGRAD',
            interestsJson: '["Physics"]',
            preferencesJson: JSON.stringify({ dailyMinutes: 30 }),
            onboardedAt: null,
          }
        : null,
  },
  attempt: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      capture.attemptWhere.push(where)
      // The fake honours the isolation filter like the real DB would.
      const scoped = (where as { studentId?: string }).studentId
      return state.attempts.filter(a => a.studentId === scoped)
    },
  },
  studyDocument: {
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      capture.docWhere.push(where)
      const scoped = (where as { studentId?: string }).studentId
      return state.documents
        .filter(d => d.studentId === scoped)
        .slice(0, (where as { take?: number }).take ?? 5)
    },
    count: async ({ where }: { where: Record<string, unknown> }) => {
      const scoped = (where as { studentId?: string }).studentId
      return state.documents.filter(d => d.studentId === scoped && (where as { status?: string }).status ? d.status === (where as { status?: string }).status : d.studentId === scoped).length
    },
  },
  riisheTest: { count: async () => 0 },
  studyGoal: {
    findMany: async ({ where }: { where: { studentId: string; status?: string } }) => [],
    count: async () => 0,
  },
  exam: { findMany: async () => [] },
  topic: { findMany: async () => [] },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
}))

const { GET } = await import('@/app/api/student/dashboard/route')

const ME = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: null }

describe('GET /api/student/dashboard', () => {
  beforeEach(() => {
    resetState()
    capture.attemptWhere = []
    capture.docWhere = []
  })

  it('a guest gets 401 — the dashboard is account-only', async () => {
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('every aggregate is scoped to studentId (data isolation)', async () => {
    state.student = ME
    state.attempts.push(attempt({ id: 'mine' }))
    state.attempts.push(attempt({ id: 'theirs', studentId: 'someone-else', title: 'Not mine' }))
    state.documents.push({ id: 'doc-mine', studentId: 'me', status: 'READY', title: 'Mine', statusDetail: null, pageCount: null, analysisJson: null, updatedAt: new Date() })
    state.documents.push({ id: 'doc-theirs', studentId: 'someone-else', status: 'READY', title: 'Not mine', statusDetail: null, pageCount: null, analysisJson: null, updatedAt: new Date() })
    const res = await GET()
    expect(res.status).toBe(200)
    // The queries themselves must carry the student scope.
    for (const where of capture.attemptWhere) expect((where as { studentId?: string }).studentId).toBe('me')
    for (const where of capture.docWhere) expect((where as { studentId?: string }).studentId).toBe('me')
    const body = (await res.json()) as { progress: { attempts: { count: number } }; continueLearning: { recentDocuments: { title: string }[] } }
    expect(body.progress.attempts.count).toBe(1)
    expect(body.continueLearning.recentDocuments.every(d => d.title === 'Mine')).toBe(true)
  })

  it('a fresh account gets honest zeros and nulls (nothing invented)', async () => {
    state.student = ME
    const res = await GET()
    const body = (await res.json()) as {
      progress: { attempts: { count: number; accuracy: number | null; lastActivityAt: string | null } }
      continueLearning: { recentDocuments: unknown[]; recentAttempts: unknown[]; recentTopics: string[] }
      goals: { active: unknown[]; completedCount: number }
      today: { attemptsToday: number; minutesToday: number | null }
    }
    expect(body.progress.attempts.count).toBe(0)
    expect(body.progress.attempts.accuracy).toBeNull()
    expect(body.progress.attempts.lastActivityAt).toBeNull()
    expect(body.continueLearning.recentDocuments).toEqual([])
    expect(body.continueLearning.recentAttempts).toEqual([])
    expect(body.continueLearning.recentTopics).toEqual([])
    expect(body.goals.active).toEqual([])
    expect(body.goals.completedCount).toBe(0)
    expect(body.today.attemptsToday).toBe(0)
    expect(body.today.minutesToday).toBeNull()
  })

  it('accuracy is Σcorrect/Σ(correct+wrong) over scored attempts only', async () => {
    state.student = ME
    state.attempts.push(attempt({ correctCount: 6, wrongCount: 4, status: 'SUBMITTED', submittedAt: new Date() }))
    state.attempts.push(attempt({ id: 'a2', correctCount: 9, wrongCount: 1, status: 'SUBMITTED', submittedAt: new Date() }))
    state.attempts.push(attempt({ id: 'a3', status: 'IN_PROGRESS' })) // unscored — excluded
    const res = await GET()
    const body = (await res.json()) as { progress: { attempts: { accuracy: number | null; submitted: number } } }
    expect(body.progress.attempts.accuracy).toBe(75) // (6+9)/(6+4+9+1) = 15/20
    expect(body.progress.attempts.submitted).toBe(2)
  })

  it('recommendations are deterministic and backed by real rows', async () => {
    state.student = ME
    state.documents.push({ id: 'doc-1', studentId: 'me', status: 'ANALYSING', title: 'Thermodynamics notes', statusDetail: null, pageCount: null, analysisJson: null, updatedAt: new Date() })
    const res = await GET()
    const body = (await res.json()) as { recommendations: { key: string; reason: string }[] }
    const cont = body.recommendations.find(r => r.key === 'continue-analysis')
    expect(cont).toBeTruthy()
    expect(cont?.reason).toContain('Thermodynamics notes')
  })

  it('weak accuracy plus enough scored attempts yields an honest review suggestion', async () => {
    state.student = ME
    for (let i = 0; i < 3; i++) {
      state.attempts.push(attempt({ id: `a${i}`, correctCount: 4, wrongCount: 6, status: 'SUBMITTED', submittedAt: new Date() }))
    }
    const res = await GET()
    const body = (await res.json()) as { recommendations: { key: string; reason: string }[] }
    const review = body.recommendations.find(r => r.key === 'review-attempts')
    expect(review).toBeTruthy()
    expect(review?.reason).toContain('40%')
  })
})
