// ─── BEAN Classroom Intelligence (CI-1C): BEAN Teacher Judge Agent ──────────
// Evaluates teaching quality across the ten mandated categories using ONLY
// the authorised evidence bundle.
//
// Hard prohibitions (enforced by prompt + schema + orchestrator checks):
//   • Never judge teachers on accent, appearance, disability, personality,
//     gender, religion, language background or any protected characteristic.
//   • Student silence, camera-off status and network interruptions are NEVER
//     evidence of poor teaching or student disengagement.
//   • No invented timestamps, quotes, syllabus coverage or observations.
//   • Categories without a real evidence basis must be declared in
//     categoriesNotEvaluable, not scored anyway.

import { completeJson, fenceClassroomText } from '@/lib/ci/model-adapter'
import type { CiModelAdapter } from '@/lib/ci/model-adapter'
import type { EvidenceView } from '@/lib/ci/evidence'
import { parseJudgeOutput, normaliseStructuredOutput, type JudgeOutput } from '@/lib/ci/schemas'

const CATEGORIES = `1. SUBJECT_ACCURACY — the subject content that the evidence shows was taught is correct and sound.
2. EXPLANATION_CLARITY — explanations of concepts are clear where the evidence allows judging them.
3. LESSON_STRUCTURE — the lesson's visible structure (plan, notes, board use) supports coherent delivery.
4. SYLLABUS_COVERAGE — how far the ADVERTISED objectives (title/description of the class) are shown to be covered by the evidence.
5. TEACHING_PACE — whether the planned duration and the evidence allow an observation about pace.
6. USE_OF_EXAMPLES — whether examples/demonstrations are visible in the evidence (lesson notes, plan).
7. STUDENT_INTERACTION — IMPORTANT: CI-1 collects NO transcripts, audio or individual interaction data. Unless the teacher's own lesson notes describe interaction, this category is usually NOT evaluable — say so instead of guessing.
8. QUESTION_HANDLING — IMPORTANT: no transcripts exist; question handling can be judged ONLY from teacher-provided lesson notes that describe it. Otherwise declare it not evaluable.
9. TIME_MANAGEMENT — planned duration vs. the verified session record (started/ended/actual minutes) supports limited observations.
10. LEARNING_RESOURCE_QUALITY — the quality of the class's own resources: lesson plan completeness, whiteboard structure, teacher notes.`

const SYSTEM = `You are the BEAN Teacher Judge Agent, an analytical agent inside BEAN Education's Classroom Intelligence system.

Your task: evaluate the quality of teaching for ONE class, using ONLY the evidence provided.

EVALUATION CATEGORIES (use these exact enum values):
${CATEGORIES}

STRICT HONESTY AND FAIRNESS RULES:
1. Use ONLY the evidence in the <evidence> blocks. Never invent quotes, timestamps, events, or observations.
2. Every finding must name the evidence kind(s) it rests on. If a finding rests on data marked unavailable, set evidenceBasis to "unavailable".
3. A finding whose evidenceBasis is "unavailable" is Advisory-Only; the orchestrator will flag it for human review. Prefer declaring categoriesNotEvaluable over producing speculative findings.
4. NEVER judge the teacher on accent, appearance, disability, personality, gender, religion, language background, nationality, or any other protected characteristic. Such an observation is forbidden in every field.
5. Student silence, cameras being off, and network interruptions are NOT evidence of poor teaching or disengagement. Never cite them as deficits.
6. You see only AGGREGATE connection statistics — never per-student data. Never claim knowledge of any individual student's experience.
7. SYLLABUS_COVERAGE: the "syllabus" is the class's advertised objective (its title/description). objectivesCovered only when evidence shows it; put everything else in objectivesUnverifiable — NEVER mark an objective "missed" without evidence.
8. When the evidence as a whole is thin, set insufficientEvidence=true.
9. Respond with ONLY a valid JSON object matching the requested shape — no markdown fences, no commentary.

The evidence source labels you may cite: LESSON_PLAN, ATTENDANCE_RECORD, PARTICIPANT_INTERVALS, WHITEBOARD_SNAPSHOT, TEACHER_LESSON_NOTES.`

/** Build the user prompt for one class's evidence. */
export function buildJudgePrompt(view: EvidenceView, teacherNotes: string | null): string {
  const evidenceJson = JSON.stringify(view, null, 1)
  const hasNotes = typeof teacherNotes === 'string' && teacherNotes.trim().length > 0
  const notesBlock = hasNotes ? fenceClassroomText('TEACHER_LESSON_NOTES', (teacherNotes as string).slice(0, 4000)) : ''
  return `Evaluate the teaching quality of this class across the ten categories.

${fenceClassroomText('LESSON_PLAN_AND_CLASSROOM_EVIDENCE', evidenceJson)}
${notesBlock ? `\n${notesBlock}` : ''}

Return this exact JSON shape:
{
  "findings": [{ "id": number starting at 1, "category": one of the ten category enum values, "observation": string (10-1000), "evidenceKinds": string[] (from the allowed labels), "evidenceBasis": "available"|"partially_available"|"unavailable", "confidence": "low"|"medium"|"high", "suggestedImprovement"?: string (max 600) }],
  "categoriesNotEvaluable": [{ "category": category enum value, "reason": string (10-300) }],
  "objectivesCovered": string[],
  "objectivesUnverifiable": string[],
  "insufficientEvidence": boolean,
  "notes"?: string (max 1000)
}`.trim()
}

/** Run the Teacher Judge Agent and validate its output. */
export async function runTeacherJudgeAgent(
  adapter: CiModelAdapter,
  view: EvidenceView,
  teacherNotes: string | null,
): Promise<{ output: JudgeOutput; inputDigestBasis: EvidenceView }> {
  const output = await completeJson<JudgeOutput>({
    adapter,
    system: SYSTEM,
    user: buildJudgePrompt(view, teacherNotes),
    validate: (v) => parseJudgeOutput(normaliseStructuredOutput(v)),
  })
  return { output, inputDigestBasis: view }
}

/** Exported for tests that assert the fairness constraints are actually in the prompt. */
export const TEACHER_JUDGE_SYSTEM_PROMPT = SYSTEM
