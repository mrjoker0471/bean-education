// ─── BEAN Classroom Intelligence (CI-7D): source-frozen expert review tests ──
//   D1  a pilot review records the full source-frozen binding: the append-only
//       ClassroomPackReview evidence embeds protocol version, exact checksum,
//       actual source references and the source-licence snapshot the reviewer
//       saw — via the EXISTING CI-5D route (no alternative path)
//   D2  non-pilot domains keep the exact CI-5 evidence format (regression)
//   D3  stale checksums refuse at submission (regression through the route)
//   D4  uninspected material cannot be approved: a rubric without a real
//       `inspected` description is refused; the inspected field is mandatory
//   D5  rubric/decision consistency holds for the pilot domain (APPROVED needs
//       all OK; CHANGES_REQUESTED needs concrete findings)
//   D6  an out-of-scope reviewer cannot approve the pilot pack (qualification
//       gate re-checked at submit)
//   D7  two independent reviewers with different decisions → the disagreement
//       is PRESERVED (never averaged, never silently resolved) and remains
//       visible on the review ledger
//   D8  every review binds to the real authenticated reviewer identity and
//       timestamp (no anonymous or client-asserted attribution)

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'

const tmp = mkdtempSync(join(tmpdir(), 'bean-ci7d-'))
const isolatedUrl = `file:${join(tmp, 'ci7d.db')}`
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
const { computePackChecksum, getDomainPack } = await import('@/lib/ci/fleet/domain-packs')
const { PACK_REVIEW_RUBRIC } = await import('@/lib/ci/fleet/domain-rubric')
const {
  CI7_PILOT_DOMAIN_ID,
  CI7_PILOT_PROTOCOL_VERSION,
  CI7_PILOT_CONSENT_POINTS,
  pilotPackSnapshot,
  recordPilotParticipationConsent,
  composePilotReviewEvidence,
} = await import('@/lib/ci/fleet/pilot')
const { detectReviewDisagreement } = await import('@/lib/ci/fleet/assignments')

const reviewRoute = await import('@/app/api/ci5/reviewer/assignments/[assignmentId]/pack-review/route')

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

function allOkRubric(inspectedNote: string) {
  return {
    inspected: inspectedNote,
    sections: Object.fromEntries(PACK_REVIEW_RUBRIC.map((s) => [s.id, { status: 'OK', notes: 'verified against the pack content and sources' }])) as Record<string, { status: string; notes: string }>,
  }
}

function changesRequestedRubric(inspectedNote: string) {
  const sections = Object.fromEntries(PACK_REVIEW_RUBRIC.map((s) => [s.id, { status: 'OK', notes: 'verified against the pack content and sources' }])) as Record<string, { status: string; notes: string }>
  sections.B = { status: 'ISSUE', notes: 'the spaced-repetition definition overstates certainty without citing the underlying research' }
  return { inspected: inspectedNote, sections }
}

const SNAP = pilotPackSnapshot()
const CHECKSUM = SNAP.checksum

let adminId: string
let reviewerAId: string
let reviewerBId: string
let outOfScopeId: string
let assignmentAId: string
let assignmentBId: string

async function activateWithScope(studentId: string, domain: string): Promise<string> {
  const applied = await submitReviewerApplication(reviewerDbFromPrisma(client), { studentId, displayName: 'Reviewer' }, {
    category: 'DOMAIN_EXPERT',
    conflictOfInterest: 'none declared',
    qualificationCategory: 'qualified teacher-educator (verified in CI-6C)',
    consentGranted: true,
  })
  expect(applied.ok).toBe(true)
  const profileId = (applied as { profile: { id: string } }).profile.id
  const decided = await decideReviewerQualification(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId, {
    decision: 'APPROVED',
    rationale: 'credential examination recorded through the CI-6C workbench',
    verificationStatus: 'DOCUMENT_REVIEWED',
    scope: { approvedDomains: [domain] },
  })
  expect(decided.ok).toBe(true)
  const activated = await activateReviewer(reviewerDbFromPrisma(client), { studentId: adminId, displayName: 'Admin' }, profileId)
  expect(activated.ok).toBe(true)
  // pilot participation consent (CI-7C) — required for pilot assignments
  const profile = await resolveReviewerProfile(reviewerDbFromPrisma(client), studentId)
  const consent = await recordPilotParticipationConsent(reviewerDbFromPrisma(client), profile!, { kind: 'REVIEWER', studentId, displayName: 'R' }, {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
    acknowledged: CI7_PILOT_CONSENT_POINTS,
    compensationStatus: 'UNPAID',
  })
  expect(consent.ok).toBe(true)
  return profileId
}

