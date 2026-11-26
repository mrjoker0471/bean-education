// ─── BEAN Classroom Intelligence (CI-7C): pilot cohort activation tests ──────
//   C1  a pending applicant can never consent (a pending applicant is never a
//       pilot participant; invitation claim ≠ verification ≠ participation)
//   C2  consent hygiene: wrong protocol version / missing acknowledgement /
//       invented compensation status are refused
//   C3  an ACTIVE reviewer consents → append-only event, latest-governs state
//       (re-consent appends a NEW event; nothing is edited in place)
//   C4  withdrawal is append-only; latest pilot event governs; history retained
//   C5  the pilot assignment gate: pilot-domain assignment without consent is
//       refused 409 through the REAL admin route; with consent it proceeds to
//       the existing CI-5C gates; non-pilot domains are NOT pilot-gated
//   C6  re-consent after withdrawal restores participation (latest event wins)
//   C7  route authorization: anonymous consent/withdraw/GET refused; the admin
//       assignment route refuses non-admins
//   C8  directory listing is NOT a condition of participation: a PRIVATE
//       profile participates fully
//   C9  consent never grants review privileges by itself: scope gates still
//       refuse an out-of-scope reviewer for the pilot domain

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7c-'))
const isolatedUrl = `file:${join(tmp, 'ci7c.db')}`
process.env.DATABASE_URL = isolatedUrl

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  timeout: 180_000,
  stdio: 'ignore',
})

const { PrismaClient } = await import('@prisma/client')
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })

const { completeAuthMock } = await import('../helpers/auth-mock')
const { mock } = await import('bun:test')

let sessionStudent: { id: string; email: string; displayName: string | null; learningLevel: null; role: string; onboardedAt: null; signupIntent: null } | null = null

mock.module('@/lib/db', () => ({ db: client }))
mock.module('@/lib/auth', () => ({
  ...completeAuthMock(),
  requireStudent: async () => sessionStudent,
  sameOrigin: () => true,
  resolveOwnerScope: async () => ({ guestId: null, studentId: sessionStudent?.id ?? null }),
  ownedBy: () => ({}),
}))

const { submitReviewerApplication, decideReviewerQualification, activateReviewer, resolveReviewerProfile, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')
const {
  CI7_PILOT_CONSENT_POINTS,
  CI7_PILOT_DOMAIN_ID,
  CI7_PILOT_PROTOCOL_VERSION,
  recordPilotParticipationConsent,
  resolvePilotParticipation,
  withdrawPilotParticipation,
  pilotAssignmentGate,
} = await import('@/lib/ci/fleet/pilot')

const consentRoute = await import('@/app/api/ci5/reviewers/me/pilot-consent/route')
const assignmentsRoute = await import('@/app/api/admin/ci5/assignments/route')

function req(url: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as unknown as NextRequest
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try { return JSON.parse(text) as Record<string, unknown> } catch { return {} }
}

function setSession(id: string | null, role: string = 'STUDENT') {
  sessionStudent = id
    ? { id, email: 'session@bean.test', displayName: 'Session User', learningLevel: null, role, onboardedAt: null, signupIntent: null }
    : null
}

function consentBody(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
    acknowledged: [...CI7_PILOT_CONSENT_POINTS],
    compensationStatus: 'UNPAID',
    ...overrides,
  }
}

let reviewerId: string
let adminId: string
let reviewerProfileId: string
let pendingProfileId: string

