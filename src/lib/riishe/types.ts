// ─── Riishe backend types (mirrored for the client in src/lib/types.ts) ──────

// v4: three-layer representation — the document's own structure (original
// headings, numbering, contents-table entries with match status) is kept
// separate from AI-inferred study topics; dedupe is origin-aware and never
// fuses distinct sections; page labels come from detected evidence.
export const PIPELINE_VERSION = 4

/** What a topic's TITLE represents in the source document. */
export type TopicOrigin =
  | 'SOURCE_HEADING' // the document's own heading / section title (kept verbatim)
  | 'AI_INFERRED' // a study topic Riishe identified inside a source section

/** Where the title wording was found. */
export type TitleSource = 'toc' | 'body' | 'inferred'

export interface AnalyzedTopic {
  /** Canonical title — for SOURCE_HEADING topics this is the document's own wording, never renamed */
  name: string
  subtopics: string[]
  /** Physical PDF pages (1-based), verified against the extracted page text */
  pages: number[]
  // ── v2 fields (pipelineVersion ≥ 2) ──
  /** Stable id within the analysis (t1, t2 …) for parent links */
  id?: string
  /** 1 = major section of the document (or unparented inferred topic), 2 = study topic under a section */
  level?: 1 | 2
  /** id of the containing source-section topic, when the document has that structure */
  parentId?: string | null
  /** Duplicate variants merged into this canonical topic (wording differences) */
  aliases?: string[]
  /** Printed page labels (e.g. "13") when the document's printed numbering was reliably detected */
  printedPages?: string[]
  /** false when no claimed page could be verified against the page text */
  pageVerified?: boolean
  // ── v4 fields ──
  /** SOURCE_HEADING = original document structure; AI_INFERRED = Riishe's study layer */
  origin?: TopicOrigin
  /** where the title wording came from: the contents table, the document body, or model inference */
  titleSource?: TitleSource
  /** the document's own section number exactly as printed ("Chapter-4", "Appendix VII", "4.3", "II") */
  numbering?: string | null
  /** printed page the contents table claims for this section (null when absent/unmatched) */
  tocPrintedPage?: number | null
  /** physical page where the contents claim was matched in the body (null = unmatched) */
  tocMatchPage?: number | null
  /** when false for a SOURCE_HEADING topic, no body page could confirm the title (e.g. unreadable pages) */
  structureVerified?: boolean
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

/** One entry of the document's own table of contents (original wording kept). */
export interface StructureTocEntry {
  /** exactly as printed in the contents table (row number stripped for matching, kept in `number`) */
  title: string
  /** the document's own row number / numeral ("Chapter-4", "1.1", "VII") when present */
  number: string | null
  /** printed page (or start of range) the entry claims */
  printedPage: number | null
  /** physical PDF page = printedPage + detected offset (null when no offset was provable) */
  physicalPage: number | null
  /** 1 = major entry, 2 = numbered subsection (x.y) */
  level: 1 | 2
  /** a body page was found that carries this entry's words */
  matched: boolean
  /** physical page where the match was found (null when unmatched) */
  matchPage: number | null
  /** honest note when unmatched or unverifiable (e.g. claimed page is image-only) */
  note?: string
}

/** A heading found in the document body (original wording kept). */
export interface StructureHeading {
  title: string
  page: number
  level: 1 | 2
  /** the same title also appears in the validated contents table */
  fromToc: boolean
}

export interface DocStructureInfo {
  kind: 'TOC_GUIDED' | 'HEADING_GUIDED' | 'QUESTION_PAPER' | 'UNSTRUCTURED'
  tocValidated: boolean
  tocEntries: number
  headingCount: number
  /** physical = printed + offset (null when no consistent numbering found) */
  printedPageOffset: number | null
  printedRomanFrontMatter: boolean
  // ── v4: the original-structure layer ──
  /** the document's own contents entries with match status (capped, document order) */
  toc?: StructureTocEntry[]
  /** headings found in the body text (capped, document order) */
  headings?: StructureHeading[]
  /** how many contents entries matched a body page */
  tocMatched?: number
  /** contents entries that could NOT be matched to the body (recorded, never silently dropped) */
  tocUnmatched?: number
  /** detected printed label per physical page ("5", "ii" …) — only pages where a label was actually read */
  printedLabels?: Record<string, string>
  /** which pages carry the document's own contents table */
  tocPages?: number[]
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
