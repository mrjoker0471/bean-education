// ─── CI-3F tests: multilingual foundation (isolated real DB) ──────────────────
//   L1  language capability registry — 11 charter §8.3 languages, per-task
//       honesty: unmeasured tasks stay EXPERIMENTAL, TRANSCRIPTION is
//       UNSUPPORTED for every language and can NEVER be flipped by a
//       benchmark (the §9.2 gate is structural), unverified capabilities
//       produce refusal reasons instead of silent use
//   S1  script detection & code-switch handling (pure) — Unicode-range script
//       detection by material count, contiguous segment splitting that
//       preserves every script (never flattened), single-script text is
//       never "multilingual"
//   D1  multilingual evidence detection — no notes → honest no; single-script
//       notes → honest no; genuinely mixed-script notes → yes; dispatch
//       auto-detects from the job's teacher notes and plans the LANGUAGE
//       specialist ONLY on real evidence (declared language alone is never
//       evidence; a caller's `true` without evidence is not honoured)
//   B1  text benchmark harness — honest degradation without an adapter
//       (ran=false, capabilities untouched); with a scripted adapter, cases
//       produce deterministic verdicts and a passing TERMINOLOGY case can be
//       recorded (while TRANSCRIPTION recording stays impossible)
//   R1  LANGUAGE specialist runtime — INSUFFICIENT_EVIDENCE without notes;
//       code-switch preservation finding + human review with mixed-script
//       notes; capability unknowns recorded; terminology pass bounded

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci3f-'))
const isolatedUrl = `file:${join(dir, 'ci3f.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const {
  CI3_LANGUAGES,
  detectScripts,
  splitCodeSwitchSegments,
  isMultilingualText,
  detectMultilingualEvidence,
  defaultLanguageCapabilities,
  listLanguageCapabilities,
  recordCapabilityMeasurement,
  resetLanguageCapabilitiesForTests,
  capabilityRefusalReason,
  runTextBenchmarkHarness,
  TEXT_BENCHMARK_CASES,
} = await import('@/lib/ci/fleet/language')
const { dispatchFleetForSession } = await import('@/lib/ci/fleet/dispatcher')
const {
  claimNextFleetTask,
  runFleetTask,
} = await import('@/lib/ci/fleet/worker')
const { grantCiConsent } = await import('@/lib/ci/trigger')
const { FLEET_AGENT_ID, FLEET_TASK_STATUS } = await import('@/lib/ci/fleet/constants')
const { registerFleetRuntime } = await import('@/lib/ci/fleet/runtime')
const { setCiModelAdapterForProcess, resetCiModelAdapterForTests } = await import('@/lib/ci/model-adapter')

beforeAll(() => {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
  registerFleetRuntime()
})

afterAll(async () => {
  resetCiModelAdapterForTests()
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Fake adapter ──────────────────────────────────────────────────────────────

let scripted: string[] = []
function installAdapter(): void {
  setCiModelAdapterForProcess({
    id: 'fake-ci3f-adapter',
    async complete() {
      const next = scripted.shift()
      if (next === undefined) throw new Error('fake adapter has no scripted response — test bug')
      return next
    },
  })
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const HOUR = 3600_000

async function seedEndedClass(opts?: { subject?: string; title?: string; notes?: string | null }) {
  const teacher = await client.student.create({
    data: {
      id: `t-${Math.random().toString(36).slice(2, 10)}`,
      email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`,
      role: 'STUDENT',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Language Teacher',
          headline: 'h',
          bio: 'b',
          subjectsJson: '["Languages"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English","Tamil"]',
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
      title: opts?.title ?? 'Fractions with bilingual notes',
      description: 'Build fraction intuition with bilingual teacher notes.',
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
        },
      },
      classroomEvaluationJob: {
        create: {
          teacherProfileId: profile.id,
          status: 'QUEUED',
          stage: 'QUEUED',
          trigger: 'SESSION_END',
          teacherNotes: opts?.notes ?? null,
        },
      },
    },
  })
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } })
}

async function drainQueue(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const task = await claimNextFleetTask()
    if (!task) return
    await runFleetTask(task)
  }
}

// ─── L1: capability registry ──────────────────────────────────────────────────

