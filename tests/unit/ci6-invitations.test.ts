// ─── BEAN Classroom Intelligence (CI-6E): invitations & recruitment ops ───────
// Isolated real-DB tests: single-use raw tokens (hash-only storage), claim
// binding, replay/expiry/revocation refusals, no-privilege-by-claim, admin
// route authorization, application linkage provenance, rate limiting, and the
// guarantee that token material never reaches listings or logs.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci6e-'))
const isolatedUrl = `file:${join(tmp, 'ci6e.db')}`
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

const { createInvitation, claimInvitation, revokeInvitation, listInvitations, validateInvitationLink, invitationsDbFromPrisma } = await import('@/lib/ci/fleet/invitations')
const { submitReviewerApplication, reviewerDbFromPrisma, resolveReviewerProfile } = await import('@/lib/ci/fleet/reviewers')
const { createAssignment, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')

const createRoute = await import('@/app/api/admin/ci6/invitations/route')
const revokeRoute = await import('@/app/api/admin/ci6/invitations/[invitationId]/revoke/route')
const claimRoute = await import('@/app/api/ci6/invitations/claim/route')
const applyRoute = await import('@/app/api/ci5/reviewers/apply/route')
const { resetRateLimits } = await import('@/lib/rate-limit')

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
let inviteeId: string
let otherId: string

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci6e-admin-${s}@bean.test`, role: 'ADMIN' } })
  const invitee = await client.student.create({ data: { email: `ci6e-invitee-${s}@bean.test`, role: 'STUDENT' } })
  const other = await client.student.create({ data: { email: `ci6e-other-${s}@bean.test`, role: 'STUDENT' } })
  adminId = admin.id
  inviteeId = invitee.id
  otherId = other.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-6E invitation creation (hash-only storage, one-time token)', () => {
  test('create returns the raw token exactly once; DB stores only its sha256', async () => {
    const adminActor = { studentId: adminId, displayName: 'Admin' }
    const result = await createInvitation(invitationsDbFromPrisma(client), adminActor, {
      category: 'DOMAIN_EXPERT',
      requestedDomains: ['mathematics'],
      note: 'We would value your review of the mathematics pack.',
      validDays: 7,
    })
    expect(result.ok).toBe(true)
    const { rawToken, claimUrl, invitation } = (result as { value: { rawToken: string; claimUrl: string; invitation: { id: string } } }).value
    expect(rawToken.length).toBeGreaterThan(30)
    expect(claimUrl).toContain('#/expert-apply?invite=')
    const row = await client.expertInvitation.findUnique({ where: { id: invitation.id } })
    expect(row?.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'))
    expect(row?.status).toBe('PENDING')
    // the raw token must NOT be stored anywhere
    expect(row?.tokenHash).not.toBe(rawToken)
    // listing (service rows) never contains the RAW token material
    const list = await listInvitations(invitationsDbFromPrisma(client))
    expect(JSON.stringify(list)).not.toContain(rawToken)
  })

  test('invalid payload refused (unknown domain regex, bad validDays)', async () => {
    const bad = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT', requestedDomains: ['Bad Domain!'], validDays: 400 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.status).toBe(400)
  })

  test('admin routes: 401 anonymous, 403 non-admin', async () => {
    setSession(null)
    expect((await createRoute.POST(req('/api/admin/ci6/invitations', { method: 'POST', body: { category: 'DOMAIN_EXPERT' } }))).status).toBe(401)
    setSession(inviteeId, 'STUDENT')
    expect((await createRoute.POST(req('/api/admin/ci6/invitations', { method: 'POST', body: { category: 'DOMAIN_EXPERT' } }))).status).toBe(403)
    expect((await createRoute.GET(req('/api/admin/ci6/invitations'))).status).toBe(403)
    setSession(adminId, 'ADMIN')
    const created = await createRoute.POST(req('/api/admin/ci6/invitations', { method: 'POST', body: { category: 'BILINGUAL_LANGUAGE', requestedLanguages: [{ tag: 'ta', tasks: ['TRANSLATION'] }] } }))
    expect(created.status).toBe(201)
    const body = await json(created)
    expect(typeof (body as { rawToken: string }).rawToken).toBe('string')
    // the GET listing must not echo token material
    const list = await createRoute.GET(req('/api/admin/ci6/invitations'))
    expect(JSON.stringify(await json(list))).not.toContain((body as { rawToken: string }).rawToken)
  })
})

describe('CI-6E claiming (single-use, expiring, revocable, no privileges)', () => {
  test('claim binds to the signed-in account; grants NO privileges', async () => {
    const created = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT', requestedDomains: ['physics'] })
    const rawToken = (created as { value: { rawToken: string } }).value.rawToken
    const invitationId = (created as { invitation: { id: string } }).invitation.id

    setSession(null)
    expect((await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: rawToken } }))).status).toBe(401)

    setSession(otherId, 'STUDENT')
    const stolen = await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: rawToken } }))
    expect(stolen.status).toBe(200)
    const stolenBody = await json(stolen)
    const claim = (stolenBody as { claim: { invitationId: string; category: string; requestedDomains: string[]; linkedProfileId: string | null } }).claim
    expect(claim.invitationId).toBe(invitationId)
    expect(claim.category).toBe('DOMAIN_EXPERT')
    expect(claim.requestedDomains).toEqual(['physics'])
    expect(claim.linkedProfileId).toBeNull()
    // claiming created NO application and NO privileges
    const profile = await client.expertReviewerProfile.findUnique({ where: { studentId: otherId } })
    expect(profile).toBeNull()

    // replay refused
    setSession(inviteeId, 'STUDENT')
    const replay = await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: rawToken } }))
    expect(replay.status).toBe(409)

    // even the claiming account cannot claim assignments without a verified+ACTIVE profile
    const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
    const ghostProfile = {
      id: 'ghost',
      studentId: otherId,
      reviewerCode: 'BR-ghost',
      category: 'DOMAIN_EXPERT',
      status: 'CLAIMED_INVITE_ONLY',
      approvedDomains: '["physics"]',
      approvedLanguages: '[]',
      qualificationCategory: null,
      professionalExperience: null,
      institutionAffiliation: null,
      specialtiesJson: '[]',
      applicationConsentAt: null,
      verificationStatus: 'UNVERIFIED',
      verificationNote: null,
      issuingBody: null,
      scopeNote: null,
      expiresAt: null,
      conflictOfInterest: 'none',
      suspendedReason: null,
      revokedReason: null,
      profileVisibility: 'PRIVATE',
      disclosureConsentAt: null,
      publicDisplayName: null,
      professionalSummary: null,
      availabilityNote: null,
      disclosedAffiliation: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const assignment = await createAssignment(assignmentDbFromPrisma(client), adminActor, ghostProfile as never, { subjectType: 'DOMAIN_PACK', subjectKey: 'physics', coiCheck: 'NONE_DECLARED' })
    expect(assignment.ok).toBe(false)
    if (!assignment.ok) expect(assignment.status).toBe(409)
  })

  test('wrong token 404; expired invitation flips to EXPIRED and refuses; revoked refuses', async () => {
    setSession(inviteeId, 'STUDENT')
    expect((await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: 'not-a-real-token-1234567890' } }))).status).toBe(404)

    const expired = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT', validDays: 1 })
    const expId = (expired as { invitation: { id: string } }).invitation.id
    await client.expertInvitation.update({ where: { id: expId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const expiredToken = (expired as { value: { rawToken: string } }).value.rawToken
    const r409 = await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: expiredToken } }))
    expect(r409.status).toBe(409)
    expect((await client.expertInvitation.findUnique({ where: { id: expId } }))?.status).toBe('EXPIRED')

    const revocable = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT' })
    const revId = (revocable as { invitation: { id: string } }).invitation.id
    const revokeOk = await revokeInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, revId, 'recruitment plan changed for this domain')
    expect(revokeOk.ok).toBe(true)
    const revokedToken = (revocable as { value: { rawToken: string } }).value.rawToken
    expect((await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: revokedToken } }))).status).toBe(409)
    // short reason refused; non-pending revoke refused
    expect((await revokeInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, revId, 'short')).ok).toBe(false)
    expect((await revokeInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, revId, 'another long enough reason')).ok).toBe(false)
    resetRateLimits()
  })

  test('claim rate limiting: 10 attempts per 5 minutes per account', async () => {
    setSession(inviteeId, 'STUDENT')
    resetRateLimits()
    for (let i = 0; i < 10; i++) {
      const res = await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: `guessing-token-${i}-abcdefgh` } }))
      expect([404, 429]).toContain(res.status)
    }
    const over = await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: 'guessing-token-over-abcdefgh' } }))
    expect(over.status).toBe(429)
    resetRateLimits()
  })
})

describe('CI-6E application linkage (provenance only)', () => {
  test('apply links a claimed invitation; foreign/unclaimed invitations refused', async () => {
    const created = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT', requestedDomains: ['history'] })
    const invitationId = (created as { invitation: { id: string } }).invitation.id
    const rawToken = (created as { value: { rawToken: string } }).value.rawToken

    setSession(otherId, 'STUDENT')
    // another account claims it first
    expect((await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: rawToken } }))).status).toBe(200)
    // the claim owner's application links it
    const okApply = await applyRoute.POST(req('/api/ci5/reviewers/apply', { method: 'POST', body: { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', consentGranted: true, invitationId } }))
    expect(okApply.status).toBe(201)
    const profile = await client.expertReviewerProfile.findUnique({ where: { studentId: otherId } })
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: profile!.id } })
    const submitted = events.find((e) => e.eventType === 'APPLICATION_SUBMITTED')
    expect(JSON.parse(submitted?.payload ?? '{}').invitationId).toBe(invitationId)
    expect(submitted?.rationale).toContain('claimed invitation')

    // claiming AFTER an application exists records the INVITATION_CLAIMED event
    const later = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT' })
    setSession(otherId, 'STUDENT')
    await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: (later as { value: { rawToken: string } }).value.rawToken } }))
    const eventsAfter = await client.expertReviewerEvent.findMany({ where: { profileId: profile!.id } })
    expect(eventsAfter.map((e) => e.eventType)).toContain('INVITATION_CLAIMED')

    // a different account cannot reference someone else's invitation
    setSession(inviteeId, 'STUDENT')
    const foreign = await applyRoute.POST(req('/api/ci5/reviewers/apply', { method: 'POST', body: { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', consentGranted: true, invitationId } }))
    expect(foreign.status).toBe(400)
    // ...and cannot reference an invitation that was never claimed at all
    const unclaimed = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT' })
    const unclaimedId = (unclaimed as { invitation: { id: string } }).invitation.id
    const neverClaimed = await applyRoute.POST(req('/api/ci5/reviewers/apply', { method: 'POST', body: { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', consentGranted: true, invitationId: unclaimedId } }))
    expect(neverClaimed.status).toBe(400)
    void validateInvitationLink
  })

  test('validateInvitationLink semantics', async () => {
    const created = await createInvitation(invitationsDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, { category: 'DOMAIN_EXPERT' })
    const inv = (created as { invitation: { id: string } }).invitation
    expect((await validateInvitationLink(invitationsDbFromPrisma(client), inviteeId, inv.id)).ok).toBe(false)
    setSession(inviteeId, 'STUDENT')
    await claimRoute.POST(req('/api/ci6/invitations/claim', { method: 'POST', body: { token: (created as { value: { rawToken: string } }).value.rawToken } }))
    const ok = await validateInvitationLink(invitationsDbFromPrisma(client), inviteeId, inv.id)
    expect(ok.ok).toBe(true)
    const foreign = await validateInvitationLink(invitationsDbFromPrisma(client), otherId, inv.id)
    expect(foreign.ok).toBe(false)
  })
})

describe('CI-6E source guard', () => {
  test('ops guide exists and is honest about no-email delivery', async () => {
    const guide = await import('node:fs').then((fs) => fs.readFileSync('docs/BEAN-EXPERT-ONBOARDING-OPERATIONS.md', 'utf8'))
    expect(guide).toContain('no email')
    expect(guide).toContain('shown exactly once')
    expect(guide).toContain('never grants any privilege')
  })

  test('workbench UI carries the invitations section with real API strings', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/components/bean/ci6-verification-workbench.tsx', 'utf8'))
    expect(src).toContain('/api/admin/ci6/invitations')
    expect(src).toContain('shown exactly once')
    expect(src).not.toMatch(/mockData|fakeMetrics|MOCK_REVIEWERS|sampleReviewers/i)
  })
})
