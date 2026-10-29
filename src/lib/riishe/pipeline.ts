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
import { detectStructure, detectContentlessPages, extractNumberToken, stripEntryTitle, type AnalysisUnit } from './structure'
import { canonicalizeTopics, normalizeTitle, type TopicInput } from './dedupe'
import { chatJson, fenceDocumentText, AI_UNAVAILABLE_MESSAGE, isContentFilterError, isRateLimitError } from './ai'
import { PIPELINE_VERSION, type DocumentAnalysis, type AnalyzedTopic, type SectionOutcome, type CoverageMetrics, type StructureTocEntry, type StructureGroup, type TopicItemClass } from './types'

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

/** Contents-table facts looked up by section title, attached to anchored topics. */
interface TocInfo {
  number: string | null
  printedPage: number | null
  printedPageEnd: number | null
  matchPage: number | null
  matched: boolean
  group: StructureGroup | null
  boundaryEvidence: string | null
}

export function buildTocInfoMap(tocLayer: StructureTocEntry[]): Map<string, TocInfo> {
  const map = new Map<string, TocInfo>()
  for (const e of tocLayer) {
    const key = normalizeTitle(stripEntryTitle(e.title))
    if (key && !map.has(key)) {
      map.set(key, {
        number: e.number,
        printedPage: e.printedPage,
        printedPageEnd: e.printedPageEnd ?? null,
        matchPage: e.matchPage,
        matched: e.matched,
        group: e.group ?? null,
        boundaryEvidence: e.boundaryEvidence ?? null,
      })
    }
  }
  return map
}

export function collectTopicInputs(
  parts: (SectionAnalysis | null)[],
  units: AnalysisUnit[],
  anchoredPages: Map<number, number | null>,
  tocPages: number[] = [],
  tocInfo: Map<string, TocInfo> = new Map(),
  tocLayer: StructureTocEntry[] = [],
): TopicInput[] {
  const inputs: TopicInput[] = []
  void anchoredPages
  // Per-unit classification: reference-list / question-group units colour the
  // topics the model finds inside them (keywords from a city list are table
  // entries, not organic study topics).
  const classOfUnit = new Map<number, TopicItemClass | null>()
  for (const u of units) {
    classOfUnit.set(u.index, classifyUnit(u))
  }
  // Heading-anchored topics: each headed section contributes its own heading
  // as a topic — that is the document's real organisation, not model opinion.
  // The topic keeps the document's exact wording, numbering and (when the
  // document has a contents table) the entry's own match record.
  for (const u of units) {
    if (u.kind === 'SECTION' && u.title) {
      const info = tocInfo.get(normalizeTitle(u.title))
      inputs.push({
        name: u.title,
        subtopics: [],
        pages: pagesBetween(u.fromPage, u.toPage),
        unitIndex: u.index,
        unitTitle: u.title,
        unitFromPage: u.fromPage,
        unitToPage: u.toPage,
        anchored: true,
        origin: 'SOURCE_HEADING',
        titleSource: info ? 'toc' : 'body',
        numbering: extractNumberToken(u.title),
        tocPrintedPage: info?.printedPage ?? null,
        tocPrintedEndPage: info?.printedPageEnd ?? null,
        tocMatchPage: info?.matchPage ?? null,
        structureVerified: info ? info.matched : true,
        group: info?.group ?? undefined,
        boundaryEvidence: info?.boundaryEvidence ?? undefined,
      })
    }
  }
  // Source SUBSECTIONS: numbered x.y rows of the document's own contents
  // table. They are part of the original structure — surfaced as topics so
  // the hierarchy matches the document, always under their containing
  // section, never mixed into the AI-inferred layer.
  const unitOfPage = (page: number): AnalysisUnit | null => {
    for (const u of units) if (page >= u.fromPage && page <= u.toPage) return u
    return null
  }
  let lastMajorTitle: string | null = null
  for (const e of tocLayer) {
    if (e.level === 1) {
      const stripped = stripEntryTitle(e.title)
      lastMajorTitle = stripped
      continue
    }
    if (e.startPage == null) continue
    const parentTitle = lastMajorTitle
    const spanFrom = e.startPage
    const spanTo = e.endPage ?? e.startPage
    const container = unitOfPage(spanFrom) ?? unitOfPage(spanTo)
    inputs.push({
      name: e.title,
      subtopics: [],
      pages: pagesBetween(spanFrom, Math.max(spanFrom, spanTo)),
      unitIndex: container?.index ?? 0,
      unitTitle: parentTitle,
      unitFromPage: spanFrom,
      unitToPage: Math.max(spanFrom, spanTo),
      origin: 'SOURCE_HEADING',
      titleSource: 'toc',
      numbering: e.number,
      tocPrintedPage: e.printedPage,
      tocPrintedEndPage: e.printedPageEnd ?? null,
      tocMatchPage: e.matchPage,
      structureVerified: e.matched,
      itemClass: 'SOURCE_SUBSECTION',
      group: e.group ?? undefined,
      parentTitle,
      boundaryEvidence: e.boundaryEvidence ?? undefined,
    })
  }
  const tocPageSet = new Set(tocPages)
  for (const u of units) {
    const part = parts[u.index]
    if (!part) continue
    // Topics the model claims ONLY on the document's own contents pages are
    // INDEX ECHOES ("Eligibility Criteria" from the contents line) — a map of
    // the document, not its content. Page-level check: real front-matter
    // content around the contents table (vision/mission pages) is still kept.
    const isFront = u.kind === 'FRONT'
    const unitClass = classOfUnit.get(u.index) ?? null
    for (const t of part.topics ?? []) {
      const name = String(t?.name ?? '').trim()
      if (!name) continue
      const claimed = (t.pages ?? []).filter(Number.isFinite)
      if (isFront && claimed.length > 0 && claimed.every(p => tocPageSet.has(p))) continue
      inputs.push({
        name,
        subtopics: (t.subtopics ?? []).map(s => String(s)).filter(Boolean),
        pages: claimed,
        unitIndex: u.index,
        unitTitle: u.title,
        unitFromPage: u.fromPage,
        unitToPage: u.toPage,
        origin: 'AI_INFERRED',
        titleSource: 'inferred',
        itemClass: unitClass ?? undefined,
      })
    }
  }
  return inputs
}

