// ─── BEAN Classroom Intelligence (CI-6G): honest activation reporting ─────────
// Isolated real-DB tests for the aggregate reporting surface: honest zeros on
// an empty ledger, per-ledger count updates when real provenance rows exist,
// fixture-policy disclosure, route authorization, and the provenance invariants
// that tie expert decisions to real authenticated reviewers.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci6g-'))
const isolatedUrl = `file:${join(tmp, 'ci6g.db')}`
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

const { buildActivationReport, reportingDbFromPrisma } = await import('@/lib/ci/fleet/reporting')
const { submitReviewerApplication, decideReviewerQualification, activateReviewer, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')
const { createAssignment, startAssignment, markAssignmentSubmitted, markAssignmentCompleted, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')
const { recordVerification, verificationDbFromPrisma } = await import('@/lib/ci/fleet/verification')

const reportingRoute = await import('@/app/api/admin/ci6/reporting/route')

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

let adminId: string
let reviewerAId: string
let reviewerBId: string
let reviewerAProfileId: string
let reviewerBProfileId: string

async function onboardReviewer(studentId: string): Promise<string> {
  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId, displayName: 'Reviewer' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    qualificationCategory: 'PhD Mathematics',
    consentGranted: true,
  })
  expect(applied.ok).toBe(true)
  const profileId = (applied as { profile: { id: string } }).profile.id
  // CI-6C verification record (real provenance chain)
  const verified = await recordVerification(verificationDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
    credentialType: 'DEGREE',
    issuingInstitution: 'Fixture University (clearly-labelled synthetic)',
    qualificationScope: 'mathematics-statistics',
    verificationMethod: 'PUBLISHED_REGISTRY',
    referenceDetail: 'fixture registry entry — synthetic, disposable DB only',
    decision: 'VERIFIED',
    reason: 'fixture verification for the reporting test — never a real approval',
  })
  expect(verified.ok).toBe(true)
  const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
    decision: 'APPROVED',
    rationale: 'fixture qualification for the reporting test — disposable database only',
    verificationStatus: 'DOCUMENT_REVIEWED',
    scope: { approvedDomains: ['mathematics-statistics'] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId)
  expect(activated.ok).toBe(true)
  return profileId
}

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci6g-admin-${s}@bean.test`, role: 'ADMIN' } })
  const a = await client.student.create({ data: { email: `ci6g-a-${s}@bean.test`, role: 'STUDENT' } })
  const b = await client.student.create({ data: { email: `ci6g-b-${s}@bean.test`, role: 'STUDENT' } })
  adminId = admin.id
  reviewerAId = a.id
  reviewerBId = b.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-6G honest zeros on an empty ledger', () => {
  test('fresh database reports zeros for every real count', async () => {
    const report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.totalApplications).toBe(0)
    expect(report.pendingVerification).toBe(0)
    expect(report.verifiedAndEligible).toBe(0)
    expect(report.suspendedOrExpiredQualifications).toBe(0)
    expect(report.terminalOrWithdrawn).toBe(0)
    expect(report.activeAssignments).toBe(0)
    expect(report.completedHumanReviews).toBe(0)
    expect(report.realExpertLabels).toBe(0)
    expect(report.domainPacksGenuinelyApproved).toBe(0)
    expect(report.languageCapabilitiesGenuinelyMeasured).toBe(0)
    expect(report.fixtureOnlyTestResults).toBe(0)
    expect(report.fixturePolicy).toContain('never counted as real approvals')
    expect(report.fixturePolicy).toContain('genuinely empty')
  })

  test('route is admin-only and forwards the report verbatim', async () => {
    setSession(null)
    expect((await reportingRoute.GET()).status).toBe(401)
    setSession(reviewerAId, 'STUDENT')
    expect((await reportingRoute.GET()).status).toBe(403)
    setSession(adminId, 'ADMIN')
    const res = await reportingRoute.GET()
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(((body as { report: ActivationReportShape }).report).totalApplications).toBe(0)
    expect((body as { note: string }).note).toContain('reported separately')
  })
})

describe('CI-6G per-ledger counts with real provenance rows', () => {
  test('applications, verification, eligibility, assignments and completions count from their own ledgers', async () => {
    reviewerAProfileId = await onboardReviewer(reviewerAId)
    let report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.totalApplications).toBe(1)
    expect(report.verifiedAndEligible).toBe(1)
    expect(report.domainPacksGenuinelyApproved).toBe(0)

    // a second application stays pending (no qualification decision)
    const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: reviewerBId, displayName: 'Reviewer B' }, {
      category: 'DOMAIN_EXPERT',
      conflictOfInterest: 'none declared',
      consentGranted: true,
    })
    expect(applied.ok).toBe(true)
    reviewerBProfileId = (applied as { profile: { id: string } }).profile.id
    report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.totalApplications).toBe(2)
    expect(report.pendingVerification).toBe(1)
    expect(report.verifiedAndEligible).toBe(1)

    // assignment lifecycle updates the assignment counts with provenance
    const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
    const created = await createAssignment(assignmentDbFromPrisma(client), adminActor, await resolveActiveProfile(reviewerAId), { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const assignmentId = (created as { value?: { assignment?: { id: string } }; assignment?: { id: string } }).assignment?.id
      ?? (created as { value?: { assignment?: { id: string } } }).value?.assignment?.id
      ?? ''
    report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.activeAssignments).toBe(1)
    expect(report.completedHumanReviews).toBe(0)

    await startAssignment(assignmentDbFromPrisma(client), await resolveActiveProfile(reviewerAId), assignmentId, reviewerAId)
    await markAssignmentSubmitted(assignmentDbFromPrisma(client), await resolveActiveProfile(reviewerAId), assignmentId, reviewerAId)
    const done = await markAssignmentCompleted(assignmentDbFromPrisma(client), assignmentId, 'pack-review:fixture-outcome')
    expect(done.ok).toBe(true)
    report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.activeAssignments).toBe(0)
    expect(report.completedHumanReviews).toBe(1)
    const completed = await client.expertReviewAssignment.findUnique({ where: { id: assignmentId } })
    expect(completed?.outcomeRef).toBe('pack-review:fixture-outcome')
    expect(completed?.reviewerProfileId).toBe(reviewerAProfileId)
  })

  test('benchmark labels and language capabilities count only provenance-bound rows', async () => {
    // clearly-labelled synthetic label attributed to a REAL profile row
    await client.expertBenchmarkCaseLabel.create({
      data: {
        datasetId: 'fixture-dataset',
        datasetVersion: 'v1',
        caseKey: 'fixture-case-1',
        reviewerProfileId: reviewerAProfileId,
        reviewerCode: 'BR-report',
        expectedResults: '{"expected":"fixture","acceptedAlternatives":[]}',
        confidence: 'HIGH',
        rubricVersion: 'ci5-expert-label-rubric-1',
      },
    })
    await client.languageCapabilityStatus.create({
      data: {
        languageTag: 'hi',
        task: 'TRANSLATION',
        modelProvider: 'fixture',
        modelVersion: 'fixture-1',
        benchmarkVersion: 'fixture-bench-1',
        status: 'VERIFIED',
        basis: 'HUMAN_APPROVED',
        note: 'fixture binding — disposable DB only',
      },
    })
    const report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.realExpertLabels).toBe(1)
    expect(report.languageCapabilitiesGenuinelyMeasured).toBe(1)
  })

  test('domain pack approvals come from the CI-4C distinct-human-approval derivation', async () => {
    // the review binds to the CURRENT registry version + checksum (freshness rule)
    const { getDomainPack } = await import('@/lib/ci/fleet/domain-packs')
    const packEntry = getDomainPack('mathematics-statistics')
    expect(packEntry).not.toBeNull()
    // STANDARD pack: one distinct human approval flips derived status to VERIFIED
    await client.classroomPackReview.create({
      data: {
        packId: 'mathematics-statistics',
        packVersion: packEntry!.pack.packVersion,
        packChecksum: packEntry!.checksum,
        riskClass: 'STANDARD',
        decision: 'APPROVED',
        reviewerStudentId: reviewerAId,
        reviewerName: 'Reviewer A',
        rationale: 'fixture approval for reporting derivation testing — disposable DB',
        evidence: 'fixture evidence block — never a real approval',
      },
    })
    const report = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report.domainPacksGenuinelyApproved).toBe(1)
    // adverse rows never flip the derived status
    const physics = getDomainPack('physics-space')!
    await client.classroomPackReview.create({
      data: {
        packId: 'physics-space',
        packVersion: physics.pack.packVersion,
        packChecksum: physics.checksum,
        riskClass: 'STANDARD',
        decision: 'REJECTED',
        reviewerStudentId: reviewerAId,
        reviewerName: 'Reviewer A',
        rationale: 'fixture rejection — a work-state decision never promotes a pack',
        evidence: 'fixture evidence block',
      },
    })
    const report2 = await buildActivationReport(reportingDbFromPrisma(client), client)
    expect(report2.domainPacksGenuinelyApproved).toBe(1)
  })
})

async function resolveActiveProfile(studentId: string) {
  const profile = await client.expertReviewerProfile.findUnique({ where: { studentId } })
  expect(profile?.status).toBe('ACTIVE')
  return profile as never
}

interface ActivationReportShape {
  totalApplications: number
}
