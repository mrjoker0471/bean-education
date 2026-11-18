import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { enqueueJob } from '@/lib/riishe/jobs'
import { processDocument } from '@/lib/riishe/pipeline'
import { safeParse } from '@/lib/serialize'
import { PIPELINE_VERSION, type DocumentAnalysis } from '@/lib/riishe/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const retrySchema = z.object({
  guestId: z.string().min(8).max(64),
  /** true = discard the current analysis and re-analyse everything (owner request) */
  force: z.boolean().optional(),
})

// POST — retry / re-analyse processing (owner only).
//  • FAILED/QUEUED  → resume the interrupted job
//  • READY + incomplete coverage → re-run only the failed sections, keeping
//    every section that already succeeded
//  • READY + force  → full re-analysis from scratch
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const parsed = retrySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, force } = parsed.data
    const doc = await db.studyDocument.findUnique({ where: { id } })
    if (!doc || doc.guestId !== guestId) {
      return NextResponse.json({ error: 'Material not found' }, { status: 404 })
    }
    if (doc.status === 'NEEDS_OCR' && !force) {
      return NextResponse.json({ error: 'This document has no extractable text (scanned images) — OCR is not available yet, so retrying cannot help.' }, { status: 409 })
    }
    if (doc.status === 'READY' && !force) {
      const analysis = safeParse<DocumentAnalysis | null>(doc.analysisJson, null)
      const partial =
        analysis?.coverage && analysis.coverage.complete === false && analysis.pipelineVersion === PIPELINE_VERSION
      if (!partial) {
        return NextResponse.json({ error: 'This document is already fully analysed. Use re-analyse to start over.' }, { status: 409 })
      }
      // Targeted partial retry — keep status READY (processDocument's partial
      // path requires it) and queue the job; it re-runs only failed sections.
      void enqueueJob({ kind: 'DOCUMENT_ANALYSIS', refId: id, ownerId: doc.guestId })
      return NextResponse.json({ ok: true, partial: true })
    }
    if (!['FAILED', 'QUEUED', 'READY', 'NEEDS_OCR'].includes(doc.status)) {
      return NextResponse.json({ error: 'This document is currently processing.' }, { status: 409 })
    }

    await db.studyDocument.update({
      where: { id },
      data: { status: 'QUEUED', statusDetail: force ? 'Queued for a full re-analysis…' : 'Queued for a retry…' },
    })
    void enqueueJob({ kind: 'DOCUMENT_ANALYSIS', refId: id, ownerId: doc.guestId, payload: { force: Boolean(force) } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/materials/[id]/retry]', err)
    return NextResponse.json({ error: 'Could not retry processing' }, { status: 500 })
  }
}
