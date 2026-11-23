// ─── Account deletion coverage + export coverage ─────────────────────────────
// Route-level tests for POST /api/auth/account/delete (password reauth,
// typed confirm, research/OAuth cleanup, honest result) and GET (preview).
// Export coverage is verified structurally against the route's Promise.all
// member list (every personal-data domain the milestone requires).

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { resetRateLimits } from '@/lib/rate-limit'
import { readFileSync } from 'node:fs'

const state = {
  student: { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: '2026-01-01', signupIntent: 'STUDENT' } as Record<string, unknown> | null,
  accountPasswordHash: 'scrypt$16384$8$1$salt$' + 'a'.repeat(43),
  passwordOk: false,
  deletedTables: [] as string[],
  confirmSent: null as string | null,
}

function resetState() {
  state.student = { id: 'me', email: 'me@bean.example', displayName: 'Me', learningLevel: null, role: 'STUDENT', onboardedAt: '2026-01-01', signupIntent: 'STUDENT' }
  state.accountPasswordHash = 'scrypt$16384$8$1$salt$' + 'a'.repeat(43)
  state.passwordOk = false
  state.deletedTables = []
  state.confirmSent = null
}

function counting(name: string) {
  return {
    deleteMany: async () => { state.deletedTables.push(name); return { count: 1 } },
  }
}

const fakeDb = new Proxy({
  student: {
    findUnique: async ({ where, select }: { where: { id: string; email?: string }; select?: Record<string, boolean> }) => {
      if (where.id === 'me') {
        return select?.passwordHash ? { passwordHash: state.accountPasswordHash } : { id: 'me', passwordHash: state.accountPasswordHash }
      }
      return null
    },
    delete: async () => { state.deletedTables.push('student'); },
  },
  attempt: {
    findMany: async () => [{ id: 'a1' }],
    deleteMany: async () => { state.deletedTables.push('attempt'); return { count: 1 } },
    count: async () => 1,
  },
  studyDocument: {
    findMany: async () => [{ id: 'd1', storedPath: '/tmp/x.pdf' }],
    deleteMany: async () => { state.deletedTables.push('studyDocument'); return { count: 1 } },
    count: async () => 1,
  },
  $transaction: async (fn: (tx: typeof fakeDbTarget) => Promise<string[]>) => fn(fakeDbTarget),
} as Record<string, unknown>, {
  get(target, prop) {
    if (prop in target) return target[prop as string]
    // Auto-supplied counters for every remaining model the preview GET counts.
    if (prop === 'riisheExplanation') {
      return {
        count: async () => 0,
        deleteMany: async () => { state.deletedTables.push('riisheExplanation'); return { count: 1 } },
      }
    }
    return {
      count: async () => 0,
      deleteMany: async () => { state.deletedTables.push(String(prop)); return { count: 1 } },
    }
  },
}) as typeof fakeDbTarget

const fakeDbTarget = fakeDb as unknown as {
  student: { findUnique: (a: unknown) => Promise<unknown>; delete: () => Promise<void> }
  attempt: { findMany: () => Promise<unknown[]>; deleteMany: () => Promise<{ count: number }> }
  studyDocument: { findMany: () => Promise<unknown[]>; deleteMany: () => Promise<{ count: number }>; count: () => Promise<number> }
  $transaction: (fn: (tx: never) => Promise<string[]>) => Promise<string[]>
  [key: string]: unknown
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student as never,
  verifyPassword: async (_p: string, stored: string) => state.passwordOk && Boolean(stored),
  destroyCurrentSession: async () => undefined,
}))

const deleteRoute = await import('@/app/api/auth/account/delete/route')

function req(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/auth/account/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

describe('POST /api/auth/account/delete — safe deletion workflow', () => {
  beforeEach(() => { resetState(); resetRateLimits() })

  it('requires the typed DELETE confirmation', async () => {
    const res = await deleteRoute.POST(req({ confirm: 'delete', password: 'pw' }))
    expect(res.status).toBe(400)
    expect(state.deletedTables.length).toBe(0)
  })

  it('requires password re-authentication for password accounts', async () => {
    const res = await deleteRoute.POST(req({ confirm: 'DELETE', password: 'wrong' }))
    expect(res.status).toBe(401)
    expect(state.deletedTables.length).toBe(0)
  })

  it('deletes with correct password — including the FK-less research tables and OAuth identities', async () => {
    state.passwordOk = true
    const res = await deleteRoute.POST(req({ confirm: 'DELETE', password: 'right' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    // Honest result: the note never claims everything (including backups) is erased.
    expect(data.note).toContain('retention')
    for (const table of ['researchSession', 'researchPyqCandidate', 'oAuthIdentity', 'session', 'student']) {
      expect(state.deletedTables).toContain(table)
    }
  })

  it('lets Google-only accounts delete without a password', async () => {
    state.accountPasswordHash = null
    state.passwordOk = false
    const res = await deleteRoute.POST(req({ confirm: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(state.deletedTables).toContain('student')
  })

  it('a guest receives 401 and nothing is deleted', async () => {
    state.student = null
    const res = await deleteRoute.POST(req({ confirm: 'DELETE', password: 'x' }))
    expect(res.status).toBe(401)
    expect(state.deletedTables.length).toBe(0)
  })

  it('the deletion preview reports live category counts and reauth requirements', async () => {
    const res = await deleteRoute.GET()
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.categories.length).toBeGreaterThanOrEqual(12)
    expect(data.requiresPassword).toBe(true)
  })
})

// ─── Export coverage (structural) ──────────────────────────────────────────────
describe('GET /api/auth/account/export — export v2 coverage', () => {
  // The export route is heavily DB-bound; here we verify the coverage contract
  // structurally: the source must query every personal-data domain the
  // milestone requires, and declare bean-export-v2.
  const source = readFileSync('src/app/api/auth/account/export/route.ts', 'utf8')

  it('declares bean-export-v2 (research/teacher/career/legal/consent/oauth coverage)', () => {
    expect(source).toContain("bean-export-v2")
  })

  it('queries every required personal-data domain', () => {
    for (const model of [
      'db.researchSession.findMany',
      'db.researchPyqCandidate.findMany',
      'db.teacherProfile.findUnique',
      'db.classSession.findMany',
      'db.classBooking.findMany',
      'db.classReview.findMany',
      'db.teachComplaint.findMany',
      'db.teachAppeal.findMany',
      'db.organizationMembership.findMany',
      'db.careerProfile.findUnique',
      'db.studentCareerSkill.findMany',
      'db.careerProject.findMany',
      'db.careerCredential.findMany',
      'db.careerApplication.findMany',
      'db.legalAcceptance.findMany',
      'db.consentRecord.findMany',
      'db.oAuthIdentity.findMany',
    ]) {
      expect(source).toContain(model)
    }
  })

  it('exports profile signupIntent and ageBand but never the password hash', () => {
    expect(source).toContain('signupIntent: profile.signupIntent')
    expect(source).toContain('ageBand: profile.ageBand')
    // The profile select must not include the hash, and the payload must not
    // project it into the export.
    expect(source).not.toContain('passwordHash: true')
    expect(source).not.toContain('passwordHash: profile')
  })
})
