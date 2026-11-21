// ─── Personal Learning Intelligence DTOs (Phase 3B) ──────────────────────────
// Shared contract between the learning API routes and the client. Every value
// in these DTOs originates from real database records — the engines never
// invent numbers, and every list carries an honest empty state.

export type MasteryStatus =
  | 'NOT_ASSESSED'
  | 'INSUFFICIENT_EVIDENCE'
  | 'LEARNING'
  | 'DEVELOPING'
  | 'STRONG'
  | 'NEEDS_REVISION'

export interface TopicMasteryDTO {
  topicId: string
  topicName: string
  examLabel: string | null
  status: MasteryStatus
  /** 0-100 over DISTINCT answered questions (latest answer per question wins). */
  accuracy: number
  /** Distinct answered questions behind this row — shown as "evidence". */
  evidenceQuestions: number
  /** Real submitted attempts covering this topic. */
  attemptCount: number
  statusReason: string | null
  lastActivityAt: string | null
}

export interface MasterySummaryDTO {
  counts: {
    strong: number
    developing: number
    learning: number
    needsRevision: number
    insufficientEvidence: number
  }
  /** Up to 5 — NEEDS_REVISION / LEARNING first, lowest accuracy first. */
  weakest: TopicMasteryDTO[]
  /** Up to 3 — STRONG first. */
  strongest: TopicMasteryDTO[]
  totalTracked: number
}

export type PlanTaskKind =
  | 'REVISE_TOPIC'
  | 'PRACTICE_TOPIC'
  | 'DIAGNOSTIC'
  | 'REVIEW_MISTAKES'
  | 'GOAL_WORK'
  | 'CONTINUE_DOC'

export type PlanTaskStatus = 'PLANNED' | 'COMPLETED' | 'SKIPPED' | 'DEFERRED'

export interface PlanTaskDTO {
  id: string
  planDate: string
  kind: PlanTaskKind
  title: string
  topicId: string | null
  topicName: string | null
  examLabel: string | null
  estimatedMinutes: number
  /** 1 = highest … 3 = lowest — deterministic, documented in the Phase 3B doc. */
  priority: number
  /** Evidence-cited reason shown verbatim to the learner. */
  rationale: string
  status: PlanTaskStatus
  completedAt: string | null
}

export interface DayPlanDTO {
  date: string
  /** true when this request generated the plan (first view of the day). */
  generated: boolean
  availableMinutes: number
  plannedMinutes: number
  completedMinutes: number
  /** Open (PLANNED) tasks in priority order. */
  tasks: PlanTaskDTO[]
  /** History for this date — completed / skipped / deferred, never rewritten. */
  history: PlanTaskDTO[]
}

export interface RevisionItemDTO {
  topicId: string
  topicName: string
  examLabel: string | null
  intervalDays: number
  repetitions: number
  lapses: number
  lastOutcome: 'SUCCESS' | 'PARTIAL' | 'FAILURE' | null
  lastReviewedAt: string | null
  nextDueAt: string
  dueState: 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING'
  daysUntilDue: number
  misconceptionFlag: boolean
}

export interface RevisionResponseDTO {
  due: RevisionItemDTO[]
  upcoming: RevisionItemDTO[]
  note: string
}

export type MistakeSystemCategory = 'CONCEPT' | 'REPEAT_GAP' | 'UNCLASSIFIED'
export type MistakeStudentTag = 'CONCEPT' | 'FACT' | 'FORMULA' | 'MISREAD'

export interface MistakeItemDTO {
  id: string
  attemptId: string
  source: 'BANK' | 'RIISHE'
  questionId: string
  topicId: string | null
  topicName: string | null
  /** Snapshot captured at submit time — the original question as served. */
  text: string
  options: string[]
  chosenIndex: number
  correctIndex: number
  explanation: string | null
  category: MistakeSystemCategory
  categoryReason: string | null
  /** Student self-report — preferred for display, always labelled as such. */
  studentTag: MistakeStudentTag | null
  note: string | null
  /** Distinct attempts in which this question was answered wrong. */
  timesWrong: number
  createdAt: string
}

export interface MistakesResponseDTO {
  mistakes: MistakeItemDTO[]
  repeatGapCount: number
  unclassifiedCount: number
  note: string
}

export type ActionType =
  | 'REVIEW_DUE'
  | 'NEEDS_REVISION_PRACTICE'
  | 'WEAK_TOPIC_PRACTICE'
  | 'DIAGNOSTIC'
  | 'REVIEW_MISTAKES'
  | 'GOAL_WORK'
  | 'PLAN_TODAY'
  | 'CONTINUE_DOC'

export interface LearningActionDTO {
  actionKey: string
  type: ActionType
  title: string
  reason: string
  topicId: string | null
  /** In-app hash route target. */
  href: string
  priority: number
}

export interface ActionsResponseDTO {
  actions: LearningActionDTO[]
  note: string
}

export interface LearningInsightsDTO {
  stated: {
    dailyMinutes: number | null
    goalExam: string | null
    learningStyle: string | null
    activeGoals: number
    /** 'account preferences' when a claimed account backs these, else null (guest). */
    source: string | null
  }
  observed: {
    activeDays14: number
    minutes14: number | null
    avgMinutesPerActiveDay: number | null
    attempts14: number
    topTopics: { name: string; count: number }[]
    lastActivityAt: string | null
  }
  honestyNotes: string[]
}

export interface LearningOverviewDTO {
  mastery: MasterySummaryDTO
  plan: {
    date: string
    availableMinutes: number
    plannedMinutes: number
    completedMinutes: number
    openTasks: number
    completedToday: number
    tasks: PlanTaskDTO[]
  }
  revision: {
    dueCount: number
    overdueCount: number
    next: RevisionItemDTO[]
  }
  actions: LearningActionDTO[]
  diagnostics: {
    /** Insufficient-evidence topics that actually have a question bank to probe. */
    availableTopics: { topicId: string; topicName: string; examLabel: string | null; questionBank: number }[]
  }
  insights: LearningInsightsDTO
  generatedAt: string
}
