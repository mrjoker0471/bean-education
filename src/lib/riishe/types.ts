// ─── Riishe backend types (mirrored for the client in src/lib/types.ts) ──────

// v5: structural honesty upgrade — the document's own organisation is grouped
// (front matter / main chapters / appendices / other) and every contents entry
// stores its boundary evidence (start + end page, printed range, verification
// status). Topic chips carry an item CLASS so keywords can never masquerade as
// official headings, and page references for source headings come from the
// section's own validated span, not from model-claimed subsets.
// v6: study-note grounding upgrade — every key fact and formula carries the
// page it was read from plus a deterministic verification status; formulas are
// transcribed verbatim (the document's own symbols and typos preserved) or
// flagged NEEDS_REVIEW; content-filter-refused reference lists are recovered
// by deterministic extraction; "complete" means CONTENT-analysis completeness
// (pages awaiting OCR or skipped meaningful content block it) and page
// accounting is reported as its own flag.
// v7: whole-section list completeness — a section long enough to be split
// into several analysis units may have only SOME units refused and recovered;
// the recovered list is re-parsed over the topic's ENTIRE page span so the
// stored entries never stop at the first refused chunk. Equations the PDF
// prints only as an image (a "calculated as:" cue followed by variable
// definitions, with no equation in the text layer) are flagged NEEDS_REVIEW
// deterministically instead of being silently absent from the notes.
export const PIPELINE_VERSION = 7

/** What a topic's TITLE represents in the source document. */
export type TopicOrigin =
  | 'SOURCE_HEADING' // the document's own heading / section title (kept verbatim)
  | 'AI_INFERRED' // a study topic Riishe identified inside a source section

/** Where the title wording was found. */
export type TitleSource = 'toc' | 'body' | 'inferred'

/** What kind of item this entry is in the document (v5 classification). */
export type TopicItemClass =
  | 'ORIGINAL_HEADING' // the document's own major heading
  | 'SOURCE_SUBSECTION' // a numbered subsection of the document (x.y)
  | 'LEARNING_TOPIC' // study topic inferred from the content
  | 'KEYWORD' // keyword / entity extracted from the text
  | 'TABLE_OR_LIST' // entry of a table or reference list
  | 'QUESTION_GROUP' // question or question group
  | 'UNCLASSIFIED' // could not be classified — needs review

/** A formula in Riishe's study notes (v6): verbatim transcription + page + verification. */
export interface FormulaNote {
  /** the formula exactly as the document prints it (symbols, brackets and even
   *  the document's own typos preserved) — never a cleaned-up reconstruction */
  text: string
  /** physical PDF page the formula was read from (null when never verified) */
  page: number | null
  /** VERIFIED = the transcription's tokens were found on the cited page of the
   *  extracted text; NEEDS_REVIEW = could not be verified (e.g. the formula is
   *  an embedded image) — flagged for review, never silently trusted */
  status: 'VERIFIED' | 'NEEDS_REVIEW'
  /** why a formula is flagged, or how its page was established */
  note?: string
}

/** One factual claim in Riishe's study notes (v6): page-grounded + typed. */
export interface StudyFact {
  text: string
  /** physical PDF page the fact was read from (null when unverified) */
  page: number | null
  /** verbatim = exact statement/numbers copied from the source;
   *  summary = condensed by Riishe but strictly from the source text */
  kind?: 'verbatim' | 'summary'
  /** VERIFIED = distinctive tokens of the fact appear on the cited page;
   *  UNVERIFIED = no page of the document supports it — flagged, kept visible */
  status: 'VERIFIED' | 'UNVERIFIED'
  /** how the page was established (e.g. corrected from a wrong claim) */
  note?: string
}

/** Deterministic extraction of a reference list (v6) — city rosters, fee
 *  tables, abbreviation lists — recovered straight from the PDF text layer
 *  when the AI provider refuses the raw text. Entries are verbatim, source
 *  order preserved, geographical grouping kept when the source prints it. */