/**
 * Deterministic unit classification for topic chips (§ item classes):
 *   • reference lists (abbreviations, city rosters, fee tables) are mostly
 *     short lines — topics from them are TABLE_OR_LIST entries;
 *   • question-paper-style units (numbered question lines) yield
 *     QUESTION_GROUP topics;
 *   • everything else lets the origin/verification decide (learning topic or
 *     unclassified-needs-review).
 */
function classifyUnit(u: AnalysisUnit): TopicItemClass | null {
  const lines = u.text.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 5) return null
  let questionLines = 0
  for (const l of lines) if (/^\d{1,3}[.)]\s+(.{10,})$/.test(l)) questionLines++
  if (questionLines >= 3 && questionLines / lines.length >= 0.12) return 'QUESTION_GROUP'
  const short = lines.filter(l => l.length <= 40).length
  if (short / lines.length >= 0.65 && lines.length >= 8) return 'TABLE_OR_LIST'
  return null
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
  extraction: { numPages: number; scannedPages: number; pages: ExtractedPage[] },
  readablePages: ExtractedPage[],
  units: AnalysisUnit[],
  outcomes: SectionOutcome[],
  contentlessSet: Set<number>,
  tocLayer: StructureTocEntry[],
): CoverageMetrics {
  const unitPages = (u: AnalysisUnit) => pagesBetween(u.fromPage, u.toPage)
  const okUnits = units.filter((u, i) => outcomes[i]?.status === 'OK')
  const failedUnits = units.filter((u, i) => outcomes[i]?.status === 'FAILED')
  const skippedUnits = units.filter((u, i) => outcomes[i]?.status === 'SKIPPED')
  const accountedPageSet = new Set<number>()
  for (const u of okUnits) for (const p of unitPages(u)) accountedPageSet.add(p)
  const skippedPageSet = new Set<number>()
  for (const u of skippedUnits) for (const p of unitPages(u)) skippedPageSet.add(p)
  const readableSet = new Set(readablePages.map(p => p.page))
  // v5: pages whose extracted text is only running furniture are counted in
  // their own bucket — they were never analysable content, so counting them
  // as "analysed pages" inflated semantic coverage.
  const contentPages = [...readableSet].filter(p => !contentlessSet.has(p))
  const contentlessInUnits = [...contentlessSet].filter(p => readableSet.has(p)).length
  const unanalysed = contentPages.filter(p => !accountedPageSet.has(p) && !skippedPageSet.has(p)).length
  // Extraction-level honesty: pages the extractor could not read at all, and
  // pages that were never attempted because the document exceeds the safety
  // cap. Both are distinct from image-only pages and both block "complete".
  const failedExtractionPages = extraction.pages.filter(p => p.outcome === 'failed').length
  const notExtractedPages = Math.max(0, extraction.numPages - extraction.pages.length)
  const matchedEntries = tocLayer.filter(e => e.matched)
  return {
    totalPages: extraction.numPages,
    readablePages: readablePages.length,
    scannedPages: extraction.scannedPages,
    contentlessPages: contentlessInUnits,
    analysedPages: accountedPageSet.size - [...contentlessSet].filter(p => accountedPageSet.has(p)).length,
    unanalysedPages: unanalysed,
    skippedPages: contentPages.filter(p => skippedPageSet.has(p)).length,
    failedExtractionPages,
    notExtractedPages,
    unitsTotal: units.length,
    unitsOk: okUnits.length,
    unitsFailed: failedUnits.length,
    unitsSkipped: skippedUnits.length,
    complete: unanalysed === 0 && failedUnits.length === 0 && units.length > 0 &&
      failedExtractionPages === 0 && notExtractedPages === 0,
    tocDiscovered: tocLayer.length,
    tocMatchedHeadings: matchedEntries.length,
    tocVerifiedStarts: matchedEntries.filter(e => e.startStatus === 'VERIFIED').length,
    tocInferredStarts: tocLayer.filter(e => e.startStatus === 'INFERRED').length,
    tocUnresolved: tocLayer.filter(e => e.startStatus === 'UNRESOLVED').length,
  }
}

