// ─── BEAN Teach (Phase 4A): teacher application route tests ──────────────────
// Route-level unit tests: the route module is imported with a mocked db and
// mocked auth (established repo pattern — see tests/unit/goals-route.test.ts).

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

interface FakeProfile {
  id: string
  studentId: string
  teachingName: string
  headline: string
  bio: string
  subjectsJson: string
  levelsJson: string
  languagesJson: string
  qualificationsText: string
  experienceYears: number
  portfolioUrl: string | null
  verificationStatus: string
  isPublished: boolean
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  createdAt: Date
  updatedAt: Date
}

const state = {
  student: null as Record<string, unknown> | null,
  profile: null as FakeProfile | null,
  profiles: new Map<string, FakeProfile>(),
  auditEvents: [] as { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail: string | null }[],
}

function resetState() {
  state.student = null
  state.profile = null
  state.profiles = new Map()
  state.auditEvents = []
}

const fakeDb = {
  teacherProfile: {
    findUnique: async ({ where }: { where: { studentId?: string; id?: string } }) => {
      if (where.studentId) return [...state.profiles.values()].find(p => p.studentId === where.studentId) ?? null
      return state.profiles.get(where.id ?? '') ?? null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeProfile = {
        id: `tp-${state.profiles.size + 1}`,
        studentId: String(data.studentId),
        teachingName: String(data.teachingName),
        headline: String(data.headline),
        bio: String(data.bio),
        subjectsJson: String(data.subjectsJson ?? '[]'),
        levelsJson: String(data.levelsJson ?? '[]'),
        languagesJson: String(data.languagesJson ?? '[]'),
        qualificationsText: String(data.qualificationsText ?? ''),
        experienceYears: Number(data.experienceYears ?? 0),
        portfolioUrl: (data.portfolioUrl as string | null) ?? null,
        verificationStatus: String(data.verificationStatus ?? 'PENDING'),
        isPublished: Boolean(data.isPublished ?? false),
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      state.profiles.set(row.id, row)
      state.profile = row
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.profiles.get(where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data)
      row.updatedAt = new Date()
      return row
    },
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.auditEvents.push({
        entityType: String(data.entityType),
        entityId: String(data.entityId),
        actorId: String(data.actorId),
        actorRole: String(data.actorRole),
        action: String(data.action),
        detail: (data.detail as string | null) ?? null,
      })
      return {}
    },
    findMany: async () => state.auditEvents.filter(e => e.entityType === 'TEACHER_PROFILE'),
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const route = await import('@/app/api/teach/application/route')

const ME = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function req(method: string, body?: unknown): NextRequest {
  return new Request('http://localhost/api/teach/application', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const VALID_APPLICATION = {
  teachingName: 'Prof Bean',
  headline: 'Physics teacher with 8 years of JEE coaching',
  bio: 'I teach mechanics and thermodynamics with a problem-first approach for school and competitive students.',
  subjects: ['Physics'],
  levels: ['SCHOOL_11_12'],
  languages: ['English'],
  qualificationsText: 'MSc Physics, state university; 8 years coaching experience',
  experienceYears: 8,
  portfolioUrl: null,
}

describe('POST /api/teach/application — application lifecycle', () => {
  beforeEach(resetState)

  it('a guest cannot apply (401)', async () => {
    const res = await route.POST(req('POST', VALID_APPLICATION))
    expect(res.status).toBe(401)
  })

  it('a signed-in student can apply (201) and a SUBMIT audit event is appended', async () => {
    state.student = ME
    const res = await route.POST(req('POST', VALID_APPLICATION))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.application.status).toBe('PENDING')
    expect(state.auditEvents.filter(e => e.action === 'SUBMIT')).toHaveLength(1)
  })

  it('a duplicate application while PENDING is refused (409)', async () => {
    state.student = ME
    await route.POST(req('POST', VALID_APPLICATION))
    const res = await route.POST(req('POST', VALID_APPLICATION))
    expect(res.status).toBe(409)
  })

  it('an invalid body is rejected with 400', async () => {
    state.student = ME
    const res = await route.POST(req('POST', { ...VALID_APPLICATION, experienceYears: 999 }))
    expect(res.status).toBe(400)
  })

  it('resubmission after rejection returns to PENDING and appends RESUBMIT (history preserved)', async () => {
    state.student = ME
    await route.POST(req('POST', VALID_APPLICATION))
    const profile = state.profile!
    profile.verificationStatus = 'REJECTED'
    profile.reviewNote = 'Needs more detail on qualifications.'
    // Simulate the admin's earlier rejection decision (the admin review route
    // appends this event — see teach-review-route.test.ts).
    state.auditEvents.push({
      entityType: 'TEACHER_PROFILE',
      entityId: profile.id,
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      action: 'REJECT',
      detail: 'Needs more detail on qualifications.',
      createdAt: new Date(),
    })
    const res = await route.POST(req('POST', { ...VALID_APPLICATION, qualificationsText: 'MSc Physics, PhD candidate, 8 years coaching experience with references' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.application.status).toBe('PENDING')
    expect(body.application.reviewNote).toBeNull()
    expect(state.auditEvents.some(e => e.action === 'RESUBMIT')).toBe(true)
    // Previous rejection event remains in the audit history — never erased.
    expect(state.auditEvents.some(e => e.action === 'REJECT' && e.detail === 'Needs more detail on qualifications.')).toBe(true)
  })
})

describe('PATCH /api/teach/application — edits and the re-review rule', () => {
  beforeEach(resetState)

  it('a guest cannot edit (401)', async () => {
    const res = await route.PATCH(req('PATCH', { headline: 'New headline here' }))
    expect(res.status).toBe(401)
  })

  it('an approved teacher editing verification-relevant details returns to PENDING (EDIT_REVIEW)', async () => {
    state.student = ME
    await route.POST(req('POST', VALID_APPLICATION))
    const profile = state.profile!
    profile.verificationStatus = 'APPROVED'
    profile.isPublished = true
    const res = await route.PATCH(req('PATCH', { qualificationsText: 'PhD Physics, IIT; 12 years of coaching experience' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.application.status).toBe('PENDING')
    expect(body.application.isPublished).toBe(false)
    expect(state.auditEvents.some(e => e.action === 'EDIT_REVIEW')).toBe(true)
  })

  it('an approved teacher toggling visibility alone stays APPROVED (PUBLISH_TOGGLE)', async () => {
    state.student = ME
    await route.POST(req('POST', VALID_APPLICATION))
    const profile = state.profile!
    profile.verificationStatus = 'APPROVED'
    profile.isPublished = true
    const res = await route.PATCH(req('PATCH', { isPublished: false }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.application.status).toBe('APPROVED')
    expect(body.application.isPublished).toBe(false)
    expect(state.auditEvents.some(e => e.action === 'PUBLISH_TOGGLE')).toBe(true)
  })

  it('an empty PATCH is refused (400)', async () => {
    state.student = ME
    await route.POST(req('POST', VALID_APPLICATION))
    const res = await route.PATCH(req('PATCH', {}))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/teach/application — status visibility', () => {
  beforeEach(resetState)

  it('a guest gets 401', async () => {
    const res = await route.GET()
    expect(res.status).toBe(401)
  })

  it('a student with no application gets null (NOT_APPLIED)', async () => {
    state.student = ME
    const res = await route.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.application).toBeNull()
  })
})
