import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

// ─── Diagnostic scope extension (Phase 3B release review) ─────────────────────
// POST /api/learning/diagnostic accepts one TOPIC (legacy topicId form), one
// UNIT, one SUBJECT or one whole EXAM scope. Every non-topic selection goes
// through the topic relation, so all selected questions carry catalogue topics
// (per-topic results, mastery evidence, mistakes work identically). Insufficient
// verified coverage is an honest 409; unknown scopes 404; scope metadata
// (scopeType/scopeId/scopeLabel) is persisted in configJson so the four kinds
// are distinguishable afterwards; resume-not-stack works per scope.

interface FakeQuestion { id: string; topicId: string; correctIndex: number; optionsJson: string; verificationStatus: string }
interface FakeAttempt { id: string; guestId: string; status: string; source: string; topicId: string | null; subjectId: string | null; examId: string | null; title: string; configJson: string; questionIdsJson: string; answersJson: string; startedAt: Date }

const state = {
  questions: [] as FakeQuestion[],
  attempts: [] as FakeAttempt[],
  topics: [
    { id: 'topic-a1', unitId: 'unit-1', name: 'Kinematics' },
    { id: 'topic-a2', unitId: 'unit-1', name: 'Laws of Motion' },
    { id: 'topic-b1', unitId: 'unit-2', name: 'Thermodynamics' },
  ],
  units: [
    { id: 'unit-1', subjectId: 'subject-1', name: 'Mechanics' },
    { id: 'unit-2', subjectId: 'subject-1', name: 'Heat' },
  ],
  subjects: [{ id: 'subject-1', stageId: 'stage-1', name: 'Physics' }],
  stages: [{ id: 'stage-1', examId: 'exam-1', name: 'Main' }],
  exams: [{ id: 'exam-1', shortName: 'JEE', name: 'JEE Main' }],
}

function resetState() {
  state.questions = []
  state.attempts = []
  // 6 VERIFIED questions across TWO topics of unit-1 (subject-1 / exam-1):
  // enough for a UNIT/SUBJECT/EXAM diagnostic, NOT enough for either topic
  // alone (3 each — honest 409 territory for topic scopes).
  for (let i = 0; i < 3; i++) state.questions.push({ id: `qa1-${i}`, topicId: 'topic-a1', correctIndex: 0, optionsJson: '["a","b"]', verificationStatus: 'VERIFIED' })
  for (let i = 0; i < 3; i++) state.questions.push({ id: `qa2-${i}`, topicId: 'topic-a2', correctIndex: 0, optionsJson: '["a","b"]', verificationStatus: 'VERIFIED' })
  // One UNVERIFIED row — must never be selected or counted.
  state.questions.push({ id: 'qbad', topicId: 'topic-a1', correctIndex: 0, optionsJson: '["a","b"]', verificationStatus: 'UNVERIFIED' })
}

/** Fake question filter honoring the topic-relation scopes used by diagnostics. */
function scopeMatches(q: FakeQuestion, where: Record<string, unknown>): boolean {
  if (where.topicId !== undefined && q.topicId !== where.topicId) return false
  const topic = where.topic as Record<string, unknown> | undefined
  if (topic) {
    const t = state.topics.find(x => x.id === q.topicId)
    if (!t) return false
    if (topic.unitId !== undefined && t.unitId !== topic.unitId) return false
    const unit = topic.unit as Record<string, unknown> | undefined
    if (unit) {
      const u = state.units.find(x => x.id === t.unitId)
      if (!u) return false
      if (unit.subjectId !== undefined && u.subjectId !== unit.subjectId) return false
      const subject = unit.subject as Record<string, unknown> | undefined
      if (subject) {
        const s = state.subjects.find(x => x.id === u.subjectId)
        if (!s) return false
        const stage = subject.stage as Record<string, unknown> | undefined
        if (stage) {
          const st = state.stages.find(x => x.id === s.stageId)
          if (!st) return false
          const exam = stage.exam as Record<string, unknown> | undefined
          if (exam && exam.examId !== undefined && st.examId !== exam.examId) return false
        }
      }
    }
  }
  return true
}