function buildCoverageNote(cov: CoverageMetrics): string {
  const bits: string[] = []
  if (cov.unitsFailed > 0) {
    bits.push(`Analysed ${cov.analysedPages} of ${cov.readablePages - (cov.contentlessPages ?? 0)} content page${cov.readablePages - (cov.contentlessPages ?? 0) === 1 ? '' : 's'} — ${cov.unitsFailed} section${cov.unitsFailed === 1 ? '' : 's'} failed and can be retried without losing the sections that succeeded.`)
  } else if (cov.unitsSkipped > 0) {
    bits.push(`All content pages accounted for: ${cov.analysedPages} analysed across ${cov.unitsOk} section${cov.unitsOk === 1 ? '' : 's'}, ${cov.skippedPages} page${cov.skippedPages === 1 ? '' : 's'} in ${cov.unitsSkipped} section${cov.unitsSkipped === 1 ? '' : 's'} skipped with a recorded reason (see below).`)
  } else {
    bits.push(`All ${cov.analysedPages} content page${cov.analysedPages === 1 ? '' : 's'} analysed across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}.`)
  }
  if ((cov.contentlessPages ?? 0) > 0) {
    bits.push(`${cov.contentlessPages} page${(cov.contentlessPages ?? 0) === 1 ? ' carries' : 's carry'} only running headers/footers (the content itself is an image) — accounted separately, never counted as analysed content.`)
  }
  if (cov.failedExtractionPages > 0) {
    bits.push(`${cov.failedExtractionPages} page${cov.failedExtractionPages === 1 ? ' could' : 's could'} not be read by the PDF extractor at all (renderer failure) — ${cov.failedExtractionPages === 1 ? 'it is' : 'they are'} reported separately from image-only pages and excluded from the analysis.`)
  }
  if (cov.notExtractedPages > 0) {
    bits.push(`The document has ${cov.totalPages} pages but only the first ${cov.totalPages - cov.notExtractedPages} could be processed in this environment — the remaining ${cov.notExtractedPages} were never read and are not part of this analysis.`)
  }
  if (cov.scannedPages > 0) {
    bits.push(`${cov.scannedPages} image-only page${cov.scannedPages === 1 ? '' : 's'} would need OCR, which is not available yet — ${cov.scannedPages === 1 ? 'it is' : 'they are'} excluded from the analysis.`)
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
      failedPages: storedPages.filter(p => p.outcome === 'failed').length,
      extractionLimited: false, // a stored extraction was already accepted in full
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
  const extractionNote = extraction.failedPages > 0
    ? ` ${extraction.failedPages} page${extraction.failedPages === 1 ? ' could' : 's could'} not be read by the PDF extractor and ${extraction.failedPages === 1 ? 'is' : 'are'} excluded from the analysis.`
    : ''
  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      pageCount: extraction.numPages,
      extractionJson: JSON.stringify(extraction.pages),
      status: readablePages.length === 0 ? 'NEEDS_OCR' : 'ANALYSING',
      statusDetail: readablePages.length === 0
        ? `No extractable text found — every page looks like a scanned image or could not be read (${extraction.scannedPages} image-only, ${extraction.failedPages} extraction failures). OCR is not available in BEAN EXAMS yet, so Riishe cannot read this document. Questions cannot be generated from it.`
        : `Riishe is mapping the document structure…${extractionNote}`,
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

  // ── Partial retry: reuse stored successful parts, re-run only failures.
  // Previously SKIPPED units are terminal (their refusal reason is recorded);
  // carrying the decision over keeps retries convergent instead of re-asking
  // the provider to refuse the same text again.
  const skipReasons = new Map<number, string>()
  let storedParts: (SectionAnalysis | null)[] | null = null
  if (canPartialRetry && stored) {
    const prev = stored._parts ?? []
    const prevOutcomes = stored.sectionOutcomes ?? []
    if (prev.length === units.length && prevOutcomes.length === units.length) {
      storedParts = prev
      for (let i = 0; i < prevOutcomes.length; i++) {
        if (prevOutcomes[i]?.status === 'SKIPPED' && prevOutcomes[i]?.error) {
          skipReasons.set(i, prevOutcomes[i].error as string)
        }
      }
    }
  }

  // ── Stage 3: analyse every unit (failures recorded, never fatal)
  const parts: (SectionAnalysis | null)[] = new Array(units.length).fill(null)
  if (storedParts) for (let i = 0; i < units.length; i++) parts[i] = storedParts[i]

  let done = 0
  let failedCount = 0
  let skippedCount = 0
  for (const unit of units) {
    if (parts[unit.index]) continue // preserved from the previous run
    if (skipReasons.has(unit.index)) continue // terminal skip carried over
    const res = await analyseSection(doc.title, unit, units.length)
    if (res.part) {
      parts[unit.index] = res.part
      done++
    } else if (res.skippedReason) {
      skippedCount++
      skipReasons.set(unit.index, res.skippedReason)
    } else {
      failedCount++
    }
    const settled = done + failedCount + skippedCount
    if (settled % 3 === 0 || settled === units.length) {
      const extras = [
        failedCount > 0 ? `${failedCount} failed` : null,
        skippedCount > 0 ? `${skippedCount} skipped` : null,
      ].filter(Boolean).join(', ')
      await db.studyDocument.update({
        where: { id: documentId },
        data: {
          statusDetail: extras
            ? `Riishe is analysing the content — section ${settled} of ${units.length} (${extras})…`
            : `Riishe is analysing the content — section ${settled} of ${units.length}…`,
        },
      }).catch(() => {})
    }
  }

  const outcomes: SectionOutcome[] = units.map((u, i) => {
    const range = `${u.fromPage}${u.toPage !== u.fromPage ? `–${u.toPage}` : ''}`
    const label = u.title ? `${u.title} (${range})` : `pages ${range}`
    if (parts[i]) return { index: i, title: u.title, label, fromPage: u.fromPage, toPage: u.toPage, status: 'OK' as const }
    if (skipReasons.has(i)) return { index: i, title: u.title, label, fromPage: u.fromPage, toPage: u.toPage, status: 'SKIPPED' as const, error: skipReasons.get(i) }
    return { index: i, title: u.title, label, fromPage: u.fromPage, toPage: u.toPage, status: 'FAILED' as const, error: 'AI analysis failed for this section' }
  })

  if (parts.every(p => p === null)) {
    // Nothing succeeded — honest, retryable failure (extraction is preserved).
    // A skip-only outcome (every unit skipped with reason) is still honest
    // READY-partial, not FAILED: the extraction worked, the provider refused.
    const allSkipped = skipReasons.size === units.length
    if (!allSkipped) {
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
  }

  // ── Stage 4: deterministic merge + verification + coverage
  const pageTextIndex = new Map<number, string>()
  for (const p of extraction.pages) {
    if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
  }

  // v5: pages whose extracted text is only running headers/footers (the real
  // content is an image). Evidence list stored with the analysis; coverage
  // counts them in their own bucket instead of "analysed content".
  const contentlessPages = detectContentlessPages(extraction.pages)
  const contentlessSet = new Set(contentlessPages)

  const topicInputs = collectTopicInputs(parts, units, new Map(), structure.tocPages, buildTocInfoMap(structure.tocLayer), structure.tocLayer)
  const topics: AnalyzedTopic[] = canonicalizeTopics(topicInputs, { pageTextIndex, maxTopics: 200, maxSubtopicsPerTopic: 12 })

  // v5: per-topic page-mapping status + printed-range bookkeeping for
  // structural entries — honest VERIFIED / INFERRED / UNRESOLVED labels.
  for (const t of topics) {
    if (t.origin !== 'SOURCE_HEADING') continue
    if (t.tocMatchPage != null) {
      t.pageMapping = 'VERIFIED'
    } else if (t.titleSource === 'body' && t.pages.length > 0) {
      // anchored at a page where the heading line itself was found
      t.pageMapping = 'VERIFIED'
    } else {
      t.pageMapping = t.pages.length > 0 ? 'INFERRED' : 'UNRESOLVED'
    }
  }

  // Printed page labels: per-page labels actually READ from the page edges
  // take precedence (evidence, never derived); the detected offset is the
  // fallback for pages whose label was not printed. Nothing is invented.
  {
    const edgeLabels = structure.printed.labels ?? {}
    const off = structure.printed.offset
    for (const t of topics) {
      if (t.pages.length === 0) continue
      const direct = t.pages.map(p => edgeLabels[p]).filter((s): s is string => !!s)
      if (direct.length === t.pages.length) {
        t.printedPages = direct
        continue
      }
      if (off !== null) {
        const labels = t.pages.map(p => p - off).filter(n => n >= 1).map(String)
        if (labels.length === t.pages.length) t.printedPages = labels
      }
    }
  }

  const cov = buildCoverage(
    { numPages: extraction.numPages, scannedPages: extraction.scannedPages, pages: extraction.pages },
    readablePages,
    units,
    outcomes,
    contentlessSet,
    structure.tocLayer,
  )

  // v5: per-group processing accounting — an entry is OK when every one of
  // its analysable pages sits in a successful unit; partial when some do.
  const groupStats = buildGroupStats(structure.tocLayer, outcomes, extraction.pages, contentlessSet)

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
      // the ORIGINAL-STRUCTURE layer: the document's own contents entries with
      // body-match status, its body headings, and the printed page labels that
      // were actually read — recorded, never silently dropped
      toc: structure.tocLayer.slice(0, 200),
      headings: structure.headings.slice(0, 120).map(h => ({ title: h.title, page: h.page, level: h.level, fromToc: h.fromToc })),
      tocMatched: structure.tocLayer.filter(e => e.matched).length,
      tocUnmatched: structure.tocLayer.filter(e => !e.matched).length,
      printedLabels: structure.printed.labels,
      tocPages: structure.tocPages,
      contentlessPages,
      groupStats,
    },
    _parts: parts, // retained so a partial retry keeps every successful section
  }
  merged.summary = await summarise(doc.title, extraction.pages, merged)
  merged.studyGaps = deriveStudyGaps(merged, cov)

  const partial = !cov.complete
  const contentPages = cov.readablePages - (cov.contentlessPages ?? 0)
  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      status: 'READY',
      statusDetail: partial
        ? `Ready (partial) — analysed ${cov.unitsOk}/${cov.unitsTotal} sections covering ${cov.analysedPages} of ${contentPages} content pages${cov.unitsSkipped > 0 ? `; ${cov.unitsSkipped} section${cov.unitsSkipped === 1 ? '' : 's'} skipped with reason` : ''}. ${cov.unitsFailed > 0 ? 'Retry analysis to cover the rest.' : ''}`.trim()
        : `Ready — ${merged.topics.length} topic${merged.topics.length === 1 ? '' : 's'} across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}; all ${contentPages} content page${contentPages === 1 ? '' : 's'} accounted for${cov.unitsSkipped > 0 ? ` (${cov.unitsSkipped} skipped with reason)` : ''}${(cov.contentlessPages ?? 0) > 0 ? `; ${(cov.contentlessPages ?? 0)} image-content page${(cov.contentlessPages ?? 0) === 1 ? '' : 's'} accounted separately` : ''}.`,
      analysisJson: JSON.stringify(merged),
    },
  })
}

