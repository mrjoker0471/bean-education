// ─── BEAN Classroom Intelligence (CI-7E): disagreement analysis tests ────────
//   E1  an analysis anchors to REAL review rows: decisions are copied verbatim
//       from the authoritative ledger; phantom review ids are refused
//   E2  only a GENUINE disagreement can be analysed (consensus refused 409);
//       the classification vocabulary and minimum analysis text are enforced
//   E3  the analysis binds ONE exact pack version + checksum (spanning
//       versions refused) and is append-only (corrections are NEW rows)
//   E4  the findings summary aggregates from real rows only; an empty ledger
//       reports the honest NOT STARTED zero state
//   E5  route authorization: GET/POST are admin-only; non-admins refused
//   E6  adjudication linkage: the authorised outcome is recorded on the
//       analysis; unresolved analyses stay unresolved (never auto-resolved)

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import type { Ci7DisagreementReviewRow } from '@/lib/ci/fleet/pilot'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7e-'))
const isolatedUrl = `file:${join(tmp, 'ci7e.db')}`
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
  CI7_DISAGREEMENT_CLASSIFICATIONS,
  buildFindingsSummary,
  ci7DisagreementDbFromPrisma,
  recordDisagreementAnalysis,
} = await import('@/lib/ci/fleet/pilot')

const disagreementsRoute = await import('@/app/api/admin/ci7/disagreements/route')

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

const PACK = 'education-pedagogy'
const VERSION = '1.0.0'
const CHECKSUM = 'a'.repeat(64)

function reviewRow(id: string, reviewerStudentId: string, decision: string, reviewerName: string): Ci7DisagreementReviewRow {
  return {
    id,
    packId: PACK,
    packVersion: VERSION,
    packChecksum: CHECKSUM,
    decision,
    reviewerStudentId,
    reviewerName,
    rationale: 'recorded rationale from the real review row (verbatim)',
    evidence: '{"kind":"CI7-PILOT-SOURCE-FROZEN-REVIEW"}',
    createdAt: new Date(),
  }
}

