// ─── CI-5G tests: classroom-report audit pilot + governance surfaces ──────────
//   G1  masked evidence view — student data removed, class metadata separated,
//        unobservable dimensions honest
//   G2  checksum binding — a changed report refuses; corrections are NEW rows
//   G3  verdict/finding consistency — NOT_SUPPORTED requires concrete findings
//   G4  pilot fixture — clearly-labelled synthetic report through the admin
//        route, audited through the assignment flow end to end
//   G5  ownership — the masked view is restricted to assigned reviewers
//   G6  Evidence Auditor findings preserved; disputes not bypassed
//   G7  reviewer/admin workspace source guards — real APIs, no mock data

import { describe, test, expect, beforeAll, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci5g-'))
const isolatedUrl = `file:${join(dir, 'ci5g.db')}`

execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const ADMIN = { id: 'g-admin', email: 'g@bean.example', displayName: 'G Admin', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const REVIEWER_USER = { id: 'g-reviewer', email: 'gr@bean.example', displayName: 'G Reviewer', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const OTHER_USER = { id: 'g-other', email: 'go@bean.example', displayName: 'G Other', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const authState = { student: REVIEWER_USER as Record<string, unknown> | null }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

// requireAdmin reads requireStudent from '@/lib/teach' — that module imports
// the real auth; the auth mock above covers it (same mock.module binding).
import '@/lib/ci/fleet/packs/index'
import {
  buildMaskedReportView,
  recordClassroomReportAuditReview,
  reportAuditDbFromPrisma,
  UNOBSERVABLE_DIMENSIONS,
} from '@/lib/ci/fleet/report-audit'
import {
  submitReviewerApplication,
  beginQualificationReview,
  decideReviewerQualification,
  activateReviewer,
  resolveReviewerProfile,
  resolveReviewerProfileById,
  reviewerDbFromPrisma,
  type AdminActor,
} from '@/lib/ci/fleet/reviewers'
import { createAssignment, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { PUT as pilotFixturePut, GET as auditsGet } from '@/app/api/admin/ci5/report-audits/route'
import { POST as reportAuditSubmit } from '@/app/api/ci5/reviewer/assignments/[assignmentId]/report-audit/route'
import { POST as reportViewPost } from '@/app/api/ci5/reviewer/report-view/route'

const admin: AdminActor = { kind: 'ADMIN', studentId: ADMIN.id, displayName: 'G Admin' }
const rdb = reviewerDbFromPrisma(client)
const adb = assignmentDbFromPrisma(client as never)
const radb = reportAuditDbFromPrisma(client)

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never
}

let REVIEWER_PROFILE = ''

beforeAll(async () => {
  await submitReviewerApplication(rdb, { studentId: REVIEWER_USER.id, displayName: 'G Reviewer' }, { category: 'DOMAIN_EXPERT', qualificationCategory: 'fixture pedagogy reviewer', conflictOfInterest: 'none declared (CI-5G fixture)' })
  const profile = await resolveReviewerProfile(rdb, REVIEWER_USER.id)
  await beginQualificationReview(rdb, admin, profile!.id, 'fixture review')
  await decideReviewerQualification(rdb, admin, profile!.id, {
    decision: 'APPROVED',
    rationale: 'fixture pedagogy reviewer for the CI-5G report-audit pilot',
    verificationStatus: 'REFERENCED_VERIFIED',
    verificationNote: 'synthetic fixture — no real credentials exist',
    scope: { approvedDomains: ['education-pedagogy'] },
  })
  await activateReviewer(rdb, admin, profile!.id)
  REVIEWER_PROFILE = profile!.id
}, 120_000)

let REPORT_ID = ''

beforeAll(async () => {
  // the fixture route resolves real account rows — seed the admin Student
  await client.student.create({
    data: {
      id: ADMIN.id,
      email: ADMIN.email,
      displayName: ADMIN.displayName as string,
      role: 'ADMIN',
      passwordHash: 'fixture-not-a-real-credential',
      onboardedAt: new Date(),
    } as never,
  })
  // create the pilot fixture through the admin route (real DB rows)
  authState.student = ADMIN as never
  const res = await pilotFixturePut(jsonReq('http://localhost/x', 'PUT', {}))
  expect(res.status).toBe(201)
  const body = (await res.json()) as { pilotFixture: { reportId: string } }
  REPORT_ID = body.pilotFixture.reportId
  expect(REPORT_ID).toBeTruthy()
}, 120_000)

// ─── G1 ───────────────────────────────────────────────────────────────────────

describe('CI5G G1: masked evidence view', () => {
  test('student name/email masked; class metadata separated from teaching evidence; unobservable dimensions marked', async () => {
    const view = await buildMaskedReportView(radb, REPORT_ID)
    expect(view.ok).toBe(true)
    if (!view.ok) return
    const serialized = JSON.stringify(view.view)
    expect(serialized).not.toContain('Fixture Student Name')
    expect(serialized).not.toContain('fixture-student@example.invalid')
    expect(serialized).toContain('[masked — not necessary for the review]')
    expect(view.view.classMetadata).toBeTruthy()
    expect(view.view.teachingEvidence).toBeTruthy()
    expect(view.view.unobservableDimensions).toEqual(UNOBSERVABLE_DIMENSIONS)
    expect(view.view.maskingNote).toContain('masked')
    // the Evidence Auditor's findings are present and untouched
    expect(view.view.evidenceAuditorFindings).toBeTruthy()
  })

  test('a missing report refuses honestly', async () => {
    const res = await buildMaskedReportView(radb, 'no-such-report')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(404)
  })
})

// ─── G2/G3 ────────────────────────────────────────────────────────────────────

describe('CI5G G2–G3: audit recording rules', () => {
  test('checksum binding: a stale checksum refuses; corrections are NEW rows on the same version', async () => {
    const reviewer = await resolveReviewerProfile(rdb, REVIEWER_USER.id)!
    const view = await buildMaskedReportView(radb, REPORT_ID)
    const checksum = (view as { ok: true; view: { reportChecksum: string } }).view.reportChecksum
    // golden audit
    const ok = await recordClassroomReportAuditReview(radb, reviewer, {
      reportId: REPORT_ID,
      reportChecksum: checksum,
      verdict: 'CORRECTIONS_RECORDED',
      supportedFindings: ['two algebra examples worked through — matches the teacher notes evidence'],
      unsupportedFindings: ['students asked five questions — no evidence channel supports this claim'],
      ambiguousFindings: ['pacing appeared uneven — the structured timeline is weak evidence for pacing'],
      unobservableMarkers: UNOBSERVABLE_DIMENSIONS,
      rationale: 'the report over-claims question counts; the observable claims are supported by the notes evidence',
    })
    expect(ok.ok).toBe(true)
    // stale checksum refuses (report content changed since inspection)
    const stale = await recordClassroomReportAuditReview(radb, reviewer, {
      reportId: REPORT_ID,
      reportChecksum: '9'.repeat(64),
      verdict: 'SUPPORTED',
      supportedFindings: ['attempting to audit a version that changed'],
      unsupportedFindings: [],
      ambiguousFindings: [],
      unobservableMarkers: [],
      rationale: 'stale checksum attempt must refuse honestly',
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.status).toBe(409)
    // corrections are NEW rows (append-only)
    const second = await recordClassroomReportAuditReview(radb, reviewer, {
      reportId: REPORT_ID,
      reportChecksum: checksum,
      verdict: 'PARTIALLY_SUPPORTED',
      supportedFindings: ['claims matching the notes evidence confirmed on re-inspection'],
      unsupportedFindings: ['the question-count claim remains unsupported'],
      ambiguousFindings: [],
      unobservableMarkers: UNOBSERVABLE_DIMENSIONS,
      rationale: 're-review after the corrections were recorded — a new audit row, never an edit',
    })
    expect(second.ok).toBe(true)
    const rows = await client.classroomReportAuditReview.findMany({ where: { reportId: REPORT_ID } })
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.evidenceAuditorFindingsPreserved).toBe(true)
      expect(row.reviewerCode.startsWith('BR-')).toBe(true)
    }
  })

  test('NOT_SUPPORTED / CORRECTIONS_RECORDED require concrete unsupported findings', async () => {
    const reviewer = await resolveReviewerProfile(rdb, REVIEWER_USER.id)!
    const view = await buildMaskedReportView(radb, REPORT_ID)
    const checksum = (view as { ok: true; view: { reportChecksum: string } }).view.reportChecksum
    const bad = await recordClassroomReportAuditReview(radb, reviewer, {
      reportId: REPORT_ID,
      reportChecksum: checksum,
      verdict: 'NOT_SUPPORTED',
      supportedFindings: [],
      unsupportedFindings: [], // refusing without naming findings
      ambiguousFindings: [],
      unobservableMarkers: [],
      rationale: 'attempting a rejection without naming concrete unsupported claims',
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('requires concrete unsupported findings')
  })
})

// ─── G4/G5 ────────────────────────────────────────────────────────────────────

describe('CI5G G4–G5: assignment flow + restricted masked view', () => {
  test('end-to-end: assignment → masked view → audit submit → COMPLETED with outcomeRef; ownership enforced at every step', async () => {
    const reviewerProfile = await resolveReviewerProfileById(rdb, REVIEWER_PROFILE)!
    const created = await createAssignment(adb, admin, reviewerProfile, { subjectType: 'CLASSROOM_REPORT', subjectKey: REPORT_ID, coiCheck: 'NONE_DECLARED' })
    expect(created.ok).toBe(true)
    const assignmentId = (created as { ok: true; assignment: { id: string } }).assignment.id

    // ownership: another account cannot load the masked view or submit
    authState.student = OTHER_USER as never
    const stolenView = await reportViewPost(jsonReq('http://localhost/x', 'POST', { reportId: REPORT_ID }))
    expect(stolenView.status).toBe(403)
    const stolenSubmit = await reportAuditSubmit(jsonReq('http://localhost/x', 'POST', { reportChecksum: '0'.repeat(64), verdict: 'SUPPORTED', rationale: 'not my assignment but trying anyway' }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(stolenSubmit.status).toBe(403)

    // the assigned reviewer loads the masked view through the route
    authState.student = REVIEWER_USER as never
    const viewRes = await reportViewPost(jsonReq('http://localhost/x', 'POST', { reportId: REPORT_ID }))
    expect(viewRes.status).toBe(200)
    const viewBody = (await viewRes.json()) as { maskedView: { reportChecksum: string; reportVersion: number } }
    expect(viewBody.maskedView.reportVersion).toBe(1)

    // golden audit submit through the assignment
    const submit = await reportAuditSubmit(jsonReq('http://localhost/x', 'POST', {
      reportChecksum: viewBody.maskedView.reportChecksum,
      verdict: 'PARTIALLY_SUPPORTED',
      supportedFindings: ['the worked-examples claim matches the evidence'],
      unsupportedFindings: ['the five-questions claim is not supported by any evidence channel'],
      ambiguousFindings: [],
      unobservableMarkers: UNOBSERVABLE_DIMENSIONS,
      rationale: 'route golden audit: the masked view was inspected and the claims checked against it',
    }), { params: Promise.resolve({ assignmentId }) } as never)
    expect(submit.status).toBe(201)
    const submitBody = (await submit.json()) as { reviewId: string; assignment: { status: string; outcomeRef: string } }
    expect(submitBody.assignment.status).toBe('COMPLETED')
    expect(submitBody.assignment.outcomeRef).toBe(submitBody.reviewId)
  })

  test('audit register surfaces the verdicts with findings counts', async () => {
    authState.student = ADMIN as never
    const res = await auditsGet(jsonReq('http://localhost/x', 'GET'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { audits: { verdict: string; unsupportedCount: number; evidenceAuditorFindingsPreserved: boolean }[] }
    expect(body.audits.length).toBeGreaterThanOrEqual(3)
    for (const a of body.audits) expect(a.evidenceAuditorFindingsPreserved).toBe(true)
    expect(body.audits.some((a) => a.unsupportedCount > 0)).toBe(true)
  })
})

// ─── G6/G7 ────────────────────────────────────────────────────────────────────

describe('CI5G G6–G7: preserved findings + honest UI sources', () => {
  test('the Evidence Auditor findings are untouched in the report row after audits', async () => {
    const report = await client.classroomEvaluationReport.findFirst({ where: { id: REPORT_ID } })
    const parsed = JSON.parse(report!.reportJson) as { auditor: { verdict: string } }
    expect(parsed.auditor.verdict).toBe('PASS_WITH_NOTES')
    expect(report!.status).toBe('CURRENT') // audits never edit the report
  })

  test('source guards: the governance UI uses real backend APIs — no mock data, no fabricated metrics', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/components/bean/ci5-reviewer-governance.tsx', 'utf8')
    expect(src).toContain('/api/admin/ci5/reviewers')
    expect(src).toContain('/api/ci5/reviewer/assignments')
    expect(src).toContain('/api/admin/ci5/language/capabilities')
    expect(src).not.toMatch(/mockData|fakeMetrics|MOCK_REVIEWERS|sampleReviewers/i)
    // the dispute flow is not bypassed: no route here creates disputes or mutates them
    const auditRoute = readFileSync('src/app/api/ci5/reviewer/assignments/[assignmentId]/report-audit/route.ts', 'utf8')
    expect(auditRoute).toContain('Trust workflow')
    expect(auditRoute).not.toContain('classroomEvaluationDispute.create')
  })
})
