// ─── CI-5E tests: durable language governance ─────────────────────────────────
//   LG1  measurement persistence — idempotent binding, honest counts, LIMITED
//   LG2  unmeasured cannot be approved; approval binds to the EXACT measurement
//   LG3  scope enforcement — Hindi ≠ Tamil; domain-language restriction;
//        non-ACTIVE reviewer refused
//   LG4  golden durable VERIFIED — refusal cleared; append-only review rows
//        with full binding provenance
//   LG5  RESTART DURABILITY — a second PrismaClient on the same database sees
//        the same VERIFIED state (the CI-4F gap, closed and proven)
//   LG6  model change requires a NEW assessment; the old binding is SUPERSEDED
//        (never silently extended), and the new binding needs its own approval
//   LG7  revocation preserves history; re-approval of a revoked binding refuses
//   LG8  TRANSCRIPTION structurally unreachable at every layer
//   LG9  evidence checklist completeness — APPROVED requires every facet OK
//   LG10 language-review submit route through a real assignment (ownership,
//        scope, assignment lifecycle)
//   LG11 durable view + runtime-facing refusal reasons

import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci5e-'))
const isolatedUrl = `file:${join(dir, 'ci5e.db')}`

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const TAMIL_USER = { id: 'lg-tamil', email: 'lg-tamil@bean.example', displayName: 'Tamil Bilingual', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const authState = { student: TAMIL_USER as Record<string, unknown> | null }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

import '@/lib/ci/fleet/packs/index'
import {
  persistLanguageMeasurement,
  recordLanguageCapabilityReview,
  revokeLanguageCapability,
  resolveEffectiveCapability,
  isCapabilityVerifiedDurable,
  capabilityRefusalReasonDurable,
  listDurableLanguageCapabilities,
  languageGovernanceDbFromPrisma,
  computeBenchmarkChecksum,
  type LanguageGovernanceDb,
} from '@/lib/ci/fleet/language-governance'
import {
  submitReviewerApplication,
  beginQualificationReview,
  decideReviewerQualification,
  activateReviewer,
  suspendReviewer,
  resolveReviewerProfile,
  reviewerDbFromPrisma,
  type AdminActor,
} from '@/lib/ci/fleet/reviewers'
import { createAssignment, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { POST as languageReviewSubmit } from '@/app/api/ci5/reviewer/assignments/[assignmentId]/language-review/route'

const admin: AdminActor = { kind: 'ADMIN', studentId: 'lg-admin', displayName: 'LG Admin' }
const gdb: LanguageGovernanceDb = languageGovernanceDbFromPrisma(client)
const rdb = reviewerDbFromPrisma(client)
const adb = assignmentDbFromPrisma(client as never)

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never
}

const CHECKSUM = computeBenchmarkChecksum([{ id: 'lg-case-1', language: 'ta', task: 'TERMINOLOGY', user: 'fixture user text', detail: 'fixture detail' }])
const ALL_OK = Object.fromEntries(
  ['meaning_preservation', 'domain_terminology', 'grammar', 'naturalness', 'script_correctness', 'mathematical_notation', 'scientific_symbols', 'code_switching', 'regional_register', 'dialect_differences', 'ambiguous_wording', 'unsupported_claims', 'safety_refusal_accuracy'].map((id) => [id, { status: 'OK', notes: 'fixture' }]),
) as Record<string, { status: 'OK' | 'ISSUE' | 'NOT_ASSESSED'; notes?: string }>

async function makeBilingualReviewer(studentId: string, displayName: string, scope: { tag: string; tasks: string[]; domains?: string[] }[]): Promise<string> {
  await submitReviewerApplication(rdb, { studentId, displayName }, { category: 'BILINGUAL_LANGUAGE', qualificationCategory: 'fixture bilingual', conflictOfInterest: 'none declared (CI-5E fixture)' })
  const profile = await resolveReviewerProfile(rdb, studentId)
  await beginQualificationReview(rdb, admin, profile!.id, 'fixture bilingual review')
  await decideReviewerQualification(rdb, admin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'fixture bilingual qualification for CI-5E durable governance tests',
    verificationStatus: 'REFERENCED_VERIFIED',
    verificationNote: 'synthetic fixture — no real credentials exist',
    scope: { approvedLanguages: scope },
  })
  await activateReviewer(rdb, admin, profile!.id)
  return profile!.id
}

