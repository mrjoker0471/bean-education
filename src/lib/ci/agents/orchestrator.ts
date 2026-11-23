// ─── BEAN Classroom Intelligence (CI-1C): BEAN Evaluation Orchestrator ──────
// Coordinates the specialist agents and produces the final class evaluation.
//
// This orchestrator is a PURE, DETERMINISTIC function — deliberately NOT a
// model call. Validation, conflict detection and report assembly must be
// reproducible and auditable; a dispute correction re-runs this exact function
// (with disputed findings excluded) and gets the same result with no new
// model output involved.
//
// Non-negotiable rules:
//   • It must NOT invent missing evidence to complete a report.
//   • If evidence is insufficient, the report says so explicitly
//     (insufficientEvidence=true) — it never fills the gap with prose.
//   • Findings resting on unavailable evidence are flagged for human review
//     and never presented as established facts.
//   • Human review is required whenever conflicts or advisory-only findings
//     exist — the report is advisory evidence, never an automatic decision.

import type { EvidenceView, EvidenceRefSpec } from '@/lib/ci/evidence'
import type { LearnerOutput, JudgeOutput, ReportFinding, FinalReport, StudentSummary, EvidenceKind } from '@/lib/ci/schemas'
import { CI_EVIDENCE_KIND } from '@/lib/ci/constants'

export interface OrchestrationInput {
  view: EvidenceView
  evidenceRefs: EvidenceRefSpec[]
  learner: LearnerOutput
  judge: JudgeOutput
  /** Finding ids excluded by an upheld dispute correction (rebuild path). */
  excludedFindingIds?: string[]
}

/** Judge categories with their display order (the mandated ten). */
const ALL_CATEGORIES = [
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
] as const

// ─── Stance lexicons (conservative, documented, unit-tested) ──────────────────

const NEGATIVE_PACE = /too fast|too slow|rushed|hurried|fell behind|lagged|dragged|left behind/i
const POSITIVE_PACE = /appropriate|well.?paced|well paced|balanced|steady|comfortable/i
const GAP_KINDS = new Set(['CONCEPT_GAP', 'PRACTICE_OPPORTUNITY'])

/** Deterministic finding id (stable across dispute-correction rebuilds). */
const lid = (n: number) => `learner-${n}`
const jid = (n: number) => `judge-${n}`

function availableKinds(refs: EvidenceRefSpec[]): Set<string> {
  return new Set(refs.filter((r) => r.available).map((r) => r.kind))
}

/** True when a finding cites only evidence kinds that are actually unavailable. */
function restsOnUnavailable(evidenceKinds: readonly string[], available: Set<string>): boolean {
  return evidenceKinds.length > 0 && evidenceKinds.every((k) => !available.has(k))
}

function toReportFinding(
  source: 'LEARNER' | 'TEACHER_JUDGE',
  findingId: string,
  category: string,
  f: {
    observation: string
    evidenceKinds: readonly EvidenceKind[]
    evidenceBasis: 'available' | 'partially_available' | 'unavailable'
    confidence: 'low' | 'medium' | 'high'
    suggestion?: string | undefined
  },
  available: Set<string>,
): ReportFinding {
  const flagged = f.evidenceBasis === 'unavailable' || restsOnUnavailable(f.evidenceKinds, available)
  return {
    findingId,
    source,
    category,
    observation: f.observation,
    evidenceKinds: [...f.evidenceKinds],
    evidenceBasis: f.evidenceBasis,
    confidence: f.confidence,
    suggestion: f.suggestion,
    flaggedForReview: flagged,
    flagReason: flagged ? 'Rests on evidence marked unavailable — advisory only, requires human review.' : undefined,
  }
}

/** Normalise an agent finding into the orchestrator's finding shape. */
function normaliseAgentFinding(
  f:
    | { observation: string; evidenceKinds: readonly EvidenceKind[]; evidenceBasis: 'available' | 'partially_available' | 'unavailable'; confidence: 'low' | 'medium' | 'high'; suggestedPractice?: string }
    | { observation: string; evidenceKinds: readonly EvidenceKind[]; evidenceBasis: 'available' | 'partially_available' | 'unavailable'; confidence: 'low' | 'medium' | 'high'; suggestedImprovement?: string },
): { observation: string; evidenceKinds: readonly EvidenceKind[]; evidenceBasis: 'available' | 'partially_available' | 'unavailable'; confidence: 'low' | 'medium' | 'high'; suggestion?: string } {
  const suggestion = 'suggestedPractice' in f ? f.suggestedPractice : 'suggestedImprovement' in f ? f.suggestedImprovement : undefined
  return { observation: f.observation, evidenceKinds: f.evidenceKinds, evidenceBasis: f.evidenceBasis, confidence: f.confidence, suggestion }
}

