import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, unlink, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/lib/riishe/types'
import { enqueueJob, recoverStaleDocuments, recoverStaleTests, reserveQuota, releaseQuota } from '@/lib/riishe/jobs'
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

    await recoverPendingJobs()
    await sweepOrphanUploads()

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

    // Phase 3B fix: the documented 'analyse' quota (30/hour) was never
    // enforced — new uploads now reserve it. User-initiated retries are
    // charged on the retry route; the stale-job self-heal path is system
    // recovery, not new demand, and stays governed by the per-owner job caps
    // (MAX_OWNER_RUNNING/PENDING). Honest 429 before any file is written.
    const analysisReserved = await reserveQuota(meta.guestId, 'analyse')
    if (!analysisReserved) {
      return NextResponse.json(
        { error: 'Hourly analysis limit reached (30/hour) — please try again later.' },
        { status: 429 },
      )
    }

    // ── Phase 2A lifecycle integrity: file FIRST, then the row ──
    // The row is created only after its file exists on disk with the final
    // storedPath already set — the old empty-storedPath window (a row that
    // could only ever FAIL) is gone. If the row write fails after the file
    // was written, the file is removed again (compensating cleanup).
    const id = randomUUID()
    await mkdir(UPLOAD_DIR, { recursive: true })
    const storedPath = path.join(UPLOAD_DIR, `${id}.pdf`)
    try {
      await writeFile(storedPath, buffer, { mode: 0o600 }) // never web-served directly; owner rw only
    } catch {
      await releaseQuota(meta.guestId, 'analyse').catch(() => undefined)
      return NextResponse.json({ error: 'The upload failed while storing the file. Please try again.' }, { status: 500 })
    }

    let created
    try {
      created = await db.studyDocument.create({
        data: {
          id,
          guestId: meta.guestId,
          title: (meta.title ?? cleanTitle(file.name)).slice(0, 160),
          originalName: cleanTitle(file.name),
          storedPath,
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
    } catch (rowErr) {
      // Compensating cleanup: never leave a file with no row behind it,
      // and never leave a quota reservation without a job behind it.
      await unlink(storedPath).catch(() => undefined)
      await releaseQuota(meta.guestId, 'analyse').catch(() => undefined)
      throw rowErr
    }

    // Kick the background pipeline (extraction → analysis) through the durable
    // job queue. Never awaited by the request.
    void enqueueJob({ kind: 'DOCUMENT_ANALYSIS', refId: created.id, ownerId: meta.guestId })

    return NextResponse.json({ documentId: created.id })
  } catch (err) {
    console.error('[api/materials POST]', err)
    return NextResponse.json({ error: 'The upload failed. Please try again.' }, { status: 500 })
  }
}

function cleanTitle(name: string): string {
  return name.replace(/[^\w\s.\-()]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Study document'
}

/** Reconcile pending/stale domain rows with the durable job queue (Phase 2A).
 *  Exported from jobs.ts; kept here as a thin alias for readability. */
async function recoverPendingJobs() {
  await recoverStaleDocuments()
  await recoverStaleTests()
}

/** Compensating cleanup for interrupted uploads (Phase 2A): files sitting in
 *  db/uploads with no database row and older than one hour are removed. Rows
 *  are always created AFTER their file exists, so only crash debris qualifies. */
async function sweepOrphanUploads() {
  try {
    const entries = await readdir(UPLOAD_DIR).catch(() => [] as string[])
    if (entries.length === 0) return
    const cutoff = Date.now() - 60 * 60_000
    const statList = await Promise.all(
      entries
        .filter(f => f.endsWith('.pdf') || f.endsWith('.pdf.tmp'))
        .map(async f => ({ f, st: await stat(path.join(UPLOAD_DIR, f)).catch(() => null) })),
    )
    const candidates = statList.filter(s => s.st && s.st.mtimeMs < cutoff).map(s => path.join(UPLOAD_DIR, s.f))
    if (candidates.length === 0) return
    const known = await db.studyDocument.findMany({ where: { storedPath: { in: candidates } }, select: { storedPath: true } })
    const knownSet = new Set(known.map(k => k.storedPath))
    for (const p of candidates) {
      if (!knownSet.has(p)) await unlink(p).catch(() => undefined)
    }
  } catch (err) {
    console.warn('[materials sweep]', err)
  }
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