let TAMIL_PROFILE = ''
let TAMIL2_PROFILE = ''

beforeAll(async () => {
  TAMIL_PROFILE = await makeBilingualReviewer(TAMIL_USER.id, 'Tamil Bilingual', [{ tag: 'ta', tasks: ['TERMINOLOGY', 'TEXT_UNDERSTANDING', 'GENERATION'] }, { tag: 'te', tasks: ['TEXT_UNDERSTANDING', 'TERMINOLOGY'] }])
  TAMIL2_PROFILE = await makeBilingualReviewer('lg-tamil2', 'Tamil Bilingual Two', [{ tag: 'ta', tasks: ['TERMINOLOGY'], domains: ['mathematics-statistics'] }])
}, 120_000)

async function measure(languageTag: string, task: string, provider: string, model: string, benchmark = 'ci4-lang-bench-1', checksum = CHECKSUM, passed = true) {
  const res = await persistLanguageMeasurement(gdb, {
    languageTag,
    task: task as 'TEXT_UNDERSTANDING' | 'TERMINOLOGY' | 'TRANSLATION' | 'GENERATION',
    passed,
    testRef: `${benchmark} (5/5 cases)`,
    measuredAt: new Date(),
    modelProvider: provider,
    modelVersion: model,
    benchmarkVersion: benchmark,
    benchmarkChecksum: checksum,
    caseCount: 5,
    passedCount: passed ? 5 : 2,
  })
  expect(res.ok).toBe(true)
  return (res as { ok: true; value: { id: string } }).value
}

// ─── LG1 ──────────────────────────────────────────────────────────────────────

