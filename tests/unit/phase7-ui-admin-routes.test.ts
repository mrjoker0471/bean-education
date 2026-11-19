// ─── Phase 7: Admin career routes — mounting, guards & decisions ──────────────
// Coverage (spec §28 — Admin / Career trust & moderation):
//   • The three admin career LIST endpoints are mounted at their flat paths
//     (/api/admin/career/opportunities, /reports, /eligibility) and accept the
//     documented status filters; the dynamic subpath decision routes no longer
//     export a GET (the old "deep GET returns the whole list" bug stays dead).
//   • requireAdmin is server-enforced on every list endpoint: 401 without a
//     session, 403 for non-admins.
//   • List DTO shapes are stable: opportunities mapped through the public DTO,
//     reports returned as raw rows, eligibility reviews mapped (ISO dates).
//   • Moderation: RESUME is a legal PAUSED → PUBLISHED transition with no
//     reason required; unsupported transitions (e.g. resuming a closed or
//     rejecting a published listing) 409.
//   • Reports: RESOLVED/DISMISSED are terminal — any later action (even
//     PAUSE_OPPORTUNITY) is frozen with 409; PAUSE_OPPORTUNITY on a live
//     listing pauses it and reports opportunityPaused.
//   • Eligibility: already-reviewed rows are frozen (409); denials need a
//     10+ character reason.

import { describe, it, expect, mock, beforeEach } from 'bun:test'
import type { NextRequest } from 'next/server'

const career = await import('@/lib/career')

const state = {
  session: null as Record<string, unknown> | null,
  opportunities: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  eligibility: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
}

function resetState() {
  state.session = null
  state.opportunities = []
  state.reports = []
  state.eligibility = []
  state.audit = []

  const org = { id: 'emp1', name: 'Hiring Co', displayName: 'Hiring Co', slug: 'hiring-co', orgType: 'EMPLOYER', verificationStatus: 'APPROVED', isActive: true, logoText: 'HC' }
  state.opportunities.push(
    { id: 'op-pending', employerOrganizationId: 'emp1', title: 'Pending Role', description: 'A real description.', status: 'PENDING_REVIEW', opportunityType: 'JOB', requiredSkills: '[]', preferredSkills: '[]', organization: org, publishedAt: null },
    { id: 'op-published', employerOrganizationId: 'emp1', title: 'Live Role', description: 'A real description.', status: 'PUBLISHED', opportunityType: 'JOB', requiredSkills: '[]', preferredSkills: '[]', organization: org, publishedAt: new Date() },
    { id: 'op-paused', employerOrganizationId: 'emp1', title: 'Paused Role', description: 'A real description.', status: 'PAUSED', opportunityType: 'JOB', requiredSkills: '[]', preferredSkills: '[]', organization: org, publishedAt: new Date() },
    { id: 'op-closed', employerOrganizationId: 'emp1', title: 'Closed Role', description: 'A real description.', status: 'CLOSED', opportunityType: 'JOB', requiredSkills: '[]', preferredSkills: '[]', organization: org, publishedAt: new Date() },
  )
  state.reports.push(
    { id: 'rep-open', reporterId: 'student-9', targetType: 'OPPORTUNITY', targetId: 'op-published', category: 'FRAUDULENT_LISTING', subject: 'Fake job ads', description: 'Asks for money upfront.', status: 'OPEN', assignedAdminId: null, resolutionNote: null, resolvedAt: null, createdAt: new Date() },
    { id: 'rep-resolved', reporterId: 'student-8', targetType: 'ORGANIZATION', targetId: 'emp1', category: 'ORGANIZATION_CONDUCT', subject: 'Rude replies', description: 'Ghosted every applicant.', status: 'RESOLVED', assignedAdminId: 'admin-1', resolutionNote: 'Warned the organization.', resolvedAt: new Date(), createdAt: new Date() },
  )
  state.eligibility.push(
    { id: 'elig-pending', studentId: 'student-1', status: 'PENDING_REVIEW', requestedAt: new Date(), reviewedByAdminId: null, reviewedAt: null, decisionReason: null, student: { displayName: 'Ada Student' } },
    { id: 'elig-approved', studentId: 'student-2', status: 'APPROVED', requestedAt: new Date(), reviewedByAdminId: 'admin-1', reviewedAt: new Date(), decisionReason: 'Adult learner confirmed.', student: { displayName: 'Alan Adult' } },
    { id: 'elig-denied', studentId: 'student-3', status: 'DENIED', requestedAt: new Date(), reviewedByAdminId: 'admin-1', reviewedAt: new Date(), decisionReason: 'Under 18 per record.', student: { displayName: 'Kate Minor' } },
  )
}

