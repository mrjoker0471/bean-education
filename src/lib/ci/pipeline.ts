// ─── BEAN Classroom Intelligence (CI-1C): multi-agent evaluation pipeline ────
// The real pipeline registered into the CI-1B queue. Stage flow for one job:
//
//   EVIDENCE → gather authorised bundle (+ teacher notes from the job row)
//   LEARNER  → BEAN Learner Agent (model call, schema-validated)
//   JUDGE    → BEAN Teacher Judge Agent (model call, schema-validated)
//   ORCHESTRATE → pure orchestrator builds the final report + student summary
//   PUBLISH  → one transaction: next report VERSION (previous rows superseded),
//              evidence register rows, student summaries for ATTENDED bookings,
//              orchestrator audit run
//
// Failure honesty:
//   • every agent stage writes an append-only ClassroomAgentRun row
//     (COMPLETED with output, or FAILED with the honest error);
//   • a model-provider failure throws → the queue re-queues (bounded retries)
//     → terminal FAILED leaves the classroom completely untouched;
//   • no agent output is persisted until the schema accepts it.

import { db } from '@/lib/db'
import { createHash } from 'node:crypto'
import { CI_AGENT, CI_STAGE } from './constants'
import { getCiModelAdapter, completeJson } from './model-adapter'
import { gatherEvidence, toEvidenceView, buildEvidenceRefs } from './evidence'
import { evidenceDigest } from './evidence'
import { runLearnerAgent } from './agents/learner'
import { runTeacherJudgeAgent } from './agents/judge'
import { buildFinalReport, buildStudentSummary } from './agents/orchestrator'
import { parseFinalReport, parseStudentSummary, type LearnerOutput, type JudgeOutput } from './schemas'
import { registerCiEvaluationPipeline, recordAgentRun, type EvaluationPipelineContext } from './queue'

function digestOf(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}

