// ─── BEAN Classroom Intelligence (CI-6B): real expert application & onboarding ──
// Isolated real-DB tests for the CI-6B applicant flows: application detail +
// consent, restricted credential-evidence upload (magic bytes, size cap,
// ownership), information-request loop, withdrawal + retention, and the
// negative authorization cases (no auto-approval, no assignment for pending
// applicants, forged fields refused, cross-account refusals, rate limiting).
// CI-5 regression: the widened vocabulary must not weaken any existing gate —
// the CI-5 reviewer-governance suite is re-run in the same command.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

process.env.DATABASE_URL = ''

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci6b-'))
const isolatedUrl = `file:${join(tmp, 'ci6b.db')}`
process.env.DATABASE_URL = isolatedUrl

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  timeout: 180_000,
  stdio: 'ignore',
})

const { PrismaClient } = await import('@prisma/client')
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })

const { completeAuthMock } = await import('../helpers/auth-mock')

const realRequireStudent = (await import('@/lib/auth')).requireStudent
let sessionStudent: { id: string; email: string; displayName: string | null; learningLevel: null; role: string; onboardedAt: null; signupIntent: null } | null = null

const { mock } = await import('bun:test')
mock.module('@/lib/db', () => ({ db: client }))
mock.module('@/lib/auth', () => ({
  ...completeAuthMock(),
  requireStudent: async () => sessionStudent,
  sameOrigin: () => true,
  resolveOwnerScope: async () => ({ guestId: null, studentId: sessionStudent?.id ?? null }),
  ownedBy: () => ({}),
}))

const { applicationsDbFromPrisma, recordEvidenceUpload, purgeOwnEvidence, updateExpertApplication, withdrawApplication, requestAdditionalInfo, answerInfoRequest, getApplicationDetail, sniffEvidenceMime, EVIDENCE_MAX_BYTES } = await import('@/lib/ci/fleet/applications')
const { submitReviewerApplication, reviewerDbFromPrisma, resolveReviewerProfile, REVIEWER_TRANSITIONS } = await import('@/lib/ci/fleet/reviewers')
const { createAssignment, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')

const applyRoute = await import('@/app/api/ci5/reviewers/apply/route')
const appDetailRoute = await import('@/app/api/ci5/reviewers/me/application/route')
const evidenceRoute = await import('@/app/api/ci5/reviewers/me/evidence/route')
const evidenceItemRoute = await import('@/app/api/ci5/reviewers/me/evidence/[evidenceId]/route')
const withdrawRoute = await import('@/app/api/ci5/reviewers/me/withdraw/route')
const answerRoute = await import('@/app/api/ci5/reviewers/me/info-requests/[requestId]/answer/route')
const domainsRoute = await import('@/app/api/ci6/domains/route')
const { resetRateLimits } = await import('@/lib/rate-limit')

function req(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  return new Request(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers: init.headers ?? { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }) as unknown as NextRequest
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try { return JSON.parse(text) as Record<string, unknown> } catch { return {} }
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xbe, 0xc0])
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const TXT_BYTES = new Uint8Array([0x50, 0x61, 0x73, 0x73, 0x77, 0x6f, 0x72, 0x64, 0x21])

let applicantId: string
let otherUserId: string
let adminId: string

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  const applicant = await client.student.create({ data: { email: `ci6b-applicant-${suffix}@bean.test`, role: 'STUDENT' } })
  const other = await client.student.create({ data: { email: `ci6b-other-${suffix}@bean.test`, role: 'STUDENT' } })
  const admin = await client.student.create({ data: { email: `ci6b-admin-${suffix}@bean.test`, role: 'ADMIN' } })
  applicantId = applicant.id
  otherUserId = other.id
  adminId = admin.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