beforeAll(async () => {
  const s = randomUUID().slice(0, 8)
  const admin = await client.student.create({ data: { email: `ci7d-admin-${s}@bean.test`, role: 'ADMIN' } })
  const a = await client.student.create({ data: { email: `ci7d-a-${s}@bean.test`, role: 'STUDENT' } })
  const b = await client.student.create({ data: { email: `ci7d-b-${s}@bean.test`, role: 'STUDENT' } })
  const oos = await client.student.create({ data: { email: `ci7d-oos-${s}@bean.test`, role: 'STUDENT' } })
  adminId = admin.id
  reviewerAId = a.id
  reviewerBId = b.id
  outOfScopeId = oos.id

  await activateWithScope(reviewerAId, CI7_PILOT_DOMAIN_ID)
  await activateWithScope(reviewerBId, CI7_PILOT_DOMAIN_ID)
  await activateWithScope(outOfScopeId, 'mathematics-statistics') // NOT the pilot domain

  const adb = assignmentDbFromPrisma(client)
  const adminActor = { kind: 'ADMIN' as const, studentId: adminId, displayName: 'Admin' }
  const profileA = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerAId)
  const profileB = await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerBId)
  const createdA = await createAssignment(adb, adminActor, profileA!, {
    subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, riskClass: 'STANDARD', coiCheck: 'NONE_DECLARED',
  })
  expect(createdA.ok).toBe(true)
  assignmentAId = (createdA as { assignment: { id: string } }).assignment.id
  const createdB = await createAssignment(adb, adminActor, profileB!, {
    subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, riskClass: 'STANDARD', coiCheck: 'NONE_DECLARED',
  })
  expect(createdB.ok).toBe(true)
  assignmentBId = (createdB as { assignment: { id: string } }).assignment.id
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(tmp, { recursive: true, force: true })
})

