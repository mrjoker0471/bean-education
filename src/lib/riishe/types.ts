// ─── Riishe backend types (mirrored for the client in src/lib/types.ts) ──────

// v3: fair topic cap (never drops level-1 sections), full multi-unit page
// spans, wrapped-TOC-row joining, content-filter sub-chunk/skip accounting.
export const PIPELINE_VERSION = 3

export interface AnalyzedTopic {
  /** Canonical title — the variant that best matches the document's own wording */
  name: string
  subtopics: string[]
  /** Physical PDF pages (1-based), verified against the extracted page text */
  pages: number[]
  // ── v2 fields (pipelineVersion ≥ 2) ──
  /** Stable id within the analysis (t1, t2 …) for parent links */
  id?: string
  /** 1 = major section of the document, 2 = subtopic/concept under a section */
  level?: 1 | 2
  /** id of the containing level-1 topic, when the document has that structure */
  parentId?: string | null
  /** Duplicate variants merged into this canonical topic (wording differences) */
  aliases?: string[]
  /** Printed page labels (e.g. "13") when the document's printed numbering was reliably detected */
  printedPages?: string[]
  /** false when no claimed page could be verified against the page text */
  pageVerified?: boolean
}

export interface CoverageMetrics {
  totalPages: number
  readablePages: number
  /** image-only pages OCR would be needed for */
  scannedPages: number
  /** readable pages inside units that were analysed successfully */
  analysedPages: number
  /** readable pages not covered by any successful unit (failed or pending) */
  unanalysedPages: number
  /** readable pages in units deterministically skipped WITH a recorded reason
   *  (e.g. the provider's safety filter refuses dense name lists) — terminal,
   *  never retried silently, always disclosed */
  skippedPages: number
  unitsTotal: number
  unitsOk: number
  unitsFailed: number
  unitsSkipped: number
  /** true only when no readable page is left unaccounted: every page sits in
   *  a successful unit or a skipped-with-reason unit, and nothing failed */
  complete: boolean
}

export interface SectionOutcome {
  index: number
  title: string | null
  label: string
  fromPage: number
  toPage: number
  status: 'OK' | 'FAILED' | 'SKIPPED'
  /** FAILED: what went wrong (retryable). SKIPPED: why it was skipped (terminal). */
  error?: string
}

export interface DocStructureInfo {
  kind: 'TOC_GUIDED' | 'HEADING_GUIDED' | 'QUESTION_PAPER' | 'UNSTRUCTURED'
  tocValidated: boolean
  tocEntries: number
  headingCount: number
  /** physical = printed + offset (null when no consistent numbering found) */
  printedPageOffset: number | null
  printedRomanFrontMatter: boolean
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
  // ── v2 fields ──
  pipelineVersion?: number
  coverage?: CoverageMetrics
  sectionOutcomes?: SectionOutcome[]
  structure?: DocStructureInfo
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
