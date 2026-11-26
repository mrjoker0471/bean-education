// ─── BEAN Classroom Intelligence (CI-7F): evaluation readiness tests ─────────
//   F1  empty ledgers → INSUFFICIENT EVIDENCE with the explicit missing list
//       (no metric is ever produced from nothing)
//   F2  below-threshold human labels → INSUFFICIENT EVIDENCE (no score)
//   F3  a single independent reviewer cannot ground an evaluation (independence)
//   F4  unversioned model binding → INSUFFICIENT EVIDENCE (self-certification guard)
//   F5  deterministic-only rows never count as human evidence
//   F6  a fully genuine setup reaches EVALUABLE — scoped to the exact dataset
//       version + checksum + cohort, never a universal validation claim
//   F7  the readiness path reads the REAL CI-5F ledgers (dataset + labels via
//       pilotEvaluationReadinessFromDb) and the route is admin-only
//   F8  the language authority is untouched: TRANSCRIPTION stays structurally
//       UNSUPPORTED regardless of any domain evaluation state

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7f-'))
const isolatedUrl = `file:${join(tmp, 'ci7f.db')}`
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

const {
  CI7_EVALUATION_MIN_HUMAN_LABELS,
  CI7_EVALUATION_MIN_LABELLED_CASES,
  CI7_EVALUATION_MIN_INDEPENDENT_REVIEWERS,
  evaluatePilotEvaluationReadiness,
  pilotEvaluationReadinessFromDb,
} = await import('@/lib/ci/fleet/pilot')

const readinessRoute = await import('@/app/api/admin/ci7/evaluation-readiness/route')

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

const DATASET = { slug: 'ci7-pilot-eval', version: '1.0.0', checksum: 'c'.repeat(64), split: 'VALIDATION' }
const MODEL = { provider: 'ci7-eval-design', version: 'approved-design-v1' }