const fakeDb = {
  question: {
    count: async ({ where }: { where: Record<string, unknown> }) =>
      state.questions.filter(q => q.verificationStatus === 'VERIFIED' && scopeMatches(q, where)).length,
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.questions.filter(q => q.verificationStatus === 'VERIFIED' && scopeMatches(q, where)).map(q => ({ id: q.id })),
  },
  topic: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const t = state.topics.find(x => x.id === where.id)
      if (!t) return null
      const u = state.units.find(x => x.id === t.unitId)!
      const s = state.subjects.find(x => x.id === u.subjectId)!
      const st = state.stages.find(x => x.id === s.stageId)!
      const e = state.exams.find(x => x.id === st.examId)!
      return { id: t.id, name: t.name, unit: { subject: { id: s.id, stage: { exam: { id: e.id, shortName: e.shortName, name: e.name } } } } }
    },
  },
  unit: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const u = state.units.find(x => x.id === where.id)
      if (!u) return null
      const s = state.subjects.find(x => x.id === u.subjectId)!
      const st = state.stages.find(x => x.id === s.stageId)!
      const e = state.exams.find(x => x.id === st.examId)!
      return { name: u.name, subject: { id: s.id, stage: { exam: { id: e.id, shortName: e.shortName, name: e.name } } } }
    },
  },
  subject: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const s = state.subjects.find(x => x.id === where.id)
      if (!s) return null
      const st = state.stages.find(x => x.id === s.stageId)!
      const e = state.exams.find(x => x.id === st.examId)!
      return { id: s.id, name: s.name, stage: { exam: { id: e.id, shortName: e.shortName, name: e.name } } }
    },
  },
  exam: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const e = state.exams.find(x => x.id === where.id)
      return e ? { id: e.id, shortName: e.shortName, name: e.name } : null
    },
  },
  attempt: {
    findFirst: async ({ where }: { where: { guestId: string; status: string; topicId?: string; source: string } }) =>
      state.attempts.find(a => a.guestId === where.guestId && a.status === where.status && (!where.topicId || a.topicId === where.topicId) && a.source === where.source) ?? null,
    findMany: async ({ where }: { where: { guestId: string; status: string; source: string; AND?: { configJson: { contains: string } }[] } }) =>
      state.attempts
        .filter(a => a.guestId === where.guestId && a.status === where.status && a.source === where.source)
        .filter(a => (where.AND ?? []).every(cond => a.configJson.includes(cond.configJson.contains)))
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: `da-${state.attempts.length + 1}`, startedAt: new Date() } as unknown as FakeAttempt
      state.attempts.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.attempts.find(a => a.id === where.id)
      if (!row) throw new Error('missing attempt')
      Object.assign(row, data)
      return row
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  sameOrigin: () => true,
  requireStudent: async () => null,
  getSessionStudent: async () => null,
}))

const diagnosticRoute = await import('@/app/api/learning/diagnostic/route')
const { DIAGNOSTIC_MIN_BANK } = await import('@/lib/learning/diagnostics')

// Each test uses its OWN guest id: the diagnostic rate limit (12/hour/owner)
// lives in a module-level in-memory bucket shared across the file's requests.
let guestSeq = 0
const GUEST = () => `guest-diag-${++guestSeq}`