// ─── Group accounting ─────────────────────────────────────────────────────────

/**
 * Per-group (front matter / chapters / appendices / other) processing status
 * over the document's own contents entries. An entry is:
 *   • OK      — every one of its analysable pages sits in a successful unit;
 *   • partial — some pages analyse, others failed/skipped/pending;
 *   • failed  — no page of it was analysed;
 *   • notAnalysable — its span holds NO analysable content at all (image-only
 *     reprint): nothing to analyse, distinct from a processing failure.
 * Image-only, contentless and failed-extraction pages are excluded from the
 * denominator (they are accounted at the extraction level, not semantic).
 */
export function buildGroupStats(
  tocLayer: StructureTocEntry[],
  outcomes: SectionOutcome[],
  extractionPages: ExtractedPage[],
  contentlessSet: Set<number>,
): { group: StructureGroup; total: number; ok: number; partial: number; failed: number; notAnalysable: number }[] {
  const statusByPage = new Map<number, 'OK' | 'FAILED' | 'SKIPPED' | 'NONE'>()
  for (let p = 1; p <= 4000; p++) statusByPage.set(p, 'NONE')
  for (const o of outcomes) {
    for (let p = o.fromPage; p <= o.toPage; p++) statusByPage.set(p, o.status)
  }
  const analysable = new Set(
    extractionPages.filter(p => !p.scanned && p.text.length > 0 && !contentlessSet.has(p.page)).map(p => p.page),
  )
  const groups: StructureGroup[] = ['FRONT', 'CHAPTER', 'APPENDIX', 'OTHER']
  const out: { group: StructureGroup; total: number; ok: number; partial: number; failed: number; notAnalysable: number }[] = []
  for (const group of groups) {
    const entries = tocLayer.filter(e => (e.group ?? 'OTHER') === group)
    if (entries.length === 0) continue
    let ok = 0
    let partial = 0
    let failed = 0
    let notAnalysable = 0
    for (const e of entries) {
      const from = e.startPage ?? e.physicalPage
      const to = Math.max(from ?? 0, e.endPage ?? e.physicalPage ?? from ?? 0)
      if (from == null) { failed++; continue }
      const pages: number[] = []
      for (let p = from; p <= to; p++) if (analysable.has(p)) pages.push(p)
      if (pages.length === 0) { notAnalysable++; continue } // image-only span — nothing to analyse
      const okCount = pages.filter(p => statusByPage.get(p) === 'OK').length
      const skipCount = pages.filter(p => statusByPage.get(p) === 'SKIPPED').length
      if (okCount === pages.length) ok++
      else if (okCount > 0 || skipCount > 0) partial++
      else failed++
    }
    out.push({ group, total: entries.length, ok, partial, failed, notAnalysable })
  }
  return out
}

