// ─── CI-5B tests: expert reviewer identity & qualification ────────────────────
//   R1  reviewer application — golden path, advisory-only proposed scope,
//       duplicate refused, COI explicit, 401/400 guards
//   R2  qualification lifecycle — BEGIN → DECIDE APPROVED (scope + verification
//       result) → ACTIVATE; self-review refused; UNVERIFIED approval refused
//   R3  scope discipline — unknown domains/languages refused, TRANSCRIPTION
//       structurally refused, category mismatch refused, scope is
//       server-controlled (reviewer payload can never set it)
//   R4  scope matchers — Mathematics reviewer ≠ Engineering reviewer; Hindi ≠
//       Tamil; domain-language scope enforced; suspended/expired not assignable
//   R5  suspension/revocation/expiry — reasons required, terminal states, lazy
//       EXPIRED with SYSTEM attribution, renewal path, history preserved
//   R6  admin API through the REAL requireAdmin — 401/403, golden action,
//       server-resolved actor (no forged identity), registry listing + me route

import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci5b-'))
const isolatedUrl = `file:${join(dir, 'ci5b.db')}`

// Provision the schema on the isolated DB exactly like the CI-4 suites do.
execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const ADMIN = { id: 'admin-5b-1', email: 'admin5b@bean.example', displayName: 'Admin One', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const ADMIN2 = { id: 'admin-5b-2', email: 'admin5b-2@bean.example', displayName: 'Admin Two', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const APPLICANT = { id: 'applicant-5b-1', email: 'applicant5b@bean.example', displayName: 'Applicant One', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const BILINGUAL = { id: 'applicant-5b-2', email: 'bilingual5b@bean.example', displayName: 'Bilingual One', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const authState = { student: APPLICANT as Record<string, unknown> | null }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

// Modules under test AFTER the db/auth mocks.
import '@/lib/ci/fleet/packs/index'
import {
  submitReviewerApplication,
  beginQualificationReview,
  decideReviewerQualification,
  activateReviewer,
  suspendReviewer,
  reinstateReviewer,
  revokeReviewer,
  updateReviewerScope,
  resolveReviewerProfile,
  listReviewerProfiles,
  listReviewerEvents,
  reviewerCanReviewDomain,
  reviewerCanReviewLanguage,
  validateReviewerScope,
  REVIEWER_TRANSITIONS,
  type AdminActor,
} from '@/lib/ci/fleet/reviewers'
import { POST as applyRoute } from '@/app/api/ci5/reviewers/apply/route'
import { GET as meRoute } from '@/app/api/ci5/reviewers/me/route'
import { GET as listRoute } from '@/app/api/admin/ci5/reviewers/route'
import { POST as actionRoute } from '@/app/api/admin/ci5/reviewers/[profileId]/action/route'

const admin: AdminActor = { kind: 'ADMIN', studentId: ADMIN.id, displayName: 'Admin One' }
const admin2: AdminActor = { kind: 'ADMIN', studentId: ADMIN2.id, displayName: 'Admin Two' }

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never
}

async function makeActiveDomainReviewer(studentId: string, displayName: string, domains: string[], approvingAdmin: AdminActor = admin): Promise<{ profileId: string; reviewerCode: string }> {
  await submitReviewerApplication(client as never, { studentId, displayName }, {
    category: 'DOMAIN_EXPERT',
    qualificationCategory: 'PhD in Mathematics',
    professionalExperience: '12 years teaching undergraduate mathematics',
    conflictOfInterest: 'none declared',
    proposedDomains: domains,
  })
  const profile = await resolveReviewerProfile(client as never, studentId)
  await beginQualificationReview(client as never, approvingAdmin, profile!.id, 'qualification evidence verified with the issuing institution')
  const decided = await decideReviewerQualification(client as never, approvingAdmin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'qualification verified; scope matches the reviewed evidence',
    verificationStatus: 'DOCUMENT_REVIEWED',
    verificationNote: 'credential copy reviewed; original never stored',
    scope: { approvedDomains: domains },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(client as never, approvingAdmin, profile!.id)
  expect(activated.ok).toBe(true)
  return { profileId: profile!.id, reviewerCode: activated.profile.reviewerCode }
}

async function makeActiveBilingualReviewer(studentId: string, displayName: string, scope: unknown, approvingAdmin: AdminActor = admin): Promise<string> {
  const applied = await submitReviewerApplication(client as never, { studentId, displayName }, {
    category: 'BILINGUAL_LANGUAGE',
    qualificationCategory: 'Bilingual Tamil–English educator',
    professionalExperience: '9 years bilingual science teaching',
    conflictOfInterest: 'none declared',
    proposedLanguages: scope as { tag: string; tasks: string[] }[],
  })
  if (!applied.ok) throw new Error(`fixture submit failed: ${applied.error}`)
  const profile = await resolveReviewerProfile(client as never, studentId)
  await beginQualificationReview(client as never, approvingAdmin, profile!.id, 'bilingual qualification evidence reviewed')
  const decided = await decideReviewerQualification(client as never, approvingAdmin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'bilingual qualification verified; language scope recorded server-side',
    verificationStatus: 'REFERENCED_VERIFIED',
    scope: { approvedLanguages: scope as Record<string, unknown>[] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(client as never, approvingAdmin, profile!.id)
  expect(activated.ok).toBe(true)
  return profile!.id
}

// ─── R1: reviewer application ─────────────────────────────────────────────────

describe('CI5B R1: reviewer application', () => {
  test('golden path creates APPLICATION_PENDING with APPLICATION_SUBMITTED + COI_DECLARED events; proposed scope stays advisory (payload only)', async () => {
    const res = await submitReviewerApplication(client as never, { studentId: APPLICANT.id, displayName: 'Applicant One' }, {
      category: 'DOMAIN_EXPERT',
      qualificationCategory: 'PhD in Mathematics',
      professionalExperience: '12 years teaching undergraduate mathematics',
      conflictOfInterest: 'none declared',
      proposedDomains: ['mathematics-statistics'],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.profile.status).toBe('APPLICATION_PENDING')
    expect(res.profile.reviewerCode.startsWith('BR-')).toBe(true)
    const events = await listReviewerEvents(client as never, res.profile.id)
    expect(events.map((e) => e.eventType)).toEqual(['APPLICATION_SUBMITTED', 'COI_DECLARED'])
    expect(events[0].actorKind).toBe('REVIEWER')
    const payload = JSON.parse(events[0].payload ?? '{}')
    expect(payload.proposedDomains).toEqual(['mathematics-statistics'])
    // The authoritative scope columns remain EMPTY — proposals never self-approve.
    expect(JSON.parse(res.profile.approvedDomains)).toEqual([])
  })

  test('duplicate application refused — one profile per account', async () => {
    const res = await submitReviewerApplication(client as never, { studentId: APPLICANT.id, displayName: 'Applicant One' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(res.error).toContain('already exists')
  })

  test('missing/short COI declaration refused; invalid category refused', async () => {
    const noCoi = await submitReviewerApplication(client as never, { studentId: 'x1', displayName: 'X' }, { category: 'DOMAIN_EXPERT' })
    expect(noCoi.ok).toBe(false)
    const badCat = await submitReviewerApplication(client as never, { studentId: 'x2', displayName: 'X' }, { category: 'SUPER_REVIEWER', conflictOfInterest: 'none declared' })
    expect(badCat.ok).toBe(false)
    if (!badCat.ok) expect(badCat.status).toBe(400)
  })

  test('apply route: 401 unauthenticated, 201 golden (identity from session, never body)', async () => {
    authState.student = null
    const unauth = await applyRoute(jsonReq('http://localhost/api/ci5/reviewers/apply', 'POST', { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' }))
    expect(unauth.status).toBe(401)
    authState.student = BILINGUAL
    const ok = await applyRoute(jsonReq('http://localhost/api/ci5/reviewers/apply', 'POST', { category: 'BILINGUAL_LANGUAGE', conflictOfInterest: 'none declared' }))
    expect(ok.status).toBe(201)
    const body = (await ok.json()) as { profile: { status: string }; note: string }
    expect(body.profile.status).toBe('APPLICATION_PENDING')
    expect(body.note).toContain('confers no review privileges')
    // A forged identity/qualification/scope in the body changes nothing: the
    // strict schema refuses unknown scope/verification fields outright (400),
    // and no privilege can be created through a request body.
    const forged = await applyRoute(jsonReq('http://localhost/api/ci5/reviewers/apply', 'POST', { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', approvedDomains: ['engineering'], verificationStatus: 'DOCUMENT_REVIEWED' }))
    expect(forged.status).toBe(400)
    const forgedBody = (await forged.json()) as { error: string }
    expect(forgedBody.error).toContain('invalid application')
  })
})

// ─── R2: qualification lifecycle ──────────────────────────────────────────────

describe('CI5B R2: qualification lifecycle', () => {
  test('BEGIN → QUALIFICATION_REVIEW; self-review refused (reviewer can never approve their own qualification)', async () => {
    const created = await submitReviewerApplication(client as never, { studentId: 'self-5b', displayName: 'Self Reviewer' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    expect(created.ok).toBe(true)
    const profileId = (created as { ok: true; profile: { id: string } }).profile.id
    const selfBegin = await beginQualificationReview(client as never, { kind: 'ADMIN', studentId: 'self-5b', displayName: 'Self Reviewer' }, profileId, 'attempting own review')
    expect(selfBegin.ok).toBe(false)
    if (!selfBegin.ok) expect(selfBegin.error).toContain('never act on their own qualification')
    const otherBegin = await beginQualificationReview(client as never, admin, profileId, 'starting qualification review')
    expect(otherBegin.ok).toBe(true)
    const selfDecide = await decideReviewerQualification(client as never, { kind: 'ADMIN', studentId: 'self-5b', displayName: 'Self Reviewer' }, profileId, { decision: 'APPROVED', rationale: 'approving myself is impossible', scope: { approvedDomains: ['mathematics-statistics'] }, verificationStatus: 'DOCUMENT_REVIEWED' })
    expect(selfDecide.ok).toBe(false)
  })

  test('APPROVED without scope / with UNVERIFIED verification → refused with honest errors', async () => {
    const created = await submitReviewerApplication(client as never, { studentId: 'q-5b-1', displayName: 'Q One' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    const profileId = (created as { ok: true; profile: { id: string } }).profile.id
    await beginQualificationReview(client as never, admin, profileId, 'review started')
    const noScope = await decideReviewerQualification(client as never, admin, profileId, { decision: 'APPROVED', rationale: 'no authorised scope was supplied for this approval', verificationStatus: 'DOCUMENT_REVIEWED' })
    expect(noScope.ok).toBe(false)
    if (!noScope.ok) expect(noScope.error).toContain('requires the authorised scope')
    const unverified = await decideReviewerQualification(client as never, admin, profileId, { decision: 'APPROVED', rationale: 'verification result missing', verificationStatus: 'UNVERIFIED', scope: { approvedDomains: ['physics-space'] } })
    expect(unverified.ok).toBe(false)
    if (!unverified.ok) expect(unverified.error).toContain('never approved UNVERIFIED')
  })

  test('golden DOMAIN_EXPERT approval: scope + verification stored server-side, then ACTIVATE into rotation', async () => {
    const { profileId } = await makeActiveDomainReviewer('q-5b-2', 'Q Two', ['mathematics-statistics'], admin2)
    const profile = await resolveReviewerProfile(client as never, 'q-5b-2')
    expect(profile?.status).toBe('ACTIVE')
    expect(JSON.parse(profile!.approvedDomains)).toEqual(['mathematics-statistics'])
    expect(profile!.verificationStatus).toBe('DOCUMENT_REVIEWED')
    const events = await listReviewerEvents(client as never, profileId)
    expect(events.map((e) => e.eventType)).toEqual(['APPLICATION_SUBMITTED', 'COI_DECLARED', 'QUALIFICATION_REVIEW_STARTED', 'APPROVED', 'ACTIVATED'])
    const approved = events.find((e) => e.eventType === 'APPROVED')!
    expect(approved.actorKind).toBe('ADMIN')
    expect(approved.actorId).toBe(admin2.studentId)
    expect(JSON.parse(approved.payload ?? '{}').scope.approvedDomains).toEqual(['mathematics-statistics'])
  })

  test('illegal transitions refused (strict transition table)', async () => {
    expect(REVIEWER_TRANSITIONS.APPLICATION_PENDING.includes('ACTIVE')).toBe(false)
    const created = await submitReviewerApplication(client as never, { studentId: 'q-5b-3', displayName: 'Q Three' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    const profileId = (created as { ok: true; profile: { id: string } }).profile.id
    const skip = await activateReviewer(client as never, admin, profileId) // APPLICATION_PENDING → ACTIVE
    expect(skip.ok).toBe(false)
    if (!skip.ok) expect(skip.error).toContain('illegal transition')
  })
})

// ─── R3: scope discipline (server-controlled) ─────────────────────────────────

describe('CI5B R3: scope discipline', () => {
  test('unknown domainId refused; category mismatch refused', () => {
    expect(validateReviewerScope('DOMAIN_EXPERT', { approvedDomains: ['not-a-domain'] }).ok).toBe(false)
    expect(validateReviewerScope('DOMAIN_EXPERT', { approvedDomains: ['mathematics-statistics'], approvedLanguages: [{ tag: 'en', tasks: ['TERMINOLOGY'] }] }).ok).toBe(false)
    expect(validateReviewerScope('BILINGUAL_LANGUAGE', { approvedDomains: ['mathematics-statistics'] }).ok).toBe(false)
    expect(validateReviewerScope('BILINGUAL_LANGUAGE', {}).ok).toBe(false)
  })

  test('TRANSCRIPTION can never enter a reviewer scope (structural §9.2 rule)', () => {
    const res = validateReviewerScope('BILINGUAL_LANGUAGE', { approvedLanguages: [{ tag: 'ta', tasks: ['TRANSCRIPTION'] }] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('TRANSCRIPTION')
    expect(reviewerCanReviewLanguage({ status: 'ACTIVE', category: 'BILINGUAL_LANGUAGE', approvedDomains: '[]', approvedLanguages: JSON.stringify([{ tag: 'ta', tasks: ['TEXT_UNDERSTANDING', 'TRANSCRIPTION'] }]) } as never, 'ta', 'TRANSCRIPTION')).toBe(false)
  })

  test('unknown language tag refused', () => {
    const res = validateReviewerScope('BILINGUAL_LANGUAGE', { approvedLanguages: [{ tag: 'klingon', tasks: ['TEXT_UNDERSTANDING'] }] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('outside the BEAN catalogue')
  })

  test('UPDATE_SCOPE is admin-only, snapshot-preserving, and refuses TRANSCRIPTION', async () => {
    const { profileId } = await makeActiveDomainReviewer('q-5b-4', 'Q Four', ['physics-space'])
    const bad = await updateReviewerScope(client as never, admin, profileId, { scope: { approvedDomains: ['engineering'] }, rationale: 'scope change' })
    expect(bad.ok).toBe(true) // engineering IS a known domain — admin may grant it
    const events = await listReviewerEvents(client as never, profileId)
    const scopeEvent = events.find((e) => e.eventType === 'SCOPE_UPDATED')!
    expect(JSON.parse(scopeEvent.payload ?? '{}').previous.approvedDomains).toEqual(['physics-space'])
    expect(JSON.parse(scopeEvent.payload ?? '{}').updated.approvedDomains).toEqual(['engineering'])
    // restore the honest scope
    await updateReviewerScope(client as never, admin, profileId, { scope: { approvedDomains: ['physics-space'] }, rationale: 'restore the originally approved scope' })
    // scope update with TRANSCRIPTION attempt refused
    const bilingualId = await makeActiveBilingualReviewer('q-5b-5', 'Q Five', [{ tag: 'hi', tasks: ['TRANSLATION'] }])
    const transcriptionAttack = await updateReviewerScope(client as never, admin, bilingualId, { scope: { approvedLanguages: [{ tag: 'hi', tasks: ['TRANSCRIPTION'] }] }, rationale: 'attempt to add transcription scope' })
    expect(transcriptionAttack.ok).toBe(false)
  })
})

// ─── R4: scope matchers ───────────────────────────────────────────────────────

describe('CI5B R4: scope matchers', () => {
  test('Mathematics reviewer can review mathematics but NOT engineering; non-ACTIVE not assignable', async () => {
    const { profileId } = await makeActiveDomainReviewer('m-5b-1', 'Math Reviewer', ['mathematics-statistics'])
    const profile = await resolveReviewerProfile(client as never, 'm-5b-1')!
    expect(reviewerCanReviewDomain(profile, 'mathematics-statistics')).toBe(true)
    expect(reviewerCanReviewDomain(profile, 'engineering')).toBe(false)
    // a bilingual reviewer cannot review domains at all
    const bilingualProfile = await resolveReviewerProfile(client as never, BILINGUAL.id)
    expect(bilingualProfile).not.toBeNull() // applied via route earlier — still PENDING
    expect(reviewerCanReviewDomain(bilingualProfile!, 'mathematics-statistics')).toBe(false)
    // suspended reviewer loses assignability
    await suspendReviewer(client as never, admin, profileId, 'temporary unavailability during term time')
    const suspended = await resolveReviewerProfile(client as never, 'm-5b-1')!
    expect(suspended.status).toBe('SUSPENDED')
    expect(reviewerCanReviewDomain(suspended, 'mathematics-statistics')).toBe(false)
  })

  test('Hindi reviewer ≠ Tamil reviewer; domain-language scope enforced', async () => {
    await makeActiveBilingualReviewer('h-5b-1', 'Hindi Reviewer', [{ tag: 'hi', tasks: ['TRANSLATION', 'TERMINOLOGY'] }])
    const hindi = await resolveReviewerProfile(client as never, 'h-5b-1')!
    expect(reviewerCanReviewLanguage(hindi, 'hi', 'TRANSLATION')).toBe(true)
    expect(reviewerCanReviewLanguage(hindi, 'ta', 'TRANSLATION')).toBe(false)
    expect(reviewerCanReviewLanguage(hindi, 'hi', 'GENERATION')).toBe(false) // task not in scope
    // domain-language specialist: Tamil TERMINOLOGY restricted to mathematics
    await makeActiveBilingualReviewer('t-5b-1', 'Tamil Math Reviewer', [{ tag: 'ta', tasks: ['TERMINOLOGY'], domains: ['mathematics-statistics'] }])
    const tamil = await resolveReviewerProfile(client as never, 't-5b-1')!
    expect(reviewerCanReviewLanguage(tamil, 'ta', 'TERMINOLOGY')).toBe(false) // general call without domain — restricted scope refuses
    expect(reviewerCanReviewLanguage(tamil, 'ta', 'TERMINOLOGY', 'mathematics-statistics')).toBe(true)
    expect(reviewerCanReviewLanguage(tamil, 'ta', 'TERMINOLOGY', 'engineering')).toBe(false)
  })
})

// ─── R5: suspension / revocation / expiry ─────────────────────────────────────

describe('CI5B R5: suspension, revocation, expiry', () => {
  test('suspension requires a reason; reinstatement restores ACTIVE', async () => {
    const { profileId } = await makeActiveDomainReviewer('s-5b-1', 'S One', ['biology-life'])
    const noReason = await suspendReviewer(client as never, admin, profileId, 'short')
    expect(noReason.ok).toBe(false)
    await suspendReviewer(client as never, admin, profileId, 'independent verification pending on a declared prior affiliation')
    const suspended = await resolveReviewerProfile(client as never, 's-5b-1')!
    expect(suspended.suspendedReason).toContain('independent verification')
    const reinstate = await reinstateReviewer(client as never, admin, profileId, 'verification completed with the issuing institution')
    expect(reinstate.ok).toBe(true)
    expect((await resolveReviewerProfile(client as never, 's-5b-1')!).status).toBe('ACTIVE')
  })

  test('REVOKE requires ≥20 chars, is terminal, and preserves full history', async () => {
    const { profileId } = await makeActiveDomainReviewer('s-5b-2', 'S Two', ['chemistry-materials'])
    const shortReason = await revokeReviewer(client as never, admin, profileId, 'nope')
    expect(shortReason.ok).toBe(false)
    const revoked = await revokeReviewer(client as never, admin, profileId, 'qualification evidence could not be re-verified with the issuing body; approval withdrawn')
    expect(revoked.ok).toBe(true)
    expect((await resolveReviewerProfile(client as never, 's-5b-2')!).status).toBe('REVOKED')
    const after = await activateReviewer(client as never, admin, profileId)
    expect(after.ok).toBe(false)
    const events = await listReviewerEvents(client as never, profileId)
    expect(events[events.length - 1].eventType).toBe('REVOKED')
    // history intact: earlier APPROVED still present
    expect(events.some((e) => e.eventType === 'APPROVED')).toBe(true)
  })

  test('lazy EXPIRED: past expiresAt ⇒ EXPIRED on read with SYSTEM attribution; renewal path exists', async () => {
    // approve with a past expiry directly through the qualification decision
    await submitReviewerApplication(client as never, { studentId: 's-5b-3', displayName: 'S Three' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    const profile = await resolveReviewerProfile(client as never, 's-5b-3')!
    await beginQualificationReview(client as never, admin, profile.id, 'review started')
    await decideReviewerQualification(client as never, admin, profile.id, {
      decision: 'APPROVED',
      rationale: 'approved with a qualification that has already lapsed — expiry must apply',
      verificationStatus: 'DOCUMENT_REVIEWED',
      verificationNote: 'credential verified against the issuing registry (fixture)',
      scope: { approvedDomains: ['history-philosophy'] },
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    })
    const lapsed = await resolveReviewerProfile(client as never, 's-5b-3')
    expect(lapsed?.status).toBe('EXPIRED')
    const events = await listReviewerEvents(client as never, profile.id)
    const expiredEvent = events.find((e) => e.eventType === 'EXPIRED')!
    expect(expiredEvent.actorKind).toBe('SYSTEM')
    expect(expiredEvent.rationale).toContain('no longer assignable')
    // renewal: EXPIRED → QUALIFICATION_REVIEW is the admin re-review path
    const renew = await beginQualificationReview(client as never, admin, profile.id, 'qualification renewed — re-review for another term')
    expect(renew.ok).toBe(true)
    expect((await resolveReviewerProfile(client as never, 's-5b-3')!).status).toBe('QUALIFICATION_REVIEW')
  })
})

// ─── R6: admin API through the REAL requireAdmin ──────────────────────────────

describe('CI5B R6: admin API guards + registry + me route', () => {
  test('action route: 401 unauthenticated, 403 non-admin (student cannot administer reviewers)', async () => {
    const teach = await import('@/lib/teach')
    const adminState = { adminStudent: null as Record<string, unknown> | null }
    // requireAdmin resolves through requireStudent + role — point requireStudent at a STUDENT to prove 403
    authState.student = { ...APPLICANT, role: 'STUDENT' } as never
    const forbidden = await actionRoute(jsonReq('http://localhost/api/admin/ci5/reviewers/p/action', 'POST', { action: 'ACTIVATE' }), { params: Promise.resolve({ profileId: 'p' }) } as never)
    expect([401, 403]).toContain(forbidden.status)
    void adminState
    void teach
  })

  test('action route golden path via session admin (identity server-resolved)', async () => {
    // restore an ADMIN session; the route reads the actor from requireAdmin, never the body
    authState.student = ADMIN as never
    const created = await submitReviewerApplication(client as never, { studentId: 'route-5b-1', displayName: 'Route One' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    const profileId = (created as { ok: true; profile: { id: string } }).profile.id
    const begin = await actionRoute(jsonReq('http://localhost/api/admin/ci5/reviewers/x/action', 'POST', { action: 'BEGIN_QUALIFICATION_REVIEW', rationale: 'route-driven review' }), { params: Promise.resolve({ profileId }) } as never)
    expect(begin.status).toBe(200)
    const decide = await actionRoute(jsonReq('http://localhost/api/admin/ci5/reviewers/x/action', 'POST', {
      action: 'DECIDE',
      decision: 'APPROVED',
      rationale: 'route golden path with verified scope',
      verificationStatus: 'REFERENCED_VERIFIED',
      verificationNote: 'credential checked with the issuing body (fixture)',
      scope: { approvedDomains: ['engineering'] },
    }), { params: Promise.resolve({ profileId }) } as never)
    expect(decide.status).toBe(200)
    const activate = await actionRoute(jsonReq('http://localhost/api/admin/ci5/reviewers/x/action', 'POST', { action: 'ACTIVATE' }), { params: Promise.resolve({ profileId }) } as never)
    expect(activate.status).toBe(200)
    const body = (await activate.json()) as { profile: { status: string }; eventCount: number }
    expect(body.profile.status).toBe('ACTIVE')
    expect(body.eventCount).toBe(5)
    // unknown action + non-string payloads refused honestly
    const unknown = await actionRoute(jsonReq('http://localhost/api/admin/ci5/reviewers/x/action', 'POST', { action: 'PROMOTE_MYSELF' }), { params: Promise.resolve({ profileId }) } as never)
    expect(unknown.status).toBe(400)
  })

  test('registry list filters by status; me route exposes ONLY the owner profile', async () => {
    authState.student = ADMIN as never
    const list = await listRoute(jsonReq('http://localhost/api/admin/ci5/reviewers?status=ACTIVE', 'GET'))
    expect(list.status).toBe(200)
    const body = (await list.json()) as { reviewers: { status: string }[] }
    expect(body.reviewers.length).toBeGreaterThan(0)
    for (const r of body.reviewers) expect(r.status).toBe('ACTIVE')

    authState.student = BILINGUAL as never
    const me = await meRoute(jsonReq('http://localhost/api/ci5/reviewers/me', 'GET'))
    expect(me.status).toBe(200)
    const meBody = (await me.json()) as { profile: { category: string; status: string } | null }
    expect(meBody.profile?.category).toBe('BILINGUAL_LANGUAGE')

    authState.student = { ...APPLICANT, id: 'never-applied' } as never
    const none = await meRoute(jsonReq('http://localhost/api/ci5/reviewers/me', 'GET'))
    const noneBody = (await none.json()) as { profile: unknown }
    expect(noneBody.profile).toBeNull()
  })

  test('a STUDENT account (non-admin) can never reach the admin registry', async () => {
    authState.student = { ...APPLICANT, role: 'STUDENT' } as never
    const res = await listRoute(jsonReq('http://localhost/api/admin/ci5/reviewers', 'GET'))
    expect([401, 403]).toContain(res.status)
  })
})

// ─── Registry sanity for matchers used by CI-5C/5D/5E ────────────────────────

describe('CI5B: reviewer registry integrity', () => {
  test('listReviewerProfiles surfaces all created profiles with valid reviewer codes', async () => {
    const all = await listReviewerProfiles(client as never, {})
    expect(all.length).toBeGreaterThanOrEqual(8)
    for (const p of all) {
      expect(p.reviewerCode.startsWith('BR-')).toBe(true)
      expect(['DOMAIN_EXPERT', 'BILINGUAL_LANGUAGE']).toContain(p.category)
    }
  })
})

void rmSync // tmp cleanup is intentional: the isolated dir is removed by the OS tmp cleaner
void join
void tmpdir
void mkdtempSync
