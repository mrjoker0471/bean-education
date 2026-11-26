// ─── BEAN Classroom Intelligence (CI-6C): independent credential verification ──
// Isolated real-DB tests for the verification workbench: honest-method records,
// no self-dealing, no client-supplied privileged state, evidence-bound document
// examination, append-only corrections, route authorization, and the hard
// separation between verification records and the reviewer lifecycle.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci6c-'))
const isolatedUrl = `file:${join(tmp, 'ci6c.db')}`
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

const { recordVerification, verificationDbFromPrisma, listVerificationRecords, resolveVerificationState } = await import('@/lib/ci/fleet/verification')
const { applicationsDbFromPrisma, recordEvidenceUpload } = await import('@/lib/ci/fleet/applications')
const { submitReviewerApplication, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')

const queueRoute = await import('@/app/api/admin/ci6/applications/route')
const detailRoute = await import('@/app/api/admin/ci6/applications/[profileId]/route')
const verifyRoute = await import('@/app/api/admin/ci6/applications/[profileId]/verification/route')
const infoRequestRoute = await import('@/app/api/admin/ci6/applications/[profileId]/info-request/route')
const evidenceAdminRoute = await import('@/app/api/admin/ci6/evidence/[evidenceId]/route')
const answerRoute = await import('@/app/api/ci5/reviewers/me/info-requests/[requestId]/answer/route')

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])

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

