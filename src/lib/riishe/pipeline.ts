// ─── Riishe document pipeline: extraction → structured analysis ──────────────
// Runs as a background job. Extraction is local pdf.js text parsing; analysis
// uses the configured AI provider over coherent page-aligned sections, then
// merges the per-section results into one structured document analysis.
// The uploaded material is untrusted data — every model call fences it.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { readFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extractPdfPages, sectionPages, type DocSection } from './extract'
import { chatJson, fenceDocumentText, AI_UNAVAILABLE_MESSAGE } from './ai'
import type { DocumentAnalysis, AnalyzedTopic } from './types'

const SECTION_CHARS = 5500
const MAX_ANALYSIS_SECTIONS = 12

const SYSTEM = `You are Riishe, the document-analysis engine of BEAN EXAMS, an Indian competitive-exam preparation platform. You analyse study material and produce precise, grounded structured analyses. Never invent content that is not in the provided text. If a field has no content, return an empty array.`

interface SectionAnalysis {
  topics: { name: string; subtopics: string[]; pages: number[] }[]
  definitions: { term: string; meaning: string; page: number }[]
  keyFacts: string[]
  formulas: string[]
  misconceptions: { misconception: string; correction: string; page?: number }[]
  unreadable: string[]
}

function mergeSectionAnalyses(
  parts: (SectionAnalysis | null)[],
  sections: DocSection[],
  allPages: number,
  analysedPages: number,
): DocumentAnalysis {
  const topics = new Map<string, AnalyzedTopic>()
  const defs: DocumentAnalysis['definitions'] = []
  const facts: string[] = []
  const formulas: string[] = []
  const misconceptions: DocumentAnalysis['misconceptions'] = []
  const unreadable: string[] = []
  const keyPages = new Set<number>()

  for (const part of parts) {
    if (!part) continue
    for (const t of part.topics ?? []) {
      if (!t?.name) continue
      const name = String(t.name).slice(0, 120)
      const existing = topics.get(name.toLowerCase())
      if (existing) {
        const sub = new Set([...existing.subtopics, ...(t.subtopics ?? []).map(s => String(s).slice(0, 120))])
        existing.subtopics = [...sub].slice(0, 12)
        for (const p of t.pages ?? []) if (Number.isFinite(p)) existing.pages = [...new Set([...existing.pages, p])].sort((a, b) => a - b)
      } else {
        topics.set(name.toLowerCase(), {
          name,
          subtopics: (t.subtopics ?? []).map(s => String(s).slice(0, 120)).slice(0, 12),
          pages: [...new Set((t.pages ?? []).filter(Number.isFinite))].sort((a, b) => a - b).slice(0, 30),
        })
      }
    }
    for (const d of part.definitions ?? []) {
      if (!d?.term || !d?.meaning) continue
      if (defs.length < 40) defs.push({ term: String(d.term).slice(0, 120), meaning: String(d.meaning).slice(0, 500), page: Number(d.page) || 0 })
      if (Number.isFinite(d.page)) keyPages.add(Number(d.page))
    }
    for (const f of part.keyFacts ?? []) {
      if (facts.length < 60 && f) facts.push(String(f).slice(0, 400))
    }
    for (const f of part.formulas ?? []) {
      if (formulas.length < 40 && f) formulas.push(String(f).slice(0, 300))
    }
    for (const m of part.misconceptions ?? []) {
      if (misconceptions.length < 30 && m?.misconception && m?.correction) {
        misconceptions.push({
          misconception: String(m.misconception).slice(0, 300),
          correction: String(m.correction).slice(0, 400),
          page: Number.isFinite(m.page) ? Number(m.page) : undefined,
        })
      }
    }
    for (const u of part.unreadable ?? []) {
      if (unreadable.length < 12 && u) unreadable.push(String(u).slice(0, 200))
    }
  }

  // Pages that carry definitions or topics are the ones worth rereading first
  for (const t of topics.values()) for (const p of t.pages.slice(0, 3)) keyPages.add(p)

  const coverage = analysedPages >= allPages
    ? `All ${allPages} readable page${allPages === 1 ? '' : 's'} analysed.`
    : `Analysed ${analysedPages} of ${allPages} readable pages (document size limit) — later pages are available in the viewer but were not analysed.`

  return {
    title: '',
    summary: '',
    topics: [...topics.values()].slice(0, 25),
    definitions: defs,
    keyFacts: facts,
    formulas,
    misconceptions,
    keyPages: [...keyPages].filter(p => p >= 1).sort((a, b) => a - b).slice(0, 40),
    unreadableSections: unreadable,
    studyGaps: [],
    coverageNote: coverage,
  }
}

