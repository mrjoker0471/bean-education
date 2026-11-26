// ─── BEAN Classroom Intelligence (CI-7H): pilot dashboard reporting tests ────
//   H1  a fresh ledger reports NOT STARTED with genuine zeros and the fixture
//       policy (no missing value is ever calculated as a success)
//   H2  counts move ONLY through the REAL service chains: an activated,
//       pilot-consented reviewer with a checksum-bound assignment and a
//       recorded review moves the exact corresponding counters
//   H3  genuine approvals count DISTINCT reviewers bound to the CURRENT
//       checksum; a stale-checksum review never counts
//   H4  invitation counts only include invitations whose requested scope
//       actually targets the pilot domain; claim ≠ privilege (status only)
//   H5  activation status derives from the append-only ledger (DISABLED
//       default); evaluation status honestly reports NO DATASET / INSUFFICIENT
//       EVIDENCE; benchmark labels count human labels only
//   H6  the route is admin-only

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7h-'))
const isolatedUrl = `file:${join(tmp, 'ci7h.db')}`
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
  buildPilotReport,
  ci7ReportingDbFromPrisma,
  recordPilotParticipationConsent,
} = await import('@/lib/ci/fleet/pilot')
const { computePackChecksum } = await import('@/lib/ci/fleet/domain-packs')
const { submitReviewerApplication, decideReviewerQualification, activateReviewer, resolveReviewerProfile, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')
const { createAssignment, markAssignmentCompleted, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')
const { recordPackReview, curatorDbFromPrisma } = await import('@/lib/ci/fleet/curator')
const { createInvitation } = await import('@/lib/ci/fleet/invitations')
const { PACK_REVIEW_RUBRIC } = await import('@/lib/ci/fleet/domain-rubric')

const reportingRoute = await import('@/app/api/admin/ci7/reporting/route')

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

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci7h-admin-${s}@bean.test`, role: 'ADMIN' } })
  adminId = admin.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7H pilot dashboard reporting', () => {
  test('H1: a fresh ledger reports NOT STARTED with genuine zeros', async () => {
    const report = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    expect(report.pilotStatus).toBe('NOT STARTED')
    expect(report.note).toContain('NOT STARTED — the real-world pilot has not been executed')
    expect(report.expertApplications).toBe(0)
    expect(report.independentlyVerifiedExperts).toBe(0)
    expect(report.qualifiedActiveExperts).toBe(0)
    expect(report.pilotDomainEligibleExperts).toBe(0)
    expect(report.pilotInvitations).toBe(0)
    expect(report.claimedPilotInvitations).toBe(0)
    expect(report.acceptedAssignments).toBe(0)
    expect(report.submittedHumanReviews).toBe(0)
    expect(report.completedHumanReviews).toBe(0)
    expect(report.genuineExpertApprovals).toBe(0)
    expect(report.genuineDisagreements).toBe(0)
    expect(report.packActivationStatus).toContain('DISABLED')
    expect(report.evaluationStatus).toContain('NO DATASET')
    expect(report.benchmarkHumanLabels).toBe(0)
    expect(report.fixturePolicy).toContain('never counted')
  })

  test('H2: counts move only through the real service chains — cohort, consent, assignment, review', async () => {
    // cohort path (CI-6): apply → qualify (exact pilot scope) → activate
    const s = randomUUID().slice(0, 8)
    const reviewer = await client.student.create({ data: { email: `ci7h-r-${s}@bean.test`, role: 'STUDENT' } })
    const applicant2 = await client.student.create({ data: { email: `ci7h-p-${s}@bean.test`, role: 'STUDENT' } })
    const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: reviewer.id, displayName: 'R' }, {
      category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', qualificationCategory: 'qualified educator', consentGranted: true,
    })
    const profileId = (applied as { profile: { id: string } }).profile.id
    const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
      decision: 'APPROVED', rationale: 'credential examination recorded', verificationStatus: 'DOCUMENT_REVIEWED',
      scope: { approvedDomains: [CI7_PILOT_DOMAIN_ID] },
    })
    expect(decided.ok).toBe(true)
    const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId)
    expect(activated.ok).toBe(true)
    // a second applicant still pending — application count moves, others don't
    const applied2 = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: applicant2.id, displayName: 'P' }, {
      category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', qualificationCategory: 'pending', consentGranted: true,
    })
    expect(applied2.ok).toBe(true)

    const report1 = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    expect(report1.expertApplications).toBe(2)
    expect(report1.qualifiedActiveExperts).toBe(1)
    expect(report1.independentlyVerifiedExperts).toBe(0) // no CI-6C examination yet
    expect(report1.pilotDomainEligibleExperts).toBe(0) // consent not yet recorded
    expect(report1.pilotStatus).toBe('NOT STARTED')

    // pilot participation consent (CI-7C)
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewer.id)
    const consent = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId: reviewer.id, displayName: 'R' }, {
      protocolVersion: CI7_PILOT_PROTOCOL_VERSION, acknowledged: CI7_PILOT_CONSENT_POINTS, compensationStatus: 'UNPAID',
    })
    expect(consent.ok).toBe(true)
    const report2 = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    expect(report2.pilotDomainEligibleExperts).toBe(1)

    // checksum-bound assignment (CI-5C) + review (CI-4C/5D)
    const created = await createAssignment(assignmentDbFromPrisma(client), { kind: 'ADMIN', studentId: adminId, displayName: 'Admin' }, profile!, {
      subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, riskClass: 'STANDARD', coiCheck: 'NONE_DECLARED',
    })
    expect(created.ok).toBe(true)
    const assignmentId = (created as { assignment: { id: string } }).assignment.id
    const recorded = await recordPackReview(curatorDbFromPrisma(client), { studentId: reviewer.id, displayName: profile!.reviewerCode }, {
      packId: CI7_PILOT_DOMAIN_ID, packVersion: '1.0.0', packChecksum: CHECKSUM, decision: 'APPROVED',
      rationale: 'glossary accurate, sources licence-clean, boundaries protect learners — full inspection',
      evidence: JSON.stringify({ kind: 'CI7-PILOT-SOURCE-FROZEN-REVIEW' }),
    }, { qualifiedApproverIds: new Set([reviewer.id]) })
    expect(recorded.ok).toBe(true)
    // the CI-5D lifecycle: SUBMITTED then COMPLETED with the review as outcomeRef
    const { markAssignmentSubmitted } = await import('@/lib/ci/fleet/assignments')
    const submitted = await markAssignmentSubmitted(assignmentDbFromPrisma(client), profile!, assignmentId, reviewer.id)
    if (!submitted.ok) console.log('H2-SUBMIT-ERROR:', JSON.stringify(submitted))
    expect(submitted.ok).toBe(true)
    const completed = await markAssignmentCompleted(assignmentDbFromPrisma(client), assignmentId, (recorded as { reviewId: string }).reviewId)
    expect(completed.ok).toBe(true)

    const report3 = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    expect(report3.acceptedAssignments).toBe(1)
    expect(report3.submittedHumanReviews).toBe(1)
    expect(report3.completedHumanReviews).toBe(1)
    expect(report3.genuineExpertApprovals).toBe(1)
    expect(report3.pilotStatus).toBe('IN EXECUTION')
    expect(report3.note).toContain('distinguish software readiness from real-world outcomes')
  })

  test('H3: approvals count distinct reviewers on the CURRENT checksum; historical rows never count', async () => {
    // the write authority REFUSES a stale checksum outright (regression): a
    // decision can only bind to the content as it exists now
    const refused = await recordPackReview(curatorDbFromPrisma(client), { studentId: 'stale-reviewer', displayName: 'RC-STALE' }, {
      packId: CI7_PILOT_DOMAIN_ID, packVersion: '0.9.0', packChecksum: '9'.repeat(64), decision: 'APPROVED',
      rationale: 'attempting to record a decision against content that is no longer current',
      evidence: '{"stale":"attempt to bind an outdated checksum"}',
    }, { qualifiedApproverIds: new Set(['stale-reviewer']) })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.status).toBe(409)
    // a HISTORICAL row (recorded when an older version was current, before the
    // content changed) simulates legacy data — it must never count as a
    // genuine approval for the CURRENT version + checksum
    await client.classroomPackReview.create({ data: {
      packId: CI7_PILOT_DOMAIN_ID, packVersion: '0.9.0', packChecksum: '9'.repeat(64), riskClass: 'STANDARD',
      decision: 'APPROVED', reviewerStudentId: 'historical-reviewer', reviewerName: 'RC-HISTORY',
      rationale: 'a historical approval from a previous pack version that later changed',
      evidence: '{}',
    } })
    const report = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    // still exactly 1 genuine approval on the CURRENT version + checksum
    expect(report.genuineExpertApprovals).toBe(1)
    expect(report.submittedHumanReviews).toBe(1)
  })

  test('H4: invitation counts target the pilot domain only; claim status is advisory', async () => {
    const created = await createInvitation(ci7ReportingDbFromPrisma(client) as never, { studentId: adminId, displayName: 'Admin' }, {
      category: 'DOMAIN_EXPERT', requestedDomains: [CI7_PILOT_DOMAIN_ID], note: 'pilot cohort invitation (delivered manually)',
    } as never)
    expect(created.ok).toBe(true)
    const report = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    expect(report.pilotInvitations).toBeGreaterThanOrEqual(1)
    expect(report.claimedPilotInvitations).toBe(0) // claim ≠ participation
  })

  test('H5: activation status derives from the append-only ledger; evaluation reports honestly', async () => {
    const report = await buildPilotReport(ci7ReportingDbFromPrisma(client))
    expect(report.packActivationStatus).toContain('DISABLED')
    expect(report.evaluationStatus).toContain('NO DATASET')
    expect(report.benchmarkHumanLabels).toBe(0)
    expect(report.reReviewRequirements).toBe(0)
  })

  test('H6: the route is admin-only', async () => {
    setSession(null)
    const anon = await reportingRoute.GET()
    expect(anon.status).toBe(401)
    setSession('student', 'STUDENT')
    const nonAdmin = await reportingRoute.GET()
    expect(nonAdmin.status).toBe(403)
    setSession(adminId, 'ADMIN')
    const ok = await reportingRoute.GET()
    expect(ok.status).toBe(200)
    const body = await json(ok) as { report: { pilotStatus: string; genuineExpertApprovals: number } }
    expect(body.report.pilotStatus).toBe('IN EXECUTION')
    expect(body.report.genuineExpertApprovals).toBe(1)
  })
})