let applicantId: string
let adminAId: string
let adminBId: string
let applicantProfileId: string
let evidenceId: string
const STORE_ROOT = join(tmp, 'evidence-store')
// Point the service at the test store root via recordEvidenceUpload options;
// the admin streaming route uses the default process.cwd()/db/evidence root,
// so route-level streaming tests write through the route itself.

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const applicant = await client.student.create({ data: { email: `ci6c-applicant-${s}@bean.test`, role: 'STUDENT' } })
  const adminA = await client.student.create({ data: { email: `ci6c-adminA-${s}@bean.test`, role: 'ADMIN' } })
  const adminB = await client.student.create({ data: { email: `ci6c-adminB-${s}@bean.test`, role: 'ADMIN' } })
  applicantId = applicant.id
  adminAId = adminA.id
  adminBId = adminB.id

  const applied = await submitReviewerApplication(
    reviewerDbFromPrisma(client),
    { studentId: applicantId, displayName: 'Applicant' },
    { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', qualificationCategory: 'PhD Physics', institutionAffiliation: 'Example University', consentGranted: true },
  )
  expect(applied.ok).toBe(true)
  applicantProfileId = (applied as { profile: { id: string } }).profile.id

  const ev = await recordEvidenceUpload(
    applicationsDbFromPrisma(client),
    { studentId: applicantId, displayName: 'Applicant' },
    { kind: 'CERTIFICATE', fileName: 'diploma.pdf', bytes: PDF_BYTES },
    { storeRoot: STORE_ROOT },
  )
  if (!ev.ok) console.error('SETUP UPLOAD RESULT:', JSON.stringify(ev))
  expect(ev.ok).toBe(true)
  evidenceId = (ev as { evidence: { id: string } }).evidence.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-6C verification service (honest methods, no self-dealing)', () => {
  test('VERIFIED via DOCUMENT_EXAMINATION requires examined ACTIVE evidence of this profile', async () => {
    const withoutEvidence = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, applicantProfileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      decision: 'VERIFIED',
      reason: 'examined the diploma against the university public registry format',
    })
    expect(withoutEvidence.ok).toBe(false)
    if (!withoutEvidence.ok) expect(withoutEvidence.status).toBe(400)

    const foreign = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, applicantProfileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      evidenceIds: ['ev_does_not_exist'],
      decision: 'VERIFIED',
      reason: 'attempted to reference a non-existent document',
    })
    expect(foreign.ok).toBe(false)
    if (!foreign.ok) expect(foreign.status).toBe(400)

    const ok = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, applicantProfileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      evidenceIds: [evidenceId],
      decision: 'VERIFIED',
      reason: 'document examined: format, signatures and registry number consistent with the issuing institution',
      expiresAt: '2036-01-01T00:00:00.000Z',
    })
    expect(ok.ok).toBe(true)
    const record = (ok as { record: { id: string; decision: string } }).record
    expect(record.decision).toBe('VERIFIED')
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: applicantProfileId, eventType: 'CREDENTIAL_VERIFICATION_RECORDED' } })
    expect(events.length).toBe(1)
    expect(events[0].actorKind).toBe('ADMIN')
    // HARD separation: the lifecycle is untouched by verification.
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: applicantProfileId } })
    expect(profile?.status).toBe('APPLICATION_PENDING')
    expect(profile?.verificationStatus).toBe('UNVERIFIED')
    expect(JSON.parse(profile?.approvedDomains ?? '[]')).toEqual([])
  })

  test('external-check methods require a recorded reference detail', async () => {
    const missing = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, applicantProfileId, {
      credentialType: 'LICENCE',
      issuingInstitution: 'State Board',
      qualificationScope: 'physics teaching',
      verificationMethod: 'PUBLISHED_REGISTRY',
      decision: 'VERIFIED',
      reason: 'claimed registry check without recording the reference',
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.status).toBe(400)
    const ok = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, applicantProfileId, {
      credentialType: 'LICENCE',
      issuingInstitution: 'State Board',
      qualificationScope: 'physics teaching',
      verificationMethod: 'PUBLISHED_REGISTRY',
      referenceDetail: 'State Board public registry, licence no. SB-PHY-2211, status ACTIVE',
      decision: 'VERIFIED',
      reason: 'licence found in the public registry with matching name and scope',
    })
    expect(ok.ok).toBe(true)
  })

  test('self-verification is refused (an administrator cannot verify their own application)', async () => {
    const s = randomUUID().slice(0, 8)
    const adminApplicant = await client.student.create({ data: { email: `ci6c-self-${s}@bean.test`, role: 'ADMIN' } })
    const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: adminApplicant.id, displayName: 'AdminApplicant' }, {
      category: 'DOMAIN_EXPERT',
      conflictOfInterest: 'none declared',
      consentGranted: true,
    })
    expect(applied.ok).toBe(true)
    const profileId = (applied as { profile: { id: string } }).profile.id
    const result = await recordVerification(verificationDbFromPrisma(client), { studentId: adminApplicant.id, displayName: 'AdminApplicant' }, profileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      decision: 'VERIFIED',
      reason: 'self-verification attempt must be refused by the guard',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(403)
  })

  test('forged privileged fields are refused by the strict schema (400)', async () => {
    const forged = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, applicantProfileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      decision: 'VERIFIED',
      reason: 'attempt includes fields the schema must refuse outright',
      status: 'ACTIVE',
      approvedDomains: ['physics', 'engineering'],
      verified: true,
      humanApproved: true,
    })
    expect(forged.ok).toBe(false)
    if (!forged.ok) expect(forged.status).toBe(400)
  })

  test('append-only: corrections are NEW rows (SUPERSEDED), profile state untouched', async () => {
    const recordsBefore = await listVerificationRecords(verificationDbFromPrisma(client), applicantProfileId)
    const sup = await recordVerification(verificationDbFromPrisma(client), { studentId: adminBId, displayName: 'AdminB' }, applicantProfileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      evidenceIds: [evidenceId],
      decision: 'SUPERSEDED',
      reason: 'superseding the earlier examination after the applicant supplied a reissued diploma',
    })
    expect(sup.ok).toBe(true)
    const recordsAfter = await listVerificationRecords(verificationDbFromPrisma(client), applicantProfileId)
    expect(recordsAfter.length).toBe(recordsBefore.length + 1)
    // old rows are preserved verbatim (append-only)
    for (const old of recordsBefore) {
      expect(recordsAfter.find((r) => r.id === old.id)?.decision).toBe(old.decision)
    }
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: applicantProfileId } })
    expect(profile?.status).toBe('APPLICATION_PENDING')
  })

  test('resolveVerificationState: latest record per credentialType governs; expiry honoured', () => {
    const now = new Date()
    const t0 = new Date(now.getTime() - 60_000)
    const t1 = new Date(now.getTime() - 30_000)
    const rec = (id: string, credentialType: string, decision: string, expiresAt: Date | null, createdAt: Date) => ({ id, credentialType, decision, expiresAt, createdAt })
    expect(resolveVerificationState([rec('a', 'DEGREE', 'VERIFIED', null, t0)], now).verified).toBe(true)
    expect(resolveVerificationState([rec('a', 'DEGREE', 'VERIFIED', new Date(now.getTime() - 1000), t0)], now).verified).toBe(false)
    // SUPERSEDED after VERIFIED for the same type — the newest decision governs
    expect(resolveVerificationState([rec('a', 'DEGREE', 'VERIFIED', null, t0), rec('b', 'DEGREE', 'SUPERSEDED', null, t1)], now).verifiedRecordIds).toEqual([])
    expect(resolveVerificationState([rec('a', 'DEGREE', 'REJECTED', null, t0)], now).verified).toBe(false)
    expect(resolveVerificationState([rec('a', 'LICENCE', 'NEEDS_MORE_EVIDENCE', null, t0)], now).latestDecision).toBe('NEEDS_MORE_EVIDENCE')
    // different credential types are independent
    const mixed = resolveVerificationState([
      rec('a', 'DEGREE', 'VERIFIED', null, t0),
      rec('b', 'LICENCE', 'VERIFIED', new Date(now.getTime() - 1000), t1),
    ], now)
    expect(mixed.verified).toBe(true)
    expect(mixed.verifiedRecordIds).toEqual(['a'])
  })

  test('verification on a terminal application is refused 409', async () => {
    const s = randomUUID().slice(0, 8)
    const gone = await client.student.create({ data: { email: `ci6c-gone-${s}@bean.test`, role: 'STUDENT' } })
    const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: gone.id, displayName: 'Gone' }, {
      category: 'DOMAIN_EXPERT',
      conflictOfInterest: 'none declared',
      consentGranted: true,
    })
    const profileId = (applied as { profile: { id: string } }).profile.id
    await client.expertReviewerProfile.update({ where: { id: profileId }, data: { status: 'WITHDRAWN' } })
    const result = await recordVerification(verificationDbFromPrisma(client), { studentId: adminAId, displayName: 'AdminA' }, profileId, {
      credentialType: 'DEGREE',
      issuingInstitution: 'Example University',
      qualificationScope: 'physics',
      verificationMethod: 'DOCUMENT_EXAMINATION',
      evidenceIds: [evidenceId],
      decision: 'VERIFIED',
      reason: 'verification on a withdrawn application must be refused',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })
})

