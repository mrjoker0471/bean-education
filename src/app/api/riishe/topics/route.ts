import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { safeParse } from '@/lib/serialize'
import type { DocumentAnalysisDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  guestId: z.string().min(8).max(64),
  q: z.string().max(120).optional(),
})

// GET — the topics Riishe discovered across every READY analysed document in
// the student's library. Aggregated client-side; this endpoint just serves the
// per-document topic lists with honest analysis-state accounting derived from
// the stored coverage (no separate columns — one source of truth).
export async function GET(req: NextRequest) {
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const guestId = parsed.data.guestId

    const docs = await db.studyDocument.findMany({
      where: { guestId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, pageCount: true, analysisJson: true, updatedAt: true },
    })

    const documents = docs
      .map(d => {
        const analysis = safeParse<DocumentAnalysisDTO | null>(d.analysisJson, null)
        if (!analysis) return null
        const coverage = analysis.coverage
        const complete = !!coverage?.complete
        const total = coverage?.readablePages ?? 0
        const analysed = coverage?.analysedPages ?? 0
        // Question styles are only claimed when the structure really is a
        // question paper — never invented for ordinary documents.
        const questionPatterns =
          analysis.structure?.kind === 'QUESTION_PAPER' ? ['MCQ (from the paper itself — style only)'] : []
        return {
          documentId: d.id,
          documentTitle: d.title,
          pageCount: d.pageCount,
          analysisState: (complete ? 'COMPLETE' : 'PARTIAL') as 'COMPLETE' | 'PARTIAL',
          analysisPct: total > 0 ? Math.round((analysed / total) * 100) : null,
          summary: analysis.summary ?? null,
          topics: (analysis.topics ?? []).map(t => ({
            name: t.name,
            subtopics: t.subtopics ?? [],
            pages: t.pages ?? [],
            origin: t.origin,
          })),
          definitions: (analysis.definitions ?? []).length,
          formulas: (analysis.formulas ?? []).length,
          questionPatterns,
          updatedAt: d.updatedAt.toISOString(),
        }
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)

    const totalTopics = documents.reduce((s, d) => s + d.topics.length, 0)
    return NextResponse.json({ documents, totalTopics })
  } catch (err) {
    console.error('[api/riishe/topics GET]', err)
    return NextResponse.json({ error: 'Failed to load discovered topics' }, { status: 500 })
  }
}