const fakeDb = {
  careerOpportunity: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.opportunities.filter(o => (!where['status'] || o.status === where['status'])),
    count: async ({ where }: { where: Record<string, unknown> }) =>
      state.opportunities.filter(o => (!where['status'] || o.status === where['status'])).length,
    findUnique: async ({ where }: { where: { id: string } }) => state.opportunities.find(o => o.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const o = state.opportunities.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(o, data)
      return o
    },
  },
  careerSafetyReport: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.reports.filter(r => (!where['status'] || r.status === where['status'])),
    findUnique: async ({ where }: { where: { id: string } }) => state.reports.find(r => r.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = state.reports.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(r, data)
      return r
    },
  },
  careerEligibilityReview: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      state.eligibility.filter(e => (!where['status'] || e.status === where['status'])),
    findUnique: async ({ where }: { where: { id: string } }) => state.eligibility.find(e => e.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const e = state.eligibility.find(x => x.id === where.id) as Record<string, unknown>
      Object.assign(e, data)
      return e
    },
  },
  careerAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => { state.audit.push(data); return { id: 'audit-1', ...data } },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/auth', () => ({
  requireStudent: async () => state.session,
  sameOrigin: () => true,
  getSessionStudent: async () => state.session,
}))

const opportunitiesRoute = await import('@/app/api/admin/career/opportunities/route')
const moderationRoute = await import('@/app/api/admin/career/opportunities/[opportunityId]/moderation/route')
const reportsRoute = await import('@/app/api/admin/career/reports/route')
const reportActionRoute = await import('@/app/api/admin/career/reports/[reportId]/action/route')
const eligibilityRoute = await import('@/app/api/admin/career/eligibility/route')
const eligibilityDecisionRoute = await import('@/app/api/admin/career/eligibility/[reviewId]/decision/route')

function get(path: string): NextRequest {
  return new Request(`http://localhost${path}`, { method: 'GET' }) as unknown as NextRequest
}

function post(path: string, body: unknown): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const adminSession = { id: 'admin-1', email: 'admin@bean.test', role: 'ADMIN' }

// ─── Mounting & guards ───────────────────────────────────────────────────────

describe('admin career list endpoints are mounted at the flat path', () => {
  beforeEach(resetState)

  it('the three dynamic decision routes no longer export GET (deep-list bug stays dead)', () => {
    expect((moderationRoute as unknown as Record<string, unknown>).GET).toBeUndefined()
    expect((reportActionRoute as unknown as Record<string, unknown>).GET).toBeUndefined()
    expect((eligibilityDecisionRoute as unknown as Record<string, unknown>).GET).toBeUndefined()
    expect(typeof opportunitiesRoute.GET).toBe('function')
    expect(typeof reportsRoute.GET).toBe('function')
    expect(typeof eligibilityRoute.GET).toBe('function')
  })

  it('guests are rejected with 401 on every list endpoint', async () => {
    state.session = null
    expect((await opportunitiesRoute.GET(get('/api/admin/career/opportunities'))).status).toBe(401)
    expect((await reportsRoute.GET(get('/api/admin/career/reports'))).status).toBe(401)
    expect((await eligibilityRoute.GET(get('/api/admin/career/eligibility'))).status).toBe(401)
  })

  it('non-admins are rejected with 403 on every list endpoint', async () => {
    state.session = { id: 'student-1', email: 's@bean.test', role: 'STUDENT' }
    expect((await opportunitiesRoute.GET(get('/api/admin/career/opportunities'))).status).toBe(403)
    expect((await reportsRoute.GET(get('/api/admin/career/reports'))).status).toBe(403)
    expect((await eligibilityRoute.GET(get('/api/admin/career/eligibility'))).status).toBe(403)
  })
})

