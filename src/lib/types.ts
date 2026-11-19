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

/** What kind of item this entry is in the document (v5 classification). */
export type TopicItemClassDTO =
  | 'ORIGINAL_HEADING'
  | 'SOURCE_SUBSECTION'
  | 'LEARNING_TOPIC'
  | 'KEYWORD'
  | 'TABLE_OR_LIST'
  | 'QUESTION_GROUP'
  | 'UNCLASSIFIED'

/** How a page mapping was established (v5). */
export type PageMappingStatusDTO = 'VERIFIED' | 'INFERRED' | 'UNRESOLVED'

/** A formula in Riishe's study notes (v6): verbatim transcription + page + verification. */
export interface FormulaNoteDTO {
  text: string
  page: number | null
  status: 'VERIFIED' | 'NEEDS_REVIEW'
  note?: string
}

/** One factual claim in Riishe's study notes (v6): page-grounded + typed. */
export interface StudyFactDTO {
  text: string
  page: number | null
  kind?: 'verbatim' | 'summary'
  status: 'VERIFIED' | 'UNVERIFIED'
  note?: string
}

/** Deterministic recovery of a reference list from the PDF text layer (v6). */
export interface ListExtractionDTO {
  header: string | null
  groups: { label: string | null; entries: string[] }[]
  totalEntries: number
  unreadableRows: string[]
  serialGaps: string[]
}

/** Which part of the document's organisation an entry belongs to (v5). */
export type StructureGroupDTO = 'FRONT' | 'CHAPTER' | 'APPENDIX' | 'OTHER'

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
  /** v5 — classification, grouping and boundary evidence */
  itemClass?: TopicItemClassDTO
  group?: StructureGroupDTO
  pageMapping?: PageMappingStatusDTO
  boundaryEvidence?: string
  tocPrintedEndPage?: number | null
  /** v6 — a reference list deterministically recovered for this topic */
  list?: ListExtractionDTO
}

export interface CoverageMetricsDTO {
  totalPages: number
  readablePages: number
  scannedPages: number
  /** pages whose extracted text is only running headers/footers (image content) */
  contentlessPages?: number
  analysedPages: number
  unanalysedPages: number
  /** readable pages in sections skipped with a recorded reason (terminal) */
  skippedPages: number
  /** the exact physical pages inside skipped sections (v6) */
  skippedPageNumbers?: number[]
  /** the exact physical pages that are image-only (v6) */
  scannedPageNumbers?: number[]
  /** pages recovered by deterministic list extraction (v6) */
  deterministicPages?: number
  deterministicUnits?: number
  /** pages the PDF extractor could not read at all (renderer failure) */
  failedExtractionPages?: number
  /** pages beyond the extraction safety cap that were never read */
  notExtractedPages?: number
  unitsTotal: number
  unitsOk: number
  unitsFailed: number
  unitsSkipped: number
  /** v6 — CONTENT-analysis completeness: no meaningful content remains
   *  unanalysed (no skipped pages, nothing awaiting OCR, no failures).
   *  Page-accounting completeness is the separate flag below. */
  complete: boolean
  /** v6 — every physical page sits in exactly one explicit bucket */
  pageAccountingComplete?: boolean
  /** v5 — contents-entry matching accounting (never a proxy for analysis coverage) */
  tocDiscovered?: number
  tocMatchedHeadings?: number
  tocVerifiedStarts?: number
  tocInferredStarts?: number
  tocUnresolved?: number
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
  /** v6 — how the section was analysed (AI or deterministic recovery) */
  method?: 'AI' | 'DETERMINISTIC'
  note?: string
}