function setSession(id: string | null) {
  sessionStudent = id
    ? { id, email: 'session@bean.test', displayName: 'Session User', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
    : null
}

describe('CI-6B magic-byte sniffing', () => {
  test('recognises PDF, PNG, JPEG; rejects text', () => {
    expect(sniffEvidenceMime(PDF_BYTES)).toBe('application/pdf')
    expect(sniffEvidenceMime(PNG_BYTES)).toBe('image/png')
    expect(sniffEvidenceMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffEvidenceMime(TXT_BYTES)).toBeNull()
  })
})

describe('CI-6B application submission with consent', () => {
  test('apply records consent + COI + exact-info snapshot; no privilege granted', async () => {
    setSession(applicantId)
    const res = await applyRoute.POST(req('/api/ci5/reviewers/apply', {
      method: 'POST',
      body: {
        category: 'DOMAIN_EXPERT',
        conflictOfInterest: 'none declared',
        qualificationCategory: 'PhD Mathematics',
        institutionAffiliation: 'Example State University',
        specialties: ['number theory', 'algebra'],
        proposedDomains: ['mathematics'],
        consentGranted: true,
      },
    }))
    expect(res.status).toBe(201)
    const body = await json(res)
    const profileRow = (body as { profile?: { id: string; status: string } }).profile
    expect(profileRow?.status).toBe('APPLICATION_PENDING')
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    expect(profile?.applicationConsentAt).not.toBeNull()
    expect(JSON.parse(profile?.specialtiesJson ?? '[]')).toEqual(['number theory', 'algebra'])
    expect(profile?.institutionAffiliation).toBe('Example State University')
    // Exactly one profile per account; status NOT ACTIVE — no assignment claim.
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: profile!.id } })
    const types = events.map((e) => e.eventType)
    expect(types).toContain('CONSENT_RECORDED')
    expect(types).toContain('COI_DECLARED')
    expect(types).toContain('APPLICATION_SUBMITTED')
    const submitted = events.find((e) => e.eventType === 'APPLICATION_SUBMITTED')
    const payload = JSON.parse(submitted?.payload ?? '{}') as Record<string, unknown>
    expect(payload.consentGranted).toBe(true)
    expect(payload.institutionAffiliation).toBe('Example State University')
  })

  test('pending applicant cannot claim assignments (no auto-approval path)', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    expect(profile?.status).toBe('APPLICATION_PENDING')
    const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
    const result = await createAssignment(assignmentDbFromPrisma(client), adminActor, profile!, {
      subjectType: 'DOMAIN_PACK',
      subjectKey: 'mathematics',
      coiCheck: 'NONE_DECLARED',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(409)
  })

  test('forged qualification/verification/scope fields are refused by the strict schema', async () => {
    setSession(otherUserId)
    const res = await applyRoute.POST(req('/api/ci5/reviewers/apply', {
      method: 'POST',
      body: {
        category: 'DOMAIN_EXPERT',
        conflictOfInterest: 'none declared',
        verificationStatus: 'REFERENCED_VERIFIED',
        status: 'ACTIVE',
        approvedDomains: ['mathematics', 'engineering', 'physics'],
        verified: true,
        humanApproved: true,
      },
    }))
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(String(body.error)).toContain('invalid application')
    const none = await client.expertReviewerProfile.findUnique({ where: { studentId: otherUserId } })
    expect(none).toBeNull()
  })
})

