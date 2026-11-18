// ─── PYQ structured import — Phase 2A ─────────────────────────────────────────
// POST /api/pyq/import — imports a structured JSON file of previous-year
// questions into the question bank with a full audit trail (PyqImportBatch).
//
// Honesty rules enforced here:
//   • Every created row is sourceType 'PYQ_UNVERIFIED' + verificationStatus
//     'UNVERIFIED'. This endpoint NEVER creates PYQ_VERIFIED rows and never
//     relabels ORIGINAL rows — only the review route may verify.
//   • Duplicate detection is content-based (pyqHash over normalized text +
//     options + answer key); duplicates are counted, never re-inserted.
//   • Wrong foreign ids (stage/subject/topic that do not exist or do not
//     belong to the resolved exam) fail the ROW honestly — not silently
//     dropped, not silently re-pointed.
//   • examSlug is required because Question.examId is a hard foreign key:
//     PYQ rows must attach to a real catalogue exam. examLabel / paperTitle
//     remain free-text provenance metadata on the batch.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionStudent } from '@/lib/auth'
import { z } from 'zod'
import {
  validatePyqItem,
  computePyqHash,
  slugifyLabel,
  PYQ_YEAR_MIN,
  PYQ_YEAR_MAX,
  type PyqItemInput,
} from '@/lib/pyq'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  paperTitle: z.string().min(3, 'paperTitle must be at least 3 characters').max(200),
  fileName: z.string().min(1, 'fileName is required').max(200),
  examSlug: z.string().min(1, 'examSlug is required — PYQ rows must attach to a real catalogue exam').max(120),
  examLabel: z.string().max(200).optional(),
  stageLabel: z.string().max(200).optional(),
  subjectLabel: z.string().max(200).optional(),
  year: z.number().int().min(PYQ_YEAR_MIN).max(PYQ_YEAR_MAX).optional(),
  session: z.string().max(100).optional(),
  sourceCitation: z.string().max(500).optional(),
  // Guests may import (provenance records who); signed-in students are preferred.
  guestId: z.string().min(8).max(64).optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1, 'items must contain at least 1 row').max(500, 'items is capped at 500 rows per import'),
})

interface ImportError {
  row: number
  error: string
}

interface ResolvedFks {
  stageId: string | null
  subjectId: string | null
  topicId: string | null
}

interface ImportStats {
  createdCount: number
  duplicateCount: number
  failedCount: number
  errors: ImportError[]
}