/** Background job: extract text and build the structured analysis. */
export async function processDocument(documentId: string): Promise<void> {
  const doc = await db.studyDocument.findUnique({ where: { id: documentId } })
  if (!doc || !['QUEUED', 'FAILED', 'NEEDS_OCR'].includes(doc.status)) return

  // Idempotent re-processing: skip if the same content hash is already READY
  // (another upload of the identical file) — reuse is cheaper than redoing.
  let analysisJson: string | null = null
  if (doc.status === 'FAILED' || doc.status === 'QUEUED') {
    const twin = await db.studyDocument.findFirst({
      where: { contentHash: doc.contentHash, status: 'READY', id: { not: doc.id } },
      select: { analysisJson: true, pageCount: true },
    })
    if (twin?.analysisJson) analysisJson = twin.analysisJson
  }

  await db.studyDocument.update({
    where: { id: documentId },
    data: { status: 'EXTRACTING', statusDetail: 'Reading the uploaded file…', updatedAt: new Date() },
  })

  let buffer: Buffer
  try {
    buffer = await readFile(doc.storedPath)
  } catch {
    await db.studyDocument.update({
      where: { id: documentId },
      data: { status: 'FAILED', statusDetail: 'The stored file could not be read. Please upload it again.' },
    })
    return
  }

  // Verify the stored content still matches its hash (integrity)
  const hash = createHash('sha256').update(buffer).digest('hex')
  if (hash !== doc.contentHash) {
    await db.studyDocument.update({
      where: { id: documentId },
      data: { status: 'FAILED', statusDetail: 'Stored file failed its integrity check. Please upload it again.' },
    })
    return
  }

  // ── Stage 1: extraction ──
  let extraction
  try {
    extraction = await extractPdfPages(new Uint8Array(buffer))
  } catch (err) {
    console.error('[riishe extract]', err)
    await db.studyDocument.update({
      where: { id: documentId },
      data: { status: 'FAILED', statusDetail: `This file could not be parsed as a PDF (${err instanceof Error ? err.name : 'unknown error'}). It may be corrupted or not a real PDF.` },
    })
    return
  }

  const readablePages = extraction.pages.filter(p => !p.scanned)
  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      pageCount: extraction.numPages,
      extractionJson: JSON.stringify(extraction.pages),
      status: readablePages.length === 0 ? 'NEEDS_OCR' : 'ANALYSING',
      statusDetail: readablePages.length === 0
        ? 'No extractable text found — every page looks like a scanned image. OCR is not available in BEAN EXAMS yet, so Riishe cannot read this document. Questions cannot be generated from it.'
        : 'Riishe is analysing the content…',
    },
  })

  if (readablePages.length === 0) return

  // ── Identical-file reuse: adopt the twin analysis, adjusted for title ──
  if (analysisJson) {
    const analysis = safeParse<DocumentAnalysis | null>(analysisJson, null)
    if (analysis) {
      analysis.title = analysis.title || doc.title
      await db.studyDocument.update({
        where: { id: documentId },
        data: {
          status: 'READY',
          statusDetail: `Ready — analysis reused from an identical upload (${extraction.numPages} pages).`,
          analysisJson: JSON.stringify(analysis),
        },
      })
      return
    }
  }

  // ── Stage 2: AI analysis over sections ──
  const sections = sectionPages(extraction.pages, { maxChars: SECTION_CHARS, maxSections: MAX_ANALYSIS_SECTIONS })
  const analysedPages = sections.reduce((s, sec) => s + (sec.toPage - sec.fromPage + 1), 0)

  if (sections.length === 0) {
    await db.studyDocument.update({
      where: { id: documentId },
      data: {
        status: 'NEEDS_OCR',
        statusDetail: 'The PDF has pages but no readable text that Riishe can analyse. OCR is not available yet.',
      },
    })
    return
  }

  const parts: (SectionAnalysis | null)[] = []
  try {
    // Analyse sections sequentially (the provider prefers it and it keeps memory low)
    for (const sec of sections) {
      const part = await chatJson<SectionAnalysis>({
        system: SYSTEM,
        user: `Analyse this excerpt of a study document (${sec.label}). Extract ONLY what is present in the text.

Return JSON with this exact shape:
{
  "topics": [{"name": string, "subtopics": string[], "pages": number[]}],
  "definitions": [{"term": string, "meaning": string, "page": number}],
  "keyFacts": string[],
  "formulas": string[],
  "misconceptions": [{"misconception": string, "correction": string, "page": number}],
  "unreadable": string[]
}

Rules:
- "pages" must cite page numbers from the [page N] markers in the text.
- "unreadable": list page labels whose text is garbled, truncated or incomprehensible ([] if none).
- "misconceptions": only if the text supports a correction (common wrong belief vs what the text says).
- "formulas": mathematical/scientific formulas or rules stated in the text ([] if none).

${fenceDocumentText(doc.title, sec.text)}`,
      })
      parts.push(part)
    }
  } catch (err) {
    // Honest failure: keep the extraction, mark analysis as failed (retryable)
    console.error('[riishe analyse]', err)
    await db.studyDocument.update({
      where: { id: documentId },
      data: {
        status: 'FAILED',
        statusDetail: `Extraction succeeded but AI analysis failed: ${AI_UNAVAILABLE_MESSAGE}`,
        extractionJson: JSON.stringify(extraction.pages),
      },
    })
    return
  }

  const merged = mergeSectionAnalyses(parts, sections, readablePages.length, analysedPages)
  merged.title = doc.title
  merged.summary = await summarise(doc.title, sections, merged)
  merged.studyGaps = deriveStudyGaps(merged)

  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      status: 'READY',
      statusDetail: `Ready — ${merged.topics.length} topic${merged.topics.length === 1 ? '' : 's'} identified across ${analysedPages} page${analysedPages === 1 ? '' : 's'}.`,
      analysisJson: JSON.stringify(merged),
    },
  })
}