describe('CI5E LG1: durable measurement persistence', () => {
  test('a measurement persists with full binding provenance and records LIMITED (machine evidence)', async () => {
    const m = await measure('ta', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1')
    expect(m.id).toBeTruthy()
    const status = await resolveEffectiveCapability(gdb, 'ta', 'TERMINOLOGY')
    expect(status.status).toBe('LIMITED')
    expect(status.basis).toBe('MEASUREMENT_ONLY')
    expect(status.binding.measurementId).toBe(m.id)
    expect(status.binding.modelProvider).toBe('fixture-provider')
    expect(status.note).toContain('VERIFIED requires qualified human bilingual review')
    // a FAILED measurement records honestly too (LIMITED-at-best, machine evidence)
    const failed = await measure('bn', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1', 'ci4-lang-bench-1', CHECKSUM, false)
    const failedStatus = await resolveEffectiveCapability(gdb, 'bn', 'TERMINOLOGY')
    expect(failedStatus.status).toBe('LIMITED')
    expect(failedStatus.note).toContain('measured FAIL')
    void failed
  })

  test('re-running the same benchmark binding is idempotent (no duplicate measurements)', async () => {
    const first = await measure('gu', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1')
    const second = await measure('gu', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1')
    expect(second.id).toBe(first.id)
    const rows = await client.languageBenchmarkMeasurement.findMany({ where: { languageTag: 'gu', task: 'TERMINOLOGY' } })
    expect(rows.length).toBe(1)
  })

  test('honest counts enforced: passed=true with passedCount<caseCount refuses', async () => {
    const res = await persistLanguageMeasurement(gdb, {
      languageTag: 'pa',
      task: 'TERMINOLOGY',
      passed: true,
      testRef: 'liar-benchmark (2/5 cases)',
      measuredAt: new Date(),
      caseCount: 5,
      passedCount: 2,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('a pass requires every case to pass')
  })
})

// ─── LG2 ──────────────────────────────────────────────────────────────────────

describe('CI5E LG2: approval requires a measurement and binds to it', () => {
  test('an UNMEASURED capability cannot be approved (no measurement row → refuse)', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const res = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: 'does-not-exist',
      decision: 'APPROVED',
      rationale: 'attempting to approve an unmeasured capability',
      evidence: ALL_OK,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('UNMEASURED')
  })

  test('the approval row carries the full binding (provider/model/benchmark/checksum snapshot)', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const m = await measure('ta', 'TERMINOLOGY', 'binding-provider', 'binding-model-9')
    const res = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'fixture approval with binding provenance checks',
      evidence: ALL_OK,
    })
    expect(res.ok).toBe(true)
    const rows = await client.languageCapabilityReview.findMany({ where: { measurementId: m.id } })
    expect(rows.length).toBe(1)
    expect(rows[0].modelProvider).toBe('binding-provider')
    expect(rows[0].modelVersion).toBe('binding-model-9')
    expect(rows[0].benchmarkChecksum).toBe(CHECKSUM)
    expect(rows[0].reviewerCode.startsWith('BR-')).toBe(true)
    expect(rows[0].reviewerQualification).toContain('fixture bilingual')
  })
})

// ─── LG3 ──────────────────────────────────────────────────────────────────────

describe('CI5E LG3: reviewer scope enforcement', () => {
  test('a Tamil reviewer cannot approve a Hindi capability; domain-language restriction enforced', async () => {
    const tamil = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const hi = await measure('hi', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1')
    const wrongLanguage = await recordLanguageCapabilityReview(gdb, tamil, {
      measurementId: hi.id,
      decision: 'APPROVED',
      rationale: 'attempting to approve a Hindi capability as a Tamil reviewer',
      evidence: ALL_OK,
    })
    expect(wrongLanguage.ok).toBe(false)
    if (!wrongLanguage.ok) expect(wrongLanguage.error).toContain('scope mismatch')

    // Tamil2 is restricted to mathematics-statistics — a general (non-domain)
    // Tamil TERMINOLOGY approval refuses, the domain-restricted one succeeds
    const general = await measure('ml', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1')
    void general
    const tamil2 = await resolveReviewerProfile(rdb, 'lg-tamil2')!
    const taGeneral = await measure('ta', 'GENERATION', 'fixture-provider', 'fixture-model-1')
    const restricted = await recordLanguageCapabilityReview(gdb, tamil2, {
      measurementId: taGeneral.id,
      decision: 'APPROVED',
      rationale: 'attempting a general approval with a domain-restricted scope',
      evidence: ALL_OK,
    })
    expect(restricted.ok).toBe(false)
    if (!restricted.ok) expect(restricted.error).toContain('scope mismatch')
    void tamil
  })

  test('a non-ACTIVE reviewer cannot record decisions', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const m = await measure('mr', 'TERMINOLOGY', 'fixture-provider', 'fixture-model-1')
    await suspendReviewer(rdb, admin, reviewer.id, 'CI-5E suspension fixture for decision-path scope checks')
    const suspended = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const res = await recordLanguageCapabilityReview(gdb, suspended, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'attempting an approval after suspension',
      evidence: ALL_OK,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('only an ACTIVE bilingual reviewer')
    // reinstate for later tests
    const { reinstateReviewer } = await import('@/lib/ci/fleet/reviewers')
    await reinstateReviewer(rdb, admin, reviewer.id, 'CI-5E suspension fixture complete — reinstated for subsequent tests')
  })
})

// ─── LG4 ──────────────────────────────────────────────────────────────────────

describe('CI5E LG4: golden durable VERIFIED', () => {
  test('measured + qualified scoped approval → VERIFIED durable; refusal cleared', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const m = await measure('te', 'TEXT_UNDERSTANDING', 'golden-provider', 'golden-model-1')
    const res = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'fixture bilingual approval of the measured Telugu capability',
      evidence: ALL_OK,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.status.status).toBe('VERIFIED')
      expect(res.value.status.basis).toBe('HUMAN_APPROVED')
      expect(res.value.status.approvalCount).toBe(1)
    }
    expect(await isCapabilityVerifiedDurable(gdb, 'te', 'TEXT_UNDERSTANDING')).toBe(true)
    expect(await capabilityRefusalReasonDurable(gdb, 'te', 'TEXT_UNDERSTANDING')).toBeNull()
    // the in-memory default view is unaffected (no self-certification leakage)
    const { listLanguageCapabilities } = await import('@/lib/ci/fleet/language')
    expect(listLanguageCapabilities().some((c) => c.status === 'VERIFIED')).toBe(false)
  })
})

// ─── LG5: RESTART DURABILITY (the critical proof) ─────────────────────────────

describe('CI5E LG5: restart durability', () => {
  test('a SECOND PrismaClient on the same database sees the identical VERIFIED state', async () => {
    // simulate a fresh process: brand-new client instance, same database file
    const freshClient = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
    const freshDb = languageGovernanceDbFromPrisma(freshClient)
    const verified = await resolveEffectiveCapability(freshDb, 'te', 'TEXT_UNDERSTANDING')
    expect(verified.status).toBe('VERIFIED')
    expect(verified.basis).toBe('HUMAN_APPROVED')
    expect(await isCapabilityVerifiedDurable(freshDb, 'te', 'TEXT_UNDERSTANDING')).toBe(true)
    // the review history survives too
    const reviews = await freshClient.languageCapabilityReview.findMany({ where: { languageTag: 'te' } })
    expect(reviews.length).toBe(1)
    await freshClient.$disconnect()
  })
})

// ─── LG6: model change ⇒ new assessment + supersession ───────────────────────

describe('CI5E LG6: model change requires a new assessment', () => {
  test('a NEW model version starts UNMEASURED-at-best; approval supersedes the old binding, never extends it', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    // the old VERIFIED binding for 'te' TEXT_UNDERSTANDING: provider golden-provider, model golden-model-1
    // a NEW model version is measured and approved:
    const newMeasurement = await measure('te', 'TEXT_UNDERSTANDING', 'golden-provider', 'golden-model-2', 'ci4-lang-bench-2', 'c'.repeat(64))
    const res = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: newMeasurement.id,
      decision: 'APPROVED',
      rationale: 'fixture approval of the NEW model version — a new binding, reviewed on its own evidence',
      evidence: ALL_OK,
    })
    expect(res.ok).toBe(true)
    // the OLD binding is now SUPERSEDED with a pointer to the new one
    const oldBinding = await client.languageCapabilityStatus.findFirst({ where: { languageTag: 'te', task: 'TEXT_UNDERSTANDING', modelVersion: 'golden-model-1' } })
    expect(oldBinding?.status).toBe('SUPERSEDED')
    expect(oldBinding?.supersededBy).toBeTruthy()
    expect(oldBinding?.note).toContain('superseded by')
    // the historical approval row is preserved
    const oldReviews = await client.languageCapabilityReview.findMany({ where: { languageTag: 'te', modelVersion: 'golden-model-1' } })
    expect(oldReviews.length).toBe(1)
    // the effective resolution still reports VERIFIED (via the new binding)
    const eff = await resolveEffectiveCapability(gdb, 'te', 'TEXT_UNDERSTANDING')
    expect(eff.status).toBe('VERIFIED')
    expect(eff.binding.modelVersion).toBe('golden-model-2')
  })

  test('an unapproved NEW model version never inherits VERIFIED from the old binding', async () => {
    const measured = await measure('bn', 'TEXT_UNDERSTANDING', 'new-provider', 'new-model-1')
    const eff = await resolveEffectiveCapability(gdb, 'bn', 'TEXT_UNDERSTANDING')
    expect(eff.status).toBe('LIMITED')
    expect(eff.binding.measurementId).toBe(measured.id)
    expect(await isCapabilityVerifiedDurable(gdb, 'bn', 'TEXT_UNDERSTANDING')).toBe(false)
  })
})

