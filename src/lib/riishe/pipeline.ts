// ─── Riishe document pipeline: extraction → structure → grounded analysis ────
// Runs as a background job.
//   Stage 1  extraction (local pdf.js, per-page text with real line breaks)
//   Stage 2  deterministic structure detection (TOC, headings, printed pages)
//   Stage 3  AI analysis over EVERY structure-aware section of the document —
//            there is no "first N pages" limit; a section that fails is
//            recorded and retried without discarding the sections that worked
//   Stage 4  deterministic merge: duplicate topics merged at the data level,
//            page references verified against the extracted page text,
//            coverage accounted honestly (extracted / OCR-needed / failed)
// The uploaded material is untrusted data — every model call fences it.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { readFile, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extractPdfPages, type ExtractedPage } from './extract'
import { detectStructure, type AnalysisUnit } from './structure'
import { canonicalizeTopics, normalizeTitle, type TopicInput } from './dedupe'
import { chatJson, fenceDocumentText, AI_UNAVAILABLE_MESSAGE } from './ai'
import { PIPELINE_VERSION, type DocumentAnalysis, type AnalyzedTopic, type SectionOutcome, type CoverageMetrics } from './types'

const UNIT_CHARS = 6000 // per-model-call section budget

const SYSTEM = `You are Riishe, the document-analysis engine of BEAN EXAMS, a document-first study platform. You analyse student-uploaded study material and produce precise, grounded structured analyses. Never invent content that is not in the provided text. If a field has no content, return an empty array.`

interface SectionAnalysis {
  topics: { name: string; subtopics: string[]; pages: number[] }[]
  definitions: { term: string; meaning: string; page: number }[]
  keyFacts: string[]
  formulas: string[]
  misconceptions: { misconception: string; correction: string; page?: number }[]
  unreadable: string[]
}

/** Analysis JSON including private retry state (_parts is aligned with sectionOutcomes). */
interface StoredAnalysis extends DocumentAnalysis {
  _parts?: (SectionAnalysis | null)[]
}

// ─── Merging helpers (deterministic) ─────────────────────────────────────────

function collectTopicInputs(
  parts: (SectionAnalysis | null)[],
  units: AnalysisUnit[],
  anchoredPages: Map<number, number | null>,
  tocPages: number[] = [],
): TopicInput[] {
  const inputs: TopicInput[] = []
  // Heading-anchored topics: each headed section contributes its own heading
  // as a topic — that is the document's real organisation, not model opinion.
  for (const u of units) {
    if (u.kind === 'SECTION' && u.title) {
      inputs.push({
        name: u.title,
        subtopics: [],
        pages: pagesBetween(u.fromPage, u.toPage),
        unitIndex: u.index,
        unitTitle: u.title,
        unitFromPage: u.fromPage,
        unitToPage: u.toPage,
        anchored: true,
      })
    }
  }
  for (const u of units) {
    const part = parts[u.index]
    if (!part) continue
    // A front-matter unit that contains the document's contents pages yields
    // only INDEX ECHOES ("Eligibility Criteria" from the contents line) —
    // those are a map of the document, not its content. Skip them; the real
    // chapters contribute their own anchored topics.
    const isIndexEcho = u.kind === 'FRONT' && tocPages.some(tp => tp >= u.fromPage && tp <= u.toPage)
    if (isIndexEcho) continue
    for (const t of part.topics ?? []) {
      const name = String(t?.name ?? '').trim()
      if (!name) continue
      inputs.push({
        name,
        subtopics: (t.subtopics ?? []).map(s => String(s)).filter(Boolean),
        pages: (t.pages ?? []).filter(Number.isFinite),
        unitIndex: u.index,
        unitTitle: u.title,
        unitFromPage: u.fromPage,
        unitToPage: u.toPage,
      })
    }
  }
  void anchoredPages
  return inputs
}

function pagesBetween(from: number, to: number): number[] {
  const out: number[] = []
  for (let p = from; p <= to; p++) out.push(p)
  return out
}

function mergeFacts(parts: (SectionAnalysis | null)[], cap: number, pick: (p: SectionAnalysis) => string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    if (!part) continue
    for (const raw of pick(part)) {
      const f = String(raw ?? '').trim()
      if (!f) continue
      const key = normalizeTitle(f).slice(0, 100)
      if (key && seen.has(key)) continue
      seen.add(key)
      out.push(f.slice(0, 400))
      if (out.length >= cap) return out
    }
  }
  return out
}