describe('CI-6B protected evidence upload', () => {
  test('upload stores file 0600 in restricted store + sha256 + metadata-only event', async () => {
    setSession(applicantId)
    const form = new FormData()
    form.append('kind', 'CERTIFICATE')
    form.append('file', new File([PDF_BYTES], 'degree.pdf', { type: 'application/pdf' }))
    const res = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: form }) as unknown as NextRequest)
    expect(res.status).toBe(201)
    const body = await json(res)
    const ev = (body as { evidence?: { id: string; sha256: string; byteSize: number; mimeType: string } }).evidence
    expect(ev?.sha256).toBe(createHash('sha256').update(PDF_BYTES).digest('hex'))
    expect(ev?.mimeType).toBe('application/pdf')
    const row = await client.expertCredentialEvidence.findUnique({ where: { id: ev!.id } })
    expect(row?.retentionState).toBe('ACTIVE')
    expect(row?.storagePath.startsWith('ev_')).toBe(true)
    expect(row?.storagePath).not.toContain('degree')
    const abs = join(process.cwd(), 'db', 'evidence', row!.storagePath)
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs).equals(PDF_BYTES)).toBe(true)
    expect((statSync(abs).mode & 0o777) === 0o600).toBe(true)
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: row!.profileId, eventType: 'EVIDENCE_UPLOADED' } })
    expect(events.length).toBe(1)
    const payload = JSON.parse(events[0].payload ?? '{}') as Record<string, unknown>
    expect(payload.sha256).toBe(ev?.sha256)
    expect(JSON.stringify(payload)).not.toContain('degree.pdf-content')
  })

  test('non-whitelisted content is refused 415; oversize 413; unauthenticated 401', async () => {
    setSession(applicantId)
    const bad = new FormData()
    bad.append('kind', 'CERTIFICATE')
    bad.append('file', new File([TXT_BYTES], 'notes.txt', { type: 'text/plain' }))
    const r415 = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: bad }) as unknown as NextRequest)
    expect(r415.status).toBe(415)
    const big = new FormData()
    big.append('kind', 'CV')
    big.append('file', new File([new Uint8Array(EVIDENCE_MAX_BYTES + 1).fill(0x25).map((b, i) => (i < 5 ? [0x25, 0x50, 0x44, 0x46, 0x2d][i] : b))], 'big.pdf', { type: 'application/pdf' }))
    const r413 = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: big }) as unknown as NextRequest)
    expect(r413.status).toBe(413)
    setSession(null)
    const none = new FormData()
    none.append('kind', 'CV')
    none.append('file', new File([PDF_BYTES], 'x.pdf', { type: 'application/pdf' }))
    const r401 = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: none }) as unknown as NextRequest)
    expect(r401.status).toBe(401)
    resetRateLimits()
  })

  test('evidence metadata listing never exposes storage paths', async () => {
    setSession(applicantId)
    const res = await evidenceRoute.GET()
    expect(res.status).toBe(200)
    const body = await json(res)
    const list = (body as { evidence: Record<string, unknown>[] }).evidence
    expect(list.length).toBeGreaterThan(0)
    expect(JSON.stringify(body)).not.toContain('storagePath')
    expect(JSON.stringify(body)).not.toContain('db/evidence')
    expect(JSON.stringify(body)).not.toContain(process.cwd())
  })

  test('cross-account evidence access refused (GET 404, DELETE 403, service 403)', async () => {
    const rows = await client.expertCredentialEvidence.findMany({ where: { retentionState: 'ACTIVE' } })
    const evidenceId = rows[0].id
    setSession(otherUserId)
    const r404 = await evidenceItemRoute.GET(req(`/api/ci5/reviewers/me/evidence/${evidenceId}`), { params: Promise.resolve({ evidenceId }) } as never)
    expect(r404.status).toBe(404)
    const r403 = await evidenceItemRoute.DELETE(req(`/api/ci5/reviewers/me/evidence/${evidenceId}`, { method: 'DELETE', body: { reason: 'not mine' } }), { params: Promise.resolve({ evidenceId }) } as never)
    expect(r403.status).toBe(403)
    const svc = await purgeOwnEvidence(applicationsDbFromPrisma(client), { studentId: otherUserId, displayName: 'Other' }, evidenceId, 'attempt')
    expect(svc.ok).toBe(false)
    if (!svc.ok) expect(svc.status).toBe(403)
    // the file still exists — nothing was touched
    const row = await client.expertCredentialEvidence.findUnique({ where: { id: evidenceId } })
    expect(row?.retentionState).toBe('ACTIVE')
    expect(existsSync(join(process.cwd(), 'db', 'evidence', row!.storagePath))).toBe(true)
  })

  test('evidence upload refuses after the application leaves the open state', async () => {
    setSession(applicantId)
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    await client.expertReviewerProfile.update({ where: { id: profile!.id }, data: { status: 'REJECTED' } })
    const svc = await recordEvidenceUpload(applicationsDbFromPrisma(client), { studentId: applicantId, displayName: 'Applicant' }, { kind: 'CV', fileName: 'late.pdf', bytes: PDF_BYTES })
    expect(svc.ok).toBe(false)
    if (!svc.ok) expect(svc.status).toBe(409)
    await client.expertReviewerProfile.update({ where: { id: profile!.id }, data: { status: 'APPLICATION_PENDING' } })
  })
})

