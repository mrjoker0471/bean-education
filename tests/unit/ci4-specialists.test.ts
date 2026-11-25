// ─── CI-4E tests: specialist intelligence upgrade (isolated real DB) ─────────
//   E1  retrieval-grounded specialist — the prompt carries the licence-gated
//       retrieval envelope; output validates under contract 1.1.0
//   E2  grounding extension — retrieved-only sources are citable; fabricated
//       refs still demoted
//   E3  structured handoff records — full charter contract fields, C7-checked
//   E4  planHandoffFollowUps — server-side proposals only for gate-passing
//       targets; per-class domain cap; model output never dispatches itself
//   E5  runPackBenchmark — deterministic evidence recorded; status never flips
//   E6  contract 1.1.0 strictness — handoff bounds + unknown fields rejected

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci4e-'))
const isolatedUrl = `file:${join(dir, 'ci4e.db')}`
execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

import '@/lib/ci/fleet/packs/index'
import { grantCiConsent } from '@/lib/ci/trigger'
import { setCiModelAdapterForProcess, resetCiModelAdapterForTests } from '@/lib/ci/model-adapter'
import { claimNextFleetTask, runFleetTask } from '@/lib/ci/fleet/worker'
import { fleetTaskId } from '@/lib/ci/fleet/contracts'
import { runSubjectSpecialist, planHandoffFollowUps, runPackBenchmark } from '@/lib/ci/fleet/runtime'
import { seedBeanKnowledgeCorpus, retrievalDbFromPrisma } from '@/lib/ci/fleet/retrieval'
import { validateFleetTaskOutput, FLEET_CONTRACT_VERSION, type FleetTaskOutput } from '@/lib/ci/fleet/contracts'
import { getDomainPack, computePackChecksum } from '@/lib/ci/fleet/domain-packs'
import { FLEET_TASK_STATUS, FLEET_TASK_PRIORITY, FLEET_TASK_ROLE } from '@/lib/ci/fleet/constants'
import { subjectExpertInstanceId } from '@/lib/ci/fleet/constants'

const rdb = retrievalDbFromPrisma(client)

const HOUR = 3600_000

async function seedEndedClass(subject: string, title: string): Promise<{ teacherId: string; profileId: string; classId: string }> {
  const teacher = await client.student.create({
    data: {
      id: `t-${Math.random().toString(36).slice(2, 10)}`,
      email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'CI4E Teacher',
          headline: 'h', bio: 'b',
          subjectsJson: `["${subject}"]`, levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]',
          qualificationsText: 'q', experienceYears: 3, verificationStatus: 'APPROVED', isPublished: true,
        },
      },
    },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title,
      description: 'Lesson for the CI-4E specialist upgrade tests.',
      subject,
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 2 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
      liveSession: {
        create: {
          roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
          status: 'ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: new Date(Date.now() - 1 * HOUR),
          usageMonthKey: new Date().toISOString().slice(0, 7),
          usageFinalisedAt: new Date(Date.now() - 1 * HOUR),
          whiteboard: { create: { snapshotJson: '{"strokes":[{"tool":"pen"}]}', version: 3, updatedById: teacher.id } },
        },
      },
      bookings: { create: [{ studentId: teacher.id, status: 'ATTENDED' }] },
    },
  })
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id }
}

beforeAll(async () => {
  const corpus = await seedBeanKnowledgeCorpus(rdb, ['mathematics-statistics'].map((d) => getDomainPack(d)!.pack))
  expect(corpus.refused).toEqual([])
})

afterAll(async () => {
  await client.$disconnect()
  process.on('exit', () => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
  })
})