function req(body: unknown): NextRequest {
  return new Request('http://x/api/learning/diagnostic', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

beforeEach(() => resetState())

describe('POST /api/learning/diagnostic — scopes', () => {
  it('legacy topicId form still works and carries TOPIC scope metadata', async () => {
    for (let i = 0; i < 6; i++) state.questions.push({ id: `extra-${i}`, topicId: 'topic-a1', correctIndex: 0, optionsJson: '["a","b"]', verificationStatus: 'VERIFIED' })
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), topicId: 'topic-a1' }))
    expect(res.status).toBe(200)
    const attempt = state.attempts[0]
    const config = JSON.parse(attempt.configJson)
    expect(config.kind).toBe('DIAGNOSTIC')
    expect(config.scopeType).toBe('TOPIC')
    expect(config.scopeId).toBe('topic-a1')
    expect(config.scopeLabel).toBe('Kinematics')
    expect(config.topicId).toBe('topic-a1')
    expect(attempt.topicId).toBe('topic-a1')
  })

  it('rejects a body that mixes the legacy and scope forms (400)', async () => {
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), topicId: 'topic-a1', scopeType: 'UNIT', scopeId: 'unit-1' }))
    expect(res.status).toBe(400)
  })

  it('rejects a body with neither topicId nor a full scope pair (400)', async () => {
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'UNIT' }))
    expect(res.status).toBe(400)
    const res2 = await diagnosticRoute.POST(req({ guestId: GUEST() }))
    expect(res2.status).toBe(400)
  })

  it('UNIT scope probes every topic of the unit (each topic alone is too thin)', async () => {
    // 3 + 3 = 6 VERIFIED across the unit's two topics — no single topic passes
    // the MIN bank guard, but the unit does.
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'UNIT', scopeId: 'unit-1' }))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.resumed).toBe(false)
    expect(dto.count).toBe(Math.min(6, 10))
    const attempt = state.attempts[0]
    const config = JSON.parse(attempt.configJson)
    expect(config.scopeType).toBe('UNIT')
    expect(config.scopeId).toBe('unit-1')
    expect(config.scopeLabel).toContain('Mechanics')
    expect(attempt.topicId).toBeNull()
    expect(attempt.subjectId).toBe('subject-1')
    expect(attempt.examId).toBe('exam-1')
    expect(attempt.title).toContain('Diagnostic')
    const chosen: string[] = JSON.parse(attempt.questionIdsJson)
    expect(chosen.length).toBe(dto.count)
    // Every selected question belongs to a topic of this unit; the UNVERIFIED row never appears.
    expect(chosen).not.toContain('qbad')
    const unitTopics = state.topics.filter(t => t.unitId === 'unit-1').map(t => t.id)
    for (const qid of chosen) {
      const q = state.questions.find(x => x.id === qid)
      expect(q).toBeDefined()
      expect(unitTopics).toContain(q!.topicId)
    }
  })

  it('SUBJECT scope aggregates across its units and persists subject metadata', async () => {
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'SUBJECT', scopeId: 'subject-1' }))
    expect(res.status).toBe(200)
    const attempt = state.attempts[0]
    const config = JSON.parse(attempt.configJson)
    expect(config.scopeType).toBe('SUBJECT')
    expect(config.scopeLabel).toContain('Physics')
    expect(attempt.subjectId).toBe('subject-1')
  })

  it('EXAM scope works across the whole syllabus area and leaves subjectId null', async () => {
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'EXAM', scopeId: 'exam-1' }))
    expect(res.status).toBe(200)
    const attempt = state.attempts[0]
    const config = JSON.parse(attempt.configJson)
    expect(config.scopeType).toBe('EXAM')
    expect(config.scopeLabel).toContain('JEE')
    expect(attempt.topicId).toBeNull()
    expect(attempt.subjectId).toBeNull()
    expect(attempt.examId).toBe('exam-1')
  })

  it('409s honestly per scope when verified coverage is too thin', async () => {
    // Unit-2 has NO questions at all; a topic has 3 < MIN.
    const resUnit = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'UNIT', scopeId: 'unit-2' }))
    expect(resUnit.status).toBe(409)
    const dtoUnit = await resUnit.json()
    expect(dtoUnit.error).toContain('verified questions')
    expect(dtoUnit.error).toContain('Heat')

    const resTopic = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'TOPIC', scopeId: 'topic-a1' }))
    expect(resTopic.status).toBe(409)
  })

  it('UNVERIFIED rows never count towards coverage (never fabricate a bank)', async () => {
    // topic-a1: 3 VERIFIED + 1 UNVERIFIED = 4 raw, 3 verified → 409 either way.
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'TOPIC', scopeId: 'topic-a1' }))
    expect(res.status).toBe(409)
    const dto = await res.json()
    expect(dto.error).toContain('3 available')
  })

  it('unknown scope ids are 404, not invented', async () => {
    expect((await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'UNIT', scopeId: 'unit-missing' }))).status).toBe(404)
    expect((await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'SUBJECT', scopeId: 'subject-missing' }))).status).toBe(404)
    expect((await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'EXAM', scopeId: 'exam-missing' }))).status).toBe(404)
    expect((await diagnosticRoute.POST(req({ guestId: GUEST(), topicId: 'topic-missing' }))).status).toBe(404)
  })

  it('resumes an in-progress diagnostic for the SAME scope instead of stacking', async () => {
    const guest = GUEST()
    const first = await diagnosticRoute.POST(req({ guestId: guest, scopeType: 'UNIT', scopeId: 'unit-1' }))
    expect(first.status).toBe(200)
    const firstId = (await first.json()).attemptId
    const again = await diagnosticRoute.POST(req({ guestId: guest, scopeType: 'UNIT', scopeId: 'unit-1' }))
    const dto = await again.json()
    expect(dto.resumed).toBe(true)
    expect(dto.attemptId).toBe(firstId)
    expect(state.attempts.length).toBe(1)
  })

  it('a different scope starts its own diagnostic (scopes do not collide)', async () => {
    const guest = GUEST()
    const first = await diagnosticRoute.POST(req({ guestId: guest, scopeType: 'UNIT', scopeId: 'unit-1' }))
    const second = await diagnosticRoute.POST(req({ guestId: guest, scopeType: 'SUBJECT', scopeId: 'subject-1' }))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const c1 = JSON.parse(state.attempts[0].configJson)
    const c2 = JSON.parse(state.attempts[1].configJson)
    expect(c1.scopeType).toBe('UNIT')
    expect(c2.scopeType).toBe('SUBJECT')
    expect(state.attempts.length).toBe(2)
  })

  it('an expired in-progress diagnostic for the same scope is abandoned, then replaced', async () => {
    const guest = GUEST()
    const first = await diagnosticRoute.POST(req({ guestId: guest, scopeType: 'UNIT', scopeId: 'unit-1' }))
    const firstId = (await first.json()).attemptId
    // Age it past the (count + 5) minute validity window.
    state.attempts[0].startedAt = new Date(Date.now() - 60 * 60_000)
    const next = await diagnosticRoute.POST(req({ guestId: guest, scopeType: 'UNIT', scopeId: 'unit-1' }))
    const dto = await next.json()
    expect(dto.resumed).toBe(false)
    expect(dto.attemptId).not.toBe(firstId)
    expect(state.attempts.find(a => a.id === firstId)?.status).toBe('ABANDONED')
    expect(state.attempts.filter(a => a.status === 'IN_PROGRESS').length).toBe(1)
  })

  it('the diagnostic never exceeds the max question count', async () => {
    expect(DIAGNOSTIC_MIN_BANK).toBe(6)
    for (let i = 0; i < 20; i++) state.questions.push({ id: `many-${i}`, topicId: 'topic-a1', correctIndex: 0, optionsJson: '["a","b"]', verificationStatus: 'VERIFIED' })
    const res = await diagnosticRoute.POST(req({ guestId: GUEST(), scopeType: 'TOPIC', scopeId: 'topic-a1' }))
    expect(res.status).toBe(200)
    const dto = await res.json()
    expect(dto.count).toBe(10)
    expect(JSON.parse(state.attempts[0].questionIdsJson).length).toBe(10)
  })
})