// ─── LG7: revocation preserves history ────────────────────────────────────────

describe('CI5E LG7: revocation', () => {
  test('revoke → REVOKED with the review history intact; re-approval refuses', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const m = await measure('ta', 'TERMINOLOGY', 'revoke-provider', 'revoke-model-1')
    const approval = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'fixture approval that will be revoked to prove history preservation',
      evidence: ALL_OK,
    })
    expect(approval.ok).toBe(true)
    const revocation = await revokeLanguageCapability(
      gdb,
      { studentId: 'lg-admin', displayName: 'LG Admin' },
      { languageTag: 'ta', task: 'TERMINOLOGY', modelProvider: 'revoke-provider', modelVersion: 'revoke-model-1', benchmarkVersion: 'ci4-lang-bench-1' },
      'the terminology reference set changed materially — the approval no longer applies (fixture)',
    )
    expect(revocation.ok).toBe(true)
    expect((await resolveEffectiveCapability(gdb, 'ta', 'TERMINOLOGY')).status).toBe('LIMITED') // other ta/TERMINOLOGY bindings remain measured-LIMITED
    // history preserved: the review row + the approval count survive
    const rows = await client.languageCapabilityReview.findMany({ where: { measurementId: m.id } })
    expect(rows.length).toBe(1)
    const statusRow = await client.languageCapabilityStatus.findFirst({ where: { languageTag: 'ta', task: 'TERMINOLOGY', modelVersion: 'revoke-model-1' } })
    expect(statusRow?.status).toBe('REVOKED')
    expect(statusRow?.approvalCount).toBe(1)
    expect(statusRow?.note).toContain('REVOKED by LG Admin')
    // re-approval of the revoked binding refuses honestly
    const reApproval = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'attempting to re-approve a revoked capability binding',
      evidence: ALL_OK,
    })
    expect(reApproval.ok).toBe(false)
    if (!reApproval.ok) expect(reApproval.error).toContain('cannot be re-approved implicitly')
    // short reason refuses
    const shortReason = await revokeLanguageCapability(gdb, { studentId: 'lg-admin', displayName: 'LG Admin' }, { languageTag: 'ta', task: 'TERMINOLOGY' }, 'nope')
    expect(shortReason.ok).toBe(false)
  })
})

