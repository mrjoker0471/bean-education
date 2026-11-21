import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

// ─── Route-level proofs for PATCH /api/student/profile (Phase 2B) ──────────────
// Covers: guest refusal, preference MERGE semantics, one-way onboarding stamp,
// and the security rule that a client can never touch its own role.

const state = {
  student: null as Record<string, unknown> | null,
  row: null as
    | {
        id: string
        email: string
        displayName: string | null
        learningLevel: string | null
        role: string
        interestsJson: string | null
        preferencesJson: string | null
        onboardedAt: Date | null
      }
    | null,
}

function resetState() {
  state.student = null
  state.row = {
    id: 'me',
    email: 'me@bean.example',
    displayName: null,
    learningLevel: null,
    role: 'STUDENT',
    interestsJson: null,
    preferencesJson: JSON.stringify({ dailyMinutes: 30 }),
    onboardedAt: null,
  }
}

const fakeDb = {
  student: {
    findUnique: async () => state.row,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      const row = state.row!
      if ('displayName' in data) row.displayName = data.displayName as string | null
      if ('learningLevel' in data) row.learningLevel = data.learningLevel as string | null
      if ('interestsJson' in data) row.interestsJson = data.interestsJson as string
      if ('preferencesJson' in data) row.preferencesJson = data.preferencesJson as string
      if ('onboardedAt' in data) row.onboardedAt = data.onboardedAt as Date
      if ('role' in data) row.role = data.role as string
      return row
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
}))

const { GET, PATCH } = await import('@/app/api/student/profile/route')

const ME = { id: 'me', email: 'me@bean.example', displayName: null, learningLevel: null, role: 'STUDENT', onboardedAt: null }

function patch(body: unknown): NextRequest {
  return new Request('http://localhost:3000/api/student/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('GET /api/student/profile', () => {
  beforeEach(resetState)

  it('a guest gets 401', async () => {
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('a signed-in student gets their profile with parsed preferences', async () => {
    state.student = ME
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { student: { preferences: Record<string, unknown>; onboardedAt: string | null } }
    expect(body.student.preferences.dailyMinutes).toBe(30)
    expect(body.student.onboardedAt).toBeNull()
  })
})

describe('PATCH /api/student/profile — persistence semantics', () => {
  beforeEach(resetState)

  it('a guest can never PATCH (401)', async () => {
    const res = await PATCH(patch({ displayName: 'New Name' }))
    expect(res.status).toBe(401)
  })

  it('displayName and learningLevel persist', async () => {
    state.student = ME
    const res = await PATCH(patch({ displayName: 'Asha', learningLevel: 'UNDERGRAD' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { student: { displayName: string | null; learningLevel: string | null } }
    expect(body.student.displayName).toBe('Asha')
    expect(body.student.learningLevel).toBe('UNDERGRAD')
  })

  it('preferences MERGE: existing keys survive, new keys are added, null clears one key', async () => {
    state.student = ME
    const res = await PATCH(patch({ preferences: { language: 'Tamil', dailyMinutes: null, educationCategory: 'COLLEGE' } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { student: { preferences: Record<string, unknown> } }
    expect(body.student.preferences.language).toBe('Tamil')
    expect(body.student.preferences.educationCategory).toBe('COLLEGE')
    expect('dailyMinutes' in body.student.preferences).toBe(false) // cleared by null
  })

  it('interests replace the list, dropping empties and deduping', async () => {
    state.student = ME
    const res = await PATCH(patch({ interests: ['Physics', '  ', 'Physics', 'Tamil'] }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { student: { interests: string[] } }
    expect(body.student.interests).toEqual(['Physics', 'Tamil'])
  })

  it('an invalid learningLevel is refused (400)', async () => {
    state.student = ME
    const res = await PATCH(patch({ learningLevel: 'PHD_SUPERMAN' }))
    expect(res.status).toBe(400)
  })

  it('onboardingComplete stamps onboardedAt exactly once', async () => {
    state.student = ME
    const first = await PATCH(patch({ onboardingComplete: true }))
    const stamped = ((await first.json()) as { student: { onboardedAt: string } }).student.onboardedAt
    expect(stamped).toBeTruthy()

    const second = await PATCH(patch({ displayName: 'Asha', onboardingComplete: true }))
    const again = ((await second.json()) as { student: { onboardedAt: string } }).student.onboardedAt
    expect(again).toBe(stamped) // the FIRST completion time is kept forever
  })
})

describe('PATCH /api/student/profile — role cannot be self-assigned', () => {
  beforeEach(resetState)

  it('a role field in the body is stripped by the schema and never changes the stored role', async () => {
    state.student = ME
    const res = await PATCH(patch({ displayName: 'Asha', role: 'ADMIN' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { student: { role?: string } }
    expect((body.student as Record<string, unknown>).role).toBeUndefined() // not part of the DTO
    expect(state.row?.role).toBe('STUDENT') // the stored role is untouched
  })
})
