// ─── BEAN Classroom Intelligence (CI-7G): pilot activation / kill switch tests ─
//   G1  default state is DISABLED (no activation rows = never activated)
//   G2  activation is refused while the pack has NOT earned it (curated status
//       IN_REVIEW) — the approval threshold can never be bypassed
//   G3  activation binding must be the CURRENT version + checksum (stale
//       bindings refuse); only the pilot subject can be activated; scope and
//       reason are mandatory; protocol version must match
//   G4  after a GENUINE qualified approval through the real CI-5D path, the
//       curated status derives VERIFIED and activation succeeds — bound to the
//       exact checksum, with the recorded bounded scope
//   G5  the kill switch (DEACTIVATED) works at any time without approval
//       gating; the audit trail is preserved; reactivation is possible
//   G6  ROLLED_BACK records the restore to the previous safe state
//   G7  checksum drift makes the activation STALE — it no longer applies and
//       re-review is required (never silently active on changed content)
//   G8  route authorization: non-admins cannot activate or deactivate
//   G9  activation is bounded: no global enablement exists (scope recorded on
//       the event; reporting surfaces the current state honestly)

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7g-'))
const isolatedUrl = `file:${join(tmp, 'ci7g.db')}`
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

const {
  CI7_PILOT_DOMAIN_ID,
  CI7_PILOT_PROTOCOL_VERSION,
  CI7_PILOT_CONSENT_POINTS,
  pilotPackSnapshot,
  recordPilotParticipationConsent,
  recordPilotActivationEvent,
  resolvePilotActivationState,
} = await import('@/lib/ci/fleet/pilot')
const { computePackChecksum } = await import('@/lib/ci/fleet/domain-packs')
const { resolveCuratedStatus } = await import('@/lib/ci/fleet/curator')
const { submitReviewerApplication, decideReviewerQualification, activateReviewer, resolveReviewerProfile, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')
const { createAssignment, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')
const { PACK_REVIEW_RUBRIC } = await import('@/lib/ci/fleet/domain-rubric')

const activateRoute = await import('@/app/api/admin/ci7/pilot/activate/route')
const deactivateRoute = await import('@/app/api/admin/ci7/pilot/deactivate/route')
const statusRoute = await import('@/app/api/admin/ci7/pilot/status/route')

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

const SNAP = pilotPackSnapshot()
const CHECKSUM = computePackChecksum(SNAP.pack)

let adminId: string
let admin2Id: string

async function curatedNow() {
  const reviews = await client.classroomPackReview.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID } })
  return resolveCuratedStatus(SNAP.pack, reviews)
}

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci7g-admin-${s}@bean.test`, role: 'ADMIN' } })
  const admin2 = await client.student.create({ data: { email: `ci7g-admin2-${s}@bean.test`, role: 'ADMIN' } })
  const reviewer = await client.student.create({ data: { email: `ci7g-reviewer-${s}@bean.test`, role: 'STUDENT' } })
  adminId = admin.id
  admin2Id = admin2.id

  // full real path to one genuine qualified approval (the G4 prerequisite)
  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: reviewer.id, displayName: 'Reviewer' }, {
    category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', qualificationCategory: 'qualified teacher-educator', consentGranted: true,
  })
  const profileId = (applied as { profile: { id: string } }).profile.id
  const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
    decision: 'APPROVED', rationale: 'credential examination recorded through the CI-6C workbench', verificationStatus: 'DOCUMENT_REVIEWED',
    scope: { approvedDomains: [CI7_PILOT_DOMAIN_ID] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId)
  expect(activated.ok).toBe(true)
  const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewer.id)
  const consent = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: reviewer.id, displayName: 'R' }, {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION, acknowledged: CI7_PILOT_CONSENT_POINTS, compensationStatus: 'UNPAID',
  })
  expect(consent.ok).toBe(true)
  const created = await createAssignment(assignmentDbFromPrisma(client), { kind: 'ADMIN', studentId: adminId, displayName: 'Admin' }, profile!, {
    subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, riskClass: 'STANDARD', coiCheck: 'NONE_DECLARED',
  })
  expect(created.ok).toBe(true)
  // record a rubric-backed APPROVED review through the service authority (same
  // authority the CI-5D route writes through — recordPackReview)
  const { recordPackReview, curatorDbFromPrisma } = await import('@/lib/ci/fleet/curator')
  const { checkRubricAgainstDecision } = await import('@/lib/ci/fleet/domain-rubric')
  const rubric = {
    inspected: 'inspected the full pack JSON: glossary, competency levels, task boundaries and the registered source record',
    sections: Object.fromEntries(PACK_REVIEW_RUBRIC.map((sec) => [sec.id, { status: 'OK', notes: 'verified against pack content and sources' }])) as Record<string, { status: string; notes: string }>,
  }
  expect(checkRubricAgainstDecision('APPROVED', rubric).ok).toBe(true)
  const recorded = await recordPackReview(curatorDbFromPrisma(client), { studentId: reviewer.id, displayName: profile!.reviewerCode }, {
    packId: CI7_PILOT_DOMAIN_ID, packVersion: '1.0.0', packChecksum: CHECKSUM, decision: 'APPROVED',
    rationale: 'glossary accurate, sources licence-clean, boundaries protect learners — full inspection recorded',
    evidence: JSON.stringify({ kind: 'CI7-PILOT-SOURCE-FROZEN-REVIEW', inspected: rubric.inspected, sections: rubric.sections, rubricVersion: 1 }),
  }, { qualifiedApproverIds: new Set([reviewer.id]) })
  expect(recorded.ok).toBe(true)
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7G pilot activation and rollback', () => {
  test('G1: default state is DISABLED — no activation rows means never activated', async () => {
    const events = await client.ci7PilotActivation.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID } })
    const state = resolvePilotActivationState(events, CHECKSUM)
    expect(state.state).toBe('DISABLED')
    expect(state.note).toContain('DISABLED — the default')
    expect(state.reReviewRequired).toBe(false)
  })

  test('G2: activation refused while the pack has NOT earned it — the threshold can never be bypassed', async () => {
    // simulated pre-approval state: no review rows → curated IN_REVIEW
    const emptyCurated = resolveCuratedStatus(SNAP.pack, [])
    expect(emptyCurated.status).toBe('IN_REVIEW')
    const refused = await recordPilotActivationEvent(
      { ci7PilotActivation: { create: async () => { throw new Error('must not write') }, findMany: async () => [] } },
      { studentId: adminId, displayName: 'Admin' },
      { eventType: 'ACTIVATED', packId: CI7_PILOT_DOMAIN_ID, pilotScope: 'internal pilot, education staff only', protocolVersion: CI7_PILOT_PROTOCOL_VERSION, reason: 'attempting activation before any genuine approval exists' },
      SNAP.pack, CHECKSUM, emptyCurated,
    )
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.status).toBe(409)
      expect(refused.error).toContain('has not earned activation')
    }
    const rows = await client.ci7PilotActivation.count()
    expect(rows).toBe(0) // nothing was written
  })

  test('G3: stale bindings, foreign subjects, missing scope/reason and wrong protocol refuse', async () => {
    const curated = await curatedNow()
    const stale = await recordPilotActivationEvent(
      { ci7PilotActivation: { create: async () => { throw new Error('must not write') }, findMany: async () => [] } },
      { studentId: adminId, displayName: 'Admin' },
      { eventType: 'ACTIVATED', packId: CI7_PILOT_DOMAIN_ID, packChecksum: '9'.repeat(64), pilotScope: 'internal pilot scope text', protocolVersion: CI7_PILOT_PROTOCOL_VERSION, reason: 'stale checksum binding attempt here' },
      SNAP.pack, CHECKSUM, curated,
    )
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error).toContain('must bind the CURRENT pack content')
    const foreign = await recordPilotActivationEvent(
      { ci7PilotActivation: { create: async () => { throw new Error('must not write') }, findMany: async () => [] } },
      { studentId: adminId, displayName: 'Admin' },
      { eventType: 'ACTIVATED', packId: 'mathematics-statistics', pilotScope: 'attempting a foreign pack activation', protocolVersion: CI7_PILOT_PROTOCOL_VERSION, reason: 'no global activation exists anywhere' },
      SNAP.pack, CHECKSUM, curated,
    )
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.error).toContain('only the pilot subject')
    const noScope = await recordPilotActivationEvent(
      { ci7PilotActivation: { create: async () => { throw new Error('must not write') }, findMany: async () => [] } },
      { studentId: adminId, displayName: 'Admin' },
      { eventType: 'ACTIVATED', packId: CI7_PILOT_DOMAIN_ID, pilotScope: '', protocolVersion: CI7_PILOT_PROTOCOL_VERSION, reason: 'missing scope attempt here too' },
      SNAP.pack, CHECKSUM, curated,
    )
    expect(noScope.ok).toBe(false)
    const wrongProtocol = await recordPilotActivationEvent(
      { ci7PilotActivation: { create: async () => { throw new Error('must not write') }, findMany: async () => [] } },
      { studentId: adminId, displayName: 'Admin' },
      { eventType: 'ACTIVATED', packId: CI7_PILOT_DOMAIN_ID, pilotScope: 'internal pilot scope text', protocolVersion: 'ci7-pilot-protocol-0', reason: 'wrong protocol version attempt' },
      SNAP.pack, CHECKSUM, curated,
    )
    expect(wrongProtocol.ok).toBe(false)
    const rows = await client.ci7PilotActivation.count()
    expect(rows).toBe(0)
  })

  test('G4: after a genuine qualified approval, activation succeeds — bound to the exact checksum', async () => {
    setSession(adminId, 'ADMIN')
    const curated = await curatedNow()
    expect(curated.status).toBe('VERIFIED') // earned through the real authority
    const res = await activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: {
      pilotScope: 'restricted internal pilot: BEAN education staff reviewing pedagogy guidance only',
      reason: 'genuine expert approval recorded through the CI-4/CI-5 authority; owner authorised the bounded pilot',
    } }))
    expect(res.status).toBe(201)
    const events = await client.ci7PilotActivation.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID } })
    const state = resolvePilotActivationState(events, CHECKSUM)
    expect(state.state).toBe('ACTIVE')
    expect(state.activatedChecksum).toBe(CHECKSUM)
    expect(state.note).toContain('restricted pilot use per the recorded scope')
  })

  test('G5: the kill switch works at any time; reactivation is possible', async () => {
    setSession(adminId, 'ADMIN')
    const killed = await deactivateRoute.POST(req('/api/admin/ci7/pilot/deactivate', { method: 'POST', body: {
      reason: 'kill switch drill: suspected misuse reported, pilot paused for investigation',
    } }))
    expect(killed.status).toBe(201)
    let events = await client.ci7PilotActivation.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID }, orderBy: { createdAt: 'asc' } })
    let state = resolvePilotActivationState(events, CHECKSUM)
    expect(state.state).toBe('DEACTIVATED')
    expect(state.note).toContain('kill switch engaged')
    expect(state.reReviewRequired).toBe(false)
    // reactivation is possible while the curated status stays VERIFIED
    const res = await activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: {
      eventType: 'REACTIVATED',
      pilotScope: 'restricted internal pilot: BEAN education staff reviewing pedagogy guidance only',
      reason: 'investigation closed with no findings; owner re-authorised the bounded pilot',
    } }))
    expect(res.status).toBe(201)
    events = await client.ci7PilotActivation.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID }, orderBy: { createdAt: 'asc' } })
    state = resolvePilotActivationState(events, CHECKSUM)
    expect(state.state).toBe('ACTIVE')
  })

  test('G6: ROLLED_BACK records the restore to the previous safe state', async () => {
    setSession(adminId, 'ADMIN')
    const rolled = await deactivateRoute.POST(req('/api/admin/ci7/pilot/deactivate', { method: 'POST', body: {
      eventType: 'ROLLED_BACK',
      reason: 'rolled back to the pre-pilot safe state after the pilot window closed',
    } }))
    expect(rolled.status).toBe(201)
    const events = await client.ci7PilotActivation.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID }, orderBy: { createdAt: 'asc' } })
    const state = resolvePilotActivationState(events, CHECKSUM)
    expect(state.state).toBe('ROLLED_BACK')
    expect(state.note).toContain('restored to the previous safe state')
  })

  test('G7: checksum drift makes the activation STALE — never silently active on changed content', () => {
    const events = [
      { id: 'e1', eventType: 'ACTIVATED', packChecksum: 'a'.repeat(64), createdAt: new Date(1000) },
    ]
    const state = resolvePilotActivationState(events, 'b'.repeat(64))
    expect(state.state).toBe('STALE')
    expect(state.currentStatus).toContain('NOT ACTIVE')
    expect(state.reReviewRequired).toBe(true)
    expect(state.note).toContain('version-bound re-review is required')
  })

  test('G8: route authorization — non-admins cannot activate or deactivate', async () => {
    setSession(null)
    const anonActivate = await activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: { pilotScope: 'x'.repeat(20), reason: 'y'.repeat(20) } }))
    expect(anonActivate.status).toBe(401)
    const anonDeactivate = await deactivateRoute.POST(req('/api/admin/ci7/pilot/deactivate', { method: 'POST', body: { reason: 'z'.repeat(20) } }))
    expect(anonDeactivate.status).toBe(401)
    setSession('student', 'STUDENT')
    const nonAdmin = await activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: { pilotScope: 'x'.repeat(20), reason: 'y'.repeat(20) } }))
    expect(nonAdmin.status).toBe(403)
  })

  test('G9: the status route reports the honest current state with the full audit history', async () => {
    setSession(adminId, 'ADMIN')
    const res = await statusRoute.GET()
    expect(res.status).toBe(200)
    const body = await json(res) as {
      state: { state: string; reReviewRequired: boolean }
      curated: { status: string; approvalsRecorded: number; approvalsRequired: number }
      events: Array<{ eventType: string; pilotScope: string }>
    }
    expect(body.state.state).toBe('ROLLED_BACK')
    expect(body.curated.status).toBe('VERIFIED')
    expect(body.curated.approvalsRecorded).toBe(1)
    expect(body.curated.approvalsRequired).toBe(1)
    // every activation event carries its bounded scope (no global enablement)
    for (const event of body.events) {
      expect(event.pilotScope.length).toBeGreaterThan(0)
    }
    const eventTypes = body.events.map((e) => e.eventType)
    expect(eventTypes).toEqual(['ACTIVATED', 'DEACTIVATED', 'REACTIVATED', 'ROLLED_BACK'])
    void admin2Id
  })
})
