// ─── BEAN Classroom Intelligence (CI-1D): safe DTOs for teacher/student UI ──
// Everything a browser receives from the CI domain passes through here.
// Rules:
//   • No internal identifiers beyond what ownership display requires
//     (class id, report id), no emails, no participant identities.
//   • The model adapter id is surfaced to TEACHERS only as provenance metadata
//     ("evaluation engine"), never to students.
//   • Report JSON is parsed defensively: a malformed stored report degrades to
//     `report: null` + an honest error note — the UI never guesses.

import type { FinalReport, StudentSummary } from './schemas'
import type { CiConsentState } from './trigger'

export interface CiConsentDTO {
  granted: boolean
  grantedAt: string | null
  withdrawnAt: string | null
}

export interface CiEvaluationStatusDTO {
  jobId: string
  status: string // QUEUED | RUNNING | COMPLETED | FAILED | SKIPPED
  stage: string
  trigger: string
  error: string | null
  updatedAt: string
}

export interface CiClassEvaluationSummaryDTO {
  classSessionId: string
  title: string
  subject: string
  startsAt: string
  timeZone: string
  durationMinutes: number
  evaluation: CiEvaluationStatusDTO | null
  currentVersion: number | null
  insufficientEvidence: boolean
  requiresHumanReview: boolean
}

export interface CiTeacherSummaryResponse {
  consent: CiConsentDTO
  /** Ended/interrupted classes with a COMPLETED evaluation. */
  evaluated: CiClassEvaluationSummaryDTO[]
  /** Ended/interrupted classes currently queued or running. */
  pending: CiClassEvaluationSummaryDTO[]
  /** Ended/interrupted classes that can be (re-)requested now. */
  eligible: CiClassEvaluationSummaryDTO[]
  totals: { evaluatedClasses: number; requiresReview: number }
}

export interface CiReportVersionDTO {
  id: string
  version: number
  status: string // CURRENT | SUPERSEDED | RETRACTED
  createdAt: string
  insufficientEvidence: boolean
  requiresHumanReview: boolean
  modelId: string | null
  report: FinalReport | null
  reportError: string | null
}

export interface CiClassEvaluationResponse {
  classSession: {
    id: string
    title: string
    subject: string
    startsAt: string
    timeZone: string
    durationMinutes: number
  }
  job: CiEvaluationStatusDTO | null
  versions: CiReportVersionDTO[]
}

export interface CiStudentSummaryDTO {
  bookingId: string
  classSessionId: string
  title: string
  subject: string
  startsAt: string
  timeZone: string
  summary: StudentSummary
  generatedAt: string
}

export interface CiStudentSummariesResponse {
  summaries: CiStudentSummaryDTO[]
}

// ─── CI-2C: teacher improvement trends (deterministic aggregation) ───────────

export interface CiTrendSubjectCoverage {
  subject: string
  evaluatedClasses: number
  coveredObjectives: number
  unverifiableObjectives: number
  coverageRatio: number | null
  sufficientSample: boolean
}

export interface CiTrendCategory {
  category: string
  evaluatedCount: number
  insufficientCount: number
  strengthCount: number
  improvementCount: number
  missingEvidenceNote: string | null
  subjectBreakdown: { subject: string; evaluated: number; strengths: number; improvements: number; evaluatedClasses: number }[]
}

export interface CiTrendImprovementSignal {
  subject: string
  category: string
  direction: 'improving' | 'steady' | 'needs-attention'
  earlierCount: number
  recentCount: number
  classesCompared: number
  caveat: string
}

export interface CiTrendRecurringSuggestion {
  text: string
  occurrences: number
  categories: string[]
}

export interface CiTrendSuggestedResource {
  category: string
  title: string
  description: string
}

export interface CiTeacherTrends {
  evaluatedClasses: number
  insufficientData: boolean
  subjects: { subject: string; evaluatedClasses: number }[]
  coverage: CiTrendSubjectCoverage[]
  categories: CiTrendCategory[]
  recurringSuggestions: CiTrendRecurringSuggestion[]
  improvementSignals: CiTrendImprovementSignal[]
  suggestedResources: CiTrendSuggestedResource[]
}

export interface CiTeacherTrendsResponse {
  trends: CiTeacherTrends
  generatedAt: string
  scopeNote: string
}

export function toConsentDTO(state: CiConsentState): CiConsentDTO {
  return { granted: state.granted, grantedAt: state.grantedAt, withdrawnAt: state.withdrawnAt }
}

/** Parse a stored report defensively — never throw into a route response. */
export function parseStoredReport(json: string | null): { report: FinalReport | null; reportError: string | null } {
  if (!json) return { report: null, reportError: null }
  try {
    return { report: JSON.parse(json) as FinalReport, reportError: null }
  } catch {
    return { report: null, reportError: 'The stored report could not be parsed — it has been kept unchanged for inspection.' }
  }
}
