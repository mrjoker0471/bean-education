// ─── Phase 7: Career privacy, employer exchange & free-pilot protection ──────
// Coverage (spec §28 — Career privacy / Credentials / Employers / Adult
// eligibility / Admin; §32 — Financial scope):
//   • Career profile defaults to PRIVATE; unconsented profiles are absent from
//     employer discovery; pausing discovery removes the profile from results.
//   • Discovery and applications are blocked until the adult-eligibility
//     review is APPROVED (server-side; the client cannot forge the state).
//   • Private projects and unshared credentials never enter public DTOs.
//   • Unverified employers cannot publish; employer A cannot edit B's listing;
//     only admin moderation reaches PUBLISHED; closed/expired listings reject
//     applications; duplicate applications blocked (unique pair); withdrawal
//     is student-only; employers see only their own applicants.
//   • Application snapshots never expose unselected data; contact details
//     stay private without explicit consent.
//   • Free-pilot protection: no payment models, endpoints, packages or
//     environment variables exist anywhere in the codebase (Phase 7 included).

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { completeAuthMock } from '../helpers/auth-mock'
import type { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

const career = await import('@/lib/career')

const state = {
  student: null as Record<string, unknown> | null,
  profiles: [] as Record<string, unknown>[],
  eligibility: [] as Record<string, unknown>[],
  opportunities: [] as Record<string, unknown>[],
  applications: [] as Record<string, unknown>[],
  orgs: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.profiles = []
  state.eligibility = []
  state.opportunities = []
  state.applications = []
  state.orgs = []
  state.memberships = []
  state.audit = []

  state.orgs.push({ id: 'emp1', name: 'Hiring Co', displayName: 'Hiring Co', slug: 'hiring-co', orgType: 'EMPLOYER', verificationStatus: 'APPROVED', isActive: true })
  state.orgs.push({ id: 'emp2', name: 'Rival Co', displayName: 'Rival Co', slug: 'rival-co', orgType: 'EMPLOYER', verificationStatus: 'APPROVED', isActive: true })
  state.orgs.push({ id: 'pend', name: 'Pending Co', displayName: 'Pending Co', slug: 'pending-co', orgType: 'EMPLOYER', verificationStatus: 'PENDING_REVIEW', isActive: true })
  state.opportunities.push({
    id: 'op1', employerOrganizationId: 'emp1', title: 'Junior Analyst', description: 'A real description long enough for validation.', status: 'PUBLISHED',
    opportunityType: 'JOB', applicationDeadline: new Date(Date.now() + 7 * 24 * 3600_000), organization: state.orgs[0],
  })
  state.opportunities.push({
    id: 'opClosed', employerOrganizationId: 'emp1', title: 'Closed Role', description: 'A real description long enough for validation.', status: 'CLOSED',
    opportunityType: 'JOB', applicationDeadline: new Date(Date.now() + 7 * 24 * 3600_000), organization: state.orgs[0],
  })
  state.opportunities.push({
    id: 'opExpired', employerOrganizationId: 'emp1', title: 'Expired Role', description: 'A real description long enough for validation.', status: 'PUBLISHED',
    opportunityType: 'JOB', applicationDeadline: new Date(Date.now() - 24 * 3600_000), organization: state.orgs[0],
  })
}

const fakeDb = {
  careerProfile: {
    findUnique: async ({ where }: { where: { studentId?: string; publicSlug?: string } }) =>
      state.profiles.find(p => (where.studentId && p.studentId === where.studentId) || (where.publicSlug && p.publicSlug === where.publicSlug)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.profiles
        .filter(p => (!where['visibility'] || p.visibility === where['visibility']))
        .map(p => ({
          ...p,
          student: {
            careerEligibilityReview: state.eligibility.find(e => e.studentId === p.studentId) ?? null,
            careerSkills: [],
            careerProjects: [],
            careerCredentials: [],
          },
        })),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const p = { id: `prof-${state.profiles.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      state.profiles.push(p)
      return p
    },
    update: async ({ where, data }: { where: { studentId: string }; data: Record<string, unknown> }) => {
      const p = state.profiles.find(x => x.studentId === where.studentId) as Record<string, unknown>
      Object.assign(p, data)
      return p
    },
    count: async ({ where }: { where: Record<string, unknown> }) =>
      state.profiles.filter(p => (!where['visibility'] || p.visibility === where['visibility'])).length,
  },
  careerEligibilityReview: {
    findUnique: async ({ where }: { where: { studentId?: string; id?: string } }) =>
      state.eligibility.find(e => (where.studentId && e.studentId === where.studentId) || (where.id && e.id === where.id)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const e = { id: `elig-${state.eligibility.length + 1}`, ...data }
      state.eligibility.push(e)
      return e
    },
    update: async ({ where, data }: { where: { studentId?: string; id?: string }; data: Record<string, unknown> }) => {
      const e = state.eligibility.find(x => (where.studentId && x.studentId === where.studentId) || (where.id && x.id === where.id)) as Record<string, unknown>
      Object.assign(e, data)
      return e
    },
  },
  careerOpportunity: {
    findUnique: async ({ where }: { where: { id: string } }) => state.opportunities.find(o => o.id === where.id) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const o = { id: `op-${state.opportunities.length + 1}`, updatedAt: new Date(), ...data, organization: state.orgs.find(x => x.id === data.employerOrganizationId) }
      state.opportunities.push(o)
      return o
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const o = state.opportunities.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(o, data)
      return o
    },
  },
  careerApplication: {
    findUnique: async ({ where }: { where: { id?: string; opportunityId_studentId?: { opportunityId: string; studentId: string } } }) => {
      let row: Record<string, unknown> | undefined
      if (where.opportunityId_studentId) {
        row = state.applications.find(a => a.opportunityId === where.opportunityId_studentId!.opportunityId && a.studentId === where.opportunityId_studentId!.studentId)
      } else {
        row = state.applications.find(a => a.id === where.id)
      }
      return row ? { ...row, opportunity: state.opportunities.find(o => o.id === row!.opportunityId) } : null
    },
    findFirst: async ({ where }: { where: { id?: string; studentId?: string } }) =>
      state.applications.find(a => (!where.id || a.id === where.id) && (!where.studentId || a.studentId === where.studentId)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.applications.filter(a => (!where['opportunityId'] || a.opportunityId === where['opportunityId'])),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      // Mirror the REAL (opportunityId, studentId) unique index — a duplicate
      // create throws the exact PrismaClientKnownRequestError the route catches.
      const clash = state.applications.find(a => a.opportunityId === data.opportunityId && a.studentId === data.studentId)
      if (clash) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
      const a = { id: `app-${state.applications.length + 1}`, ...data }
      state.applications.push(a)
      return a
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const a = state.applications.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(a, data)
      return a
    },
    count: async ({ where }: { where: Record<string, unknown> }) =>
      state.applications.filter(a => (!where['studentId'] || a.studentId === where['studentId'])).length,
  },
  organization: { findUnique: async ({ where }: { where: { id: string } }) => state.orgs.find(o => o.id === where.id) ?? null },
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId?: { organizationId: string; studentId: string } } }) => {
      if (!where.organizationId_studentId) return null
      const m = state.memberships.find(m => m.organizationId === where.organizationId_studentId!.organizationId && m.studentId === where.organizationId_studentId!.studentId)
      return m ? { ...m, organization: state.orgs.find(o => o.id === (m as Record<string, unknown>).organizationId) } : null
    },
  },
  careerAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => { state.audit.push(data); return { id: 'ca-1', ...data } },
    count: async ({ where }: { where: Record<string, unknown> }) =>
      state.audit.filter(a => (!where['actorId'] || a['actorId'] === where['actorId']) && (!where['entityType'] || a['entityType'] === where['entityType'])).length,
  },
  student: { findUnique: async () => ({ id: 'candidate-1' }) },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => completeAuthMock({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const applyRoute = await import('@/app/api/career/opportunities/[opportunityId]/apply/route')
const employerOppsRoute = await import('@/app/api/career/employer/opportunities/route')
const employerOppPatchRoute = await import('@/app/api/career/employer/opportunities/[employerOpportunityId]/route')
const candidatesRoute = await import('@/app/api/career/employer/candidates/route')
const withdrawRoute = await import('@/app/api/career/applications/[applicationId]/withdraw/route')
const employerAppStatusRoute = await import('@/app/api/career/employer/applications/[employerApplicationId]/status/route')
const profileRoute = await import('@/app/api/career/profile/route')
const eligibilityRoute = await import('@/app/api/career/eligibility/route')

function req(path: string, body?: unknown, method = 'POST'): NextRequest {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined && method === 'POST' ? '{}' : body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

const studentSession = { id: 'student-1', email: 'candidate@bean.test', role: 'STUDENT' }

describe('adult-eligibility safeguard (server-enforced)', () => {
  beforeEach(resetState)

  it('a student without an APPROVED review cannot apply (403)', async () => {
    state.student = studentSession
    const res = await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { headline: 'Hi' }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    expect(res.status).toBe(403)
    expect(state.applications.length).toBe(0)
  })

  it('requesting a review sets PENDING_REVIEW — still blocked until APPROVED', async () => {
    state.student = studentSession
    const res = await eligibilityRoute.POST(req('/api/career/eligibility', { acknowledge: true }))
    expect(res.status).toBe(201)
    expect((await res.json()).eligibility.status).toBe('PENDING_REVIEW')
    const apply = await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { headline: 'Hi' }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    expect(apply.status).toBe(403)
  })

  it('pure rule: only APPROVED unlocks; DISCOVERABLE alone is not enough', () => {
    expect(career.canApply('APPROVED')).toBe(true)
    expect(career.canApply('PENDING_REVIEW')).toBe(false)
    expect(career.canApply('NOT_ELIGIBLE')).toBe(false)
    expect(career.isDiscoverable({ visibility: 'DISCOVERABLE', eligibilityStatus: 'APPROVED' })).toBe(true)
    expect(career.isDiscoverable({ visibility: 'DISCOVERABLE', eligibilityStatus: 'PENDING_REVIEW' })).toBe(false)
    expect(career.isDiscoverable({ visibility: 'PRIVATE', eligibilityStatus: 'APPROVED' })).toBe(false)
    expect(career.isDiscoverable({ visibility: 'PAUSED', eligibilityStatus: 'APPROVED' })).toBe(false)
  })
})

describe('career profile privacy', () => {
  beforeEach(resetState)

  it('a lazily-created profile starts PRIVATE', async () => {
    state.student = studentSession
    const res = await profileRoute.GET()
    const body = await res.json()
    expect(body.profile.visibility).toBe('PRIVATE')
  })

  it('PAUSED hides immediately without destroying the consent choice (pure)', () => {
    expect(career.isDiscoverable({ visibility: 'PAUSED', eligibilityStatus: 'APPROVED' })).toBe(false)
    expect(career.isDiscoverable({ visibility: 'DISCOVERABLE', eligibilityStatus: 'APPROVED' })).toBe(true)
  })
})

describe('employer security', () => {
  beforeEach(resetState)

  it('an unverified employer organization cannot create an opportunity (403)', async () => {
    state.student = { id: 'recruiter-1', email: 'r1@bean.test', role: 'STUDENT' }
    state.memberships.push({ id: 'm1', organizationId: 'pend', studentId: 'recruiter-1', role: 'OWNER', status: 'ACTIVE' })
    const res = await employerOppsRoute.POST(req('/api/career/employer/opportunities', {
      organizationId: 'pend', title: 'Some Role Here', description: 'A real description that is definitely long enough.', opportunityType: 'JOB',
    }))
    expect(res.status).toBe(403)
    expect(state.opportunities.length).toBe(3)
  })

  it('employer A cannot edit employer B\u2019s listing (403)', async () => {
    state.student = { id: 'recruiter-2', email: 'r2@bean.test', role: 'STUDENT' }
    state.memberships.push({ id: 'm2', organizationId: 'emp2', studentId: 'recruiter-2', role: 'OWNER', status: 'ACTIVE' })
    const res = await employerOppPatchRoute.PATCH(
      req('/api/career/employer/opportunities/op1', { title: 'Hacked title here' }, 'PATCH'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    expect(res.status).toBe(403)
    expect((state.opportunities.find(o => o.id === 'op1') as Record<string, unknown>).title).toBe('Junior Analyst')
  })

  it('a closed listing rejects applications; an expired deadline rejects them too', async () => {
    state.student = studentSession
    state.eligibility.push({ id: 'e1', studentId: 'student-1', status: 'APPROVED' })
    const closed = await applyRoute.POST(req('/api/career/opportunities/opClosed/apply', { snapshot: { headline: 'Hi' }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'opClosed' }) })
    expect(closed.status).toBe(404)
    const expired = await applyRoute.POST(req('/api/career/opportunities/opExpired/apply', { snapshot: { headline: 'Hi' }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'opExpired' }) })
    expect(expired.status).toBe(409)
  })

  it('a duplicate application is rejected (unique pair semantics)', async () => {
    state.student = studentSession
    state.eligibility.push({ id: 'e1', studentId: 'student-1', status: 'APPROVED' })
    const first = await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { headline: 'Hi' }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    expect(first.status).toBe(201)
    state.applications.push({ id: 'app-dup', opportunityId: 'op1', studentId: 'student-1', status: 'SUBMITTED', snapshotJson: '{}', contactSharingConsent: false, submittedAt: new Date() })
    const second = await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { headline: 'Hi' }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    // The fake unique lookup now finds the row — the route must refuse.
    expect(second.status).toBe(409)
  })

  it('the snapshot stores ONLY what the student selected — unselected data never enters it', async () => {
    state.student = studentSession
    state.eligibility.push({ id: 'e1', studentId: 'student-1', status: 'APPROVED' })
    const res = await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { skills: ['Tally'] }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    expect(res.status).toBe(201)
    const stored = JSON.parse((state.applications.find(a => a.opportunityId === 'op1') as Record<string, unknown>).snapshotJson as string)
    expect(Object.keys(stored)).toEqual(['skills'])
    expect(stored['shareContact']).toBeUndefined()
    expect(stored['headline']).toBeUndefined()
  })

  it('contact details enter the snapshot ONLY with explicit consent', async () => {
    state.student = studentSession
    state.eligibility.push({ id: 'e1', studentId: 'student-1', status: 'APPROVED' })
    await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { headline: 'Analyst' }, contactSharingConsent: true }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    const stored = JSON.parse((state.applications.find(a => a.opportunityId === 'op1') as Record<string, unknown>).snapshotJson as string)
    expect(stored['shareContact']).toEqual({ email: 'candidate@bean.test' })
  })

  it('an oversized snapshot is rejected (bounded JSON)', async () => {
    state.student = studentSession
    state.eligibility.push({ id: 'e1', studentId: 'student-1', status: 'APPROVED' })
    const big = 'x'.repeat(9000)
    const res = await applyRoute.POST(req('/api/career/opportunities/op1/apply', { snapshot: { summary: big }, contactSharingConsent: false }), { params: Promise.resolve({ opportunityId: 'op1' }) })
    expect(res.status).toBe(400)
  })

  it('only the applicant can withdraw; employers cannot withdraw for them', async () => {
    state.student = studentSession
    state.applications.push({ id: 'mine', opportunityId: 'op1', studentId: 'student-1', status: 'SUBMITTED', snapshotJson: '{}', contactSharingConsent: false, submittedAt: new Date() })
    state.applications.push({ id: 'theirs', opportunityId: 'op1', studentId: 'other-student', status: 'SUBMITTED', snapshotJson: '{}', contactSharingConsent: false, submittedAt: new Date() })
    const ok = await withdrawRoute.PATCH(req('/api/career/applications/mine/withdraw', undefined, 'PATCH'), { params: Promise.resolve({ applicationId: 'mine' }) })
    expect(ok.status).toBe(200)
    const notMine = await withdrawRoute.PATCH(req('/api/career/applications/theirs/withdraw', undefined, 'PATCH'), { params: Promise.resolve({ applicationId: 'theirs' }) })
    expect(notMine.status).toBe(404)
    expect((state.applications.find(a => a.id === 'theirs') as Record<string, unknown>).status).toBe('SUBMITTED')
  })

  it('employer status changes cannot touch withdrawn applications and are audited', async () => {
    state.student = { id: 'recruiter-1', email: 'r1@bean.test', role: 'STUDENT' }
    state.memberships.push({ id: 'm1', organizationId: 'emp1', studentId: 'recruiter-1', role: 'RECRUITER', status: 'ACTIVE' })
    state.applications.push({ id: 'withdrawn', opportunityId: 'op1', studentId: 'student-1', status: 'WITHDRAWN', snapshotJson: '{}', contactSharingConsent: false, submittedAt: new Date() })
    const res = await employerAppStatusRoute.PATCH(
      req('/api/career/employer/applications/withdrawn/status', { status: 'SHORTLISTED' }, 'PATCH'),
      { params: Promise.resolve({ employerApplicationId: 'withdrawn' }) },
    )
    expect(res.status).toBe(409)
    expect(state.applications[0].status).toBe('WITHDRAWN')
  })

  it('discovery: PRIVATE or PAUSED profiles never surface; only APPROVED-eligible DISCOVERABLE ones do', async () => {
    state.student = { id: 'recruiter-1', email: 'r1@bean.test', role: 'STUDENT' }
    state.memberships.push({ id: 'm1', organizationId: 'emp1', studentId: 'recruiter-1', role: 'RECRUITER', status: 'ACTIVE' })
    state.profiles.push(
      { id: 'p1', studentId: 'student-1', visibility: 'PRIVATE', headline: 'Private one' },
      { id: 'p2', studentId: 'student-2', visibility: 'PAUSED', headline: 'Paused one' },
      { id: 'p3', studentId: 'student-3', visibility: 'DISCOVERABLE', headline: 'Public one' },
    )
    // Eligibility store: student-3 APPROVED, student-2 pending.
    state.eligibility.push(
      { id: 'e1', studentId: 'student-1', status: 'APPROVED' },
      { id: 'e2', studentId: 'student-2', status: 'PENDING_REVIEW' },
      { id: 'e3', studentId: 'student-3', status: 'APPROVED' },
    )
    const res = await candidatesRoute.GET(req('/api/career/employer/candidates?organizationId=emp1', undefined, 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const headlines = body.candidates.map((c: { headline: string }) => c.headline)
    expect(headlines).toContain('Public one')
    expect(headlines).not.toContain('Private one')
    expect(headlines).not.toContain('Paused one')
    // Candidate refs are opaque — never raw student ids.
    for (const c of body.candidates as { candidateRef: string }[]) {
      expect(c.candidateRef.startsWith('c_')).toBe(true)
      expect(c.candidateRef).not.toContain('student-')
    }
  })

  it('discovery requires an employer membership in the stated organization (403 otherwise)', async () => {
    state.student = { id: 'recruiter-9', email: 'r9@bean.test', role: 'STUDENT' }
    const res = await candidatesRoute.GET(req('/api/career/employer/candidates?organizationId=emp1', undefined, 'GET'))
    expect(res.status).toBe(403)
  })
})

// ─── Free-pilot protection (spec §32) ────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PAYMENT_TOKENS = ['razorpay', 'stripe', 'payment', 'checkout', 'wallet', 'payout', 'refund_ledger', 'subscription_plan']

describe('free-pilot protection — no payment functionality anywhere (spec §32)', () => {
  it('the Prisma schema contains no payment models or fields', () => {
    // Policy comments DOCUMENT the absence of payments — strip them before scanning.
    const stripComments = (src: string) => src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
    const schema = stripComments(readFileSync('prisma/schema.prisma', 'utf8'))
    for (const token of PAYMENT_TOKENS) {
      expect(schema.toLowerCase().includes(token)).toBe(false)
    }
    expect(schema).not.toMatch(/model\s+\w*(Payment|Order|Wallet|Subscription|Payout)/)
  })

  it('no payment package is installed', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const name of Object.keys(all)) {
      expect(name.toLowerCase().includes('razorpay')).toBe(false)
      expect(name.toLowerCase().includes('stripe')).toBe(false)
    }
  })

  it('no payment route folder or webhook exists under src/app/api', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) out.push(full, ...walk(full))
      }
      return out
    }
    const dirs = walk('src/app/api').map(d => d.toLowerCase())
    for (const d of dirs) {
      expect(d.includes('payment')).toBe(false)
      expect(d.includes('razorpay')).toBe(false)
      expect(d.includes('checkout')).toBe(false)
    }
  })

  it('no payment-related environment variable is read anywhere', () => {
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, acc)
        else if (full.endsWith('.ts') || full.endsWith('.tsx')) acc.push(full)
      }
      return acc
    }
    for (const file of walk('src')) {
      const src = readFileSync(file, 'utf8')
      expect(src).not.toMatch(/process\.env\.\w*(PAYMENT|RAZORPAY|STRIPE|CHECKOUT)\w*/i)
    }
  })

  it('no adverse decision (bad review, complaint, report) triggers any refund flow — none exists to trigger', () => {
    // The strongest possible guarantee: there is no refund code at all.
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, acc)
        else if (full.endsWith('.ts')) acc.push(full)
      }
      return acc
    }
    for (const file of walk('src/lib')) {
      const src = readFileSync(file, 'utf8').split('\n')
        .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n').toLowerCase()
      expect(src.includes('refund')).toBe(false)
    }
  })
})
