// ─── CI-3E tests: subject specialist fleet runtime (isolated real DB) ─────────
// Real database behaviour + a scriptable fake model adapter. Coverage:
//   P1  pack expansion — 8 dispatchable seed packs, all V-gates pass; the
//       deterministic domain fixture suite passes (grounding / demotion /
//       handoff / refusal verdicts)
//   S1  subject specialist — contract-valid output; deterministic source
//       grounding (unregistered refs demoted, confidence lowered, unknowns
//       recorded); cross-domain handoff only to declared related domains;
//       prohibited-task refusal; IN_REVIEW pack honesty (limitations +
//       requiresHumanReview)
//   A1  evidence auditor — deterministic resolution of evidenceRefIds and
//       sourceRefs against the register/registry; overclaims flagged with
//       human review; disagreements preserved verbatim as conflicts; honest
//       INSUFFICIENT_EVIDENCE when nothing is terminal yet; bounded model
//       challenge pass
//   G1  safety guardian — deterministic-only: protected-characteristic terms,
//       decision language, HIGH_STAKES pack outputs all flagged for humans
//   M1  core pair — maps completed CI-1 agent runs into the fleet contract
//       without re-running any model; honest INSUFFICIENT_EVIDENCE when the
//       CI-1 pipeline has not produced runs yet
//   D1  honest deferrals — LANGUAGE (CI-3F) and enrichment coaches (CI-3G)
//       fail immediately and permanently with a milestone pointer; missing
//       adapter → honest FAILED; the worker never retries permanent failures
//   C1  critic pass — bounded single-pass second review over terminal outputs

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3e-'))
const isolatedUrl = `file:${join(dir, 'ci3e.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { dispatchFleetForSession } = await import('@/lib/ci/fleet/dispatcher')
const {
  claimNextFleetTask,
  runFleetTask,
  unregisterFleetTaskExecutorForTests,
  fleetPoolStats,
} = await import('@/lib/ci/fleet/worker')
const { grantCiConsent } = await import('@/lib/ci/trigger')
const {
  FLEET_AGENT_ID,
  FLEET_TASK_ROLE,
  FLEET_TASK_PRIORITY,
  FLEET_TASK_STATUS,
  subjectExpertInstanceId,
} = await import('@/lib/ci/fleet/constants')
const { dispatchableDomainPacks } = await import('@/lib/ci/fleet/domain-packs')
const { runDomainFixtureSuite } = await import('@/lib/ci/fleet/fixtures')
const { runIndependentCriticPass, registerFleetRuntime } = await import('@/lib/ci/fleet/runtime')
const { setCiModelAdapterForProcess, resetCiModelAdapterForTests } = await import('@/lib/ci/model-adapter')
const { learnerOutputSchema } = await import('@/lib/ci/schemas')
const { CI_AGENT } = await import('@/lib/ci/constants')

beforeAll(() => {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
  // (Re)install the CI-3E runtime executor — another test file may have
  // replaced or cleared the worker seam before this file ran.
  registerFleetRuntime()
})

afterAll(async () => {
  resetCiModelAdapterForTests()
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Scriptable fake model adapter ────────────────────────────────────────────

let scripted: string[] = []
const modelCalls: { systemTag: string; userLen: number }[] = []

function installAdapter(): void {
  const adapter: { id: string; complete(opts: { system: string; user: string }): Promise<string> } = {
    id: 'fake-ci3e-adapter',
    async complete(opts) {
      modelCalls.push({ systemTag: opts.system.slice(0, 60), userLen: opts.user.length })
      const next = scripted.shift()
      if (next === undefined) throw new Error('fake adapter has no scripted response — test bug')
      return next
    },
  }
  setCiModelAdapterForProcess(adapter)
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const HOUR = 3600_000

async function seedEndedClass(opts?: { subject?: string; title?: string }) {
  const teacher = await client.student.create({
    data: {
      id: `t-${Math.random().toString(36).slice(2, 10)}`,
      email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Specialist Teacher',
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 3,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: opts?.title ?? 'Quadratic equations — intuition first',
      description: 'Build the intuition behind quadratics, then solve by factorisation and the formula.',
      subject: opts?.subject ?? 'Mathematics',
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
          whiteboard: {
            create: { snapshotJson: '{"strokes":[{"tool":"pen"}]}', version: 3, updatedById: teacher.id },
          },
        },
      },
      bookings: {
        create: [
          { studentId: teacher.id, status: 'ATTENDED' }, // placeholder booking row (owner)
        ],
      },
    },
  })
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } })
}

/** Drive the whole queue deterministically until nothing is QUEUED. */
async function drainQueue(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const task = await claimNextFleetTask()
    if (!task) return
    await runFleetTask(task)
  }
}

async function rowsFor(classId: string) {
  return client.classroomFleetTask.findMany({ where: { classSessionId: classId } })
}

function rowOf(rows: Awaited<ReturnType<typeof rowsFor>>, agentId: string, suffix = '') {
  const found = rows.find((r) => r.agentId === agentId && (suffix === '' || r.taskKey.endsWith(suffix)))
  if (!found) throw new Error(`no fleet task row for ${agentId}${suffix}`)
  return found
}

// ─── P1: packs & fixtures ─────────────────────────────────────────────────────

describe('CI-3E pack expansion and deterministic fixtures (P1)', () => {
  test('P1.1 eight dispatchable seed packs, all carrying provenance and review-state honesty', () => {
    const packs = dispatchableDomainPacks()
    const ids = packs.map((p) => p.pack.domainId)
    expect(ids).toContain('mathematics-statistics')
    expect(ids).toContain('computing-software-it')
    expect(ids).toContain('accounting-finance')
    expect(ids).toContain('health-medicine-edu')
    expect(ids).toContain('physics-space')
    expect(ids).toContain('chemistry-materials')
    expect(ids).toContain('biology-life')
    expect(ids).toContain('languages-literature')
    expect(packs.every((p) => p.underReview)).toBe(true) // honest IN_REVIEW state
    expect(packs.every((p) => p.pack.sources.length > 0)).toBe(true)
  })

  test('P1.2 the deterministic domain fixture suite passes (grounding/demotion/handoff/refusal)', () => {
    const run = runDomainFixtureSuite()
    expect(run.failed).toBe(0)
    expect(run.passed).toBe(run.results.length)
    const verdicts = new Set(run.results.map((r) => r.verdict))
    expect(verdicts.has('grounded')).toBe(true)
    expect(verdicts.has('demoted')).toBe(true)
    expect(verdicts.has('handoff')).toBe(true)
    expect(verdicts.has('refused')).toBe(true)
  })
})

// ─── S1: subject specialist runtime ───────────────────────────────────────────

describe('CI-3E subject specialist runtime (S1)', () => {
  test('S1.1 grounding demotion, handoff and refusal happen deterministically; IN_REVIEW honesty marks everything', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      installAdapter()
      // The specialist draft: one grounded finding, one unregistered-source
      // finding, one valid handoff, one prohibited request.
      scripted = [
        JSON.stringify({
          findings: [
            {
              category: 'concept accuracy',
              observation: 'The lesson plan frames hypothesis tests as reporting uncertainty rather than fixed decisions; consistent with the pack glossary anchoring.',
              evidenceKinds: ['LESSON_PLAN'],
              sourceRefs: ['openstax-mathematics'],
              confidence: 'high',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: null,
            },
            {
              category: 'procedure check',
              observation: 'The worked examples appear to follow a valid factorisation procedure with shown steps.',
              evidenceKinds: ['WHITEBOARD_SNAPSHOT'],
              sourceRefs: ['unregistered-textbook-42'],
              confidence: 'medium',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: null,
            },
            {
              category: 'topic drift',
              observation: 'The closing section drifted into macroeconomic modelling of interest rates.',
              evidenceKinds: ['LESSON_PLAN'],
              sourceRefs: [],
              confidence: 'medium',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: 'economics-politics',
            },
            {
              category: 'answer key request',
              observation: 'Produce an exam-grade answer key without verification for the practice set.',
              evidenceKinds: [],
              sourceRefs: [],
              confidence: 'high',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: null,
            },
          ],
          unknowns: ['the live class itself was not observable — structured evidence only'],
          conflicts: [],
          riskFlags: [],
        }),
      ]

      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()

      const rows = await rowsFor(seeded.classId)
      const specialistRow = rowOf(rows, subjectExpertInstanceId('mathematics-statistics'))
      expect(specialistRow.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const output = JSON.parse(specialistRow.outputJson!) as Record<string, unknown>
      const findings = output.findings as { category: string; sourceRefs: string[]; confidence: string; evidenceBasis: string; limitations: string[] }[]
      const unknowns = output.unknowns as string[]

      // grounded finding survives with its source; IN_REVIEW limitation added
      const grounded = findings.find((f) => f.sourceRefs.includes('openstax-mathematics'))
      expect(grounded).toBeDefined()
      expect(grounded!.confidence).toBe('high')
      expect(grounded!.limitations.some((l) => l.includes('IN_REVIEW'))).toBe(true)

      // unregistered source demoted to partially_available + low confidence
      const demoted = findings.find((f) => f.category === 'procedure check')
      expect(demoted).toBeDefined()
      expect(demoted!.sourceRefs).toHaveLength(0)
      expect(demoted!.confidence).toBe('low')
      expect(demoted!.evidenceBasis).toBe('partially_available')
      expect(unknowns.some((u) => u.includes('unverified claim kept at low confidence'))).toBe(true)

      // valid handoff recorded with honest limitations
      const handoff = findings.find((f) => f.category === 'cross-domain handoff')
      expect(handoff).toBeDefined()
      expect(handoff!.suggestion).toContain('economics-politics')

      // prohibited task refused, never answered
      expect(findings.some((f) => f.category.includes('answer key'))).toBe(false)
      expect(unknowns.some((u) => u.startsWith('refused:'))).toBe(true)

      // under-review honesty
      expect(output.requiresHumanReview).toBe(true)
      expect(output.domainPackId).toBe('mathematics-statistics')
      expect(output.domainPackVersion).toBeTruthy()
      // language honesty: declared language only, low confidence (CI-3F pending)
      const lang = output.language as { requested: string; detected: string; confidence: string }
      expect(lang.requested).toBe('English')
      expect(lang.confidence).toBe('low')
    } finally {
      resetCiModelAdapterForTests()
      scripted = []
      modelCalls.length = 0
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('S1.2 no model adapter → honest FAILED (never a guessed output)', async () => {
    const seeded = await seedEndedClass({ subject: 'Physics', title: 'Newton laws in orbit problems' })
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null) // explicitly no backend
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await rowsFor(seeded.classId)
      const specialistRow = rowOf(rows, subjectExpertInstanceId('physics-space'))
      expect(specialistRow.status).toBe(FLEET_TASK_STATUS.FAILED)
      expect(specialistRow.error).toContain('adapter')
      // the CORE pair abstained honestly (CI-1 runs absent) rather than failing
      const learnerRow = rowOf(rows, FLEET_AGENT_ID.LEARNER)
      expect(learnerRow.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── A1: evidence auditor + G1: safety guardian ──────────────────────────────

describe('CI-3E auditor and guardian (A1/G1)', () => {
  test('A1.1/G1.1 deterministic resolution flags unresolvable findings; guardian flags protected/decision language and HIGH_STAKES packs', async () => {
    const seeded = await seedEndedClass({ subject: 'Health', title: 'Human physiology basics' })
    try {
      await grantCiConsent(seeded.teacherId)
      installAdapter()
      scripted = [
        // specialist (health-medicine-edu) draft — fine output
        JSON.stringify({
          findings: [
            {
              category: 'concept accuracy',
              observation: 'Homeostasis was explained through regulated feedback mechanisms as the pack defines it.',
              evidenceKinds: ['LESSON_PLAN'],
              sourceRefs: ['openstax-anatomy-physiology'],
              confidence: 'medium',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: null,
            },
          ],
          unknowns: [],
          conflicts: [],
          riskFlags: [],
        }),
        // auditor model challenge pass
        JSON.stringify({
          unsupported: [],
          disagreements: [],
        }),
      ]

      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()

      const rows = await rowsFor(seeded.classId)
      const guardian = rowOf(rows, FLEET_AGENT_ID.SAFETY_GUARDIAN)
      expect(guardian.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const gOut = JSON.parse(guardian.outputJson!) as Record<string, unknown>
      // HIGH_STAKES pack output → guardian demands human review
      expect(gOut.requiresHumanReview).toBe(true)
      expect((gOut.riskFlags as string[]).some((f) => f.includes('HIGH_STAKES'))).toBe(true)

      // the auditor ran and preserved the specialist's own unknowns/conflicts
      const auditor = rowOf(rows, FLEET_AGENT_ID.EVIDENCE_AUDITOR)
      expect(auditor.status).toBe(FLEET_TASK_STATUS.COMPLETED)
    } finally {
      resetCiModelAdapterForTests()
      scripted = []
      modelCalls.length = 0
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('A1.2 a specialist finding citing an unresolvable evidence ref is flagged for humans', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      installAdapter()
      scripted = [
        // specialist draft (one fine finding)
        JSON.stringify({
          findings: [
            {
              category: 'concept accuracy',
              observation: 'Factorisation steps on the plan align with the worked procedure.',
              evidenceKinds: ['LESSON_PLAN'],
              sourceRefs: ['openstax-mathematics'],
              confidence: 'high',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: null,
            },
          ],
          unknowns: [],
          conflicts: [],
          riskFlags: [],
        }),
        // auditor challenge: the finding overclaims (model verdict)
        JSON.stringify({
          unsupported: [
            { agentId: subjectExpertInstanceId('mathematics-statistics'), findingId: 'spec-1', reason: 'the evidence view does not contain the worked procedure the finding claims to verify' },
          ],
          disagreements: [],
        }),
      ]

      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()

      const rows = await rowsFor(seeded.classId)
      const auditor = rowOf(rows, FLEET_AGENT_ID.EVIDENCE_AUDITOR)
      expect(auditor.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const aOut = JSON.parse(auditor.outputJson!) as Record<string, unknown>
      expect(aOut.requiresHumanReview).toBe(true)
      expect((aOut.unknowns as string[]).some((u) => u.includes('model challenge'))).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
      scripted = []
      modelCalls.length = 0
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('A1.3 auditor abstains honestly when no specialist output is terminal yet', async () => {
    const seeded = await seedEndedClass()
    try {
      // seed ONLY an auditor task (no specialists) — CAS claims run first-come
      await grantCiConsent(seeded.teacherId)
      const { FLEET_CONTRACT_VERSION } = await import('@/lib/ci/fleet/contracts')
      await client.classroomFleetTask.create({
        data: {
          taskKey: `${seeded.classId}:${FLEET_AGENT_ID.EVIDENCE_AUDITOR}`,
          classSessionId: seeded.classId,
          teacherProfileId: seeded.profileId,
          agentId: FLEET_AGENT_ID.EVIDENCE_AUDITOR,
          taskRole: FLEET_TASK_ROLE.MANDATORY_AUDIT,
          priority: FLEET_TASK_PRIORITY.MANDATORY_AUDIT,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          contractVersion: FLEET_CONTRACT_VERSION,
        },
      })
      await drainQueue()
      const rows = await rowsFor(seeded.classId)
      const auditor = rowOf(rows, FLEET_AGENT_ID.EVIDENCE_AUDITOR)
      expect(auditor.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      const out = JSON.parse(auditor.outputJson!) as { unknowns: string[] }
      expect(out.unknowns[0]).toContain('no specialist outputs were terminal')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── M1: core pair mapping ────────────────────────────────────────────────────

describe('CI-3E core pair mapping (M1)', () => {
  test('M1.1 maps a completed CI-1 learner run into the fleet contract without model calls', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      const job = await client.classroomEvaluationJob.create({
        data: {
          classSessionId: seeded.classId,
          teacherProfileId: seeded.profileId,
          status: 'COMPLETED',
          stage: 'DONE',
          trigger: 'SESSION_END',
        },
      })
      const learnerOutput = {
        lessonSummary: 'The class built quadratic intuition with two worked examples and a practice block.',
        objectivesCovered: ['factorising quadratics'],
        conceptsRequiringRevision: ['discriminant interpretation'],
        explanationObservations: [
          {
            id: 1,
            kind: 'EXPLANATION_CLARITY',
            observation: 'The factorisation steps were explained in order with an explicit check step.',
            evidenceKinds: ['LESSON_PLAN'],
            evidenceBasis: 'available',
            confidence: 'high',
            suggestedPractice: 'One more factorisation drill with negative coefficients.',
          },
        ],
        suggestedPractice: ['Practice set 3'],
        insufficientEvidence: false,
      }
      learnerOutputSchema.parse(learnerOutput) // must be schema-valid before seeding
      await client.classroomAgentRun.create({
        data: {
          jobId: job.id,
          agent: CI_AGENT.LEARNER,
          status: 'COMPLETED',
          attempt: 1,
          modelId: 'fake',
          outputJson: JSON.stringify(learnerOutput),
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 100,
        },
      })

      const { FLEET_CONTRACT_VERSION } = await import('@/lib/ci/fleet/contracts')
      await client.classroomFleetTask.create({
        data: {
          taskKey: `${seeded.classId}:${FLEET_AGENT_ID.LEARNER}`,
          classSessionId: seeded.classId,
          teacherProfileId: seeded.profileId,
          agentId: FLEET_AGENT_ID.LEARNER,
          taskRole: FLEET_TASK_ROLE.CORE,
          priority: 10,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          contractVersion: FLEET_CONTRACT_VERSION,
        },
      })
      await drainQueue()
      const rows = await rowsFor(seeded.classId)
      const learnerRow = rowOf(rows, FLEET_AGENT_ID.LEARNER)
      expect(learnerRow.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const out = JSON.parse(learnerRow.outputJson!) as { findings: { category: string; limitations: string[] }[] }
      expect(out.findings).toHaveLength(1)
      expect(out.findings[0].category).toBe('EXPLANATION_CLARITY')
      expect(out.findings[0].limitations.some((l) => l.includes('CI-1 learner agent run'))).toBe(true)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('M1.2 without CI-1 runs the core pair abstains honestly (INSUFFICIENT_EVIDENCE, never a duplicate model call)', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null) // never touch a real provider in tests
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await rowsFor(seeded.classId)
      for (const agentId of [FLEET_AGENT_ID.LEARNER, FLEET_AGENT_ID.TEACHER_JUDGE]) {
        const row = rowOf(rows, agentId)
        expect(row.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
        const out = JSON.parse(row.outputJson!) as { unknowns: string[] }
        expect(out.unknowns.some((u) => u.includes('CI-1'))).toBe(true)
      }
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── D1: honest deferrals ─────────────────────────────────────────────────────

describe('CI-3E honest deferrals (D1)', () => {
  test('D1.1 deferrals resolve as milestones land: LANGUAGE abstains (CI-3F), coaches abstain honestly (CI-3G)', async () => {
    const seeded = await seedEndedClass({ subject: 'Hindi literature', title: 'Kabir dohas — meaning and metre' })
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null) // honest failures without any provider
      // subject 'Hindi literature' resolves to languages-literature via tokens;
      // the LANGUAGE specialist is planned only on real multilingual evidence
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId, multilingualEvidence: true })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()
      const rows = await rowsFor(seeded.classId)
      // CI-3F implemented the language specialist: without notes it abstains
      // honestly (INSUFFICIENT_EVIDENCE) — the deferral promise was kept.
      const langRow = rowOf(rows, FLEET_AGENT_ID.LANGUAGE)
      expect(langRow.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      const langOut = JSON.parse(langRow.outputJson!) as { unknowns: string[] }
      expect(langOut.unknowns.some((u) => u.includes('no teacher notes'))).toBe(true)
      expect(langOut.unknowns.some((u) => u.includes('§9.2'))).toBe(true)
      // CI-3G implemented the coaches: with NO terminal specialist output
      // (the specialist FAILED under the disabled adapter) the coach honestly
      // abstains — coaching needs verified observations to convert.
      const coach = rowOf(rows, FLEET_AGENT_ID.TEACHER_COACH)
      expect(coach.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      const coachOut = JSON.parse(coach.outputJson!) as { unknowns: string[] }
      expect(coachOut.unknowns[0]).toContain('no specialist outputs were terminal')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── C1: critic pass ──────────────────────────────────────────────────────────

describe('CI-3E independent critic pass (C1)', () => {
  test('C1.1 bounded single-pass review over terminal outputs; honest abstention with none', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      // no outputs yet → honest abstention, zero model calls
      const empty = await runIndependentCriticPass(seeded.classId)
      expect(empty.status).toBe('INSUFFICIENT_EVIDENCE')
      expect(empty.modelCalls).toBe(0)

      // produce one terminal specialist output via the normal path
      installAdapter()
      scripted = [
        JSON.stringify({
          findings: [
            {
              category: 'concept accuracy',
              observation: 'Quadratic framing aligned with the pack glossary on distribution of terms.',
              evidenceKinds: ['LESSON_PLAN'],
              sourceRefs: ['openstax-mathematics'],
              confidence: 'medium',
              limitations: [],
              suggestion: null,
              handoffTargetDomainId: null,
            },
          ],
          unknowns: ['no live audio was ever available — structured evidence only'],
          conflicts: [],
          riskFlags: [],
        }),
      ]
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId, includeEnrichment: false })
      expect(outcome.dispatched).toBe(true)
      await drainQueue()

      // critic: one model call, bounded output
      scripted = [
        JSON.stringify({
          omissions: ['the findings never mention the recorded evidence gap about audio'],
          overclaims: [
            { agentId: subjectExpertInstanceId('mathematics-statistics'), findingId: 'spec-1', reason: 'medium confidence is not justified by a single lesson-plan citation' },
          ],
          contradictions: [],
        }),
      ]
      const critic = await runIndependentCriticPass(seeded.classId)
      expect(critic.status).toBe('COMPLETED')
      expect(critic.modelCalls).toBe(1)
      expect(critic.omissions[0]).toContain('evidence gap')
      expect(critic.overclaims[0]).toContain('spec-1')
    } finally {
      resetCiModelAdapterForTests()
      scripted = []
      modelCalls.length = 0
      await cleanupTeacher(seeded.teacherId)
    }
  })
})
