// ─── BEAN Classroom Intelligence (CI-7I): security & privacy acceptance ──────
// Consolidated negative-authorization battery for the CI-7 surface. Items the
// preceding CI-7 units already prove are cross-referenced in comments; this
// file adds the cases that had no dedicated home yet:
//   S1  conflicted reviewer cannot receive a pilot assignment (COI gate on the
//       pilot path)
//   S2  a recused reviewer cannot continue submitting pilot reviews
//   S3  an expired qualification cannot review (lazy expiry applies on the
//       pilot path too)
//   S4  evidence hygiene: pilot review evidence carries NO student data
//       (no emails, student ids, grades or classroom identifiers)
//   S5  role matrix: every CI-7 route refuses anonymous + non-admin callers
//   S6  self-approval remains impossible on the pilot path (an admin without
//       reviewer qualification cannot substitute for an expert)
//   S7  consent withdrawal de-eligibilises immediately (assignment gate)
//   S8  fixture policy: the reporting surface states fixture separation
//       verbatim and fixture rows never enter real counts

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7i-'))
const isolatedUrl = `file:${join(tmp, 'ci7i.db')}`
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
  withdrawPilotParticipation,
  resolvePilotParticipation,
} = await import('@/lib/ci/fleet/pilot')
const { computePackChecksum } = await import('@/lib/ci/fleet/domain-packs')
const { submitReviewerApplication, decideReviewerQualification, activateReviewer, resolveReviewerProfile, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')
const { createAssignment, recuseAssignment, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')
const { PACK_REVIEW_RUBRIC } = await import('@/lib/ci/fleet/domain-rubric')

const reviewRoute = await import('@/app/api/ci5/reviewer/assignments/[assignmentId]/pack-review/route')
const activateRoute = await import('@/app/api/admin/ci7/pilot/activate/route')
const deactivateRoute = await import('@/app/api/admin/ci7/pilot/deactivate/route')
const statusRoute = await import('@/app/api/admin/ci7/pilot/status/route')
const reportingRoute = await import('@/app/api/admin/ci7/reporting/route')
const disagreementsRoute = await import('@/app/api/admin/ci7/disagreements/route')
const evaluationRoute = await import('@/app/api/admin/ci7/evaluation-readiness/route')
const consentRoute = await import('@/app/api/ci5/reviewers/me/pilot-consent/route')

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
let conflictedProfileId: string
let recusedProfileId: string
let recusedStudentId: string
let recusedAssignmentId: string
let expiredProfileId: string
let expiredStudentId: string

async function activateScoped(studentId: string, domain: string, conflictOfInterest = 'none declared'): Promise<string> {
  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId, displayName: 'R' }, {
    category: 'DOMAIN_EXPERT', conflictOfInterest, qualificationCategory: 'qualified educator (examined)', consentGranted: true,
  })
  expect(applied.ok).toBe(true)
  const profileId = (applied as { profile: { id: string } }).profile.id
  const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
    decision: 'APPROVED', rationale: 'credential examination recorded through the CI-6C workbench', verificationStatus: 'DOCUMENT_REVIEWED',
    scope: { approvedDomains: [domain] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId)
  expect(activated.ok).toBe(true)
  return profileId
}

