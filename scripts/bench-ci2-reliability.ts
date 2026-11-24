// ─── CI-2F: measured load benchmark (operator tool) ──────────────────────────
// Runs the REAL queue + pipeline over progressively larger synthetic batches
// on an isolated throwaway database with a DETERMINISTIC stub adapter — this
// measures the QUEUE AND PIPELINE MECHANICS (enqueue, claims, retries,
// publishing) without provider latency. Live single-run provider numbers were
// measured in CI-1 (scripts/bench-ci-pipeline.ts); the two are not comparable
// and are reported separately.
//
// Measures per batch size: end-to-end latency, queue wait, throughput,
// worker memory (RSS), retry count, double-claim check.
//
// Usage: bun scripts/bench-ci2-reliability.ts

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const dir = mkdtempSync(join(tmpdir(), 'bean-ci2-load-'))
// connection_limit=1 matches the SQLite single-writer reality (ADR-011): writes serialize.
const isolatedUrl = `file:${join(dir, 'load.db')}?connection_limit=1&pool_timeout=60&socket_timeout=60`
process.env.DATABASE_URL = isolatedUrl

execFileSync('bun', ['x', 'prisma', 'migrate', 'deploy'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: isolatedUrl },
  stdio: 'pipe',
  timeout: 180_000,
})

const client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } })
const ciQueue = await import('@/lib/ci/queue')
await import('@/lib/ci/pipeline')

const HOUR = 3600_000

async function seedBatch(n: number): Promise<{ teacherId: string; classIds: string[] }> {
  const teacher = await client.student.create({
    data: {
      id: `load-t-${Math.random().toString(36).slice(2, 8)}`,
      email: `load-t-${Math.random().toString(36).slice(2, 8)}@bean.test`,
      ageBand: 'ADULT_18_PLUS',
      onboardedAt: new Date(),
      teacherProfile: { create: { teachingName: 'Load Teacher', headline: 'h', bio: 'b', subjectsJson: '["Mathematics"]', levelsJson: '["SCHOOL_9_10"]', languagesJson: '["English"]', qualificationsText: 'q', experienceYears: 3, verificationStatus: 'APPROVED', isPublished: true } },
    },
  })
  await client.consentRecord.create({ data: { studentId: teacher.id, purpose: 'CLASSROOM_INTELLIGENCE_TEACHER', granted: true } })
  const profile = await client.teacherProfile.findUniqueOrThrow({ where: { studentId: teacher.id } })
  const classIds: string[] = []
  for (let i = 0; i < n; i++) {
    const cls = await client.classSession.create({
      data: {
        teacherProfileId: profile.id,
        title: `Load class ${i + 1}/${n}`,
        description: `Synthetic load fixture class ${i + 1}: quadratics with worked examples and sign-error discussion.`,
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
            roomName: `bean-live-load-${Math.random().toString(36).slice(2, 12)}`,
            status: 'ENDED',
            endReason: 'TEACHER_ENDED',
            startedById: teacher.id,
            startedAt: new Date(Date.now() - (2 + i) * HOUR),
            endedAt: new Date(Date.now() - (1 + i) * HOUR),
            actualParticipantMinutes: 100,
            usageMonthKey: new Date().toISOString().slice(0, 7),
          },
        },
      },
    })
    for (let b = 0; b < 2; b++) {
      const s = await client.student.create({ data: { id: `load-s-${Math.random().toString(36).slice(2, 12)}`, email: `load-s-${Math.random().toString(36).slice(2, 12)}@bean.test`, ageBand: 'ADULT_18_PLUS' } })
      await client.classBooking.create({ data: { classSessionId: cls.id, studentId: s.id, status: 'ATTENDED' } })
    }
    classIds.push(cls.id)
  }
  return { teacherId: teacher.id, classIds }
}

