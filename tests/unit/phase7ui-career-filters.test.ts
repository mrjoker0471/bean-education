// ─── Phase 7 UI completion: career filters, pagination & employer notes ──────
// Route-level proofs against the REAL handlers (routes imported after mocks):
//   • Public browse: location/skill/employer narrowing, deadline window filters
//     (invalid ISO → 400), `total` matches the filtered where, q/type/workMode
//     unchanged, and only PUBLISHED listings of APPROVED + active orgs surface.
//   • Employer listings: status filter (enum|ALL, default ALL), pagination with
//     total, counts stay over the FULL own-org set, other orgs are 403.
//   • Employer applicants: status filter + pagination + total; the shared
//     submission snapshot and the employer's private notes are present for the
//     employer UI; per-status counts stay unfiltered.
//   • Status PATCH: candidateVisibleStatusNote + employerNotes are writable and
//     the note write is audited with the transition; overlong notes are 400;
//     terminal decisions stay frozen.
//   • Candidate discovery: roleType/location are matched against the real
//     preferredRoleTypes/preferredLocations profile columns; PRIVATE or
//     non-APPROVED profiles never surface; `total` present.
//   • My applications: optional status filter (invalid → 400) and employerNotes
//     never appear. Credentials expose issuerName for portfolio display.
// '@/lib/db' is a hand-rolled in-memory fake evaluating the same where shapes
// the routes build; '@/lib/auth' is stubbed to the session student — no
// DATABASE_URL needed.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

// ─── In-memory state ──────────────────────────────────────────────────────────

const state = {
  student: null as Record<string, unknown> | null,
  orgs: [] as Record<string, unknown>[],
  opportunities: [] as Record<string, unknown>[],
  applications: [] as Record<string, unknown>[],
  profiles: [] as Record<string, unknown>[],
  eligibility: [] as Record<string, unknown>[],
  memberships: [] as Record<string, unknown>[],
  credentials: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
}

function resetState() {
  state.student = null
  state.orgs = []
  state.opportunities = []
  state.applications = []
  state.profiles = []
  state.eligibility = []
  state.memberships = []
  state.credentials = []
  state.audit = []
}

// ─── Where evaluation (mirrors SQLite `contains` = case-insensitive LIKE) ────

type Row = Record<string, unknown>

function containsValue(field: unknown, needle: string): boolean {
  if (field === null || field === undefined) return false
  return String(field).toLowerCase().includes(needle.toLowerCase())
}

function matchFilter(row: Row, key: string, cond: unknown): boolean {
  if (key === 'organization') return matchWhere((row.organization ?? {}) as Row, cond as Row)
  if (cond === null || cond === undefined) return row[key] === null || row[key] === undefined
  if (typeof cond !== 'object') return row[key] === cond
  const c = cond as Row
  let ok = true
  if ('contains' in c) ok = ok && containsValue(row[key], String(c.contains))
  if ('gt' in c) ok = ok && row[key] instanceof Date && (row[key] as Date).getTime() > (c.gt as Date).getTime()
  if ('lte' in c) ok = ok && row[key] instanceof Date && (row[key] as Date).getTime() <= (c.lte as Date).getTime()
  if ('gte' in c) ok = ok && row[key] instanceof Date && (row[key] as Date).getTime() >= (c.gte as Date).getTime()
  if ('OR' in c) ok = ok && (c.OR as Row[]).some(branch => matchWhere(row, branch))
  return ok
}

function matchWhere(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some(branch => matchWhere(row, branch))
    if (key === 'AND') return (cond as Row[]).every(branch => matchWhere(row, branch))
    if (key === 'student') {
      // Join filter: the profile's eligibility review is resolved from the
      // eligibility table by studentId (mirrors the real relational gate).
      const wanted = ((cond as Row).careerEligibilityReview ?? {}) as Row
      const review = state.eligibility.find(e => e.studentId === row.studentId) ?? null
      return !!review && matchFilter(review, 'status', wanted.status)
    }
    return matchFilter(row, key, cond)
  })
}

function filterRows(rows: Row[], where: Row): Row[] {
  return rows.filter(r => matchWhere(r, where))
}

