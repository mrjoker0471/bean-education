// ─── PYQ import batches (audit trail listing) — Phase 2A ──────────────────────
// GET /api/pyq/batches?guestId=… — lists the latest 50 PyqImportBatch rows with
// their counts. Access requires a signed-in student session or an explicit
// guestId; batches themselves are a shared provenance record for the whole
// question bank (every batch records who imported it via importedBy).
//
// Honesty: when no import has ever happened the response is { batches: [], count: 0 }
// — callers should surface that verbatim ("no PYQ records yet"), never pad it.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionStudent } from '@/lib/auth'
import { safeParse } from '@/lib/serialize'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BATCHES = 50
const ERRORS_SHOWN_PER_BATCH = 10

interface BatchError {
  row: number
  error: string
}

export async function GET(req: NextRequest) {
  try {
    const student = await getSessionStudent()
    const guestId = req.nextUrl.searchParams.get('guestId') ?? ''
    if (!student && !(guestId.length >= 8 && guestId.length <= 64)) {
      return NextResponse.json(
        { error: 'Sign in, or pass a guestId (8..64 chars) to view PYQ import batches.' },
        { status: 401 },
      )
    }

    const batches = await db.pyqImportBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: MAX_BATCHES,
    })

    return NextResponse.json({
      batches: batches.map(b => ({
        id: b.id,
        paperTitle: b.paperTitle,
        examSlug: b.examSlug,
        examLabel: b.examLabel,
        stageLabel: b.stageLabel,
        subjectLabel: b.subjectLabel,
        year: b.year,
        session: b.session,
        sourceCitation: b.sourceCitation,
        fileName: b.fileName,
        importedBy: b.importedBy,
        totalRows: b.totalRows,
        createdCount: b.createdCount,
        duplicateCount: b.duplicateCount,
        failedCount: b.failedCount,
        errors: b.errorsJson ? safeParse<BatchError[]>(b.errorsJson, []).slice(0, ERRORS_SHOWN_PER_BATCH) : [],
        errorCount: b.errorsJson ? safeParse<BatchError[]>(b.errorsJson, []).length : 0,
        createdAt: b.createdAt.toISOString(),
      })),
      count: batches.length,
      // Honest zero-data signal: surfaces stay truthful until a real,
      // permission-cleared import happens.
      note: batches.length === 0 ? 'No PYQ imports recorded yet — the bank currently contains zero PYQ records.' : undefined,
    })
  } catch (err) {
    console.error('[api/pyq/batches]', err)
    return NextResponse.json({ error: 'Could not load import batches' }, { status: 500 })
  }
}