async function summarise(title: string, sections: DocSection[], merged: DocumentAnalysis): Promise<string> {
  // Short grounded summary from the first section + identified topic names
  const head = sections[0]?.text.slice(0, 3000) ?? ''
  try {
    const res = await chatJson<{ summary: string }>({
      system: SYSTEM,
      user: `Write a 2–3 sentence summary of this study document ("${title}") for a student, strictly from the text. Return JSON: {"summary": string}

Known topics identified: ${merged.topics.map(t => t.name).join(', ') || '(none)'}.

${fenceDocumentText(title, head)}`,
    })
    return String(res.summary ?? '').slice(0, 800)
  } catch {
    // Summary is cosmetic — fall back to a factual non-AI line rather than failing the job
    return `Study document with ${merged.topics.length} identified topic${merged.topics.length === 1 ? '' : 's'}.`
  }
}

function deriveStudyGaps(a: DocumentAnalysis): string[] {
  const gaps: string[] = []
  if (a.topics.length === 0) gaps.push('No clear topics were identified — the text may be too sparse for question generation.')
  if (a.definitions.length === 0) gaps.push('No key definitions were found — you may need supporting material for terminology-heavy questions.')
  if (a.formulas.length === 0) gaps.push('No formulas or rules were detected — calculation-based questions will not be generated.')
  if (a.unreadableSections.length > 0) gaps.push(`${a.unreadableSections.length} section${a.unreadableSections.length === 1 ? '' : 's'} were unreadable and excluded from the analysis.`)
  return gaps
}

/** Delete a stored file (used when a document row is removed). */
export async function deleteStoredFile(storedPath: string): Promise<void> {
  try {
    await unlink(storedPath)
  } catch { /* already gone */ }
}
