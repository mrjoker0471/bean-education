// Shared API/response types used by both API routes and SPA views.

export interface CategoryDTO {
  id: string
  slug: string
  name: string
  description: string | null
  examCount: number
}

export interface ExamListItem {
  id: string
  slug: string
  name: string
  shortName: string | null
  authority: string
  categorySlug: string
  categoryName?: string | null
  state: string | null
  description: string
  featured: boolean
  syllabusStatus: 'VERIFIED' | 'PARTIAL' | 'UNVERIFIED'
  contentNote: string | null
  sourceRefs: { label: string; url: string }[] | null
  counts: {
    topics: number
    notes: number
    questions: number
    resources: number
    tests: number
  }
  questionSources?: { ORIGINAL: number; PYQ_VERIFIED: number; PYQ_UNVERIFIED: number }
}

export interface StagePatternDTO {
  durationMin: number
  totalQuestions: number
  totalMarks: number
  negativeMark: number
  marksPerQuestion?: number // marks per correct answer (default 1) — e.g. CUET UG: 5
  qualifying?: string
  sections: { name: string; questions: number; marks: number; durationMin?: number }[]
}

export interface TopicNode {
  id: string
  slug: string
  name: string
  order: number
  canonicalSlug: string | null
  noteAvailable: boolean
  questionCount: number
  resourceCount: number
}

export interface UnitNode {
  id: string
  slug: string
  name: string
  order: number
  topics: TopicNode[]
}

export interface SubjectNode {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  order: number
  units: UnitNode[]
  topicCount: number
  noteCount: number
  questionCount: number
}

export interface StageNode {
  id: string
  slug: string
  name: string
  order: number
  paperNote: string | null
  pattern: StagePatternDTO | null
  subjects: SubjectNode[]
}

export interface TestTemplateDTO {
  id: string
  slug: string
  title: string
  description: string
  type: string
  stageName?: string | null
  subjectName?: string | null
  config: { count: number; durationMin: number; marksPerQuestion: number; negativeMark: number }
}

export interface ResourceDTO {
  id: string
  title: string
  provider: string
  type: string
  url: string
  language: string
  accessType: string
  verificationStatus: 'VERIFIED' | 'UNREACHABLE' | 'PENDING_REVIEW' | 'PAID'
  lastChecked: string | null
  attribution: string | null
  note: string | null
  fileKind: 'PORTAL' | 'WEBPAGE' | 'PDF' | null
  docDate: string | null
}

export interface ExamDetailDTO {
  exam: ExamListItem
  stages: StageNode[]
  templates: TestTemplateDTO[]
  examResources: ResourceDTO[]
}

/** Everything the integrated PDF viewer needs about one document. */
export interface ResourceMetaDTO {
  resource: ResourceDTO
  context: {
    /** Where "Back" should lead: the exam's Study Material tab or the topic workspace. */
    origin: 'exam' | 'topic' | 'none'
    examSlug: string | null
    examName: string | null
    examShortName: string | null
    authority: string | null
    stageName: string | null
    subjectName: string | null
    topicId: string | null
    topicName: string | null
  }
}

export interface NoteDTO {
  title: string
  markdown: string
  version: string
  updatedAt: string
  sourceRefs: { label: string; url: string }[] | null
}

export interface TopicDetailDTO {
  topic: {
    id: string
    name: string
    slug: string
    description: string | null
    canonicalSlug: string | null
  }
  breadcrumbs: { label: string; href: string }[]
  exam: { slug: string; name: string; shortName: string | null; syllabusStatus: string; contentNote: string | null } | null
  subject: { id: string; name: string } | null
  siblings: { id: string; name: string }[]
  note: NoteDTO | null
  resources: ResourceDTO[]
  questionCount: number
  hasTest: boolean
}

// ─── Test engine ───
export interface AttemptQuestionDTO {
  id: string
  text: string
  options: string[]
  topicName?: string
}

export interface AttemptStateDTO {
  id: string
  title: string
  examLabel: string
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT' | 'ABANDONED'
  source: 'BANK' | 'RIISHE'
  documentId: string | null
  riisheTestId: string | null
  config: { count: number; durationMin: number; marksPerQuestion: number; negativeMark: number }
  serverNow: number
  endsAt: number
  answeredCount: number
  savedAnswers: Record<string, number> // refresh-safe resume
  questions: AttemptQuestionDTO[] // no correctIndex while in progress
}

export interface AttemptReviewQuestionDTO extends AttemptQuestionDTO {
  selectedIndex: number | null
  correctIndex: number
  explanation: string
  isCorrect: boolean
  topicId?: string | null
  sourceType?: 'ORIGINAL' | 'PYQ_VERIFIED' | 'PYQ_UNVERIFIED'
  sourcePaper?: string | null
  year?: number | null
  // Riishe question provenance (source === 'RIISHE')
  category?: 'FOUNDATION' | 'APPLICATION' | 'STATEMENT' | 'MULTISTEP' | 'MISCONCEPTION'
  pageRefs?: number[]
  evidence?: string | null
}

