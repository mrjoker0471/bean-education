// ─── CI-4C tests: domain-pack curation + human review (append-only ledger) ───
//   C1  resolveCuratedStatus — checksum-bound approvals, STANDARD 1-reviewer gate
//   C2  HIGH_STAKES two-distinct-reviewer rule
//   C3  REJECTED is terminal for the reviewed version
//   C4  recordPackReview — validation, 404/409s, append-only write, derived status
//   C5  admin API through the REAL requireAdmin — 401/403/golden path, forged
//       identity in the body is ignored (server-resolved reviewer), 409 on
//       checksum mismatch
//   C6  rejected/insufficiently-approved packs never dispatch (curated gate)
//   C7  the four CI-4C pack candidates are registered, valid and fixture-green
//
// NOTE: reviewer identity comes from the mocked auth session — the route's
// body never supplies it (asserted in C5).

import { describe, test, expect, beforeAll, beforeEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci4c-'))
const isolatedUrl = `file:${join(dir, 'ci4c.db')}`
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { completeAuthMock } = await import('../helpers/auth-mock')
const ADMIN = { id: 'admin-c1', email: 'curator@bean.example', displayName: 'Curator One', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const ADMIN2 = { id: 'admin-c2', email: 'curator2@bean.example', displayName: 'Curator Two', learningLevel: null, role: 'ADMIN', onboardedAt: null, signupIntent: null }
const STUDENT_USER = { id: 'student-c1', email: 's@bean.example', displayName: 'Student One', learningLevel: null, role: 'STUDENT', onboardedAt: null, signupIntent: null }
const authState = { student: STUDENT_USER as Record<string, unknown> | null }
mock.module('@/lib/auth', () =>
  completeAuthMock({
    requireStudent: async () => authState.student as never,
    getSessionStudent: async () => authState.student as never,
    sameOrigin: () => true,
  }),
)

// Fleet machinery AFTER the db/auth mocks are in place.
import '@/lib/ci/fleet/packs/index'
import { listDomainPacks, computePackChecksum, getDomainPack } from '@/lib/ci/fleet/domain-packs'
import { runDomainFixtureSuite } from '@/lib/ci/fleet/fixtures'
import {
  resolveCuratedStatus,
  recordPackReview,
  curatedPackSummaries,
  curatedDispatchablePacks,
  type PackReviewRow,
  type ReviewerIdentity,
} from '@/lib/ci/fleet/curator'
import { listSources } from '@/lib/ci/fleet/sources'
import { PACK_STATUS } from '@/lib/ci/fleet/constants'

const reviewerOne: ReviewerIdentity = { studentId: ADMIN.id, displayName: ADMIN.displayName as string }
const reviewerTwo: ReviewerIdentity = { studentId: ADMIN2.id, displayName: ADMIN2.displayName as string }

function reviewRow(over: Partial<PackReviewRow> & { decision: PackReviewRow['decision']; reviewerStudentId: string }): PackReviewRow {
  // Derive the binding fields (version/checksum/risk) from the TARGET pack so
  // the decision is genuinely bound to the content a reviewer inspected.
  const entry = getDomainPack(over.packId ?? 'mathematics-statistics')!
  return {
    id: `row-${Math.random().toString(36).slice(2)}`,
    packId: entry.pack.domainId,
    packVersion: entry.pack.packVersion,
    packChecksum: computePackChecksum(entry.pack),
    riskClass: entry.pack.riskClass,
    rationale: 'inspected scope, sources, fixtures and safety boundary',
    evidence: 'ran the fixture suite; checked every registered source licence record',
    reviewerName: 'Curator',
    createdAt: new Date(),
    ...over,
  } as PackReviewRow
}

beforeAll(async () => {
  // provision the isolated DB schema for the API test path
  await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "ClassroomPackReview" ("id" TEXT NOT NULL PRIMARY KEY, "packId" TEXT NOT NULL, "packVersion" TEXT NOT NULL, "packChecksum" TEXT NOT NULL, "riskClass" TEXT NOT NULL, "decision" TEXT NOT NULL, "reviewerStudentId" TEXT NOT NULL, "reviewerName" TEXT NOT NULL, "rationale" TEXT NOT NULL, "evidence" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)')
})

describe('CI-4C curation machinery (pure)', () => {
  test('C1 approvals are checksum-bound; STANDARD needs one distinct approval', () => {
    const maths = getDomainPack('mathematics-statistics')!
    const checksum = computePackChecksum(maths.pack)
    // zero reviews → declared status stands
    let r = resolveCuratedStatus(maths.pack, [])
    expect(r.status).toBe(PACK_STATUS.IN_REVIEW)
    expect(r.approvalsRecorded).toBe(0)
    expect(r.approvalsRequired).toBe(1)
    // an approval bound to a DIFFERENT checksum must NOT count (silent rebinding refused)
    r = resolveCuratedStatus(maths.pack, [reviewRow({ decision: 'APPROVED', reviewerStudentId: ADMIN.id, packChecksum: 'stale-checksum-0000000000' })])
    expect(r.status).toBe(PACK_STATUS.IN_REVIEW)
    expect(r.approvalsRecorded).toBe(0)
    // a wrong-version approval must NOT count either
    r = resolveCuratedStatus(maths.pack, [reviewRow({ decision: 'APPROVED', reviewerStudentId: ADMIN.id, packVersion: '0.0.1' })])
    expect(r.approvalsRecorded).toBe(0)
    // the real approval verifies the pack
    r = resolveCuratedStatus(maths.pack, [reviewRow({ decision: 'APPROVED', reviewerStudentId: ADMIN.id })])
    expect(r.status).toBe(PACK_STATUS.VERIFIED)
    expect(r.explanation).toContain(checksum.slice(0, 12))
    // declared VERIFIED without recorded approvals is refused → IN_REVIEW
    const fakeVerified = { ...structuredClone(maths.pack), status: PACK_STATUS.VERIFIED, humanReview: null }
    r = resolveCuratedStatus(fakeVerified, [])
    expect(r.status).toBe(PACK_STATUS.IN_REVIEW)
    expect(r.explanation).toContain('refused')
  })

  test('C2 HIGH_STAKES packs need TWO DISTINCT reviewers', () => {
    const health = getDomainPack('health-medicine-edu')!
    expect(health.pack.riskClass).toBe('HIGH_STAKES')
    let r = resolveCuratedStatus(health.pack, [reviewRow({ packId: 'health-medicine-edu', decision: 'APPROVED', reviewerStudentId: ADMIN.id })])
    expect(r.approvalsRequired).toBe(2)
    expect(r.status).toBe(PACK_STATUS.IN_REVIEW)
    // the SAME reviewer approving twice does not satisfy the rule
    r = resolveCuratedStatus(health.pack, [
      reviewRow({ packId: 'health-medicine-edu', decision: 'APPROVED', reviewerStudentId: ADMIN.id }),
      reviewRow({ packId: 'health-medicine-edu', decision: 'APPROVED', reviewerStudentId: ADMIN.id }),
    ])
    expect(r.approvalsRecorded).toBe(1)
    expect(r.status).toBe(PACK_STATUS.IN_REVIEW)
    // two distinct reviewers satisfy it
    r = resolveCuratedStatus(health.pack, [
      reviewRow({ packId: 'health-medicine-edu', decision: 'APPROVED', reviewerStudentId: ADMIN.id }),
      reviewRow({ packId: 'health-medicine-edu', decision: 'APPROVED', reviewerStudentId: ADMIN2.id }),
    ])
    expect(r.status).toBe(PACK_STATUS.VERIFIED)
    expect(r.explanation).toContain('two-reviewer rule')
  })

  test('C3 REJECTED is terminal for the reviewed version', () => {
    const maths = getDomainPack('mathematics-statistics')!
    const r = resolveCuratedStatus(maths.pack, [
      reviewRow({ decision: 'APPROVED', reviewerStudentId: ADMIN.id }),
      reviewRow({ decision: 'REJECTED', reviewerStudentId: ADMIN2.id, rationale: 'scope drift and an unverified source anchor' }),
    ])
    expect(r.status).toBe(PACK_STATUS.REJECTED)
    expect(r.rejected).toBe(true)
    expect(r.explanation).toContain('terminal for this version')
  })

  test('C6 curated dispatch gate refuses rejected and under-approved packs', () => {
    const maths = getDomainPack('mathematics-statistics')!
    const checksum = computePackChecksum(maths.pack)
    // baseline: everything dispatchable as IN_REVIEW (CI-3 semantics)
    expect(curatedDispatchablePacks([]).map((p) => p.pack.domainId)).toContain('mathematics-statistics')
    // after a rejection: the pack is gone from the dispatchable set
    const rejected = [reviewRow({ decision: 'REJECTED', reviewerStudentId: ADMIN2.id })]
    expect(curatedDispatchablePacks(rejected).map((p) => p.pack.domainId)).not.toContain('mathematics-statistics')
    // an approved pack stays dispatchable as VERIFIED
    const approved = [reviewRow({ decision: 'APPROVED', reviewerStudentId: ADMIN.id })]
    const entry = curatedDispatchablePacks(approved).find((p) => p.pack.domainId === 'mathematics-statistics')
    expect(entry?.curatedStatus).toBe(PACK_STATUS.VERIFIED)
    void checksum
  })
})

describe('CI-4C pack candidates', () => {
  test('C7 four new packs registered, valid, honest IN_REVIEW, fixture suite green', () => {
    const packs = listDomainPacks()
    expect(packs.length).toBe(12)
    const newIds = ['education-pedagogy', 'engineering', 'agriculture-agritech', 'history-philosophy']
    for (const id of newIds) {
      const entry = getDomainPack(id)!
      expect(entry).not.toBeNull()
      expect(entry.pack.status).toBe(PACK_STATUS.IN_REVIEW)
      expect(entry.pack.humanReview).toBeNull()
      expect(entry.pack.sources.length).toBeGreaterThanOrEqual(1)
      expect(entry.pack.safetyBoundary.length).toBeGreaterThan(20)
    }
    // every pack passes the machine gates (checksums already prove registration)
    for (const { pack, checksum } of packs) {
      expect(checksum.length).toBe(64)
      expect(pack.glossary.length).toBeGreaterThan(0)
    }
    // the four BEAN-authored seed sources are registered
    const ids = listSources().map((s) => s.sourceId)
    for (const s of ['bean-authored-education-pedagogy-seed', 'bean-authored-engineering-seed', 'bean-authored-agriculture-agritech-seed', 'bean-authored-history-culture-seed']) {
      expect(ids).toContain(s)
    }
    // the whole deterministic fixture suite (8 CI-3 + 4 CI-4C) is green
    const fx = runDomainFixtureSuite()
    expect(fx.failed).toBe(0)
    expect(fx.passed).toBe(12)
  })
})

// ─── C4/C5: persistence + API through the REAL requireAdmin ──────────────────

const reviewState = { rows: [] as (PackReviewRow & { updatedAt: Date })[], nextId: 1 }
function resetReviewState() {
  reviewState.rows = []
  reviewState.nextId = 1
  authState.student = STUDENT_USER
}

describe('CI-4C recordPackReview + admin API', () => {
  beforeEach(async () => {
    resetReviewState()
    await client.classroomPackReview.deleteMany({})
  })

  test('C4 recordPackReview validates, refuses stale bindings, appends honestly', async () => {
    const maths = getDomainPack('mathematics-statistics')!
    const checksum = computePackChecksum(maths.pack)
    // schema refusal: too-short rationale
    let r = await recordPackReview(fakeDb(), reviewerOne, { packId: 'mathematics-statistics', packVersion: maths.pack.packVersion, packChecksum: checksum, decision: 'APPROVED', rationale: 'ok', evidence: 'inspected the pack and its sources and fixtures in full' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
    // unknown pack
    r = await recordPackReview(fakeDb(), reviewerOne, { packId: 'no-such-pack', packVersion: '1.0.0', packChecksum: checksum, decision: 'APPROVED', rationale: 'inspected the pack in full detail', evidence: 'inspected the pack and its sources and fixtures' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(404)
    // version mismatch
    r = await recordPackReview(fakeDb(), reviewerOne, { packId: 'mathematics-statistics', packVersion: '9.9.9', packChecksum: checksum, decision: 'APPROVED', rationale: 'inspected the pack in full detail', evidence: 'inspected the pack and its sources and fixtures' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    // checksum mismatch (content changed since inspection)
    r = await recordPackReview(fakeDb(), reviewerOne, { packId: 'mathematics-statistics', packVersion: maths.pack.packVersion, packChecksum: '0'.repeat(64), decision: 'APPROVED', rationale: 'inspected the pack in full detail', evidence: 'inspected the pack and its sources and fixtures' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(409)
    // golden path
    r = await recordPackReview(fakeDb(), reviewerOne, { packId: 'mathematics-statistics', packVersion: maths.pack.packVersion, packChecksum: checksum, decision: 'APPROVED', rationale: 'Scope, sources and safety boundary verified against the charter requirements.', evidence: 'Ran the fixture suite green; inspected all registered source licence records.' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.curatedStatus.status).toBe(PACK_STATUS.VERIFIED)
      expect(reviewState.rows.length).toBe(1)
      expect(reviewState.rows[0].reviewerStudentId).toBe(reviewerOne.studentId)
    }
    // an unknown decision vocabulary is refused
    r = await recordPackReview(fakeDb(), reviewerOne, { packId: 'mathematics-statistics', packVersion: maths.pack.packVersion, packChecksum: checksum, decision: 'AUTO_VERIFY', rationale: 'inspected the pack in full detail', evidence: 'inspected the pack and its sources and fixtures' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
  })

  test('C5 admin API — real requireAdmin guard, server-resolved reviewer identity', async () => {
    const listRoute = await import('@/app/api/admin/knowledge/packs/route')
    const detailRoute = await import('@/app/api/admin/knowledge/packs/[packId]/route')
    const reviewRoute = await import('@/app/api/admin/knowledge/packs/[packId]/review/route')

    // unauthenticated → 401
    authState.student = null
    let res = await listRoute.GET()
    expect(res.status).toBe(401)
    // non-admin → 403
    authState.student = STUDENT_USER
    res = await listRoute.GET()
    expect(res.status).toBe(403)
    // admin golden path
    authState.student = ADMIN
    res = await listRoute.GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { packs: { domainId: string; curatedStatus: string; approvalsRequired: number }[] }
    expect(body.packs.length).toBe(12)
    expect(body.packs.every((p) => p.curatedStatus === 'IN_REVIEW')).toBe(true)
    const health = body.packs.find((p) => p.domainId === 'health-medicine-edu')!
    expect(health.approvalsRequired).toBe(2)

    // detail route
    const detailRes = await detailRoute.GET(new Request('http://localhost/x') as never, { params: Promise.resolve({ packId: 'education-pedagogy' }) })
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()) as { pack: { declaredStatus: string }; sources: { readonly: boolean; sourceId: string }[]; reviews: unknown[] }
    expect(detail.pack.declaredStatus).toBe('IN_REVIEW')
    expect(detail.sources.every((s) => s.readonly === true)).toBe(true) // reviewers can never mutate sources here
    expect(detail.reviews).toEqual([])
    const missingRes = await detailRoute.GET(new Request('http://localhost/x') as never, { params: Promise.resolve({ packId: 'nope' }) })
    expect(missingRes.status).toBe(404)

    // review POST — a forged reviewer id in the body must be ignored
    const maths = getDomainPack('mathematics-statistics')!
    const checksum = computePackChecksum(maths.pack)
    authState.student = STUDENT_USER
    const forbiddenRes = await reviewRoute.POST(jsonRequest({ packVersion: maths.pack.packVersion, packChecksum: checksum, decision: 'APPROVED', rationale: 'attempted by a non-admin', evidence: 'inspected the pack and its sources and fixtures', reviewerStudentId: ADMIN.id }), { params: Promise.resolve({ packId: 'mathematics-statistics' }) })
    expect(forbiddenRes.status).toBe(403)
    expect(reviewState.rows.length).toBe(0)

    authState.student = ADMIN
    const okRes = await reviewRoute.POST(jsonRequest({ packVersion: maths.pack.packVersion, packChecksum: checksum, decision: 'APPROVED', rationale: 'Scope, sources and safety boundary verified against the charter requirements.', evidence: 'Ran the fixture suite green; inspected all registered source licence records.', reviewerStudentId: 'forged-id' }), { params: Promise.resolve({ packId: 'mathematics-statistics' }) })
    expect(okRes.status).toBe(200)
    const okBody = (await okRes.json()) as { reviewId: string; curated: { status: string } }
    expect(okBody.curated.status).toBe('VERIFIED')
    // the decision landed in the REAL isolated DB the route writes through
    const persisted = await client.classroomPackReview.findMany({ where: { packId: 'mathematics-statistics' } })
    expect(persisted.length).toBe(1)
    expect(persisted[0].reviewerStudentId).toBe(ADMIN.id) // server-resolved, not the forged body id
    expect(persisted[0].reviewerName).toBe(ADMIN.displayName)

    // the summaries now reflect the recorded approval (same DB)
    const summaries = await curatedPackSummaries(client)
    const mathsSummary = summaries.find((s) => s.domainId === 'mathematics-statistics')!
    expect(mathsSummary.curatedStatus).toBe('VERIFIED')
    expect(mathsSummary.reviewCount).toBe(1)
  })

  test('C6b persistence is real: decisions survive in the isolated Prisma DB', async () => {
    const maths = getDomainPack('mathematics-statistics')!
    const checksum = computePackChecksum(maths.pack)
    const created = await client.classroomPackReview.create({
      data: {
        packId: 'mathematics-statistics',
        packVersion: maths.pack.packVersion,
        packChecksum: checksum,
        riskClass: maths.pack.riskClass,
        decision: 'CHANGES_REQUESTED',
        reviewerStudentId: reviewerOne.studentId,
        reviewerName: reviewerOne.displayName,
        rationale: 'Glossary needs two more anchored terms before approval.',
        evidence: 'Inspected glossary coverage against the ISCED field descriptor.',
      },
    })
    expect(created.id.length).toBeGreaterThan(0)
    const rows = await client.classroomPackReview.findMany({ where: { packId: 'mathematics-statistics' } })
    expect(rows.length).toBe(1)
    expect(rows[0].decision).toBe('CHANGES_REQUESTED')
  })
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function fakeDb() {
  return {
    classroomPackReview: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `rev-${reviewState.nextId++}`, createdAt: new Date(), updatedAt: new Date(), ...data } as PackReviewRow & { updatedAt: Date }
        reviewState.rows.push(row)
        return row
      },
      findMany: async ({ where }: { where?: { packId?: string } } = {}) =>
        reviewState.rows
          .filter((r) => (where?.packId ? r.packId === where.packId : true))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    },
  }
}

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/knowledge/packs/x/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

void rmSync // imported for symmetry with the other isolated-DB suites
process.on('exit', () => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
})
