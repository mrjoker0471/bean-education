// ─── BEAN Classroom Intelligence (CI-1C): agent output schemas ───────────────
// Zod contracts every agent output MUST satisfy before anything is persisted.
// The schemas encode the honesty rules structurally — a model cannot publish
// a finding without naming the evidence kinds it used, cannot attach
// timestamps (none exist in CI-1's observation channels), cannot emit
// engagement scores for individuals, and cannot invent categories.
//
// Finding identity: each finding carries a stable agent-assigned `id`
// (1..n within the agent output) so teacher disputes can reference findings
// precisely and the orchestrator can rebuild corrected reports deterministically.

import { z } from 'zod'
import { CI_EVIDENCE_KIND } from './constants'

const EVIDENCE_KIND_SET = new Set<string>(Object.values(CI_EVIDENCE_KIND))

/**
 * Honest synonym remap for the evidence-kind labels: near-miss names that
 * clearly denote one of the authorised kinds are mapped onto it. Values that
 * denote nothing authorised are dropped (the schema then retries strictly).
 */
const EVIDENCE_KIND_SYNONYMS: Record<string, string> = {
  TEACHER_NOTES: 'TEACHER_LESSON_NOTES',
  LESSON_NOTES: 'TEACHER_LESSON_NOTES',
  NOTES: 'TEACHER_LESSON_NOTES',
  WHITEBOARD: 'WHITEBOARD_SNAPSHOT',
  BOARD: 'WHITEBOARD_SNAPSHOT',
  PLAN: 'LESSON_PLAN',
  CLASS_PLAN: 'LESSON_PLAN',
  ATTENDANCE: 'ATTENDANCE_RECORD',
  ATTENDANCE_RECORDS: 'ATTENDANCE_RECORD',
  CONNECTION_INTERVALS: 'PARTICIPANT_INTERVALS',
  PARTICIPANT: 'PARTICIPANT_INTERVALS',
  CONNECTION: 'PARTICIPANT_INTERVALS',
  INTERVALS: 'PARTICIPANT_INTERVALS',
  LIVE_SESSION: 'PARTICIPANT_INTERVALS',
  // The fence's combined source label denotes the whole bundled view; the
  // lesson plan is its documented anchor.
  LESSON_PLAN_AND_CLASSROOM_EVIDENCE: 'LESSON_PLAN',
  LESSON_PLAN_AND_EVIDENCE: 'LESSON_PLAN',
  CLASSROOM_EVIDENCE: 'LESSON_PLAN',
}

/**
 * Tolerate model formatting drift on enum-ish fields WITHOUT tolerating
 * invented values: strings are trimmed, uppercased and underscore-normalised;
 * evidence kinds that are still not in the authorised set are dropped (a
 * finding left with none fails the schema and triggers the strict retry).
 */
export function normaliseStructuredOutput<T>(value: T): T {
  const fix = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(fix)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'evidenceKinds' && Array.isArray(v)) {
          const fixed = v
            .map((item) => {
              if (typeof item !== 'string') return ''
              const normalised = item.trim().toUpperCase().replace(/\s|-+/g, '_')
              return EVIDENCE_KIND_SET.has(normalised) ? normalised : (EVIDENCE_KIND_SYNONYMS[normalised] ?? '')
            })
            .filter((item) => EVIDENCE_KIND_SET.has(item))
          out[k] = [...new Set(fixed)]
        } else if ((k === 'category' || k === 'kind') && typeof v === 'string') {
          out[k] = v.trim().toUpperCase().replace(/\s|-+/g, '_')
        } else {
          out[k] = fix(v)
        }
      }
      return out
    }
    return node
  }
  return fix(value) as T
}

/** Evidence kinds an agent may cite — exactly the authorised set. */
const evidenceKindEnum = z.enum([
  CI_EVIDENCE_KIND.LESSON_PLAN,
  CI_EVIDENCE_KIND.ATTENDANCE_RECORD,
  CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
  CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT,
  CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES,
])
export type EvidenceKind = z.infer<typeof evidenceKindEnum>

