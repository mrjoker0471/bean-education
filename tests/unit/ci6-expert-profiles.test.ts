// ─── BEAN Classroom Intelligence (CI-6D): expert profiles & capability states ──
// Isolated real-DB tests for the consent-gated public expert directory and the
// five distinct capability states, each derived from its OWN ledger, plus the
// privacy guarantees of the public projection (no emails, no COI text, no
// verification notes, no internal audit data — ever).

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci6d-'))
const isolatedUrl = `file:${join(tmp, 'ci6d.db')}`
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

const { expertProfilesDbFromPrisma, updateDisclosureSettings, listPublicExpertProfiles } = await import('@/lib/ci/fleet/expert-profiles')
const { submitReviewerApplication, reviewerDbFromPrisma, resolveReviewerProfile } = await import('@/lib/ci/fleet/reviewers')
const { recordVerification, verificationDbFromPrisma } = await import('@/lib/ci/fleet/verification')
const { applicationsDbFromPrisma } = await import('@/lib/ci/fleet/applications')

const expertsRoute = await import('@/app/api/ci6/experts/route')
const disclosureRoute = await import('@/app/api/ci5/reviewers/me/disclosure/route')

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

function setSession(id: string | null) {
  sessionStudent = id
    ? { id, email: 'session@bean.test', displayName: 'Session User', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
    : null
}

let applicantId: string
let applicantProfileId: string
let hiddenProfileId: string
let expiredId: string

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const applicant = await client.student.create({ data: { email: `ci6d-applicant-${s}@bean.test`, role: 'STUDENT' } })
  const hidden = await client.student.create({ data: { email: `ci6d-hidden-${s}@bean.test`, role: 'STUDENT' } })
  const expired = await client.student.create({ data: { email: `ci6d-expired-${s}@bean.test`, role: 'STUDENT' } })
  applicantId = applicant.id

  // LISTED applicant with consent + disclosed profile
  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: applicantId, displayName: 'Applicant' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'consults for a competing exam-prep company',
    qualificationCategory: 'PhD History',
    institutionAffiliation: 'Secret Institute',
    specialties: ['modern history'],
    consentGranted: true,
  })
  applicantProfileId = (applied as { profile: { id: string } }).profile.id
  const listed = await updateDisclosureSettings(expertProfilesDbFromPrisma(client), { studentId: applicantId, displayName: 'Applicant' }, {
    profileVisibility: 'LISTED',
    publicDisplayName: 'Dr. A. Historian',
    professionalSummary: 'Historian focused on modern South Asian history.',
    availabilityNote: 'weekends',
    disclosedAffiliation: false,
  })
  expect(listed.ok).toBe(true)

  // PRIVATE profile (must never appear)
  const appliedHidden = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: hidden.id, displayName: 'Hidden' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    consentGranted: true,
  })
  hiddenProfileId = (appliedHidden as { profile: { id: string } }).profile.id

  // LISTED but EXPIRED reviewer (eligibility must not survive expiry)
  const appliedExpired = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: expired.id, displayName: 'Expired' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    consentGranted: true,
  })
  expiredId = (appliedExpired as { profile: { id: string } }).profile.id
  await client.expertReviewerProfile.update({
    where: { id: expiredId },
    data: {
      status: 'ACTIVE',
      approvedDomains: '["mathematics"]',
      expiresAt: new Date(Date.now() - 86_400_000),
      profileVisibility: 'LISTED',
      disclosureConsentAt: new Date(),
    },
  })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-6D disclosure settings (consent-gated)', () => {
  test('LISTED records disclosureConsentAt + CONSENT_RECORDED event exactly once', async () => {
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: applicantProfileId } })
    expect(profile?.profileVisibility).toBe('LISTED')
    expect(profile?.disclosureConsentAt).not.toBeNull()
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: applicantProfileId, eventType: 'CONSENT_RECORDED' } })
    // one from the application consent (consentGranted) + one from listing
    expect(events.length).toBe(2)
    const again = await updateDisclosureSettings(expertProfilesDbFromPrisma(client), { studentId: applicantId, displayName: 'Applicant' }, { profileVisibility: 'LISTED' })
    expect(again.ok).toBe(true)
    const eventsAfter = await client.expertReviewerEvent.findMany({ where: { profileId: applicantProfileId, eventType: 'CONSENT_RECORDED' } })
    expect(eventsAfter.length).toBe(events.length)
  })

  test('forged privileged fields refused; disclosure never touches qualification state', async () => {
    setSession(applicantId)
    const forged = await disclosureRoute.PUT(req('/api/ci5/reviewers/me/disclosure', { method: 'PUT', body: { profileVisibility: 'LISTED', status: 'ACTIVE', approvedDomains: ['mathematics'], verificationStatus: 'REFERENCED_VERIFIED' } }))
    expect(forged.status).toBe(400)
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: applicantProfileId } })
    expect(profile?.status).toBe('APPLICATION_PENDING')
    expect(profile?.verificationStatus).toBe('UNVERIFIED')
    expect(JSON.parse(profile?.approvedDomains ?? '[]')).toEqual([])
  })

  test('unauthenticated access refused; no-profile returns null profile', async () => {
    setSession(null)
    expect((await disclosureRoute.GET()).status).toBe(401)
    setSession(randomUUID())
    const none = await disclosureRoute.GET()
    expect(none.status).toBe(200)
    expect((await json(none) as { profile: unknown }).profile).toBeNull()
  })
})