export interface ListExtraction {
  /** the table's own header row, exactly as printed (when detected) */
  header: string | null
  /** entries grouped as the source groups them (consecutive repeated labels);
   *  label null = the source prints no separable group label on the row */
  groups: { label: string | null; entries: string[] }[]
  totalEntries: number
  /** rows that carry a code-like token but could not be parsed — reported, never dropped silently */
  unreadableRows: string[]
  /** serial-number continuity check ("rows 24-26 missing") when the source numbers its rows */
  serialGaps: string[]
}

/** How a page mapping was established (v5). */
export type PageMappingStatus =
  | 'VERIFIED' // body text confirms the claimed page
  | 'INFERRED' // derived from the contents claim / offset, not body-confirmed
  | 'UNRESOLVED' // no plausible physical page could be established

/** Which part of the document's own organisation an entry belongs to (v5). */
export type StructureGroup = 'FRONT' | 'CHAPTER' | 'APPENDIX' | 'OTHER'

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
  // ── v5 fields ──
  /** what this item is: official heading, source subsection, inferred topic, keyword… */
  itemClass?: TopicItemClass
  /** part of the document's organisation: front matter, main chapters, appendices, other */
  group?: StructureGroup
  /** how the page mapping was established for a SOURCE_HEADING topic */
  pageMapping?: PageMappingStatus
  /** the evidence that established this section's boundaries (human-readable, from the contents row/body) */
  boundaryEvidence?: string
  /** printed end page claimed by the contents row ("18-20" → 20), when the row carried a range */
  tocPrintedEndPage?: number | null
  /** v6: a reference list deterministically recovered from this topic's pages */
  list?: ListExtraction
}

export interface CoverageMetrics {
  totalPages: number
  readablePages: number
  /** image-only pages OCR would be needed for */
  scannedPages: number
  /** pages whose extracted text is ONLY running headers/footers — the real
   *  content is an image (form facsimiles, Gazette reprints). They are
   *  extracted but carry no analysable content; counted separately so they
   *  are neither "readable content" nor silently folded into success. */
  contentlessPages?: number
  /** readable pages inside units that were analysed successfully */
  analysedPages: number
  /** readable pages not covered by any successful unit (failed or pending) */
  unanalysedPages: number
  /** readable pages in units deterministically skipped WITH a recorded reason
   *  (e.g. the provider's safety filter refuses dense name lists) — terminal,
   *  never retried silently, always disclosed */
  skippedPages: number
  /** the physical pages inside skipped units — the UI lists them exactly (v6) */
  skippedPageNumbers?: number[]
  /** the physical pages that are image-only (no text layer) — listed exactly (v6) */
  scannedPageNumbers?: number[]
  /** pages whose content was recovered by DETERMINISTIC extraction (the AI
   *  provider refused the raw text) — analysed, but by a different method,
   *  disclosed rather than blended into the AI-analysis number (v6) */
  deterministicPages?: number
  deterministicUnits?: number
  /** pages that exist in the PDF but could not be read by the extractor at all
   *  (a renderer error) — kept distinct from image-only pages */
  failedExtractionPages: number
  /** pages beyond the extraction safety cap that were never read — always
   *  disclosed; a document larger than the cap can never count as complete */
  notExtractedPages: number
  unitsTotal: number
  unitsOk: number
  unitsFailed: number
  unitsSkipped: number
  /** CONTENT-analysis completeness (v6): true only when every page carrying
   *  meaningful content was actually analysed — no skipped pages, no pages
   *  awaiting OCR (image-only or image-content), no failed units, no
   *  extraction failures, nothing unread. Pages verified to carry NO content
   *  (blank/decorative: furniture text and no image plates) do not block it.
   *  Page ACCOUNTING completeness is the separate flag below. */
  complete: boolean
  /** true when every physical page 1..N sits in exactly one explicit bucket
   *  (analysed / pending / skipped / image-only / image-content /
   *  verified-non-content / extraction-failure / never-read) — reported
   *  separately from content-analysis completeness (v6) */
  pageAccountingComplete?: boolean
  // ── v5: contents-entry matching accounting (kept beside page coverage so a
  // "matched" count can never be mistaken for full-analysis evidence) ──
  /** contents entries discovered in the document's own contents table */
  tocDiscovered?: number
  /** entries whose words/heading line were found in the body */
  tocMatchedHeadings?: number
  /** matched entries whose START page is confirmed at the claimed physical page */
  tocVerifiedStarts?: number
  /** matched entries whose start could only be inferred (offset/claim, no body hit) */
  tocInferredStarts?: number
  /** entries with no plausible physical page at all */
  tocUnresolved?: number
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
  /** v6: how this section was analysed — AI (default) or DETERMINISTIC
   *  (the provider refused the text; a reference-list parser recovered the
   *  entries straight from the PDF text layer). Disclosed, never blended. */
  method?: 'AI' | 'DETERMINISTIC'
  /** human-readable note for non-standard processing (e.g. deterministic recovery) */
  note?: string
}

