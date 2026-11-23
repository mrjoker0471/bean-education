// ─── BEAN Classroom Intelligence (CI-1B): runtime tests on an isolated DB ────
// Real API/database behaviour, not mocked UI output. Coverage:
//   E1–E4  evidence gathering: attendance association, aggregate-only interval
//          evidence (no identities), whiteboard structural honesty, no-live
//          degradation, evidence-ref availability truthfulness
//   Q1–Q7  queue: consent gating (no row without consent), duplicate job
//          prevention (unique + reuse), auto-trigger dedup after terminal
//          states, explicit re-request reset, CAS claim, consent re-check at
//          claim time, lease recovery, retry → honest FAILED, pipeline-missing
//          honest failure, and the classroom-unaffected guarantee (a failed
//          evaluation never touches class/booking/live rows)

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci-runtime-'))
const isolatedUrl = `file:${join(dir, 'ci-runtime.db')}`

// Bind the app's db singleton to the isolated database BEFORE the modules
// under test are imported (mock.module runs first; dynamic imports follow).
const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
mock.module('@/lib/db', () => ({ db: client }))

const { gatherEvidence, buildEvidenceRefs, toEvidenceView } = await import('@/lib/ci/evidence')
const { enqueueEvaluation, claimNextCiJob, runCiJob, recoverExpiredCiLeases, registerCiEvaluationPipeline, hasCiConsent, lastGatheredEvidence } = await import('@/lib/ci/queue')
const { grantCiConsent, withdrawCiConsent, getCiConsentState } = await import('@/lib/ci/trigger')
const { CI_JOB_STATUS, CI_STAGE, CI_TRIGGER, CI_AGENT, CI_EVIDENCE_KIND } = await import('@/lib/ci/constants')

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

// ─── Seed helpers ───────────────────────────────────────────────────────────────

const HOUR = 3600_000

async function seedTeacherAndClass(opts?: { liveStatus?: string; liveEnded?: boolean; bookings?: Array<'ATTENDED' | 'NO_SHOW' | 'CANCELLED' | 'CONFIRMED'>; participants?: Array<{ role: 'TEACHER' | 'STUDENT'; seconds: number; reconnects: number }>; whiteboardStrokes?: number }) {
  const teacher = await client.student.create({
    data: { id: `t-${Math.random().toString(36).slice(2, 10)}`, email: `t-${Math.random().toString(36).slice(2, 10)}@bean.test`, role: 'STUDENT', ageBand: 'ADULT_18_PLUS', onboardedAt: new Date(), teacherProfile: { create: { teachingName: 'Teacher T', headline: 'h', bio: 'b', subjectsJson: '["Maths"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 3, verificationStatus: 'APPROVED', isPublished: true } } },
  })
  const profile = await client.teacherProfile.findFirstOrThrow({ where: { studentId: teacher.id } })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: profile.id,
      title: 'Quadratic equations — intuition first',
      description: 'Build the intuition behind quadratics, then solve by factorisation and the formula.',
      subject: 'Mathematics',
      targetLevel: 'SCHOOL_9_10',
      language: 'English',
      durationMinutes: 60,
      startsAt: new Date(Date.now() - 2 * HOUR),
      timeZone: 'Asia/Kolkata',
      status: 'PUBLISHED',
      capacity: 10,
      minimumStudents: 1,
    },
  })
  if (opts?.liveStatus) {
    const live = await client.liveClassSession.create({
      data: {
        classSessionId: cls.id,
        roomName: `bean-live-${Math.random().toString(36).slice(2, 12)}`,
        status: opts.liveStatus,
        startedById: teacher.id,
        startedAt: new Date(Date.now() - 2 * HOUR),
        endedAt: opts.liveEnded ? new Date(Date.now() - 1 * HOUR) : null,
        usageMonthKey: new Date().toISOString().slice(0, 7),
      },
    })
    for (const p of opts?.participants ?? []) {
      await client.liveClassParticipant.create({
        data: {
          liveClassSessionId: live.id,
          studentId: p.role === 'TEACHER' ? teacher.id : (await client.student.create({ data: { id: `s-${Math.random().toString(36).slice(2, 10)}`, email: `s-${Math.random().toString(36).slice(2, 10)}@bean.test`, ageBand: 'ADULT_18_PLUS' } })).id,
          participantIdentity: `bean:pid-${Math.random().toString(36).slice(2, 10)}`,
          participantRole: p.role,
          totalConnectedSeconds: p.seconds,
          reconnectCount: p.reconnects,
        },
      })
    }
    if (opts?.whiteboardStrokes !== undefined) {
      await client.liveWhiteboardState.create({
        data: {
          liveClassSessionId: live.id,
          snapshotJson: JSON.stringify({ v: 1, strokes: Array.from({ length: opts.whiteboardStrokes }, (_, i) => ({ id: `k${i}`, mode: 'pen', color: '#d4af37', size: 3, points: [[0.1, 0.1], [0.2, 0.2]] })) }),
          updatedById: teacher.id,
        },
      })
    }
  }
  for (const status of opts?.bookings ?? []) {
    const student = await client.student.create({ data: { id: `b-${Math.random().toString(36).slice(2, 10)}`, email: `b-${Math.random().toString(36).slice(2, 10)}@bean.test`, ageBand: 'ADULT_18_PLUS' } })
    await client.classBooking.create({ data: { classSessionId: cls.id, studentId: student.id, status } })
  }
  return { teacherId: teacher.id, profileId: profile.id, classId: cls.id }
}

