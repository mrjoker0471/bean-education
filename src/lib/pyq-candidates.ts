// ─── Research candidate → PYQ curation bridge (Phase 3A) ─────────────────────
// The ONLY way a discovered historical question enters the question bank.
// Rules enforced here:
//   • promotion is a curator-only action (route enforces requirePyqCurator)
//   • the created Question is ALWAYS PYQ_UNVERIFIED / UNVERIFIED — only the
//     existing /api/pyq/review endpoint can ever verify it
//   • the import contract is reused verbatim: validation, exam resolution,
//     computePyqHash duplicate detection, a real PyqImportBatch audit row
//   • rights: candidates marked REFERENCE_ONLY require the curator to supply
//     the verbatim question text themselves (the curator is accountable for
//     having the rights to the source); VERBATIM_PERMITTED candidates may use
//     the stored verbatim text
//   • provenance travels: sourceUrl/publisher/locator/retrieval date/answer
//     key are written to the new Question provenance columns
import { db } from '@/lib/db'
import { computePyqHash, PYQ_YEAR_MIN, PYQ_YEAR_MAX } from '@/lib/pyq'
import type { AuthStudent } from '@/lib/auth'

export const PROMOTION_TEXT_MIN = 10
export const PROMOTION_TEXT_MAX = 2000

export interface PromoteInputDTO {
  text?: string // curator-supplied verbatim text (required for REFERENCE_ONLY)
  options?: string[]
  correctIndex?: number
  explanation?: string
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD'
  language?: string
  year?: number // curator-confirmed year (overrides candidate when visible on source)
  examSlug?: string // curator-confirmed exam (overrides candidate when verified)
  stageId?: string
  subjectId?: string
  topicId?: string
}

export type PromoteResult =
  | { ok: true; questionId: string; batchId: string; duplicateOf?: undefined }
  | { ok: false; status: number; error: string; duplicateOf?: string }

/**
 * Promote one SOURCE_CHECKED candidate into the curation queue.
 * Mirrors /api/pyq/import per-row semantics: validate → hash → global duplicate
 * check → batch audit row → PYQ_UNVERIFIED Question → candidate marked PROMOTED.
 */