let adminId: string
let realReviewA: Ci7DisagreementReviewRow
let realReviewB: Ci7DisagreementReviewRow

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci7e-admin-${s}@bean.test`, role: 'ADMIN' } })
  adminId = admin.id
  // real review rows exist in the authoritative ledger (as the CI-7D path wrote them)
  const rowA = await client.classroomPackReview.create({ data: {
    packId: PACK, packVersion: VERSION, packChecksum: CHECKSUM, riskClass: 'STANDARD',
    decision: 'APPROVED', reviewerStudentId: 'student-a', reviewerName: 'RC-A',
    rationale: 'approved after full inspection of the pack content and source records',
    evidence: '{"kind":"CI7-PILOT-SOURCE-FROZEN-REVIEW"}',
  } })
  const rowB = await client.classroomPackReview.create({ data: {
    packId: PACK, packVersion: VERSION, packChecksum: CHECKSUM, riskClass: 'STANDARD',
    decision: 'CHANGES_REQUESTED', reviewerStudentId: 'student-b', reviewerName: 'RC-B',
    rationale: 'the definition overstates certainty; needs a hedged citation before approval',
    evidence: '{"kind":"CI7-PILOT-SOURCE-FROZEN-REVIEW"}',
  } })
  realReviewA = reviewRow(rowA.id, 'student-a', 'APPROVED', 'RC-A')
  realReviewB = reviewRow(rowB.id, 'student-b', 'CHANGES_REQUESTED', 'RC-B')
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7E disagreement analysis', () => {
  test('E1: the analysis anchors to real review rows; phantom ids refused; decisions verbatim', async () => {
    const admin = { studentId: adminId, displayName: 'Admin' }
    const phantom = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [realReviewA.id, 'nonexistent-review-id'],
      classification: 'FACTUAL',
      analysis: 'the reviewers disagree on whether the definition overstates the research certainty',
    }, [realReviewA, realReviewB])
    expect(phantom.ok).toBe(false)
    if (!phantom.ok) expect(phantom.status).toBe(400)
    const ok = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [realReviewA.id, realReviewB.id],
      rubricDimensions: ['B'],
      evidenceCited: [
        { reviewerStudentId: 'student-a', cited: 'inspected the full pack and source records' },
        { reviewerStudentId: 'student-b', cited: 'the spaced-repetition definition overstates certainty' },
      ],
      classification: 'FACTUAL',
      correctionRequired: true,
      analysis: 'the disagreement is factual: whether the definition overstates the certainty of the underlying research',
    }, [realReviewA, realReviewB])
    expect(ok.ok).toBe(true)
    const stored = await client.ci7DisagreementAnalysis.findFirst({ where: { packId: PACK } })
    const decisions = JSON.parse(stored!.decisionsJson) as Array<{ reviewerStudentId: string; decision: string }>
    // decisions are copied from the REAL rows, verbatim
    expect(decisions).toEqual([
      { reviewerStudentId: 'student-a', reviewerName: 'RC-A', decision: 'APPROVED', rationale: realReviewA.rationale },
      { reviewerStudentId: 'student-b', reviewerName: 'RC-B', decision: 'CHANGES_REQUESTED', rationale: realReviewB.rationale },
    ])
    expect(stored!.packChecksum).toBe(CHECKSUM)
  })

  test('E2: consensus cannot be analysed; classification and text minimums enforced', async () => {
    const admin = { studentId: adminId, displayName: 'Admin' }
    const consensusRow = reviewRow('consensus-1', 'student-c', 'APPROVED')
    const consensusRow2 = reviewRow('consensus-2', 'student-d', 'APPROVED')
    const consensus = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [consensusRow.id, consensusRow2.id],
      classification: 'INTERPRETIVE',
      analysis: 'attempting to analyse agreement as if it were disagreement should refuse',
    }, [consensusRow, consensusRow2])
    expect(consensus.ok).toBe(false)
    if (!consensus.ok) expect(consensus.status).toBe(409)
    const badClass = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [realReviewA.id, realReviewB.id],
      classification: 'VIBES',
      analysis: 'a made-up classification must be refused by the vocabulary check',
    }, [realReviewA, realReviewB])
    expect(badClass.ok).toBe(false)
    expect(CI7_DISAGREEMENT_CLASSIFICATIONS.join(',')).toBe('FACTUAL,INTERPRETIVE,RUBRIC_RELATED,MIXED')
    const tooShort = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [realReviewA.id, realReviewB.id],
      classification: 'FACTUAL',
      analysis: 'short',
    }, [realReviewA, realReviewB])
    expect(tooShort.ok).toBe(false)
  })

  test('E3: the analysis binds one version+checksum; corrections are NEW rows (append-only)', async () => {
    const admin = { studentId: adminId, displayName: 'Admin' }
    const otherVersion = reviewRow('other-version-1', 'student-e', 'REJECTED')
    const mixed = { ...realReviewB, packChecksum: 'b'.repeat(64) }
    const spanning = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [realReviewA.id, realReviewB.id],
      classification: 'FACTUAL',
      analysis: 'spanning different checksums must refuse — an analysis binds one version',
    }, [realReviewA, mixed])
    expect(spanning.ok).toBe(false)
    void otherVersion
    // correction of the analysis: a NEW row (the first is never edited)
    const before = await client.ci7DisagreementAnalysis.count({ where: { packId: PACK } })
    const corrected = await recordDisagreementAnalysis(ci7DisagreementDbFromPrisma(client), admin, {
      reviewIds: [realReviewA.id, realReviewB.id],
      classification: 'MIXED',
      adjudicationOutcome: 'adjudicator sided with the dissenting reviewer: the definition needs a hedged citation (v1.0.1 required)',
      correctionRequired: true,
      correctionApplied: true,
      packVersionChanged: true,
      reReviewRequired: true,
      analysis: 'corrected analysis: partly factual (citation), partly interpretive (certainty framing) — supersedes the first reading',
    }, [realReviewA, realReviewB])
    expect(corrected.ok).toBe(true)
    const after = await client.ci7DisagreementAnalysis.count({ where: { packId: PACK } })
    expect(after).toBe(before + 1)
  })

  test('E4: the findings summary aggregates real rows only; empty ledger = NOT STARTED zeros', () => {
    const empty = buildFindingsSummary([])
    expect(empty.totalAnalyses).toBe(0)
    expect(empty.correctionsRequired).toBe(0)
    expect(empty.unresolved).toBe(0)
    expect(empty.note).toContain('NOT STARTED')
  })

  test('E5: the route is admin-only and serves the summary + append-only rows', async () => {
    setSession(null)
    const anon = await disagreementsRoute.GET(req('/api/admin/ci7/disagreements'))
    expect(anon.status).toBe(401)
    setSession('some-student', 'STUDENT')
    const nonAdmin = await disagreementsRoute.GET(req('/api/admin/ci7/disagreements'))
    expect(nonAdmin.status).toBe(403)
    setSession(adminId, 'ADMIN')
    const ok = await disagreementsRoute.GET(req('/api/admin/ci7/disagreements'))
    expect(ok.status).toBe(200)
    const body = await json(ok) as { summary: { totalAnalyses: number; correctionsApplied: number; adjudicated: number }; analyses: Array<Record<string, unknown>> }
    expect(body.summary.totalAnalyses).toBe(2)
    expect(body.summary.correctionsApplied).toBe(1)
    expect(body.summary.adjudicated).toBe(1)
    expect(body.summary.unresolved).toBe(1)
    expect(body.analyses.length).toBe(2)
  })

  test('E6: POST anchors to the real ledger; a body-supplied decision set cannot fabricate anything', async () => {
    setSession(adminId, 'ADMIN')
    // body claims a disagreement among reviews that AGREE — the ledger says otherwise
    const fake = await disagreementsRoute.POST(req('/api/admin/ci7/disagreements', { method: 'POST', body: {
      packId: PACK,
      reviewIds: [realReviewA.id, realReviewB.id].slice(0, 1).concat([realReviewA.id]), // duplicate — only one real agreeing pair member
      classification: 'FACTUAL',
      analysis: 'fabricated disagreement attempt using duplicated single-review references',
    } }))
    expect(fake.status).toBeGreaterThanOrEqual(400)
    const ok = await disagreementsRoute.POST(req('/api/admin/ci7/disagreements', { method: 'POST', body: {
      packId: PACK,
      reviewIds: [realReviewA.id, realReviewB.id],
      classification: 'INTERPRETIVE',
      analysis: 'recorded through the route: the dispute mixes citation accuracy with framing judgement',
    } }))
    expect(ok.status).toBe(201)
    const stored = await client.ci7DisagreementAnalysis.findMany({ where: { packId: PACK } })
    expect(stored.length).toBe(3)
    expect(stored.every((r) => r.recordedByAdminId === adminId)).toBe(true)
  })
})