function sortByDesc(rows: Row[], key: string): Row[] {
  return [...rows].sort((a, b) => ((b[key] as Date | undefined)?.getTime() ?? 0) - ((a[key] as Date | undefined)?.getTime() ?? 0))
}

// ─── Fake db ──────────────────────────────────────────────────────────────────

const fakeDb = {
  organization: {
    findUnique: async ({ where }: { where: { id: string } }) => state.orgs.find(o => o.id === where.id) ?? null,
  },
  organizationMembership: {
    findUnique: async ({ where }: { where: { organizationId_studentId?: { organizationId: string; studentId: string } } }) => {
      if (!where.organizationId_studentId) return null
      const m = state.memberships.find(
        m => m.organizationId === where.organizationId_studentId!.organizationId && m.studentId === where.organizationId_studentId!.studentId,
      )
      return m ? { ...m, organization: state.orgs.find(o => o.id === (m as Row).organizationId) } : null
    },
  },
  careerOpportunity: {
    findUnique: async ({ where }: { where: { id: string } }) => state.opportunities.find(o => o.id === where.id) ?? null,
    findMany: async ({ where, skip, take, orderBy }: { where: Row; skip?: number; take?: number; orderBy?: Row }) => {
      let rows = filterRows(state.opportunities, where)
      if (orderBy?.['updatedAt'] === 'desc') rows = sortByDesc(rows, 'updatedAt')
      if (orderBy?.['publishedAt'] === 'desc') rows = sortByDesc(rows, 'publishedAt')
      return typeof skip === 'number' && typeof take === 'number' ? rows.slice(skip, skip + take) : rows
    },
    count: async ({ where }: { where: Row }) => filterRows(state.opportunities, where).length,
  },
  careerApplication: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = state.applications.find(a => a.id === where.id)
      return row ? { ...row, opportunity: state.opportunities.find(o => o.id === (row as Row).opportunityId) } : null
    },
    findFirst: async ({ where }: { where: Row }) => {
      const row = state.applications.find(a => matchWhere(a, where))
      return row ? { ...row, opportunity: state.opportunities.find(o => o.id === (row as Row).opportunityId) } : null
    },
    findMany: async ({ where, skip, take, orderBy }: { where: Row; skip?: number; take?: number; orderBy?: Row }) => {
      let rows = filterRows(state.applications, where)
      if (orderBy?.['submittedAt'] === 'desc') rows = sortByDesc(rows, 'submittedAt')
      const joined = rows.map(a => ({ ...a, opportunity: state.opportunities.find(o => o.id === (a as Row).opportunityId) }))
      return typeof skip === 'number' && typeof take === 'number' ? joined.slice(skip, skip + take) : joined
    },
    count: async ({ where }: { where: Row }) => filterRows(state.applications, where).length,
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const a = state.applications.find(x => x.id === where.id) as Row
      // Prisma ignores undefined fields — mirror that (undefined ≠ clear).
      for (const [k, v] of Object.entries(data)) if (v !== undefined) a[k] = v
      return a
    },
  },
  careerProfile: {
    findMany: async ({ where, skip, take, orderBy }: { where: Row; skip?: number; take?: number; orderBy?: Row }) => {
      let rows = filterRows(state.profiles, where)
      if (orderBy?.['updatedAt'] === 'desc') rows = sortByDesc(rows, 'updatedAt')
      rows = rows.map(p => ({
        ...p,
        student: {
          careerEligibilityReview: state.eligibility.find(e => e.studentId === (p as Row).studentId) ?? null,
          careerSkills: [],
          careerProjects: [],
          careerCredentials: [],
        },
      }))
      return typeof skip === 'number' && typeof take === 'number' ? rows.slice(skip, skip + take) : rows
    },
    count: async ({ where }: { where: Row }) => filterRows(state.profiles, where).length,
  },
  careerCredential: {
    findMany: async ({ where }: { where: Row }) =>
      filterRows(state.credentials, where).map(c => ({
        ...c,
        issuerOrganization: state.orgs.find(o => o.id === (c as Row).issuerOrganizationId),
      })),
  },
  careerAuditEvent: {
    create: async ({ data }: { data: Row }) => {
      state.audit.push(data)
      return { id: `audit-${state.audit.length}`, ...data }
    },
    count: async ({ where }: { where: Row }) =>
      state.audit.filter(
        a =>
          (!where['actorId'] || a['actorId'] === where['actorId']) &&
          (!where['entityType'] || a['entityType'] === where['entityType']),
      ).length,
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.student,
  sameOrigin: () => true,
  getSessionStudent: async () => state.student,
}))

