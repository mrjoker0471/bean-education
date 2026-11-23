// ─── BEAN Classroom Intelligence (CI-1C): BEAN Learner Agent ────────────────
// Evaluates the learning experience from the student's perspective using ONLY
// the authorised evidence bundle. This is an analytical agent, NOT a fake
// student: it never impersonates an enrolled student, never manufactures
// attendance, never creates reviews, never submits fabricated feedback.
//
// Honesty contract (enforced by prompt + schema):
//   • Observations must cite the evidence kinds they rest on.
//   • No timestamps: CI-1 collects no transcripts, so none may be invented.
//   • No individual-student inference: the agent sees aggregate, identity-free
//     evidence only; understanding is never inferred from presence.

import { completeJson, fenceClassroomText } from '@/lib/ci/model-adapter'
import type { CiModelAdapter } from '@/lib/ci/model-adapter'
import type { EvidenceView } from '@/lib/ci/evidence'
import { parseLearnerOutput, type LearnerOutput } from '@/lib/ci/schemas'

const SYSTEM = `You are the BEAN Learner Agent, an analytical agent inside BEAN Education's Classroom Intelligence system.

Your task: evaluate the learning EXPERIENCE of one online class from the learner's perspective, using ONLY the evidence provided. You are not a student and must never write as if you were one.

STRICT HONESTY RULES:
1. Use ONLY the evidence in the <evidence> blocks. Never invent classroom events, quotes, timestamps, or examples that are not there.
2. Every finding must name the evidence kind(s) it rests on. If your observation rests on data marked unavailable, set evidenceBasis to "unavailable" — do not pretend otherwise.
3. You receive NO transcripts and NO individual student data. You can never know what any specific student understood. Never claim to.
4. Camera-off status, silence, and network interruptions are NOT evidence of disengagement or poor learning. Never mention them as deficits.
5. When evidence is thin, say so plainly by setting insufficientEvidence=true and keeping the summary to what the evidence supports.
6. Objectives: the "advertised objectives" are what the lesson plan's title and description promise. objectivesCovered may only include objectives the evidence actually shows were addressed. Everything else stays out of that list — never count an objective as covered without a basis.
7. Concepts requiring revision: only concepts the evidence suggests were unclear, rushed, or inadequately explained. If you have no basis, return an empty list.
8. suggestedPractice must be generic to the class's subject and level (never derived from any individual).
9. Respond with ONLY a valid JSON object matching the requested shape — no markdown fences, no commentary.

The evidence source labels you may cite: LESSON_PLAN, ATTENDANCE_RECORD, PARTICIPANT_INTERVALS, WHITEBOARD_SNAPSHOT, TEACHER_LESSON_NOTES.`

/** Build the user prompt for one class's evidence. */
export function buildLearnerPrompt(view: EvidenceView, teacherNotes: string | null): string {
  const evidenceJson = JSON.stringify(view, null, 1)
  const hasNotes = typeof teacherNotes === 'string' && teacherNotes.trim().length > 0
  const notesBlock = hasNotes ? fenceClassroomText('TEACHER_LESSON_NOTES', (teacherNotes as string).slice(0, 4000)) : ''
  return `Evaluate the learning experience of this class.

${fenceClassroomText('LESSON_PLAN_AND_CLASSROOM_EVIDENCE', evidenceJson)}
${notesBlock ? `\n${notesBlock}` : ''}

Return this exact JSON shape:
{
  "lessonSummary": string (30-2000 chars, grounded in the evidence),
  "objectivesCovered": string[] (only what evidence shows was addressed),
  "conceptsRequiringRevision": string[] (only evidence-backed gaps),
  "explanationObservations": [{ "id": number starting at 1, "kind": one of EXPLANATION_CLARITY|OBJECTIVE_COVERAGE|CONCEPT_GAP|EXAMPLES_PROVIDED|PACING|PRACTICE_OPPORTUNITY|LEARNING_STRUCTURE|MATERIALS_QUALITY, "observation": string (10-1000), "evidenceKinds": string[] (from the allowed labels), "evidenceBasis": "available"|"partially_available"|"unavailable", "confidence": "low"|"medium"|"high", "suggestedPractice"?: string }],
  "suggestedPractice": string[] (subject-appropriate, 10-400 chars each),
  "insufficientEvidence": boolean,
  "notes"?: string (max 1000)
}`.trim()
}

/** Run the Learner Agent and validate its output. */
export async function runLearnerAgent(
  adapter: CiModelAdapter,
  view: EvidenceView,
  teacherNotes: string | null,
): Promise<{ output: LearnerOutput; inputDigestBasis: EvidenceView }> {
  const output = await completeJson<LearnerOutput>({
    adapter,
    system: SYSTEM,
    user: buildLearnerPrompt(view, teacherNotes),
    validate: (v) => parseLearnerOutput(v),
  })
  return { output, inputDigestBasis: view }
}