export interface AttemptResultDTO {
  id: string
  title: string
  examLabel: string
  examSlug: string | null
  source: 'BANK' | 'RIISHE'
  documentId: string | null
  riisheTestId: string | null
  status: 'SUBMITTED' | 'TIMED_OUT'
  config: { count: number; durationMin: number; marksPerQuestion: number; negativeMark: number }
  score: number
  maxScore: number
  correctCount: number
  wrongCount: number
  skippedCount: number
  timeSpentSec: number
  perTopic: { topicId: string; name: string; correct: number; total: number }[]
  questions: AttemptReviewQuestionDTO[]
}

export interface RevisionCheckDTO {
  count: number
  ready: boolean // count >= 4 → a revision test can be built
}

export interface ProgressDTO {
  totals: { attempts: number; questionsAnswered: number; accuracy: number; timeSpentMin: number }
  weakTopics: { topicId: string; name: string; examSlug: string | null; examName: string; accuracy: number; attempts: number; total: number }[]
  attempts: {
    id: string
    title: string
    examLabel: string
    status: string
    score: number | null
    maxScore: number | null
    correctCount: number | null
    total: number
    startedAt: string
    submittedAt: string | null
  }[]
}

// ─── BEAN Intelligence ───
export interface BeanChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CatalogResponse {
  categories: { slug: string; name: string; description: string | null; examCount: number }[]
  featured: ExamListItem[]
  totals: { exams: number; topics: number; notes: number; questions: number; resources: number; tests: number; uniqueNotes?: number }
}

export interface BeanContext {
  examSlug?: string
  examName?: string
  stageName?: string
  subjectName?: string
  topicId?: string
  topicName?: string
  noteTitle?: string
  questionText?: string
  questionOptions?: string[]
  attemptSummary?: string
  // Official-document handoff (only set when real text was extracted in the
  // viewer and actually supplied to the model — never a claim to have read a PDF)
  documentTitle?: string
  documentUrl?: string
  documentPagesRead?: string
  documentExcerpt?: string
}

export interface BeanSettings {
  style: 'exam-focused' | 'simple' | 'detailed'
  showSourceContext: boolean
}

// ─── Riishe — uploaded material → AI analysis → validated tests ───

export type MaterialStatus = 'QUEUED' | 'EXTRACTING' | 'ANALYSING' | 'READY' | 'NEEDS_OCR' | 'FAILED'

/** What a topic's title represents in the source document. */
export type TopicOriginDTO = 'SOURCE_HEADING' | 'AI_INFERRED'

export interface AnalyzedTopicDTO {
  name: string
  subtopics: string[]
  pages: number[]
  /** v2 fields — always present after server-side normalization */
  id: string
  level: 1 | 2
  parentId: string | null
  aliases: string[]
  printedPages?: string[]
  pageVerified: boolean
  /** v4 — three-layer separation: the document's own headings vs Riishe's study topics */
  origin?: TopicOriginDTO
  titleSource?: 'toc' | 'body' | 'inferred'
  numbering?: string | null
  tocPrintedPage?: number | null
  tocMatchPage?: number | null
  structureVerified?: boolean
}

export interface CoverageMetricsDTO {
  totalPages: number
  readablePages: number
  scannedPages: number
  analysedPages: number
  unanalysedPages: number
  /** readable pages in sections skipped with a recorded reason (terminal) */
  skippedPages: number
  unitsTotal: number
  unitsOk: number
  unitsFailed: number
  unitsSkipped: number
  complete: boolean
}