/** Base finding: observation + the evidence it rests on + confidence. */
const findingBase = {
  id: z.number().int().positive(),
  observation: z.string().min(10).max(1000),
  evidenceKinds: z.array(evidenceKindEnum).min(1).max(5),
  /** available | partially_available | unavailable — the agent's own honesty assessment. */
  evidenceBasis: z.enum(['available', 'partially_available', 'unavailable']),
  confidence: z.enum(['low', 'medium', 'high']),
}

export const learnerFindingSchema = z.object({
  ...findingBase,
  kind: z.enum([
    'EXPLANATION_CLARITY',
    'OBJECTIVE_COVERAGE',
    'CONCEPT_GAP',
    'EXAMPLES_PROVIDED',
    'PACING',
    'PRACTICE_OPPORTUNITY',
    'LEARNING_STRUCTURE',
    'MATERIALS_QUALITY',
  ]),
  suggestedPractice: z.string().max(600).optional(),
})
export type LearnerFinding = z.infer<typeof learnerFindingSchema>

export const judgeFindingSchema = z.object({
  ...findingBase,
  category: z.enum([
    'SUBJECT_ACCURACY',
    'EXPLANATION_CLARITY',
    'LESSON_STRUCTURE',
    'SYLLABUS_COVERAGE',
    'TEACHING_PACE',
    'USE_OF_EXAMPLES',
    'STUDENT_INTERACTION',
    'QUESTION_HANDLING',
    'TIME_MANAGEMENT',
    'LEARNING_RESOURCE_QUALITY',
  ]),
  suggestedImprovement: z.string().max(600).optional(),
})
export type JudgeFinding = z.infer<typeof judgeFindingSchema>

/** BEAN Learner Agent output — the learning experience, student perspective. */
export const learnerOutputSchema = z.object({
  lessonSummary: z.string().min(30).max(2000),
  objectivesCovered: z.array(z.string().min(3).max(200)).max(20),
  conceptsRequiringRevision: z.array(z.string().min(3).max(200)).max(20),
  explanationObservations: z.array(learnerFindingSchema).max(12),
  suggestedPractice: z.array(z.string().min(10).max(400)).max(10),
  /** Explicit honesty marker: the agent must set true when evidence is thin. */
  insufficientEvidence: z.boolean(),
  notes: z.string().max(1000).optional(),
})
export type LearnerOutput = z.infer<typeof learnerOutputSchema>

/** BEAN Teacher Judge Agent output — teaching quality by category. */
export const judgeOutputSchema = z.object({
  findings: z.array(judgeFindingSchema).max(24),
  /** Categories deliberately marked not-evaluable from the given evidence. */
  categoriesNotEvaluable: z
    .array(
      z.object({
        category: judgeFindingSchema.shape.category,
        reason: z.string().min(10).max(300),
      }),
    )
    .max(10),
  /** Objectives from the advertised lesson plan the evidence shows were covered. */
  objectivesCovered: z.array(z.string().min(3).max(200)).max(20),
  /** Objectives the evidence cannot confirm (never invented as "missed"). */
  objectivesUnverifiable: z.array(z.string().min(3).max(200)).max(20),
  insufficientEvidence: z.boolean(),
  notes: z.string().max(1000).optional(),
})
export type JudgeOutput = z.infer<typeof judgeOutputSchema>

// ─── Final report (orchestrator) ──────────────────────────────────────────────

export const reportFindingSchema = z.object({
  findingId: z.string().min(3).max(40), // "learner-3" | "judge-7"
  source: z.enum(['LEARNER', 'TEACHER_JUDGE']),
  category: z.string().min(3).max(60),
  observation: z.string().min(10).max(1000),
  evidenceKinds: z.array(evidenceKindEnum).min(1).max(5),
  evidenceBasis: z.enum(['available', 'partially_available', 'unavailable']),
  confidence: z.enum(['low', 'medium', 'high']),
  suggestion: z.string().max(600).optional(),
  /** Set by the orchestrator when a finding rests on unavailable evidence. */
  flaggedForReview: z.boolean().default(false),
  flagReason: z.string().max(300).optional(),
})
export type ReportFinding = z.infer<typeof reportFindingSchema>