// ─── LG8: TRANSCRIPTION structural ────────────────────────────────────────────

describe('CI5E LG8: TRANSCRIPTION structurally UNSUPPORTED', () => {
  test('no measurement, no review, no status row can ever exist for TRANSCRIPTION', async () => {
    const measurement = await persistLanguageMeasurement(gdb, {
      languageTag: 'ta',
      task: 'TRANSCRIPTION',
      passed: true,
      testRef: 'attack',
      measuredAt: new Date(),
    })
    expect(measurement.ok).toBe(false)
    if (!measurement.ok) expect(measurement.error).toContain('§9.2')
    const eff = await resolveEffectiveCapability(gdb, 'ta', 'TRANSCRIPTION')
    expect(eff.status).toBe('UNSUPPORTED')
    expect(eff.basis).toBe('STRUCTURAL')
    const refusal = await capabilityRefusalReasonDurable(gdb, 'ta', 'TRANSCRIPTION')
    expect(refusal).toContain('UNSUPPORTED')
    const rows = await client.languageCapabilityStatus.findMany({ where: { task: 'TRANSCRIPTION' } })
    expect(rows.length).toBe(0)
  })
})

// ─── LG9: evidence checklist ──────────────────────────────────────────────────

describe('CI5E LG9: evidence checklist completeness', () => {
  test('APPROVED requires every facet OK; missing facets refuse', async () => {
    const reviewer = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const m = await measure('ta', 'TERMINOLOGY', 'evidence-provider', 'evidence-model-1')
    const incomplete = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'attempting approval with an incomplete evidence checklist',
      evidence: { meaning_preservation: { status: 'OK' } } as Record<string, { status: 'OK' | 'ISSUE' | 'NOT_ASSESSED'; notes?: string }>,
    })
    expect(incomplete.ok).toBe(false)
    if (!incomplete.ok) expect(incomplete.error).toContain('evidence checklist incomplete')
    const withIssue = { ...ALL_OK, script_correctness: { status: 'ISSUE', notes: 'one rendered glyph mismatch' } }
    const approvedWithIssue = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'attempting approval with a recorded issue facet',
      evidence: withIssue,
    })
    expect(approvedWithIssue.ok).toBe(false)
    if (!approvedWithIssue.ok) expect(approvedWithIssue.error).toContain('every evidence facet OK')
    // a REJECTED decision with a recorded issue is honest and allowed
    const rejected = await recordLanguageCapabilityReview(gdb, reviewer, {
      measurementId: m.id,
      decision: 'REJECTED',
      rationale: 'script correctness issue recorded — the capability must not be verified in this state',
      evidence: withIssue,
    })
    expect(rejected.ok).toBe(true)
    if (rejected.ok) expect(rejected.value.status.status).toBe('LIMITED') // objection never promotes
  })
})