function mergeDefinitions(parts: (SectionAnalysis | null)[], cap: number): DocumentAnalysis['definitions'] {
  const seen = new Set<string>()
  const out: DocumentAnalysis['definitions'] = []
  for (const part of parts) {
    if (!part) continue
    for (const d of part.definitions ?? []) {
      if (!d?.term || !d?.meaning) continue
      const key = normalizeTitle(String(d.term))
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push({
        term: String(d.term).slice(0, 120),
        meaning: String(d.meaning).slice(0, 500),
        page: Number(d.page) || 0,
      })
      if (out.length >= cap) return out
    }
  }
  return out
}

function mergeMisconceptions(parts: (SectionAnalysis | null)[], cap: number): DocumentAnalysis['misconceptions'] {
  const seen = new Set<string>()
  const out: DocumentAnalysis['misconceptions'] = []
  for (const part of parts) {
    if (!part) continue
    for (const m of part.misconceptions ?? []) {
      if (!m?.misconception || !m?.correction) continue
      const key = normalizeTitle(String(m.misconception)).slice(0, 100)
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push({
        misconception: String(m.misconception).slice(0, 300),
        correction: String(m.correction).slice(0, 400),
        page: Number.isFinite(m.page) ? Number(m.page) : undefined,
      })
      if (out.length >= cap) return out
    }
  }
  return out
}

function mergeUnreadable(parts: (SectionAnalysis | null)[], cap: number): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (!part) continue
    for (const u of part.unreadable ?? []) {
      const s = String(u ?? '').trim()
      if (!s) continue
      out.push(s.slice(0, 200))
      if (out.length >= cap) return out
    }
  }
  return out
}

function buildCoverage(
  extraction: { numPages: number; scannedPages: number },
  readablePages: ExtractedPage[],
  units: AnalysisUnit[],
  outcomes: SectionOutcome[],
): CoverageMetrics {
  const unitPages = (u: AnalysisUnit) => pagesBetween(u.fromPage, u.toPage)
  const okUnits = units.filter((u, i) => outcomes[i]?.status === 'OK')
  const failedUnits = units.filter((u, i) => outcomes[i]?.status === 'FAILED')
  const analysedPageSet = new Set<number>()
  for (const u of okUnits) for (const p of unitPages(u)) analysedPageSet.add(p)
  const readableSet = new Set(readablePages.map(p => p.page))
  const unanalysed = [...readableSet].filter(p => !analysedPageSet.has(p)).length
  return {
    totalPages: extraction.numPages,
    readablePages: readablePages.length,
    scannedPages: extraction.scannedPages,
    analysedPages: analysedPageSet.size,
    unanalysedPages: unanalysed,
    unitsTotal: units.length,
    unitsOk: okUnits.length,
    unitsFailed: failedUnits.length,
    complete: unanalysed === 0 && failedUnits.length === 0 && units.length > 0,
  }
}

function buildCoverageNote(cov: CoverageMetrics): string {
  const bits: string[] = []
  if (cov.complete) {
    bits.push(`All ${cov.readablePages} readable page${cov.readablePages === 1 ? '' : 's'} analysed across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}.`)
  } else {
    bits.push(`Analysed ${cov.analysedPages} of ${cov.readablePages} readable page${cov.readablePages === 1 ? '' : 's'} — ${cov.unitsFailed} section${cov.unitsFailed === 1 ? '' : 's'} failed and can be retried without losing the sections that succeeded.`)
  }
  if (cov.scannedPages > 0) {
    bits.push(`${cov.scannedPages} image-only page${cov.scannedPages === 1 ? '' : 's'} would need OCR, which is not available yet — they are excluded from the analysis.`)
  }
  return bits.join(' ')
}

// ─── Main job ─────────────────────────────────────────────────────────────────

/**
 * Background job: extract text, detect the document's real structure, analyse
 * every section, merge deterministically.
 *  opts.force      — full re-analysis of a READY document (fresh extraction)
 *  partial retry   — a READY v2 analysis with failed sections re-runs ONLY the
 *                    failed sections and keeps every successful result
 */
