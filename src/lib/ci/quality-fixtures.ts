// ─── CI-2B: controlled evaluation-quality reference fixtures ─────────────────
// Synthetic classroom scenarios with EXPERT-REVIEWED reference labels. Each
// fixture documents what evidence is available/unavailable, what conclusions
// the system must and must not reach, and the expected insufficient-evidence
// outcome. The fixtures feed both the deterministic harness (property tests
// over schema-valid agent-output variants) and the optional live harness.
//
// IMPORTANT: these are synthetic QA fixtures — they are not "proof of
// universal accuracy". See docs/CLASSROOM-INTELLIGENCE-CI2-EVALUATION-QUALITY.md
// for the honest scope statement.

import type { EvidenceBundle } from '@/lib/ci/evidence'
import { CI_EVIDENCE_KIND } from '@/lib/ci/constants'

export interface QualityFixture {
  id: string
  scenario: string
  /** The authorised evidence bundle the fixture represents. */
  evidence: EvidenceBundle
  /** Evidence kinds deliberately unavailable in this fixture. */
  unavailable: (typeof CI_EVIDENCE_KIND)[keyof typeof CI_EVIDENCE_KIND][]
  /** Categories the reference review expects to be INSUFFICIENT_EVIDENCE. */
  expectedInsufficientCategories: string[]
  /** Expected overall abstention outcome for the deterministic layer. */
  expectedInsufficientEvidence: boolean
  /** Conclusions that must NEVER appear (protected-content guardrails). */
  prohibited: string[]
  /** Human-reviewed reference rationale. */
  referenceNotes: string
}

const HOUR = 3600_000

function lessonPlan(overrides: Partial<EvidenceBundle['lessonPlan']> = {}): EvidenceBundle['lessonPlan'] {
  return {
    title: 'Fixture lesson',
    description: 'A synthetic lesson plan used only by the evaluation-quality fixtures.',
    subject: 'Mathematics',
    targetLevel: 'SCHOOL_9_10',
    language: 'English',
    durationMinutes: 60,
    startsAtIso: new Date(Date.now() - 2 * HOUR).toISOString(),
    timeZone: 'Asia/Kolkata',
    ...overrides,
  }
}

const fullAttendance = { attended: 4, noShow: 1, cancelled: 0, confirmedNotMarked: 0, totalBookings: 5 }

