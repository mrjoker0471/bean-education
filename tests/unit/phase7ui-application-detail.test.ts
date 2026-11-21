// ─── Phase 7 UI completion: application detail (owner-scoped) ────────────────
// Route-level proofs against the REAL handler:
//   • The owner gets their application with the submission-time snapshot,
//     consent flag, candidate-visible status note, hosting opportunity and
//     employer organization — everything needed for a real detail screen.
//   • Another student's application resolves as 404 (no existence oracle) and
//     guests get 401.
//   • employerNotes is stored on the row but NEVER appears anywhere in the
//     response — the employer-private field stays employer-private.
// '@/lib/db' is a hand-rolled in-memory fake; '@/lib/auth' is stubbed to the
// session student — no DATABASE_URL needed.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'

const state = {
  student: null as Record<string, unknown> | null,
  orgs: [] as Record<string, unknown>[],
  opportunities: [] as Record<string, unknown>[],
  applications: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.orgs = []
  state.opportunities = []
  state.applications = []
}

const fakeDb = {
  careerApplication: {
    findFirst: async ({ where }: { where: { id?: string; studentId?: string } }) => {
      const row = state.applications.find(a => (!where.id || a.id === where.id) && (!where.studentId || a.studentId === where.studentId))
      if (!row) return null
      const opportunity = state.opportunities.find(o => o.id === row.opportunityId)
      return opportunity
        ? { ...row, opportunity: { ...opportunity, organization: state.orgs.find(o => o.id === opportunity.employerOrganizationId) ?? null } }
        : { ...row, opportunity: null }
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const detailRoute = await import('@/app/api/career/applications/[applicationId]/route')

function req(path: string): NextRequest {
  return new Request(`http://localhost${path}`, { method: 'GET' }) as unknown as NextRequest
}

function seed() {
  state.orgs.push({ id: 'emp1', name: 'Hiring Co', displayName: 'Hiring Co', orgType: 'EMPLOYER', verificationStatus: 'APPROVED' })
  state.opportunities.push({
    id: 'op1',
    employerOrganizationId: 'emp1',
    title: 'Junior Analyst',
    description: 'A real description that is long enough.',
    status: 'PUBLISHED',
    opportunityType: 'JOB',
    location: 'Mumbai, MH',
    workMode: 'HYBRID',
    applicationDeadline: new Date(Date.now() + 7 * 24 * 3600_000),
    organization: state.orgs[0],
  })
  state.applications.push({
    id: 'app1',
    opportunityId: 'op1',
    studentId: 'student-1',
    status: 'SHORTLISTED',
    snapshotJson: JSON.stringify({ headline: 'Aspiring Analyst', skills: ['Tally'], shareContact: { email: 'me@bean.test' } }),
    contactSharingConsent: true,
    employerNotes: 'Recruiter-private scribbles',
    candidateVisibleStatusNote: 'You are shortlisted — interview invite follows.',
    submittedAt: new Date(Date.now() - 2 * 24 * 3600_000),
    updatedAt: new Date(),
  })
  state.applications.push({
    id: 'appBroken',
    opportunityId: 'op1',
    studentId: 'student-1',
    status: 'SUBMITTED',
    snapshotJson: '{not json',
    contactSharingConsent: false,
    employerNotes: null,
    candidateVisibleStatusNote: null,
    submittedAt: new Date(),
    updatedAt: new Date(),
  })
}

describe('phase7ui: application detail (owner-scoped)', () => {
  beforeEach(resetState)

  it('the owner gets snapshot + consent flag + status note + opportunity + organization', async () => {
    seed()
    state.student = { id: 'student-1', email: 'me@bean.test', role: 'STUDENT' }
    const res = await detailRoute.GET(req('/api/career/applications/app1'), { params: Promise.resolve({ applicationId: 'app1' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    const app = body.application
    expect(app.status).toBe('SHORTLISTED')
    expect(app.candidateVisibleStatusNote).toBe('You are shortlisted — interview invite follows.')
    expect(app.contactSharingConsent).toBe(true)
    expect(app.snapshot.headline).toBe('Aspiring Analyst')
    expect(app.snapshot.skills).toEqual(['Tally'])
    expect(app.submittedAt).toBeTruthy()
    expect(app.opportunity).toEqual({
      id: 'op1',
      title: 'Junior Analyst',
      opportunityType: 'JOB',
      location: 'Mumbai, MH',
      workMode: 'HYBRID',
      applicationDeadline: expect.any(String),
    })
    expect(app.organization).toEqual({ id: 'emp1', name: 'Hiring Co', verificationStatus: 'APPROVED' })
  })

  it("another student's application is 404 — no existence oracle", async () => {
    seed()
    state.student = { id: 'other-student', email: 'other@bean.test', role: 'STUDENT' }
    const res = await detailRoute.GET(req('/api/career/applications/app1'), { params: Promise.resolve({ applicationId: 'app1' }) })
    expect(res.status).toBe(404)
  })

  it('a guest (no session) is 401', async () => {
    seed()
    state.student = null
    const res = await detailRoute.GET(req('/api/career/applications/app1'), { params: Promise.resolve({ applicationId: 'app1' }) })
    expect(res.status).toBe(401)
  })

  it('employerNotes never appear anywhere in the response', async () => {
    seed()
    state.student = { id: 'student-1', email: 'me@bean.test', role: 'STUDENT' }
    const res = await detailRoute.GET(req('/api/career/applications/app1'), { params: Promise.resolve({ applicationId: 'app1' }) })
    const raw = JSON.stringify(await res.json())
    expect(raw.includes('Recruiter-private scribbles')).toBe(false)
    expect(raw.includes('employerNotes')).toBe(false)
  })

  it('a corrupt snapshot degrades to an empty object instead of crashing', async () => {
    seed()
    state.student = { id: 'student-1', email: 'me@bean.test', role: 'STUDENT' }
    const res = await detailRoute.GET(req('/api/career/applications/appBroken'), { params: Promise.resolve({ applicationId: 'appBroken' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.application.snapshot).toEqual({})
    expect(body.application.status).toBe('SUBMITTED')
  })
})
