// ─── CI-5C tests: review assignment & case management ─────────────────────────
//   A1  creation gates — ACTIVE reviewer + exact scope match + COI check +
//       duplicate/independence guards (server-side, always)
//   A2  lifecycle — start → submit → complete (outcomeRef), reviewer ownership
//   A3  recusal — reason required, append-only, independence preserved
//   A4  expiry — lazy SYSTEM-attributed EXPIRED; expired work can never submit
//   A5  reassignment — reason required, same gates re-run for the new reviewer
//   A6  disagreement detection — pure, both opinions preserved, never averaged
//   A7  admin API through the REAL requireAdmin — 401/403/golden; reviewer queue
//       route exposes ONLY the owner's assignments
//
// Fixtures: two DOMAIN_EXPERT reviewers (mathematics / engineering) and three
// BILINGUAL_LANGUAGE reviewers (Tamil↔mathematics terminology, Hindi
// translation, Gujarati understanding/generation). All synthetic.

import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci5c-'))
const isolatedUrl = `file:${join(dir, 'ci5c.db')}`

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const ADMIN = { id: 'admin-5c-1', email: 'admin5c@bean.example', displayName: 'Admin One', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const REVIEWER_USER = { id: 'rev-5c-1', email: 'rev5c@bean.example', displayName: 'Math Reviewer', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const OTHER_USER = { id: 'rev-5c-2', email: 'rev5c2@bean.example', displayName: 'Eng Reviewer', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const TAMIL_USER = { id: 'tamil-5c', email: 'tamil5c@bean.example', displayName: 'Tamil Reviewer', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const TAMIL2_USER = { id: 'tamil2-5c', email: 'tamil25c@bean.example', displayName: 'Tamil Reviewer Two', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const HINDI_USER = { id: 'hindi-5c', email: 'hindi5c@bean.example', displayName: 'Hindi Reviewer', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const GUJARATI_USER = { id: 'guj-5c', email: 'guj5c@bean.example', displayName: 'Gujarati Reviewer', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const authState = { student: REVIEWER_USER as Record<string, unknown> | null }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

import '@/lib/ci/fleet/packs/index'
import {
  submitReviewerApplication,
  beginQualificationReview,
  decideReviewerQualification,
  activateReviewer,
  resolveReviewerProfileById,
  resolveReviewerProfile,
  reviewerDbFromPrisma,
  type AdminActor,
} from '@/lib/ci/fleet/reviewers'
import {
  createAssignment,
  startAssignment,
  markAssignmentSubmitted,
  markAssignmentCompleted,
  recuseAssignment,
  cancelAssignment,
  reassignAssignment,
  detectReviewDisagreement,
  getAssignment,
  listAssignments,
  listAssignmentEvents,
  assignmentDbFromPrisma,
} from '@/lib/ci/fleet/assignments'
import { POST as adminQueuePost, GET as adminQueueGet } from '@/app/api/admin/ci5/assignments/route'
import { POST as reassignRoute } from '@/app/api/admin/ci5/assignments/[assignmentId]/reassign/route'
import { POST as cancelRoute } from '@/app/api/admin/ci5/assignments/[assignmentId]/cancel/route'
import { GET as reviewerQueueGet } from '@/app/api/ci5/reviewer/assignments/route'
import { POST as startRoute } from '@/app/api/ci5/reviewer/assignments/[assignmentId]/start/route'
import { POST as recuseRoute } from '@/app/api/ci5/reviewer/assignments/[assignmentId]/recuse/route'

const admin: AdminActor = { kind: 'ADMIN', studentId: ADMIN.id, displayName: 'Admin One' }
const rdb = reviewerDbFromPrisma(client as never)
const adb = assignmentDbFromPrisma(client as never)

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never
}

const CHECKSUM = 'a'.repeat(64)

async function makeActiveDomainReviewer(studentId: string, displayName: string, domains: string[]): Promise<string> {
  await submitReviewerApplication(rdb, { studentId, displayName }, { category: 'DOMAIN_EXPERT', qualificationCategory: 'fixture qualification', conflictOfInterest: 'none declared' })
  const profile = await resolveReviewerProfile(rdb, studentId)
  await beginQualificationReview(rdb, admin, profile!.id, 'fixture review')
  await decideReviewerQualification(rdb, admin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'fixture qualification verified for CI-5C assignment tests',
    verificationStatus: 'REFERENCED_VERIFIED',
    verificationNote: 'synthetic fixture — no real credentials exist',
    scope: { approvedDomains: [...domains] },
  })
  await activateReviewer(rdb, admin, profile!.id)
  return profile!.id
}

async function makeActiveBilingualReviewer(studentId: string, displayName: string, scope: { tag: string; tasks: string[]; domains?: string[] }[]): Promise<string> {
  await submitReviewerApplication(rdb, { studentId, displayName }, { category: 'BILINGUAL_LANGUAGE', qualificationCategory: 'fixture bilingual qualification', conflictOfInterest: 'none declared' })
  const profile = await resolveReviewerProfile(rdb, studentId)
  await beginQualificationReview(rdb, admin, profile!.id, 'fixture bilingual review')
  await decideReviewerQualification(rdb, admin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'fixture bilingual scope for CI-5C assignment tests',
    verificationStatus: 'REFERENCED_VERIFIED',
    verificationNote: 'synthetic fixture',
    scope: { approvedLanguages: scope },
  })
  await activateReviewer(rdb, admin, profile!.id)
  return profile!.id
}

let MATH_PROFILE_ID = ''
let ENG_PROFILE_ID = ''
let TAMIL_PROFILE_ID = ''
let TAMIL2_PROFILE_ID = ''
let HINDI_PROFILE_ID = ''
let GUJ_PROFILE_ID = ''

beforeAll(async () => {
  MATH_PROFILE_ID = await makeActiveDomainReviewer(REVIEWER_USER.id, 'Math Reviewer', ['mathematics-statistics'])
  ENG_PROFILE_ID = await makeActiveDomainReviewer(OTHER_USER.id, 'Eng Reviewer', ['engineering'])
  TAMIL_PROFILE_ID = await makeActiveBilingualReviewer(TAMIL_USER.id, 'Tamil Reviewer', [{ tag: 'ta', tasks: ['TERMINOLOGY', 'TEXT_UNDERSTANDING'], domains: ['mathematics-statistics'] }])
  TAMIL2_PROFILE_ID = await makeActiveBilingualReviewer(TAMIL2_USER.id, 'Tamil Reviewer Two', [{ tag: 'ta', tasks: ['TERMINOLOGY', 'TEXT_UNDERSTANDING'], domains: ['mathematics-statistics'] }])
  HINDI_PROFILE_ID = await makeActiveBilingualReviewer(HINDI_USER.id, 'Hindi Reviewer', [{ tag: 'hi', tasks: ['TRANSLATION'] }])
  GUJ_PROFILE_ID = await makeActiveBilingualReviewer(GUJARATI_USER.id, 'Gujarati Reviewer', [{ tag: 'gu', tasks: ['TEXT_UNDERSTANDING', 'GENERATION'] }])
})

// ─── A1: creation gates ───────────────────────────────────────────────────────

describe('CI5C A1: assignment creation gates', () => {
  test('golden: ACTIVE reviewer with matching scope gets an ASSIGNED assignment with a COI-pass event', async () => {
    const profile = await resolveReviewerProfileById(rdb, MATH_PROFILE_ID)!
    const res = await createAssignment(adb, admin, profile, {
      subjectType: 'DOMAIN_PACK',
      subjectKey: 'mathematics-statistics',
      subjectVersion: '1.0.0',
      subjectChecksum: CHECKSUM,
      riskClass: 'STANDARD',
      coiCheck: 'NONE_DECLARED',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.assignment.status).toBe('ASSIGNED')
    expect(res.assignment.reviewerCode.startsWith('BR-')).toBe(true)
    expect(res.assignment.coiCheckResult).toBe('PASS')
    const events = await listAssignmentEvents(adb, res.assignment.id)
    expect(events[0].eventType).toBe('ASSIGNED')
    expect(events[0].actorKind).toBe('ADMIN')
  })

  test('scope mismatch refused server-side: mathematics reviewer cannot take engineering', async () => {
    const profile = await resolveReviewerProfileById(rdb, MATH_PROFILE_ID)!
    const res = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'engineering', coiCheck: 'NONE_DECLARED' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(403)
      expect(res.error).toContain('scope mismatch')
    }
  })

  test('declared COI refuses creation outright', async () => {
    const profile = await resolveReviewerProfileById(rdb, ENG_PROFILE_ID)!
    const res = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'engineering', coiCheck: 'CONFLICT_FOUND', conflictNote: 'reviewer co-authored the pack source' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(409)
      expect(res.error).toContain('conflict of interest')
    }
  })

  test('non-ACTIVE reviewer refused (pending/suspended/expired cannot take work)', async () => {
    await submitReviewerApplication(rdb, { studentId: 'pending-5c', displayName: 'Pending' }, { category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared' })
    const pending = await resolveReviewerProfile(rdb, 'pending-5c')!
    const res = await createAssignment(adb, admin, pending, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('only ACTIVE reviewers')
  })

  test('duplicate guard: one open assignment per reviewer+subject; decided versions never re-assigned', async () => {
    const profile = await resolveReviewerProfileById(rdb, MATH_PROFILE_ID)!
    const dup = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, coiCheck: 'NONE_DECLARED' })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toContain('one open assignment per subject')
    // complete the first assignment, then prove the checksum guard
    const first = (await listAssignments(adb, { reviewerProfileId: profile.id, subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics' }))[0]
    await markAssignmentSubmitted(adb, profile, first.id, REVIEWER_USER.id)
    const done = await markAssignmentCompleted(adb, first.id, 'fixture-review-id')
    expect(done.ok).toBe(true)
    const redecide = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, coiCheck: 'NONE_DECLARED' })
    expect(redecide.ok).toBe(false)
    if (!redecide.ok) expect(redecide.error).toContain('independent-review separation')
  })

  test('language capability subjects require the BILINGUAL category with the exact tag/task/domain scope', async () => {
    // a DOMAIN_EXPERT cannot take a language capability subject at all
    const math = await resolveReviewerProfileById(rdb, MATH_PROFILE_ID)!
    const wrongCategory = await createAssignment(adb, admin, math, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'ta:TEXT_UNDERSTANDING:mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(wrongCategory.ok).toBe(false)
    // the Tamil reviewer CAN take it
    const tamil = await resolveReviewerProfileById(rdb, TAMIL_PROFILE_ID)!
    const ok = await createAssignment(adb, admin, tamil, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'ta:TEXT_UNDERSTANDING:mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(ok.ok).toBe(true)
    // but not a Hindi capability
    const hindiAttack = await createAssignment(adb, admin, tamil, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'hi:TRANSLATION', coiCheck: 'NONE_DECLARED' })
    expect(hindiAttack.ok).toBe(false)
    if (!hindiAttack.ok) expect(hindiAttack.error).toContain('scope mismatch')
  })
})

// ─── A2: lifecycle ────────────────────────────────────────────────────────────

describe('CI5C A2: assignment lifecycle', () => {
  test('start → submit → complete with ownership enforcement at every step', async () => {
    const profile = await resolveReviewerProfileById(rdb, MATH_PROFILE_ID)!
    const created = await createAssignment(adb, admin, profile, { subjectType: 'DOMAIN_PACK', subjectKey: 'mathematics-statistics', subjectVersion: '1.1.0', subjectChecksum: 'b'.repeat(64), coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id

    // another reviewer cannot start it
    const eng = await resolveReviewerProfileById(rdb, ENG_PROFILE_ID)!
    const stolen = await startAssignment(adb, eng, id, OTHER_USER.id)
    expect(stolen.ok).toBe(false)
    if (!stolen.ok) expect(stolen.error).toContain('different reviewer')

    const started = await startAssignment(adb, profile, id, REVIEWER_USER.id)
    expect(started.ok).toBe(true)
    const submitted = await markAssignmentSubmitted(adb, profile, id, REVIEWER_USER.id)
    expect(submitted.ok).toBe(true)
    const completed = await markAssignmentCompleted(adb, id, 'outcome-review-row-id')
    expect(completed.ok).toBe(true)
    const final = await getAssignment(adb, id)!
    expect(final.status).toBe('COMPLETED')
    expect(final.outcomeRef).toBe('outcome-review-row-id')
    const events = await listAssignmentEvents(adb, id)
    expect(events.map((e) => e.eventType)).toEqual(['ASSIGNED', 'STARTED', 'SUBMITTED', 'COMPLETED'])
    // the completion event is SYSTEM-attributed (the authoritative ledger recorded the outcome)
    expect(events[events.length - 1].actorKind).toBe('SYSTEM')
    // a second start is refused (no longer ASSIGNED)
    const rest = await startAssignment(adb, profile, id, REVIEWER_USER.id)
    expect(rest.ok).toBe(false)
  })

  test('completion requires SUBMITTED state', async () => {
    const eng = await resolveReviewerProfileById(rdb, ENG_PROFILE_ID)!
    const created = await createAssignment(adb, admin, eng, { subjectType: 'DOMAIN_PACK', subjectKey: 'engineering', subjectVersion: '2.0.0', subjectChecksum: 'c'.repeat(64), coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id
    const premature = await markAssignmentCompleted(adb, id, 'x')
    expect(premature.ok).toBe(false)
    if (!premature.ok) expect(premature.error).toContain('completion applies after SUBMITTED')
    await startAssignment(adb, eng, id, OTHER_USER.id)
    await markAssignmentSubmitted(adb, eng, id, OTHER_USER.id)
    const completed = await markAssignmentCompleted(adb, id, 'outcome-2')
    expect(completed.ok).toBe(true)
  })
})

// ─── A3: recusal ──────────────────────────────────────────────────────────────

describe('CI5C A3: recusal', () => {
  test('recusal requires a reason, is owner-only, and is permanent append-only history', async () => {
    const tamil = await resolveReviewerProfileById(rdb, TAMIL_PROFILE_ID)!
    const created = await createAssignment(adb, admin, tamil, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'ta:TERMINOLOGY:mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id
    const shortReason = await recuseAssignment(adb, tamil, id, 'busy', TAMIL_USER.id)
    expect(shortReason.ok).toBe(false)
    // ownership: another reviewer cannot recuse someone else's assignment
    const tamil2 = await resolveReviewerProfileById(rdb, TAMIL2_PROFILE_ID)!
    const notOwner = await recuseAssignment(adb, tamil2, id, 'I am not the reviewer here at all', TAMIL2_USER.id)
    expect(notOwner.ok).toBe(false)
    const recused = await recuseAssignment(adb, tamil, id, 'declared prior collaboration with the pack author — conflict of interest', TAMIL_USER.id)
    expect(recused.ok).toBe(true)
    expect((await getAssignment(adb, id))!.status).toBe('RECUSED')
    const events = await listAssignmentEvents(adb, id)
    const recuseEvent = events.find((e) => e.eventType === 'RECUSED')!
    expect(recuseEvent.rationale).toContain('conflict of interest')
    expect(recuseEvent.actorKind).toBe('REVIEWER')
  })
})

// ─── A4: expiry ───────────────────────────────────────────────────────────────

describe('CI5C A4: lazy expiry', () => {
  test('lapsed expiresAt ⇒ EXPIRED on read with SYSTEM attribution; submission then refused', async () => {
    const hindi = await resolveReviewerProfileById(rdb, HINDI_PROFILE_ID)!
    const created = await createAssignment(adb, admin, hindi, {
      subjectType: 'LANGUAGE_CAPABILITY',
      subjectKey: 'hi:TRANSLATION',
      coiCheck: 'NONE_DECLARED',
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id
    const lapsed = await getAssignment(adb, id)
    expect(lapsed!.status).toBe('EXPIRED')
    const events = await listAssignmentEvents(adb, id)
    const expired = events.find((e) => e.eventType === 'EXPIRED')!
    expect(expired.actorKind).toBe('SYSTEM')
    expect(expired.rationale).toContain('reassignment required')
    const lateSubmit = await markAssignmentSubmitted(adb, hindi, id, HINDI_USER.id)
    expect(lateSubmit.ok).toBe(false)
    if (!lateSubmit.ok) expect(lateSubmit.error).toContain('cannot submit')
  })
})

// ─── A5: reassignment ─────────────────────────────────────────────────────────

describe('CI5C A5: reassignment', () => {
  test('reassign closes with reason and creates the replacement through the same gates', async () => {
    const tamil2 = await resolveReviewerProfileById(rdb, TAMIL2_PROFILE_ID)!
    const created = await createAssignment(adb, admin, tamil2, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'ta:TERMINOLOGY:mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id

    // scope mismatch for the new reviewer still refuses (Hindi reviewer for a Tamil capability)
    const hindi = await resolveReviewerProfileById(rdb, HINDI_PROFILE_ID)!
    const badScope = await reassignAssignment(adb, admin, id, { reason: 'first reviewer recused after COI reflection', newReviewerProfileId: hindi.id }, (pid) => resolveReviewerProfileById(rdb, pid))
    expect(badScope.ok).toBe(false)
    // a failed reassignment leaves the original open — the subject is never silently unassigned
    expect((await getAssignment(adb, id))!.status).toBe('ASSIGNED')

    const tamil = await resolveReviewerProfileById(rdb, TAMIL_PROFILE_ID)!
    const ok = await reassignAssignment(adb, admin, id, { reason: 'first reviewer recused after COI reflection', newReviewerProfileId: tamil.id }, (pid) => resolveReviewerProfileById(rdb, pid))
    expect(ok.ok).toBe(true)
    const closed = await getAssignment(adb, id)!
    expect(closed.status).toBe('REASSIGNED')
    expect(closed.reassignmentReason).toContain('recused')
    const tamilAssignments = await listAssignments(adb, { reviewerProfileId: tamil.id, subjectKey: 'ta:TERMINOLOGY:mathematics-statistics', status: 'ASSIGNED' })
    expect(tamilAssignments.length).toBe(1)
    const events = await listAssignmentEvents(adb, id)
    const reEvent = events.find((e) => e.eventType === 'REASSIGNED')!
    expect(reEvent.actorKind).toBe('ADMIN')
  })

  test('short reason and same-reviewer no-op refused', async () => {
    const guj = await resolveReviewerProfileById(rdb, GUJ_PROFILE_ID)!
    const created = await createAssignment(adb, admin, guj, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'gu:GENERATION', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id
    const short = await reassignAssignment(adb, admin, id, { reason: 'nope', newReviewerProfileId: guj.id }, (pid) => resolveReviewerProfileById(rdb, pid))
    expect(short.ok).toBe(false)
    const same = await reassignAssignment(adb, admin, id, { reason: 'reassigning to the identical reviewer makes no sense at all', newReviewerProfileId: guj.id }, (pid) => resolveReviewerProfileById(rdb, pid))
    expect(same.ok).toBe(false)
    if (!same.ok) expect(same.error).toContain('no-op')
  })

  test('cancel requires a reason and only applies to open assignments', async () => {
    const guj = await resolveReviewerProfileById(rdb, GUJ_PROFILE_ID)!
    const created = await createAssignment(adb, admin, guj, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'gu:TEXT_UNDERSTANDING', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const id = (created as { ok: true; assignment: { id: string } }).assignment.id
    const short = await cancelAssignment(adb, admin, id, 'gone')
    expect(short.ok).toBe(false)
    const ok = await cancelAssignment(adb, admin, id, 'subject superseded by a newer benchmark version before work started')
    expect(ok.ok).toBe(true)
    expect((await getAssignment(adb, id))!.status).toBe('CANCELLED')
    const again = await cancelAssignment(adb, admin, id, 'cancelling a cancelled assignment should fail clearly')
    expect(again.ok).toBe(false)
  })
})

// ─── A6: disagreement detection ───────────────────────────────────────────────

describe('CI5C A6: disagreement detection', () => {
  test('approval + objection on the same version = disagreement; both preserved; never averaged', () => {
    const res = detectReviewDisagreement([
      { decision: 'APPROVED', reviewerStudentId: 'r1' },
      { decision: 'CHANGES_REQUESTED', reviewerStudentId: 'r2' },
    ])
    expect(res.disagreement).toBe(true)
    expect(res.approvals).toEqual(['r1'])
    expect(res.objections).toEqual([{ decision: 'CHANGES_REQUESTED', reviewerStudentId: 'r2' }])
    expect(res.detail).toContain('both opinions preserved')
  })

  test('unanimous approval or objection-only sets are not disagreements', () => {
    expect(detectReviewDisagreement([{ decision: 'APPROVED', reviewerStudentId: 'r1' }]).disagreement).toBe(false)
    expect(detectReviewDisagreement([{ decision: 'REJECTED', reviewerStudentId: 'r1' }, { decision: 'REJECTED', reviewerStudentId: 'r2' }]).disagreement).toBe(false)
    expect(detectReviewDisagreement([]).disagreement).toBe(false)
  })
})

// ─── A7: routes through real guards ───────────────────────────────────────────

describe('CI5C A7: admin + reviewer routes', () => {
  test('admin queue: 403 for a non-admin session; golden create via session identity', async () => {
    authState.student = { ...REVIEWER_USER, role: 'STUDENT' } as never
    const forbidden = await adminQueueGet(jsonReq('http://localhost/api/admin/ci5/assignments', 'GET'))
    expect([401, 403]).toContain(forbidden.status)

    authState.student = ADMIN as never
    const listed = await adminQueueGet(jsonReq('http://localhost/api/admin/ci5/assignments?status=ASSIGNED', 'GET'))
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as { assignments: { status: string }[] }
    for (const a of listBody.assignments) expect(a.status).toBe('ASSIGNED')

    const guj = await resolveReviewerProfileById(rdb, GUJ_PROFILE_ID)!
    const golden = await adminQueuePost(jsonReq('http://localhost/api/admin/ci5/assignments', 'POST', {
      reviewerProfileId: guj.id,
      subjectType: 'LANGUAGE_CAPABILITY',
      subjectKey: 'gu:TEXT_UNDERSTANDING',
      coiCheck: 'NONE_DECLARED',
    }))
    expect(golden.status).toBe(201)
    const goldenBody = (await golden.json()) as { assignment: { status: string } }
    expect(goldenBody.assignment.status).toBe('ASSIGNED')
    // scope mismatch through the route (Gujarati reviewer ≠ Hindi capability)
    const mismatch = await adminQueuePost(jsonReq('http://localhost/api/admin/ci5/assignments', 'POST', {
      reviewerProfileId: guj.id,
      subjectType: 'LANGUAGE_CAPABILITY',
      subjectKey: 'hi:TRANSLATION',
      coiCheck: 'NONE_DECLARED',
    }))
    expect(mismatch.status).toBe(403)
  })

  test('reviewer queue exposes ONLY the owner assignments; start/recuse routes enforce ownership', async () => {
    authState.student = HINDI_USER as never
    const queue = await reviewerQueueGet(jsonReq('http://localhost/api/ci5/reviewer/assignments', 'GET'))
    expect(queue.status).toBe(200)
    const body = (await queue.json()) as { reviewer: boolean; assignments: { id: string; subjectKey: string }[] }
    expect(body.reviewer).toBe(true)
    for (const a of body.assignments) expect(a.subjectKey.startsWith('hi:')).toBe(true)

    // create an engineering assignment for OTHER_USER through the admin route
    authState.student = ADMIN as never
    const created = await adminQueuePost(jsonReq('http://localhost/api/admin/ci5/assignments', 'POST', {
      reviewerProfileId: ENG_PROFILE_ID,
      subjectType: 'DOMAIN_PACK',
      subjectKey: 'engineering',
      coiCheck: 'NONE_DECLARED',
    }))
    expect(created.status).toBe(201)
    const createdId = ((await created.json()) as { assignment: { id: string } }).assignment.id

    authState.student = REVIEWER_USER as never
    const notOwner = await startRoute(jsonReq('http://localhost/x', 'POST'), { params: Promise.resolve({ assignmentId: createdId }) } as never)
    expect(notOwner.status).toBe(403)

    authState.student = OTHER_USER as never
    const started = await startRoute(jsonReq('http://localhost/x', 'POST'), { params: Promise.resolve({ assignmentId: createdId }) } as never)
    expect(started.status).toBe(200)
    const recused = await recuseRoute(jsonReq('http://localhost/x', 'POST', { reason: 'unavailable for the requested review window' }), { params: Promise.resolve({ assignmentId: createdId }) } as never)
    expect(recused.status).toBe(200)

    // a FRESH engineering assignment, then the reassign route: mathematics
    // reviewer ≠ engineering — the scope gate applies before anything closes
    authState.student = ADMIN as never
    const second = await adminQueuePost(jsonReq('http://localhost/api/admin/ci5/assignments', 'POST', {
      reviewerProfileId: ENG_PROFILE_ID,
      subjectType: 'DOMAIN_PACK',
      subjectKey: 'engineering',
      coiCheck: 'NONE_DECLARED',
    }))
    expect(second.status).toBe(201)
    const secondId = ((await second.json()) as { assignment: { id: string } }).assignment.id
    const reassignMismatch = await reassignRoute(jsonReq('http://localhost/x', 'POST', { reason: 'reviewer became unavailable mid-review', newReviewerProfileId: MATH_PROFILE_ID }), { params: Promise.resolve({ assignmentId: secondId }) } as never)
    expect(reassignMismatch.status).toBe(403)
    // ...and the failed reassignment did not close the fresh assignment
    expect((await getAssignment(adb, secondId))!.status).toBe('ASSIGNED')
  })

  test('lapsed expiresAt accepted at creation is lazily EXPIRED before any submit (admin POST path)', async () => {
    const tamil2 = await resolveReviewerProfileById(rdb, TAMIL2_PROFILE_ID)!
    authState.student = ADMIN as never
    const created = await adminQueuePost(jsonReq('http://localhost/api/admin/ci5/assignments', 'POST', {
      reviewerProfileId: tamil2.id,
      subjectType: 'LANGUAGE_CAPABILITY',
      subjectKey: 'ta:TERMINOLOGY:mathematics-statistics',
      coiCheck: 'NONE_DECLARED',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    }))
    expect(created.status).toBe(201)
    const id = ((await created.json()) as { assignment: { id: string } }).assignment.id
    const lapsed = await getAssignment(adb, id)
    expect(lapsed!.status).toBe('EXPIRED')
    void cancelRoute
  })
})
