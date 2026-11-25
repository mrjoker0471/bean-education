// ─── CI-5D tests: human domain-pack validation ────────────────────────────────
//   D1  rubric — structure + decision-vs-rubric consistency + evidence payload
//   D2  expert submit golden — assignment + rubric → append-only
//       ClassroomPackReview row (rubric evidence inside), assignment COMPLETED
//       with outcomeRef, curated status reflects the approval
//   D3  rubric/decision mismatch refusals — honest, explicit
//   D4  freshness — stale assignment checksum refuses (never review an
//       uninspected version); ownership enforced
//   D5  qualification at submit — suspended reviewer cannot approve
//   D6  admin route — unqualified admin cannot APPROVE (cannot substitute for
//       an expert) but can record work-states
//   D7  HIGH_STAKES — two distinct QUALIFIED reviewers required; same reviewer
//       twice never satisfies
//   D8  disagreement — both opinions preserved; independent adjudication
//       recorded as audit-only events; ledgers and curated status untouched

import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci5d-'))
const isolatedUrl = `file:${join(dir, 'ci5d.db')}`

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const ADMIN = { id: 'admin-5d', email: 'admin5d@bean.example', displayName: 'Admin One', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const ADMIN2 = { id: 'admin2-5d', email: 'admin25d@bean.example', displayName: 'Admin Two', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const MATH_USER = { id: 'math-5d', email: 'math5d@bean.example', displayName: 'Math Expert', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const MATH2_USER = { id: 'math2-5d', email: 'math25d@bean.example', displayName: 'Math Expert Two', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const MATH3_USER = { id: 'math3-5d', email: 'math35d@bean.example', displayName: 'Math Expert Three', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const MATH4_USER = { id: 'math4-5d', email: 'math45d@bean.example', displayName: 'Math Expert Four', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const HEALTH1_USER = { id: 'health1-5d', email: 'health15d@bean.example', displayName: 'Health Expert One', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const HEALTH2_USER = { id: 'health2-5d', email: 'health25d@bean.example', displayName: 'Health Expert Two', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const authState = { student: MATH_USER as Record<string, unknown> | null }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

import '@/lib/ci/fleet/packs/index'
import { getDomainPack, computePackChecksum } from '@/lib/ci/fleet/domain-packs'
import { packReviewRubricSchema, checkRubricAgainstDecision, composeRubricEvidence, PACK_REVIEW_RUBRIC } from '@/lib/ci/fleet/domain-rubric'
import { resolveReviewerProfile, resolveReviewerProfileById, reviewerDbFromPrisma, submitReviewerApplication, beginQualificationReview, decideReviewerQualification, activateReviewer, suspendReviewer, qualifyingApproverIdsForDomain, type AdminActor } from '@/lib/ci/fleet/reviewers'
import { createAssignment, assignmentDbFromPrisma, getAssignment, listAssignmentEvents } from '@/lib/ci/fleet/assignments'
import { recordPackReview, curatorDbFromPrisma, listPackReviews } from '@/lib/ci/fleet/curator'
import { POST as packReviewSubmit } from '@/app/api/ci5/reviewer/assignments/[assignmentId]/pack-review/route'
import { POST as adminReviewPost } from '@/app/api/admin/knowledge/packs/[packId]/review/route'
import { POST as adjudicationPost, GET as adjudicationGet } from '@/app/api/admin/ci5/adjudications/route'

const admin: AdminActor = { kind: 'ADMIN', studentId: ADMIN.id, displayName: 'Admin One' }
const rdb = reviewerDbFromPrisma(client as never)
const adb = assignmentDbFromPrisma(client as never)
const cdb = curatorDbFromPrisma(client as never)

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never
}

const ALL_OK_RUBRIC = {
  inspected: 'inspected the full pack JSON, every registered source licence record and the fixture suite output end to end',
  sections: Object.fromEntries(PACK_REVIEW_RUBRIC.map((s) => [s.id, { status: 'OK', notes: 'verified in fixture review' }])) as Record<string, { status: string; notes: string }>,
}

async function makeQualifiedReviewer(studentId: string, displayName: string, domains: string[], approvingAdmin: AdminActor = admin): Promise<string> {
  await submitReviewerApplication(rdb, { studentId, displayName }, { category: 'DOMAIN_EXPERT', qualificationCategory: 'fixture qualification', conflictOfInterest: 'none declared (CI-5D fixture)' })
  const profile = await resolveReviewerProfile(rdb, studentId)
  await beginQualificationReview(rdb, approvingAdmin, profile!.id, 'fixture qualification review')
  await decideReviewerQualification(rdb, approvingAdmin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'fixture qualification verified for CI-5D domain validation tests',
    verificationStatus: 'REFERENCED_VERIFIED',
    verificationNote: 'synthetic fixture — no real credentials exist',
    scope: { approvedDomains: domains },
  })
  await activateReviewer(rdb, approvingAdmin, profile!.id)
  return profile!.id
}

const MATH_CHECKSUM = computePackChecksum(getDomainPack('mathematics-statistics')!.pack)
const HEALTH_CHECKSUM = computePackChecksum(getDomainPack('health-medicine-edu')!.pack)

beforeAll(async () => {
  // qualified fixture reviewers (all synthetic)
  globalThis.__MATH_PROFILE = await makeQualifiedReviewer(MATH_USER.id, 'Math Expert', ['mathematics-statistics'])
  globalThis.__MATH2_PROFILE = await makeQualifiedReviewer(MATH2_USER.id, 'Math Expert Two', ['mathematics-statistics'])
  globalThis.__MATH3_PROFILE = await makeQualifiedReviewer(MATH3_USER.id, 'Math Expert Three', ['mathematics-statistics'])
  globalThis.__MATH4_PROFILE = await makeQualifiedReviewer(MATH4_USER.id, 'Math Expert Four', ['mathematics-statistics'])
  globalThis.__HEALTH1_PROFILE = await makeQualifiedReviewer(HEALTH1_USER.id, 'Health Expert One', ['health-medicine-edu'])
  globalThis.__HEALTH2_PROFILE = await makeQualifiedReviewer(HEALTH2_USER.id, 'Health Expert Two', ['health-medicine-edu'])
})

declare global {
  // eslint-disable-next-line no-var
  var __MATH_PROFILE: string
  // eslint-disable-next-line no-var
  var __MATH2_PROFILE: string
  // eslint-disable-next-line no-var
  var __MATH3_PROFILE: string
  // eslint-disable-next-line no-var
  var __MATH4_PROFILE: string
  // eslint-disable-next-line no-var
  var __HEALTH1_PROFILE: string
  // eslint-disable-next-line no-var
  var __HEALTH2_PROFILE: string
}

// ─── D1: rubric ───────────────────────────────────────────────────────────────

describe('CI5D D1: review rubric', () => {
  test('all six sections A–F required — omission refused (NOT_ASSESSED is honest, omission is not)', () => {
    const partial = { inspected: ALL_OK_RUBRIC.inspected, sections: { A: { status: 'OK', notes: '' }, B: { status: 'OK', notes: '' } } }
    expect(packReviewRubricSchema.safeParse(partial).success).toBe(false)
    expect(packReviewRubricSchema.safeParse(ALL_OK_RUBRIC).success).toBe(true)
    // invalid status vocabulary refused
    const badStatus = structuredClone(ALL_OK_RUBRIC) as typeof ALL_OK_RUBRIC
    badStatus.sections.A.status = 'GREAT'
    expect(packReviewRubricSchema.safeParse(badStatus).success).toBe(false)
  })

  test('decision-vs-rubric consistency: APPROVED needs all OK; REJECTED needs an ISSUE; work-states need concrete findings', () => {
    const allOk = packReviewRubricSchema.parse(ALL_OK_RUBRIC)
    expect(checkRubricAgainstDecision('APPROVED', allOk).ok).toBe(true)

    const withIssue = structuredClone(ALL_OK_RUBRIC) as typeof ALL_OK_RUBRIC
    withIssue.sections.C = { status: 'ISSUE', notes: 'licence field on one source does not match the observed licence text' }
    const parsedIssue = packReviewRubricSchema.parse(withIssue)
    expect(checkRubricAgainstDecision('APPROVED', parsedIssue).ok).toBe(false)
    expect(checkRubricAgainstDecision('REJECTED', parsedIssue).ok).toBe(true)
    expect(checkRubricAgainstDecision('CHANGES_REQUESTED', parsedIssue).ok).toBe(true)
    expect(checkRubricAgainstDecision('REJECTED', allOk).ok).toBe(false)

    const withNotAssessed = structuredClone(ALL_OK_RUBRIC) as typeof ALL_OK_RUBRIC
    withNotAssessed.sections.F = { status: 'NOT_ASSESSED', notes: 'benchmark fixtures not inspected this pass' }
    const parsedNA = packReviewRubricSchema.parse(withNotAssessed)
    expect(checkRubricAgainstDecision('APPROVED', parsedNA).ok).toBe(false)
    expect(checkRubricAgainstDecision('RE_REVIEW_REQUESTED', parsedNA).ok).toBe(true)
  })

  test('rubric evidence composes into the append-only evidence payload (CI-4C ledger stays the only store)', () => {
    const evidence = composeRubricEvidence(packReviewRubricSchema.parse(ALL_OK_RUBRIC))
    const parsed = JSON.parse(evidence) as { kind: string; inspected: string; rubricVersion: number; sections: Record<string, unknown> }
    expect(parsed.kind).toBe('CI5-DOMAIN-RUBRIC')
    expect(parsed.rubricVersion).toBe(1)
    expect(Object.keys(parsed.sections).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
})

// ─── D2/D3/D4/D5: expert submit route ─────────────────────────────────────────

describe('CI5D D2–D5: expert pack-review submit', () => {
  test('golden: assignment + rubric → append-only review row, assignment COMPLETED, curated reflects approval', async () => {
    const profile = await resolveReviewerProfileById(rdb, globalThis.__MATH_PROFILE)!
    const created = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: getDomainPack('mathematics-statistics')!.pack.packVersion, subjectChecksum: MATH_CHECKSUM, riskClass: 'STANDARD', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const assignmentId = (created as { ok: true; assignment: { id: string } }).assignment.id

    authState.student = MATH_USER
    const res = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', {
      decision: 'APPROVED',
      rationale: 'Domain scope, knowledge accuracy, provenance, educational value, safety and benchmark quality verified.',
      rubric: ALL_OK_RUBRIC,
    }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { reviewId: string; curated: { status: string; approvalsRecorded: number }; assignment: { status: string; outcomeRef: string }; disagreement: { disagreement: boolean } }
    expect(body.curated.status).toBe('VERIFIED')
    expect(body.curated.approvalsRecorded).toBe(1)
    expect(body.assignment.status).toBe('COMPLETED')
    expect(body.assignment.outcomeRef).toBe(body.reviewId)
    expect(body.disagreement.disagreement).toBe(false)

    // the decision landed in the append-only ledger with the rubric inside evidence
    const rows = await listPackReviews(cdb, 'mathematics-statistics')
    expect(rows.length).toBe(1)
    expect(rows[0].reviewerStudentId).toBe(MATH_USER.id)
    expect(rows[0].packChecksum).toBe(MATH_CHECKSUM)
    const evidence = JSON.parse(rows[0].evidence) as { kind: string }
    expect(evidence.kind).toBe('CI5-DOMAIN-RUBRIC')
    // events: ASSIGNED → STARTED (auto IN_PROGRESS restore path) → SUBMITTED → COMPLETED
    const events = await listAssignmentEvents(adb, assignmentId)
    expect(events.map((e) => e.eventType)).toContain('SUBMITTED')
    expect(events.map((e) => e.eventType)).toContain('COMPLETED')
  })

  test('rubric/decision mismatches refuse with the rubric summary', async () => {
    const profile = await resolveReviewerProfileById(rdb, globalThis.__MATH2_PROFILE)!
    const created = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: getDomainPack('mathematics-statistics')!.pack.packVersion, subjectChecksum: MATH_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const assignmentId = (created as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = MATH2_USER

    const withIssue = structuredClone(ALL_OK_RUBRIC) as typeof ALL_OK_RUBRIC
    withIssue.sections.B = { status: 'ISSUE', notes: 'one worked example uses an outdated formula convention' }
    const approveWithIssue = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'attempting to approve despite a recorded knowledge issue', rubric: withIssue }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(approveWithIssue.status).toBe(400)
    const rejectClean = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'REJECTED', rationale: 'attempting to reject without naming any concrete issue', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(rejectClean.status).toBe(400)
    void profile
  })

  test('freshness: an assignment whose checksum does not match CURRENT pack content refuses (never review an uninspected version)', async () => {
    const profile = await resolveReviewerProfileById(rdb, globalThis.__MATH3_PROFILE)!
    const stale = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: getDomainPack('mathematics-statistics')!.pack.packVersion, subjectChecksum: '9'.repeat(64), coiCheck: 'NONE_DECLARED' })
    expect(stale.ok).toBe(true)
    const assignmentId = (stale as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = MATH3_USER
    const res = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'attempting to approve against a stale inspection', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('changed since this assignment was created')
  })

  test('ownership + qualification: another reviewer cannot submit; a suspended reviewer cannot approve', async () => {
    // ownership: health reviewer cannot submit the math reviewer's assignment
    const mathProfile = await resolveReviewerProfileById(rdb, globalThis.__MATH4_PROFILE)!
    const created = await createAssignment(adb, admin, mathProfile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: getDomainPack('mathematics-statistics')!.pack.packVersion, subjectChecksum: MATH_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    const assignmentId = (created as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = HEALTH1_USER
    const notOwner = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'not my assignment but trying anyway', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(notOwner.status).toBe(403)

    // qualification: suspend the reviewer mid-assignment → approval refuses
    authState.student = MATH4_USER
    await suspendReviewer(rdb, admin, globalThis.__MATH4_PROFILE, 'temporary suspension fixture for CI-5D submit-time re-check')
    const suspendedSubmit = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'attempting an approval after suspension', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(suspendedSubmit.status).toBe(403)
    const body = (await suspendedSubmit.json()) as { error: string }
    expect(body.error).toContain('ACTIVE qualified reviewer')
    // work-state (CHANGES_REQUESTED) from a suspended reviewer is also refused —
    // the route requires an ACTIVE profile for ANY submit through the assignment path
    const workState = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'CHANGES_REQUESTED', rationale: 'work-state attempt from a suspended reviewer', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(workState.status).toBe(403)
  })
})

// ─── D6: admin route qualification ────────────────────────────────────────────

describe('CI5D D6: admin route — qualification enforced, work-states allowed', () => {
  test('an unqualified admin can record a work-state but can NEVER approve; a qualified reviewer-admin can approve', async () => {
    authState.student = ADMIN
    const physics = getDomainPack('physics-space')!
    const checksum = computePackChecksum(physics.pack)
    // unqualified admin (no reviewer profile for physics) cannot approve
    const forbidden = await adminReviewPost(jsonReq('http://localhost/x', 'POST', { packVersion: physics.pack.packVersion, packChecksum: checksum, decision: 'APPROVED', rationale: 'admin attempting to approve without reviewer qualification', evidence: 'inspected the pack and its sources and fixtures in full' }), { params: Promise.resolve({ packId: 'physics-space' }) })
    expect(forbidden.status).toBe(403)
    const err = (await forbidden.json()) as { error: string }
    expect(err.error).toContain('cannot substitute for an expert')
    // work-state is allowed (can only hold the pack back)
    const workState = await adminReviewPost(jsonReq('http://localhost/x', 'POST', { packVersion: physics.pack.packVersion, packChecksum: checksum, decision: 'CHANGES_REQUESTED', rationale: 'admin recorded a concrete work-state for the physics pack', evidence: 'inspected the pack and its sources and fixtures in full' }), { params: Promise.resolve({ packId: 'physics-space' }) })
    expect(workState.status).toBe(200)
    // make the admin a qualified physics reviewer — qualified by a DIFFERENT
    // administrator (the self-review guard correctly refuses self-qualification)
    await submitReviewerApplication(rdb, { studentId: ADMIN.id, displayName: 'Admin One' }, { category: 'DOMAIN_EXPERT', qualificationCategory: 'fixture qualification', conflictOfInterest: 'none declared (CI-5D fixture)' })
    const adminProfile = await resolveReviewerProfile(rdb, ADMIN.id)
    const admin2: AdminActor = { kind: 'ADMIN', studentId: ADMIN2.id, displayName: 'Admin Two' }
    const begin = await beginQualificationReview(rdb, admin2, adminProfile!.id, 'qualification review by a different administrator')
    expect(begin.ok).toBe(true)
    const decided = await decideReviewerQualification(rdb, admin2, adminProfile!.id, {
      decision: 'APPROVED',
      rationale: 'qualification verified by a different authorised administrator',
      verificationStatus: 'REFERENCED_VERIFIED',
      verificationNote: 'synthetic fixture — no real credentials exist',
      scope: { approvedDomains: ['physics-space'] },
    })
    expect(decided.ok).toBe(true)
    const activated = await activateReviewer(rdb, admin2, adminProfile!.id)
    expect(activated.ok).toBe(true)
    const qualified = await adminReviewPost(jsonReq('http://localhost/x', 'POST', { packVersion: physics.pack.packVersion, packChecksum: checksum, decision: 'APPROVED', rationale: 'qualified reviewer-admin approving after full inspection', evidence: 'inspected the pack and its sources and fixtures in full; qualification verified via the reviewer registry' }), { params: Promise.resolve({ packId: 'physics-space' }) })
    expect(qualified.status).toBe(200)
    const qBody = (await qualified.json()) as { curated: { status: string } }
    expect(qBody.curated.status).toBe('VERIFIED')
  })
})

// ─── D7: HIGH_STAKES two distinct qualified reviewers ────────────────────────

describe('CI5D D7: HIGH_STAKES qualified two-reviewer rule', () => {
  test('two DISTINCT qualified approvals verify; the same reviewer twice never satisfies', async () => {
    const h1 = await resolveReviewerProfileById(rdb, globalThis.__HEALTH1_PROFILE)!
    const a1 = await createAssignment(adb, admin, h1, { subjectType: 'DOMAIN_PACK', subjectKey: 'health-medicine-edu', subjectVersion: getDomainPack('health-medicine-edu')!.pack.packVersion, subjectChecksum: HEALTH_CHECKSUM, riskClass: 'HIGH_STAKES', coiCheck: 'NONE_DECLARED' })
    const a1id = (a1 as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = HEALTH1_USER
    const r1 = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'high-stakes domain reviewed by the first qualified expert', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId: a1id }) } as never)
    expect(r1.status).toBe(201)
    const r1body = (await r1.json()) as { curated: { status: string; approvalsRecorded: number; approvalsRequired: number } }
    expect(r1body.curated.approvalsRequired).toBe(2)
    expect(r1body.curated.approvalsRecorded).toBe(1)
    expect(r1body.curated.status).toBe('IN_REVIEW') // one qualified approval is not enough for HIGH_STAKES

    // a SECOND approval from the SAME reviewer cannot exist (assignment layer
    // refuses re-assignment of a decided version) — prove the guard:
    const dup = await createAssignment(adb, admin, h1, { subjectType: 'DOMAIN_PACK', subjectKey: 'health-medicine-edu', subjectVersion: getDomainPack('health-medicine-edu')!.pack.packVersion, subjectChecksum: HEALTH_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    expect(dup.ok).toBe(false)

    // the second DISTINCT qualified reviewer completes the rule
    const h2 = await resolveReviewerProfileById(rdb, globalThis.__HEALTH2_PROFILE)!
    const a2 = await createAssignment(adb, admin, h2, { subjectType: 'DOMAIN_PACK', subjectKey: 'health-medicine-edu', subjectVersion: getDomainPack('health-medicine-edu')!.pack.packVersion, subjectChecksum: HEALTH_CHECKSUM, riskClass: 'HIGH_STAKES', coiCheck: 'NONE_DECLARED' })
    const a2id = (a2 as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = HEALTH2_USER
    const r2 = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'independent second qualified review of the high-stakes domain', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId: a2id }) } as never)
    expect(r2.status).toBe(201)
    const r2body = (await r2.json()) as { curated: { status: string; approvalsRecorded: number } }
    expect(r2body.curated.approvalsRecorded).toBe(2)
    expect(r2body.curated.status).toBe('VERIFIED')
  })
})

// ─── D8: disagreement + independent adjudication ──────────────────────────────

describe('CI5D D8: disagreement preservation + audit-only adjudication', () => {
  test('approval vs rejection is flagged; both opinions preserved; adjudication recorded without touching the ledgers', async () => {
    // fresh reviewer pair for a clean disagreement on a NEW checksum context —
    // use the engineering pack with two qualified reviewers
    await makeQualifiedReviewer('eng1-5d', 'Eng Expert One', ['engineering'])
    await makeQualifiedReviewer('eng2-5d', 'Eng Expert Two', ['engineering'])
    await makeQualifiedReviewer('eng3-5d', 'Eng Adjudicator', ['engineering'])
    const ENG_CHECKSUM = computePackChecksum(getDomainPack('engineering')!.pack)
    const ENG_VERSION = getDomainPack('engineering')!.pack.packVersion

    const e1 = await resolveReviewerProfile(rdb, 'eng1-5d')!
    const ae1 = await createAssignment(adb, admin, e1, { subjectType: 'DOMAIN_PACK', subjectKey: 'engineering', subjectVersion: ENG_VERSION, subjectChecksum: ENG_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    const ae1id = (ae1 as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = { ...MATH_USER, id: 'eng1-5d' } as never
    const approve = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'APPROVED', rationale: 'first qualified expert approves the engineering pack', rubric: ALL_OK_RUBRIC }), { params: Promise.resolve({ assignmentId: ae1id }) } as never)
    expect(approve.status).toBe(201)
    const approveBody = (await approve.json()) as { curated: { status: string } }
    expect(approveBody.curated.status).toBe('VERIFIED') // STANDARD: one distinct qualified approval

    // second qualified reviewer REJECTS → disagreement; rejection is terminal for the version
    const e2 = await resolveReviewerProfile(rdb, 'eng2-5d')!
    const ae2 = await createAssignment(adb, admin, e2, { subjectType: 'DOMAIN_PACK', subjectKey: 'engineering', subjectVersion: ENG_VERSION, subjectChecksum: ENG_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    const ae2id = (ae2 as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = { ...MATH_USER, id: 'eng2-5d' } as never
    const rejectWithIssue = structuredClone(ALL_OK_RUBRIC) as typeof ALL_OK_RUBRIC
    rejectWithIssue.sections.E = { status: 'ISSUE', notes: 'the certifiable-design boundary needs an explicit jurisdiction note for structural work' }
    const reject = await packReviewSubmit(jsonReq('http://localhost/x', 'POST', { decision: 'REJECTED', rationale: 'safety section records a concrete gap that must be fixed', rubric: rejectWithIssue }), { params: Promise.resolve({ assignmentId: ae2id }) } as never)
    expect(reject.status).toBe(201)
    const rejectBody = (await reject.json()) as { disagreement: { disagreement: boolean; detail: string }; curated: { status: string } }
    expect(rejectBody.disagreement.disagreement).toBe(true)
    expect(rejectBody.disagreement.detail).toContain('both opinions preserved')
    expect(rejectBody.curated.status).toBe('REJECTED') // conservative: the objection is terminal for this version

    // adjudication by an INDEPENDENT qualified reviewer — audit-only
    const e3 = await resolveReviewerProfile(rdb, 'eng3-5d')!
    const ae3 = await createAssignment(adb, admin, e3, { subjectType: 'DOMAIN_PACK', subjectKey: 'engineering', subjectVersion: ENG_VERSION, subjectChecksum: ENG_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    const ae3id = (ae3 as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = ADMIN
    // independence guard first: a participating reviewer cannot adjudicate
    const selfAdjudication = await adjudicationPost(jsonReq('http://localhost/x', 'POST', { adjudicatorAssignmentId: ae1id, resolution: 'UPHELD_OBJECTION', rationale: 'the approver attempting to adjudicate their own disagreement case' }), { params: Promise.resolve({ packId: 'x' }) } as never).catch(() => null)
    void selfAdjudication
    const participating = await fetchAdjudicationWith(ae1id)
    expect(participating).toBe(409)
    // independent adjudicator records the resolution
    const adjudicated = await adjudicationPost(jsonReq('http://localhost/x', 'POST', { adjudicatorAssignmentId: ae3id, resolution: 'NEW_VERSION_REQUIRED', rationale: 'both opinions reviewed; the safety gap is material — a new version must address it before re-review' }), { params: Promise.resolve({ packId: 'x' }) } as never)
    expect(adjudicated.status).toBe(201)
    const adjudicationBody = (await adjudicated.json()) as { adjudication: { resolution: string; disagreement: string } }
    expect(adjudicationBody.adjudication.resolution).toBe('NEW_VERSION_REQUIRED')
    // curated status untouched by the adjudication (rejection stays terminal)
    const reviews = await listPackReviews(cdb, 'engineering')
    const bound = reviews.filter((r) => r.packVersion === ENG_VERSION && r.packChecksum === ENG_CHECKSUM)
    expect(bound.length).toBe(2)
    // the adjudication queue surfaces the record
    const queue = await adjudicationGet(jsonReq('http://localhost/x', 'GET'))
    expect(queue.status).toBe(200)
    const queueBody = (await queue.json()) as { adjudications: { outcomeRef: string }[] }
    expect(queueBody.adjudications.some((a) => a.outcomeRef === 'adjudication:NEW_VERSION_REQUIRED')).toBe(true)

    // re-adjudicating the completed adjudicator assignment refuses (exactly once)
    const twice = await adjudicationPost(jsonReq('http://localhost/x', 'POST', { adjudicatorAssignmentId: ae3id, resolution: 'UPHELD_APPROVAL', rationale: 'attempting a second adjudication on the completed assignment' }), { params: Promise.resolve({ packId: 'x' }) } as never)
    expect(twice.status).toBe(409)
    const twiceBody = (await twice.json()) as { error: string }
    expect(twiceBody.error).toContain('exactly once')

    // no-disagreement guard: a fresh qualified assignment on a version with no
    // recorded disagreement refuses
    await makeQualifiedReviewer('hist-5d', 'History Expert', ['history-philosophy'])
    const histProfile = await resolveReviewerProfile(rdb, 'hist-5d')!
    const HIST_CHECKSUM = computePackChecksum(getDomainPack('history-philosophy')!.pack)
    const ah = await createAssignment(adb, admin, histProfile, { subjectType: 'DOMAIN_PACK', subjectKey: 'history-philosophy', subjectVersion: getDomainPack('history-philosophy')!.pack.packVersion, subjectChecksum: HIST_CHECKSUM, coiCheck: 'NONE_DECLARED' })
    const ahid = (ah as { ok: true; assignment: { id: string } }).assignment.id
    const clean = await adjudicationPost(jsonReq('http://localhost/x', 'POST', { adjudicatorAssignmentId: ahid, resolution: 'UPHELD_APPROVAL', rationale: 'attempting to adjudicate a version with no recorded disagreement' }), { params: Promise.resolve({ packId: 'x' }) } as never)
    expect(clean.status).toBe(409)
    const cleanBody = (await clean.json()) as { error: string }
    expect(cleanBody.error).toContain('no recorded disagreement')

    async function fetchAdjudicationWith(assignmentId: string): Promise<number> {
      const res = await adjudicationPost(jsonReq('http://localhost/x', 'POST', { adjudicatorAssignmentId: assignmentId, resolution: 'UPHELD_OBJECTION', rationale: 'attempted adjudication by a participating reviewer — must refuse' }), { params: Promise.resolve({ packId: 'x' }) } as never)
      return res.status
    }
  })

  test('qualification set helper reflects ACTIVE scoped reviewers only', async () => {
    const mathsQualified = await qualifyingApproverIdsForDomain(rdb, 'mathematics-statistics')
    expect(mathsQualified.has(MATH4_USER.id)).toBe(false) // suspended mid-assignment in D5
    expect(mathsQualified.has(MATH2_USER.id)).toBe(true)
    expect(mathsQualified.has(MATH_USER.id)).toBe(true) // MATH decided a version but stays ACTIVE
    const engQualified = await qualifyingApproverIdsForDomain(rdb, 'engineering')
    expect(engQualified.has('eng3-5d')).toBe(true)
    const none = await qualifyingApproverIdsForDomain(rdb, 'agriculture-agritech')
    expect(none.size).toBe(0)
  })
})

void getAssignment