// ─── Per-section analysis ─────────────────────────────────────────────────────

type SectionResult =
  | { part: SectionAnalysis; skippedReason?: undefined }
  | { part: null; skippedReason: string }
  | { part: null; skippedReason?: undefined }

const RATE_LIMIT_BACKOFF_MS = 15_000

/**
 * Analyse one unit with provider-failure strategies that keep the pipeline
 * honest AND convergent:
 *   • 429 rate limiting → ONE bounded 15 s backoff, then give up (the section
 *     stays FAILED and the existing partial-retry path covers it);
 *   • provider content filter (some legitimate dense name/term lists trip it
 *     and an identical retry can NEVER succeed) → split the unit into smaller
 *     page-range sub-chunks and analyse each independently, merging what the
 *     provider accepts; if every sub-chunk is refused, the unit is SKIPPED
 *     with a recorded reason instead of looping as FAILED forever.
 */
async function analyseSection(docTitle: string, unit: AnalysisUnit, totalUnits: number): Promise<SectionResult> {
  try {
    return { part: await analyseUnit(docTitle, unit, totalUnits) }
  } catch (err) {
    if (isRateLimitError(err)) {
      console.warn(`[riishe analyse unit ${unit.index + 1}/${totalUnits}] rate limited — backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s once`)
      await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS))
      try {
        return { part: await analyseUnit(docTitle, unit, totalUnits) }
      } catch (err2) {
        if (!isContentFilterError(err2)) {
          console.error(`[riishe analyse unit ${unit.index + 1}/${totalUnits} ${unit.title ?? `pages ${unit.fromPage}-${unit.toPage}`}]`, err2)
          return { part: null }
        }
        err = err2
      }
    }
    if (!isContentFilterError(err)) {
      console.error(`[riishe analyse unit ${unit.index + 1}/${totalUnits} ${unit.title ?? `pages ${unit.fromPage}-${unit.toPage}`}]`, err)
      return { part: null }
    }
  }

  // Content-filter refusal → try smaller page-range sub-chunks of this unit.
  const subChunks = splitUnitPages(unit)
  if (subChunks.length <= 1) {
    return {
      part: null,
      skippedReason: 'The AI provider\'s safety filter refused to process this section\'s text (dense lists of names or categories are a known trigger). Its pages are accounted as skipped, not analysed — no content was invented for them.',
    }
  }
  console.warn(`[riishe analyse unit ${unit.index + 1}/${totalUnits}] content-filtered — retrying as ${subChunks.length} sub-chunks`)
  const mergedParts: SectionAnalysis[] = []
  for (const [i, chunk] of subChunks.entries()) {
    try {
      mergedParts.push(await analyseUnit(docTitle, chunk, totalUnits))
    } catch (chunkErr) {
      if (!isContentFilterError(chunkErr)) {
        console.error(`[riishe analyse unit ${unit.index + 1}/${totalUnits} sub-chunk ${i + 1}/${subChunks.length}]`, chunkErr)
      }
      // filter-refused sub-chunks are dropped; remaining chunks still count
    }
  }
  if (mergedParts.length === 0) {
    return {
      part: null,
      skippedReason: `The AI provider's safety filter refused this section's text in full and in ${subChunks.length} smaller parts (dense lists of names or categories are a known trigger). Its pages are accounted as skipped, not analysed — no content was invented for them.`,
    }
  }
  return { part: mergeSectionAnalyses(mergedParts) }
}