export async function processDocument(documentId: string, opts?: { force?: boolean }): Promise<void> {
  const force = opts?.force === true
  const doc = await db.studyDocument.findUnique({ where: { id: documentId } })
  if (!doc) return

  const stored = safeParse<StoredAnalysis | null>(doc.analysisJson, null)
  const canPartialRetry =
    !force &&
    doc.status === 'READY' &&
    stored?.pipelineVersion === PIPELINE_VERSION &&
    Array.isArray(stored?._parts) &&
    Array.isArray(stored?.sectionOutcomes) &&
    stored?.coverage?.complete === false

  const allowed = force ? ['QUEUED', 'FAILED', 'NEEDS_OCR', 'READY'] : ['QUEUED', 'FAILED', 'NEEDS_OCR']
  if (!allowed.includes(doc.status) && !canPartialRetry) return

  // Identical-file reuse — only from the SAME pipeline version, so an upgrade
  // always re-analyses instead of copying a stale analysis.
  let twinAnalysisJson: string | null = null
  if (!force && (doc.status === 'FAILED' || doc.status === 'QUEUED')) {
    const twin = await db.studyDocument.findFirst({
      where: { contentHash: doc.contentHash, status: 'READY', id: { not: doc.id } },
      select: { analysisJson: true },
    })
    const twinJson = twin?.analysisJson ?? null
    const twinParsed = safeParse<StoredAnalysis | null>(twinJson, null)
    if (twinParsed?.pipelineVersion === PIPELINE_VERSION && twinParsed.topics) twinAnalysisJson = twinJson
  }

  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      status: 'EXTRACTING',
      statusDetail: canPartialRetry ? 'Preparing to re-analyse the failed sections…' : 'Reading the uploaded file…',
      updatedAt: new Date(),
    },
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

  // ── Stage 1: extraction (re-extract for force / first runs; reuse for partial retry)
  let extraction: Awaited<ReturnType<typeof extractPdfPages>>
  let storedPages: ExtractedPage[] | null = null
  if (canPartialRetry && doc.extractionJson) {
    const parsed = safeParse<ExtractedPage[] | null>(doc.extractionJson, null)
    if (parsed && parsed.length > 0) storedPages = parsed
  }
  if (storedPages) {
    const readable = storedPages.filter(p => !p.scanned && p.text.length > 0)
    extraction = {
      pages: storedPages,
      numPages: doc.pageCount ?? storedPages.length,
      textChars: readable.reduce((s, p) => s + p.text.length, 0),
      scannedPages: storedPages.filter(p => p.scanned).length,
      titleGuess: null,
    }
  } else {
    try {
      extraction = await extractPdfPages(new Uint8Array(buffer))
    } catch (err) {
      console.error('[riishe extract]', err)
      await db.studyDocument.update({
        where: { id: documentId },
        data: {
          status: 'FAILED',
          statusDetail: `This file could not be parsed as a PDF (${err instanceof Error ? err.name : 'unknown error'}). It may be corrupted or not a real PDF.`,
        },
      })
      return
    }
  }

  const readablePages = extraction.pages.filter(p => !p.scanned && p.text.length > 0)
  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      pageCount: extraction.numPages,
      extractionJson: JSON.stringify(extraction.pages),
      status: readablePages.length === 0 ? 'NEEDS_OCR' : 'ANALYSING',
      statusDetail: readablePages.length === 0
        ? 'No extractable text found — every page looks like a scanned image. OCR is not available in BEAN EXAMS yet, so Riishe cannot read this document. Questions cannot be generated from it.'
        : 'Riishe is mapping the document structure…',
    },
  })

  if (readablePages.length === 0) return

  // ── Identical-file reuse (same pipeline version only)
  if (!canPartialRetry && twinAnalysisJson) {
    const analysis = safeParse<StoredAnalysis | null>(twinAnalysisJson, null)
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

  // ── Stage 2: deterministic structure detection
  const structure = detectStructure(extraction.pages, extraction.numPages, { maxUnitChars: UNIT_CHARS })
  const units = structure.units

  if (units.length === 0) {
    await db.studyDocument.update({
      where: { id: documentId },
      data: {
        status: 'NEEDS_OCR',
        statusDetail: 'The PDF has pages but no readable text that Riishe can analyse. OCR is not available yet.',
      },
    })
    return
  }

  // ── Partial retry: reuse stored successful parts, re-run only failures
  let storedParts: (SectionAnalysis | null)[] | null = null
  if (canPartialRetry && stored) {
    const prev = stored._parts ?? []
    const prevOutcomes = stored.sectionOutcomes ?? []
    if (prev.length === units.length && prevOutcomes.length === units.length) {
      storedParts = prev
    }
  }

  // ── Stage 3: analyse every unit (failures recorded, never fatal)
  const parts: (SectionAnalysis | null)[] = new Array(units.length).fill(null)
  if (storedParts) for (let i = 0; i < units.length; i++) parts[i] = storedParts[i]

  let done = 0
  let failedCount = 0
  for (const unit of units) {
    if (parts[unit.index]) continue // preserved from the previous run
    try {
      const part = await analyseUnit(doc.title, unit, units.length)
      parts[unit.index] = part
      done++
    } catch (err) {
      failedCount++
      const rangeLabel = unit.title ? `"${unit.title}"` : `pages ${unit.fromPage}–${unit.toPage}`
      console.error(`[riishe analyse unit ${unit.index + 1}/${units.length} ${rangeLabel}]`, err)
    }
    if ((done + failedCount) % 3 === 0 || done + failedCount === units.length) {
      await db.studyDocument.update({
        where: { id: documentId },
        data: {
          statusDetail: failedCount === 0
            ? `Riishe is analysing the content — section ${done + failedCount} of ${units.length}…`
            : `Riishe is analysing the content — section ${done + failedCount} of ${units.length} (${failedCount} failed so far)…`,
        },
      }).catch(() => {})
    }
  }

  const outcomes: SectionOutcome[] = units.map((u, i) => ({
    index: i,
    title: u.title,
    label: u.title ? `${u.title} (${u.fromPage}${u.toPage !== u.fromPage ? `–${u.toPage}` : ''})` : `pages ${u.fromPage}${u.toPage !== u.fromPage ? `–${u.toPage}` : ''}`,
    fromPage: u.fromPage,
    toPage: u.toPage,
    status: parts[i] ? 'OK' : 'FAILED',
    error: parts[i] ? undefined : 'AI analysis failed for this section',
  }))

  if (parts.every(p => p === null)) {
    // Nothing succeeded — honest, retryable failure (extraction is preserved)
    await db.studyDocument.update({
      where: { id: documentId },
      data: {
        status: 'FAILED',
        statusDetail: `Extraction succeeded (${readablePages.length} readable pages) but AI analysis failed for all ${units.length} section${units.length === 1 ? '' : 's'}: ${AI_UNAVAILABLE_MESSAGE}`,
        extractionJson: JSON.stringify(extraction.pages),
      },
    })
    return
  }

  // ── Stage 4: deterministic merge + verification + coverage
  const pageTextIndex = new Map<number, string>()
  for (const p of extraction.pages) {
    if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
  }

  const topicInputs = collectTopicInputs(parts, units, new Map(), structure.tocPages)
  const topics: AnalyzedTopic[] = canonicalizeTopics(topicInputs, { pageTextIndex, maxTopics: 80, maxSubtopicsPerTopic: 12 })

  // Printed page labels: only when a consistent printed numbering was detected
  // (physical = printed + offset). Never invented — null otherwise.
  if (structure.printed.offset !== null) {
    const off = structure.printed.offset
    for (const t of topics) {
      const labels = t.pages.map(p => p - off).filter(n => n >= 1).map(String)
      if (labels.length === t.pages.length && labels.length > 0) t.printedPages = labels
    }
  }

  const cov = buildCoverage(
    { numPages: extraction.numPages, scannedPages: extraction.scannedPages },
    readablePages,
    units,
    outcomes,
  )

  const merged: StoredAnalysis = {
    title: doc.title,
    summary: '',
    topics,
    definitions: mergeDefinitions(parts, 60),
    keyFacts: mergeFacts(parts, 80, p => p.keyFacts ?? []),
    formulas: mergeFacts(parts, 50, p => p.formulas ?? []),
    misconceptions: mergeMisconceptions(parts, 40),
    keyPages: [...new Set(topics.flatMap(t => t.pages.slice(0, 3)))].filter(p => p >= 1).sort((a, b) => a - b).slice(0, 60),
    unreadableSections: mergeUnreadable(parts, 16),
    studyGaps: [],
    coverageNote: buildCoverageNote(cov),
    pipelineVersion: PIPELINE_VERSION,
    coverage: cov,
    sectionOutcomes: outcomes,
    structure: {
      kind: structure.kind,
      tocValidated: structure.tocValidated,
      tocEntries: structure.toc.length,
      headingCount: structure.headings.length,
      printedPageOffset: structure.printed.offset,
      printedRomanFrontMatter: structure.printed.romanFrontMatter,
    },
    _parts: parts, // retained so a partial retry keeps every successful section
  }
  merged.summary = await summarise(doc.title, extraction.pages, merged)
  merged.studyGaps = deriveStudyGaps(merged, cov)

  const partial = !cov.complete
  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      status: 'READY',
      statusDetail: partial
        ? `Ready (partial) — analysed ${cov.unitsOk}/${cov.unitsTotal} sections covering ${cov.analysedPages} of ${cov.readablePages} readable pages. Retry analysis to cover the rest.`
        : `Ready — ${merged.topics.length} topic${merged.topics.length === 1 ? '' : 's'} across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}; all ${cov.readablePages} readable page${cov.readablePages === 1 ? '' : 's'} analysed.`,
      analysisJson: JSON.stringify(merged),
    },
  })
}