export const reportCategoryStatusSchema = z.object({
  category: judgeFindingSchema.shape.category,
  status: z.enum(['EVALUATED', 'INSUFFICIENT_EVIDENCE']),
  summary: z.string().min(3).max(600),
})
export type ReportCategoryStatus = z.infer<typeof reportCategoryStatusSchema>

export const finalReportSchema = z.object({
  generatedAtIso: z.string(),
  lessonSummary: z.string().min(30).max(2000),
  /** What the teacher can rely on right now (high/medium confidence, available evidence). */
  strengths: z.array(reportFindingSchema).max(12),
  /** Where the teaching or learning experience can improve. */
  improvements: z.array(reportFindingSchema).max(12),
  /** ALL other findings kept for transparency (low confidence, flagged, etc.). */
  otherFindings: z.array(reportFindingSchema).max(24),
  categories: z.array(reportCategoryStatusSchema).length(10),
  objectivesCovered: z.array(z.string().min(3).max(200)).max(20),
  objectivesUnverifiable: z.array(z.string().min(3).max(200)).max(20),
  conceptsRequiringRevision: z.array(z.string().min(3).max(200)).max(20),
  suggestedPractice: z.array(z.string().min(10).max(400)).max(10),
  /** Orchestrator-verified evidence register (mirrors ClassroomEvidenceRef rows). */
  evidenceRegister: z
    .array(
      z.object({
        kind: evidenceKindEnum,
        available: z.boolean(),
        summary: z.string().min(3).max(400),
      }),
    )
    .max(10),
  conflicts: z
    .array(
      z.object({
        description: z.string().min(10).max(600),
        /** Finding rows involved. Structural conflicts (e.g. objective-coverage
         *  disagreements between the agents' top-level lists) may have none. */
        findingIds: z.array(z.string().min(3).max(40)).max(4),
      }),
    )
    .max(6),
  insufficientEvidence: z.boolean(),
  requiresHumanReview: z.boolean(),
  orchestratorNotes: z.string().max(1000).optional(),
})
export type FinalReport = z.infer<typeof finalReportSchema>

/** Class-level learning summary — identical content for every attendee. */
export const studentSummarySchema = z.object({
  classId: z.string().min(1),
  lessonSummary: z.string().min(30).max(2000),
  conceptsCovered: z.array(z.string().min(3).max(200)).max(20),
  revisionRecommendations: z.array(z.string().min(10).max(400)).max(10),
  suggestedPractice: z.array(z.string().min(10).max(400)).max(10),
  /** Honest scope statement shown to students (class-level, not personal). */
  scopeNote: z.literal(
    'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
  ),
})
export type StudentSummary = z.infer<typeof studentSummarySchema>

/** Parse-or-throw helper with a stable error contract for the pipeline. */
export function parseLearnerOutput(raw: unknown): LearnerOutput {
  return learnerOutputSchema.parse(raw)
}
export function parseJudgeOutput(raw: unknown): JudgeOutput {
  return judgeOutputSchema.parse(raw)
}
export function parseFinalReport(raw: unknown): FinalReport {
  return finalReportSchema.parse(raw)
}
export function parseStudentSummary(raw: unknown): StudentSummary {
  return studentSummarySchema.parse(raw)
}

// ─── Disputes (CI-1E) ───────────────────────────────────────────────────────

/** A teacher dispute against specific findings of one report version. */
export const ciDisputeSchema = z.object({
  findings: z
    .array(
      z.object({
        findingId: z.string().min(3).max(40),
        reason: z.string().min(20).max(1000),
      }),
    )
    .min(1)
    .max(10),
})
export type CiDisputeInput = z.infer<typeof ciDisputeSchema>

/** Admin human-review action on a dispute. */
export const ciDisputeActionSchema = z.object({
  action: z.enum(['ASSIGN', 'UNDER_REVIEW', 'RESOLVE', 'DISMISS']),
  /** Mandatory for RESOLVE — the human decision on the disputed findings. */
  resolution: z.enum(['UPHELD', 'CORRECTED', 'RETRACTED']).optional(),
  /** Mandatory for RESOLVE/DISMISS — documented grounds (append-only history). */
  note: z.string().min(10).max(1000).optional(),
})
export type CiDisputeActionInput = z.infer<typeof ciDisputeActionSchema>
