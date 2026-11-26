// ─── BEAN Classroom Intelligence (CI-6F): availability & workspace completion ──
// Isolated real-DB tests: reviewer-controlled availability (pause/resume),
// the server-side createAssignment gate, unchanged scope/COI/independence
// enforcement (CI-5C regression), route authorization, and honest surfacing of
// the availability state to the reviewer and the administrator.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci6f-'))
const isolatedUrl = `file:${join(tmp, 'ci6f.db')}`
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
const { createAssignment, assignmentDbFromPrisma } = await import('@/lib/ci/fleet/assignments')
const { setReviewerAvailability, expertProfilesDbFromPrisma } = await import('@/lib/ci/fleet/expert-profiles')

const availabilityRoute = await import('@/app/api/ci5/reviewer/availability/route')
const meRoute = await import('@/app/api/ci5/reviewers/me/route')

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

let reviewerId: string
let adminId: string
let reviewerProfileId: string

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const reviewer = await client.student.create({ data: { email: `ci6f-reviewer-${s}@bean.test`, role: 'STUDENT' } })
  const admin = await client.student.create({ data: { email: `ci6f-admin-${s}@bean.test`, role: 'ADMIN' } })
  reviewerId = reviewer.id
  adminId = admin.id

  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId: reviewerId, displayName: 'Reviewer' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    qualificationCategory: 'PhD Mathematics',
    consentGranted: true,
  })
  expect(applied.ok).toBe(true)
  reviewerProfileId = (applied as { profile: { id: string } }).profile.id
  // qualification decision by a DIFFERENT admin (self-review guard intact)
  const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, reviewerProfileId, {
    decision: 'APPROVED',
    rationale: 'qualification records verified for the availability regression fixture',
    verificationStatus: 'DOCUMENT_REVIEWED',
    scope: { approvedDomains: ['mathematics-statistics'] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, reviewerProfileId)
  expect(activated.ok).toBe(true)
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-6F availability control', () => {
  test('reviewer pauses; server-side gate refuses new assignments with a clear reason', async () => {
    setSession(reviewerId)
    const paused = await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'PAUSED' } }))
    expect(paused.status).toBe(200)
    expect((await json(paused) as { availability: string }).availability).toBe('PAUSED')
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerId)
    expect(profile?.availability).toBe('PAUSED')
    expect(profile?.status).toBe('ACTIVE') // availability never touches eligibility state
    const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
    const refused = await createAssignment(assignmentDbFromPrisma(client), adminActor, profile!, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.status).toBe(409)
      expect(refused.error).toContain('paused availability')
    }
    // in-flight work unaffected: no assignments existed, nothing to break
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'AVAILABILITY_CHANGED' } })
    expect(events.length).toBe(1)
    expect(events[0].actorKind).toBe('REVIEWER')
  })

  test('resume re-enables assignments; duplicate toggles write no extra events', async () => {
    setSession(reviewerId)
    const resumed = await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'AVAILABLE' } }))
    expect(resumed.status).toBe(200)
    const eventsAfterResume = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'AVAILABILITY_CHANGED' } })
    // pause (test 1) + resume = 2 real transitions
    expect(eventsAfterResume.length).toBe(2)
    const again = await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'AVAILABLE' } }))
    expect(again.status).toBe(200)
    const events = await client.expertReviewerEvent.findMany({ where: { profileId: reviewerProfileId, eventType: 'AVAILABILITY_CHANGED' } })
    expect(events.length).toBe(2) // the duplicate no-op wrote nothing
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerId)
    const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
    const ok = await createAssignment(assignmentDbFromPrisma(client), adminActor, profile!, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(ok.ok).toBe(true)
  })

  test('route authorization and strict schema (forged fields refused)', async () => {
    setSession(null)
    expect((await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'PAUSED' } }))).status).toBe(401)
    setSession(randomUUID())
    expect((await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'PAUSED' } }))).status).toBe(404)
    setSession(reviewerId)
    expect((await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'HACKED' } }))).status).toBe(400)
    expect((await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'PAUSED', status: 'REJECTED' } }))).status).toBe(400)
    const profile = await client.expertReviewerProfile.findUnique({ where: { id: reviewerProfileId } })
    expect(profile?.status).toBe('ACTIVE')
  })

  test('availability surfaces to the reviewer and the administrator registry', async () => {
    setSession(reviewerId)
    const me = await meRoute.GET()
    expect(me.status).toBe(200)
    expect((await json(me) as { profile: { availability: string } }).profile.availability).toBe('AVAILABLE')
    setSession(reviewerId)
    await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'PAUSED' } }))
    const adminRegistry = await import('@/app/api/admin/ci5/reviewers/route')
    setSession(adminId, 'ADMIN')
    const registry = await adminRegistry.GET(req('/api/admin/ci5/reviewers'))
    expect(registry.status).toBe(200)
    const body = await json(registry)
    const row = (body as { reviewers: Array<{ id: string; availability: string }> }).reviewers.find((r) => r.id === reviewerProfileId)
    expect(row?.availability).toBe('PAUSED')
    // non-admin cannot read the registry
    setSession(reviewerId, 'STUDENT')
    expect((await adminRegistry.GET(req('/api/admin/ci5/reviewers'))).status).toBe(403)
    setSession(reviewerId)
    await availabilityRoute.POST(req('/api/ci5/reviewer/availability', { method: 'POST', body: { availability: 'AVAILABLE' } }))
  })
})

describe('CI-6F CI-5C regression (gates unchanged by the availability widening)', () => {
  test('scope mismatch, COI conflict and one-open-assignment rules all still enforced', async () => {
    const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerId)
    const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
    // scope mismatch still 403
    const wrongScope = await createAssignment(assignmentDbFromPrisma(client), adminActor, profile!, { subjectType: 'DOMAIN_PACK', subjectKey: 'physics', coiCheck: 'NONE_DECLARED' })
    expect(wrongScope.ok).toBe(false)
    if (!wrongScope.ok) expect(wrongScope.status).toBe(403)
    // COI conflict still 409
    const coi = await createAssignment(assignmentDbFromPrisma(client), adminActor, profile!, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'CONFLICT_FOUND' })
    expect(coi.ok).toBe(false)
    if (!coi.ok) expect(coi.status).toBe(409)
    // one open assignment per subject still enforced (the earlier test created one)
    const dup = await createAssignment(assignmentDbFromPrisma(client), adminActor, profile!, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.status).toBe(409)
    // non-ACTIVE reviewer still refused
    const ghost = { ...profile!, id: 'ghost', status: 'REJECTED', studentId: 'ghost-student', availability: 'AVAILABLE' }
    const notActive = await createAssignment(assignmentDbFromPrisma(client), adminActor, ghost as never, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(notActive.ok).toBe(false)
    if (!notActive.ok) expect(notActive.status).toBe(409)
  })

  test('workspace source: availability control wired to the real route', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/components/bean/ci5-reviewer-governance.tsx', 'utf8'))
    expect(src).toContain('/api/ci5/reviewer/availability')
    expect(src).toContain('ci5-availability-pause')
    expect(src).toContain('ci5-availability-resume')
  })
})