/** Split a unit into 2–4 page-range sub-chunks (halves, quarters for 8+ pages). */
export function splitUnitPages(unit: AnalysisUnit): AnalysisUnit[] {
  const pageCount = unit.toPage - unit.fromPage + 1
  if (pageCount < 2) return [unit]
  const parts = pageCount >= 8 ? 4 : 2
  const size = Math.ceil(pageCount / parts)
  const out: AnalysisUnit[] = []
  for (let from = unit.fromPage; from <= unit.toPage; from += size) {
    const to = Math.min(from + size - 1, unit.toPage)
    const subText = unit.text
      .split(/\n\n+/)
      .filter(block => {
        const m = /^\[page (\d+)\]/.exec(block)
        return m ? Number(m[1]) >= from && Number(m[1]) <= to : true
      })
      .join('\n\n')
    out.push({ ...unit, fromPage: from, toPage: to, text: subText, chars: subText.length })
  }
  return out.length > 0 ? out : [unit]
}

export function mergeSectionAnalyses(parts: SectionAnalysis[]): SectionAnalysis {
  return {
    topics: parts.flatMap(p => p.topics ?? []).slice(0, 12),
    definitions: parts.flatMap(p => p.definitions ?? []).slice(0, 20),
    keyFacts: parts.flatMap(p => p.keyFacts ?? []).slice(0, 20),
    formulas: parts.flatMap(p => p.formulas ?? []).slice(0, 10),
    misconceptions: parts.flatMap(p => p.misconceptions ?? []).slice(0, 10),
    unreadable: parts.flatMap(p => p.unreadable ?? []).slice(0, 10),
  }
}

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
- REFERENCE LISTS (abbreviations, glossaries, indexes, rosters, fee/centre/name tables): return exactly ONE topic named after the section's own heading or the list's own title, with the ACTUAL entries from the list as its subtopics (up to 12, verbatim, most study-relevant). NEVER invent thematic groupings the document did not write (e.g. "Government Bodies", "Educational Abbreviations" for an abbreviations list).
- "subtopics": concepts or key terms under each topic, found in this text — they are verified against the pages and invented or garbled ones are dropped.
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
  if ((cov.contentlessPages ?? 0) > 0) gaps.push(`${cov.contentlessPages} page${(cov.contentlessPages ?? 0) === 1 ? ' carries' : 's carry'} only running headers/footers (image-like content) — nothing could be analysed on them.`)
  if (cov.failedExtractionPages > 0) gaps.push(`${cov.failedExtractionPages} page${cov.failedExtractionPages === 1 ? ' could' : 's could'} not be read by the PDF extractor — ${cov.failedExtractionPages === 1 ? 'it is' : 'they are'} not part of this analysis.`)
  if (cov.notExtractedPages > 0) gaps.push(`The document has ${cov.notExtractedPages} page${cov.notExtractedPages === 1 ? '' : 's'} beyond what this environment can process — they were never read, so this analysis does not cover them.`)
  if (cov.unitsFailed > 0) gaps.push(`${cov.unanalysedPages} content page${cov.unanalysedPages === 1 ? ' is' : 's are'} not yet covered (failed sections) — retry the analysis to include them.`)
  if (cov.unitsSkipped > 0) gaps.push(`${cov.unitsSkipped} section${cov.unitsSkipped === 1 ? '' : 's'} (${cov.skippedPages} page${cov.skippedPages === 1 ? '' : 's'}) were skipped because the AI provider's safety filter refused their text — see the section breakdown for the exact reason.`)
  return gaps
}

/** Delete a stored file (used when a document row is removed). */
export async function deleteStoredFile(storedPath: string): Promise<void> {
  try {
    await unlink(storedPath)
  } catch { /* already gone */ }
}