/** Detect pace-stance conflicts between the two agents (conservative lexicon). */
function paceConflict(learner: LearnerOutput, judge: JudgeOutput): FinalReport['conflicts'][number] | null {
  const l = learner.explanationObservations.filter((f) => f.kind === 'PACING')
  const j = judge.findings.filter((f) => f.category === 'TEACHING_PACE')
  for (const lf of l) {
    const lNeg = NEGATIVE_PACE.test(lf.observation)
    const lPos = POSITIVE_PACE.test(lf.observation)
    for (const jf of j) {
      const jNeg = NEGATIVE_PACE.test(jf.observation)
      const jPos = POSITIVE_PACE.test(jf.observation)
      if ((lNeg && jPos) || (lPos && jNeg)) {
        return {
          description: `The Learner Agent and the Teacher Judge Agent reached opposing pace observations. Learner: "${lf.observation.slice(0, 200)}" Judge: "${jf.observation.slice(0, 200)}" — a human reviewer should resolve which reading the evidence supports.`,
          findingIds: [lid(lf.id), jid(jf.id)],
        }
      }
    }
  }
  return null
}

/** Objective-coverage conflict: learner claims covered, judge marks unverifiable. */
function coverageConflict(learner: LearnerOutput, judge: JudgeOutput): FinalReport['conflicts'][number] | null {
  const normalise = (s: string) => s.trim().toLowerCase()
  for (const obj of learner.objectivesCovered) {
    const o = normalise(obj)
    if (!o) continue
    const unver = judge.objectivesUnverifiable.some((u) => normalise(u) === o)
    if (unver) {
      return {
        description: `Coverage disagreement for "${obj.slice(0, 120)}": the Learner Agent listed it as covered while the Teacher Judge Agent marked it unverifiable from the evidence.`,
        findingIds: [], // structural disagreement — no specific finding rows
      }
    }
  }
  return null
}

