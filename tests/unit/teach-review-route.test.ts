// ─── BEAN Teach (Phase 4A): admin review route tests ─────────────────────────
// ADMIN-only review: approve/reject, mandatory rejection reason, self-review
// block, append-only history.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
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
  student: { displayName: string | null; email: string; learningLevel: string | null }
}

const state = {
  student: null as Record<string, unknown> | null,
  profiles: new Map<string, FakeProfile>(),
  auditEvents: [] as { entityType: string; entityId: string; actorId: string; actorRole: string; action: string; detail: string | null }[],
}

function resetState() {
  state.student = null
  state.auditEvents = []
  state.profiles = new Map()
  state.profiles.set('app-1', {
    id: 'app-1',
    studentId: 'applicant-1',
    teachingName: 'Prof Pending',
    headline: 'Chemistry teacher with lab experience',
    bio: 'I teach organic and physical chemistry with experiment-first demonstrations for higher secondary students.',
    subjectsJson: '["Chemistry"]',
    levelsJson: '["SCHOOL_11_12"]',
    languagesJson: '["English"]',
    qualificationsText: 'MSc Chemistry; 5 years teaching in a senior secondary school',
    experienceYears: 5,
    portfolioUrl: null,
    verificationStatus: 'PENDING',
    isPublished: false,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    student: { displayName: 'Applicant One', email: 'applicant@bean.example', learningLevel: null },
  })
}

const fakeDb = {
  teacherProfile: {
    findUnique: async ({ where }: { where: { id?: string } }) => state.profiles.get(where.id ?? '') ?? null,
    findMany: async () => [...state.profiles.values()],
    count: async () => state.profiles.size,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.profiles.get(where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data)
      return row
    },
  },
  teachAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.auditEvents.push({
        ...data,
        createdAt: new Date(),
      })
      return {}
    },
    findMany: async ({ where }: { where: { entityType?: string; entityId?: { in?: string[] } } }) =>
      state.auditEvents.filter(
        e =>
          (!where.entityType || e.entityType === where.entityType) &&
          (!where.entityId?.in || where.entityId.in.includes(e.entityId)),
      ),
  },
  $transaction: async (fn: (tx: typeof fakeDb) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const adminRoute = await import('@/app/api/admin/teach/applications/route')
const reviewRoute = await import('@/app/api/admin/teach/applications/[id]/review/route')

const ADMIN = { id: 'admin-1', email: 'admin@bean.example', displayName: 'Admin', learningLevel: null, role: 'ADMIN', onboardedAt: null }
const STUDENT = { id: 'student-9', email: 's@bean.example', displayName: 'Student', learningLevel: null, role: 'STUDENT', onboardedAt: null }

function reviewReq(id: string, body: unknown): NextRequest {
  return new Request(`http://localhost/api/admin/teach/applications/${id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('GET /api/admin/teach/applications — admin-only listing', () => {
  beforeEach(resetState)

  it('a guest gets 401', async () => {
    const res = await adminRoute.GET(new Request('http://localhost/api/admin/teach/applications') as never)
    expect(res.status).toBe(401)
  })

  it('a plain student gets 403', async () => {
    state.student = STUDENT
    const res = await adminRoute.GET(new Request('http://localhost/api/admin/teach/applications') as never)
    expect(res.status).toBe(403)
  })

  it('an admin can list applications with applicant details and history', async () => {
    state.student = ADMIN
    const res = await adminRoute.GET(new Request('http://localhost/api/admin/teach/applications') as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.applications).toHaveLength(1)
    expect(body.applications[0].applicant.email).toBe('applicant@bean.example')
    expect(body.applications[0].verificationStatus).toBe('PENDING')
  })
})

describe('POST /api/admin/teach/applications/:id/review — decisions', () => {
  beforeEach(resetState)

  it('a non-admin cannot review (403)', async () => {
    state.student = STUDENT
    const res = await reviewRoute.POST(reviewReq('app-1', { action: 'APPROVE' }), { params: Promise.resolve({ id: 'app-1' }) })
    expect(res.status).toBe(403)
  })

  it('rejection requires a written reason (400 when too short)', async () => {
    state.student = ADMIN
    const res = await reviewRoute.POST(reviewReq('app-1', { action: 'REJECT', note: 'no' }), { params: Promise.resolve({ id: 'app-1' }) })
    expect(res.status).toBe(400)
    expect(state.profiles.get('app-1')!.verificationStatus).toBe('PENDING')
  })

  it('an admin can approve — profile becomes APPROVED + published, reviewer recorded, audit appended', async () => {
    state.student = ADMIN
    const res = await reviewRoute.POST(reviewReq('app-1', { action: 'APPROVE', note: 'Verified qualifications and experience.' }), { params: Promise.resolve({ id: 'app-1' }) })
    expect(res.status).toBe(200)
    const profile = state.profiles.get('app-1')!
    expect(profile.verificationStatus).toBe('APPROVED')
    expect(profile.isPublished).toBe(true)
    expect(profile.reviewedBy).toBe('admin-1')
    expect(profile.reviewedAt).not.toBeNull()
    expect(state.auditEvents.some(e => e.action === 'APPROVE' && e.actorRole === 'ADMIN')).toBe(true)
  })

  it('an admin can reject with a reason — profile REJECTED, unpublished, reason recorded', async () => {
    state.student = ADMIN
    const res = await reviewRoute.POST(reviewReq('app-1', { action: 'REJECT', note: 'Please add more detail about your qualifications.' }), { params: Promise.resolve({ id: 'app-1' }) })
    expect(res.status).toBe(200)
    const profile = state.profiles.get('app-1')!
    expect(profile.verificationStatus).toBe('REJECTED')
    expect(profile.isPublished).toBe(false)
    expect(profile.reviewNote).toBe('Please add more detail about your qualifications.')
    expect(state.auditEvents.some(e => e.action === 'REJECT')).toBe(true)
  })

  it('an admin cannot review their own application (403)', async () => {
    state.student = ADMIN
    const profile = state.profiles.get('app-1')!
    profile.studentId = 'admin-1' // the admin IS the applicant
    const res = await reviewRoute.POST(reviewReq('app-1', { action: 'APPROVE' }), { params: Promise.resolve({ id: 'app-1' }) })
    expect(res.status).toBe(403)
    expect(profile.verificationStatus).toBe('PENDING')
  })

  it('approving an already-approved profile is refused (409)', async () => {
    state.student = ADMIN
    state.profiles.get('app-1')!.verificationStatus = 'APPROVED'
    const res = await reviewRoute.POST(reviewReq('app-1', { action: 'APPROVE' }), { params: Promise.resolve({ id: 'app-1' }) })
    expect(res.status).toBe(409)
  })

  it('review history is append-only — every decision adds an event, none are deleted', async () => {
    state.student = ADMIN
    await reviewRoute.POST(reviewReq('app-1', { action: 'REJECT', note: 'Needs verifiable qualification references.' }), { params: Promise.resolve({ id: 'app-1' }) })
    // Resubmission path lives on the applicant side; simulate an APPROVE after a REJECT.
    state.profiles.get('app-1')!.verificationStatus = 'PENDING'
    await reviewRoute.POST(reviewReq('app-1', { action: 'APPROVE' }), { params: Promise.resolve({ id: 'app-1' }) })
    const events = state.auditEvents.filter(e => e.entityId === 'app-1')
    expect(events.map(e => e.action)).toEqual(['REJECT', 'APPROVE'])
    // The rejection detail is still present — history was never erased.
    expect(events.some(e => e.detail === 'Needs verifiable qualification references.')).toBe(true)
  })
})