// ─── Per-section analysis ─────────────────────────────────────────────────────

function unitDescriptor(unit: AnalysisUnit): string {
  const range = unit.fromPage === unit.toPage ? `page ${unit.fromPage}` : `pages ${unit.fromPage}–${unit.toPage}`
  if (unit.kind === 'SECTION' && unit.title) return `the section "${unit.title}" (${range} of the uploaded PDF)`
  if (unit.kind === 'FRONT') return `the front matter (${range} of the uploaded PDF)`
  if (unit.kind === 'OVERFLOW') return `an excerpt of ${range} of the uploaded PDF`
  return `${range} of the uploaded PDF`
}

async function analyseUnit(docTitle: string, unit: AnalysisUnit, totalUnits: number): Promise<SectionAnalysis> {
  return chatJson<SectionAnalysis>({
    system: SYSTEM,
    user: `Analyse ${unitDescriptor(unit)} — part ${unit.index + 1} of ${totalUnits} covering the whole document ("${docTitle}"). Extract ONLY what is present in the text below.

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
- "topics": the concrete topics/concepts this text actually covers, using the document's own headings and terminology (3-8 at most; fewer is fine). Topic names must be SHORT noun phrases (≤ 8 words) — never full sentences. Do NOT invent topics, do NOT echo the section title unless the text genuinely develops it, and do NOT promote every heading you see.
- "subtopics": concepts or key terms under each topic found in this text.
- "pages" must cite page numbers from the [page N] markers in the text — never other numbers.
- If this text is from a question paper, answer key or marks scheme, extract the subject areas the questions test (not the questions themselves) and note it in keyFacts.
- "unreadable": list page labels whose text is garbled, truncated or incomprehensible ([] if none).
- "misconceptions": only if the text supports a correction (common wrong belief vs what the text says).
- "formulas": mathematical/scientific formulas or rules stated in the text ([] if none).

${fenceDocumentText(docTitle, unit.text)}`,
  })
}

