import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { enqueueJob, cancelJob, recoverStaleDocuments } from '@/lib/riishe/jobs'
import { deleteStoredFile } from '@/lib/riishe/pipeline'
import type { DocumentAnalysis } from '@/lib/riishe/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

async function ownedDocument(id: string, guestId: string | null) {
  if (!guestId) return null
  const doc = await db.studyDocument.findUnique({ where: { id } })
  if (!doc || doc.guestId !== guestId) return null // ownership check — never leak another student's material
  return doc
}

// GET — full material detail incl. analysis (owner only)
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const guestId = new URL(req.url).searchParams.get('guestId')
    const doc = await ownedDocument(id, guestId)
    if (!doc) return NextResponse.json({ error: 'Material not found' }, { status: 404 })

    await recoverStaleDocuments([id])
    const fresh = await db.studyDocument.findUnique({ where: { id } })
    if (!fresh) return NextResponse.json({ error: 'Material not found' }, { status: 404 })

    // Self-heal: a QUEUED row with no live job (server restart) is re-kicked
    if (['QUEUED', 'FAILED'].includes(fresh.status)) {
      void enqueueJob({ kind: 'DOCUMENT_ANALYSIS', refId: fresh.id, ownerId: fresh.guestId })
    }

    // Phase 2A storage integrity: a COMPLETE analysis no longer needs the
    // private per-section retry state (_parts) — strip it lazily so stored
    // rows shrink without touching any analysed content. Partial analyses
    // keep _parts (a partial retry still needs every successful section).
    if (fresh.analysisJson) {
      try {
        const parsed = JSON.parse(fresh.analysisJson) as { _parts?: unknown; coverage?: { complete?: boolean } }
        if ('_parts' in parsed && parsed.coverage?.complete === true) {
          delete parsed._parts
          await db.studyDocument.update({ where: { id: fresh.id }, data: { analysisJson: JSON.stringify(parsed) } })
        }
      } catch { /* malformed rows are left untouched */ }
    }

    const analysis = safeAnalysis(fresh.analysisJson)

    // Honest analysis-state accounting derived from the stored coverage —
    // COMPLETE only when the content analysis itself is complete (no skipped
    // pages, nothing awaiting OCR, no failures). Page accounting is a separate
    // axis and is reported alongside, never folded into this label.
    const cov = analysis?.coverage ?? null
    const analysisState: 'COMPLETE' | 'PARTIAL' | null = fresh.status === 'READY' && analysis
      ? cov?.complete ? 'COMPLETE' : 'PARTIAL'
      : null
    // Semantic-analysis percentage over ALL physical pages: pages awaiting
    // OCR, skipped or unread count against completeness — the denominator is
    // never trimmed to flatter the result.
    const analysisPct: number | null = cov && cov.totalPages > 0
      ? Math.round((cov.analysedPages / cov.totalPages) * 100)
      : null
    // NEEDS_OCR documents have no analysis — their coverage comes straight
    // from the extraction stats (total vs image-only pages).
    let coverage: Record<string, unknown> | null = (cov as unknown as Record<string, unknown>) ?? null
    if (!coverage && fresh.status === 'NEEDS_OCR' && fresh.extractionJson) {
      try {
        const pages = JSON.parse(fresh.extractionJson) as { page: number; scanned: boolean }[]
        coverage = {
          totalPages: fresh.pageCount ?? pages.length,
          readablePages: pages.filter(p => !p.scanned).length,
          scannedPages: pages.filter(p => p.scanned).length,
          noTextPages: pages.filter(p => p.scanned).length,
        }
      } catch { /* keep null */ }
    }

    const tests = await db.riisheTest.findMany({
      where: { documentId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, title: true, status: true, statusDetail: true, focusTopicsJson: true, weakFocus: true,
        requestedCount: true, configJson: true, distributionJson: true, statsJson: true, questionIdsJson: true, createdAt: true,
      },
    })

    return NextResponse.json({
      id: fresh.id,
      title: fresh.title,
      originalName: fresh.originalName,
      mimeType: fresh.mimeType,
      fileSize: fresh.fileSize,
      pageCount: fresh.pageCount,
      status: fresh.status,
      statusDetail: fresh.statusDetail,
      examLabel: fresh.examLabel,
      subjectLabel: fresh.subjectLabel,
      topicLabel: fresh.topicLabel,
      createdAt: fresh.createdAt.toISOString(),
      updatedAt: fresh.updatedAt.toISOString(),
      analysis: fresh.status === 'READY' ? analysis : null,
      analysisState,
      analysisPct,
      coverage,
      topics: analysis?.topics.map(t => t.name) ?? [],
      tests: tests.map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        statusDetail: t.statusDetail,
        focusTopics: safeArr(t.focusTopicsJson),
        weakFocus: t.weakFocus,
        requestedCount: t.requestedCount,
        questionCount: t.questionIdsJson ? safeArr(t.questionIdsJson).length : 0,
        config: safeCfg(t.configJson),
        stats: safeStats(t.statsJson),
        createdAt: t.createdAt.toISOString(),
      })),
    })
  } catch (err) {
    console.error('[api/materials/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to load material' }, { status: 500 })
  }
}

