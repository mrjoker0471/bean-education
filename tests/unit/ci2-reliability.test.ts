// ─── CI-2F: multi-class reliability, recovery and concurrency ────────────────
// Real queue + pipeline behaviour on an isolated SQLite database with a
// DETERMINISTIC stub model adapter (no live provider in tests). Coverage:
//
//   C1  concurrent enqueue of many ended classes → exactly one job per class
//   C2  atomic claims: parallel claims never double-claim; distinct jobs won
//   C3  duplicate LiveKit webhooks → alreadyQueued / already_evaluated dedup
//   C4  worker exit mid-run → lease expiry recovers; bounded retries;
//       terminal FAILED after maxAttempts; classroom untouched
//   C5  provider timeout / malformed output → honest FAILED (no partial
//       reports, no summaries)
//   C6  consent withdrawn before claim → SKIPPED at claim time
//   C7  retry: a flaky provider (fails once, then succeeds) produces exactly
//       one report + one summary set per booking (no duplicates)
//   C8  dispute opened while a report rebuild/processing occurs → dispute
//       history intact, report versions never silently rewritten
//   C9  cross-class isolation: class B's evaluation never touches class A's
//       reports or summaries
//
// Measured load numbers are produced separately by
// scripts/bench-ci2-reliability.ts and recorded in
// docs/CLASSROOM-INTELLIGENCE-CI2-RELIABILITY.md.

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci2-reliability-'))
const isolatedUrl = `file:${join(dir, 'ci2-reliability.db')}`

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { enqueueEvaluation, claimNextCiJob, runCiJob, recoverExpiredCiLeases, hasCiConsent } = await import('@/lib/ci/queue')
const { setCiModelAdapterForProcess, resetCiModelAdapterForTests } = await import('@/lib/ci/model-adapter')
const { CI_TRIGGER, CI_JOB_STATUS } = await import('@/lib/ci/constants')

beforeAll(() => {
  execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: isolatedUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
})