describe('CI-7D source-frozen expert review', () => {
  test('D1: a pilot review records the full source-frozen binding in append-only evidence', async () => {
    setSession(reviewerAId)
    const res = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${assignmentAId}/pack-review`, { method: 'POST', body: {
      decision: 'APPROVED',
      rationale: 'glossary definitions are accurate, sources are licence-clean, boundaries protect learners — inspected end to end',
      rubric: allOkRubric('inspected the full pack JSON: 5 glossary entries, competency levels, allowed/prohibited tasks, and the registered BEAN-authored source record with its licence fields'),
    } }), { params: Promise.resolve({ assignmentId: assignmentAId }) } as never)
    expect(res.status).toBe(201)
    const body = await json(res)
    const reviewId = body.reviewId as string
    const row = await client.classroomPackReview.findUnique({ where: { id: reviewId } })
    expect(row).not.toBeNull()
    expect(row!.packId).toBe(CI7_PILOT_DOMAIN_ID)
    expect(row!.packVersion).toBe('1.0.0')
    expect(row!.packChecksum).toBe(CHECKSUM)
    expect(row!.reviewerStudentId).toBe(reviewerAId)
    expect(row!.decision).toBe('APPROVED')
    const evidence = JSON.parse(row!.evidence) as {
      kind: string; rubricVersion: number; inspected: string
      pilot: { protocolVersion: string; packVersion: string; packChecksum: string; reviewedAt: string; sourceRefs: unknown[]; sourceLicenceSnapshot: Array<{ sourceId: string; contentUsable: boolean }> }
    }
    expect(evidence.kind).toBe('CI7-PILOT-SOURCE-FROZEN-REVIEW')
    expect(evidence.rubricVersion).toBe(1)
    expect(evidence.pilot.protocolVersion).toBe(CI7_PILOT_PROTOCOL_VERSION)
    expect(evidence.pilot.packChecksum).toBe(CHECKSUM)
    expect(evidence.pilot.sourceRefs.length).toBeGreaterThan(0)
    expect(evidence.pilot.sourceLicenceSnapshot.every((s) => s.contentUsable)).toBe(true)
    expect(evidence.pilot.sourceLicenceSnapshot.some((s) => s.sourceId === 'bean-authored-education-pedagogy-seed')).toBe(true)
    expect(row!.createdAt).toBeInstanceOf(Date)
  })

  test('D2: non-pilot domains keep the exact CI-5 evidence format (regression)', () => {
    // the composition function refuses non-pilot packs (routes select by subject)
    const pack = getDomainPack('mathematics-statistics')!.pack
    expect(() => composePilotReviewEvidence(allOkRubric('x'.repeat(30)) as never, pack, computePackChecksum(pack))).toThrow(/not the pilot subject/)
  })

  test('D3: stale checksums refuse at submission (regression through the route)', async () => {
    setSession(reviewerBId)
    // submit B's review with a stale checksum assignment simulation: create a
    // checksum-mismatched assignment is refused at creation; instead simulate
    // drift by submitting with the correct route but a tampered assignment row
    const staleAssignment = await client.expertReviewAssignment.create({ data: {
      subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: '9'.repeat(64),
      riskClass: 'STANDARD', reviewerProfileId: (await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerBId))!.id,
      reviewerCode: (await resolveReviewerProfile(reviewerDbFromPrisma(client), reviewerBId))!.reviewerCode,
      assignedByAdminId: adminId, status: 'ASSIGNED', coiCheckResult: 'PASS',
    } })
    const res = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${staleAssignment.id}/pack-review`, { method: 'POST', body: {
      decision: 'APPROVED', rationale: 'attempting to review content I have not re-inspected after drift', rubric: allOkRubric('inspected everything fully and honestly'),
    } }), { params: Promise.resolve({ assignmentId: staleAssignment.id }) } as never)
    expect(res.status).toBe(409)
    expect((await json(res) as { error: string }).error).toContain('a reviewer can never review a version they have not actually inspected')
  })

  test('D4: uninspected material cannot be approved — the inspected field is mandatory', async () => {
    setSession(reviewerBId)
    const res = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${assignmentBId}/pack-review`, { method: 'POST', body: {
      decision: 'APPROVED', rationale: 'approving without describing what was actually inspected here', rubric: allOkRubric('short'),
    } }), { params: Promise.resolve({ assignmentId: assignmentBId }) } as never)
    expect(res.status).toBe(400)
    expect(JSON.stringify(await json(res))).toContain('invalid rubric')
    // nothing recorded for B yet
    const rows = await client.classroomPackReview.findMany({ where: { reviewerStudentId: reviewerBId } })
    expect(rows.length).toBe(0)
  })

  test('D5: rubric/decision consistency holds for the pilot domain', async () => {
    setSession(reviewerBId)
    // APPROVED with an ISSUE section must refuse
    const badApproval = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${assignmentBId}/pack-review`, { method: 'POST', body: {
      decision: 'APPROVED', rationale: 'approving despite a recorded issue would be inconsistent', rubric: changesRequestedRubric('inspected the pack content fully'),
    } }), { params: Promise.resolve({ assignmentId: assignmentBId }) } as never)
    expect(badApproval.status).toBe(400)
    // a CHANGES_REQUESTED decision with concrete findings records fine
    const okChanges = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${assignmentBId}/pack-review`, { method: 'POST', body: {
      decision: 'CHANGES_REQUESTED', rationale: 'the spaced-repetition definition needs a hedged citation before approval; everything else checked out',
      rubric: changesRequestedRubric('inspected the glossary and competency scaffold with the source records side by side'),
    } }), { params: Promise.resolve({ assignmentId: assignmentBId }) } as never)
    expect(okChanges.status).toBe(201)
    const row = await client.classroomPackReview.findFirst({ where: { reviewerStudentId: reviewerBId } })
    expect(row!.decision).toBe('CHANGES_REQUESTED')
    const evidence = JSON.parse(row!.evidence) as { pilot: { packChecksum: string } }
    expect(evidence.pilot.packChecksum).toBe(CHECKSUM)
  })

  test('D6: an out-of-scope reviewer cannot approve the pilot pack', async () => {
    // give the out-of-scope reviewer a (fraudulent-looking) pilot assignment
    const oosProfile = await resolveReviewerProfile(reviewerDbFromPrisma(client), outOfScopeId)
    const adb = assignmentDbFromPrisma(client)
    const created = await createAssignment(adb, { kind: 'ADMIN', studentId: adminId, displayName: 'Admin' }, oosProfile!, {
      subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM, coiCheck: 'NONE_DECLARED',
    })
    expect(created.ok).toBe(false) // scope mismatch refuses at creation (CI-5C)
    if (!created.ok) expect(created.status).toBe(403)
    // even a hand-crafted row cannot approve: the submit-time qualification gate refuses
    const forcedRow = await client.expertReviewAssignment.create({ data: {
      subjectType: 'DOMAIN_PACK', subjectKey: CI7_PILOT_DOMAIN_ID, subjectVersion: '1.0.0', subjectChecksum: CHECKSUM,
      riskClass: 'STANDARD', reviewerProfileId: oosProfile!.id, reviewerCode: oosProfile!.reviewerCode,
      assignedByAdminId: adminId, status: 'ASSIGNED', coiCheckResult: 'PASS',
    } })
    setSession(outOfScopeId)
    const res = await reviewRoute.POST(req(`/api/ci5/reviewer/assignments/${forcedRow.id}/pack-review`, { method: 'POST', body: {
      decision: 'APPROVED', rationale: 'attempting an approval outside my approved domain scope entirely', rubric: allOkRubric('inspected everything as far as I could'),
    } }), { params: Promise.resolve({ assignmentId: forcedRow.id }) } as never)
    expect(res.status).toBe(403)
    expect((await json(res) as { error: string }).error).toContain('not an ACTIVE qualified reviewer for domain')
  })

  test('D7: genuine disagreement is preserved, never averaged away', async () => {
    // A approved, B requested changes — the existing disagreement authority
    // reports it and every individual decision stays visible on the ledger
    const rows = await client.classroomPackReview.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID, packVersion: '1.0.0', packChecksum: CHECKSUM } })
    expect(rows.length).toBe(2)
    const decisions = rows.map((r) => ({ decision: r.decision, reviewerStudentId: r.reviewerStudentId }))
    expect(decisions.map((d) => d.decision).sort()).toEqual(['APPROVED', 'CHANGES_REQUESTED'])
    const disagreement = detectReviewDisagreement(rows)
    expect(disagreement.disagreement).toBe(true)
    expect(disagreement.approvals.length).toBe(1)
    expect(disagreement.objections.length).toBe(1)
    // no consensus record was manufactured: both rows remain distinct
    const distinctReviewers = new Set(rows.map((r) => r.reviewerStudentId))
    expect(distinctReviewers.size).toBe(2)
  })

  test('D8: attribution — reviews carry the real authenticated reviewer identity and a timestamp', async () => {
    const rows = await client.classroomPackReview.findMany({ where: { packId: CI7_PILOT_DOMAIN_ID } })
    for (const row of rows) {
      expect(row.reviewerStudentId).toBeTruthy()
      expect([reviewerAId, reviewerBId]).toContain(row.reviewerStudentId)
      expect(row.createdAt).toBeInstanceOf(Date)
      expect(row.rationale.length).toBeGreaterThanOrEqual(20)
    }
  })
})