export async function promoteCandidate(student: AuthStudent, candidateId: string, input: PromoteInputDTO): Promise<PromoteResult> {
  const candidate = await db.researchPyqCandidate.findUnique({ where: { id: candidateId } })
  if (!candidate) return { ok: false, status: 404, error: 'Candidate not found' }
  if (candidate.status === 'PROMOTED') {
    return { ok: false, status: 409, error: 'Candidate was already promoted into the review queue.', duplicateOf: candidate.promotedQuestionId ?? undefined }
  }
  if (candidate.status === 'DISCARDED') return { ok: false, status: 409, error: 'Candidate was discarded.' }
  if (candidate.status !== 'SOURCE_CHECKED') {
    return { ok: false, status: 409, error: 'Only source-checked candidates can be promoted — this candidate has not passed the source-check stage.' }
  }

  // Exam: candidate's slug, or the curator's explicit override (they may have
  // identified the exam with certainty from the source).
  const examSlug = (input.examSlug ?? candidate.examSlug ?? '').trim()
  if (!examSlug) return { ok: false, status: 400, error: 'The examination could not be determined — supply examSlug after verifying it on the source.' }
  const exam = await db.exam.findUnique({ where: { slug: examSlug }, select: { id: true, slug: true } })
  if (!exam) return { ok: false, status: 400, error: `Unknown examination slug "${examSlug}" — choose from the examination catalogue.` }

  // Year: candidate's, or curator override; must be in the PYQ range.
  const yearRaw = input.year ?? candidate.year ?? null
  if (yearRaw !== null && (yearRaw < PYQ_YEAR_MIN || yearRaw > PYQ_YEAR_MAX)) {
    return { ok: false, status: 400, error: `Year must be between ${PYQ_YEAR_MIN} and ${PYQ_YEAR_MAX}.` }
  }
  const year = yearRaw

  // Rights: verbatim text must exist — either permitted stored text, or the
  // curator's own supplied text.
  const text = (input.text ?? candidate.verbatimText ?? '').trim()
  if (text.length < PROMOTION_TEXT_MIN) {
    return {
      ok: false,
      status: 400,
      error: 'The question text could not be stored from the source (rights-restricted or unconfirmed). Paste the question text verbatim from the source you verified.',
    }
  }
  if (text.length > PROMOTION_TEXT_MAX) return { ok: false, status: 400, error: 'Question text is too long (max 2000 chars).' }

  const options = (input.options ?? (candidate.optionsJson ? safeOptions(candidate.optionsJson) : null) ?? []).map(o => o.trim()).filter(Boolean)
  if (options.length < 2 || options.length > 6 || options.some(o => o.length > 500)) {
    return { ok: false, status: 400, error: 'Provide 2–6 answer options (max 500 chars each), exactly as printed on the source.' }
  }
  const correctIndex = input.correctIndex ?? candidate.proposedCorrectIndex ?? null
  if (correctIndex === null || correctIndex < 0 || correctIndex >= options.length) {
    return { ok: false, status: 400, error: 'A verified correct answer index is required (from the source or its answer key).' }
  }

  // Global duplicate detection — same contract as the import route.
  const pyqHash = computePyqHash(text, options, correctIndex)
  const existing = await db.question.findFirst({ where: { pyqHash }, select: { id: true } })
  if (existing) {
    return { ok: false, status: 409, error: 'This question already exists in the question bank (duplicate detected).', duplicateOf: existing.id }
  }

  // Catalog ids (optional) — honest failures.
  let stageId = input.stageId ?? null
  let subjectId = input.subjectId ?? null
  let topicId = input.topicId ?? null
  for (const [id, kind] of [[stageId, 'stage'], [subjectId, 'subject'], [topicId, 'topic']] as const) {
    if (!id) continue
    const table = kind === 'stage' ? db.stage : kind === 'subject' ? db.subject : db.topic
    const row = await (table as typeof db.stage).findUnique({ where: { id }, select: { id: true } })
    if (!row) return { ok: false, status: 400, error: `Unknown ${kind} id.` }
  }

  const paperTitle = candidate.paperTitle ?? input.examSlug ?? 'Research-discovered question paper'
  const citation = `${candidate.sourceUrl}${candidate.retrievedAt ? ` (retrieved ${candidate.retrievedAt.toISOString().slice(0, 10)})` : ''}`

  // Batch audit row + Question + candidate state change — one transaction, so
  // the audit trail can never lose the promotion.
  const result = await db.$transaction(async tx => {
    const batch = await tx.pyqImportBatch.create({
      data: {
        paperTitle: paperTitle.slice(0, 200),
        examSlug: exam.slug,
        examLabel: candidate.examLabel ?? exam.slug,
        stageLabel: candidate.stageLabel ?? null,
        subjectLabel: candidate.subjectLabel ?? null,
        year,
        session: candidate.sessionLabel ?? null,
        sourceCitation: citation.slice(0, 500),
        fileName: `research-candidate-${candidate.id}`,
        importedBy: student.id,
        totalRows: 1,
        createdCount: 1,
        duplicateCount: 0,
        failedCount: 0,
        errorsJson: null,
      },
    })
    const question = await tx.question.create({
      data: {
        examId: exam.id,
        stageId,
        subjectId,
        topicId,
        canonicalSlug: `pyq:${exam.slug}:${year ?? 'na'}:candidate-${candidate.id}`,
        text,
        optionsJson: JSON.stringify(options),
        correctIndex,
        explanation: (input.explanation ?? '').trim().slice(0, 4000),
        difficulty: input.difficulty ?? 'MEDIUM',
        language: (input.language ?? 'English').trim().slice(0, 60) || 'English',
        sourceType: 'PYQ_UNVERIFIED',
        verificationStatus: 'UNVERIFIED',
        sourcePaper: paperTitle.slice(0, 200),
        year,
        pyqHash,
        sourceRef: candidate.locator ? `${candidate.locator}${candidate.questionNumber ? ` · ${candidate.questionNumber}` : ''}` : candidate.questionNumber ?? null,
        importedBatchId: batch.id,
        // Phase 3A web-discovery provenance columns
        sessionLabel: candidate.sessionLabel,
        questionNumber: candidate.questionNumber,
        sourceUrl: candidate.sourceUrl,
        sourcePublisher: candidate.sourcePublisher,
        retrievedAt: candidate.retrievedAt,
        answerKeyRef: [candidate.answerKeyUrl, candidate.answerKeyRef].filter(Boolean).join(' · ') || null,
      },
    })
    await tx.researchPyqCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'PROMOTED',
        promotedQuestionId: question.id,
        promotedAt: new Date(),
        pyqHash: pyqHash ?? candidate.pyqHash,
      },
    })
    return { questionId: question.id, batchId: batch.id }
  })

  return { ok: true, questionId: result.questionId, batchId: result.batchId }
}

function safeOptions(json: string): string[] | null {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.map(o => String(o)) : null
  } catch {
    return null
  }
}