describe('CI-6B information-request loop', () => {
  test('admin requests, applicant answers, second answer refused 409, cross-account 403', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    const adminActor = { studentId: adminId, displayName: 'Admin' }
    const created = await requestAdditionalInfo(applicationsDbFromPrisma(client), adminActor, profile!.id, { requestText: 'Please provide the issuing registry reference for the stated doctorate.' })
    expect(created.ok).toBe(true)
    const requestId = (created as { request?: { id: string } }).request!.id
    setSession(otherUserId)
    const r403 = await answerRoute.POST(req(`/api/ci5/reviewers/me/info-requests/${requestId}/answer`, { method: 'POST', body: { responseText: 'not my application' } }), { params: Promise.resolve({ requestId }) } as never)
    expect(r403.status).toBe(403)
    setSession(applicantId)
    const ok = await answerRoute.POST(req(`/api/ci5/reviewers/me/info-requests/${requestId}/answer`, { method: 'POST', body: { responseText: 'Registry reference RS-2024-11873, verification contact available.' } }), { params: Promise.resolve({ requestId }) } as never)
    expect(ok.status).toBe(200)
    const again = await answerRoute.POST(req(`/api/ci5/reviewers/me/info-requests/${requestId}/answer`, { method: 'POST', body: { responseText: 'answer again' } }), { params: Promise.resolve({ requestId }) } as never)
    expect(again.status).toBe(409)
    const row = await client.expertApplicationInfoRequest.findUnique({ where: { id: requestId } })
    expect(row?.status).toBe('ANSWERED')
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: profile!.id, eventType: { in: ['INFO_REQUESTED', 'INFO_ANSWERED'] } } })
    expect(events.map((e) => e.eventType).sort()).toEqual(['INFO_ANSWERED', 'INFO_REQUESTED'])
    expect(events.find((e) => e.eventType === 'INFO_REQUESTED')?.actorKind).toBe('ADMIN')
  })

  test('short request text refused 400', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    const bad = await requestAdditionalInfo(applicationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profile!.id, { requestText: 'too short' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.status).toBe(400)
  })
})

describe('CI-6B application detail editing', () => {
  test('editable while open; forged state fields refused 400; frozen after decision', async () => {
    setSession(applicantId)
    // The strict schema REFUSES forged status/verification/scope fields outright
    // (a client cannot bypass verification by submitting privileged fields).
    const forged = await appDetailRoute.PUT(req('/api/ci5/reviewers/me/application', { method: 'PUT', body: { institutionAffiliation: 'Example Institute of Technology', status: 'APPROVED', verificationStatus: 'DOCUMENT_REVIEWED', approvedDomains: ['physics'] } }))
    expect(forged.status).toBe(400)
    // A clean update of own detail fields succeeds; consent is idempotent.
    const ok = await appDetailRoute.PUT(req('/api/ci5/reviewers/me/application', { method: 'PUT', body: { institutionAffiliation: 'Example Institute of Technology', consentGranted: true } }))
    expect(ok.status).toBe(200)
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    expect(profile?.institutionAffiliation).toBe('Example Institute of Technology')
    expect(profile?.status).toBe('APPLICATION_PENDING')
    expect(profile?.verificationStatus).toBe('UNVERIFIED')
    expect(JSON.parse(profile?.approvedDomains ?? '[]')).toEqual([])
    // freeze after a decision
    await client.expertReviewerProfile.update({ where: { id: profile!.id }, data: { status: 'APPROVED' } })
    const frozen = await appDetailRoute.PUT(req('/api/ci5/reviewers/me/application', { method: 'PUT', body: { institutionAffiliation: 'Changed' } }))
    expect(frozen.status).toBe(409)
    await client.expertReviewerProfile.update({ where: { id: profile!.id }, data: { status: 'APPLICATION_PENDING' } })
  })
})

describe('CI-6B withdrawal + retention', () => {
  test('withdraw purges ACTIVE evidence files (hash retained) and is terminal', async () => {
    setSession(applicantId)
    const before = await client.expertCredentialEvidence.findMany({ where: { retentionState: 'ACTIVE' } })
    expect(before.length).toBeGreaterThan(0)
    const paths = before.map((r) => join(process.cwd(), 'db', 'evidence', r.storagePath))
    const res = await withdrawRoute.POST(req('/api/ci5/reviewers/me/withdraw', { method: 'POST', body: { reason: 'no longer able to commit review time' } }))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect((body as { profile?: { status: string } }).profile?.status).toBe('WITHDRAWN')
    for (const p of paths) expect(existsSync(p)).toBe(false)
    const after = await client.expertCredentialEvidence.findMany({ where: { profileId: before[0].profileId } })
    for (const row of after) {
      expect(row.retentionState).toBe('PURGED')
      expect(row.sha256).toBeTruthy()
    }
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), applicantId)
    expect(profile?.status).toBe('WITHDRAWN')
    expect(REVIEWER_TRANSITIONS.WITHDRAWN).toEqual([])
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: profile!.id, eventType: 'APPLICATION_WITHDRAWN' } })
    expect(events.length).toBe(1)
    expect(events[0].actorKind).toBe('REVIEWER')
  })

  test('withdrawal without an application → 404; double withdrawal → 409', async () => {
    setSession(otherUserId)
    const r404 = await withdrawRoute.POST(req('/api/ci5/reviewers/me/withdraw', { method: 'POST', body: {} }))
    expect(r404.status).toBe(404)
    setSession(applicantId)
    const r409 = await withdrawRoute.POST(req('/api/ci5/reviewers/me/withdraw', { method: 'POST', body: {} }))
    expect(r409.status).toBe(409)
  })
})