const publicRoute = await import('@/app/api/career/opportunities/route')
const employerListingsRoute = await import('@/app/api/career/employer/opportunities/route')
const applicantsRoute = await import('@/app/api/career/employer/opportunities/[employerOpportunityId]/applications/route')
const statusRoute = await import('@/app/api/career/employer/applications/[employerApplicationId]/status/route')
const candidatesRoute = await import('@/app/api/career/employer/candidates/route')
const myAppsRoute = await import('@/app/api/career/my-applications/route')
const credentialsRoute = await import('@/app/api/career/credentials/route')

function req(path: string, body?: unknown, method = 'POST'): NextRequest {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined && method === 'POST' ? '{}' : body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const DAY = 24 * 3600_000

function seedOrg(id: string, overrides: Row = {}) {
  state.orgs.push({
    id, name: `Org ${id}`, displayName: `Org ${id}`, slug: `org-${id}`, orgType: 'EMPLOYER',
    verificationStatus: 'APPROVED', isActive: true, logoText: null, ...overrides,
  })
}

function seedOpportunity(id: string, orgId: string, overrides: Row = {}) {
  state.opportunities.push({
    id,
    employerOrganizationId: orgId,
    title: `Role ${id}`,
    description: 'A real description that is long enough for any validation.',
    status: 'PUBLISHED',
    opportunityType: 'JOB',
    workMode: null,
    location: null,
    preferredSkills: null,
    applicationDeadline: new Date(Date.now() + 7 * DAY),
    publishedAt: new Date(Date.now() - DAY),
    updatedAt: new Date(),
    organization: state.orgs.find(o => o.id === orgId),
    ...overrides,
  })
}

function seedApplication(id: string, opportunityId: string, studentId: string, overrides: Row = {}) {
  state.applications.push({
    id,
    opportunityId,
    studentId,
    status: 'SUBMITTED',
    snapshotJson: JSON.stringify({ headline: `Headline ${id}`, skills: ['Tally'] }),
    contactSharingConsent: false,
    employerNotes: null,
    candidateVisibleStatusNote: null,
    submittedAt: new Date(Date.now() - 3 * DAY),
    updatedAt: new Date(),
    ...overrides,
  })
}

const recruiter = (id: string, orgId: string, role = 'RECRUITER') => {
  state.memberships.push({ id: `m-${id}-${orgId}`, organizationId: orgId, studentId: id, role, status: 'ACTIVE' })
  return { id, email: `${id}@bean.test`, role: 'STUDENT' }
}

// ─── Public browse ────────────────────────────────────────────────────────────

describe('phase7ui: public opportunity browse filters', () => {
  beforeEach(resetState)

  it('location filter narrows results (case-insensitive contains)', async () => {
    seedOrg('emp1')
    seedOpportunity('opA', 'emp1', { location: 'Mumbai, MH' })
    seedOpportunity('opB', 'emp1', { location: 'Pune, MH' })
    const res = await publicRoute.GET(req('/api/career/opportunities?location=mumbai', undefined, 'GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.opportunities.map((o: { id: string }) => o.id)).toEqual(['opA'])
    expect(body.total).toBe(1)
  })

  it('skill filter matches the real preferredSkills column', async () => {
    seedOrg('emp1')
    seedOpportunity('opA', 'emp1', { preferredSkills: JSON.stringify(['Tally', 'Excel']) })
    seedOpportunity('opB', 'emp1', { preferredSkills: JSON.stringify(['Python']) })
    const hit = await publicRoute.GET(req('/api/career/opportunities?skill=tally', undefined, 'GET'))
    expect((await hit.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opA'])
    const miss = await publicRoute.GET(req('/api/career/opportunities?skill=rust', undefined, 'GET'))
    expect((await miss.json()).total).toBe(0)
  })

  it('employer filter matches the organization name via the relation', async () => {
    seedOrg('emp1', { name: 'Hiring Co', displayName: 'Hiring Co Ltd' })
    seedOrg('emp2', { name: 'Rival Co', displayName: 'Rival Co' })
    seedOpportunity('opA', 'emp1')
    seedOpportunity('opB', 'emp2')
    const byDisplayName = await publicRoute.GET(req('/api/career/opportunities?employer=hiring', undefined, 'GET'))
    expect((await byDisplayName.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opA'])
    const byName = await publicRoute.GET(req('/api/career/opportunities?employer=rival+co', undefined, 'GET'))
    expect((await byName.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opB'])
  })

  it('deadlineBefore and deadlineAfter narrow the deadline window', async () => {
    seedOrg('emp1')
    seedOpportunity('opSoon', 'emp1', { applicationDeadline: new Date(Date.now() + 7 * DAY) })
    seedOpportunity('opLate', 'emp1', { applicationDeadline: new Date(Date.now() + 30 * DAY) })
    const before = await publicRoute.GET(req(`/api/career/opportunities?deadlineBefore=${new Date(Date.now() + 10 * DAY).toISOString()}`, undefined, 'GET'))
    expect((await before.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opSoon'])
    const after = await publicRoute.GET(req(`/api/career/opportunities?deadlineAfter=${new Date(Date.now() + 10 * DAY).toISOString()}`, undefined, 'GET'))
    expect((await after.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opLate'])
  })

  it('an invalid deadline filter is a 400', async () => {
    seedOrg('emp1')
    seedOpportunity('opA', 'emp1')
    const garbage = await publicRoute.GET(req('/api/career/opportunities?deadlineBefore=not-a-date', undefined, 'GET'))
    expect(garbage.status).toBe(400)
    const nonIso = await publicRoute.GET(req('/api/career/opportunities?deadlineAfter=March%205%2C%202026', undefined, 'GET'))
    expect(nonIso.status).toBe(400)
  })

  it('total reflects the filtered set while page/pageSize slice it', async () => {
    seedOrg('emp1')
    seedOpportunity('opA', 'emp1', { location: 'Mumbai' })
    seedOpportunity('opB', 'emp1', { location: 'Mumbai' })
    seedOpportunity('opC', 'emp1', { location: 'Pune' })
    const res = await publicRoute.GET(req('/api/career/opportunities?location=Mumbai&page=2&pageSize=1', undefined, 'GET'))
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(1)
    expect(body.opportunities).toHaveLength(1)
    expect(body.opportunities[0].id).toBe('opB')
  })

  it('q, type and workMode filters keep working (regression)', async () => {
    seedOrg('emp1', { name: 'Hiring Co', displayName: 'Hiring Co' })
    seedOpportunity('opA', 'emp1', { title: 'Junior Analyst', opportunityType: 'JOB', workMode: 'REMOTE' })
    seedOpportunity('opB', 'emp1', { title: 'Designer', opportunityType: 'INTERNSHIP', workMode: 'ONSITE' })
    const byQ = await publicRoute.GET(req('/api/career/opportunities?q=analyst', undefined, 'GET'))
    expect((await byQ.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opA'])
    const byType = await publicRoute.GET(req('/api/career/opportunities?type=INTERNSHIP', undefined, 'GET'))
    expect((await byType.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opB'])
    const byWorkMode = await publicRoute.GET(req('/api/career/opportunities?workMode=remote', undefined, 'GET'))
    expect((await byWorkMode.json()).opportunities.map((o: { id: string }) => o.id)).toEqual(['opA'])
  })

  it('only PUBLISHED listings of APPROVED + active employer organizations stay visible', async () => {
    seedOrg('empOk')
    seedOrg('empSuspended', { verificationStatus: 'SUSPENDED' })
    seedOrg('empArchived', { isActive: false })
    seedOpportunity('opOk', 'empOk')
    seedOpportunity('opClosed', 'empOk', { status: 'CLOSED' })
    seedOpportunity('opSuspendedOrg', 'empSuspended')
    seedOpportunity('opArchivedOrg', 'empArchived')
    const res = await publicRoute.GET(req('/api/career/opportunities', undefined, 'GET'))
    const body = await res.json()
    expect(body.opportunities.map((o: { id: string }) => o.id)).toEqual(['opOk'])
    expect(body.total).toBe(1)
  })
})

// ─── Employer listings management ─────────────────────────────────────────────

describe('phase7ui: employer listings management filters', () => {
  beforeEach(resetState)

  it('status filter returns only that status; default stays ALL', async () => {
    state.student = recruiter('r1', 'emp100', 'OWNER')
    seedOrg('emp100')
    seedOpportunity('opDraft', 'emp100', { status: 'DRAFT' })
    seedOpportunity('opLive', 'emp100', { status: 'PUBLISHED' })
    seedOpportunity('opDead', 'emp100', { status: 'CLOSED' })
    const all = await employerListingsRoute.GET(req('/api/career/employer/opportunities?organizationId=emp100', undefined, 'GET'))
    const allBody = await all.json()
    expect(allBody.opportunities).toHaveLength(3)
    expect(allBody.total).toBe(3)
    const published = await employerListingsRoute.GET(req('/api/career/employer/opportunities?organizationId=emp100&status=PUBLISHED', undefined, 'GET'))
    const publishedBody = await published.json()
    expect(publishedBody.opportunities.map((o: { id: string }) => o.id)).toEqual(['opLive'])
    expect(publishedBody.total).toBe(1)
  })

  it('pagination slices the filtered set and total stays global', async () => {
    state.student = recruiter('r1', 'emp100', 'OWNER')
    seedOrg('emp100')
    for (let i = 1; i <= 5; i++) seedOpportunity(`op${i}`, 'emp100')
    const res = await employerListingsRoute.GET(req('/api/career/employer/opportunities?organizationId=emp100&page=2&pageSize=2', undefined, 'GET'))
    const body = await res.json()
    expect(body.total).toBe(5)
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(2)
    expect(body.opportunities).toHaveLength(2)
  })

  it('an invalid status filter is a 400', async () => {
    state.student = recruiter('r1', 'emp100', 'OWNER')
    seedOrg('emp100')
    const res = await employerListingsRoute.GET(req('/api/career/employer/opportunities?organizationId=emp100&status=NOT_A_STATUS', undefined, 'GET'))
    expect(res.status).toBe(400)
  })

  it('scoping is unchanged (other org is 403) and counts always cover the full own-org set', async () => {
    state.student = recruiter('r2', 'emp200', 'OWNER')
    seedOrg('emp100')
    seedOrg('emp200')
    seedOpportunity('opA', 'emp100', { status: 'PUBLISHED' })
    const foreign = await employerListingsRoute.GET(req('/api/career/employer/opportunities?organizationId=emp100', undefined, 'GET'))
    expect(foreign.status).toBe(403)

    state.student = recruiter('r1', 'emp100', 'OWNER')
    seedOpportunity('opB', 'emp100', { status: 'DRAFT' })
    const filtered = await employerListingsRoute.GET(req('/api/career/employer/opportunities?organizationId=emp100&status=PUBLISHED', undefined, 'GET'))
    const body = await filtered.json()
    expect(body.counts).toEqual({ draft: 1, pending: 0, published: 1, closed: 0 })
    expect(body.opportunities.map((o: { id: string }) => o.id)).toEqual(['opA'])
  })
})

// ─── Employer applicants ──────────────────────────────────────────────────────

describe('phase7ui: employer applicant list filters', () => {
  beforeEach(resetState)

  it('status filter narrows applicants; pagination slices with a global total', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1', { submittedAt: new Date(Date.now() - 3 * DAY) })
    seedApplication('a2', 'op1', 's2', { submittedAt: new Date(Date.now() - 2 * DAY) })
    seedApplication('a3', 'op1', 's3', { status: 'SHORTLISTED', submittedAt: new Date(Date.now() - DAY) })

    const filtered = await applicantsRoute.GET(
      req('/api/career/employer/opportunities/op1/applications?status=SHORTLISTED', undefined, 'GET'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    const filteredBody = await filtered.json()
    expect(filteredBody.applications.map((a: { id: string }) => a.id)).toEqual(['a3'])
    expect(filteredBody.total).toBe(1)

    const page = await applicantsRoute.GET(
      req('/api/career/employer/opportunities/op1/applications?page=2&pageSize=2', undefined, 'GET'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    const pageBody = await page.json()
    expect(pageBody.total).toBe(3)
    expect(pageBody.page).toBe(2)
    expect(pageBody.pageSize).toBe(2)
    // newest first: a3, a2, a1 → page 2 holds only a1
    expect(pageBody.applications.map((a: { id: string }) => a.id)).toEqual(['a1'])
  })

  it('counts always cover every applicant regardless of the status filter', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1')
    seedApplication('a2', 'op1', 's2')
    seedApplication('a3', 'op1', 's3', { status: 'SHORTLISTED' })
    const res = await applicantsRoute.GET(
      req('/api/career/employer/opportunities/op1/applications?status=SUBMITTED', undefined, 'GET'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    const body = await res.json()
    expect(body.counts).toEqual({ SUBMITTED: 2, SHORTLISTED: 1 })
    expect(body.applications).toHaveLength(2)
  })

  it('the shared snapshot, candidate display identity and private notes reach the employer', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1', {
      snapshotJson: JSON.stringify({ headline: 'Aspiring Analyst', summary: 'Hard working', skills: ['Tally'] }),
      employerNotes: 'Strong Excel screen — second round',
      candidateVisibleStatusNote: 'We will contact you shortly.',
    })
    const res = await applicantsRoute.GET(
      req('/api/career/employer/opportunities/op1/applications', undefined, 'GET'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    const body = await res.json()
    const app = body.applications[0]
    expect(app.applicant.headline).toBe('Aspiring Analyst')
    expect(app.applicant.summary).toBe('Hard working')
    expect(app.status).toBe('SUBMITTED')
    expect(app.candidateVisibleStatusNote).toBe('We will contact you shortly.')
    expect(app.submittedAt).toBeTruthy()
    expect(app.employerNotes).toBe('Strong Excel screen — second round')
  })

  it('an invalid status filter is a 400 and another org\u2019s recruiter gets 403', async () => {
    seedOrg('emp1')
    seedOrg('emp2')
    seedOpportunity('op1', 'emp1')
    state.student = recruiter('r1', 'emp1')
    const bad = await applicantsRoute.GET(
      req('/api/career/employer/opportunities/op1/applications?status=NOPE', undefined, 'GET'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    expect(bad.status).toBe(400)
    state.student = recruiter('r2', 'emp2', 'OWNER')
    const foreign = await applicantsRoute.GET(
      req('/api/career/employer/opportunities/op1/applications', undefined, 'GET'),
      { params: Promise.resolve({ employerOpportunityId: 'op1' }) },
    )
    expect(foreign.status).toBe(403)
  })
})

// ─── Employer status PATCH with notes ─────────────────────────────────────────

describe('phase7ui: employer status PATCH notes', () => {
  beforeEach(resetState)

  it('candidateVisibleStatusNote and employerNotes are set and the write is audited', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1')
    const res = await statusRoute.PATCH(
      req('/api/career/employer/applications/a1/status', { status: 'UNDER_REVIEW', candidateVisibleStatusNote: 'Screening now', employerNotes: 'Good fit' }, 'PATCH'),
      { params: Promise.resolve({ employerApplicationId: 'a1' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.application.candidateVisibleStatusNote).toBe('Screening now')
    const row = state.applications.find(a => a.id === 'a1') as Row
    expect(row.employerNotes).toBe('Good fit')
    expect(row.candidateVisibleStatusNote).toBe('Screening now')
    const audit = state.audit.find(a => a['entityId'] === 'a1') as Row
    expect(audit['action']).toBe('APPLICATION_STATUS_CHANGED')
    expect(audit['detail']).toBe('SUBMITTED->UNDER_REVIEW;notes-updated')
  })

  it('a status-only change leaves notes untouched and carries no notes marker', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1', { employerNotes: 'Existing note', candidateVisibleStatusNote: 'Old note' })
    const res = await statusRoute.PATCH(
      req('/api/career/employer/applications/a1/status', { status: 'SHORTLISTED' }, 'PATCH'),
      { params: Promise.resolve({ employerApplicationId: 'a1' }) },
    )
    expect(res.status).toBe(200)
    const row = state.applications.find(a => a.id === 'a1') as Row
    expect(row.employerNotes).toBe('Existing note')
    expect(row.candidateVisibleStatusNote).toBe('Old note')
    const audit = state.audit.find(a => a['entityId'] === 'a1') as Row
    expect(audit['detail']).toBe('SUBMITTED->SHORTLISTED')
  })

  it('overlong notes are rejected (candidate note > 600, employer notes > 2000)', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1')
    const longCandidateNote = await statusRoute.PATCH(
      req('/api/career/employer/applications/a1/status', { status: 'UNDER_REVIEW', candidateVisibleStatusNote: 'x'.repeat(601) }, 'PATCH'),
      { params: Promise.resolve({ employerApplicationId: 'a1' }) },
    )
    expect(longCandidateNote.status).toBe(400)
    const longEmployerNote = await statusRoute.PATCH(
      req('/api/career/employer/applications/a1/status', { status: 'UNDER_REVIEW', employerNotes: 'x'.repeat(2001) }, 'PATCH'),
      { params: Promise.resolve({ employerApplicationId: 'a1' }) },
    )
    expect(longEmployerNote.status).toBe(400)
    expect(state.audit.find(a => a['entityId'] === 'a1')).toBeUndefined()
  })

  it('terminal decisions stay frozen (SELECTED cannot move again)', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 's1', { status: 'SELECTED' })
    const res = await statusRoute.PATCH(
      req('/api/career/employer/applications/a1/status', { status: 'SHORTLISTED', employerNotes: 'try again' }, 'PATCH'),
      { params: Promise.resolve({ employerApplicationId: 'a1' }) },
    )
    expect(res.status).toBe(409)
    expect((state.applications.find(a => a.id === 'a1') as Row).status).toBe('SELECTED')
    expect(state.audit).toHaveLength(0)
  })
})

// ─── Candidate discovery ──────────────────────────────────────────────────────

describe('phase7ui: candidate discovery roleType + location', () => {
  beforeEach(resetState)

  function seedProfile(id: string, studentId: string, overrides: Row = {}) {
    state.profiles.push({
      id,
      studentId,
      visibility: 'DISCOVERABLE',
      headline: `Headline ${id}`,
      summary: null,
      preferredRoleTypes: null,
      preferredSkills: null,
      preferredLocations: null,
      workModes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    })
  }

  it('roleType is matched against the real preferredRoleTypes column', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedProfile('p1', 's1', { preferredRoleTypes: JSON.stringify(['DATA_ANALYST', 'REPORTER']) })
    seedProfile('p2', 's2', { preferredRoleTypes: JSON.stringify(['DESIGNER']) })
    for (const s of ['s1', 's2']) state.eligibility.push({ id: `e-${s}`, studentId: s, status: 'APPROVED' })
    const res = await candidatesRoute.GET(req('/api/career/employer/candidates?organizationId=emp1&roleType=data_analyst', undefined, 'GET'))
    const body = await res.json()
    expect(body.candidates.map((c: { headline: string }) => c.headline)).toEqual(['Headline p1'])
    expect(body.total).toBe(1)
  })

  it('location is matched against the real preferredLocations column', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedProfile('p1', 's1', { preferredLocations: JSON.stringify(['Mumbai']) })
    seedProfile('p2', 's2', { preferredLocations: JSON.stringify(['Bengaluru']) })
    for (const s of ['s1', 's2']) state.eligibility.push({ id: `e-${s}`, studentId: s, status: 'APPROVED' })
    const res = await candidatesRoute.GET(req('/api/career/employer/candidates?organizationId=emp1&location=mumbai', undefined, 'GET'))
    const body = await res.json()
    expect(body.candidates.map((c: { headline: string }) => c.headline)).toEqual(['Headline p1'])
    expect(body.total).toBe(1)
  })

  it('non-DISCOVERABLE or non-APPROVED profiles never surface; total tracks the visible set', async () => {
    state.student = recruiter('r1', 'emp1')
    seedOrg('emp1')
    seedProfile('p1', 's1')
    seedProfile('p2', 's2', { visibility: 'PRIVATE' })
    seedProfile('p3', 's3')
    state.eligibility.push(
      { id: 'e-s1', studentId: 's1', status: 'APPROVED' },
      { id: 'e-s2', studentId: 's2', status: 'APPROVED' },
      { id: 'e-s3', studentId: 's3', status: 'PENDING_REVIEW' },
    )
    const res = await candidatesRoute.GET(req('/api/career/employer/candidates?organizationId=emp1', undefined, 'GET'))
    const body = await res.json()
    expect(body.candidates.map((c: { headline: string }) => c.headline)).toEqual(['Headline p1'])
    expect(body.total).toBe(1)
  })
})

// ─── My applications ──────────────────────────────────────────────────────────

describe('phase7ui: my applications status filter', () => {
  beforeEach(resetState)

  it('an optional status filter narrows the owner\u2019s applications; invalid values are 400', async () => {
    state.student = { id: 'student-1', email: 's@bean.test', role: 'STUDENT' }
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 'student-1', { employerNotes: 'Private employer note' })
    seedApplication('a2', 'op1', 'student-1', { status: 'SHORTLISTED' })
    seedApplication('aOther', 'op1', 'other-student', { status: 'SHORTLISTED' })

    const all = await myAppsRoute.GET(req('/api/career/my-applications', undefined, 'GET'))
    expect((await all.json()).applications).toHaveLength(2)

    const shortlisted = await myAppsRoute.GET(req('/api/career/my-applications?status=SHORTLISTED', undefined, 'GET'))
    const body = await shortlisted.json()
    expect(body.applications.map((a: { id: string }) => a.id)).toEqual(['a2'])

    const bad = await myAppsRoute.GET(req('/api/career/my-applications?status=HIRE_ME', undefined, 'GET'))
    expect(bad.status).toBe(400)
  })

  it('employerNotes never appear in the owner-facing DTO', async () => {
    state.student = { id: 'student-1', email: 's@bean.test', role: 'STUDENT' }
    seedOrg('emp1')
    seedOpportunity('op1', 'emp1')
    seedApplication('a1', 'op1', 'student-1', { employerNotes: 'Secret recruiter scribbles' })
    const res = await myAppsRoute.GET(req('/api/career/my-applications', undefined, 'GET'))
    const raw = JSON.stringify(await res.json())
    expect(raw.includes('Secret recruiter scribbles')).toBe(false)
    expect(raw.includes('employerNotes')).toBe(false)
  })
})

// ─── Credentials ──────────────────────────────────────────────────────────────

describe('phase7ui: credentials issuerName', () => {
  beforeEach(resetState)

  it('each credential exposes issuerName (displayName, else the official org name)', async () => {
    state.student = { id: 'student-1', email: 's@bean.test', role: 'STUDENT' }
    seedOrg('org1', { name: 'Bean Institute', displayName: null })
    seedOrg('org2', { name: 'Bean Institute of Tech', displayName: 'BeanTech' })
    state.credentials.push(
      {
        id: 'cred1', studentId: 'student-1', issuerOrganizationId: 'org1', credentialName: 'Excel Level 1',
        credentialDescription: null, issuedDate: new Date(), expiryDate: null, credentialReference: null,
        status: 'ISSUED', portfolioShared: false,
      },
      {
        id: 'cred2', studentId: 'student-1', issuerOrganizationId: 'org2', credentialName: 'Data Camp',
        credentialDescription: null, issuedDate: new Date(), expiryDate: null, credentialReference: null,
        status: 'ISSUED', portfolioShared: false,
      },
    )
    const res = await credentialsRoute.GET()
    const body = await res.json()
    const byId = new Map(body.credentials.map((c: { id: string; issuerName: string }) => [c.id, c]))
    expect(byId.get('cred1').issuerName).toBe('Bean Institute')
    expect(byId.get('cred2').issuerName).toBe('BeanTech')
    expect(byId.get('cred1').issuer.name).toBe('Bean Institute')
  })
})