describe('GET /api/admin/career/opportunities', () => {
  beforeEach(resetState)

  it('returns the mapped public DTO shape { opportunities, total } for admins', async () => {
    state.session = adminSession
    const res = await opportunitiesRoute.GET(get('/api/admin/career/opportunities?status=ALL'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(4)
    expect(body.opportunities.length).toBe(4)
    for (const o of body.opportunities as Record<string, unknown>[]) {
      expect(typeof o['id']).toBe('string')
      expect(typeof o['title']).toBe('string')
      expect(typeof o['status']).toBe('string')
      expect((o['organization'] as Record<string, unknown>)['verificationStatus']).toBe('APPROVED')
    }
  })

  it('accepts the status filter (and defaults to PENDING_REVIEW)', async () => {
    state.session = adminSession
    const published = await (await opportunitiesRoute.GET(get('/api/admin/career/opportunities?status=PUBLISHED'))).json()
    expect(published.total).toBe(1)
    expect(published.opportunities[0].id).toBe('op-published')
    const paused = await (await opportunitiesRoute.GET(get('/api/admin/career/opportunities?status=PAUSED'))).json()
    expect(paused.total).toBe(1)
    expect(paused.opportunities[0].id).toBe('op-paused')
    const defaults = await (await opportunitiesRoute.GET(get('/api/admin/career/opportunities'))).json()
    expect(defaults.total).toBe(1)
    expect(defaults.opportunities[0].id).toBe('op-pending')
  })
})

describe('GET /api/admin/career/reports', () => {
  beforeEach(resetState)

  it('returns { reports, total } with the raw report rows (reporter/target/category preserved)', async () => {
    state.session = adminSession
    const res = await reportsRoute.GET(get('/api/admin/career/reports?status=ALL'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    expect(body.reports.length).toBe(2)
    const first = body.reports[0] as Record<string, unknown>
    expect(typeof first['reporterId']).toBe('string')
    expect(['OPPORTUNITY', 'ORGANIZATION']).toContain(first['targetType'])
    expect(typeof first['category']).toBe('string')
    expect(typeof first['subject']).toBe('string')
    expect(typeof first['description']).toBe('string')
  })

  it('defaults to OPEN and honors other status filters', async () => {
    state.session = adminSession
    const open = await (await reportsRoute.GET(get('/api/admin/career/reports'))).json()
    expect(open.total).toBe(1)
    expect(open.reports[0].id).toBe('rep-open')
    const resolved = await (await reportsRoute.GET(get('/api/admin/career/reports?status=RESOLVED'))).json()
    expect(resolved.total).toBe(1)
    expect(resolved.reports[0].id).toBe('rep-resolved')
  })
})

describe('GET /api/admin/career/eligibility', () => {
  beforeEach(resetState)

  it('returns { reviews } mapped with student displayName and ISO dates (never raw rows)', async () => {
    state.session = adminSession
    const res = await eligibilityRoute.GET(get('/api/admin/career/eligibility?status=ALL'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviews.length).toBe(3)
    const pending = (body.reviews as Record<string, unknown>[]).find(r => r['id'] === 'elig-pending') as Record<string, unknown>
    expect((pending['student'] as Record<string, unknown>)['displayName']).toBe('Ada Student')
    expect(pending['status']).toBe('PENDING_REVIEW')
    expect(pending['requestedAt']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(pending['reviewedAt']).toBeNull()
    expect(pending['decisionReason']).toBeNull()
    // The raw studentId never leaks through the mapped DTO.
    expect(pending['studentId']).toBeUndefined()
    expect(pending['reviewedByAdminId']).toBeUndefined()
  })
})

// ─── Moderation decisions ────────────────────────────────────────────────────

describe('POST /api/admin/career/opportunities/[opportunityId]/moderation', () => {
  beforeEach(resetState)

  it('RESUME legally republishes a PAUSED listing without a reason (PAUSED → PUBLISHED)', async () => {
    state.session = adminSession
    const res = await moderationRoute.POST(
      post('/api/admin/career/opportunities/op-paused/moderation', { action: 'RESUME' }),
      { params: Promise.resolve({ opportunityId: 'op-paused' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.opportunity.status).toBe('PUBLISHED')
    expect(state.audit.some(a => a['action'] === 'OPPORTUNITY_RESUME')).toBe(true)
  })

  it('RESUME on a CLOSED listing is an illegal transition (409)', async () => {
    state.session = adminSession
    const res = await moderationRoute.POST(
      post('/api/admin/career/opportunities/op-closed/moderation', { action: 'RESUME' }),
      { params: Promise.resolve({ opportunityId: 'op-closed' }) },
    )
    expect(res.status).toBe(409)
  })

  it('REJECT on a PUBLISHED listing is an illegal transition (409) — only pending listings can be rejected', async () => {
    state.session = adminSession
    const res = await moderationRoute.POST(
      post('/api/admin/career/opportunities/op-published/moderation', { action: 'REJECT', reason: 'Misleading pay claims' }),
      { params: Promise.resolve({ opportunityId: 'op-published' }) },
    )
    expect(res.status).toBe(409)
    expect((state.opportunities.find(o => o.id === 'op-published') as Record<string, unknown>).status).toBe('PUBLISHED')
  })

  it('REJECT without a 10+ character reason is refused (400)', async () => {
    state.session = adminSession
    const res = await moderationRoute.POST(
      post('/api/admin/career/opportunities/op-pending/moderation', { action: 'REJECT', reason: 'short' }),
      { params: Promise.resolve({ opportunityId: 'op-pending' }) },
    )
    expect(res.status).toBe(400)
  })
})

// ─── Safety report decisions ─────────────────────────────────────────────────

describe('POST /api/admin/career/reports/[reportId]/action', () => {
  beforeEach(resetState)

  it('PAUSE_OPPORTUNITY with a reason pauses the live targeted listing and reports opportunityPaused', async () => {
    state.session = adminSession
    const res = await reportActionRoute.POST(
      post('/api/admin/career/reports/rep-open/action', { action: 'PAUSE_OPPORTUNITY', note: 'Suspected fraudulent listing' }),
      { params: Promise.resolve({ reportId: 'rep-open' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.opportunityPaused).toBe(true)
    expect(body.report.status).toBe('OPEN') // pausing a listing never closes the report
    expect((state.opportunities.find(o => o.id === 'op-published') as Record<string, unknown>).status).toBe('PAUSED')
    expect(state.audit.some(a => a['action'] === 'REPORT_PAUSE_OPPORTUNITY')).toBe(true)
  })

  it('a terminal (RESOLVED) report is frozen: any later action — even PAUSE_OPPORTUNITY — gets 409', async () => {
    state.session = adminSession
    const ack = await reportActionRoute.POST(
      post('/api/admin/career/reports/rep-resolved/action', { action: 'ACKNOWLEDGE' }),
      { params: Promise.resolve({ reportId: 'rep-resolved' }) },
    )
    expect(ack.status).toBe(409)
    const pause = await reportActionRoute.POST(
      post('/api/admin/career/reports/rep-resolved/action', { action: 'PAUSE_OPPORTUNITY', note: 'Trying to pause anyway' }),
      { params: Promise.resolve({ reportId: 'rep-resolved' }) },
    )
    expect(pause.status).toBe(409)
    // Nothing changed: the report stays RESOLVED, the org was never touched.
    expect((state.reports.find(r => r.id === 'rep-resolved') as Record<string, unknown>).status).toBe('RESOLVED')
    expect(state.audit.filter(a => a['entityType'] === 'SAFETY_REPORT' && a['entityId'] === 'rep-resolved').length).toBe(0)
  })

  it('RESOLVE and DISMISS require a 10+ character note (400 otherwise)', async () => {
    state.session = adminSession
    const res = await reportActionRoute.POST(
      post('/api/admin/career/reports/rep-open/action', { action: 'RESOLVE', note: 'short' }),
      { params: Promise.resolve({ reportId: 'rep-open' }) },
    )
    expect(res.status).toBe(400)
    const ok = await reportActionRoute.POST(
      post('/api/admin/career/reports/rep-open/action', { action: 'RESOLVE', note: 'Confirmed the listing is legitimate' }),
      { params: Promise.resolve({ reportId: 'rep-open' }) },
    )
    expect(ok.status).toBe(200)
    expect((state.reports.find(r => r.id === 'rep-open') as Record<string, unknown>).status).toBe('RESOLVED')
  })

  it('career status constants back the transition rules', () => {
    expect(career.SAFETY_REPORT_STATUS.RESOLVED).toBe('RESOLVED')
    expect(career.SAFETY_REPORT_STATUS.DISMISSED).toBe('DISMISSED')
    expect(career.OPPORTUNITY_STATUS.PUBLISHED).toBe('PUBLISHED')
    expect(career.OPPORTUNITY_STATUS.PAUSED).toBe('PAUSED')
    expect(career.ELIGIBILITY_STATUS.APPROVED).toBe('APPROVED')
    expect(career.ELIGIBILITY_STATUS.DENIED).toBe('DENIED')
  })
})

// ─── Eligibility decisions ───────────────────────────────────────────────────

describe('POST /api/admin/career/eligibility/[reviewId]/decision', () => {
  beforeEach(resetState)

  it('an already-reviewed row is frozen: APPROVE/DENY on APPROVED or DENIED reviews get 409', async () => {
    state.session = adminSession
    const onApproved = await eligibilityDecisionRoute.POST(
      post('/api/admin/career/eligibility/elig-approved/decision', { decision: 'APPROVE' }),
      { params: Promise.resolve({ reviewId: 'elig-approved' }) },
    )
    expect(onApproved.status).toBe(409)
    const onDenied = await eligibilityDecisionRoute.POST(
      post('/api/admin/career/eligibility/elig-denied/decision', { decision: 'DENY', reason: 'Second denial attempt here' }),
      { params: Promise.resolve({ reviewId: 'elig-denied' }) },
    )
    expect(onDenied.status).toBe(409)
    expect(state.audit.filter(a => a['entityType'] === 'ELIGIBILITY').length).toBe(0)
  })

  it('DENY on a pending review requires a 10+ character reason and records the decision', async () => {
    state.session = adminSession
    const short = await eligibilityDecisionRoute.POST(
      post('/api/admin/career/eligibility/elig-pending/decision', { decision: 'DENY', reason: 'short' }),
      { params: Promise.resolve({ reviewId: 'elig-pending' }) },
    )
    expect(short.status).toBe(400)
    const ok = await eligibilityDecisionRoute.POST(
      post('/api/admin/career/eligibility/elig-pending/decision', { decision: 'DENY', reason: 'Adult status not documented' }),
      { params: Promise.resolve({ reviewId: 'elig-pending' }) },
    )
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.eligibility.status).toBe('DENIED')
    const row = state.eligibility.find(e => e.id === 'elig-pending') as Record<string, unknown>
    expect(row.status).toBe('DENIED')
    expect(row.decisionReason).toBe('Adult status not documented')
    expect(state.audit.some(a => a['action'] === 'ELIGIBILITY_DENIED')).toBe(true)
  })
})