function humanLabel(caseKey: string, reviewerProfileId: string) {
  return { caseKey, reviewerProfileId, rubricVersion: 'ci5-expert-label-rubric-1' }
}

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  await client.student.create({ data: { email: `ci7f-admin-${s}@bean.test`, role: 'ADMIN' } })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7F evaluation readiness', () => {
  test('F1: empty ledgers → INSUFFICIENT EVIDENCE with the explicit missing list', () => {
    const result = evaluatePilotEvaluationReadiness({ dataset: null, labels: [], modelBinding: null })
    expect(result.status).toBe('INSUFFICIENT EVIDENCE')
    expect(result.missing.length).toBeGreaterThanOrEqual(4)
    expect(result.note).toContain('INSUFFICIENT EVIDENCE')
    expect(result.humanLabels).toBe(0)
    expect(result.labelledCases).toBe(0)
    expect(result.independentReviewers).toBe(0)
  })

  test('F2: below-threshold human labels → INSUFFICIENT EVIDENCE (no score)', () => {
    const labels = Array.from({ length: 4 }, (_, i) => humanLabel(`case-${i}`, 'prof-1'))
    const result = evaluatePilotEvaluationReadiness({ dataset: DATASET, labels, modelBinding: MODEL })
    expect(result.status).toBe('INSUFFICIENT EVIDENCE')
    expect(result.humanLabels).toBe(4)
    expect(result.missing.some((m) => m.includes(`at least ${CI7_EVALUATION_MIN_HUMAN_LABELS} reviewer-bound labels`))).toBe(true)
    expect(result.missing.some((m) => m.includes(`at least ${CI7_EVALUATION_MIN_LABELLED_CASES} labelled cases`))).toBe(true)
  })

  test('F3: a single independent reviewer cannot ground an evaluation', () => {
    const labels = Array.from({ length: 12 }, (_, i) => humanLabel(`case-${i}`, 'prof-1'))
    const result = evaluatePilotEvaluationReadiness({ dataset: DATASET, labels, modelBinding: MODEL })
    expect(result.status).toBe('INSUFFICIENT EVIDENCE')
    expect(result.missing.some((m) => m.includes(`at least ${CI7_EVALUATION_MIN_INDEPENDENT_REVIEWERS} independent qualified reviewers`))).toBe(true)
    expect(CI7_EVALUATION_MIN_INDEPENDENT_REVIEWERS).toBe(2)
  })

  test('F4: an unversioned model binding refuses — no self-certification path', () => {
    const labels = Array.from({ length: 12 }, (_, i) => humanLabel(`case-${i}`, i % 2 === 0 ? 'prof-1' : 'prof-2'))
    const unbound = evaluatePilotEvaluationReadiness({ dataset: DATASET, labels, modelBinding: null })
    expect(unbound.status).toBe('INSUFFICIENT EVIDENCE')
    expect(unbound.missing.some((m) => m.includes('model provider + exact model version'))).toBe(true)
    const unversioned = evaluatePilotEvaluationReadiness({ dataset: DATASET, labels, modelBinding: { provider: 'x', version: '' } })
    expect(unversioned.status).toBe('INSUFFICIENT EVIDENCE')
  })

  test('F5: deterministic-only rows never count as human evidence', () => {
    const human = Array.from({ length: 6 }, (_, i) => humanLabel(`case-${i}`, i % 2 === 0 ? 'prof-1' : 'prof-2'))
    const deterministicOnly = Array.from({ length: 20 }, (_, i) => ({ caseKey: `dcase-${i}`, reviewerProfileId: null, rubricVersion: null }))
    const result = evaluatePilotEvaluationReadiness({ dataset: DATASET, labels: [...human, ...deterministicOnly], modelBinding: MODEL })
    expect(result.deterministicOnlyLabels).toBe(20)
    expect(result.humanLabels).toBe(6)
    expect(result.status).toBe('INSUFFICIENT EVIDENCE') // 6 < 10 human labels
    expect(result.missing.some((m) => m.includes('deterministic-only rows do not count as human evidence'))).toBe(true)
  })

  test('F6: a fully genuine setup reaches EVALUABLE — scoped, never universal', () => {
    const labels = Array.from({ length: 12 }, (_, i) => humanLabel(`case-${i}`, i % 2 === 0 ? 'prof-1' : 'prof-2'))
    const result = evaluatePilotEvaluationReadiness({ dataset: DATASET, labels, modelBinding: MODEL })
    expect(result.status).toBe('EVALUABLE')
    expect(result.missing).toEqual([])
    expect(result.labelledCases).toBe(12)
    expect(result.independentReviewers).toBe(2)
    // the EVALUABLE note scopes the result explicitly
    expect(result.note).toContain('PILOT SCOPE ONLY')
    expect(result.note).toContain('never a universal model validation')
    // the holdout policy is the existing CI-5F policy, stated verbatim
    expect(result.holdoutPolicy).toContain('BLIND_HOLDOUT')
    expect(result.holdoutPolicy).toContain('sealed until scoring')
  })

  test('F7: readiness reads the REAL CI-5F ledgers; the route is admin-only', async () => {
    // real dataset + labels through the CI-5F service
    const { createBenchmarkDataset, addExpertCaseLabel, benchmarkDbFromPrisma } = await import('@/lib/ci/fleet/expert-benchmarks')
    const { submitReviewerApplication, decideReviewerQualification, activateReviewer, reviewerDbFromPrisma } = await import('@/lib/ci/fleet/reviewers')
    const bdb = benchmarkDbFromPrisma(client)
    const s = randomUUID().slice(0, 8)
    const admin = await client.student.create({ data: { email: `ci7f-admin2-${s}@bean.test`, role: 'ADMIN' } })
    const r1 = await client.student.create({ data: { email: `ci7f-r1-${s}@bean.test`, role: 'STUDENT' } })
    const r2 = await client.student.create({ data: { email: `ci7f-r2-${s}@bean.test`, role: 'STUDENT' } })
    const cases = Array.from({ length: 12 }, (_, i) => ({
      caseKey: `edu-case-${i}`,
      prompt: `pedagogy evaluation case ${i}: judge the grounded definition against the pack content`,
      deterministicCheck: 'NONE' as const,
    }))
    const created = await createBenchmarkDataset(bdb, { studentId: admin.id, displayName: 'Admin' }, {
      slug: 'ci7-pilot-eval-real', name: 'CI-7 pilot eval (real)', taskKind: 'SUBJECT_CORRECTNESS', split: 'VALIDATION',
      version: '1.0.0', licence: 'BEAN-AUTHORED-ORIGINAL', domain: 'education-pedagogy', cases,
    })
    expect(created.ok).toBe(true)
    const activate = async (studentId: string) => {
      const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId, displayName: 'R' }, {
        category: 'DOMAIN_EXPERT', conflictOfInterest: 'none declared', qualificationCategory: 'qualified educator', consentGranted: true,
      })
      const profileId = (applied as { profile: { id: string } }).profile.id
      await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: admin.id, displayName: 'Admin' }, profileId, {
        decision: 'APPROVED', rationale: 'credential examination recorded', verificationStatus: 'DOCUMENT_REVIEWED',
        scope: { approvedDomains: ['education-pedagogy'] },
      })
      await activateReviewer(reviewerDbFromPrisma(client), { studentId: admin.id, displayName: 'Admin' }, profileId)
      return (await client.expertReviewerProfile.findUnique({ where: { id: profileId } }))!
    }
    const profile1 = await activate(r1.id)
    const profile2 = await activate(r2.id)
    for (let i = 0; i < 12; i++) {
      const labelled = await addExpertCaseLabel(bdb, profile1, {
        datasetSlug: 'ci7-pilot-eval-real', datasetVersion: '1.0.0', caseKey: `edu-case-${i}`,
        expectedResults: { expected: 'grounded answer' }, prohibitedConclusions: [], supportingSources: [], confidence: 'HIGH',
      })
      expect(labelled.ok).toBe(true)
      const labelled2 = await addExpertCaseLabel(bdb, profile2, {
        datasetSlug: 'ci7-pilot-eval-real', datasetVersion: '1.0.0', caseKey: `edu-case-${i}`,
        expectedResults: { expected: 'grounded answer' }, prohibitedConclusions: [], supportingSources: [], confidence: 'HIGH',
      })
      expect(labelled2.ok).toBe(true)
    }
    // 24 human labels from 2 independent reviewers, 12 cases → EVALUABLE
    const readiness = await pilotEvaluationReadinessFromDb(bdb, 'ci7-pilot-eval-real', '1.0.0', { provider: 'design', version: 'v1' })
    expect(readiness.status).toBe('EVALUABLE')
    expect(readiness.humanLabels).toBe(24)
    expect(readiness.independentReviewers).toBe(2)
    // missing dataset → honest INSUFFICIENT EVIDENCE (no fallback to another dataset)
    const missing = await pilotEvaluationReadinessFromDb(bdb, 'nonexistent-dataset', '9.9.9', MODEL)
    expect(missing.status).toBe('INSUFFICIENT EVIDENCE')
    // route authorization
    setSession(null)
    const anon = await readinessRoute.GET(req('/api/admin/ci7/evaluation-readiness?datasetSlug=x&datasetVersion=1'))
    expect(anon.status).toBe(401)
    setSession('student', 'STUDENT')
    const nonAdmin = await readinessRoute.GET(req('/api/admin/ci7/evaluation-readiness?datasetSlug=x&datasetVersion=1'))
    expect(nonAdmin.status).toBe(403)
    setSession(admin.id, 'ADMIN')
    const ok = await readinessRoute.GET(req('/api/admin/ci7/evaluation-readiness?datasetSlug=ci7-pilot-eval-real&datasetVersion=1.0.0&modelProvider=design&modelVersion=v1'))
    expect(ok.status).toBe(200)
    expect((await json(ok) as { readiness: { status: string } }).readiness.status).toBe('EVALUABLE')
    // missing query params refuse (unversioned datasets never ground evaluations)
    const badParams = await readinessRoute.GET(req('/api/admin/ci7/evaluation-readiness'))
    expect(badParams.status).toBe(400)
  })

  test('F8: the language authority is untouched — TRANSCRIPTION stays structurally UNSUPPORTED', async () => {
    const { resolveEffectiveCapability } = await import('@/lib/ci/fleet/language-governance')
    // TRANSCRIPTION short-circuits before any DB read — the structural refusal
    // cannot be changed by any measurement, benchmark or human approval
    const capability = await resolveEffectiveCapability({} as never, 'en', 'TRANSCRIPTION')
    expect(capability.status).toBe('UNSUPPORTED')
    expect(capability.basis).toBe('STRUCTURAL')
  })
})