/** One entry of the document's own table of contents (original wording kept). */
export interface StructureTocEntryDTO {
  title: string
  number: string | null
  printedPage: number | null
  printedPageEnd?: number | null
  physicalPage: number | null
  level: 1 | 2
  matched: boolean
  matchPage: number | null
  note?: string
  /** v5 — group + boundary evidence */
  group?: StructureGroupDTO
  tocPage?: number | null
  startPage?: number | null
  endPage?: number | null
  startStatus?: PageMappingStatusDTO
  boundaryStatus?: PageMappingStatusDTO
  boundaryEvidence?: string
  occurrences?: number
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
  /** v5 — grouping + honest page accounting */
  contentlessPages?: number[]
  /** v6 — furniture-text pages that carry image plates (content awaiting OCR) */
  imageContentPages?: number[]
  /** v6 — furniture-text pages verified to have no images (blank/decorative) */
  nonContentPages?: number[]
  groupStats?: { group: StructureGroupDTO; total: number; ok: number; partial: number; failed: number; notAnalysable: number }[]
}

export interface DocumentAnalysisDTO {
  title: string
  summary: string
  topics: AnalyzedTopicDTO[]
  definitions: { term: string; meaning: string; page: number }[]
  keyFacts: StudyFactDTO[]
  formulas: FormulaNoteDTO[]
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

// ─── Student identity (Phase 2A) ──────────────────────────────────────────────

export type LearningLevel =
  | 'SCHOOL_6_8' | 'SCHOOL_9_10' | 'SCHOOL_11_12' | 'UNDERGRAD'
  | 'POSTGRAD' | 'PROFESSIONAL' | 'COMPETITIVE' | 'SKILL'

// Student groups (Phase 2B) — broad onboarding categories, deliberately wider
// than the government-exam catalogue. Values mirror the validated enum in
// /api/student/profile.
export type EducationCategory =
  | 'SCHOOL' | 'COLLEGE' | 'UNIVERSITY' | 'CA_CMA_CS' | 'COMPETITIVE' | 'SKILL' | 'CAREER'

// Preferred learning style (presentation nudges only).
export type LearningStyle = 'CONCEPT_FIRST' | 'PRACTICE_FIRST' | 'VISUAL' | 'REVISE_OFTEN'

export interface AuthedStudent {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  /** 'STUDENT' for normal accounts; PYQ_CURATOR/ADMIN only via operator CLI. */
  role: string
  /** ISO timestamp once onboarding finished; null until then. */
  onboardedAt: string | null
}

export interface GuestClaims {
  attempts: number
  documents: number
  tests: number
  chatTurns: number
}

export interface StudentProfileDTO {
  id: string
  email: string
  displayName: string | null
  learningLevel: string | null
  interests: string[]
  preferences: Record<string, unknown>
  onboardedAt: string | null
}

export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'

export interface GoalDTO {
  id: string
  title: string
  examId: string | null
  topicId: string | null
  targetDate: string | null
  status: GoalStatus
  createdAt: string
  updatedAt: string
  exam: { id: string; slug: string; name: string; shortName: string | null } | null
  topic: { id: string; name: string } | null
}

export interface DashboardDocCard {
  id: string
  title: string
  status: string
  statusDetail: string | null
  updatedAt: string
  pageCount: number | null
  topics: string[]
}

export interface DashboardAttemptCard {
  id: string
  title: string
  examLabel: string
  source: string
  status: string
  score: number | null
  maxScore: number | null
  startedAt: string
  submittedAt: string | null
}

export interface DashboardRecommendation {
  key: string
  title: string
  reason: string
  href: string
}

export interface DashboardResponse {
  profile: StudentProfileDTO
  today: {
    attemptsToday: number
    minutesToday: number | null
    dailyMinutesTarget: number | null
  }
  progress: {
    attempts: {
      count: number
      submitted: number
      accuracy: number | null
      lastActivityAt: string | null
      last7Days: number
    }
    riishe: {
      documents: number
      documentsReady: number
      tests: number
      accuracy: number | null
    }
  }
  continueLearning: {
    recentDocuments: DashboardDocCard[]
    inProgressDocuments: DashboardDocCard[]
    recentAttempts: DashboardAttemptCard[]
    recentTopics: string[]
  }
  goals: {
    active: GoalDTO[]
    completedRecent: GoalDTO[]
    completedCount: number
  }
  recommendations: DashboardRecommendation[]
  generatedAt: string
}

// ─── PYQ curation (Phase 2B — curator/admin only) ────────────────────────────

export type PyqVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'REJECTED'

export interface PyqBatchDTO {
  id: string
  paperTitle: string
  examSlug: string | null
  examLabel: string | null
  stageLabel: string | null
  subjectLabel: string | null
  year: number | null
  session: string | null
  sourceCitation: string | null
  fileName: string
  importedBy: string | null
  totalRows: number
  createdCount: number
  duplicateCount: number
  failedCount: number
  errors: { row: number; error: string }[]
  errorCount: number
  createdAt: string
}

export interface PyqBatchesResponse {
  batches: PyqBatchDTO[]
  count: number
  note?: string
}

export interface PyqQuestionDTO {
  id: string
  text: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: string
  language: string
  verificationStatus: PyqVerificationStatus
  sourceType: string
  sourcePaper: string | null
  year: number | null
  sourceRef: string | null
  canonicalSlug: string
  createdAt: string
  batch: {
    id: string
    paperTitle: string
    fileName: string
    examSlug: string | null
    year: number | null
    session: string | null
    importedBy: string | null
    createdAt: string
  } | null
  review: {
    reviewer: { email: string; displayName: string | null; role: string } | null
    reviewedAt: string | null
    reviewNote: string | null
  }
}

export interface PyqQuestionsResponse {
  questions: PyqQuestionDTO[]
  total: number
  counts: { UNVERIFIED: number; VERIFIED: number; REJECTED: number }
}

export interface PyqImportResult {
  batchId: string
  totalRows: number
  createdCount: number
  duplicateCount: number
  failedCount: number
  errors: { row: number; error: string }[]
}

// ─── BEAN Teach (Phase 4A): teacher marketplace — free pilot foundation ──────

export type TeachVerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type TeachClassStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED'
export type TeachBookingStatus = 'CONFIRMED' | 'CANCELLED' | 'ATTENDED' | 'NO_SHOW'

/** Append-only review/audit trail entry (teacher review, class cancel, attendance). */
export interface TeachAuditEventDTO {
  id: string
  action: string // SUBMIT | RESUBMIT | EDIT_REVIEW | APPROVE | REJECT | PUBLISH_TOGGLE | CLASS_CANCELLED | ATTENDANCE_MARKED
  detail: string | null
  actorRole: string
  createdAt: string
}

/** The applicant's own view of their teacher application (NOT_APPLIED = null). */
export interface TeachApplicationDTO {
  id: string
  status: TeachVerificationStatus
  isPublished: boolean
  teachingName: string
  headline: string
  bio: string
  subjects: string[]
  levels: string[]
  languages: string[]
  qualificationsText: string
  experienceYears: number
  portfolioUrl: string | null
  reviewNote: string | null
  reviewedAt: string | null
  history: TeachAuditEventDTO[]
  canCreateClasses: boolean
  createdAt: string
  updatedAt: string
}

export interface TeachApplicationResponse {
  application: TeachApplicationDTO | null
}

/** Public teacher profile — approved fields only, never email/contact details. */
export interface PublicTeacherDTO {
  id: string
  teachingName: string
  headline: string
  bio: string
  subjects: string[]
  levels: string[]
  languages: string[]
  experienceYears: number
  portfolioUrl: string | null
  classCount: number
  memberSince: string
  /** Phase 6 verified quality metrics (server-computed; absent fields = insufficient sample). */
  quality?: PublicQualityDTO
}

export interface PublicTeacherDetailDTO extends PublicTeacherDTO {
  qualificationsText: string
}

export interface PublicClassDTO {
  id: string
  title: string
  description: string
  subject: string
  targetLevel: string
  language: string
  durationMinutes: number
  startsAt: string
  timeZone: string
  capacity: number
  bookedCount: number
  availableSeats: number
  minimumStudents: number
  /** Planned future price in paise — metadata only, never charged in the pilot. */
  plannedPricePaise: number
  status: TeachClassStatus
  /** Phase 7: PUBLIC | ORGANIZATION | GROUP — private institution classes. */
  audience: string
  teacher: { id: string; teachingName: string; headline: string }
  createdAt: string
}

export interface TeachClassDetailDTO extends PublicClassDTO {
  teacherQualifications: string
  teacherExperienceYears: number
  teacherVerified: boolean
  /** Phase 6: server-computed verified quality metrics for the teacher. */
  teacherQuality: PublicQualityDTO
  isOwner: boolean
  myBooking: MyBookingDTO | null
  /** Owner-only: enrolled students (display names — never emails). */
  ownerBookings: TeachOwnerBookingDTO[]
}

export interface TeachOwnerBookingDTO {
  id: string
  /** Internal student id — owner-only, used to match verified live evidence. */
  studentId: string
  status: TeachBookingStatus
  bookedAt: string
  cancelledAt: string | null
  attendanceMarkedAt: string | null
  studentName: string | null
}

export interface MyBookingDTO {
  id: string
  status: TeachBookingStatus
  bookedAt: string
  cancelledAt: string | null
  attendanceMarkedAt: string | null
  classSession: {
    id: string
    title: string
    subject: string
    startsAt: string
    durationMinutes: number
    timeZone: string
    language: string
    targetLevel: string
    status: TeachClassStatus
    teacherName: string
  }
}

export interface TeachClassesResponse {
  classes: PublicClassDTO[]
  total: number
  page: number
  pageSize: number
}

export interface TeachTeachersResponse {
  teachers: PublicTeacherDTO[]
  total: number
  page: number
  pageSize: number
}

export interface TeacherDetailResponse {
  teacher: PublicTeacherDetailDTO
  classes: PublicClassDTO[]
}

export interface MyBookingsResponse {
  bookings: MyBookingDTO[]
}

export interface MyClassDTO extends PublicClassDTO {
  /** Owner-only: enrolled students (display names — never emails). */
  bookings: TeachOwnerBookingDTO[]
}

export interface MyClassesResponse {
  classes: MyClassDTO[]
}

/** Admin view of an application — full details + applicant account basics. */
export interface AdminTeachApplicationDTO {
  id: string
  verificationStatus: TeachVerificationStatus
  isPublished: boolean
  teachingName: string
  headline: string
  bio: string
  subjects: string[]
  levels: string[]
  languages: string[]
  qualificationsText: string
  experienceYears: number
  portfolioUrl: string | null
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
  applicant: { displayName: string | null; email: string; learningLevel: string | null }
  history: TeachAuditEventDTO[]
}

export interface AdminTeachApplicationsResponse {
  applications: AdminTeachApplicationDTO[]
  total: number
  page: number
  pageSize: number
}

// ─── BEAN Live Classroom (Phase 5): client-safe DTOs ─────────────────────────
// No LiveKit types are imported here — the browser speaks only these shapes.

export type LiveSessionState = 'NOT_STARTED' | 'LIVE' | 'ENDED' | 'FAILED' | 'INTERRUPTED' | 'READY'
export type LiveConfigStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'CONNECTION_ERROR' | 'AVAILABLE'

export interface LiveStatusDTO {
  classId: string
  liveState: LiveSessionState
  scheduledStart: string
  scheduledEnd: string
  windowOpens: string
  windowCloses: string
  /** Present only while LIVE — a count, never identities. */
  participantCount: number | null
  mayJoin: boolean
  joinBlockReason: string | null
  configurationStatus: LiveConfigStatus
}

export interface LiveStatusResponse {
  status: LiveStatusDTO
}

export interface LiveStartResponse {
  live: {
    id: string
    status: string
    startedAt: string | null
    reservedParticipantMinutes?: number
  }
  alreadyLive?: boolean
  room?: { maxParticipants: number; emptyTimeoutSeconds: number }
}

export interface LiveTokenResponse {
  token: string
  wsUrl: string
  room: { name: string; classTitle: string }
  participant: { identity: string; displayName: string; role: 'TEACHER' | 'STUDENT' }
  expiresInSeconds: number
}

export interface LiveEndResponse {
  live: {
    id: string
    status: string
    endedAt: string | null
    actualParticipantMinutes: number | null
  }
  alreadyEnded?: boolean
}

/** Verified live attendance evidence shown to the owner teacher. */
export interface LiveEvidenceDTO {
  studentId: string
  displayName: string | null
  bookingStatus: string
  firstJoinedAt: string | null
  lastLeftAt: string | null
  totalConnectedSeconds: number
  reconnectCount: number
  currentlyConnected: boolean
  suggestedAttendance: 'ATTENDED' | 'NO_SHOW' | null
}

export interface LiveAttendanceResponse {
  attendance: LiveEvidenceDTO[]
  liveSession: { status: string; startedAt: string | null; endedAt: string | null } | null
  note: string
}

/** Whiteboard snapshot shapes (mirrors the WB protocol, client-safe). */
export interface WBStrokeDTO {
  id: string
  mode: 'pen' | 'eraser'
  color: string
  size: number
  points: [number, number][]
}

export interface WBSnapshotDTO {
  v: 1
  strokes: WBStrokeDTO[]
}

export interface LiveWhiteboardResponse {
  snapshot: WBSnapshotDTO | null
  version: number
  updatedAt?: string
}

// ─── BEAN Trust & Quality (Phase 6): verified reviews, complaints, appeals ───

export interface PublicReviewDTO {
  id: string
  rating: number
  title: string | null
  reviewText: string
  createdAt: string
  editedAt: string | null
  reviewer: { label: string; displayName: string | null }
  response: { responseText: string; createdAt: string; editedAt: string | null } | null
  ownStatus?: 'PUBLISHED' | 'FLAGGED' | 'HIDDEN'
  ownModerationReason?: string | null
  canEdit?: boolean
}

export interface PublicQualityDTO {
  averageRating: number | null
  reviewCount: number
  completedClasses: number
  completionRate: number | null
  publishedClasses: number
  sampleSufficient: boolean
}

export interface ClassReviewsResponse {
  reviews: PublicReviewDTO[]
  /** The requesting student's own eligible booking for this class (to render the composer). */
  myEligibility: { canReview: boolean; bookingId?: string; reason?: string }
}

export interface ReviewCreateResponse {
  review: PublicReviewDTO
}

export interface TeacherResponseDTO {
  id: string
  reviewId: string
  responseText: string
  createdAt: string
  editedAt: string | null
}

export interface ComplaintEventDTO {
  id: string
  action: string
  detail: string | null
  actorRole: string
  createdAt: string
}

export interface OwnComplaintDTO {
  id: string
  category: string
  severity: string
  isSensitive: boolean
  subject: string
  description: string
  status: string
  classSessionId: string | null
  classTitle: string | null
  createdAt: string
  resolvedAt: string | null
  events: ComplaintEventDTO[]
}

export interface MyReportsResponse {
  complaints: OwnComplaintDTO[]
  appeals: OwnAppealDTO[]
}

export interface OwnAppealDTO {
  id: string
  targetType: string
  targetId: string
  reason: string
  status: string
  decision: string | null
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
  events: ComplaintEventDTO[]
}

export interface TeacherTrustSummaryResponse {
  quality: PublicQualityDTO
  recentReviews: PublicReviewDTO[]
  responses: TeacherResponseDTO[]
  /** Anonymous open-complaint count — never complaint content. */
  openComplaintCount: number
  restrictions: { id: string; action: string; reason: string; startsAt: string; endsAt: string | null; isActive: boolean; currentlyEnforced: boolean }[]
  appealStatus: 'NONE' | 'SUBMITTED' | 'UNDER_REVIEW' | 'UPHELD' | 'OVERTURNED' | 'CLOSED'
}

export interface AdminTrustOverviewResponse {
  newComplaints: number
  openInvestigations: number
  sensitiveOpen: number
  flaggedReviews: number
  hiddenReviews: number
  pendingAppeals: number
  activeRestrictions: number
}

export interface AdminReviewModerationItem {
  id: string
  rating: number
  title: string | null
  reviewText: string
  status: 'PUBLISHED' | 'FLAGGED' | 'HIDDEN'
  createdAt: string
  moderatedAt: string | null
  moderationReason: string | null
  classSession: { id: string; title: string } | null
  teacher: { id: string; teachingName: string } | null
  reviewer: { id: string; displayName: string | null; email: string }
  response: { responseText: string } | null
}

export interface AdminTrustReviewsResponse {
  reviews: AdminReviewModerationItem[]
}

export interface AdminComplaintDTO {
  id: string
  category: string
  severity: string
  isSensitive: boolean
  subject: string
  description: string
  status: string
  classSessionId: string | null
  classTitle: string | null
  createdAt: string
  resolvedAt: string | null
  complainant: { id: string; displayName: string | null; email: string }
  assignedAdminId: string | null
  teacherProfileId: string | null
  classBookingId: string | null
  events: (ComplaintEventDTO & { detailFull: string | null })[]
}

export interface AdminTrustComplaintsResponse {
  complaints: AdminComplaintDTO[]
}

export interface AdminTrustTeacherRow {
  teacherProfileId: string
  teachingName: string
  studentId: string
  verificationStatus: string
  isPublished: boolean
  reviewCount: number
  averageRating: number | null
  openComplaints: number
  totalComplaints: number
  activeRestrictions: string[]
  restrictions: { id: string; action: string; reason: string; startsAt: string; endsAt: string | null; isActive: boolean; currentlyEnforced: boolean }[]
}

export interface AdminTrustTeachersResponse {
  teachers: AdminTrustTeacherRow[]
}

export interface AdminAppealDTO {
  id: string
  targetType: string
  targetId: string
  reason: string
  status: string
  decision: string | null
  decisionNote: string | null
  decidedAt: string | null
  createdAt: string
  appellant: { id: string; displayName: string | null; email: string }
  originalDecisionById: string | null
  assignedReviewerId: string | null
  events: ComplaintEventDTO[]
}

export interface AdminTrustAppealsResponse {
  appeals: AdminAppealDTO[]
}

// ─── Phase 7 — Institution & Career Ecosystem: client DTOs ───────────────────
// Mirrors the server DTOs (src/lib/institution-dto.ts, src/lib/career-dto.ts).
// Privacy: member lists carry displayName only; verification admin notes are
// never sent to clients; snapshots and employer notes never appear in student
// DTOs.

export type OrgRole =
  | 'OWNER'
  | 'ADMIN'
  | 'INSTRUCTOR'
  | 'STAFF'
  | 'LEARNER'
  | 'CAREER_COORDINATOR'
  | 'RECRUITER'

export type OrgMembershipStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'LEFT'

export type OrgVerificationStatus = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'

export interface PublicOrganizationDTO {
  id: string
  name: string
  displayName: string | null
  orgType: string
  description: string | null
  website: string | null
  publicContact: string | null
  country: string | null
  state: string | null
  city: string | null
  slug: string
  logoText: string | null
  verificationStatus: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface OwnOrganizationDTO extends PublicOrganizationDTO {
  rejectionReason: string | null
}

export interface MyMembershipDTO {
  id: string
  role: string
  status: string
}

export interface MyOrganizationsResponse {
  organizations: { organization: PublicOrganizationDTO; membership: MyMembershipDTO }[]
}

export interface OrganizationDetailResponse {
  organization: OwnOrganizationDTO
  membership: MyMembershipDTO | null
}

export interface MemberDTO {
  id: string
  role: string
  status: string
  student: { displayName: string | null }
  joinedAt: string | null
  activatedAt: string | null
  suspendedAt: string | null
  leftAt: string | null
}

export interface OrgMembersResponse {
  members: MemberDTO[]
  counts: { total: number; active: number; pending: number; suspended: number }
}

export interface InvitationDTO {
  id: string
  email: string | null
  intendedRole: string
  expiresAt: string
  maxUses: number | null
  useCount: number
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
  /** Present only in the POST create response — copy-link shown exactly once. */
  rawToken?: string
}

export interface OrgInvitationsResponse {
  invitations: InvitationDTO[]
}

export interface GroupDTO {
  id: string
  name: string
  academicYear: string | null
  programmeLabel: string | null
  batchLabel: string | null
  sectionLabel: string | null
  trackLabel: string | null
  startsAt: string | null
  endsAt: string | null
  capacity: number | null
  status: string
  activeEnrollmentCount: number
  createdAt: string
}

export interface OrgGroupsResponse {
  groups: GroupDTO[]
}

/** One recent audit activity row on the institution dashboard. `summary` is
 *  the audit event's detail string; actor names are display names only. */
export interface OrgRecentActivityItemDTO {
  id: string
  action: string
  entityType: string
  entityId: string
  summary: string | null
  actorRole: string | null
  createdAt: string
  actorDisplayName: string | null
}

export interface OrgDashboardResponse {
  organization: PublicOrganizationDTO
  membership: MyMembershipDTO
  /** Role echo of the caller's organization membership. */
  role: string
  isAdmin: boolean
  /** OWNER | ADMIN | INSTRUCTOR — mirrors ORG_INSTRUCTOR_ROLES server-side. */
  isStaff: boolean
  verification: { status: string; operational: boolean }
  overview: {
    activeMembers: number
    pendingMembers: number
    activeGroups: number
    archivedGroups: number
    upcomingClasses: number
    publishedAssignments: number
    closedAssignments: number
    draftAssignments: number
    openSubmissions: number
    submissionsAwaitingGrading: number
    submissionsGraded: number
    activeAnnouncements: number
    announcementsActive: number
    resourcesTotal: number
    recentActivity: OrgRecentActivityItemDTO[]
  }
}

export interface AssignmentDTO {
  id: string
  groupId: string
  title: string
  instructions: string | null
  subjectLabel: string | null
  submissionType: string
  status: string
  dueAt: string | null
  maxScore: number | null
  publishedAt: string | null
  createdAt: string
}

export interface OrgAssignmentsResponse {
  assignments: AssignmentDTO[]
  viewerRole: string
}

export interface OwnSubmissionDTO {
  id: string
  status: string
  responseText: string | null
  externalLink: string | null
  submittedAt: string | null
  gradeValue: string | null
  teacherFeedback: string | null
  gradedAt: string | null
}

export interface StaffSubmissionDTO extends OwnSubmissionDTO {
  student: { displayName: string | null }
}

export interface AssignmentDetailResponse {
  assignment: AssignmentDTO
  viewerRole: string
  mySubmission?: OwnSubmissionDTO | null
  submissions?: StaffSubmissionDTO[]
}

export interface AnnouncementDTO {
  id: string
  groupId: string | null
  title: string
  body: string
  status: string
  publishedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export interface OrgAnnouncementsResponse {
  announcements: AnnouncementDTO[]
  /** True when the viewer is org staff — DRAFT + ARCHIVED items are included. */
  includeAll: boolean
}

export interface OrgResourceDTO {
  id: string
  groupId: string | null
  title: string
  description: string | null
  url: string
  createdAt: string
}

export interface OrgResourcesResponse {
  resources: OrgResourceDTO[]
}

export interface OrgClassRowDTO {
  id: string
  title: string
  subject: string
  startsAt: string
  durationMinutes: number
  audience: string
  organizationGroupId: string | null
  teacherName: string
  status: string
}

export interface OrgClassesResponse {
  classes: OrgClassRowDTO[]
}

export interface InvitationAcceptResponse {
  ok: boolean
  membershipId: string
  organizationName: string
  role: string
  status: string
}

// ─── Phase 7 — Career portfolio & employer exchange (client DTOs) ────────────

export interface CareerProfileClientDTO {
  id: string
  headline: string | null
  summary: string | null
  preferredRoleTypes: string[]
  preferredSkills: string[]
  preferredLocations: string[]
  workModes: string[]
  visibility: string
  publicSlug: string | null
  createdAt: string
  updatedAt: string
}

export interface CareerEligibilityClientDTO {
  status: string
  requestedAt: string | null
  reviewedAt: string | null
  decisionReason: string | null
}

export interface CareerProfileResponse {
  profile: CareerProfileClientDTO
  eligibility: CareerEligibilityClientDTO
}

export interface CareerSkillClientDTO {
  id: string
  skillName: string
  proficiency: string | null
  description: string | null
  verificationLabel: string
  sourceRef: string | null
  position: number
}

export interface CareerProjectClientDTO {
  id: string
  title: string
  description: string | null
  category: string | null
  skillsUsed: string[]
  projectUrl: string | null
  startsAt: string | null
  endsAt: string | null
  visibility: string
  status: string
}

export interface CareerCredentialClientDTO {
  id: string
  credentialName: string
  credentialDescription: string | null
  issuedDate: string
  expiryDate: string | null
  credentialReference: string | null
  status: string
  portfolioShared: boolean
  issuer: { id: string; name: string; displayName: string | null; verificationStatus: string }
}

export interface PublicOpportunityClientDTO {
  id: string
  title: string
  description: string
  responsibilities: string | null
  requiredSkills: string[]
  preferredSkills: string[]
  location: string | null
  workMode: string | null
  opportunityType: string
  compensationDescription: string | null
  applicationDeadline: string | null
  eligibilityDescription: string | null
  status: string
  organization: { id: string; name: string; displayName: string | null; verificationStatus: string; logoText: string | null }
  publishedAt: string | null
}

export interface OpportunitiesBrowseResponse {
  opportunities: PublicOpportunityClientDTO[]
  total: number
  page: number
  pageSize: number
}

export interface OwnApplicationClientDTO {
  id: string
  status: string
  submittedAt: string
  updatedAt: string
  candidateVisibleStatusNote: string | null
  opportunity: { id: string; title: string; opportunityType: string; organizationName: string; applicationDeadline: string | null }
}

export interface MyApplicationsResponse {
  applications: OwnApplicationClientDTO[]
}

export interface EmployerApplicationClientDTO {
  id: string
  status: string
  submittedAt: string
  candidateVisibleStatusNote: string | null
  applicant: {
    headline: string | null
    summary: string | null
    skills: unknown
    projects: unknown
    credentials: unknown
  }
  contact: { email?: string } | null
  employerNotes: string | null
}

export interface EmployerOpportunitiesResponse {
  opportunities: PublicOpportunityClientDTO[]
  counts: { draft: number; pending: number; published: number; closed: number }
}

export interface EmployerApplicantsResponse {
  opportunity: { id: string; title: string }
  applications: EmployerApplicationClientDTO[]
  counts: Record<string, number>
}

export interface DiscoverableCandidateClientDTO {
  headline: string | null
  summaryPreview: string | null
  preferredRoleTypes: string[]
  preferredSkills: string[]
  preferredLocations: string[]
  workModes: string[]
  skills: CareerSkillClientDTO[]
  projects: CareerProjectClientDTO[]
  credentials: CareerCredentialClientDTO[]
  candidateRef: string
}

export interface CandidateSearchResponse {
  candidates: DiscoverableCandidateClientDTO[]
  total: number
  page: number
  pageSize: number
}

export interface OwnSafetyReportDTO {
  id: string
  targetType: string
  targetId: string
  category: string
  subject: string
  status: string
  createdAt: string
  resolutionVisible: string | null
}

export interface AdminOrganizationRow extends PublicOrganizationDTO {
  owner: string | null
  memberCount: number
  groupCount: number
  classCount: number
}

export interface AdminOrganizationsResponse {
  organizations: AdminOrganizationRow[]
  total: number
}

export interface AdminEligibilityRow {
  id: string
  student: { displayName: string | null }
  status: string
  requestedAt: string | null
  reviewedAt: string | null
  decisionReason: string | null
}

export interface AdminEligibilityResponse {
  reviews: AdminEligibilityRow[]
}

export interface AdminCareerReportRow {
  id: string
  reporterId: string
  targetType: string
  targetId: string
  category: string
  subject: string
  description: string
  status: string
  assignedAdminId: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface AdminCareerReportsResponse {
  reports: AdminCareerReportRow[]
  total: number
}
