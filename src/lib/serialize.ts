// Server-side serialization helpers shared by API routes.
import { db } from '@/lib/db'
import type { ExamListItem } from '@/lib/types'

type ExamWithCounts = {
  id: string
  slug: string
  name: string
  shortName: string | null
  authority: string
  categorySlug: string
  state: string | null
  description: string
  featured: boolean
  syllabusStatus: string
  contentNote: string | null
  sourceRefs: string | null
  _count: { questions: number; resources: number; templates: number }
}

export function parseSourceRefs(raw: string | null): { label: string; url: string }[] | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function serializeExam(e: ExamWithCounts, topicCounts: Map<string, number>, noteCounts: Map<string, number>): ExamListItem {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    shortName: e.shortName,
    authority: e.authority,
    categorySlug: e.categorySlug,
    state: e.state,
    description: e.description,
    featured: e.featured,
    syllabusStatus: e.syllabusStatus as ExamListItem['syllabusStatus'],
    contentNote: e.contentNote,
    sourceRefs: parseSourceRefs(e.sourceRefs),
    counts: {
      topics: topicCounts.get(e.id) ?? 0,
      notes: noteCounts.get(e.id) ?? 0,
      questions: e._count.questions,
      resources: e._count.resources,
      tests: e._count.templates,
    },
  }
}

export async function loadContentMaps(): Promise<{ topicCounts: Map<string, number>; noteCounts: Map<string, number> }> {
  const topicRows = await db.$queryRawUnsafe<{ examId: string; c: number }>(`
    SELECT s.examId AS examId, COUNT(t.id) AS c
    FROM Topic t
    JOIN Unit u ON t.unitId = u.id
    JOIN Subject su ON u.subjectId = su.id
    JOIN Stage s ON su.stageId = s.id
    GROUP BY s.examId`)
  const noteRows = await db.$queryRawUnsafe<{ examId: string; c: number }>(`
    SELECT s.examId AS examId, COUNT(n.id) AS c
    FROM Note n
    JOIN Topic t ON n.topicId = t.id
    JOIN Unit u ON t.unitId = u.id
    JOIN Subject su ON u.subjectId = su.id
    JOIN Stage s ON su.stageId = s.id
    GROUP BY s.examId`)
  const topicCounts = new Map<string, number>()
  for (const r of topicRows) topicCounts.set(r.examId, Number(r.c))
  const noteCounts = new Map<string, number>()
  for (const r of noteRows) noteCounts.set(r.examId, Number(r.c))
  return { topicCounts, noteCounts }
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
