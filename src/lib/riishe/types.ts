// ─── Riishe backend types (mirrored for the client in src/lib/types.ts) ──────

export interface AnalyzedTopic {
  name: string
  subtopics: string[]
  pages: number[]
}

export interface DocumentAnalysis {
  title: string
  summary: string
  topics: AnalyzedTopic[]
  definitions: { term: string; meaning: string; page: number }[]
  keyFacts: string[]
  formulas: string[]
  misconceptions: { misconception: string; correction: string; page?: number }[]
  keyPages: number[]
  unreadableSections: string[]
  studyGaps: string[]
  coverageNote: string
}

// ─── Question generation ───────────────────────────────────────────────────────

export type QuestionCategory = 'FOUNDATION' | 'APPLICATION' | 'STATEMENT' | 'MULTISTEP' | 'MISCONCEPTION'

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  FOUNDATION: 'Foundational concepts',
  APPLICATION: 'Application & reasoning',
  STATEMENT: 'Statement-based & comparison',
  MULTISTEP: 'Multi-step & challenging',
  MISCONCEPTION: 'Misconception checks',
}

/** Configurable default distribution for a 50-question Riishe test. */
export const DEFAULT_DISTRIBUTION: Record<QuestionCategory, number> = {
  FOUNDATION: 10,
  APPLICATION: 15,
  STATEMENT: 10,
  MULTISTEP: 10,
  MISCONCEPTION: 5,
}

export interface GeneratedQuestion {
  text: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  category: QuestionCategory
  topic: string
  pageRefs: number[]
  evidence: string
}

export interface RiisheTestStats {
  generated: number
  validated: number
  rejected: number
  byCategory: Partial<Record<QuestionCategory, number>>
  byDifficulty: { EASY: number; MEDIUM: number; HARD: number }
  llmCalls: number
  batches: number
}

// ─── Explanations ──────────────────────────────────────────────────────────────

export interface RiisheExplanationPayload {
  whyWrong: string
  correctReasoning: string
  excerpt: string
  pageRefs: number[]
  concept: string
  misconception: string | null
  revisionTopic: string
  grounding: 'document' | 'external'
}

// ─── Upload / processing limits (configurable via env) ────────────────────────

export const MAX_UPLOAD_MB = Number(process.env.RIISHE_MAX_UPLOAD_MB ?? 15)
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024
export const SUPPORTED_MIME = 'application/pdf'
export const SUPPORTED_EXT = '.pdf'

/** Processing states the client can poll through. */
export const PROCESSING_STATES = ['QUEUED', 'EXTRACTING', 'ANALYSING'] as const