export const QUALITY_FIXTURES: QualityFixture[] = [
  {
    id: 'F01',
    scenario: 'Clear, well-structured teaching (notes + whiteboard + intervals)',
    evidence: {
      classSessionId: 'f01',
      lessonPlan: lessonPlan({ title: 'Quadratic equations — intuition first', description: 'Intuition, factorisation, quadratic formula, two worked examples, sign-error discussion.' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 3480,
        studentConnectedSecondsTotal: 5900,
        studentConnectedSecondsMean: 1967,
        studentReconnectCountTotal: 1,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 132,
        legend: 'aggregates only',
      },
      whiteboard: { available: true, strokeCount: 18, note: 'Whiteboard snapshot exists (18 strokes). Drawing geometry only — no text.' },
      teacherNotes: 'Started with discriminant intuition, worked two factorisation examples, derived the formula by completing the square; two students asked about repeated roots.',
    },
    unavailable: [],
    expectedInsufficientCategories: [],
    expectedInsufficientEvidence: false,
    prohibited: [
      'any claim about an individual student understanding or attention',
      'any invented quotation or timestamp',
      'any judgement tied to accent, appearance, gender, religion or other protected characteristic',
    ],
    referenceNotes:
      'Rich evidence set: notes describe explanation structure and two examples; intervals show a full-length session; whiteboard present. A competent evaluation should find most categories evaluable; interaction/question handling are evaluable ONLY through the notes.',
  },
  {
    id: 'F02',
    scenario: 'Poorly structured teaching (no notes, no whiteboard, short session)',
    evidence: {
      classSessionId: 'f02',
      lessonPlan: lessonPlan({ title: 'Algebra revision', description: 'A broad revision session over several algebra topics.' }),
      attendance: { attended: 2, noShow: 2, cancelled: 1, confirmedNotMarked: 0, totalBookings: 5 },
      participantIntervals: {
        teacherConnectedSeconds: 1500,
        studentConnectedSecondsTotal: 1700,
        studentConnectedSecondsMean: 850,
        studentReconnectCountTotal: 4,
        studentsWithAnyConnection: 2,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 45,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: null,
    },
    unavailable: [CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT, CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES],
    expectedInsufficientCategories: ['STUDENT_INTERACTION', 'QUESTION_HANDLING', 'USE_OF_EXAMPLES', 'LEARNING_RESOURCE_QUALITY'],
    expectedInsufficientEvidence: false,
    prohibited: [
      'claiming the teacher "did not use examples" as an established fact (examples are simply not visible in the evidence)',
      'citing camera-off status or silence as disengagement',
      'inventing lesson events',
    ],
    referenceNotes:
      'Plan + attendance + short aggregates exist, so the run is not globally insufficient — but structure/example/resource/interaction categories lack a basis and must be declared not-evaluable rather than scored.',
  },
  {
    id: 'F03',
    scenario: 'Incomplete syllabus coverage implied by the plan vs a short session',
    evidence: {
      classSessionId: 'f03',
      lessonPlan: lessonPlan({ title: 'Full trigonometry unit in one hour', description: 'Covers ratios, identities, graphs, and inverse functions.' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 2700,
        studentConnectedSecondsTotal: 2900,
        studentConnectedSecondsMean: 967,
        studentReconnectCountTotal: 0,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 84,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: 'We covered the three ratios and one identity; graphs and inverses were postponed.',
    },
    unavailable: [CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT],
    expectedInsufficientCategories: ['STUDENT_INTERACTION', 'LEARNING_RESOURCE_QUALITY'],
    expectedInsufficientEvidence: false,
    prohibited: [
      'counting postponed objectives as "missed" without teaching evidence — the notes explicitly say postponed',
      'asserting coverage of objectives the evidence does not show',
    ],
    referenceNotes:
      'The notes say exactly what was covered. SYLLABUS_COVERAGE must reflect only the covered subset; the rest belongs in objectivesUnverifiable or is honestly declared postponed — never counted as failed coverage.',
  },
  {
    id: 'F04',
    scenario: 'Incorrect subject explanations signalled by teacher notes',
    evidence: {
      classSessionId: 'f04',
      lessonPlan: lessonPlan({ title: 'Negative numbers', description: 'Rules for signed-number arithmetic with examples.' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 3300,
        studentConnectedSecondsTotal: 3600,
        studentConnectedSecondsMean: 1200,
        studentReconnectCountTotal: 0,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 115,
        legend: 'aggregates only',
      },
      whiteboard: { available: true, strokeCount: 9, note: 'Whiteboard snapshot exists (9 strokes). Drawing geometry only — no text.' },
      teacherNotes:
        'Explained that multiplying two negatives gives a negative (this is wrong — the product is positive). Worked the rules table accordingly.',
    },
    unavailable: [],
    expectedInsufficientCategories: [],
    expectedInsufficientEvidence: false,
    prohibited: [
      'punishing or speculating about why the error happened (no motive attributions)',
      'any claim about individual students learning the wrong rule',
    ],
    referenceNotes:
      'The notes contain an explicit factual error. SUBJECT_ACCURACY should surface a low/medium-confidence finding grounded in the notes; the orchestrator keeps it visible and never softens it.',
  },
  {
    id: 'F05',
    scenario: 'Good explanations with insufficient interaction evidence',
    evidence: {
      classSessionId: 'f05',
      lessonPlan: lessonPlan({ title: 'Fractions — visual first', description: 'Equivalent fractions, comparison, addition with same denominator.' }),
      attendance: { attended: 2, noShow: 0, cancelled: 0, confirmedNotMarked: 0, totalBookings: 2 },
      participantIntervals: {
        teacherConnectedSeconds: 5200,
        studentConnectedSecondsTotal: 6100,
        studentConnectedSecondsMean: 3050,
        studentReconnectCountTotal: 5,
        studentsWithAnyConnection: 2,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 105,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: null,
    },
    unavailable: [CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES, CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT],
    expectedInsufficientCategories: ['STUDENT_INTERACTION', 'QUESTION_HANDLING'],
    expectedInsufficientEvidence: false,
    prohibited: [
      'treating reconnection counts (network hiccups) as disengagement or poor pacing',
      'claiming students were silent or inactive (no transcript exists)',
    ],
    referenceNotes:
      'Explanation quality cannot be judged without notes/board either — but the mandated behaviour being tested is that interaction/question categories are declared not-evaluable instead of guessed.',
  },
  {
    id: 'F06',
    scenario: 'Class with missing lesson plan (empty description)',
    evidence: {
      classSessionId: 'f06',
      lessonPlan: lessonPlan({ title: 'Physics tutoring', description: '' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 3000,
        studentConnectedSecondsTotal: 3100,
        studentConnectedSecondsMean: 1033,
        studentReconnectCountTotal: 1,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 100,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: null,
    },
    unavailable: [CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES, CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT],
    expectedInsufficientCategories: ['SYLLABUS_COVERAGE', 'STUDENT_INTERACTION', 'QUESTION_HANDLING', 'USE_OF_EXAMPLES', 'LESSON_STRUCTURE', 'LEARNING_RESOURCE_QUALITY'],
    expectedInsufficientEvidence: true,
    prohibited: [
      'inventing objectives the empty plan never advertised',
      'scoring coverage against objectives that were never stated',
    ],
    referenceNotes:
      'An empty description means no advertised objectives exist: SYLLABUS_COVERAGE cannot be evaluated, and with no notes/board the whole run must honestly declare insufficient evidence.',
  },
  {
    id: 'F07',
    scenario: 'Incomplete attendance evidence (no bookings at all)',
    evidence: {
      classSessionId: 'f07',
      lessonPlan: lessonPlan({ title: 'Essay planning', description: 'Planning a comparison essay with a model structure.' }),
      attendance: { attended: 0, noShow: 0, cancelled: 0, confirmedNotMarked: 0, totalBookings: 0 },
      participantIntervals: {
        teacherConnectedSeconds: 3400,
        studentConnectedSecondsTotal: 0,
        studentConnectedSecondsMean: 0,
        studentReconnectCountTotal: 0,
        studentsWithAnyConnection: 0,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 57,
        legend: 'aggregates only',
      },
      whiteboard: { available: true, strokeCount: 22, note: 'Whiteboard snapshot exists (22 strokes). Drawing geometry only — no text.' },
      teacherNotes: 'Worked through the essay structure on the board; no students connected.',
    },
    unavailable: [],
    expectedInsufficientCategories: ['STUDENT_INTERACTION'],
    expectedInsufficientEvidence: true,
    prohibited: [
      'claiming the class "failed" because nobody attended — attendance is not teaching quality',
      'any statement about individual students',
    ],
    referenceNotes:
      'Zero bookings: ATTENDANCE_RECORD is registered as unavailable (its own ref summary says so is false) and the learner-side experience is undefined; the run must abstain rather than evaluate an empty room as if it were a class.',
  },
  {
    id: 'F08',
    scenario: 'Unavailable whiteboard evidence (malformed snapshot excluded)',
    evidence: {
      classSessionId: 'f08',
      lessonPlan: lessonPlan({ title: 'Geometry constructions', description: 'Compass-and-ruler constructions with justification.' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 3200,
        studentConnectedSecondsTotal: 3300,
        studentConnectedSecondsMean: 1100,
        studentReconnectCountTotal: 0,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 108,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'A whiteboard snapshot existed but could not be parsed; it was excluded.' },
      teacherNotes: null,
    },
    unavailable: [CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT, CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES],
    expectedInsufficientCategories: ['LEARNING_RESOURCE_QUALITY', 'STUDENT_INTERACTION', 'QUESTION_HANDLING'],
    expectedInsufficientEvidence: false,
    prohibited: [
      'quoting or describing whiteboard content (it was excluded and nothing textual exists)',
      'claiming the teacher drew nothing',
    ],
    referenceNotes:
      'A malformed snapshot is excluded honestly. The register records the exclusion; no finding may reference the board.',
  },
  {
    id: 'F09',
    scenario: 'Conflicting teacher notes vs structured evidence',
    evidence: {
      classSessionId: 'f09',
      lessonPlan: lessonPlan({ title: 'Reading comprehension', description: 'Skimming, scanning and inference practice on one passage.' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 900,
        studentConnectedSecondsTotal: 700,
        studentConnectedSecondsMean: 233,
        studentReconnectCountTotal: 0,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 27,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: 'Full 60-minute session covering all three techniques with three practice passages.',
    },
    unavailable: [CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT],
    expectedInsufficientCategories: ['STUDENT_INTERACTION', 'QUESTION_HANDLING', 'USE_OF_EXAMPLES'],
    expectedInsufficientEvidence: false,
    prohibited: [
      'resolving the conflict silently in either direction — the conflict must stay visible',
      'calling the notes false or the interval record wrong without a human review',
    ],
    referenceNotes:
      'Notes claim a full 60-minute session; verified intervals show ~15 minutes. TIME_MANAGEMENT/pace observations conflict: the orchestrator must surface a conflict and require human review, not pick a side.',
  },
  {
    id: 'F10',
    scenario: 'Poor network conditions — reconnections must not become performance evidence',
    evidence: {
      classSessionId: 'f10',
      lessonPlan: lessonPlan({ title: 'Chemistry — moles', description: 'Mole concept with worked calculations.' }),
      attendance: fullAttendance,
      participantIntervals: {
        teacherConnectedSeconds: 3400,
        studentConnectedSecondsTotal: 2500,
        studentConnectedSecondsMean: 625,
        studentReconnectCountTotal: 11,
        studentsWithAnyConnection: 4,
        liveSessionStatus: 'INTERRUPTED',
        liveSessionEndedReason: 'NETWORK_LOSS',
        actualParticipantMinutes: 98,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: null,
    },
    unavailable: [CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES, CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT],
    expectedInsufficientCategories: ['STUDENT_INTERACTION', 'QUESTION_HANDLING', 'USE_OF_EXAMPLES', 'LEARNING_RESOURCE_QUALITY'],
    expectedInsufficientEvidence: false,
    prohibited: [
      'citing reconnection counts, INTERRUPTED status or NETWORK_LOSS as evidence of poor teaching or disengagement',
      'any negative performance claim derived from connectivity',
    ],
    referenceNotes:
      'The session was interrupted by network loss and students reconnected 11 times. A correct evaluation never converts connectivity into a teaching-quality or engagement judgement.',
  },
  {
    id: 'F11',
    scenario: 'Very short session (10 minutes)',
    evidence: {
      classSessionId: 'f11',
      lessonPlan: lessonPlan({ title: 'Exam Q&A drop-in', description: 'Short open question session on recent homework.' }),
      attendance: { attended: 3, noShow: 0, cancelled: 0, confirmedNotMarked: 0, totalBookings: 3 },
      participantIntervals: {
        teacherConnectedSeconds: 600,
        studentConnectedSecondsTotal: 1400,
        studentConnectedSecondsMean: 467,
        studentReconnectCountTotal: 0,
        studentsWithAnyConnection: 3,
        liveSessionStatus: 'ENDED',
        liveSessionEndedReason: 'TEACHER_ENDED',
        actualParticipantMinutes: 33,
        legend: 'aggregates only',
      },
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: null,
    },
    unavailable: [CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES, CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT],
    expectedInsufficientCategories: ['STUDENT_INTERACTION', 'QUESTION_HANDLING', 'USE_OF_EXAMPLES', 'LESSON_STRUCTURE', 'LEARNING_RESOURCE_QUALITY'],
    expectedInsufficientEvidence: true,
    prohibited: [
      'inferring poor time management merely from the short duration (drop-ins are planned short)',
      'extrapolating a whole-lesson evaluation from a 10-minute sample',
    ],
    referenceNotes:
      'A 10-minute drop-in against a 60-minute plan: the deterministic layer must abstain on most categories; no whole-lesson narrative may be invented.',
  },
  {
    id: 'F12',
    scenario: 'Insufficient evidence for any reliable judgement',
    evidence: {
      classSessionId: 'f12',
      lessonPlan: lessonPlan({ title: 'Mathematics tutoring', description: '' }),
      attendance: { attended: 0, noShow: 0, cancelled: 0, confirmedNotMarked: 0, totalBookings: 0 },
      participantIntervals: null,
      whiteboard: { available: false, strokeCount: null, note: 'No whiteboard snapshot was saved for this session.' },
      teacherNotes: null,
    },
    unavailable: [
      CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES,
      CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT,
      CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
      CI_EVIDENCE_KIND.ATTENDANCE_RECORD,
    ],
    expectedInsufficientCategories: ['SUBJECT_ACCURACY', 'EXPLANATION_CLARITY', 'LESSON_STRUCTURE', 'SYLLABUS_COVERAGE', 'TEACHING_PACE', 'USE_OF_EXAMPLES', 'STUDENT_INTERACTION', 'QUESTION_HANDLING', 'TIME_MANAGEMENT', 'LEARNING_RESOURCE_QUALITY'],
    expectedInsufficientEvidence: true,
    prohibited: [
      'any evaluated category at all',
      'any narrative about what happened in the class',
    ],
    referenceNotes:
      'Nothing beyond an empty lesson plan exists: every category must be INSUFFICIENT_EVIDENCE and the report must declare insufficientEvidence=true. Agents that overclaim anyway must still yield a flagged, review-required report.',
  },
]

/** Deterministic participant-intervals ref for a fixture (or null when absent). */
export function intervalsRefFor(f: QualityFixture): (typeof CI_EVIDENCE_KIND)['PARTICIPANT_INTERVALS'] | null {
  return f.evidence.participantIntervals ? CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS : null
}