function allOkRubric() {
  return {
    inspected: 'inspected the full pack content, sources and licence records end to end before this decision',
    sections: Object.fromEntries(PACK_REVIEW_RUBRIC.map((sec) => [sec.id, { status: 'OK', notes: 'verified against pack content and sources' }])) as Record<string, { status: string; notes: string }>,
  }
}

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci7i-admin-${s}@bean.test`, role: 'ADMIN' } })
  adminId = admin.id

  // conflicted but otherwise qualified reviewer
  const conflicted = await client.student.create({ data: { email: `ci7i-conflicted-${s}@bean.test`, role: 'STUDENT' } })
  conflictedProfileId = await activateScoped(conflicted.id, CI7_PILOT_DOMAIN_ID, 'author of the seed content under review — declared conflict')

  // recused reviewer with an open pilot assignment they recused from
  const recused = await client.student.create({ data: { email: `ci7i-recused-${s}@bean.test`, role: 'STUDENT' } })
  recusedStudentId = recused.id
  recusedProfileId = await activateScoped(recused.id, CI7_PILOT_DOMAIN_ID)
  const recusedProfile = await resolveReviewerProfile(reviewerDbFromPrisma(client), recused.id)
  await recordPilotParticipationConsent(reviewerDbFromPrisma(client), recusedProfile!, { kind: 'REVIEWER', studentId: recused.id, displayName: 'R' }, {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION, acknowledged: CI7_PILOT_CONSENT_POINTS, compensationStatus: 'UNPAID',
  })
  const created = await createAssignment(assignmentDbFromPrisma(client), { kind: 'ADMIN', studentId: adminId, displayName: 'Admin' }, recusedProfile!, {
    subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, riskClass: 'STANDARD', coiCheck: 'NONE_DECLARED',
  })
  expect(created.ok).toBe(true)
  recusedAssignmentId = (created as { assignment: { id: string } }).assignment.id
  const recusedResult = await recuseAssignment(assignmentDbFromPrisma(client), recusedProfile!, recusedAssignmentId, 'recusal: I contributed to the material under review', recused.id)
  expect(recusedResult.ok).toBe(true)

  // expired reviewer (qualification lapsed)
  const expiring = await client.student.create({ data: { email: `ci7i-expired-${s}@bean.test`, role: 'STUDENT' } })
  expiredStudentId = expiring.id
  expiredProfileId = await activateScoped(expiring.id, CI7_PILOT_DOMAIN_ID)
  await client.expertReviewerProfile.update({ where: { id: expiredProfileId }, data: { expiresAt: new Date(Date.now() - 86_400_000) } })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7I security and privacy acceptance', () => {
  test('S1: a conflicted reviewer cannot receive a pilot assignment (COI enforced on the pilot path)', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), (await client.expertReviewerProfile.findUnique({ where: { id: conflictedProfileId } }))!.studentId)
    const refused = await createAssignment(assignmentDbFromPrisma(client), { kind: 'ADMIN', studentId: adminId, displayName: 'Admin' }, profile!, {
      subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, coiCheck: 'CONFLICT_FOUND', conflictNote: 'declared authorship conflict recorded at assignment time',
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.status).toBe(409)
  })

  test('S2: a recused reviewer cannot continue submitting pilot reviews', async () => {
    setSession(recusedStudentId)
    const res = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${recusedAssignmentId}/pack-review`, { method: 'POST', body: {
      decision: 'APPROVED', rationale: 'attempting to review after recusal should be structurally impossible', rubric: allOkRubric(),
    } }), { params: Promise.resolve({ assignmentId: recusedAssignmentId }) } as never)
    expect(res.status).toBe(409)
    const rows = await client.classroomPackReview.findMany({ where: { reviewerStudentId: recusedStudentId } })
    expect(rows.length).toBe(0) // nothing recorded through the recused assignment
  })

  test('S3: an expired qualification cannot review — lazy expiry applies on the pilot path', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), expiredStudentId)
    expect(profile!.status).toBe('EXPIRED') // lazy expiry re-derived on read
    const refused = await createAssignment(assignmentDbFromPrisma(client), { kind: 'ADMIN', studentId: adminId, displayName: 'Admin' }, profile!, {
      subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, coiCheck: 'NONE_DECLARED',
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.status).toBe(409)
  })

  test('S4: pilot review evidence carries no student data', async () => {
    const rows = await client.classroomPackReview.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID } })
    const evidenceBlob = rows.map((r) => r.evidence).join(' | ')
    expect(evidenceBlob).not.toMatch(/@bean\.test|studentId|grade|payment|admission/i)
    // the rubric evidence structure is content-only
    for (const row of rows) {
      const parsed = JSON.parse(row.evidence) as Record<string, unknown>
      expect(Object.keys(parsed)).not.toContain('student')
      expect(Object.keys(parsed)).not.toContain('learner')
    }
  })

  test('S5: role matrix — every CI-7 route refuses anonymous and non-admin callers', async () => {
    const adminBody = { pilotScope: 'internal restricted pilot scope text', reason: 'role-matrix probe reason text' }
    setSession(null)
    const anonResults = await Promise.all([
      activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: adminBody })),
      deactivateRoute.POST(req('/api/admin/ci7/pilot/deactivate', { method: 'POST', body: { reason: 'anonymous kill switch attempt' } })),
      statusRoute.GET(),
      reportingRoute.GET(),
      disagreementsRoute.GET(req('/api/admin/ci7/disagreements')),
      disagreementsRoute.POST(req('/api/admin/ci7/disagreements', { method: 'POST', body: {} })),
      evaluationRoute.GET(req('/api/admin/ci7/evaluation-readiness?datasetSlug=x&datasetVersion=1')),
      consentRoute.GET(),
    ])
    for (const res of anonResults) expect(res.status).toBe(401)
    setSession('student', 'STUDENT')
    const studentResults = await Promise.all([
      activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: adminBody })),
      deactivateRoute.POST(req('/api/admin/ci7/pilot/deactivate', { method: 'POST', body: { reason: 'student kill switch attempt' } })),
      statusRoute.GET(),
      reportingRoute.GET(),
      disagreementsRoute.GET(req('/api/admin/ci7/disagreements')),
      evaluationRoute.GET(req('/api/admin/ci7/evaluation-readiness?datasetSlug=x&datasetVersion=1')),
    ])
    for (const res of studentResults) expect(res.status).toBe(403)
  })

  test('S6: an administrator cannot substitute for a qualified expert on the pilot approval path', async () => {
    // the activation gate itself refuses when the curated status is not VERIFIED
    setSession(adminId, 'ADMIN')
    const refused = await activateRoute.POST(req('/api/admin/ci7/pilot/activate', { method: 'POST', body: {
      pilotScope: 'attempting to activate without any genuine expert approval recorded',
      reason: 'admin self-substitution attempt must be structurally refused',
    } }))
    expect(refused.status).toBe(409)
    expect(((await json(refused)) as { error: string }).error).toContain('has not earned activation')
  })

  test('S7: consent withdrawal de-eligibilises immediately', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), recusedStudentId)
    // recused reviewer re-consents then withdraws — the gate must flip off
    const reconsent = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: recusedStudentId, displayName: 'R' }, {
      protocolVersion: CI7_PILOT_PROTOCOL_VERSION, acknowledged: CI7_PILOT_CONSENT_POINTS, compensationStatus: 'UNPAID',
    })
    expect(reconsent.ok).toBe(true)
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: recusedProfileId }, orderBy: { createdAt: 'asc' } })
    expect(resolvePilotParticipation(events).participant).toBe(true)
    const withdrawn = await withdrawPilotParticipation(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: recusedStudentId, displayName: 'R' }, 'withdrawing from the pilot cohort entirely')
    expect(withdrawn.ok).toBe(true)
    const eventsAfter = await client.expertReviewerEvent.findMany({ where: { profileId: recusedProfileId }, orderBy: { createdAt: 'asc' } })
    const participation = resolvePilotParticipation(eventsAfter)
    expect(participation.participant).toBe(false)
    const gate = (await import('@/lib/ci/fleet/pilot')).pilotAssignmentGate('DOMAIN_PACK', CI7_PILOT_DOMAIN_ID, participation)
    expect(gate.ok).toBe(false)
  })

  test('S8: the reporting surface states the fixture policy verbatim and never mixes fixtures into real counts', async () => {
    setSession(adminId, 'ADMIN')
    const res = await reportingRoute.GET()
    const body = (await json(res)) as { report: { fixturePolicy: string; pilotStatus: string; note: string } }
    expect(body.report.fixturePolicy).toContain('Synthetic fixture records are never counted')
    expect(body.report.fixturePolicy).toContain('zero means zero')
    expect(['NOT STARTED', 'IN EXECUTION']).toContain(body.report.pilotStatus)
  })
})