/** One entry of the document's own table of contents (original wording kept). */
export interface StructureTocEntry {
  /** exactly as printed in the contents table (row number stripped for matching, kept in `number`) */
  title: string
  /** the document's own row number / numeral ("Chapter-4", "1.1", "VII") when present */
  number: string | null
  /** printed page (or start of range) the entry claims */
  printedPage: number | null
  /** printed END page when the contents row carries a range ("18-20" → 20) */
  printedPageEnd?: number | null
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
  // ── v5: group + boundary evidence ──
  /** part of the document's organisation this entry belongs to */
  group?: StructureGroup
  /** physical page the contents ROW itself was parsed from (evidence provenance) */
  tocPage?: number | null
  /** verified/inferred start page used for the section span (matchPage ?? physicalPage) */
  startPage?: number | null
  /** physical end page of the section (contents range end or next entry's start − 1) */
  endPage?: number | null
  /** how the START page was established */
  startStatus?: PageMappingStatus
  /** how the END boundary was established */
  boundaryStatus?: PageMappingStatus
  /** human-readable evidence for the boundaries ("contents row prints 18-20", "next entry starts at physical 22"…) */
  boundaryEvidence?: string
  /** number of body pages carrying this entry's words (duplicate-heading detection) */
  occurrences?: number
  /** v6: a reference list deterministically recovered from this entry's pages */
  list?: ListExtraction
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
  // ── v5: grouping + honest page accounting ──
  /** physical pages whose extracted text is only running headers/footers
   *  (image-like content: form facsimiles, Gazette reprints). Evidence list —
   *  they stay accounted, never hidden inside a success count. */
  contentlessPages?: number[]
  /** v6: the furniture-text pages that DO paint image plates — their real
   *  content is an image awaiting OCR (they block "fully analysed") */
  imageContentPages?: number[]
  /** v6: the furniture-text pages with NO images — verified blank/decorative
   *  (they do not block "fully analysed") */
  nonContentPages?: number[]
  /** per-group processing accounting over the contents entries
   *  (an entry is OK when every page of its span sits in a successful unit;
   *  notAnalysable = the span holds no analysable content at all — image-only) */
  groupStats?: { group: StructureGroup; total: number; ok: number; partial: number; failed: number; notAnalysable: number }[]
}

export interface DocumentAnalysis {
  title: string
  summary: string
  topics: AnalyzedTopic[]
  definitions: { term: string; meaning: string; page: number }[]
  /** v6: page-grounded, verification-statused factual claims (was string[]) */
  keyFacts: StudyFact[]
  /** v6: verbatim formula transcriptions with page + status (was string[]) */
  formulas: FormulaNote[]
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

// ─── Scoring ───────────────────────────────────────────────────────────────────
// Practice tests are scored exactly as the student chose. 'EXAM_PATTERN' is
// only ever set from a VERIFIED catalogue pattern row (see exam-pattern.ts) —
// it is practice scoring labelled with its source, never an official result.

export type ScoringModel = 'CUSTOM' | 'EXAM_PATTERN'

export interface ScoringConfig {
  timed: boolean
  /** 0 = untimed */
  durationMin: number
  marksPerQuestion: number
  negativeMark: number
  scoringModel: ScoringModel
  /** Human-readable provenance for EXAM_PATTERN scoring. */
  patternLabel?: string
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