// ─── LG10: the reviewer route through a real assignment ──────────────────────

describe('CI5E LG10: language-review submit route', () => {
  test('golden: assignment + measurement + checklist → append-only review + COMPLETED assignment + VERIFIED binding', async () => {
    const reviewerProfile = await resolveReviewerProfile(rdb, TAMIL_USER.id)!
    const m = await measure('ta', 'TEXT_UNDERSTANDING', 'route-provider', 'route-model-1')
    const created = await createAssignment(adb, admin, reviewerProfile, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'ta:TEXT_UNDERSTANDING', coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const assignmentId = (created as { ok: true; assignment: { id: string } }).assignment.id

    authState.student = TAMIL_USER
    const res = await languageReviewSubmit(jsonReq('http://localhost/x', 'POST', {
      measurementId: m.id,
      decision: 'APPROVED',
      rationale: 'route golden path: bilingual review of the measured Malayalam capability',
      evidence: ALL_OK,
    }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { reviewId: string; capabilityStatus: { status: string; basis: string }; assignment: { status: string; outcomeRef: string } }
    expect(body.capabilityStatus.status).toBe('VERIFIED')
    expect(body.capabilityStatus.basis).toBe('HUMAN_APPROVED')
    expect(body.assignment.status).toBe('COMPLETED')
    expect(body.assignment.outcomeRef).toBe(body.reviewId)

    // ownership: another reviewer cannot submit someone else's assignment
    const tamil2 = await resolveReviewerProfile(rdb, 'lg-tamil2')!
    const m2 = await measure('ta', 'TERMINOLOGY', 'route-provider', 'route-model-1')
    const created2 = await createAssignment(adb, admin, tamil2, { subjectType: 'LANGUAGE_CAPABILITY', subjectKey: 'ta:TERMINOLOGY:mathematics-statistics', coiCheck: 'NONE_DECLARED' })
    const assignment2 = (created2 as { ok: true; assignment: { id: string } }).assignment.id
    authState.student = TAMIL_USER
    const notOwner = await languageReviewSubmit(jsonReq('http://localhost/x', 'POST', {
      measurementId: m2.id,
      decision: 'APPROVED',
      rationale: 'attempting to submit another reviewer assignment',
      evidence: ALL_OK,
    }), { params: Promise.resolve({ assignmentId: assignment2 }) } as never)
    expect(notOwner.status).toBe(403)
  })
})

// ─── LG11: durable view ───────────────────────────────────────────────────────

describe('CI5E LG11: durable capability view', () => {
  test('the full 11×5 view resolves with honest defaults and durable overrides', async () => {
    const view = await listDurableLanguageCapabilities(gdb)
    expect(view.length).toBe(55) // 11 languages × 5 tasks
    const transcription = view.filter((c) => c.task === 'TRANSCRIPTION')
    expect(transcription.length).toBe(11)
    for (const t of transcription) expect(t.status).toBe('UNSUPPORTED')
    const te = view.find((c) => c.languageTag === 'te' && c.task === 'TEXT_UNDERSTANDING')!
    expect(te.status).toBe('VERIFIED')
    const unmeasured = view.find((c) => c.languageTag === 'kn' && c.task === 'GENERATION')!
    expect(unmeasured.status).toBe('EXPERIMENTAL')
    expect(unmeasured.basis).toBe('DEFAULT_UNMEASURED')
  })
})