export interface SectionOutcomeDTO {
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
export interface StructureTocEntryDTO {
  title: string
  number: string | null
  printedPage: number | null
  physicalPage: number | null
  level: 1 | 2
  matched: boolean
  matchPage: number | null
  note?: string
}

export interface StructureHeadingDTO {
  title: string
  page: number
  level: 1 | 2
  fromToc: boolean
}

export interface DocStructureInfoDTO {
  kind: 'TOC_GUIDED' | 'HEADING_GUIDED' | 'QUESTION_PAPER' | 'UNSTRUCTURED'
  tocValidated: boolean
  tocEntries: number
  headingCount: number
  printedPageOffset: number | null
  printedRomanFrontMatter: boolean
  /** v4 — the original-structure layer */
  toc?: StructureTocEntryDTO[]
  headings?: StructureHeadingDTO[]
  tocMatched?: number
  tocUnmatched?: number
  printedLabels?: Record<string, string>
  tocPages?: number[]
}

export interface DocumentAnalysisDTO {
  title: string
  summary: string
  topics: AnalyzedTopicDTO[]
  definitions: { term: string; meaning: string; page: number }[]
  keyFacts: string[]
  formulas: string[]
  misconceptions: { misconception: string; correction: string; page?: number }[]
  keyPages: number[]
  unreadableSections: string[]
  studyGaps: string[]
  coverageNote: string
  pipelineVersion?: number
  coverage?: CoverageMetricsDTO
  sectionOutcomes?: SectionOutcomeDTO[]
  structure?: DocStructureInfoDTO
}

export interface RiisheTestSummaryDTO {
  id: string
  title: string
  status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'
  questionCount: number
  requestedCount: number
  createdAt: string
}

export interface MaterialListItemDTO {
  id: string
  title: string
  originalName: string
  mimeType: string
  fileSize: number
  pageCount: number | null
  status: MaterialStatus
  statusDetail: string | null
  examLabel: string | null
  subjectLabel: string | null
  topicLabel: string | null
  createdAt: string
  updatedAt: string
  topics: string[]
  tests: RiisheTestSummaryDTO[]
}

export interface MaterialsResponseDTO {
  materials: MaterialListItemDTO[]
  limits: { maxUploadMB: number; supportedTypes: string[] }
}

export interface RiisheTestDetailDTO {
  id: string
  documentId: string
  documentTitle: string
  title: string
  status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'
  statusDetail: string | null
  focusTopics: string[]
  weakFocus: boolean
  requestedCount: number
  config: { timed: boolean; durationMin: number; marksPerQuestion: number; negativeMark: number; scoringModel?: string; patternLabel?: string }
  /** Every source document behind this set (multi-document practice) — primary first. */
  sourceDocuments?: { id: string; title: string; pageCount: number | null }[]
  stats: {
    generated: number
    validated: number
    rejected: number
    byCategory: Record<string, number>
    byDifficulty: { EASY: number; MEDIUM: number; HARD: number }
    llmCalls: number
    batches: number
  } | null
  questionCount: number
  questions: {
    id: string
    order: number
    text: string
    difficulty: string
    category: string
    topic: string | null
    status: string
    pageRefs?: number[]
    documentId?: string
  }[]
  createdAt: string
  updatedAt: string
}

export interface MaterialDetailDTO extends MaterialListItemDTO {
  analysis: DocumentAnalysisDTO | null
  /** Derived from coverage: COMPLETE only when nothing failed or was skipped. */
  analysisState?: 'COMPLETE' | 'PARTIAL' | null
  analysisPct?: number | null
  /** Extraction/analysis coverage accounting (null when not yet known). */
  coverage?: CoverageMetricsDTO | (Partial<CoverageMetricsDTO> & { noTextPages?: number }) | null
  tests: (RiisheTestSummaryDTO & {
    statusDetail: string | null
    focusTopics: string[]
    weakFocus: boolean
    config: { timed: boolean; durationMin: number; marksPerQuestion: number; negativeMark: number }
    stats: RiisheTestDetailDTO['stats']
  })[]
}

export interface RiisheWeakTopicDTO {
  topic: string
  attempted: number
  correct: number
  accuracy: number
  documentId: string | null
  documentTitle: string | null
}

export interface RiisheExplanationPayloadDTO {
  whyWrong: string
  correctReasoning: string
  excerpt: string
  pageRefs: number[]
  concept: string
  misconception: string | null
  revisionTopic: string
  grounding: 'document' | 'external'
}

export interface RiisheExplanationsDTO {
  attemptId: string
  wrongCount: number
  readyCount: number
  failedCount: number
  pending: number
  explanations: Record<string, { status: 'READY' | 'FAILED'; payload: RiisheExplanationPayloadDTO | null }>
}

// ─── Riishe chat (follow-up tutoring, persisted) ───

export type RiisheQuestionCategoryDTO = 'FOUNDATION' | 'APPLICATION' | 'STATEMENT' | 'MULTISTEP' | 'MISCONCEPTION'
/** Back-compat alias used by the shared generator panel. */
export type QuestionCategoryDTO = RiisheQuestionCategoryDTO

/** One verified source behind a chat answer — a document window or a live web result. */
export interface RiisheChatSourceDTO {
  documentId: string
  title: string
  /** [from, to] physical page range (document sources only). */
  pages: number[]
  excerpt: string
  kind?: 'document' | 'web'
  url?: string
  detail?: string
}

export type RiisheGroundingDTO = 'document' | 'mixed' | 'general'

export interface RiisheChatTurnDTO {
  id: string
  role: 'user' | 'assistant'
  content: string
  pagesCited: number[]
  grounding: RiisheGroundingDTO | null
  sources: RiisheChatSourceDTO[]
  createdAt: string
}

export interface RiisheChatResponseDTO {
  reply: string
  pagesCited: number[]
  grounding: RiisheGroundingDTO
  sources: RiisheChatSourceDTO[]
  turnId?: string
}

// ─── Riishe topics browser (aggregated across the library) ───

export interface RiisheTopicDocDTO {
  documentId: string
  documentTitle: string
  pageCount: number | null
  analysisState: 'COMPLETE' | 'PARTIAL'
  analysisPct: number | null
  summary: string | null
  topics: {
    name: string
    subtopics: string[]
    pages: number[]
    origin?: 'SOURCE_HEADING' | 'AI_INFERRED'
  }[]
  definitions: number
  formulas: number
  questionPatterns: string[]
  updatedAt: string
}

export interface RiisheTopicsResponseDTO {
  documents: RiisheTopicDocDTO[]
  totalTopics: number
}