/** Build the final teacher-facing report (pure; no model involvement). */
export function buildFinalReport(input: OrchestrationInput, generatedAt: Date = new Date()): FinalReport {
  const { learner, judge, evidenceRefs } = input
  const excluded = new Set(input.excludedFindingIds ?? [])
  const available = availableKinds(evidenceRefs)

  // 1. Collect and validate agent findings → report findings.
  const allFindings: ReportFinding[] = []
  for (const f of learner.explanationObservations) {
    if (excluded.has(lid(f.id))) continue
    allFindings.push(toReportFinding('LEARNER', lid(f.id), f.kind, normaliseAgentFinding(f), available))
  }
  for (const f of judge.findings) {
    if (excluded.has(jid(f.id))) continue
    allFindings.push(toReportFinding('TEACHER_JUDGE', jid(f.id), f.category, normaliseAgentFinding(f), available))
  }

  // 2. Separate observations from assumptions: flagged advisory-only findings
  //    are NEVER presented as strengths; they surface in improvements/other
  //    with their flag so a human sees them.
  const strengths: ReportFinding[] = []
  const improvements: ReportFinding[] = []
  const otherFindings: ReportFinding[] = []

  const isPositiveLearner = (kind: string, obs: string): boolean =>
    !GAP_KINDS.has(kind) && !NEGATIVE_PACE.test(obs)
  const hasSuggestion = (f: ReportFinding): boolean => typeof f.suggestion === 'string' && f.suggestion.trim().length > 0

  for (const f of allFindings) {
    const isLearnerGap = f.source === 'LEARNER' && (GAP_KINDS.has(f.category) || NEGATIVE_PACE.test(f.observation))
    if (f.flaggedForReview) {
      // Advisory-only findings: improvements when they point at a gap, else
      // kept transparently as other findings.
      if (isLearnerGap) improvements.push(f)
      else otherFindings.push(f)
      continue
    }
    if (isLearnerGap || (f.source === 'TEACHER_JUDGE' && hasSuggestion(f))) {
      improvements.push(f)
      continue
    }
    if (f.source === 'LEARNER' && isPositiveLearner(f.category, f.observation) && (f.confidence === 'high' || f.confidence === 'medium')) {
      strengths.push(f)
      continue
    }
    if (f.source === 'TEACHER_JUDGE' && f.confidence === 'high' && f.evidenceBasis === 'available') {
      strengths.push(f)
      continue
    }
    otherFindings.push(f)
  }

  // Cap the buckets deterministically (highest confidence first, then id).
  const byQuality = (a: ReportFinding, b: ReportFinding): number => {
    const order = { high: 0, medium: 1, low: 2 } as const
    return order[a.confidence] - order[b.confidence] || a.findingId.localeCompare(b.findingId)
  }
  strengths.sort(byQuality)
  improvements.sort(byQuality)
  otherFindings.sort(byQuality)

  // 3. Category table — all ten, honestly.
  const categories = ALL_CATEGORIES.map((category) => {
    const catFindings = allFindings.filter((f) => f.source === 'TEACHER_JUDGE' && f.category === category)
    const notEvaluable = judge.categoriesNotEvaluable.find((c) => c.category === category)
    if (catFindings.length > 0) {
      const best = [...catFindings].sort(byQuality)[0]
      return { category, status: 'EVALUATED' as const, summary: best.observation.slice(0, 600) }
    }
    return {
      category,
      status: 'INSUFFICIENT_EVIDENCE' as const,
      summary:
        notEvaluable?.reason ??
        'The gathered evidence does not support an observation in this category.',
    }
  })

  // 4. Conflicts (deterministic detectors).
  const conflicts = [paceConflict(learner, judge), coverageConflict(learner, judge)].filter(
    (c): c is NonNullable<typeof c> => c !== null,
  )

  // 5. Insufficient-evidence detection (explicit, never papered over).
  const substantiveKinds: string[] = [
    CI_EVIDENCE_KIND.ATTENDANCE_RECORD,
    CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
    CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT,
    CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES,
  ]
  const anySubstantive = substantiveKinds.some((k) => available.has(k))
  const insufficientEvidence =
    learner.insufficientEvidence || judge.insufficientEvidence || !anySubstantive

  // 6. Human review requirement: any advisory-only finding or any conflict.
  const flaggedCount = allFindings.filter((f) => f.flaggedForReview).length
  const requiresHumanReview = conflicts.length > 0 || flaggedCount > 0

  const notes: string[] = []
  if (insufficientEvidence) notes.push('Evidence was insufficient for a complete evaluation; conclusions are limited to what the evidence supports.')
  if (flaggedCount > 0) notes.push(`${flaggedCount} finding(s) rest on unavailable evidence and are advisory-only, pending human review.`)
  if (conflicts.length > 0) notes.push(`${conflicts.length} conflict(s) between agent outputs require human review.`)

  return {
    generatedAtIso: generatedAt.toISOString(),
    lessonSummary: learner.lessonSummary,
    strengths: strengths.slice(0, 12),
    improvements: improvements.slice(0, 12),
    otherFindings: otherFindings.slice(0, 24),
    categories,
    objectivesCovered: [...new Set([...learner.objectivesCovered, ...judge.objectivesCovered])].slice(0, 20),
    objectivesUnverifiable: [...new Set(judge.objectivesUnverifiable)].slice(0, 20),
    conceptsRequiringRevision: [...new Set(learner.conceptsRequiringRevision)].slice(0, 20),
    suggestedPractice: [...new Set(learner.suggestedPractice)].slice(0, 10),
    evidenceRegister: evidenceRefs.map((r) => ({ kind: r.kind, available: r.available, summary: r.summary.slice(0, 400) })),
    conflicts,
    insufficientEvidence,
    requiresHumanReview,
    orchestratorNotes: notes.length > 0 ? notes.join(' ') : undefined,
  }
}

/** Build the class-level student summary (pure; same content for every attendee). */
export function buildStudentSummary(
  input: Pick<OrchestrationInput, 'learner' | 'judge'>,
  classSessionId: string,
): StudentSummary {
  const { learner, judge } = input
  return {
    classId: classSessionId,
    lessonSummary: learner.lessonSummary,
    conceptsCovered: [...new Set([...learner.objectivesCovered, ...judge.objectivesCovered])].slice(0, 20),
    revisionRecommendations: learner.conceptsRequiringRevision
      .slice(0, 10)
      .map((c) => `Revise "${c}" — the lesson evidence suggests this needs another pass.`),
    suggestedPractice: [...new Set(learner.suggestedPractice)].slice(0, 10),
    scopeNote:
      'This is a class-level learning summary generated from the lesson plan and classroom evidence. It is the same for everyone who attended this class and is not an assessment of any individual student.',
  }
}
