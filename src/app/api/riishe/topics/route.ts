import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { safeParse } from '@/lib/serialize'
import type { DocumentAnalysis, DocumentCoverage } from '@/lib/riishe/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  guestId: z.string().min(8).max(64),
})

/**
 * GET — the discovered chapter/topic hierarchy across EVERY READY document in
 * this guest's library. Built from the real analysis JSON; a document with a
 * partial analysis contributes its topics with its honest coverage badge.
 */
export async function GET(req: NextRequest) {
  try {
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const guestId = parsed.data.guestId

    const docs = await db.studyDocument.findMany({
      where: { guestId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, pageCount: true, analysisJson: true, coverageJson: true, analysisState: true, updatedAt: true },
    })

    const documents = docs
      .map(d => {
        const analysis = safeParse<DocumentAnalysis | null>(d.analysisJson, null)
        if (!analysis) return null
        const coverage = safeParse<DocumentCoverage | null>(d.coverageJson, null)
        return {
          documentId: d.id,
          documentTitle: d.title,
          pageCount: d.pageCount,
          analysisState: (d.analysisState as 'COMPLETE' | 'PARTIAL' | null) ?? 'PARTIAL',
          analysisPct: coverage?.analysisPct ?? null,
          summary: analysis.summary,
          topics: analysis.topics.map(t => ({
            name: t.name,
            subtopics: t.subtopics,
            pages: t.pages,
          })),
          definitions: analysis.definitions.length,
          formulas: analysis.formulas.length,
          questionPatterns: analysis.questionPatterns ?? [],
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
