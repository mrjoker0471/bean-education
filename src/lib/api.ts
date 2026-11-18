'use client'

import type {
  AttemptResultDTO,
  AttemptStateDTO,
  AuthedStudent,
  BeanChatMessage,
  BeanContext,
  BeanSettings,
  CatalogResponse,
  DashboardResponse,
  EducationCategory,
  ExamDetailDTO,
  ExamListItem,
  GoalDTO,
  GoalStatus,
  GuestClaims,
  LearningLevel,
  LearningStyle,
  MaterialDetailDTO,
  MaterialsResponseDTO,
  ProgressDTO,
  PyqBatchesResponse,
  PyqImportResult,
  PyqQuestionsResponse,
  QuestionCategoryDTO,
  ResourceMetaDTO,
  RevisionCheckDTO,
  RiisheChatResponseDTO,
  RiisheChatTurnDTO,
  RiisheExplanationsDTO,
  RiisheTestDetailDTO,
  RiisheTopicsResponseDTO,
  RiisheWeakTopicDTO,
  StudentProfileDTO,
  TopicDetailDTO,
} from './types'

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch { /* ignore */ }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// ─── Catalogue ───
export const api = {
  catalog: () => jsonFetch<CatalogResponse>('/api/catalog'),

  exams: (opts: { search?: string; category?: string; state?: string; featured?: boolean } = {}) => {
    const p = new URLSearchParams()
    if (opts.search) p.set('search', opts.search)
    if (opts.category) p.set('category', opts.category)
    if (opts.state) p.set('state', opts.state)
    if (opts.featured) p.set('featured', '1')
    return jsonFetch<{ exams: ExamListItem[]; total: number }>(`/api/exams?${p.toString()}`)
  },

  exam: (slug: string) => jsonFetch<ExamDetailDTO>(`/api/exams/${encodeURIComponent(slug)}`),

  topic: (topicId: string) => jsonFetch<TopicDetailDTO>(`/api/topics/${encodeURIComponent(topicId)}`),

  // ─── Integrated PDF viewer ───
  resource: (resourceId: string) =>
    jsonFetch<ResourceMetaDTO>(`/api/resources/${encodeURIComponent(resourceId)}`),

  /** Same-origin proxied PDF (registry-whitelisted). Pass download for a Content-Disposition attachment. */
  pdfStreamUrl: (url: string, download?: string) => {
    const p = new URLSearchParams({ url })
    if (download) p.set('download', download)
    return `/api/pdf?${p.toString()}`
  },

  // ─── Test engine (server-authoritative) ───
  startTest: (body: {
    guestId: string
    templateId?: string
    examId?: string
    subjectId?: string
    topicId?: string
    type?: 'TOPIC' | 'SUBJECT' | 'MIXED' | 'REVISION'
  }) => jsonFetch<{ attemptId: string; url: string }>('/api/tests/start', { method: 'POST', body: JSON.stringify(body) }),

  attemptState: (attemptId: string, guestId: string) =>
    jsonFetch<AttemptStateDTO>(`/api/attempts/${attemptId}?guestId=${encodeURIComponent(guestId)}`),

  submitAttempt: (attemptId: string, guestId: string, answers: Record<string, number>, timeSpentSec: number) =>
    jsonFetch<{ resultUrl: string }>('/api/attempts/' + attemptId, {
      method: 'POST',
      body: JSON.stringify({ guestId, answers, timeSpentSec }),
    }),

  attemptResult: (attemptId: string, guestId: string) =>
    jsonFetch<AttemptResultDTO>(`/api/attempts/${attemptId}/result?guestId=${encodeURIComponent(guestId)}`),

  // ─── Revision (built from this guest's wrong answers in this exam) ───
  revisionCheck: (examId: string, guestId: string) =>
    jsonFetch<RevisionCheckDTO>(`/api/tests/revision-check?examId=${encodeURIComponent(examId)}&guestId=${encodeURIComponent(guestId)}`),

  // ─── Progress ───
  progress: (guestId: string) => jsonFetch<ProgressDTO>(`/api/progress?guestId=${encodeURIComponent(guestId)}`),

  // ─── BEAN Intelligence ───
  beanChat: (body: {
    guestId: string
    messages: BeanChatMessage[]
    context: BeanContext
    settings: BeanSettings
  }) => jsonFetch<{ reply: string; usedContext: string[] }>('/api/bean/chat', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  // ─── Riishe — My Materials ───
  materials: (guestId: string) =>
    jsonFetch<MaterialsResponseDTO>(`/api/materials?guestId=${encodeURIComponent(guestId)}`),

  material: (id: string, guestId: string) =>
    jsonFetch<MaterialDetailDTO>(`/api/materials/${encodeURIComponent(id)}?guestId=${encodeURIComponent(guestId)}`),

  uploadMaterial: (
    guestId: string,
    file: File,
    meta: { title?: string; examLabel?: string; subjectLabel?: string; topicLabel?: string },
    onProgress?: (pct: number) => void,
  ) =>
    new Promise<{ documentId: string; duplicate?: boolean }>((resolve, reject) => {
      const form = new FormData()
      form.set('guestId', guestId)
      form.set('file', file)
      if (meta.title) form.set('title', meta.title)
      if (meta.examLabel) form.set('examLabel', meta.examLabel)
      if (meta.subjectLabel) form.set('subjectLabel', meta.subjectLabel)
      if (meta.topicLabel) form.set('topicLabel', meta.topicLabel)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/materials')
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText) as { documentId?: string; duplicate?: boolean; error?: string }
          if (xhr.status >= 200 && xhr.status < 300 && body.documentId) {
            resolve({ documentId: body.documentId, duplicate: body.duplicate })
          } else {
            reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
          }
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.onabort = () => reject(new Error('Upload cancelled'))
      xhr.send(form)
    }),

  renameMaterial: (id: string, guestId: string, patch: { title?: string; examLabel?: string | null; subjectLabel?: string | null; topicLabel?: string | null }) =>
    jsonFetch<{ ok: boolean }>(`/api/materials/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ guestId, ...patch }),
    }),

  deleteMaterial: (id: string, guestId: string) =>
    jsonFetch<{ ok: boolean }>(`/api/materials/${encodeURIComponent(id)}?guestId=${encodeURIComponent(guestId)}`, {
      method: 'DELETE',
    }),

  retryMaterial: (id: string, guestId: string) =>
    jsonFetch<{ ok: boolean }>(`/api/materials/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ guestId }),
    }),

  /** Re-analyse a READY document: force=true discards the current analysis,
   * force=false retries only failed/incomplete sections. */
  reanalyseMaterial: (id: string, guestId: string, force: boolean) =>
    jsonFetch<{ ok: boolean }>(`/api/materials/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ guestId, force }),
    }),

  /** Same-origin streamed upload file (owner-only; Range-capable for pdf.js). */
  materialFileUrl: (id: string, download?: boolean, guestId?: string) => {
    const p = new URLSearchParams()
    if (guestId) p.set('guestId', guestId)
    if (download) p.set('download', '1')
    return `/api/materials/${encodeURIComponent(id)}/file?${p.toString()}`
  },

  // ─── Riishe — tests ───
  generateRiisheTest: (body: {
    guestId: string
    /** Multi-document practice — every id must belong to the guest. */
    documentIds?: string[]
    /** Single-document (workspace) form. */
    documentId?: string
    focusTopics?: string[]
    weakFocus?: boolean
    timed?: boolean
    /** Explicit per-question timing; 0 = untimed. Default: 1 min/question. */
    durationMin?: number
    count?: number
    difficultyFocus?: 'MIXED' | 'FOUNDATIONAL' | 'INTERMEDIATE' | 'ADVANCED'
    categories?: QuestionCategoryDTO[]
    scoring?: { marksPerQuestion: number; negativeMark: number }
  }) =>
    jsonFetch<{ testId: string; existing?: boolean }>('/api/riishe/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  riisheTest: (id: string, guestId: string) =>
    jsonFetch<RiisheTestDetailDTO>(`/api/riishe/tests/${encodeURIComponent(id)}?guestId=${encodeURIComponent(guestId)}`),

  startRiisheTest: (id: string, guestId: string) =>
    jsonFetch<{ attemptId: string; resumed?: boolean }>(`/api/riishe/tests/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      body: JSON.stringify({ guestId }),
    }),

  riisheWeakTopics: (guestId: string) =>
    jsonFetch<{ weakTopics: RiisheWeakTopicDTO[] }>(`/api/riishe/weak-topics?guestId=${encodeURIComponent(guestId)}`),

  // ─── Riishe — post-exam explanations ───
  requestExplanations: (attemptId: string, guestId: string) =>
    jsonFetch<{ started: boolean; alreadyReady: number }>(`/api/riishe/attempts/${encodeURIComponent(attemptId)}/explain`, {
      method: 'POST',
      body: JSON.stringify({ guestId }),
    }),

  riisheExplanations: (attemptId: string, guestId: string) =>
    jsonFetch<RiisheExplanationsDTO>(`/api/riishe/attempts/${encodeURIComponent(attemptId)}/explanations?guestId=${encodeURIComponent(guestId)}`),

  // ─── Riishe — follow-up chat (persisted, grounded) ───
  riisheChat: (body: {
    guestId: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    documentId?: string
    documentIds?: string[]
    attemptId?: string
    questionId?: string
    topic?: string
    style?: 'exam-focused' | 'simple' | 'detailed'
  }) =>
    jsonFetch<RiisheChatResponseDTO>('/api/riishe/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  riisheChatHistory: (guestId: string, scope: { documentId?: string; attemptId?: string; questionId?: string }) => {
    const p = new URLSearchParams({ guestId })
    if (scope.documentId) p.set('documentId', scope.documentId)
    if (scope.attemptId) p.set('attemptId', scope.attemptId)
    if (scope.questionId) p.set('questionId', scope.questionId)
    return jsonFetch<{ turns: RiisheChatTurnDTO[] }>(`/api/riishe/chat?${p.toString()}`)
  },

  // ─── Riishe — topics discovered across the library ───
  riisheTopics: (guestId: string) =>
    jsonFetch<RiisheTopicsResponseDTO>(`/api/riishe/topics?guestId=${encodeURIComponent(guestId)}`),

  // ─── Account (settings) ───
  deleteAccountData: (guestId: string) =>
    jsonFetch<{ ok: boolean; deleted: { documents: number; tests: number; attempts: number; explanations: number; chatTurns: number; files: number } }>(
      '/api/account',
      { method: 'DELETE', body: JSON.stringify({ guestId }) },
    ),

  // ─── Attempt autosave (refresh-safe) ───
  autosaveAttempt: (attemptId: string, guestId: string, answers: Record<string, number>) =>
    jsonFetch<{ ok: boolean; savedCount?: number }>(`/api/attempts/${encodeURIComponent(attemptId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ guestId, answers }),
    }),

  // ─── Student identity (Phase 2A) ───
  authMe: () => jsonFetch<{ student: AuthedStudent | null }>('/api/auth/me'),
  authRegister: (body: { email: string; password: string; displayName?: string }) =>
    jsonFetch<{ student: AuthedStudent }>('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  authLogin: (body: { email: string; password: string }) =>
    jsonFetch<{ student: AuthedStudent }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  authLogout: () => jsonFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  claimGuest: (guestId: string) =>
    jsonFetch<{ claims: GuestClaims }>('/api/auth/claim-guest', { method: 'POST', body: JSON.stringify({ guestId }) }),
  exportAccount: async (): Promise<void> => {
    const res = await fetch('/api/auth/account/export', { credentials: 'same-origin' })
    if (!res.ok) {
      let message = `Export failed (${res.status})`
      try { const b = await res.json(); if (b?.error) message = b.error } catch { /* ignore */ }
      throw new Error(message)
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bean-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
  deleteStudentAccount: () =>
    jsonFetch<{ ok: boolean }>('/api/auth/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE' }) }),

  // ─── Student profile / goals / dashboard (Phase 2A, extended 2B) ───
  studentProfile: () => jsonFetch<{ student: StudentProfileDTO }>('/api/student/profile'),
  updateStudentProfile: (patch: {
    displayName?: string | null
    learningLevel?: LearningLevel | null
    interests?: string[]
    preferences?: {
      dailyMinutes?: number | null
      language?: string | null
      revisionStyle?: string | null
      goalExam?: string | null
      educationCategory?: EducationCategory | null
      learningStyle?: LearningStyle | null
    }
    onboardingComplete?: boolean
  }) => jsonFetch<{ student: StudentProfileDTO }>('/api/student/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
  studentGoals: () => jsonFetch<{ goals: GoalDTO[] }>('/api/student/goals'),
  createStudentGoal: (body: { title: string; examId?: string; topicId?: string; targetDate?: string }) =>
    jsonFetch<{ goal: GoalDTO }>('/api/student/goals', { method: 'POST', body: JSON.stringify(body) }),
  updateStudentGoal: (id: string, patch: { title?: string; status?: GoalStatus; targetDate?: string | null }) =>
    jsonFetch<{ goal: GoalDTO }>(`/api/student/goals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteStudentGoal: (id: string) =>
    jsonFetch<{ ok: boolean }>(`/api/student/goals/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  studentDashboard: () => jsonFetch<DashboardResponse>('/api/student/dashboard'),

  // ─── PYQ curation (Phase 2B — curator/admin only; server enforces roles) ───
  pyqImport: (body: {
    paperTitle: string
    fileName: string
    examSlug: string
    examLabel?: string
    stageLabel?: string
    subjectLabel?: string
    year?: number
    session?: string
    sourceCitation?: string
    items: Record<string, unknown>[]
  }) => jsonFetch<PyqImportResult>('/api/pyq/import', { method: 'POST', body: JSON.stringify(body) }),
  pyqBatches: () => jsonFetch<PyqBatchesResponse>('/api/pyq/batches'),
  pyqQuestions: (params: { status?: string; exam?: string; year?: number; batch?: string; q?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams()
    if (params.status) p.set('status', params.status)
    if (params.exam) p.set('exam', params.exam)
    if (params.year) p.set('year', String(params.year))
    if (params.batch) p.set('batch', params.batch)
    if (params.q) p.set('q', params.q)
    if (params.limit) p.set('limit', String(params.limit))
    if (params.offset) p.set('offset', String(params.offset))
    const qs = p.toString()
    return jsonFetch<PyqQuestionsResponse>(`/api/pyq/questions${qs ? `?${qs}` : ''}`)
  },
  pyqReview: (body: { questionId: string; action: 'APPROVE' | 'REJECT'; note?: string }) =>
    jsonFetch<{ id: string; sourceType: string; verificationStatus: string }>('/api/pyq/review', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