/** The multi-agent evaluation for one job. Throws on failure (queue retries). */
async function evaluateClass(ctx: EvaluationPipelineContext): Promise<void> {
  // ── Model adapter (absent adapter = honest failure, never an empty result)
  const adapter = getCiModelAdapter()
  if (!adapter) throw new Error('No classroom-intelligence model adapter is available in this deployment.')

  // ── Stage: EVIDENCE (the queue already gathered a bundle for observability;
  // the pipeline re-gathers atomically for its own transaction consistency).
  await db.classroomEvaluationJob.updateMany({
    where: { id: ctx.jobId, status: 'RUNNING' },
    data: { stage: CI_STAGE.EVIDENCE },
  })
  const bundle = await gatherEvidence(ctx.classSessionId)
  bundle.teacherNotes = ctx.teacherNotes
  const view = toEvidenceView(bundle)
  const evidenceRefs = buildEvidenceRefs(bundle)
  const digest = evidenceDigest(view, ctx.teacherNotes)

  // ── Stage: LEARNER
  await db.classroomEvaluationJob.updateMany({
    where: { id: ctx.jobId, status: 'RUNNING' },
    data: { stage: CI_STAGE.LEARNER },
  })
  const startedLearner = new Date()
  let learner: LearnerOutput | null = null
  let learnerError: string | null = null
  try {
    const result = await runLearnerAgent(adapter, view, ctx.teacherNotes)
    learner = result.output
    await db.$transaction((tx) =>
      recordAgentRun(tx, {
        jobId: ctx.jobId,
        agent: CI_AGENT.LEARNER,
        attempt: ctx.attempt,
        modelId: adapter.id,
        inputDigest: digest,
        outputJson: JSON.stringify(learner),
        error: null,
        startedAt: startedLearner,
      }),
    )
  } catch (err) {
    learnerError = err instanceof Error ? err.message : String(err)
    const learnerMsg = learnerError // narrowed for the closure below
    await db.$transaction((tx) =>
      recordAgentRun(tx, {
        jobId: ctx.jobId,
        agent: CI_AGENT.LEARNER,
        attempt: ctx.attempt,
        modelId: adapter.id,
        inputDigest: digest,
        outputJson: null,
        error: learnerMsg.slice(0, 500),
        startedAt: startedLearner,
      }),
    )
    throw new Error(`Learner Agent failed: ${learnerMsg}`)
  }

  // ── Stage: TEACHER_JUDGE
  await db.classroomEvaluationJob.updateMany({
    where: { id: ctx.jobId, status: 'RUNNING' },
    data: { stage: CI_STAGE.TEACHER_JUDGE },
  })
  const startedJudge = new Date()
  let judge: JudgeOutput | null = null
  let judgeError: string | null = null
  try {
    const result = await runTeacherJudgeAgent(adapter, view, ctx.teacherNotes)
    judge = result.output
    await db.$transaction((tx) =>
      recordAgentRun(tx, {
        jobId: ctx.jobId,
        agent: CI_AGENT.TEACHER_JUDGE,
        attempt: ctx.attempt,
        modelId: adapter.id,
        inputDigest: digest,
        outputJson: JSON.stringify(judge),
        error: null,
        startedAt: startedJudge,
      }),
    )
  } catch (err) {
    judgeError = err instanceof Error ? err.message : String(err)
    const judgeMsg = judgeError // narrowed for the closure below
    await db.$transaction((tx) =>
      recordAgentRun(tx, {
        jobId: ctx.jobId,
        agent: CI_AGENT.TEACHER_JUDGE,
        attempt: ctx.attempt,
        modelId: adapter.id,
        inputDigest: digest,
        outputJson: null,
        error: judgeMsg.slice(0, 500),
        startedAt: startedJudge,
      }),
    )
    throw new Error(`Teacher Judge Agent failed: ${judgeMsg}`)
  }

  // ── Stage: ORCHESTRATE (pure — no model call)
  await db.classroomEvaluationJob.updateMany({
    where: { id: ctx.jobId, status: 'RUNNING' },
    data: { stage: CI_STAGE.ORCHESTRATE },
  })
  const finalReport = parseFinalReport(
    buildFinalReport({ view, evidenceRefs, learner, judge }, new Date()),
  )
  const studentSummary = parseStudentSummary(buildStudentSummary({ learner, judge }, ctx.classSessionId))

  // ── Stage: PUBLISH (single transaction; report versioning + evidence + summaries)
  await db.classroomEvaluationJob.updateMany({
    where: { id: ctx.jobId, status: 'RUNNING' },
    data: { stage: CI_STAGE.PUBLISH },
  })
  await db.$transaction(async (tx) => {
    const job = await tx.classroomEvaluationJob.findUniqueOrThrow({
      where: { id: ctx.jobId },
      select: { teacherProfileId: true, classSessionId: true },
    })
    const previous = await tx.classroomEvaluationReport.findMany({
      where: { classSessionId: job.classSessionId },
      select: { version: true, id: true },
    })
    const nextVersion = previous.reduce((m, r) => Math.max(m, r.version), 0) + 1
    const now = new Date()

    const report = await tx.classroomEvaluationReport.create({
      data: {
        jobId: ctx.jobId,
        classSessionId: job.classSessionId,
        teacherProfileId: job.teacherProfileId,
        version: nextVersion,
        status: 'CURRENT',
        reportJson: JSON.stringify(finalReport),
        insufficientEvidence: finalReport.insufficientEvidence,
        requiresHumanReview: finalReport.requiresHumanReview,
        modelId: adapter.id,
      },
    })

    for (const ref of evidenceRefs) {
      await tx.classroomEvidenceRef.create({
        data: { reportId: report.id, kind: ref.kind, refId: ref.refId, summary: ref.summary, available: ref.available },
      })
    }

    // Student summaries: class-level content for ATTENDED bookings only.
    // Regeneration semantics: the latest evaluation owns the class's summaries.
    const attended = await tx.classBooking.findMany({
      where: { classSessionId: job.classSessionId, status: 'ATTENDED' },
      select: { id: true },
    })
    const summaryJson = JSON.stringify(studentSummary)
    for (const b of attended) {
      await tx.classroomStudentSummary.upsert({
        where: { bookingId: b.id },
        update: { jobId: ctx.jobId, summaryJson, modelId: adapter.id, createdAt: now },
        create: { jobId: ctx.jobId, bookingId: b.id, classSessionId: job.classSessionId, summaryJson, modelId: adapter.id },
      })
    }

    // Supersede older CURRENT reports of this class (history preserved).
    await tx.classroomEvaluationReport.updateMany({
      where: { classSessionId: job.classSessionId, status: 'CURRENT', id: { not: report.id } },
      data: { status: 'SUPERSEDED', supersededAt: now },
    })

    // Orchestrator audit row (pure step; modelId null by design).
    await recordAgentRun(tx, {
      jobId: ctx.jobId,
      agent: CI_AGENT.ORCHESTRATOR,
      attempt: ctx.attempt,
      modelId: null,
      inputDigest: digestOf(JSON.stringify({ learnerDigest: digest, judge: 'see-run-above' })),
      outputJson: JSON.stringify(finalReport).slice(0, 100_000),
      error: null,
      startedAt: now,
    })
  })

  await db.classroomEvaluationJob.updateMany({
    where: { id: ctx.jobId, status: 'RUNNING' },
    data: { stage: CI_STAGE.DONE },
  })
}

// ─── Registration (side effect of importing this module) ─────────────────────
// Imported for its side effect by src/lib/ci/trigger.ts, so every route that
// touches the classroom lifecycle has the real pipeline registered. The
// worker itself is started by enqueueEvaluation() — this module never
// reaches back into trigger (no circular import).

registerCiEvaluationPipeline(evaluateClass)

// Re-exports for tests and API modules.
export { evaluateClass, completeJson }
