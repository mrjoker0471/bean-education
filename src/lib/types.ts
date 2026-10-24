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
}

export interface StagePatternDTO {
  durationMin: number
  totalQuestions: number
  totalMarks: number
  negativeMark: number
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
}

export interface ExamDetailDTO {
  exam: ExamListItem
  stages: StageNode[]
  templates: TestTemplateDTO[]
  examResources: ResourceDTO[]
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
  config: { count: number; durationMin: number; marksPerQuestion: number; negativeMark: number }
  serverNow: number
  endsAt: number
  answeredCount: number
  questions: AttemptQuestionDTO[] // no correctIndex while in progress
}

export interface AttemptReviewQuestionDTO extends AttemptQuestionDTO {
  selectedIndex: number | null
  correctIndex: number
  explanation: string
  isCorrect: boolean
}

export interface AttemptResultDTO {
  id: string
  title: string
  examLabel: string
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
}

export interface BeanSettings {
  style: 'exam-focused' | 'simple' | 'detailed'
  showSourceContext: boolean
}
