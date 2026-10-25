import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/lib/riishe/types'
import { recoverStaleDocuments, queueOnce, recoverStaleTests } from '@/lib/riishe/jobs'
import { processDocument } from '@/lib/riishe/pipeline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPLOAD_DIR = path.join(process.cwd(), 'db', 'uploads')

const listQuery = z.object({
  guestId: z.string().min(8).max(64),
})

// GET — this guest's material library (never anyone else's)
export async function GET(req: NextRequest) {
  try {
    const parsed = listQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const guestId = parsed.data.guestId

    await recoverStaleDocuments()
    await recoverStaleTests()

    const docs = await db.studyDocument.findMany({
      where: { guestId },
      orderBy: { createdAt: 'desc' },
      include: {
        tests: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, status: true, questionIdsJson: true, requestedCount: true, createdAt: true },
        },
      },
    })

    return NextResponse.json({
      materials: docs.map(d => ({
        id: d.id,
        title: d.title,
        originalName: d.originalName,
        mimeType: d.mimeType,
        fileSize: d.fileSize,
        pageCount: d.pageCount,
        status: d.status,
        statusDetail: d.statusDetail,
        examLabel: d.examLabel,
        subjectLabel: d.subjectLabel,
        topicLabel: d.topicLabel,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
        topics: topicNames(d.analysisJson),
        tests: d.tests.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          questionCount: t.questionIdsJson ? safeCount(t.questionIdsJson) : 0,
          requestedCount: t.requestedCount,
          createdAt: t.createdAt.toISOString(),
        })),
      })),
      limits: { maxUploadMB: MAX_UPLOAD_MB, supportedTypes: ['PDF'] },
    })
  } catch (err) {
    console.error('[api/materials GET]', err)
    return NextResponse.json({ error: 'Failed to load materials' }, { status: 500 })
  }
}

const uploadSchema = z.object({
  guestId: z.string().min(8).max(64),
  title: z.string().max(160).optional(),
  examLabel: z.string().max(120).optional(),
  subjectLabel: z.string().max(120).optional(),
  topicLabel: z.string().max(120).optional(),
})

// POST — upload a study document (multipart/form-data)
export async function POST(req: NextRequest) {
  try {
    // Early size guard from the header (before buffering the body)
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared > MAX_UPLOAD_BYTES + 1024 * 512) {
      return NextResponse.json({ error: `File too large — the limit is ${MAX_UPLOAD_MB} MB.` }, { status: 413 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 })
    }
    const fields = uploadSchema.safeParse({
      guestId: String(form.get('guestId') ?? ''),
      title: form.get('title') ? String(form.get('title')) : undefined,
      examLabel: form.get('examLabel') ? String(form.get('examLabel')) : undefined,
      subjectLabel: form.get('subjectLabel') ? String(form.get('subjectLabel')) : undefined,
      topicLabel: form.get('topicLabel') ? String(form.get('topicLabel')) : undefined,
    })
    if (!fields.success) return NextResponse.json({ error: 'Invalid upload metadata.' }, { status: 400 })
    const meta = fields.data

    // ── Server-side validation: never trust the extension alone ──
    if (file.size === 0) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `File too large — the limit is ${MAX_UPLOAD_MB} MB.` }, { status: 413 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `File too large — the limit is ${MAX_UPLOAD_MB} MB.` }, { status: 413 })
    }
    // Real PDF magic check: %PDF-
    if (buffer.length < 8 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ error: 'This is not a valid PDF file. Riishe currently supports PDF uploads.' }, { status: 415 })
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex')

    // Idempotent duplicate upload for the same guest
    const existing = await db.studyDocument.findFirst({
      where: { guestId: meta.guestId, contentHash },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ documentId: existing.id, duplicate: true })
    }

    const created = await db.studyDocument.create({
      data: {
        guestId: meta.guestId,
        title: (meta.title ?? cleanTitle(file.name)).slice(0, 160),
        originalName: cleanTitle(file.name),
        storedPath: '', // set below once we have the id
        mimeType: 'application/pdf',
        fileSize: buffer.length,
        status: 'QUEUED',
        statusDetail: 'Queued for processing…',
        contentHash,
        examLabel: meta.examLabel?.slice(0, 120) ?? null,
        subjectLabel: meta.subjectLabel?.slice(0, 120) ?? null,
        topicLabel: meta.topicLabel?.slice(0, 120) ?? null,
      },
    })

    const storedPath = path.join(UPLOAD_DIR, `${created.id}.pdf`)
    await mkdir(UPLOAD_DIR, { recursive: true })
    await writeFile(storedPath, buffer, { mode: 0o600 }) // never web-served directly; owner rw only
    await db.studyDocument.update({ where: { id: created.id }, data: { storedPath } })

    // Kick the background pipeline (extraction → analysis). Never awaited by the request.
    void queueOnce(meta.guestId, `doc:${created.id}`, () => processDocument(created.id))

    return NextResponse.json({ documentId: created.id })
  } catch (err) {
    console.error('[api/materials POST]', err)
    return NextResponse.json({ error: 'The upload failed. Please try again.' }, { status: 500 })
  }
}

function cleanTitle(name: string): string {
  return name.replace(/[^\w\s.\-()]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Study document'
}

function topicNames(analysisJson: string | null): string[] {
  if (!analysisJson) return []
  try {
    const a = JSON.parse(analysisJson) as { topics?: { name: string }[] }
    return (a.topics ?? []).map(t => t.name).slice(0, 12)
  } catch {
    return []
  }
}

function safeCount(questionIdsJson: string | null): number {
  if (!questionIdsJson) return 0
  try {
    const arr = JSON.parse(questionIdsJson)
    return Array.isArray(arr) ? arr.length : 0
  } catch {
    return 0
  }
}