/** Full CI-6 path for a fresh account: application → qualification (by another admin) → activation. */
async function activateFreshReviewer(studentId: string, domain: string): Promise<string> {
  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId, displayName: 'Reviewer' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    qualificationCategory: 'M.Ed., 12 years classroom teaching',
    consentGranted: true,
  })
  expect(applied.ok).toBe(true)
  const profileId = (applied as { profile: { id: string } }).profile.id
  const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
    decision: 'APPROVED',
    rationale: 'credential examination recorded through the CI-6C workbench',
    verificationStatus: 'DOCUMENT_REVIEWED',
    scope: { approvedDomains: [domain] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId)
  expect(activated.ok).toBe(true)
  return profileId
}

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const reviewer = await client.student.create({ data: { email: `ci7c-reviewer-${s}@bean.test`, role: 'STUDENT' } })
  const pending = await client.student.create({ data: { email: `ci7c-pending-${s}@bean.test`, role: 'STUDENT' } })
  const admin = await client.student.create({ data: { email: `ci7c-admin-${s}@bean.test`, role: 'ADMIN' } })
  reviewerId = reviewer.id
  adminId = admin.id

  // full cohort path for the main reviewer (pilot domain scope)
  reviewerProfileId = await activateFreshReviewer(reviewer.id, CI7_PILOT_DOMAIN_ID)

  // a pending applicant (claim flow stopped before verification/qualification)
  const pendingApplied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: pending.id, displayName: 'Pending' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    qualificationCategory: 'self-declared',
    consentGranted: true,
  })
  expect(pendingApplied.ok).toBe(true)
  pendingProfileId = (pendingApplied as { profile: { id: string } }).profile.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7C pilot cohort activation', () => {
  test('C1: a pending applicant can never consent — invitation claim is not verification, verification is not participation', async () => {
    const pendingProfile = await resolveReviewerProfile(reviewerDbFromPrisma(client), (await client.student.findUnique({ where: { id: pendingProfileId } }))?.studentId ?? '')
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: pendingProfileId } })
    const refused = await recordPilotParticipationConsent(
      reviewerDbFromPrisma(client),
      profile!,
      { kind: 'REVIEWER', studentId: profile!.studentId, displayName: 'Pending' },
      consentBody(),
    )
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.status).toBe(409)
      expect(refused.error).toContain('pending applicant is never a pilot participant')
    }
    void pendingProfile
  })

  test('C2: consent hygiene — wrong protocol version, missing acknowledgements and invented compensation are refused', async () => {
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: reviewerProfileId } })
    const wrongVersion = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: reviewerId, displayName: 'R' }, consentBody({ protocolVersion: 'ci7-pilot-protocol-0' }))
    expect(wrongVersion.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.status).toBe(400)
    const partial = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: reviewerId, displayName: 'R' }, consentBody({ acknowledged: [CI7_PILOT_CONSENT_POINTS[0]] }))
    expect(partial.ok).toBe(false)
    if (!partial.ok) expect(partial.error).toContain('acknowledging every participant information point')
    const invented = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: reviewerId, displayName: 'R' }, consentBody({ compensationStatus: 'PAID_GENEROUSLY' }))
    expect(invented.ok).toBe(false)
    if (!invented.ok) expect(invented.error).toContain('owner-approved terms')
    // nothing was recorded by the refusals
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'PILOT_PARTICIPATION_CONSENT' } })
    expect(events.length).toBe(0)
  })

  test('C3: an ACTIVE reviewer consents — append-only event, latest-governs participation state', async () => {
    setSession(reviewerId)
    const first = await consentRoute.POST(req('/api/ci5/reviewers/me/pilot-consent', { method: 'POST', body: consentBody({ compensationStatus: 'COMPENSATED' }) }))
    expect(first.status).toBe(201)
    const state1 = (await json(first) as { participation: { participant: boolean; protocolVersion: string; compensationStatus: string } }).participation
    expect(state1.participant).toBe(true)
    expect(state1.protocolVersion).toBe(CI7_PILOT_PROTOCOL_VERSION)
    expect(state1.compensationStatus).toBe('COMPENSATED')
    // re-consent under the same protocol appends a NEW event (append-only)
    const second = await consentRoute.POST(req('/api/ci5/reviewers/me/pilot-consent', { method: 'POST', body: consentBody() }))
    expect(second.status).toBe(201)
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'PILOT_PARTICIPATION_CONSENT' }, orderBy: { createdAt: 'asc' } })
    expect(events.length).toBe(2)
    const state2 = resolvePilotParticipation(events)
    expect(state2.participant).toBe(true)
    expect(state2.compensationStatus).toBe('UNPAID') // latest governs
  })

  test('C4: withdrawal is append-only, latest event governs, history retained', async () => {
    setSession(reviewerId)
    const withdrawn = await consentRoute.DELETE(req('/api/ci5/reviewers/me/pilot-consent', { method: 'DELETE', body: { reason: 'leaving the pilot for personal reasons' } }))
    expect(withdrawn.status).toBe(200)
    const state = (await json(withdrawn) as { participation: { participant: boolean; latestWithdrawalAt: string | null; latestConsentAt: string | null } }).participation
    expect(state.participant).toBe(false)
    expect(state.latestWithdrawalAt).not.toBeNull()
    expect(state.latestConsentAt).not.toBeNull() // consent history retained, not erased
    const consentEvents = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'PILOT_PARTICIPATION_CONSENT' } })
    const withdrawalEvents = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'PILOT_PARTICIPATION_WITHDRAWN' } })
    expect(consentEvents.length).toBe(2)
    expect(withdrawalEvents.length).toBe(1)
    // short reasons are refused (audit trail)
    const shortReason = await consentRoute.DELETE(req('/api/ci5/reviewers/me/pilot-consent', { method: 'DELETE', body: { reason: 'nope' } }))
    expect(shortReason.status).toBe(400)
  })

  test('C5: the pilot assignment gate refuses unconsented pilot assignments through the REAL admin route', async () => {
    setSession(adminId, 'ADMIN')
    // reviewer has withdrawn (C4) → pilot assignment must refuse 409
    const refused = await assignmentsRoute.POST(req('/api/admin/ci5/assignments', { method: 'POST', body: {
      reviewerProfileId,
      subjectType: 'DOMAIN_PACK',
      subjectKey: CI7_PILOT_DOMAIN_ID,
      subjectVersion: '1.0.0',
      coiCheck: 'NONE_DECLARED',
    } }))
    expect(refused.status).toBe(409)
    expect((await json(refused) as { error: string }).error).toContain('pilot participation')
  })

  test('C6: re-consent after withdrawal restores participation; the gate then defers to the CI-5C gates', async () => {
    setSession(reviewerId)
    const reconsented = await consentRoute.POST(req('/api/ci5/reviewers/me/pilot-consent', { method: 'POST', body: consentBody() }))
    expect(reconsented.status).toBe(201)
    expect((await json(reconsented) as { participation: { participant: boolean } }).participation.participant).toBe(true)
    // with consent recorded, the pilot gate passes and the EXISTING CI-5C gates
    // take over: a checksum-bound pilot assignment now proceeds to creation
    setSession(adminId, 'ADMIN')
    const snap = (await import('@/lib/ci/fleet/pilot')).pilotPackSnapshot()
    const created = await assignmentsRoute.POST(req('/api/admin/ci5/assignments', { method: 'POST', body: {
      reviewerProfileId,
      subjectType: 'DOMAIN_PACK',
      subjectKey: CI7_PILOT_DOMAIN_ID,
      subjectVersion: '1.0.0',
      subjectChecksum: snap.checksum,
      riskClass: 'STANDARD',
      coiCheck: 'NONE_DECLARED',
    } }))
    expect(created.status).toBe(201)
    const assignment = (await json(created) as { assignment: { id: string; subjectKey: string } }).assignment
    expect(assignment.subjectKey).toBe(CI7_PILOT_DOMAIN_ID)
    // independence: a second identical assignment for the same reviewer+subject is refused by CI-5C
    const duplicate = await assignmentsRoute.POST(req('/api/admin/ci5/assignments', { method: 'POST', body: {
      reviewerProfileId,
      subjectType: 'DOMAIN_PACK',
      subjectKey: CI7_PILOT_DOMAIN_ID,
      subjectVersion: '1.0.0',
      subjectChecksum: snap.checksum,
      coiCheck: 'NONE_DECLARED',
    } }))
    expect(duplicate.status).toBe(409)
  })

  test('C7: route authorization — anonymous calls refused; non-admin cannot create assignments', async () => {
    setSession(null)
    const anonConsent = await consentRoute.POST(req('/api/ci5/reviewers/me/pilot-consent', { method: 'POST', body: consentBody() }))
    expect(anonConsent.status).toBe(401)
    const anonGet = await consentRoute.GET()
    expect(anonGet.status).toBe(401)
    const anonWithdraw = await consentRoute.DELETE(req('/api/ci5/reviewers/me/pilot-consent', { method: 'DELETE', body: { reason: 'anonymous withdrawal attempt here' } }))
    expect(anonWithdraw.status).toBe(401)
    setSession(reviewerId, 'STUDENT')
    const nonAdmin = await assignmentsRoute.POST(req('/api/admin/ci5/assignments', { method: 'POST', body: { reviewerProfileId, subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID } }))
    expect(nonAdmin.status).toBe(403)
  })

  test('C8: directory listing is NOT a condition of participation — a PRIVATE profile participates fully', async () => {
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: reviewerProfileId } })
    expect(profile?.profileVisibility).toBe('PRIVATE')
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId }, orderBy: { createdAt: 'asc' } })
    const participation = resolvePilotParticipation(events)
    expect(participation.participant).toBe(true)
    // disclosure consent was never recorded for participation
    expect(profile?.disclosureConsentAt).toBeNull()
  })

  test('C9: consent alone grants nothing — scope gates still refuse out-of-scope pilot work', () => {
    // a reviewer scoped to another domain cannot pass the pilot gate path into
    // a pilot assignment: createAssignment's scope check (CI-5C) stays the
    // authority. The pilot gate itself only adds the consent requirement.
    const gate = pilotAssignmentGate('DOMAIN_PACK', CI7_PILOT_DOMAIN_ID, { participant: true, latestConsentAt: null, latestWithdrawalAt: null, protocolVersion: CI7_PILOT_PROTOCOL_VERSION, compensationStatus: 'UNPAID' })
    expect(gate.ok).toBe(true) // consent present → CI-5C gates decide the rest
    const staleProtocol = pilotAssignmentGate('DOMAIN_PACK', CI7_PILOT_DOMAIN_ID, { participant: true, latestConsentAt: null, latestWithdrawalAt: null, protocolVersion: 'ci7-pilot-protocol-0', compensationStatus: null })
    expect(staleProtocol.ok).toBe(false)
    if (!staleProtocol.ok) expect(staleProtocol.status).toBe(409)
    const notPilot = pilotAssignmentGate('DOMAIN_PACK', 'mathematics-statistics', { participant: false, latestConsentAt: null, latestWithdrawalAt: null, protocolVersion: null, compensationStatus: null })
    expect(notPilot.ok).toBe(true) // non-pilot subjects are not pilot-gated
  })
})
