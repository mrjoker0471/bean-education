// ─── BEAN Classroom Intelligence (CI-1): shared constants ────────────────────
// Single source of truth for the evaluation pipeline's state machines, agent
// names, evidence kinds and bounds. Every write path validates against these
// — client-supplied values are never trusted.

export const CI_JOB_STATUS = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const

export const CI_STAGE = {
  PENDING: 'PENDING',
  EVIDENCE: 'EVIDENCE',
  LEARNER: 'LEARNER',
  TEACHER_JUDGE: 'TEACHER_JUDGE',
  ORCHESTRATE: 'ORCHESTRATE',
  PUBLISH: 'PUBLISH',
  DONE: 'DONE',
} as const

export const CI_TRIGGER = {
  SESSION_END: 'SESSION_END', // teacher ended the live session
  PROVIDER_ROOM_FINISHED: 'PROVIDER_ROOM_FINISHED', // LiveKit room_finished webhook
  TEACHER_REQUEST: 'TEACHER_REQUEST', // explicit teacher request (first run or re-run)
  ADMIN_RETRY: 'ADMIN_RETRY', // admin re-queued a failed evaluation
} as const

export const CI_AGENT = {
  LEARNER: 'LEARNER',
  TEACHER_JUDGE: 'TEACHER_JUDGE',
  ORCHESTRATOR: 'ORCHESTRATOR',
} as const

export const CI_EVIDENCE_KIND = {
  LESSON_PLAN: 'LESSON_PLAN',
  ATTENDANCE_RECORD: 'ATTENDANCE_RECORD',
  PARTICIPANT_INTERVALS: 'PARTICIPANT_INTERVALS',
  WHITEBOARD_SNAPSHOT: 'WHITEBOARD_SNAPSHOT',
  TEACHER_LESSON_NOTES: 'TEACHER_LESSON_NOTES',
} as const

export const CI_REPORT_STATUS = {
  CURRENT: 'CURRENT',
  SUPERSEDED: 'SUPERSEDED',
  RETRACTED: 'RETRACTED',
} as const

export const CI_DISPUTE_STATUS = {
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const

export const CI_DISPUTE_RESOLUTION = {
  UPHELD: 'UPHELD',
  CORRECTED: 'CORRECTED',
  RETRACTED: 'RETRACTED',
} as const

export const CI_DISPUTE_EVENT_ACTION = {
  SUBMITTED: 'SUBMITTED',
  ASSIGNED: 'ASSIGNED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
  NOTE_ADDED: 'NOTE_ADDED',
  /** CI-2E: the teacher's one reconsideration request on a closed dispute —
   *  the appeal step. The admin who made the original decision is then
   *  barred (server-side) from reviewing the reconsidered case. */
  RECONSIDER_REQUESTED: 'RECONSIDER_REQUESTED',
} as const

/** Consent purpose reused on the existing ConsentRecord model (per teacher account). */
export const CI_CONSENT_PURPOSE = 'CLASSROOM_INTELLIGENCE_TEACHER'

// ─── Bounds (server-enforced on every write path) ─────────────────────────────

/** Opt-in teacher lesson notes / transcript paste: 30..4000 chars. */
export const CI_TEACHER_NOTES_MIN = 30
export const CI_TEACHER_NOTES_MAX = 4000
/** Max findings referenced in one dispute. */
export const CI_DISPUTE_MAX_FINDINGS = 10
/** Dispute reason bound per finding. */
export const CI_DISPUTE_REASON_MIN = 20
export const CI_DISPUTE_REASON_MAX = 1000

// ─── Worker tuning (mirrors the Riishe runner's proven semantics) ─────────────

export const CI_LEASE_MS = 12 * 60_000
export const CI_POLL_MS = 5_000
export const CI_MAX_ATTEMPTS = 3