export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      const detail = parsed.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
      return NextResponse.json({ error: `Invalid request — ${detail}` }, { status: 400 })
    }
    const { paperTitle, fileName, examSlug, examLabel, stageLabel, subjectLabel, year, session, sourceCitation, guestId, items } = parsed.data

    // ── Auth: signed-in student preferred, explicit guestId allowed ──
    const student = await getSessionStudent()
    if (!student && !guestId) {
      return NextResponse.json(
        { error: 'Sign in, or pass a guestId (8..64 chars) — provenance must record who imported this paper.' },
        { status: 401 },
      )
    }
    const importedBy = student ? student.id : (guestId as string)

    // ── Resolve the catalogue exam (hard FK requirement) ──
    const exam = await db.exam.findUnique({ where: { slug: examSlug }, select: { id: true, slug: true } })
    if (!exam) {
      return NextResponse.json({ error: `Unknown examSlug "${examSlug}" — PYQ rows must attach to an exam that exists in the catalogue.` }, { status: 400 })
    }

    // ── Pre-load referenced catalog ids so rows can be validated honestly ──
    const stageIdRefs = distinctRefs(items, 'stageId')
    const subjectIdRefs = distinctRefs(items, 'subjectId')
    const topicIdRefs = distinctRefs(items, 'topicId')
    const [stages, subjects, topics] = await Promise.all([
      stageIdRefs.length ? db.stage.findMany({ where: { id: { in: stageIdRefs } } }) : Promise.resolve([]),
      subjectIdRefs.length ? db.subject.findMany({ where: { id: { in: subjectIdRefs } }, include: { stage: true } }) : Promise.resolve([]),
      topicIdRefs.length
        ? db.topic.findMany({ where: { id: { in: topicIdRefs } }, include: { unit: { include: { subject: { include: { stage: true } } } } } })
        : Promise.resolve([]),
    ])
    const stageById = new Map(stages.map(s => [s.id, s]))
    const subjectById = new Map(subjects.map(s => [s.id, s]))
    const topicById = new Map(topics.map(t => [t.id, t]))

    // ── Batch row first: the audit trail exists even if every row fails ──
    const batch = await db.pyqImportBatch.create({
      data: {
        paperTitle,
        examSlug: exam.slug,
        examLabel: examLabel ?? null,
        stageLabel: stageLabel ?? null,
        subjectLabel: subjectLabel ?? null,
        year: year ?? null,
        session: session ?? null,
        sourceCitation: sourceCitation ?? null,
        fileName,
        importedBy,
        totalRows: items.length,
      },
    })

    // ── Per-row pipeline: validate → hash → dedupe → resolve FKs → create ──
    const stats: ImportStats = { createdCount: 0, duplicateCount: 0, failedCount: 0, errors: [] }
    // canonicalSlug spec: pyq:${examSlug ?? slugify(examLabel ?? paperTitle)}:${year ?? 'na'}:${rowIndex}
    // examSlug is required here, so the slugified-label branch stays defensive.
    const canonicalPrefix = `pyq:${exam.slug || slugifyLabel(examLabel ?? paperTitle)}:${year ?? 'na'}`

    for (let rowIndex = 0; rowIndex < items.length; rowIndex++) {
      const item = items[rowIndex] as PyqItemInput
      const fail = (error: string) => {
        stats.failedCount++
        stats.errors.push({ row: rowIndex, error })
      }

      // 1. Pure row validation (lengths, enums, answer-key range …)
      const validation = validatePyqItem(item)
      if (!validation.ok) {
        fail(validation.error ?? 'invalid row')
        continue
      }

      // 2. Optional catalog ids — existence + exam membership, honest failures
      const fks = resolveRowFks(item, exam.id, stageById, subjectById, topicById)
      if (typeof fks === 'string') {
        fail(fks)
        continue
      }

      // 3. Content hash + duplicate detection (count only, never re-insert)
      const text = (item.text as string).trim()
      const options = (item.options as string[]).map(o => o.trim())
      const correctIndex = item.correctIndex as number
      const pyqHash = computePyqHash(text, options, correctIndex)
      const existing = await db.question.findFirst({ where: { pyqHash }, select: { id: true } })
      if (existing) {
        stats.duplicateCount++
        continue
      }

      // 4. Create as UNVERIFIED — verification is a separate reviewed workflow
      const resolvedYear = typeof item.year === 'number' ? item.year : year ?? null
      const language = typeof item.language === 'string' && item.language.trim() ? item.language.trim() : 'English'
      try {
        await db.question.create({
          data: {
            examId: exam.id,
            stageId: fks.stageId,
            subjectId: fks.subjectId,
            topicId: fks.topicId,
            canonicalSlug: `${canonicalPrefix}:${rowIndex}`,
            text,
            optionsJson: JSON.stringify(options),
            correctIndex,
            explanation: typeof item.explanation === 'string' ? item.explanation.trim() : '',
            difficulty: typeof item.difficulty === 'string' ? item.difficulty : 'MEDIUM',
            language,
            sourceType: 'PYQ_UNVERIFIED',
            verificationStatus: 'UNVERIFIED',
            sourcePaper: paperTitle,
            year: resolvedYear,
            pyqHash,
            sourceRef: typeof item.sourceRef === 'string' && item.sourceRef.trim() ? item.sourceRef.trim() : null,
            importedBatchId: batch.id,
          },
        })
        stats.createdCount++
      } catch (err) {
        console.error(`[api/pyq/import] row ${rowIndex} create failed:`, err)
        fail('database error while creating the question row')
      }
    }

    // ── Persist counts + per-row audit, then report honestly ──
    await db.pyqImportBatch.update({
      where: { id: batch.id },
      data: {
        createdCount: stats.createdCount,
        duplicateCount: stats.duplicateCount,
        failedCount: stats.failedCount,
        errorsJson: stats.errors.length ? JSON.stringify(stats.errors) : null,
      },
    })

    return NextResponse.json({
      batchId: batch.id,
      totalRows: items.length,
      createdCount: stats.createdCount,
      duplicateCount: stats.duplicateCount,
      failedCount: stats.failedCount,
      errors: stats.errors.slice(0, 20),
    })
  } catch (err) {
    console.error('[api/pyq/import]', err)
    return NextResponse.json({ error: 'Import failed — please try again.' }, { status: 500 })
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function distinctRefs(items: Record<string, unknown>[], field: 'stageId' | 'subjectId' | 'topicId'): string[] {
  const set = new Set<string>()
  for (const item of items) {
    const v = item[field]
    if (typeof v === 'string' && v.trim()) set.add(v.trim())
  }
  return [...set]
}

/**
 * Resolve a row's optional stage/subject/topic ids. Returns either the resolved
 * FK triple or an honest error string. Rules:
 *   • stage must exist and belong to the resolved exam
 *   • subject must exist, belong to the resolved exam, and (when stageId is
 *     given) sit under that exact stage
 *   • topic must exist, belong to the resolved exam, and (when subjectId is
 *     given) sit under that exact subject
 */
function resolveRowFks(
  item: PyqItemInput,
  examId: string,
  stageById: Map<string, { id: string; examId: string }>,
  subjectById: Map<string, { id: string; stageId: string; stage: { examId: string } }>,
  topicById: Map<string, { id: string; unit: { subject: { id: string; stageId: string; stage: { examId: string } } } }>,
): ResolvedFks | string {
  let stageId: string | null = null
  let subjectId: string | null = null
  let topicId: string | null = null

  if (typeof item.stageId === 'string' && item.stageId.trim()) {
    const stage = stageById.get(item.stageId.trim())
    if (!stage) return 'stageId does not exist in the catalogue'
    if (stage.examId !== examId) return 'stageId belongs to a different exam'
    stageId = stage.id
  }

  if (typeof item.subjectId === 'string' && item.subjectId.trim()) {
    const subject = subjectById.get(item.subjectId.trim())
    if (!subject) return 'subjectId does not exist in the catalogue'
    if (subject.stage.examId !== examId) return 'subjectId belongs to a different exam'
    if (stageId && subject.stageId !== stageId) return 'subjectId does not belong to the provided stageId'
    subjectId = subject.id
  }

  if (typeof item.topicId === 'string' && item.topicId.trim()) {
    const topic = topicById.get(item.topicId.trim())
    if (!topic) return 'topicId does not exist in the catalogue'
    const topicStage = topic.unit.subject.stage
    if (topicStage.examId !== examId) return 'topicId belongs to a different exam'
    if (subjectId && topic.unit.subject.id !== subjectId) return 'topicId does not belong to the provided subjectId'
    if (stageId && topic.unit.subject.stageId !== stageId) return 'topicId does not belong to the provided stageId'
    topicId = topic.id
  }

  return { stageId, subjectId, topicId }
}