async function cleanupTeacher(teacherId: string) {
  await client.student.deleteMany({ where: { id: teacherId } }) // cascades everything
}

// ─── Evidence (E) ───────────────────────────────────────────────────────────────

describe('CI evidence gathering (real DB)', () => {
  it('E1: associates bookings and verified intervals — aggregates only, no identities in the view', async () => {
    const seeded = await seedTeacherAndClass({
      liveStatus: 'ENDED',
      liveEnded: true,
      bookings: ['ATTENDED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'],
      participants: [
        { role: 'TEACHER', seconds: 3300, reconnects: 0 },
        { role: 'STUDENT', seconds: 3000, reconnects: 1 },
        { role: 'STUDENT', seconds: 1800, reconnects: 2 },
      ],
    })
    try {
      const bundle = await gatherEvidence(seeded.classId)
      expect(bundle.attendance).toEqual({ attended: 2, noShow: 1, cancelled: 1, confirmedNotMarked: 0, totalBookings: 4 })
      expect(bundle.participantIntervals).not.toBeNull()
      expect(bundle.participantIntervals!.teacherConnectedSeconds).toBe(3300)
      expect(bundle.participantIntervals!.studentConnectedSecondsTotal).toBe(4800)
      expect(bundle.participantIntervals!.studentConnectedSecondsMean).toBe(2400)
      expect(bundle.participantIntervals!.studentsWithAnyConnection).toBe(2)
      expect(bundle.lessonPlan.title).toContain('Quadratic')

      const view = toEvidenceView(bundle)
      const json = JSON.stringify(view)
      expect(json).not.toContain('@bean.test') // no emails anywhere in the agent view
      expect(json).not.toContain('bean:pid') // no participant identities
      expect(view.teacherNotesAvailable).toBe(false)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('E2: whiteboard evidence is structural honesty — stroke count, no invented text', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', whiteboardStrokes: 12 })
    try {
      const bundle = await gatherEvidence(seeded.classId)
      expect(bundle.whiteboard.available).toBe(true)
      expect(bundle.whiteboard.strokeCount).toBe(12)
      expect(bundle.whiteboard.note).toContain('geometry only')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('E3: a class without a live session degrades honestly — null intervals, unavailable refs', async () => {
    const seeded = await seedTeacherAndClass({ bookings: ['ATTENDED'] })
    try {
      const bundle = await gatherEvidence(seeded.classId)
      expect(bundle.participantIntervals).toBeNull()
      expect(bundle.whiteboard.available).toBe(false)
      const refs = buildEvidenceRefs(bundle)
      const intervals = refs.find((r) => r.kind === CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS)
      expect(intervals?.available).toBe(false)
      expect(intervals?.summary).toContain('No live session existed')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('E4: evidence refs are complete and truthful for a fully-evidenced session', async () => {
    const seeded = await seedTeacherAndClass({
      liveStatus: 'ENDED',
      liveEnded: true,
      bookings: ['ATTENDED'],
      participants: [{ role: 'TEACHER', seconds: 3000, reconnects: 0 }],
      whiteboardStrokes: 5,
    })
    try {
      const bundle = await gatherEvidence(seeded.classId)
      bundle.teacherNotes = 'I focused on the geometric intuition of the discriminant today.'
      const refs = buildEvidenceRefs(bundle)
      expect(refs.map((r) => r.kind).sort()).toEqual([
        CI_EVIDENCE_KIND.ATTENDANCE_RECORD,
        CI_EVIDENCE_KIND.LESSON_PLAN,
        CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
        CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES,
        CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT,
      ].sort())
      expect(refs.every((r) => r.available)).toBe(true)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// ─── Queue (Q) ──────────────────────────────────────────────────────────────────

describe('CI evaluation queue (real DB)', () => {
  it('Q1: without consent no job row is created — consent gate is real', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true })
    try {
      const outcome = await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      expect(outcome).toEqual({ queued: false, reason: 'no_consent' })
      const job = await client.classroomEvaluationJob.findUnique({ where: { classSessionId: seeded.classId } })
      expect(job).toBeNull()
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q2: consented enqueue creates exactly one job; a second auto-trigger reuses it (duplicate prevention)', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true })
    try {
      await grantCiConsent(seeded.teacherId)
      const first = await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      expect(first.queued).toBe(true)
      const second = await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.PROVIDER_ROOM_FINISHED })
      expect(second.queued).toBe(true)
      if (second.queued) expect(second.alreadyQueued).toBe(true)
      const jobs = await client.classroomEvaluationJob.findMany({ where: { classSessionId: seeded.classId } })
      expect(jobs.length).toBe(1) // DB-unique guarantee
      expect(jobs[0].status).toBe(CI_JOB_STATUS.QUEUED)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q3: non-terminal live sessions are refused — evaluations never race a running room', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'LIVE' })
    try {
      await grantCiConsent(seeded.teacherId)
      const outcome = await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      expect(outcome).toEqual({ queued: false, reason: 'class_not_terminal' })
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q4: auto-triggers never re-run a COMPLETED evaluation; explicit teacher request creates a fresh run', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true })
    try {
      await grantCiConsent(seeded.teacherId)
      await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      const job = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      await client.classroomEvaluationJob.update({ where: { id: job.id }, data: { status: CI_JOB_STATUS.COMPLETED, stage: CI_STAGE.DONE } })

      const auto = await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.PROVIDER_ROOM_FINISHED })
      expect(auto).toEqual({ queued: false, reason: 'already_evaluated' })

      const requested = await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.TEACHER_REQUEST, requestedById: seeded.teacherId })
      expect(requested.queued).toBe(true)
      const refreshed = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      expect(refreshed.status).toBe(CI_JOB_STATUS.QUEUED)
      expect(refreshed.trigger).toBe(CI_TRIGGER.TEACHER_REQUEST)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q5: claim is CAS — exactly one claim wins; consent withdrawn after enqueue → SKIPPED at claim', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true })
    try {
      await grantCiConsent(seeded.teacherId)
      await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      const claimed = await claimNextCiJob()
      expect(claimed).not.toBeNull()
      expect(claimed!.classSessionId).toBe(seeded.classId)
      const row = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      expect(row.status).toBe(CI_JOB_STATUS.RUNNING)
      expect(row.attempts).toBe(1)
      expect(row.leaseUntil).not.toBeNull()
      // A second claim pass finds nothing runnable for this class.
      const again = await claimNextCiJob()
      const stillRunning = again?.classSessionId === seeded.classId
      expect(stillRunning).toBe(false)

      // Withdrawal stops future runs at claim time.
      await client.classroomEvaluationJob.update({ where: { id: row.id }, data: { status: CI_JOB_STATUS.QUEUED } })
      await withdrawCiConsent(seeded.teacherId)
      expect(await hasCiConsent(seeded.teacherId)).toBe(false)
      await claimNextCiJob()
      const skipped = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { id: row.id } })
      expect(skipped.status).toBe(CI_JOB_STATUS.SKIPPED)
      expect(skipped.error).toBe('consent_not_granted')
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q6: registered pipeline completes the job; a failing pipeline re-queues with bounded retries then FAILED — classroom rows untouched', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true, bookings: ['ATTENDED'] })
    try {
      await grantCiConsent(seeded.teacherId)
      await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      const claimed = (await claimNextCiJob())!

      let calls = 0
      registerCiEvaluationPipeline(async (ctx) => {
        calls += 1
        expect(ctx.classSessionId).toBe(seeded.classId)
        if (calls < 2) throw new Error('provider unavailable (simulated)')
      })
      await runCiJob(claimed)
      const afterFirst = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      expect(afterFirst.status).toBe(CI_JOB_STATUS.QUEUED) // re-queued for retry
      expect(afterFirst.error).toContain('provider unavailable')

      // Second attempt succeeds.
      const claimed2 = (await claimNextCiJob())!
      await runCiJob(claimed2)
      const done = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      expect(done.status).toBe(CI_JOB_STATUS.COMPLETED)
      expect(done.stage).toBe(CI_STAGE.DONE)
      expect(calls).toBe(2)

      // Classroom guarantee: nothing outside CI tables changed.
      const cls = await client.classSession.findUniqueOrThrow({ where: { id: seeded.classId } })
      expect(cls.status).toBe('PUBLISHED')
      const bookings = await client.classBooking.findMany({ where: { classSessionId: seeded.classId } })
      expect(bookings.every((b) => b.status === 'ATTENDED')).toBe(true)
      const live = await client.liveClassSession.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      expect(live.status).toBe('ENDED')
      // Evidence was actually gathered during the run and is inspectable.
      expect(lastGatheredEvidence()?.classSessionId).toBe(seeded.classId)
    } finally {
      registerCiEvaluationPipeline(null as never)
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q7: unregistered pipeline → honest FAILED with a clear error; lease recovery re-queues expired runs; exhausted retries FAIL', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true })
    try {
      await grantCiConsent(seeded.teacherId)
      // Q7a: no pipeline registered → honest failure, no retry loop possible.
      await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.SESSION_END })
      const claimed = (await claimNextCiJob())!
      const jobBefore = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      // Force exhaustion so the unregistered-pipeline failure is terminal.
      await client.classroomEvaluationJob.update({ where: { id: jobBefore.id }, data: { attempts: jobBefore.maxAttempts } })
      await runCiJob(claimed)
      const failed = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      expect(failed.status).toBe(CI_JOB_STATUS.FAILED)
      expect(failed.error).toContain('pipeline is not registered')

      // Q7b: lease recovery re-queues an expired RUNNING job under the retry cap.
      await enqueueEvaluation({ classSessionId: seeded.classId, trigger: CI_TRIGGER.TEACHER_REQUEST, requestedById: seeded.teacherId })
      const job2 = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: seeded.classId } })
      await client.classroomEvaluationJob.update({
        where: { id: job2.id },
        data: { status: CI_JOB_STATUS.RUNNING, leaseUntil: new Date(Date.now() - 1000), attempts: 1 },
      })
      const recovered = await recoverExpiredCiLeases()
      expect(recovered).toBe(1)
      const requeued = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { id: job2.id } })
      expect(requeued.status).toBe(CI_JOB_STATUS.QUEUED)
      expect(requeued.error).toContain('lease expired')

      // Q7c: an expired lease past maxAttempts FAILS honestly.
      await client.classroomEvaluationJob.update({
        where: { id: job2.id },
        data: { status: CI_JOB_STATUS.RUNNING, leaseUntil: new Date(Date.now() - 1000), attempts: job2.maxAttempts },
      })
      await recoverExpiredCiLeases()
      const exhausted = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { id: job2.id } })
      expect(exhausted.status).toBe(CI_JOB_STATUS.FAILED)
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })

  it('Q8: consent state lifecycle is honest — never-granted, granted, withdrawn', async () => {
    const seeded = await seedTeacherAndClass({ liveStatus: 'ENDED', liveEnded: true })
    try {
      expect(await getCiConsentState(seeded.teacherId)).toEqual({ granted: false, grantedAt: null, withdrawnAt: null })
      const granted = await grantCiConsent(seeded.teacherId)
      expect(granted.granted).toBe(true)
      expect(granted.grantedAt).not.toBeNull()
      const grantedAgain = await grantCiConsent(seeded.teacherId) // idempotent
      const records = await client.consentRecord.findMany({ where: { studentId: seeded.teacherId, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER' } })
      expect(records.length).toBe(1)
      expect(grantedAgain.granted).toBe(true)
      const withdrawn = await withdrawCiConsent(seeded.teacherId)
      expect(withdrawn.granted).toBe(false)
      expect(withdrawn.withdrawnAt).not.toBeNull()
    } finally {
      await cleanupTeacher(seeded.teacherId)
    }
  })
})

// Keep the imports referenced for lint clarity.
void CI_AGENT
void CI_EVIDENCE_KIND
