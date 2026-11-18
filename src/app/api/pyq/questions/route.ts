// ─── PYQ questions listing (curation workspace) — Phase 2B ─────────────────────
// GET /api/pyq/questions — PYQ_CURATOR / ADMIN only. Lists imported PYQ rows
// with their full provenance so the curator workspace can render the review
// queue honestly: source paper, exam, year, options, correct answer,
// explanation, import batch, reviewer and review notes.
//
// Filters (all optional, combinable):
//   status  = UNVERIFIED | VERIFIED | REJECTED   (verificationStatus)
//   exam    = examId or exam slug
//   year    = exact year
//   batch   = PyqImportBatch id
//   q       = substring match on question text
//   limit   = 1..100 (default 50)   offset for paging
//
// Honesty: counts are exact DB counts per status; when there are no rows the
// response is { questions: [], total: 0 } — the UI shows the real empty state.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePyqCurator } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const STATUSES = ['UNVERIFIED', 'VERIFIED', 'REJECTED'] as const
type PyqStatus = (typeof STATUSES)[number]

async function statusCounts(): Promise<{ UNVERIFIED: number; VERIFIED: number; REJECTED: number }> {
  const [unverified, verified, rejected] = await Promise.all([
    db.question.count({ where: { sourceType: { in: ['PYQ_UNVERIFIED', 'PYQ_VERIFIED'] }, verificationStatus: 'UNVERIFIED' } }),
    db.question.count({ where: { sourceType: { in: ['PYQ_UNVERIFIED', 'PYQ_VERIFIED'] }, verificationStatus: 'VERIFIED' } }),
    db.question.count({ where: { sourceType: { in: ['PYQ_UNVERIFIED', 'PYQ_VERIFIED'] }, verificationStatus: 'REJECTED' } }),
  ])
  return { UNVERIFIED: unverified, VERIFIED: verified, REJECTED: rejected }
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePyqCurator()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const sp = req.nextUrl.searchParams
    const statusParam = sp.get('status')
    const examParam = sp.get('exam') ?? ''
    const yearParam = sp.get('year')
    const batchParam = sp.get('batch') ?? ''
    const q = sp.get('q')?.trim() ?? ''
    const limit = Math.min(Math.max(Number(sp.get('limit') ?? 50) || 50, 1), 100)
    const offset = Math.max(Number(sp.get('offset') ?? 0) || 0, 0)

    let status: PyqStatus | undefined
    if (statusParam) {
      if (!(STATUSES as readonly string[]).includes(statusParam)) {
        return NextResponse.json({ error: `Invalid status "${statusParam}" — use UNVERIFIED, VERIFIED or REJECTED.` }, { status: 400 })
      }
      status = statusParam as PyqStatus
    }

    let year: number | undefined
    if (yearParam) {
      const parsed = Number(yearParam)
      if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
        return NextResponse.json({ error: `Invalid year "${yearParam}".` }, { status: 400 })
      }
      year = parsed
    }

    // Only imported PYQ rows live in this workspace (never ORIGINAL bank rows).
    const where: Record<string, unknown> = {
      sourceType: { in: ['PYQ_UNVERIFIED', 'PYQ_VERIFIED'] },
    }
    if (status) where.verificationStatus = status
    if (year !== undefined) where.year = year
    if (batchParam) where.importedBatchId = batchParam
    if (examParam) {
      // Accept either the exam id or its slug.
      const exam = await db.exam.findFirst({
        where: { OR: [{ id: examParam }, { slug: examParam }] },
        select: { id: true },
      })
      if (!exam) {
        return NextResponse.json({ questions: [], total: 0, counts: await statusCounts() })
      }
      where.examId = exam.id
    }
    if (q) where.text = { contains: q }

    const [rows, total] = await Promise.all([
      db.question.findMany({
        where,
        // Question carries no createdAt column; cuid ids are time-prefixed, so
        // id-desc is a faithful newest-first ordering for the review queue.
        orderBy: [{ id: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          text: true,
          optionsJson: true,
          correctIndex: true,
          explanation: true,
          difficulty: true,
          language: true,
          verificationStatus: true,
          sourceType: true,
          sourcePaper: true,
          year: true,
          sourceRef: true,
          canonicalSlug: true,
          reviewedBy: true,
          reviewedAt: true,
          reviewNote: true,
          importedBatchId: true,
        },
      }),
      db.question.count({ where }),
    ])

    const batchIds = [...new Set(rows.map(r => r.importedBatchId).filter((v): v is string => typeof v === 'string'))]
    const reviewerIds = [...new Set(rows.map(r => r.reviewedBy).filter((v): v is string => typeof v === 'string'))]
    const [batchRows, reviewerRows] = await Promise.all([
      batchIds.length
        ? db.pyqImportBatch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, paperTitle: true, fileName: true, createdAt: true, importedBy: true, examSlug: true, year: true, session: true },
          })
        : Promise.resolve([]),
      reviewerIds.length
        ? db.student.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, email: true, displayName: true, role: true } })
        : Promise.resolve([]),
    ])
    const batchById = new Map(batchRows.map(b => [b.id, b]))
    const reviewerById = new Map(reviewerRows.map(s => [s.id, s]))

    const questions = rows.map(r => {
      let options: string[] = []
      try {
        const parsed: unknown = JSON.parse(r.optionsJson)
        if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === 'string')
      } catch {
        options = []
      }
      const batch = r.importedBatchId ? batchById.get(r.importedBatchId) ?? null : null
      const reviewer = r.reviewedBy ? reviewerById.get(r.reviewedBy) ?? null : null
      return {
        id: r.id,
        text: r.text,
        options,
        correctIndex: r.correctIndex,
        explanation: r.explanation,
        difficulty: r.difficulty,
        language: r.language,
        verificationStatus: r.verificationStatus as PyqStatus,
        sourceType: r.sourceType,
        sourcePaper: r.sourcePaper,
        year: r.year,
        // Session provenance lives on the import batch (Question rows do not
        // carry their own session column) — the UI renders batch.session.
        sourceRef: r.sourceRef,
        canonicalSlug: r.canonicalSlug,
        batch: batch
          ? {
              id: batch.id,
              paperTitle: batch.paperTitle,
              fileName: batch.fileName,
              examSlug: batch.examSlug,
              year: batch.year,
              session: batch.session,
              importedBy: batch.importedBy,
              createdAt: batch.createdAt.toISOString(),
            }
          : null,
        review: {
          reviewer: reviewer
            ? { email: reviewer.email, displayName: reviewer.displayName, role: reviewer.role }
            : null,
          reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
          reviewNote: r.reviewNote,
        },
      }
    })

    return NextResponse.json({ questions, total, counts: await statusCounts() })
  } catch (err) {
    console.error('[api/pyq/questions GET]', err)
    return NextResponse.json({ error: 'Could not load PYQ questions' }, { status: 500 })
  }
}