const patchSchema = z.object({
  guestId: z.string().min(8).max(64),
  title: z.string().min(1).max(160).optional(),
  examLabel: z.string().max(120).nullable().optional(),
  subjectLabel: z.string().max(120).nullable().optional(),
  topicLabel: z.string().max(120).nullable().optional(),
})

// PATCH — rename / re-associate (owner only)
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const doc = await ownedDocument(id, parsed.data.guestId)
    if (!doc) return NextResponse.json({ error: 'Material not found' }, { status: 404 })

    const data: Record<string, string | null> = {}
    if (parsed.data.title !== undefined) data.title = parsed.data.title.slice(0, 160)
    if (parsed.data.examLabel !== undefined) data.examLabel = parsed.data.examLabel?.slice(0, 120) ?? null
    if (parsed.data.subjectLabel !== undefined) data.subjectLabel = parsed.data.subjectLabel?.slice(0, 120) ?? null
    if (parsed.data.topicLabel !== undefined) data.topicLabel = parsed.data.topicLabel?.slice(0, 120) ?? null
    const updated = await db.studyDocument.update({ where: { id }, data })
    return NextResponse.json({ ok: true, title: updated.title })
  } catch (err) {
    console.error('[api/materials/[id] PATCH]', err)
    return NextResponse.json({ error: 'Could not update the material' }, { status: 500 })
  }
}

// DELETE — remove the material and its derived data (owner only)
export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const guestId = new URL(req.url).searchParams.get('guestId')
    const doc = await ownedDocument(id, guestId)
    if (!doc) return NextResponse.json({ error: 'Material not found' }, { status: 404 })

    // Cancel any pending background job for this document first so the queue
    // never re-processes a deleted row.
    await cancelJob('DOCUMENT_ANALYSIS', id)

    // Phase 2A: the whole DB removal is one transaction — attempts keep their
    // (already submitted) history but lose the document link; the document's
    // chat turns (previously orphaned) are deleted with it. Cascades remove
    // tests + questions; explanations live on attempts and stay for review history.
    await db.$transaction([
      db.attempt.updateMany({ where: { documentId: id }, data: { documentId: null } }),
      db.riisheTest.deleteMany({ where: { documentId: id } }),
      db.riisheChatTurn.deleteMany({ where: { documentId: id } }),
      db.studyDocument.delete({ where: { id } }),
    ])

    // File removal last: a failed unlink must not resurrect the row — the
    // orphan sweep (materials GET) collects crash debris later.
    await deleteStoredFile(doc.storedPath)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/materials/[id] DELETE]', err)
    return NextResponse.json({ error: 'Could not delete the material' }, { status: 500 })
  }
}

function safeAnalysis(json: string | null): DocumentAnalysis | null {
  if (!json) return null
  try { return normalizeAnalysis(JSON.parse(json) as DocumentAnalysis) } catch { return null }
}

/** Bring older stored analyses up to the current DTO shape so the client can
 * rely on the hierarchical topic fields (old flat analyses get defaults).
 * v6 also normalizes legacy string keyFacts/formulas into page-grounded
 * notes: legacy entries carry no verified page, so they are kept visible
 * but explicitly UNVERIFIED — never silently presented as source-backed. */
function normalizeAnalysis(a: DocumentAnalysis): DocumentAnalysis {
  const topics = (a.topics ?? []).map((t, i) => ({
    ...t,
    id: t.id ?? `t${i + 1}`,
    level: (t.level === 2 ? 2 : 1) as 1 | 2,
    parentId: t.parentId ?? null,
    aliases: t.aliases ?? [],
    pageVerified: t.pageVerified ?? true,
  }))
  // repair parent links that point at dropped/missing ids
  const ids = new Set(topics.map(t => t.id))
  for (const t of topics) if (t.parentId && !ids.has(t.parentId)) t.parentId = null
  const keyFacts = ((a.keyFacts ?? []) as unknown[]).map(f =>
    typeof f === 'string'
      ? { text: f, page: null, status: 'UNVERIFIED' as const, note: 'extracted by an earlier pipeline version — no page reference recorded' }
      : f as DocumentAnalysis['keyFacts'][number],
  )
  const formulas = ((a.formulas ?? []) as unknown[]).map(f =>
    typeof f === 'string'
      ? { text: f, page: null, status: 'NEEDS_REVIEW' as const, note: 'extracted by an earlier pipeline version — transcription not verified' }
      : f as DocumentAnalysis['formulas'][number],
  )
  return { ...a, topics, keyFacts, formulas }
}
function safeArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : [] } catch { return [] }
}
function safeCfg(json: string) {
  try { return JSON.parse(json) } catch { return { timed: true, durationMin: 50, marksPerQuestion: 1, negativeMark: 0 } }
}
function safeStats(json: string | null) {
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}