describe('CI-6D public directory (five distinct states, strict privacy)', () => {
  test('PRIVATE profiles never appear; expired reviewers are not reviewer-eligible', async () => {
    const experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(client))
    const ids = experts.map((e) => e.profileId)
    expect(ids).toContain(applicantProfileId)
    expect(ids).toContain(expiredId)
    expect(ids).not.toContain(hiddenProfileId)
    const applicantCard = experts.find((e) => e.profileId === applicantProfileId)!
    expect(applicantCard.applicant).toBe(true)
    expect(applicantCard.reviewerEligible).toBe(false)
    expect(applicantCard.credentialVerified).toBe(false)
    expect(applicantCard.displayName).toBe('Dr. A. Historian')
    // affiliation NOT disclosed -> never present
    expect(applicantCard.affiliation).toBeNull()
    expect(JSON.stringify(experts)).not.toContain('Secret Institute')
    const expiredCard = experts.find((e) => e.profileId === expiredId)!
    // lazy expiry resolves ACTIVE -> EXPIRED on read
    expect(expiredCard.reviewerEligible).toBe(false)
  })

  test('credential-verified state comes ONLY from verification records (no inference)', async () => {
    // record a VERIFIED credential for the applicant
    const ev = await recordEvidenceFor(applicantId)
    expect(ev.ok).toBe(true)
    const verified = await recordVerification(verificationDbFromPrisma(client), { studentId: randomUUID(), displayName: 'Verifier' }, applicantProfileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Open Historical Institute',
      qualificationScope: 'modern history',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      evidenceIds: [(ev as { evidence: { id: string } }).evidence.id],
      decision: 'VERIFIED',
      reason: 'degree certificate examined against the institute public record',
    })
    expect(verified.ok).toBe(true)
    const experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(client))
    const card = experts.find((e) => e.profileId === applicantProfileId)!
    expect(card.credentialVerified).toBe(true)
    expect(card.verifiedAreas).toContain('modern history')
    // still an applicant AND not eligible — states stay independent
    expect(card.applicant).toBe(true)
    expect(card.reviewerEligible).toBe(false)
    // verification REASON is internal — never public
    expect(JSON.stringify(experts)).not.toContain('examined against the institute public record')
  })

  test('domain approvals and language verifications come from their own ledgers', async () => {
    // direct authoritative-ledger rows attributed to the applicant's account id
    await client.classroomPackReview.create({
      data: {
        packId: 'mathematics',
        packVersion: 'v1',
        packChecksum: 'chk',
        riskClass: 'STANDARD',
        decision: 'APPROVED',
        reviewerStudentId: applicantId,
        reviewerName: 'Dr. A. Historian',
        rationale: 'rationalised approval for directory-state testing only',
        evidence: 'evidence block for directory-state testing only',
      },
    })
    const measurement = await client.languageBenchmarkMeasurement.create({
      data: {
        languageTag: 'hi',
        task: 'TRANSLATION',
        modelProvider: 'fixture',
        modelVersion: 'fixture-1',
        benchmarkVersion: 'fixture-bench-1',
        benchmarkChecksum: 'fixture-checksum',
        testRef: 'fixture',
        passed: false,
        caseCount: 2,
        passedCount: 1,
        measuredAt: new Date(),
      },
    })
    await client.languageCapabilityReview.create({
      data: {
        languageTag: 'hi',
        task: 'TRANSLATION',
        measurementId: measurement.id,
        modelProvider: 'fixture',
        modelVersion: 'fixture-1',
        benchmarkVersion: 'fixture-bench-1',
        benchmarkChecksum: 'fixture-checksum',
        reviewerStudentId: applicantId,
        reviewerCode: 'BR-directorytest',
        reviewerQualification: 'test fixture',
        decision: 'APPROVED',
        rationale: 'language review row for directory-state testing only',
        evidence: '{"meaning_preservation":"OK","domain_terminology":"OK","grammar":"OK","naturalness":"OK","script_correctness":"OK","mathematical_notation":"OK","scientific_symbols":"OK","code_switching":"OK","regional_register":"OK","dialect_differences":"OK","ambiguous_wording":"OK","unsupported_claims":"OK","safety_refusal_accuracy":"OK"}',
      },
    })
    const experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(client))
    const card = experts.find((e) => e.profileId === applicantProfileId)!
    expect(card.domainApprovals).toBe(1)
    expect(card.languageVerified).toBe(1)
    // eligibility STILL false — approval history does not make a pending applicant eligible
    expect(card.reviewerEligible).toBe(false)
    expect(card.applicant).toBe(true)
  })

  test('suspension/revocation automatically remove eligibility; unlisting removes the profile', async () => {
    await client.expertReviewerProfile.update({ where: { id: applicantProfileId }, data: { status: 'ACTIVE', approvedDomains: '["mathematics"]' } })
    let experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(client))
    expect(experts.find((e) => e.profileId === applicantProfileId)?.reviewerEligible).toBe(true)
    await client.expertReviewerProfile.update({ where: { id: applicantProfileId }, data: { status: 'SUSPENDED', suspendedReason: 'suspended for eligibility regression testing' } })
    experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(client))
    expect(experts.find((e) => e.profileId === applicantProfileId)?.reviewerEligible).toBe(false)
    // unlist (consent withdrawal) removes the profile from the directory
    await updateDisclosureSettings(expertProfilesDbFromPrisma(client), { studentId: applicantId, displayName: 'Applicant' }, { profileVisibility: 'PRIVATE' })
    experts = await listPublicExpertProfiles(expertProfilesDbFromPrisma(client))
    expect(experts.find((e) => e.profileId === applicantProfileId)).toBeUndefined()
    await updateDisclosureSettings(expertProfilesDbFromPrisma(client), { studentId: applicantId, displayName: 'Applicant' }, { profileVisibility: 'LISTED' })
  })

  test('public route: no auth required; response contains zero private data', async () => {
    const res = await expertsRoute.GET()
    expect(res.status).toBe(200)
    const body = await json(res)
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('@bean.test')
    expect(raw).not.toContain('conflictOfInterest')
    expect(raw).not.toContain('competing exam-prep company')
    expect(raw).not.toContain('storagePath')
    expect(raw).not.toContain('studentId')
    expect(Array.isArray((body as { experts: unknown[] }).experts)).toBe(true)
  })
})

async function recordEvidenceFor(studentId: string) {
  const { recordEvidenceUpload } = await import('@/lib/ci/fleet/applications')
  return recordEvidenceUpload(
    applicationsDbFromPrisma(client),
    { studentId, displayName: 'Applicant' },
    { kind: 'CERTIFICATE', fileName: 'degree.pdf', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]) },
    { storeRoot: join(tmp, 'evidence-store') },
  )
}

// reference the resolver import so tree-shaking doesn't drop the lazily used one
void resolveReviewerProfile
