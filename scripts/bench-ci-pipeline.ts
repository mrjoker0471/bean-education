// ─── Classroom Intelligence pipeline benchmark (operator tool) ───────────────
// Runs ONE real end-to-end evaluation on an isolated throwaway database and
// reports measured wall-clock time, memory usage and produced rows. Uses the
// real model adapter — if the provider is unavailable, the script reports the
// honest failure instead of pretending.
//
// Usage: DATABASE_URL is ignored (isolated DB is created); run:
//   bun scripts/bench-ci-pipeline.ts
// Optionally set CI_BENCH_NOTES=1 to include teacher lesson notes.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci-bench-'))
const isolatedUrl = `file:${join(dir, 'bench.db')}`

// CRITICAL: bind the app's db singleton to the isolated database BEFORE any
// module that imports '@/lib/db' is evaluated (the environment may carry an
// unrelated DATABASE_URL — the isolated URL wins because explicit assignment
// overrides the process environment).
process.env.DATABASE_URL = isolatedUrl

execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
// Import the pipeline for its side effect: it registers the real multi-agent
// evaluation into the queue (the queue alone runs without it, honestly).
const ciQueue = await import('@/lib/ci/queue')
await import('@/lib/ci/pipeline')

const HOUR = 3600_000

async function main(): Promise<void> {
  // Seed one teacher with consent, one ended class with bookings and notes.
  const teacher = await client.student.create({
    data: {
      id: 'bench-teacher',
      email: 'bench-teacher@bean.test',
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: {
        create: {
          teachingName: 'Bench Teacher',
          headline: 'Benchmark teacher',
          bio: 'b',
          subjectsJson: '["Mathematics"]',
          levelsJson: '["SCHOOL_9_10"]',
          languagesJson: '["English"]',
          qualificationsText: 'q',
          experienceYears: 5,
          verificationStatus: 'APPROVED',
          isPublished: true,
        },
      },
    },
  })
  await client.consentRecord.create({
    data: { studentId: teacher.id, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true },
  })
  const cls = await client.classSession.create({
    data: {
      teacherProfileId: (await client.teacherProfile.findUniqueOrThrow({ where: { studentId: teacher.id } })).id,
      title: 'Quadratic equations — intuition first',
      description: 'Build the intuition behind quadratics, then solve by factorisation and the quadratic formula, ending with two worked examples.',
      subject: 'Mathematics',
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
          roomName: 'bean-live-bench',
          status: 'ENDED',
          startedById: teacher.id,
          startedAt: new Date(Date.now() - 2 * HOUR),
          endedAt: new Date(Date.now() - HOUR),
          actualParticipantMinutes: 132,
          usageMonthKey: new Date().toISOString().slice(0, 7),
        },
      },
    },
  })
  for (let i = 0; i < 3; i++) {
    const s = await client.student.create({ data: { id: `bench-s${i}`, email: `bench-s${i}@bean.test`, ageBand: 'ADULT_18_PLUS' } })
    await client.classBooking.create({ data: { classSessionId: cls.id, studentId: s.id, status: i === 2 ? 'NO_SHOW' : 'ATTENDED' } })
  }
  const live = await client.liveClassSession.findUniqueOrThrow({ where: { classSessionId: cls.id } })
  for (const [role, seconds] of [['TEACHER', 3400], ['STUDENT', 3100], ['STUDENT', 2800]] as const) {
    await client.liveClassParticipant.create({
      data: {
        liveClassSessionId: live.id,
        studentId: role === 'TEACHER' ? teacher.id : (await client.student.findFirstOrThrow({ where: { email: role === 'STUDENT' ? 'bench-s0@bean.test' : 'bench-s1@bean.test' } })).id,
        participantIdentity: `bean:bench-${role}-${Math.random().toString(36).slice(2, 8)}`,
        participantRole: role,
        totalConnectedSeconds: seconds,
        reconnectCount: 1,
      },
    })
  }

  const memBefore = process.memoryUsage.rss()
  const t0 = Date.now()

  const outcome = await ciQueue.enqueueEvaluation({
    classSessionId: cls.id,
    trigger: 'SESSION_END',
    teacherNotes:
      'Started with the geometric intuition of the discriminant, worked two factorisation examples, derived the formula by completing the square; two students asked about repeated roots.',
  })
  if (!outcome.queued) {
    console.log('BENCH: enqueue refused:', outcome)
    return
  }
  const claimed = await ciQueue.claimNextCiJob()
  if (!claimed) throw new Error('bench: claim failed')
  await ciQueue.runCiJob(claimed)

  const elapsedMs = Date.now() - t0
  const memPeak = process.memoryUsage.rss()

  const job = await client.classroomEvaluationJob.findUniqueOrThrow({ where: { classSessionId: cls.id } })
  const reports = await client.classroomEvaluationReport.findMany({ where: { classSessionId: cls.id } })
  const evidence = await client.classroomEvidenceRef.count({ where: { reportId: reports[0]?.id } })
  const summaries = await client.classroomStudentSummary.count({ where: { classSessionId: cls.id } })
  const runs = await client.classroomAgentRun.findMany({ where: { jobId: job.id } })

  console.log('=== BEAN Classroom Intelligence pipeline benchmark ===')
  console.log(`job status        : ${job.status} (attempts=${job.attempts})${job.error ? ` error=${job.error.slice(0, 160)}` : ''}`)
  console.log(`wall-clock        : ${elapsedMs} ms`)
  console.log(`RSS before/after  : ${(memBefore / 1e6).toFixed(1)} MB → ${(memPeak / 1e6).toFixed(1)} MB`)
  console.log(`agent runs        : ${runs.map((r) => `${r.agent}:${r.status}${r.durationMs ? `@${r.durationMs}ms` : ''}`).join(', ')}`)
  console.log(`reports           : ${reports.length} (version ${reports[0]?.version}, insufficientEvidence=${reports[0]?.insufficientEvidence}, requiresHumanReview=${reports[0]?.requiresHumanReview})`)
  console.log(`evidence refs     : ${evidence}`)
  console.log(`student summaries : ${summaries}`)

  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
}

void main()