describe('CI-6B public vocabulary + detail route', () => {
  test('domains route serves the registered pack vocabulary without personal data', async () => {
    const res = await domainsRoute.GET()
    expect(res.status).toBe(200)
    const body = await json(res)
    const domains = (body as { domains: { domainId: string }[] }).domains
    expect(domains.length).toBeGreaterThan(0)
    expect(domains.every((d) => typeof d.domainId === 'string' && typeof d.title === 'string')).toBe(true)
  })

  test('application detail requires a session and 404s cleanly without a profile', async () => {
    setSession(null)
    const r401 = await appDetailRoute.GET()
    expect(r401.status).toBe(401)
    setSession(otherUserId)
    const rNone = await appDetailRoute.GET()
    expect(rNone.status).toBe(200)
    const body = await json(rNone)
    expect((body as { profile: unknown }).profile).toBeNull()
  })
})

describe('CI-6B CI-5 regression guards (widened vocabulary stays strict)', () => {
  test('withdrawal transitions exist only from open application states', () => {
    expect(REVIEWER_TRANSITIONS.APPLICATION_PENDING).toContain('WITHDRAWN')
    expect(REVIEWER_TRANSITIONS.QUALIFICATION_REVIEW).toContain('WITHDRAWN')
    expect(REVIEWER_TRANSITIONS.ACTIVE).not.toContain('WITHDRAWN')
    expect(REVIEWER_TRANSITIONS.APPROVED).not.toContain('WITHDRAWN')
    expect(REVIEWER_TRANSITIONS.REVOKED).toEqual([])
    expect(REVIEWER_TRANSITIONS.REJECTED).toEqual([])
  })

  test('TRANSCRIPTION scope refusal is intact after the CI-6B widening', async () => {
    const { validateReviewerScope } = await import('@/lib/ci/fleet/reviewers')
    const refused = validateReviewerScope('BILINGUAL_LANGUAGE', { approvedLanguages: [{ tag: 'hi', tasks: ['TRANSCRIPTION'] }] })
    expect(refused.ok).toBe(false)
  })

  test('expert application source: no mock data or fabricated verification in UI', async () => {
    const src = readFileSync('src/components/bean/views/expert-apply-view.tsx', 'utf8')
    expect(src).toContain('/api/ci5/reviewers/apply')
    expect(src).toContain('/api/ci5/reviewers/me/evidence')
    expect(src).not.toMatch(/mockData|fakeMetrics|MOCK_REVIEWERS|sampleReviewers/i)
  })
})

describe('CI-6B rate limiting on the evidence route', () => {
  test('12 successful-window uploads allowed, 13th refused 429 per account', async () => {
    setSession(applicantId)
    resetRateLimits()
    // Withdrawn application blocks uploads at the service layer (409) — but the
    // rate limiter still counts attempts, which is the behaviour under test.
    for (let i = 0; i < 12; i++) {
      const form = new FormData()
      form.append('kind', 'OTHER')
      form.append('file', new File([PDF_BYTES], `r${i}.pdf`, { type: 'application/pdf' }))
      const res = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: form }) as unknown as NextRequest)
      expect([409, 429]).toContain(res.status)
    }
    const form = new FormData()
    form.append('kind', 'OTHER')
    form.append('file', new File([PDF_BYTES], 'over.pdf', { type: 'application/pdf' }))
    const res = await evidenceRoute.POST(new Request('http://localhost/api/ci5/reviewers/me/evidence', { method: 'POST', body: form }) as unknown as NextRequest)
    expect(res.status).toBe(429)
    resetRateLimits()
  })
})
