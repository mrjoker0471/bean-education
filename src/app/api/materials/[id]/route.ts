import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { recoverStaleDocuments, queueOnce } from '@/lib/riishe/jobs'
import { processDocument, deleteStoredFile } from '@/lib/riishe/pipeline'
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
      void queueOnce(fresh.guestId, `doc:${fresh.id}`, () => processDocument(fresh.id))
    }

    const analysis = safeAnalysis(fresh.analysisJson)
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

    // Attempts keep their (already submitted) history but lose the document link
    await db.attempt.updateMany({ where: { documentId: id }, data: { documentId: null } })
    // Cascade removes tests + questions; explanations live on attempts and stay for review history
    await db.riisheTest.deleteMany({ where: { documentId: id } })
    await deleteStoredFile(doc.storedPath)
    await db.studyDocument.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/materials/[id] DELETE]', err)
    return NextResponse.json({ error: 'Could not delete the material' }, { status: 500 })
  }
}

function safeAnalysis(json: string | null): DocumentAnalysis | null {
  if (!json) return null
  try { return JSON.parse(json) as DocumentAnalysis } catch { return null }
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
