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
  AdminTeachApplicationsResponse,
  AdminTeachApplicationDTO,
  MyBookingDTO,
  MyBookingsResponse,
  MyClassesResponse,
  PublicClassDTO,
  PublicTeacherDTO,
  TeachApplicationDTO,
  TeachApplicationResponse,
  TeacherDetailResponse,
  TeachClassesResponse,
  TeachClassDetailDTO,
  TeachClassStatus,
  TeachTeachersResponse,
  LiveAttendanceResponse,
  LiveEndResponse,
  LiveStartResponse,
  LiveStatusResponse,
  LiveTokenResponse,
  LiveWhiteboardResponse,
  WBSnapshotDTO,
  ClassReviewsResponse,
  ReviewCreateResponse,
  TeacherResponseDTO,
  MyReportsResponse,
  TeacherTrustSummaryResponse,
  AdminTrustOverviewResponse,
  AdminTrustReviewsResponse,
  AdminTrustComplaintsResponse,
  AdminTrustTeachersResponse,
  AdminTrustAppealsResponse,
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

  // ─── BEAN Teach (Phase 4A): teacher marketplace — free pilot foundation ───
  teachApplication: () => jsonFetch<TeachApplicationResponse>('/api/teach/application'),
  teachSubmitApplication: (body: {
    teachingName: string
    headline: string
    bio: string
    subjects: string[]
    levels: string[]
    languages: string[]
    qualificationsText: string
    experienceYears: number
    portfolioUrl?: string | null
  }) => jsonFetch<{ application: TeachApplicationDTO }>('/api/teach/application', { method: 'POST', body: JSON.stringify(body) }),
  teachUpdateApplication: (patch: Partial<{
    teachingName: string
    headline: string
    bio: string
    subjects: string[]
    levels: string[]
    languages: string[]
    qualificationsText: string
    experienceYears: number
    portfolioUrl: string | null
    isPublished: boolean
  }>) => jsonFetch<{ application: TeachApplicationDTO }>('/api/teach/application', { method: 'PATCH', body: JSON.stringify(patch) }),
  teachTeachers: (opts: { q?: string; subject?: string; level?: string; language?: string; page?: number } = {}) => {
    const p = new URLSearchParams()
    if (opts.q) p.set('q', opts.q)
    if (opts.subject) p.set('subject', opts.subject)
    if (opts.level) p.set('level', opts.level)
    if (opts.language) p.set('language', opts.language)
    if (opts.page) p.set('page', String(opts.page))
    const qs = p.toString()
    return jsonFetch<TeachTeachersResponse>(`/api/teach/teachers${qs ? `?${qs}` : ''}`)
  },
  teachTeacher: (id: string) => jsonFetch<TeacherDetailResponse>(`/api/teach/teachers/${encodeURIComponent(id)}`),
  teachClasses: (
    opts: {
      q?: string
      subject?: string
      level?: string
      language?: string
      teacher?: string
      teacherId?: string
      from?: string
      to?: string
      duration?: 'SHORT' | 'MEDIUM' | 'LONG'
      page?: number
      pageSize?: number
    } = {},
  ) => {
    const p = new URLSearchParams()
    if (opts.q) p.set('q', opts.q)
    if (opts.subject) p.set('subject', opts.subject)
    if (opts.level) p.set('level', opts.level)
    if (opts.language) p.set('language', opts.language)
    if (opts.teacher) p.set('teacher', opts.teacher)
    if (opts.teacherId) p.set('teacherId', opts.teacherId)
    if (opts.from) p.set('from', opts.from)
    if (opts.to) p.set('to', opts.to)
    if (opts.duration) p.set('duration', opts.duration)
    if (opts.page) p.set('page', String(opts.page))
    if (opts.pageSize) p.set('pageSize', String(opts.pageSize))
    const qs = p.toString()
    return jsonFetch<TeachClassesResponse>(`/api/teach/classes${qs ? `?${qs}` : ''}`)
  },
  teachClass: (id: string) => jsonFetch<{ class: TeachClassDetailDTO }>(`/api/teach/classes/${encodeURIComponent(id)}`),
  teachCreateClass: (body: {
    title: string
    description: string
    subject: string
    targetLevel: string
    language: string
    durationMinutes: number
    startsAt: string
    timeZone: string
    capacity: number
    minimumStudents: number
    plannedPricePaise?: number
  }) => jsonFetch<{ class: PublicClassDTO }>('/api/teach/classes', { method: 'POST', body: JSON.stringify(body) }),
  teachUpdateClass: (id: string, patch: Partial<{
    title: string
    description: string
    subject: string
    targetLevel: string
    language: string
    durationMinutes: number
    startsAt: string
    timeZone: string
    capacity: number
    minimumStudents: number
    plannedPricePaise: number
  }>) => jsonFetch<{ class: PublicClassDTO }>(`/api/teach/classes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  teachPublishClass: (id: string) =>
    jsonFetch<{ class: PublicClassDTO }>(`/api/teach/classes/${encodeURIComponent(id)}/publish`, { method: 'POST', body: '{}' }),
  teachUnpublishClass: (id: string) =>
    jsonFetch<{ class: PublicClassDTO }>(`/api/teach/classes/${encodeURIComponent(id)}/unpublish`, { method: 'POST', body: '{}' }),
  teachCancelClass: (id: string) =>
    jsonFetch<{ class: { id: string; status: TeachClassStatus; cancelledAt: string | null; releasedBookings: number } }>(
      `/api/teach/classes/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', body: '{}' },
    ),
  teachBook: (classId: string) =>
    jsonFetch<{ booking: MyBookingDTO }>(`/api/teach/classes/${encodeURIComponent(classId)}/book`, { method: 'POST', body: '{}' }),
  teachCancelBooking: (classId: string) =>
    jsonFetch<{ booking: { id: string; status: string } }>(`/api/teach/classes/${encodeURIComponent(classId)}/book`, { method: 'DELETE' }),
  teachMyBookings: () => jsonFetch<MyBookingsResponse>('/api/teach/my-bookings'),
  teachMyClasses: () => jsonFetch<MyClassesResponse>('/api/teach/my-classes'),
  teachMarkAttendance: (classId: string, bookingId: string, status: 'ATTENDED' | 'NO_SHOW') =>
    jsonFetch<{ booking: { id: string; status: string; attendanceMarkedAt: string | null } }>(
      `/api/teach/classes/${encodeURIComponent(classId)}/attendance`,
      { method: 'POST', body: JSON.stringify({ bookingId, status }) },
    ),
  adminTeachApplications: (opts: { status?: string; q?: string; page?: number } = {}) => {
    const p = new URLSearchParams()
    if (opts.status) p.set('status', opts.status)
    if (opts.q) p.set('q', opts.q)
    if (opts.page) p.set('page', String(opts.page))
    const qs = p.toString()
    return jsonFetch<AdminTeachApplicationsResponse>(`/api/admin/teach/applications${qs ? `?${qs}` : ''}`)
  },
  adminTeachReview: (id: string, body: { action: 'APPROVE' | 'REJECT'; note?: string }) =>
    jsonFetch<{ application: AdminTeachApplicationDTO }>(`/api/admin/teach/applications/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ─── BEAN Live Classroom (Phase 5): realtime class delivery ───
  liveStatus: (classId: string) =>
    jsonFetch<LiveStatusResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/live/status`),
  liveStart: (classId: string) =>
    jsonFetch<LiveStartResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/live/start`, { method: 'POST', body: '{}' }),
  liveToken: (classId: string) =>
    jsonFetch<LiveTokenResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/live/token`, { method: 'POST', body: '{}' }),
  liveEnd: (classId: string) =>
    jsonFetch<LiveEndResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/live/end`, { method: 'POST', body: '{}' }),
  liveModerate: (classId: string, body: { action: 'MUTE_AUDIO' | 'REMOVE_PARTICIPANT'; identity: string; trackSid?: string; reason?: string }) =>
    jsonFetch<{ ok: boolean; action: string }>(`/api/teach/classes/${encodeURIComponent(classId)}/live/moderate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  liveAttendanceEvidence: (classId: string) =>
    jsonFetch<LiveAttendanceResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/live/attendance`),
  liveWhiteboard: (classId: string) =>
    jsonFetch<LiveWhiteboardResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/live/whiteboard`),
  liveSaveWhiteboard: (classId: string, snapshot: WBSnapshotDTO) =>
    jsonFetch<{ ok: boolean; version: number }>(`/api/teach/classes/${encodeURIComponent(classId)}/live/whiteboard`, {
      method: 'POST',
      body: JSON.stringify(snapshot),
    }),

  // ─── BEAN Trust & Quality (Phase 6): reviews, complaints, appeals ───
  classReviews: (classId: string) =>
    jsonFetch<ClassReviewsResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/reviews`),
  createReview: (
    classId: string,
    body: { rating: number; title?: string; reviewText: string; showDisplayName?: boolean },
  ) =>
    jsonFetch<ReviewCreateResponse>(`/api/teach/classes/${encodeURIComponent(classId)}/reviews`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  editReview: (reviewId: string, patch: { rating?: number; title?: string | null; reviewText?: string; showDisplayName?: boolean }) =>
    jsonFetch<ReviewCreateResponse>(`/api/teach/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  respondToReview: (reviewId: string, responseText: string) =>
    jsonFetch<{ response: TeacherResponseDTO }>(`/api/teach/reviews/${encodeURIComponent(reviewId)}/response`, {
      method: 'POST',
      body: JSON.stringify({ responseText }),
    }),
  editReviewResponse: (reviewId: string, responseText: string) =>
    jsonFetch<{ response: TeacherResponseDTO }>(`/api/teach/reviews/${encodeURIComponent(reviewId)}/response`, {
      method: 'PATCH',
      body: JSON.stringify({ responseText }),
    }),
  flagReview: (reviewId: string, reason: string) =>
    jsonFetch<{ ok: boolean; status: string }>(`/api/teach/reviews/${encodeURIComponent(reviewId)}/flag`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  fileComplaint: (body: { category: string; classSessionId?: string; subject: string; description: string }) =>
    jsonFetch<{ complaint: { id: string; status: string; isSensitive: boolean } }>('/api/teach/complaints', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  myReports: () => jsonFetch<MyReportsResponse>('/api/teach/complaints'),
  addComplaintInfo: (id: string, detail: string) =>
    jsonFetch<{ ok: boolean }>(`/api/teach/complaints/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ detail }),
    }),
  fileAppeal: (body: { targetType: string; targetId: string; reason: string }) =>
    jsonFetch<{ appeal: { id: string; status: string } }>('/api/teach/appeals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  teacherTrust: () => jsonFetch<TeacherTrustSummaryResponse>('/api/teach/trust'),

  adminTrustOverview: () => jsonFetch<AdminTrustOverviewResponse>('/api/admin/trust/overview'),
  adminTrustReviews: (filter: 'flagged' | 'hidden' | 'published' | 'all' = 'flagged') =>
    jsonFetch<AdminTrustReviewsResponse>(`/api/admin/trust/reviews?filter=${filter}`),
  adminModerateReview: (reviewId: string, body: { action: 'KEEP_PUBLISHED' | 'HIDE' | 'RESTORE'; reason: string }) =>
    jsonFetch<{ ok: boolean; status: string }>(`/api/admin/trust/reviews/${encodeURIComponent(reviewId)}/moderate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  adminTrustComplaints: (opts: { status?: string; category?: string; severity?: string; q?: string; sensitive?: boolean } = {}) => {
    const p = new URLSearchParams()
    if (opts.status) p.set('status', opts.status)
    if (opts.category) p.set('category', opts.category)
    if (opts.severity) p.set('severity', opts.severity)
    if (opts.q) p.set('q', opts.q)
    if (opts.sensitive) p.set('sensitive', '1')
    const qs = p.toString()
    return jsonFetch<AdminTrustComplaintsResponse>(`/api/admin/trust/complaints${qs ? `?${qs}` : ''}`)
  },
  adminComplaintAction: (
    id: string,
    body: {
      action: 'ACKNOWLEDGE' | 'START_REVIEW' | 'REQUEST_INFO' | 'NOTE' | 'ASSIGN' | 'ESCALATE' | 'RESOLVE' | 'DISMISS'
      note?: string
      assignedAdminId?: string
    },
  ) =>
    jsonFetch<{ ok: boolean; status?: string; unchanged?: boolean }>(
      `/api/admin/trust/complaints/${encodeURIComponent(id)}/action`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  adminTrustTeachers: (q?: string) =>
    jsonFetch<AdminTrustTeachersResponse>(`/api/admin/trust/teachers${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminTrustAction: (teacherProfileId: string, body: { action: string; reason: string; endsAt?: string }) =>
    jsonFetch<{ ok: boolean; id: string; reinstated: number }>(
      `/api/admin/trust/teachers/${encodeURIComponent(teacherProfileId)}/actions`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  adminTrustAppeals: (status?: string) =>
    jsonFetch<AdminTrustAppealsResponse>(`/api/admin/trust/appeals${status ? `?status=${status}` : ''}`),
  adminAppealAction: (
    appealId: string,
    body: { action: 'ASSIGN' | 'DECIDE' | 'CLOSE_WITHOUT_DECISION'; reviewerId?: string; decision?: 'UPHELD' | 'OVERTURNED'; decisionNote?: string },
  ) =>
    jsonFetch<{ ok: boolean; decision?: string }>(
      `/api/admin/trust/appeals/${encodeURIComponent(appealId)}/action`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
}