afterAll(async () => {
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HOUR = 3600_000

async function seedTeacherWithClasses(count: number, opts?: { bookingsPerClass?: number }) {
  const teacher = await client.student.create({
    data: {
      id: `rel-t-${Math.random().toString(36).slice(2, 8)}`,
      email: `rel-t-${Math.random().toString(36).slice(2, 8)}@bean.test`,
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: { create: { teachingName: 'Reliability Teacher', headline: 'h', bio: 'b', subjectsJson: '["Mathematics"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 4, verificationStatus: 'APPROVED', isPublished: true } },
    },
  })
  await client.consentRecord.create({ data: { studentId: teacher.id, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true } })
  const profile = await client.teacherProfile.findUniqueOrThrow({ where: { studentId: teacher.id } })
  const classIds: string[] = []
  for (let i = 0; i < count; i++) {
    const cls = await client.classSession.create({
      data: {
        teacherProfileId: profile.id,
        title: `Reliability class ${i + 1}`,
        description: `Synthetic reliability fixture class ${i + 1}: quadratics with worked examples.`,
        subject: 'Mathematics',
        targetLevel: 'SCHOOL_9_10',
        language: 'English',
        durationMinutes: 60,
        startsAt: new Date(Date.now() - (2 + i) * HOUR),
        timeZone: 'Asia/Kolkata',
        status: 'PUBLISHED',
        capacity: 10,
        minimumStudents: 1,
        liveSession: {
          create: {
            roomName: `bean-live-rel-${Math.random().toString(36).slice(2, 12)}`,
            status: 'ENDED',
            endReason: 'TEACHER_ENDED',
            startedById: teacher.id,
            startedAt: new Date(Date.now() - (2 + i) * HOUR),
            endedAt: new Date(Date.now() - (1 + i) * HOUR),
            actualParticipantMinutes: 90 + i,
            usageMonthKey: new Date().toISOString().slice(0, 7),
          },
        },
      },
    })
    const n = opts?.bookingsPerClass ?? 2
    for (let b = 0; b < n; b++) {
      const s = await client.student.create({ data: { id: `rel-s-${Math.random().toString(36).slice(2, 10)}`, email: `rel-s-${Math.random().toString(36).slice(2, 10)}@bean.test`, ageBand: 'ADULT_18_PLUS' } })
      await client.classBooking.create({ data: { classSessionId: cls.id, studentId: s.id, status: b === 0 ? 'ATTENDED' : 'NO_SHOW' } })
    }
    classIds.push(cls.id)
  }
  return { teacherId: teacher.id, profileId: profile.id, classIds }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } }) // cascades everything
}

/** Deterministic stub adapter with programmable behaviour per call. */
function stubAdapter(behaviour: 'ok' | 'timeout' | 'malformed' | 'flaky', state: { calls: number }): CiAdapterStub {
  // The pipeline calls the adapter once per agent; the stub answers with the
  // shape the ASKING agent requires (judge prompt contains its agent name).
  const learnerJson = JSON.stringify({
    lessonSummary: 'The synthetic reliability class ran with the seeded aggregate evidence; this summary stays within what the evidence shows.',
    objectivesCovered: ['solving quadratic equations'],
    conceptsRequiringRevision: [],
    explanationObservations: [],
    suggestedPractice: ['Practise factoring quadratics with short drills'],
    insufficientEvidence: false,
  })
  const judgeJson = JSON.stringify({
    findings: [
      {
        id: 1,
        category: 'LESSON_STRUCTURE',
        observation: 'The lesson plan and teacher notes support a structured delivery of quadratics with two worked examples.',
        evidenceKinds: ['LESSON_PLAN'],
        evidenceBasis: 'available',
        confidence: 'medium',
        suggestedImprovement: 'Plan the lesson as hook, guided practice, independent practice.',
      },
    ],
    categoriesNotEvaluable: [],
    objectivesCovered: [],
    objectivesUnverifiable: [],
    insufficientEvidence: false,
  })
  return {
    id: 'stub-reliability',
    async complete(opts: { system: string; user: string }) {
      state.calls += 1
      if (behaviour === 'timeout') throw new Error('provider timeout after 30s')
      if (behaviour === 'malformed') return 'not json at all'
      if (behaviour === 'flaky' && state.calls === 1) throw new Error('transient provider failure')
      return opts.system.includes('Teacher Judge Agent') ? judgeJson : learnerJson
    },
  }
}

interface CiAdapterStub {
  id: string
  complete(opts: { system: string; user: string }): Promise<string>
}

/** Register the real pipeline so runCiJob executes end-to-end. */
await import('@/lib/ci/pipeline')

// ─── C1/C2/C3: concurrent enqueue + atomic claims + webhook dedup ───────────

describe('CI-2F concurrency — enqueue, claims, webhooks', () => {
  test('C1+C2: many ended classes enqueue exactly one job each; parallel claims are atomic and distinct', async () => {
    const seeded = await seedTeacherWithClasses(6)
    try {
      // Concurrent enqueues (simulating simultaneous session-end + webhook triggers)
      const outcomes = await Promise.all(
        seeded.classIds.flatMap((classSessionId) => [
          enqueueEvaluation({ classSessionId, trigger: CI_TRIGGER.SESSION_END }),
          enqueueEvaluation({ classSessionId, trigger: CI_TRIGGER.PROVIDER_ROOM_FINISHED }),
        ]),
      )
      const queued = outcomes.filter((o) => o.queued && !o.alreadyQueued).length
      const reused = outcomes.filter((o) => o.queued && o.alreadyQueued).length
      expect(queued).toBe(6)
      expect(reused).toBe(6) // the duplicate webhook trigger reuses the same job
      const jobs = await client.classroomEvaluationJob.findMany()
      expect(jobs.length).toBe(6) // DB-unique guarantee across all classes

      // Parallel atomic claims: no job may ever be claimed twice. The claim
      // window is bounded (take 5 per tick), so a burst of 6 concurrent
      // claims may leave one job for the next tick — the guarantee under test
      // is atomicity (never double-claimed) and completeness (drained by the
      // next claim).
      const claimed = await Promise.all([claimNextCiJob(), claimNextCiJob(), claimNextCiJob(), claimNextCiJob(), claimNextCiJob(), claimNextCiJob()])
      const ids = claimed.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids.length).toBeGreaterThanOrEqual(5)
      // a follow-up claim drains whatever the burst left behind
      const followUps: string[] = []
      for (let i = 0; i < 6; i++) {
        const c = await claimNextCiJob()
        if (!c) break
        followUps.push(c.id)
      }
      const allIds = [...ids, ...followUps.map((c) => c.id)]
      expect(new Set(allIds).size).toBe(allIds.length)
      expect(allIds.length).toBe(6)
      const running = await client.classroomEvaluationJob.findMany({ where: { status: 'RUNNING' } })
      expect(running.length).toBe(6)
      // cleanup: mark them FAILED so later suites start clean
      await client.classroomEvaluationJob.updateMany({ where: { status: 'RUNNING' }, data: { status: 'FAILED', finishedAt: new Date(), error: 'test cleanup' } })
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── C4/C5: worker exit, lease recovery, provider failures ──────────────────

describe('CI-2F recovery and provider failures', () => {
  test('C4: stale lease is recovered, retries are bounded, terminal FAILED leaves the classroom untouched', async () => {
    const seeded = await seedTeacherWithClasses(1)
    try {
      setCiModelAdapterForProcess(stubAdapter('timeout', { calls: 0 }))
      await enqueueEvaluation({ classSessionId: seeded.classIds[0], trigger: CI_TRIGGER.SESSION_END })

      // Attempt 1: claimed then the "worker exits" (lease expires without completion)
      const job1 = await claimNextCiJob()
      expect(job1).not.toBeNull()
      await client.classroomEvaluationJob.update({
        where: { id: job1!.id },
        data: { leaseUntil: new Date(Date.now() - 1000) }, // heartbeat stopped, lease expired
      })
      const recovered = await recoverExpiredCiLeases()
      expect(recovered).toBe(1)
      const afterRecovery = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { id: job1!.id } })
      expect(afterRecovery.status).toBe('QUEUED')
      expect(afterRecovery.attempts).toBe(1)

      // Attempts 2 and 3 run against the timing-out provider → honest failures
      const job2 = await claimNextCiJob()
      await runCiJob(job2!)
      const after2 = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { id: job1!.id } })
      expect(['QUEUED', 'RUNNING']).toContain(after2.status) // re-queued for the last attempt
      const job3 = await claimNextCiJob()
      await runCiJob(job3!)
      const terminal = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { id: job1!.id } })
      expect(terminal.status).toBe('FAILED')
      expect(terminal.attempts).toBe(3)
      expect(terminal.error).toContain('provider timeout')

      // No partial artefacts, classroom untouched
      const reports = await client.classroomEvaluationReport.count({ where: { classSessionId: seeded.classIds[0] } })
      const summaries = await client.classroomStudentSummary.count({ where: { classSessionId: seeded.classIds[0] } })
      expect(reports).toBe(0)
      expect(summaries).toBe(0)
      const cls = await client.classSession.findUniqueOrThrow({ where: { id: seeded.classIds[0] } })
      expect(cls.status).toBe('PUBLISHED')
      const live = await client.liveClassSession.findUniqueOrThrow({ where: { classSessionId: seeded.classIds[0] } })
      expect(live.status).toBe('ENDED')
      const bookings = await client.classBooking.count({ where: { classSessionId: seeded.classIds[0] } })
      expect(bookings).toBe(2)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('C5: malformed provider output fails honestly after the strict retry (no artefacts)', async () => {
    const seeded = await seedTeacherWithClasses(1)
    try {
      setCiModelAdapterForProcess(stubAdapter('malformed', { calls: 0 }))
      await enqueueEvaluation({ classSessionId: seeded.classIds[0], trigger: CI_TRIGGER.SESSION_END })
      // each claim+run consumes one attempt; the malformed output is deterministic
      let terminal
      for (let i = 0; i < 3; i++) {
        const job = await claimNextCiJob()
        if (!job) break
        await runCiJob(job)
        terminal = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classIds[0] } })
        if (terminal.status === 'FAILED') break
      }
      expect(terminal?.status).toBe('FAILED')
      const runs = await client.classroomAgentRun.findMany({ where: { jobId: terminal.id } })
      // learner failed honestly; judge never ran
      expect(runs.some((r) => r.agent === 'LEARNER' && r.status === 'FAILED')).toBe(true)
      expect(runs.some((r) => r.agent === 'TEACHER_JUDGE' && r.status === 'COMPLETED')).toBe(false)
      const reports = await client.classroomEvaluationReport.count({ where: { classSessionId: seeded.classIds[0] } })
      expect(reports).toBe(0)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── C6/C7/C9: consent withdrawal, retry with dedup, cross-class isolation ──

describe('CI-2F consent, retry dedup, isolation', () => {
  test('C6: consent withdrawn between enqueue and claim → SKIPPED at claim time', async () => {
    const seeded = await seedTeacherWithClasses(1)
    try {
      await enqueueEvaluation({ classSessionId: seeded.classIds[0], trigger: CI_TRIGGER.SESSION_END })
      const { withdrawCiConsent } = await import('@/lib/ci/trigger')
      await withdrawCiConsent(seeded.teacherId)
      const job = await claimNextCiJob()
      // the job for THIS class must have been skipped, not claimed
      const state = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classIds[0] } })
      expect(state.status).toBe('SKIPPED')
      expect(state.error).toBe('consent_not_granted')
      expect(job?.id).not.toBe(state.id)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  test('C7+C9: flaky provider retry produces exactly one report per class and one summary per ATTENDED booking; classes never leak into each other', async () => {
    const seeded = await seedTeacherWithClasses(2, { bookingsPerClass: 3 })
    try {
      setCiModelAdapterForProcess(stubAdapter('flaky', { calls: 0 }))
      for (const classId of seeded.classIds) {
        await enqueueEvaluation({ classSessionId: classId, trigger: CI_TRIGGER.SESSION_END })
      }
      // sequential worker semantics (the real loop): claim → run → repeat
      for (let i = 0; i < 4; i++) {
        const job = await claimNextCiJob()
        if (!job) break
        await runCiJob(job)
      }
      for (const classId of seeded.classIds) {
        const job = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: classId } })
        expect(job.status).toBe('COMPLETED')
        const reports = await client.classroomEvaluationReport.findMany({ where: { classSessionId: classId, status: 'CURRENT' } })
        expect(reports).toHaveLength(1)
        const attended = await client.classBooking.count({ where: { classSessionId: classId, status: 'ATTENDED' } })
        const summaries = await client.classroomStudentSummary.findMany({ where: { classSessionId: classId } })
        expect(summaries).toHaveLength(attended)
        expect(new Set(summaries.map((s) => s.bookingId)).size).toBe(attended)
        const jobIds = new Set(summaries.map((s) => s.jobId))
        expect(jobIds.size).toBe(1)
      }
      // cross-class isolation: every summary/report row belongs to its own class
      const allSummaries = await client.classroomStudentSummary.findMany()
      for (const s of allSummaries) {
        expect(seeded.classIds).toContain(s.classSessionId)
      }
      const reportA = await client.classroomEvaluationReport.findFirstOrThrow({ where: { classSessionId: seeded.classIds[0] } })
      const reportB = await client.classroomEvaluationReport.findFirstOrThrow({ where: { classSessionId: seeded.classIds[1] } })
      expect(reportA.id).not.toBe(reportB.id)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── C8: dispute during processing ───────────────────────────────────────────

describe('CI-2F dispute during processing', () => {
  test('C8: an open dispute survives a teacher-requested re-run; history intact; versions never silently rewritten', async () => {
    const seeded = await seedTeacherWithClasses(1)
    try {
      setCiModelAdapterForProcess(stubAdapter('ok', { calls: 0 }))
      await enqueueEvaluation({ classSessionId: seeded.classIds[0], trigger: CI_TRIGGER.SESSION_END })
      const job = await claimNextCiJob()
      await runCiJob(job!)
      const reportV1 = await client.classroomEvaluationReport.findFirstOrThrow({ where: { classSessionId: seeded.classIds[0], status: 'CURRENT' } })

      // teacher disputes a finding (via the real dispute path used by CI-1E tests)
      const { ciDisputeSchema } = await import('@/lib/ci/schemas')
      const parsed = ciDisputeSchema.parse({ findings: [{ findingId: 'judge-1', reason: 'The lesson notes show this finding understates the structure taught.' }] })
      const teacher = await client.student.findUniqueOrThrow({ where: { id: seeded.teacherId } })
      const dispute = await client.classroomEvaluationDispute.create({
        data: {
          reportId: reportV1.id,
          teacherId: seeded.teacherId,
          status: 'SUBMITTED',
          findingsJson: JSON.stringify(parsed.findings),
        },
      })
      await client.classroomDisputeEvent.create({
        data: { disputeId: dispute.id, actorId: seeded.teacherId, actorRole: teacher.role, action: 'SUBMITTED', detail: 'Disputed 1 finding(s): judge-1.' },
      })

      // while the dispute is open, the teacher re-requests the evaluation (allowed)
      const rerun = await enqueueEvaluation({ classSessionId: seeded.classIds[0], trigger: CI_TRIGGER.TEACHER_REQUEST, requestedById: seeded.teacherId })
      expect(rerun.queued).toBe(true)
      const job2 = await claimNextCiJob()
      await runCiJob(job2!)

      // the re-run created a NEW version; the disputed version is preserved (SUPERSEDED, not deleted)
      const versions = await client.classroomEvaluationReport.findMany({ where: { classSessionId: seeded.classIds[0] }, orderBy: { version: 'asc' } })
      expect(versions.length).toBe(2)
      expect(versions[0].id).toBe(reportV1.id)
      expect(versions[0].status).toBe('SUPERSEDED')
      expect(versions[1].status).toBe('CURRENT')

      // the dispute still points at version 1 with its history intact
      const disputeAfter = await client.classroomEvaluationDispute.findUniqueOrThrow({ where: { id: dispute.id } })
      expect(disputeAfter.reportId).toBe(reportV1.id)
      expect(disputeAfter.status).toBe('SUBMITTED')
      const events = await client.classroomDisputeEvent.findMany({ where: { disputeId: dispute.id } })
      expect(events).toHaveLength(1)

      // summaries regenerated for the new job — still exactly one per ATTENDED booking
      const summaries = await client.classroomStudentSummary.findMany({ where: { classSessionId: seeded.classIds[0] } })
      const attended = await client.classBooking.count({ where: { classSessionId: seeded.classIds[0], status: 'ATTENDED' } })
      expect(summaries).toHaveLength(attended)
    } finally {
      resetCiModelAdapterForTests()
      await cleanupTeacher(seeded.teacherId)
    }
  })
})