async function summarise(title: string, pages: ExtractedPage[], merged: StoredAnalysis): Promise<string> {
  // Grounded summary from the first readable pages + identified topic names
  const head = pages
    .filter(p => !p.scanned && p.text)
    .slice(0, 3)
    .map(p => `[page ${p.page}]\n${p.text}`)
    .join('\n\n')
    .slice(0, 3000)
  try {
    const res = await chatJson<{ summary: string }>({
      system: SYSTEM,
      user: `Write a 2–3 sentence summary of this study document ("${title}") for a student, strictly from the text. Return JSON: {"summary": string}

Known topics identified: ${merged.topics.slice(0, 12).map(t => t.name).join(', ') || '(none)'}.

${fenceDocumentText(title, head)}`,
    })
    return String(res.summary ?? '').slice(0, 800)
  } catch {
    // Summary is cosmetic — fall back to a factual non-AI line rather than failing the job
    return `Study document with ${merged.topics.length} identified topic${merged.topics.length === 1 ? '' : 's'}.`
  }
}

function deriveStudyGaps(a: DocumentAnalysis, cov: CoverageMetrics): string[] {
  const gaps: string[] = []
  if (a.topics.length === 0) gaps.push('No clear topics were identified — the text may be too sparse for question generation.')
  if (a.definitions.length === 0) gaps.push('No key definitions were found — you may need supporting material for terminology-heavy questions.')
  if (a.formulas.length === 0) gaps.push('No formulas or rules were detected — calculation-based questions will not be generated.')
  if (a.unreadableSections.length > 0) gaps.push(`${a.unreadableSections.length} section${a.unreadableSections.length === 1 ? '' : 's'} were unreadable and excluded from the analysis.`)
  if (cov.scannedPages > 0) gaps.push(`${cov.scannedPages} image-only page${cov.scannedPages === 1 ? ' needs' : 's need'} OCR to be analysed — OCR is not available yet.`)
  if (!cov.complete) gaps.push(`${cov.unanalysedPages} readable page${cov.unanalysedPages === 1 ? ' is' : 's are'} not yet covered (failed sections) — retry the analysis to include them.`)
  return gaps
}

/** Delete a stored file (used when a document row is removed). */
export async function deleteStoredFile(storedPath: string): Promise<void> {
  try {
    await unlink(storedPath)
  } catch { /* already gone */ }
}