describe('CI-6C routes (admin-only, evidence restricted)', () => {
  test('queue: admin-only; lists open applications with account association; filter works', async () => {
    setSession(null)
    expect((await queueRoute.GET(req('/api/admin/ci6/applications'))).status).toBe(401)
    setSession(applicantId, 'STUDENT')
    expect((await queueRoute.GET(req('/api/admin/ci6/applications'))).status).toBe(403)
    setSession(adminAId, 'ADMIN')
    const res = await queueRoute.GET(req('/api/admin/ci6/applications?status=APPLICATION_PENDING'))
    expect(res.status).toBe(200)
    const body = await json(res)
    const q = (body as { queue: QueueItem[] }).queue
    expect(q.length).toBeGreaterThan(0)
    const mine = q.find((x) => x.profileId === applicantProfileId)
    expect(mine?.account?.email).toContain('@bean.test')
    expect(mine?.verification.verified).toBe(true)
    expect(JSON.stringify(body)).not.toContain('storagePath')
    expect(JSON.stringify(body)).not.toContain('diploma-content')
  })

  test('detail route: admin-only; exposes account + metadata, never file bytes/paths', async () => {
    setSession(applicantId, 'STUDENT')
    const r403 = await detailRoute.GET(req(`/api/admin/ci6/applications/${applicantProfileId}`), { params: Promise.resolve({ profileId: applicantProfileId }) } as never)
    expect(r403.status).toBe(403)
    setSession(adminAId, 'ADMIN')
    const res = await detailRoute.GET(req(`/api/admin/ci6/applications/${applicantProfileId}`), { params: Promise.resolve({ profileId: applicantProfileId }) } as never)
    expect(res.status).toBe(200)
    const body = await json(res)
    const d = body as unknown as WorkbenchShape
    expect(d.account?.email).toContain('@bean.test')
    expect(d.evidence.length).toBe(1)
    expect(JSON.stringify(body)).not.toContain('storagePath')
    expect(JSON.stringify(body)).not.toContain('diploma.pdf-content')
    expect(d.verificationRecords.length).toBe(3)
    expect(d.profile.status).toBe('APPLICATION_PENDING')
  })

  test('admin evidence streaming: 200 for ACTIVE, 410 for purged, 404 missing, 403 applicant, 401 anonymous', async () => {
    // Write through the ROUTE path (default store root) so the file exists.
    const routeForm = new FormData()
    routeForm.append('kind', 'CERTIFICATE')
    routeForm.append('file', new File([PDF_BYTES], 'cert.pdf', { type: 'application/pdf' }))
    setSession(applicantId, 'STUDENT')
    const { default: nope } = await import('@/lib/auth')
    void nope
    // applicant upload via the applicant route (session mocked)
    const evidenceRoute = await import('@/app/api/ci5/reviewers/me/evidence/route')
    const upload = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: routeForm }) as unknown as NextRequest)
    expect(upload.status).toBe(201)
    const upBody = await json(upload)
    const routeEvidenceId = (upBody as { evidence: { id: string } }).evidence.id

    setSession(null)
    expect((await evidenceAdminRoute.GET(req(`/api/admin/ci6/evidence/${routeEvidenceId}`), { params: Promise.resolve({ evidenceId: routeEvidenceId }) } as never)).status).toBe(401)
    setSession(applicantId, 'STUDENT')
    expect((await evidenceAdminRoute.GET(req(`/api/admin/ci6/evidence/${routeEvidenceId}`), { params: Promise.resolve({ evidenceId: routeEvidenceId }) } as never)).status).toBe(403)
    setSession(adminAId, 'ADMIN')
    const okRes = await evidenceAdminRoute.GET(req(`/api/admin/ci6/evidence/${routeEvidenceId}`), { params: Promise.resolve({ evidenceId: routeEvidenceId }) } as never)
    expect(okRes.status).toBe(200)
    expect(okRes.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await evidenceAdminRoute.GET(req('/api/admin/ci6/evidence/ev_missing'), { params: Promise.resolve({ evidenceId: 'ev_missing' }) } as never)).status).toBe(404)
    // purge then expect 410
    await client.expertCredentialEvidence.update({ where: { id: routeEvidenceId }, data: { retentionState: 'PURGED' } })
    expect((await evidenceAdminRoute.GET(req(`/api/admin/ci6/evidence/${routeEvidenceId}`), { params: Promise.resolve({ evidenceId: routeEvidenceId }) } as never)).status).toBe(410)
  })

  test('verification route: non-admin 403; forged fields 400; success 201 appends record', async () => {
    setSession(applicantId, 'STUDENT')
    const r403 = await verifyRoute.POST(req(`/api/admin/ci6/applications/${applicantProfileId}/verification`, { method: 'POST', body: { credentialType: 'DEGREE', issuingInstitution: 'X University', qualificationScope: 'physics', verificationMethod: 'DOCUMENT_EXAMINATION', evidenceIds: [evidenceId], decision: 'VERIFIED', reason: 'non-admin attempt must be refused' } }), { params: Promise.resolve({ profileId: applicantProfileId }) } as never)
    expect(r403.status).toBe(403)
    setSession(adminBId, 'ADMIN')
    const forged = await verifyRoute.POST(req(`/api/admin/ci6/applications/${applicantProfileId}/verification`, { method: 'POST', body: { credentialType: 'DEGREE', issuingInstitution: 'X University', qualificationScope: 'physics', verificationMethod: 'DOCUMENT_EXAMINATION', decision: 'VERIFIED', reason: 'forged fields', verificationStatus: 'REFERENCED_VERIFIED' } }), { params: Promise.resolve({ profileId: applicantProfileId }) } as never)
    expect(forged.status).toBe(400)
    const ok = await verifyRoute.POST(req(`/api/admin/ci6/applications/${applicantProfileId}/verification`, { method: 'POST', body: { credentialType: 'CERTIFICATION', issuingInstitution: 'Board of Education', qualificationScope: 'mathematics teaching', verificationMethod: 'ISSUING_BODY_REFERENCE', referenceDetail: 'phone verification with the board office, ref BOE-9911', decision: 'VERIFIED', reason: 'issuing body confirmed the certification by phone on record' } }), { params: Promise.resolve({ profileId: applicantProfileId }) } as never)
    expect(ok.status).toBe(201)
    const body = await json(ok)
    expect((body as { record: { decision: string } }).record.decision).toBe('VERIFIED')
  })

  test('info-request route (admin) links to the applicant answer route (CI-6B)', async () => {
    setSession(adminAId, 'ADMIN')
    const created = await infoRequestRoute.POST(req(`/api/admin/ci6/applications/${applicantProfileId}/info-request`, { method: 'POST', body: { requestText: 'Please upload the transcript for the stated doctorate degree.' } }), { params: Promise.resolve({ profileId: applicantProfileId }) } as never)
    expect(created.status).toBe(201)
    const body = await json(created)
    const requestId = (body as { request: { id: string } }).request.id
    setSession(applicantId, 'STUDENT')
    const answered = await answerRoute.POST(req(`/api/ci5/reviewers/me/info-requests/${requestId}/answer`, { method: 'POST', body: { responseText: 'Transcript uploaded; registry reference TR-77123.' } }), { params: Promise.resolve({ requestId }) } as never)
    expect(answered.status).toBe(200)
  })
})

describe('CI-6C source guard', () => {
  test('workbench UI calls the real APIs and contains no mock identifiers', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/components/bean/ci6-verification-workbench.tsx', 'utf8'))
    expect(src).toContain('/api/admin/ci6/applications')
    expect(src).toContain('/api/admin/ci6/evidence/')
    expect(src).not.toMatch(/mockData|fakeMetrics|MOCK_REVIEWERS|sampleReviewers/i)
  })

  test('admin governance panel registers the verification tab additively', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/components/bean/ci5-reviewer-governance.tsx', 'utf8'))
    expect(src).toContain("id: 'verification'")
    expect(src).toContain('Ci6VerificationWorkbench')
  })
})

interface WorkbenchShape {
  profile: { id: string; status: string }
  account: { email: string } | null
  evidence: { id: string }[]
  verificationRecords: unknown[]
}

// keep statSync import used (store-root assertion lives in CI-6B suite)
void statSync
void existsSync