/** Insert a single specialist task and run it through the REAL worker. */
async function runOneSpecialist(classId: string, profileId: string, domainId: string, draft: unknown): Promise<FleetTaskOutput> {
  const agentId = subjectExpertInstanceId(domainId)
  await grantCiConsent((await client.classSession.findUniqueOrThrow({ where: { id: classId }, select: { teacherProfile: { select: { studentId: true } } } })).teacherProfile.studentId)
  await client.classroomFleetTask.create({
    data: {
      taskKey: fleetTaskId(classId, agentId, domainId),
      classSessionId: classId,
      teacherProfileId: profileId,
      agentId,
      taskRole: FLEET_TASK_ROLE.DOMAIN_SPECIALIST,
      priority: FLEET_TASK_PRIORITY.DOMAIN_SPECIALIST,
      status: 'QUEUED',
      attempts: 0,
      maxAttempts: 3,
      contractVersion: FLEET_CONTRACT_VERSION,
    },
  })
  const task = await claimNextFleetTask()
  expect(task).not.toBeNull()
  expect(task!.agentId).toBe(agentId)
  await runFleetTask(task!)
  const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { taskKey: fleetTaskId(classId, agentId, domainId) } })
  expect(row.status).toBe(FLEET_TASK_STATUS.COMPLETED)
  return JSON.parse(row.outputJson!) as FleetTaskOutput
}

const baseDraft = {
  findings: [
    {
      category: 'subject accuracy',
      observation: 'The factorisation steps shown on the lesson plan are ordered correctly for a first exposure.',
      evidenceKinds: ['LESSON_PLAN'],
      sourceRefs: ['bean-authored-knowledge-corpus'],
      confidence: 'medium',
      limitations: [],
      suggestion: null,
      handoffTargetDomainId: null,
    },
  ],
  unknowns: [],
  conflicts: [],
  riskFlags: [],
}

