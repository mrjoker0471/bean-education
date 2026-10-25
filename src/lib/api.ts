'use client'

import type {
  AttemptResultDTO,
  AttemptStateDTO,
  BeanChatMessage,
  BeanContext,
  BeanSettings,
  CatalogResponse,
  ExamDetailDTO,
  ExamListItem,
  ProgressDTO,
  ResourceMetaDTO,
  RevisionCheckDTO,
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
}