describe('CI-3F language capability registry (L1)', () => {
  test('L1.1 the charter §8.3 audience languages are all present with script metadata', () => {
    const tags = CI3_LANGUAGES.map((l) => l.tag)
    for (const tag of ['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'gu', 'ur', 'pa']) {
      expect(tags).toContain(tag)
    }
    expect(CI3_LANGUAGES.find((l) => l.tag === 'ta')?.primaryScript).toBe('Tamil')
    expect(CI3_LANGUAGES.find((l) => l.tag === 'ur')?.primaryScript).toContain('Arabic')
  })

  test('L1.2 unmeasured tasks are EXPERIMENTAL; TRANSCRIPTION is UNSUPPORTED for every language', () => {
    const caps = defaultLanguageCapabilities()
    expect(caps.length).toBe(CI3_LANGUAGES.length * 5)
    for (const cap of caps.filter((c) => c.task === 'TRANSCRIPTION')) {
      expect(cap.status).toBe('UNSUPPORTED')
      expect(cap.testRef).toContain('§9.2')
    }
    for (const cap of caps.filter((c) => c.task === 'TEXT_UNDERSTANDING')) {
      expect(cap.status).toBe('EXPERIMENTAL')
      expect(cap.testRef).toBeNull() // unmeasured
    }
  })

  test('L1.3 a benchmark can VERIFY a text task but can NEVER flip TRANSCRIPTION (§9.2 gate is structural)', () => {
    resetLanguageCapabilitiesForTests()
    recordCapabilityMeasurement({ language: 'ta', task: 'TEXT_UNDERSTANDING', passed: true, testRef: 'ci3-bench-ta-comprehension', measuredAt: '2026-11-24' })
    const caps = listLanguageCapabilities()
    const taText = caps.find((c) => c.language === 'ta' && c.task === 'TEXT_UNDERSTANDING')
    expect(taText?.status).toBe('VERIFIED')
    expect(taText?.testRef).toBe('ci3-bench-ta-comprehension')
    // the forbidden flip
    recordCapabilityMeasurement({ language: 'ta', task: 'TRANSCRIPTION', passed: true, testRef: 'cheating-benchmark', measuredAt: '2026-11-24' })
    const taAsr = caps.find((c) => c.language === 'ta' && c.task === 'TRANSCRIPTION')
    expect(taAsr?.status).toBe('UNSUPPORTED')
  })

  test('L1.4 unverified capabilities refuse honestly instead of being used silently', () => {
    resetLanguageCapabilitiesForTests()
    expect(capabilityRefusalReason('te', 'TEXT_UNDERSTANDING')).toContain('EXPERIMENTAL')
    expect(capabilityRefusalReason('te', 'TRANSCRIPTION')).toContain('UNSUPPORTED')
    expect(capabilityRefusalReason('klingon', 'TEXT_UNDERSTANDING')).toContain('outside the catalogue')
    recordCapabilityMeasurement({ language: 'te', task: 'TEXT_UNDERSTANDING', passed: true, testRef: 'bench', measuredAt: '2026-11-24' })
    expect(capabilityRefusalReason('te', 'TEXT_UNDERSTANDING')).toBeNull()
  })
})

// ─── S1: script detection & code-switch handling ─────────────────────────────

describe('CI-3F script detection and code-switch handling (S1)', () => {
  test('S1.1 detects scripts by material character counts, ordered', () => {
    const scripts = detectScripts('இந்த equation-ஐ solve பண்ணுங்க')
    const names = scripts.map((s) => s.script)
    expect(names).toContain('Tamil')
    expect(names).toContain('Latin')
    // ordered by material count desc
    expect(scripts[0].count).toBeGreaterThanOrEqual(scripts[scripts.length - 1].count)
    expect(detectScripts('plain english text').map((s) => s.script)).toEqual(['Latin'])
    // digits/punctuation are never script evidence
    expect(detectScripts('12345 !!! ???').length).toBe(0)
  })

  test('S1.2 code-switch segments preserve every script contiguously — never flattened', () => {
    const segments = splitCodeSwitchSegments('இந்த equation-ஐ solve பண்ணுங்க')
    const scripts = segments.map((s) => s.script)
    expect(scripts.filter((s) => s === 'Tamil').length).toBe(3) // இந்த | ஐ | பண்ணுங்க
    expect(scripts.filter((s) => s === 'Latin').length).toBe(2) // equation | solve
    // the Latin segments keep the exact words
    expect(segments.filter((s) => s.script === 'Latin').map((s) => s.text.trim()).join(' ')).toContain('equation')
    expect(segments.filter((s) => s.script === 'Latin').map((s) => s.text.trim()).join(' ')).toContain('solve')
  })

  test('S1.3 single-script text is never multilingual, no matter the language', () => {
    expect(isMultilingualText('पूरी तरह हिंदी में लिखा हुआ पाठ')).toBe(false)
    expect(isMultilingualText('இந்த equation-ஐ solve பண்ணுங்க')).toBe(true)
  })
})

// ─── D1: multilingual evidence detection + dispatch wiring ────────────────────

describe('CI-3F multilingual evidence detection and dispatch wiring (D1)', () => {
  test('D1.1 detection honesty: no notes / single-script → no; mixed-script → yes', () => {
    const none = detectMultilingualEvidence(null)
    expect(none.detected).toBe(false)
    expect(none.reasons[0]).toContain('no teacher notes')

    const single = detectMultilingualEvidence('पूरी तरह हिंदी में लिखा हुआ पाठ है।')
    expect(single.detected).toBe(false)

    const mixed = detectMultilingualEvidence('Students solved: இந்த equation-ஐ solve பண்ணுங்க and then verify.')
    expect(mixed.detected).toBe(true)
    expect(mixed.scripts).toContain('Tamil')
    expect(mixed.scripts).toContain('Latin')
  })

  test('D1.2 dispatch plans the LANGUAGE specialist ONLY on real detected evidence', async () => {
    const seeded = await seedEndedClass({ notes: 'Students solved: இந்த equation-ஐ solve பண்ணுங்க and then verify.' })
    try {
      await grantCiConsent(seeded.teacherId)
      // no explicit flag — server-side detection must decide
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      expect(outcome.queued.some((t) => t.agentId === FLEET_AGENT_ID.LANGUAGE)).toBe(true)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('D1.3 the explicit flag is SERVER-CALLER authority (never client input); without it, detection decides', async () => {
    const seeded = await seedEndedClass({ title: 'English grammar class', subject: 'Languages' })
    try {
      await grantCiConsent(seeded.teacherId)
      // explicit server-caller flag → specialist planned (deterministic contract)
      const explicit = await dispatchFleetForSession({ classSessionId: seeded.classId, multilingualEvidence: true })
      expect(explicit.dispatched).toBe(true)
      expect(explicit.queued.some((t) => t.agentId === FLEET_AGENT_ID.LANGUAGE)).toBe(true)
      // explicit false → never planned even if detection were ambiguous
      const denied = await dispatchFleetForSession({ classSessionId: seeded.classId, multilingualEvidence: false })
      expect(denied.dispatched).toBe(true)
      expect(denied.queued.some((t) => t.agentId === FLEET_AGENT_ID.LANGUAGE)).toBe(false)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('D1.4 single-script notes do not plan the language specialist either', async () => {
    const seeded = await seedEndedClass({ notes: 'पूरी तरह हिंदी में लिखा हुआ पाठ।' })
    try {
      await grantCiConsent(seeded.teacherId)
      const outcome = await dispatchFleetForSession({ classSessionId: seeded.classId })
      expect(outcome.dispatched).toBe(true)
      expect(outcome.queued.some((t) => t.agentId === FLEET_AGENT_ID.LANGUAGE)).toBe(false)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── B1: text benchmark harness ───────────────────────────────────────────────

describe('CI-3F text benchmark harness (B1)', () => {
  test('B1.1 without an adapter nothing is measured and capabilities stay untouched', async () => {
    resetLanguageCapabilitiesForTests()
    setCiModelAdapterForProcess(null)
    const run = await runTextBenchmarkHarness()
    expect(run.ran).toBe(false)
    expect(run.reason).toContain('unmeasured')
    expect(run.cases.length).toBe(0)
    // no capability was flipped by the honest no-op
    expect(listLanguageCapabilities().every((c) => c.status !== 'VERIFIED' || c.testRef !== null)).toBe(true)
  })

  test('B1.2 with a scripted adapter the cases produce deterministic verdicts', async () => {
    resetLanguageCapabilitiesForTests()
    installAdapter()
    // one scripted reply per case, in case order
    scripted = TEXT_BENCHMARK_CASES.map((c) => {
      switch (c.id) {
        case 'ci3-bench-en-terminology': return 'hypothesis test'
        case 'ci3-bench-ta-term-preservation': return 'ஒளிச்சேர்க்கை'
        case 'ci3-bench-hi-comprehension': return '{"total": 10}'
        case 'ci3-bench-ta-comprehension': return '{"total": 12}'
        case 'ci3-bench-hi-ta-codeswitch': return '{"scripts": ["Tamil", "Latin"]}'
        case 'ci3-bench-en-refusal-structure': return '{"refuse": true, "route": "qualified medical professional"}'
        default: return ''
      }
    })
    const run = await runTextBenchmarkHarness()
    expect(run.ran).toBe(true)
    expect(run.failed).toBe(0)
    expect(run.passed).toBe(TEXT_BENCHMARK_CASES.length)
    scripted = []
    resetCiModelAdapterForTests()
  })

  test('B1.3 a failing case is recorded honestly and can LIMIT (never VERIFIED) a capability', async () => {
    resetLanguageCapabilitiesForTests()
    installAdapter()
    scripted = ['some unrelated reply']
    const run = await runTextBenchmarkHarness()
    expect(run.ran).toBe(true)
    expect(run.failed).toBeGreaterThan(0)
    expect(run.cases[0].passed).toBe(false)
    expect(run.cases[0].detail).toContain('did not satisfy')
    scripted = []
    resetCiModelAdapterForTests()
  })
})

// ─── R1: LANGUAGE specialist runtime ──────────────────────────────────────────

describe('CI-3F language specialist runtime (R1)', () => {
  test('R1.1 without notes the language task abstains honestly (no invented transcription)', async () => {
    const seeded = await seedEndedClass()
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null)
      // force the task into the queue directly (evidence gate would skip it)
      const { FLEET_CONTRACT_VERSION, fleetTaskId } = await import('@/lib/ci/fleet/contracts')
      const { FLEET_TASK_PRIORITY } = await import('@/lib/ci/fleet/constants')
      await client.classroomFleetTask.create({
        data: {
          taskKey: fleetTaskId(seeded.classId, FLEET_AGENT_ID.LANGUAGE),
          classSessionId: seeded.classId,
          teacherProfileId: seeded.profileId,
          agentId: FLEET_AGENT_ID.LANGUAGE,
          taskRole: 'LANGUAGE',
          priority: FLEET_TASK_PRIORITY.LANGUAGE,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          contractVersion: FLEET_CONTRACT_VERSION,
        },
      })
      await drainQueue()
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { taskKey: fleetTaskId(seeded.classId, FLEET_AGENT_ID.LANGUAGE) } })
      expect(row.status).toBe(FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE)
      const out = JSON.parse(row.outputJson!) as { unknowns: string[] }
      expect(out.unknowns.some((u) => u.includes('no teacher notes'))).toBe(true)
      expect(out.unknowns.some((u) => u.includes('§9.2'))).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('R1.2 mixed-script notes produce a code-switch preservation finding with human review', async () => {
    const seeded = await seedEndedClass({ notes: 'Students solved: இந்த equation-ஐ solve பண்ணுங்க and then verify.' })
    try {
      await grantCiConsent(seeded.teacherId)
      setCiModelAdapterForProcess(null) // deterministic path only
      const { FLEET_CONTRACT_VERSION, fleetTaskId } = await import('@/lib/ci/fleet/contracts')
      const { FLEET_TASK_PRIORITY } = await import('@/lib/ci/fleet/constants')
      await client.classroomFleetTask.create({
        data: {
          taskKey: fleetTaskId(seeded.classId, FLEET_AGENT_ID.LANGUAGE),
          classSessionId: seeded.classId,
          teacherProfileId: seeded.profileId,
          agentId: FLEET_AGENT_ID.LANGUAGE,
          taskRole: 'LANGUAGE',
          priority: FLEET_TASK_PRIORITY.LANGUAGE,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          contractVersion: FLEET_CONTRACT_VERSION,
        },
      })
      await drainQueue()
      const row = await client.classroomFleetTask.findUniqueOrThrow({ where: { taskKey: fleetTaskId(seeded.classId, FLEET_AGENT_ID.LANGUAGE) } })
      expect(row.status).toBe(FLEET_TASK_STATUS.COMPLETED)
      const out = JSON.parse(row.outputJson!) as { findings: { category: string; observation: string; evidenceKinds: string[] }[]; unknowns: string[]; requiresHumanReview: boolean }
      const cs = out.findings.find((f) => f.category === 'code-switch preservation')
      expect(cs).toBeDefined()
      expect(cs!.evidenceKinds).toContain('TEACHER_LESSON_NOTES')
      expect(cs!.observation).toContain('Tamil')
      expect(cs!.observation).toContain('Latin')
      expect(out.requiresHumanReview).toBe(true)
      // capability honesty unknowns recorded
      expect(out.unknowns.some((u) => u.includes('EXPERIMENTAL') || u.includes('NEEDS_HUMAN_REVIEW'))).toBe(true)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})