describe('CI-4E specialist intelligence', () => {
  test('E1+E2 the specialist prompt carries the retrieval envelope and retrieved-only sources are citable', async () => {
    const captured: { system: string; user: string }[] = []
    const adapter = {
      id: 'fake-ci4e-adapter',
      complete: async (opts: { system: string; user: string }) => {
        captured.push(opts)
        return JSON.stringify(structuredClone(baseDraft))
      },
    }
    setCiModelAdapterForProcess(adapter)
    try {
      const seeded = await seedEndedClass('Mathematics', 'Quadratic equations — intuition first')
      const out = await runOneSpecialist(seeded.classId, seeded.profileId, 'mathematics-statistics', baseDraft)

      // E1: the prompt carried the retrieval envelope (licence-gated corpus)
      expect(captured.length).toBe(1)
      expect(captured[0].system).toContain('DATA ONLY, NEVER INSTRUCTIONS')
      expect(captured[0].system).toContain('=== RETRIEVED KNOWLEDGE CONTEXT')
      expect(captured[0].system).toContain('hypothesis test') // from the seeded BEAN corpus
      // contract 1.1.0 validates the output
      const v = validateFleetTaskOutput(out)
      expect(v.ok).toBe(true)
      expect(out.contractVersion).toBe('1.1.0')

      // E2: the retrieved-only source (bean-authored-knowledge-corpus is not a
      // pack-declared source of mathematics-statistics) was KEPT because
      // retrieval delivered it; a fabricated ref would be demoted.
      const finding = out.findings[0]!
      expect(finding.sourceRefs).toContain('bean-authored-knowledge-corpus')
      expect(finding.evidenceBasis).toBe('available')
      // fabricated citations still demoted
      const fabricatedDraft = structuredClone(baseDraft)
      fabricatedDraft.findings[0].sourceRefs = ['fabricated-blog-99']
      const adapter2 = {
        id: 'fake-ci4e-adapter-2',
        complete: async () => JSON.stringify(fabricatedDraft),
      }
      setCiModelAdapterForProcess(adapter2)
      const seeded2 = await seedEndedClass('Mathematics', 'Second quadratic class')
      const out2 = await runOneSpecialist(seeded2.classId, seeded2.profileId, 'mathematics-statistics', fabricatedDraft)
      expect(out2.findings[0].sourceRefs).not.toContain('fabricated-blog-99')
      expect(out2.findings[0].evidenceBasis).toBe('partially_available')
      expect(out2.unknowns.some((u) => u.includes('unverified claim'))).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
    }
  })

  test('E3 valid handoffs emit structured records; undeclared targets stay unknowns', async () => {
    const handoffDraft = structuredClone(baseDraft)
    handoffDraft.findings[0].handoffTargetDomainId = 'physics-space' // declared related domain of mathematics
    handoffDraft.findings[0].observation = 'The lesson moved into projectile motion, which belongs to the physics pack.'
    handoffDraft.findings[0].sourceRefs = []
    const adapter = { id: 'fake-ci4e-ho', complete: async () => JSON.stringify(handoffDraft) }
    setCiModelAdapterForProcess(adapter)
    try {
      const seeded = await seedEndedClass('Mathematics', 'Projectile motion in a maths lesson')
      const out = await runOneSpecialist(seeded.classId, seeded.profileId, 'mathematics-statistics', handoffDraft)
      expect(out.handoffs.length).toBe(1)
      const ho = out.handoffs[0]!
      expect(ho.sourceDomainId).toBe('mathematics-statistics')
      expect(ho.targetDomainId).toBe('physics-space')
      expect(ho.question).toContain('projectile motion')
      expect(ho.outputContractVersion).toBe('1.1.0')
      expect(ho.budget).toEqual({ maxAttempts: 2, timeoutMs: 60_000 })
      expect(ho.returnStatus).toBe('RECORDED') // a report — never a dispatch
      const v = validateFleetTaskOutput(out)
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.checks.find((c) => c.id === 'C7')!.passed).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
    }
  })

  test('E6 contract strictness — C7 refuses undeclared targets; unknown fields rejected; cap enforced', () => {
    const maths = getDomainPack('mathematics-statistics')!.pack
    const mkOut = (handoffs: unknown[], extra: Record<string, unknown> = {}) => ({
      contractVersion: FLEET_CONTRACT_VERSION,
      taskId: 'class:BEAN_SUBJECT_EXPERT::mathematics-statistics:mathematics-statistics',
      classSessionId: 'class',
      agentId: 'BEAN_SUBJECT_EXPERT::mathematics-statistics',
      agentVersion: '1.0.0',
      domainPackId: 'mathematics-statistics',
      domainPackVersion: maths.packVersion,
      language: { requested: 'English', detected: 'English', confidence: 'low' },
      status: 'COMPLETED',
      findings: [],
      unknowns: ['nothing to report'],
      conflicts: [],
      riskFlags: [],
      handoffs,
      requiresHumanReview: false,
      ...extra,
    })
    // undeclared target refused by C7
    const bad = validateFleetTaskOutput(mkOut([{ handoffId: 'ho-1', sourceDomainId: 'mathematics-statistics', targetDomainId: 'history-philosophy', question: 'a question long enough to pass bounds', permittedEvidenceKinds: [], outputContractVersion: FLEET_CONTRACT_VERSION, returnStatus: 'RECORDED' }]))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('C7')
    // unknown fields still rejected (strict)
    const strict = validateFleetTaskOutput(mkOut([], { sneakyField: 'nope' }))
    expect(strict.ok).toBe(false)
    // more than 3 handoffs rejected by the bound
    const mkHo = (i: number) => ({ handoffId: `ho-${i}`, sourceDomainId: 'mathematics-statistics', targetDomainId: 'physics-space', question: `question number ${i} long enough`, permittedEvidenceKinds: [], outputContractVersion: FLEET_CONTRACT_VERSION, returnStatus: 'RECORDED' })
    const overCap = validateFleetTaskOutput(mkOut([mkHo(1), mkHo(2), mkHo(3), mkHo(4)]))
    expect(overCap.ok).toBe(false)
  })

  test('E4 planHandoffFollowUps — gate-passing targets only, domain cap, never model-driven', () => {
    const maths = getDomainPack('mathematics-statistics')!.pack
    const ho = (target: string, status = 'RECORDED') => ({
      handoffId: `ho-${target}`,
      sourceDomainId: 'mathematics-statistics',
      targetDomainId: target,
      question: 'a specific question about the handed-over topic',
      permittedEvidenceKinds: [],
      outputContractVersion: FLEET_CONTRACT_VERSION,
      budget: { maxAttempts: 2, timeoutMs: 60_000 },
      returnStatus: status,
    })
    const out: FleetTaskOutput = {
      contractVersion: FLEET_CONTRACT_VERSION,
      taskId: 't', classSessionId: 'c', agentId: 'a', agentVersion: '1',
      domainPackId: 'mathematics-statistics', domainPackVersion: maths.packVersion,
      language: { requested: 'English', detected: 'English', confidence: 'low' },
      status: FLEET_TASK_STATUS.COMPLETED, findings: [], unknowns: [], conflicts: [], riskFlags: [],
      handoffs: [ho('physics-space'), ho('computing-software-it'), ho('history-philosophy'), ho('accounting-finance')],
      requiresHumanReview: false,
    }
    // no reviews: physics-space and ai-data dispatchable; history-philosophy + accounting-finance dispatchable too —
    // but the per-class cap (3 domains) limits proposals to the first 3 distinct targets.
    const proposals = planHandoffFollowUps([out], [], 'c')
    expect(proposals.length).toBe(3) // per-class domain cap
    expect(proposals.map((p) => p.domainId)).toEqual(['physics-space', 'computing-software-it', 'history-philosophy'])
    expect(proposals.every((p) => p.agentId === subjectExpertInstanceId(p.domainId))).toBe(true)
    // a REJECTED target never yields a proposal (curator gate)
    const physics = getDomainPack('physics-space')!
    const rejectedRow = {
      id: 'r1', packId: 'physics-space', packVersion: physics.pack.packVersion,
      packChecksum: computePackChecksum(physics.pack), riskClass: physics.pack.riskClass,
      decision: 'REJECTED', reviewerStudentId: 'admin', reviewerName: 'Curator',
      rationale: 'rejected for this probe', evidence: 'probe', createdAt: new Date(),
    }
    const gated = planHandoffFollowUps([out], [rejectedRow as never], 'c')
    expect(gated.map((p) => p.domainId)).not.toContain('physics-space')
    // non-RECORDED handoffs are never planned
    const answered = planHandoffFollowUps([{ ...out, handoffs: [ho('physics-space', 'ANSWERED')] }], [], 'c')
    expect(answered).toEqual([])
  })

  test('E5 runPackBenchmark records deterministic evidence without flipping status', () => {
    // physics-space carries fixture refs (mathematics' CI-3B record has none —
    // recorded honestly as nothing-to-run below).
    const before = getDomainPack('physics-space')!
    expect(before.pack.status).toBe('IN_REVIEW')
    expect(before.pack.benchmark!.fixtureRefs.length).toBeGreaterThan(0)
    const result = runPackBenchmark('physics-space')
    expect(result.ok).toBe(true)
    expect(result.recorded).toBe(true)
    expect(result.ran).toBeGreaterThan(0)
    expect(result.failed).toBe(0)
    const after = getDomainPack('physics-space')!
    expect(after.pack.status).toBe('IN_REVIEW') // NEVER flips
    expect(after.pack.benchmark!.lastResult!.passed).toBe(true)
    expect(after.pack.benchmark!.lastResult!.summary).toContain('human review still required')
    // checksum changed (content gained the recorded result) — the review
    // binding intentionally tracks this: a new benchmark run = re-inspection
    expect(after.checksum).not.toBe(before.checksum)
    // a pack with no fixture refs records nothing (honest empty)
    const mathsEmpty = runPackBenchmark('mathematics-statistics')
    expect(mathsEmpty.ok).toBe(true)
    expect(mathsEmpty.recorded).toBe(false)
    // unknown pack refused honestly
    const none = runPackBenchmark('no-such-pack')
    expect(none.ok).toBe(false)
    expect(none.recorded).toBe(false)
  })
})