async function runBatch(batchSize: number, claimConcurrency: number): Promise<void> {
  const seeded = await seedBatch(batchSize)
  const memBefore = process.memoryUsage.rss()

  // Phase 1: concurrent duplicate-trigger enqueues (2 triggers per class)
  const t0 = Date.now()
  await Promise.all(
    seeded.classIds.flatMap((classSessionId) => [
      ciQueue.enqueueEvaluation({ classSessionId, trigger: 'SESSION_END' }),
      ciQueue.enqueueEvaluation({ classSessionId, trigger: 'PROVIDER_ROOM_FINISHED' }),
    ]),
  )
  const enqueueMs = Date.now() - t0

  // Phase 2: workers claim concurrently (bounded CAS), run sequentially per worker
  const t1 = Date.now()
  let retries = 0
  let claimedTotal = 0
  const claimedIds = new Set<string>()
  let remaining = batchSize
  while (remaining > 0) {
    const claims = await Promise.all(Array.from({ length: claimConcurrency }, () => ciQueue.claimNextCiJob()))
    const won = claims.filter((c): c is NonNullable<typeof c> => c !== null)
    claimedTotal += won.length
    for (const c of won) {
      if (claimedIds.has(c.id)) throw new Error(`DOUBLE CLAIM detected for job ${c.id}`)
      claimedIds.add(c.id)
    }
    if (won.length === 0) break
    await Promise.all(won.map((c) => ciQueue.runCiJob(c)))
    remaining -= won.length
    retries += won.filter((c) => (c as unknown as { attempts: number }).attempts > 1).length
  }
  const drainMs = Date.now() - t1

  const memAfter = process.memoryUsage.rss()
  const jobs = await client.classroomEvaluationJob.findMany()
  const completed = jobs.filter((j) => j.status === 'COMPLETED').length
  const reports = await client.classroomEvaluationReport.findMany()
  const distinctReportClasses = new Set(reports.map((r) => r.classSessionId)).size
  const summaries = await client.classroomStudentSummary.count()

  console.log(
    `batch=${batchSize} classes × concurrency=${claimConcurrency}: ` +
      `enqueue(dup-triggers)=${enqueueMs}ms, drain=${drainMs}ms ` +
      `(${(batchSize / (drainMs / 1000)).toFixed(1)} eval/s), completed=${completed}/${batchSize}, ` +
      `doubleClaims=0, retries=${retries}, reports=${reports.length} (${distinctReportClasses} classes), summaries=${summaries}, ` +
      `RSS ${(memBefore / 1e6).toFixed(0)}→${(memAfter / 1e6).toFixed(0)} MB`,
  )

  await client.student.deleteMany({ where: { id: seeded.teacherId } }) // cascade cleanup
}

async function main(): Promise<void> {
  const adapter = {
    id: 'stub-load',
    async complete(opts: { system: string; user: string }) {
      const judge = opts.system.includes('Teacher Judge Agent')
      return judge
        ? JSON.stringify({
            findings: [{ id: 1, category: 'LESSON_STRUCTURE', observation: 'The lesson plan and notes support structured delivery of quadratics with worked examples.', evidenceKinds: ['LESSON_PLAN'], evidenceBasis: 'available', confidence: 'medium', suggestedImprovement: 'Plan hook, guided practice, independent practice.' }],
            categoriesNotEvaluable: [],
            objectivesCovered: [],
            objectivesUnverifiable: [],
            insufficientEvidence: false,
          })
        : JSON.stringify({
            lessonSummary: 'The synthetic load class ran with seeded aggregate evidence; the summary stays within what the evidence shows for the session.',
            objectivesCovered: ['solving quadratic equations'],
            conceptsRequiringRevision: [],
            explanationObservations: [],
            suggestedPractice: ['Practise factoring quadratics with short drills'],
            insufficientEvidence: false,
          })
    },
  }
  const { setCiModelAdapterForProcess, resetCiModelAdapterForTests } = await import('@/lib/ci/model-adapter')
  setCiModelAdapterForProcess(adapter)

  console.log('=== CI-2F measured load benchmark (stub adapter — queue/pipeline mechanics only) ===')
  for (const [batch, concurrency] of [[4, 1], [8, 2], [16, 4], [32, 8]] as const) {
    await runBatch(batch, concurrency)
  }
  console.log('NOTE: with the real provider, throughput is dominated by model latency (~15-40 s/evaluation, see CI-1 bench); the queue adds only the drain overhead measured here.')
  resetCiModelAdapterForTests()
  await client.$disconnect()
  rmSync(dir, { recursive: true, force: true })
}

void main().catch(async (err) => {
  console.error('load benchmark failed:', err)
  await client.$disconnect()
  process.exit(1)
})
