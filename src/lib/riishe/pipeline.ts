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
import { canonicalizeTopics, normalizeTitle, jaccard, titleTokens, type TopicInput } from './dedupe'
import { extractReferenceList } from './reference-list'
import { chatJson, fenceDocumentText, AI_UNAVAILABLE_MESSAGE, isContentFilterError, isRateLimitError } from './ai'
import { isOcrAvailable, ocrScannedPages } from './ocr'
import { PIPELINE_VERSION, type DocumentAnalysis, type AnalyzedTopic, type SectionOutcome, type CoverageMetrics, type StructureTocEntry, type StructureGroup, type TopicItemClass, type FormulaNote, type StudyFact, type ListExtraction } from './types'

const UNIT_CHARS = 6000 // per-model-call section budget

// ─── OCR stage bookkeeping (Stage 1b) ─────────────────────────────────────────

/** Honest record of what the OCR stage actually did, threaded into every
 *  downstream coverage/status message so wording can never claim more than
 *  happened. When `available` is false the pre-OCR behaviour is unchanged. */
interface OcrStageInfo {
  /** OCR engine was detected and usable (tesseract + pdftoppm + tessdata) */
  available: boolean
  /** pages OCR actually attempted (0 when unavailable / no scanned pages) */
  attempted: number
  /** attempted pages whose OCR text passed validation and was merged in */
  ok: number
  /** scanned pages never attempted because of the per-document OCR cap */
  unattempted: number
}

const SYSTEM = `You are Riishe, the document-analysis engine of BEAN EXAMS, a document-first study platform. You analyse student-uploaded study material and produce precise, grounded structured analyses. Never invent content that is not in the provided text. If a field has no content, return an empty array.`

interface SectionAnalysis {
  topics: { name: string; subtopics: string[]; pages: number[]; list?: ListExtraction }[]
  definitions: { term: string; meaning: string; page: number }[]
  /** v6: facts are page-grounded claims; entries may still arrive as bare
   *  strings (older prompt / model drift) and are normalized at merge time. */
  keyFacts: (string | { text?: string; fact?: string; page?: number; kind?: string })[]
  /** v6: formulas are verbatim transcriptions with their page; bare strings
   *  are normalized at merge time. */
  formulas: (string | { text?: string; formula?: string; page?: number })[]
  misconceptions: { misconception: string; correction: string; page?: number }[]
  unreadable: string[]
  /** v6: true when this section was recovered by the deterministic reference-
   *  list parser after the provider refused the text (recorded in outcomes) */
  deterministic?: boolean
  /** v6: human-readable note attached to deterministic recovery */
  deterministicNote?: string
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
  // v6: a deterministically recovered reference list is attached to the
  // section's own heading topic — the entries ARE that section's content.
  for (const u of units) {
    const part = parts[u.index]
    if (!part?.deterministic) continue
    const listTopic = (part.topics ?? []).find(t => t.list)
    if (!listTopic?.list) continue
    const headingTopic = inputs.find(
      i => i.origin === 'SOURCE_HEADING' && i.unitIndex === u.index,
    )
    if (headingTopic) {
      headingTopic.list = listTopic.list
      continue
    }
    inputs.push({
      name: u.title ?? 'Reference list',
      subtopics: listTopic.subtopics ?? [],
      pages: pagesBetween(u.fromPage, u.toPage),
      unitIndex: u.index,
      unitTitle: u.title,
      unitFromPage: u.fromPage,
      unitToPage: u.toPage,
      origin: 'SOURCE_HEADING',
      titleSource: 'body',
      numbering: u.title ? extractNumberToken(u.title) : null,
      structureVerified: true,
      itemClass: 'TABLE_OR_LIST',
      list: listTopic.list,
    })
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

// ─── Study-note verification (v6): page-grounded facts and verbatim formulas ─

const FACT_TOKEN_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'have', 'has', 'will', 'shall', 'must', 'may', 'can', 'not', 'their', 'they', 'who', 'whom', 'which', 'candidates', 'candidate'])

/** Alphanumeric tokens of a note that are distinctive evidence: numbers (any)
 *  and non-stopword words of ≥4 characters. */
function noteTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2)
    .filter(w => /^\d+$/.test(w) || (w.length >= 4 && !FACT_TOKEN_STOP.has(w)))
}

/** Share of `tokens` found on `pageText` (already normalized). */
function tokenSupport(tokens: string[], pageText: string): number {
  if (tokens.length === 0) return 0
  let hit = 0
  for (const t of tokens) if (pageText.includes(t)) hit++
  return hit / tokens.length
}

function normalizeFactEntry(raw: SectionAnalysis['keyFacts'][number]): { text: string; page: number | null; kind: 'verbatim' | 'summary' | undefined } | null {
  if (typeof raw === 'string') {
    const text = raw.trim()
    return text ? { text, page: null, kind: undefined } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text ?? raw.fact ?? '').trim()
  if (!text) return null
  const page = Number.isFinite(raw.page) && Number(raw.page) >= 1 ? Number(raw.page) : null
  const kind = raw.kind === 'verbatim' ? 'verbatim' : raw.kind === 'summary' ? 'summary' : undefined
  return { text: text.slice(0, 500), page, kind }
}

function normalizeFormulaEntry(raw: SectionAnalysis['formulas'][number]): { text: string; page: number | null } | null {
  if (typeof raw === 'string') {
    const text = raw.trim()
    return text ? { text: text.slice(0, 400), page: null } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text ?? raw.formula ?? '').trim()
  if (!text) return null
  const page = Number.isFinite(raw.page) && Number(raw.page) >= 1 ? Number(raw.page) : null
  return { text: text.slice(0, 400), page }
}

/**
 * Merge per-section facts into verified study notes (v6):
 *  • duplicates removed by token similarity (near-identical wording merged,
 *    genuinely different facts kept);
 *  • every fact's claimed page is VERIFIED against the extracted page text —
 *    when the claimed page does not support it, the page that does is used
 *    (with a note); when no page supports it the fact is kept but flagged
 *    UNVERIFIED so nothing unsupported ever looks source-backed.
 */
function mergeStudyFacts(
  parts: (SectionAnalysis | null)[],
  cap: number,
  pageTextIndex: Map<number, string>,
): StudyFact[] {
  const out: StudyFact[] = []
  const seenTokens: Set<string>[] = []
  const push = (fact: StudyFact) => {
    const tokens = new Set(noteTokens(fact.text))
    for (const kept of seenTokens) {
      if (jaccard(tokens, kept) >= 0.8) return // duplicated fact — dropped
    }
    seenTokens.push(tokens)
    out.push(fact)
  }
  for (const part of parts) {
    if (!part) continue
    for (const raw of part.keyFacts ?? []) {
      const entry = normalizeFactEntry(raw)
      if (!entry || !entry.text) continue
      const fact = verifyFact(entry, pageTextIndex)
      push(fact)
      if (out.length >= cap) return out
    }
  }
  return out
}

function verifyFact(
  entry: { text: string; page: number | null; kind: 'verbatim' | 'summary' | undefined },
  pageTextIndex: Map<number, string>,
): StudyFact {
  const tokens = noteTokens(entry.text)
  const best = bestSupportPage(tokens, entry.page, pageTextIndex)
  if (best && best.page === entry.page) {
    return { text: entry.text, page: entry.page, kind: entry.kind, status: 'VERIFIED' }
  }
  if (best) {
    // the claim is real but the model cited the wrong page — correct it, say so
    return {
      text: entry.text,
      page: best.page,
      kind: entry.kind,
      status: best.support >= 0.6 ? 'VERIFIED' : 'UNVERIFIED',
      note: `page reference corrected: the model cited page ${entry.page ?? '?'}; this text was found on page ${best.page}`,
    }
  }
  return {
    text: entry.text,
    page: entry.page,
    kind: entry.kind,
    status: 'UNVERIFIED',
    note: 'no page of the extracted text supports this claim — flagged for review',
  }
}

/** Find the page with the strongest token support, preferring the claimed page. */
function bestSupportPage(
  tokens: string[],
  claimedPage: number | null,
  pageTextIndex: Map<number, string>,
): { page: number; support: number } | null {
  if (tokens.length === 0) return null
  let best: { page: number; support: number } | null = null
  for (const [page, text] of pageTextIndex) {
    const support = tokenSupport(tokens, text)
    if (support <= 0) continue
    if (page === claimedPage && support >= 0.5) return { page, support } // claimed page wins early
    if (!best || support > best.support || (support === best.support && page === claimedPage)) {
      best = { page, support }
    }
  }
  return best && best.support >= 0.5 ? best : null
}

/**
 * Merge per-section formulas into verified notes (v6):
 *  • duplicates removed (the same formula transcribed twice keeps the VERIFIED
 *    verbatim variant);
 *  • every transcription is verified against the extracted page text — a
 *    formula whose tokens never appear (typically an embedded equation IMAGE)
 *    is flagged NEEDS_REVIEW and never silently trusted.
 */
function mergeFormulas(
  parts: (SectionAnalysis | null)[],
  cap: number,
  pageTextIndex: Map<number, string>,
): FormulaNote[] {
  const out: FormulaNote[] = []
  const seenTokens: Set<string>[] = []
  for (const part of parts) {
    if (!part) continue
    for (const raw of part.formulas ?? []) {
      const entry = normalizeFormulaEntry(raw)
      if (!entry || !entry.text) continue
      const tokens = new Set(noteTokens(entry.text))
      if (tokens.size === 0) continue
      let duplicate = false
      for (const kept of seenTokens) {
        if (jaccard(tokens, kept) >= 0.7) { duplicate = true; break }
      }
      if (duplicate) continue
      const best = bestSupportPage([...tokens], entry.page, pageTextIndex)
      if (best) {
        seenTokens.push(tokens)
        out.push({
          text: entry.text,
          page: best.page,
          status: 'VERIFIED',
          note: best.page !== entry.page
            ? `page reference corrected: the model cited page ${entry.page ?? '?'}; this text was found on page ${best.page}`
            : undefined,
        })
      } else {
        // could not be verified anywhere in the extracted text — the formula is
        // likely an embedded image or a reconstruction. Flagged, never trusted.
        seenTokens.push(tokens)
        out.push({
          text: entry.text,
          page: entry.page,
          status: 'NEEDS_REVIEW',
          note: 'this transcription could not be verified against the extracted page text — the source may print it as an image; review before relying on it',
        })
      }
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
  const deterministicUnits = units.filter((u, i) => outcomes[i]?.status === 'OK' && outcomes[i]?.method === 'DETERMINISTIC')
  const accountedPageSet = new Set<number>()
  for (const u of okUnits) for (const p of unitPages(u)) accountedPageSet.add(p)
  const skippedPageSet = new Set<number>()
  for (const u of skippedUnits) for (const p of unitPages(u)) skippedPageSet.add(p)
  const readableSet = new Set(readablePages.map(p => p.page))
  // v5: pages whose extracted text is only running furniture are counted in
  // their own bucket — they were never analysable content, so counting them
  // as "analysed pages" inflated semantic coverage.
  // v6: furniture-only pages split by EVIDENCE into image-content pages (the
  // page paints image plates — a form facsimile / Gazette reprint awaiting
  // OCR) and verified non-content pages (no images — genuinely blank or
  // decorative). Only the former block "fully analysed".
  const imageContentPages = [...contentlessSet].filter(p => {
    const page = extraction.pages.find(x => x.page === p)
    return page ? page.imagePlates !== false : true // unknown probe → conservative
  })
  const nonContentPages = [...contentlessSet].filter(p => !imageContentPages.includes(p))
  const contentPages = [...readableSet].filter(p => !contentlessSet.has(p))
  const contentlessInUnits = [...contentlessSet].filter(p => readableSet.has(p)).length
  const unanalysed = contentPages.filter(p => !accountedPageSet.has(p) && !skippedPageSet.has(p)).length
  // Extraction-level honesty: pages the extractor could not read at all, and
  // pages that were never attempted because the document exceeds the safety
  // cap. Both are distinct from image-only pages and both block "complete".
  const failedExtractionPages = extraction.pages.filter(p => p.outcome === 'failed').length
  const notExtractedPages = Math.max(0, extraction.numPages - extraction.pages.length)
  const scannedPageNumbers = extraction.pages.filter(p => p.scanned).map(p => p.page)
  const skippedPageNumbers = contentPages.filter(p => skippedPageSet.has(p))
  const matchedEntries = tocLayer.filter(e => e.matched)
  // v6 — page-accounting completeness: every physical page sits in exactly one
  // explicit bucket. Guard-checked, never assumed.
  const accountedSum =
    (accountedPageSet.size - [...contentlessSet].filter(p => accountedPageSet.has(p)).length) +
    unanalysed +
    skippedPageNumbers.length +
    contentlessInUnits +
    scannedPageNumbers.length +
    failedExtractionPages +
    notExtractedPages
  const pageAccountingComplete = accountedSum === extraction.numPages
  // v6 — CONTENT-analysis completeness: no meaningful content left unanalysed.
  // Skipped pages, pages awaiting OCR (image-only or image-content), failed
  // units, extraction failures and un-read pages all block it. Verified
  // non-content pages (blank/decorative) do not.
  const complete =
    unanalysed === 0 &&
    failedUnits.length === 0 &&
    skippedPageNumbers.length === 0 &&
    scannedPageNumbers.length === 0 &&
    imageContentPages.length === 0 &&
    failedExtractionPages === 0 &&
    notExtractedPages === 0 &&
    units.length > 0
  return {
    totalPages: extraction.numPages,
    readablePages: readablePages.length,
    scannedPages: extraction.scannedPages,
    contentlessPages: contentlessInUnits,
    analysedPages: accountedPageSet.size - [...contentlessSet].filter(p => accountedPageSet.has(p)).length,
    unanalysedPages: unanalysed,
    skippedPages: skippedPageNumbers.length,
    skippedPageNumbers,
    scannedPageNumbers,
    deterministicPages: deterministicUnits.reduce((s, u) => s + unitPages(u).filter(p => contentPages.includes(p)).length, 0),
    deterministicUnits: deterministicUnits.length,
    failedExtractionPages,
    notExtractedPages,
    unitsTotal: units.length,
    unitsOk: okUnits.length,
    unitsFailed: failedUnits.length,
    unitsSkipped: skippedUnits.length,
    complete,
    pageAccountingComplete,
    tocDiscovered: tocLayer.length,
    tocMatchedHeadings: matchedEntries.length,
    tocVerifiedStarts: matchedEntries.filter(e => e.startStatus === 'VERIFIED').length,
    tocInferredStarts: tocLayer.filter(e => e.startStatus === 'INFERRED').length,
    tocUnresolved: tocLayer.filter(e => e.startStatus === 'UNRESOLVED').length,
  }
}

function buildCoverageNote(
  cov: CoverageMetrics,
  counts: { imageContent: number; nonContent: number },
  ocr?: OcrStageInfo | null,
): string {
  const bits: string[] = []
  if (cov.unitsFailed > 0) {
    bits.push(`Analysed ${cov.analysedPages} of ${cov.readablePages - (cov.contentlessPages ?? 0)} content page${cov.readablePages - (cov.contentlessPages ?? 0) === 1 ? '' : 's'} — ${cov.unitsFailed} section${cov.unitsFailed === 1 ? '' : 's'} failed and can be retried without losing the sections that succeeded.`)
  } else if (cov.unitsSkipped > 0) {
    bits.push(`All content pages accounted for: ${cov.analysedPages} analysed across ${cov.unitsOk} section${cov.unitsOk === 1 ? '' : 's'}, ${cov.skippedPages} page${cov.skippedPages === 1 ? '' : 's'} in ${cov.unitsSkipped} section${cov.unitsSkipped === 1 ? '' : 's'} skipped with a recorded reason (see below).`)
  } else {
    bits.push(`All ${cov.analysedPages} content page${cov.analysedPages === 1 ? '' : 's'} analysed across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}.`)
  }
  if ((cov.deterministicPages ?? 0) > 0) {
    bits.push(`${cov.deterministicPages} page${(cov.deterministicPages ?? 0) === 1 ? ' was' : 's were'} recovered by deterministic list extraction after the AI provider refused the raw text — the entries are read straight from the PDF text layer, not invented.`)
  }
  if ((cov.contentlessPages ?? 0) > 0) {
    const parts: string[] = []
    if (counts.imageContent > 0) parts.push(`${counts.imageContent} page${counts.imageContent === 1 ? ' carries' : 's carry'} image content that needs OCR`)
    if (counts.nonContent > 0) parts.push(`${counts.nonContent} page${counts.nonContent === 1 ? ' is' : 's are'} verified to carry no content at all (no text, no images)`)
    if (parts.length > 0) bits.push(`${parts.join('; ')} — accounted separately, never counted as analysed content.`)
  }
  if (cov.failedExtractionPages > 0) {
    bits.push(`${cov.failedExtractionPages} page${cov.failedExtractionPages === 1 ? ' could' : 's could'} not be read by the PDF extractor at all (renderer failure) — ${cov.failedExtractionPages === 1 ? 'it is' : 'they are'} reported separately from image-only pages and excluded from the analysis.`)
  }
  if (cov.notExtractedPages > 0) {
    bits.push(`The document has ${cov.totalPages} pages but only the first ${cov.totalPages - cov.notExtractedPages} could be processed in this environment — the remaining ${cov.notExtractedPages} were never read and are not part of this analysis.`)
  }
  if (cov.scannedPages > 0) {
    if (ocr && ocr.available && ocr.attempted > 0) {
      const failedAttempted = ocr.attempted - ocr.ok
      const why: string[] = []
      if (failedAttempted > 0) why.push(`OCR ran on ${ocr.attempted} page${ocr.attempted === 1 ? '' : 's'} but ${failedAttempted} produced no usable text`)
      if (ocr.unattempted > 0) why.push(`${ocr.unattempted} were never OCR'd (the per-document OCR cap)`)
      if (why.length === 0) why.push('OCR was attempted on them without a usable result')
      bits.push(`${cov.scannedPages} image-only page${cov.scannedPages === 1 ? '' : 's'} still ${cov.scannedPages === 1 ? 'awaits' : 'await'} usable text (${why.join('; ')}) — ${cov.scannedPages === 1 ? 'it is' : 'they are'} excluded from the analysis.`)
    } else {
      bits.push(`${cov.scannedPages} image-only page${cov.scannedPages === 1 ? '' : 's'} would need OCR, which is not available yet — ${cov.scannedPages === 1 ? 'it is' : 'they are'} excluded from the analysis.`)
    }
  }
  return bits.join(' ')
}

// ─── Main job ────────────────────────────────────────────────────────────────

/** The NEEDS_OCR status line, honest about what actually happened: OCR that
 *  ran and failed reads differently from OCR that was never available. */
function needsOcrStatusDetail(
  extraction: { scannedPages: number; failedPages: number },
  ocr: OcrStageInfo | null,
): string {
  if (ocr?.available && ocr.attempted > 0) {
    return `No usable text could be recovered from this document. OCR ran on ${ocr.attempted} image-only page${ocr.attempted === 1 ? '' : 's'} but none produced text that passed the usability check (too short or too garbled) — the scans may be low-quality, handwritten, or in a language the engine cannot read. Questions cannot be generated from this document.`
  }
  if (ocr?.available) {
    return `No extractable text found — the pages could not be read by the PDF extractor (${extraction.failedPages} extraction failures; no image-only pages were found for OCR to attempt). Questions cannot be generated from this document.`
  }
  return `No extractable text found — every page looks like a scanned image or could not be read (${extraction.scannedPages} image-only, ${extraction.failedPages} extraction failures). OCR is not available in BEAN EXAMS yet, so Riishe cannot read this document. Questions cannot be generated from it.`
}

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

  // ── Stage 1b: genuine OCR (Tesseract) for image-only pages ────────────────
  // When the OCR engine is installed, scanned pages get a real second chance:
  // each is rendered with pdftoppm and read with Tesseract. Pages whose OCR
  // passes validation are merged back into the extraction (with provenance
  // fields, so analysis and UI can tell OCR text from PDF-text-layer text);
  // pages that fail keep their scanned flag and stay honestly "awaiting OCR".
  // When the engine is NOT installed, nothing changes — the existing
  // NEEDS_OCR path below applies unchanged.
  let ocrStage: OcrStageInfo | null = null
  {
    const scannedTargets = extraction.pages.filter(p => p.scanned)
    if (scannedTargets.length > 0) {
      const availability = await isOcrAvailable()
      if (!availability.available) {
        ocrStage = { available: false, attempted: 0, ok: 0, unattempted: 0 }
      } else {
        await db.studyDocument.update({
          where: { id: documentId },
          data: {
            status: 'EXTRACTING',
            statusDetail: `Running OCR on ${scannedTargets.length} scanned page${scannedTargets.length === 1 ? '' : 's'}…`,
            updatedAt: new Date(),
          },
        }).catch(() => {})
        const ocr = await ocrScannedPages(doc.storedPath, scannedTargets.map(p => ({ page: p.page })), {
          // keep the row's statusDetail/updatedAt honest (and stale-recovery
          // safe) during long sequential OCR runs
          onProgress: async (done, total, ok) => {
            await db.studyDocument.update({
              where: { id: documentId },
              data: {
                statusDetail: `Running OCR on ${total} scanned page${total === 1 ? '' : 's'} — ${done} done, ${ok} recovered…`,
                updatedAt: new Date(),
              },
            }).catch(() => {})
          },
        })
        let ok = 0
        for (const r of ocr.results) {
          const pg = extraction.pages.find(x => x.page === r.page)
          if (!pg || !pg.scanned) continue
          if (r.outcome === 'OCR_OK' && typeof r.text === 'string' && r.text.length > 0) {
            // Merge the OCR text with provenance: the page is no longer
            // "image-only awaiting OCR" — it now carries real, usable text.
            pg.text = r.text
            pg.chars = r.text.length
            pg.scanned = false
            pg.outcome = 'extracted'
            pg.ocr = true
            pg.ocrEngine = r.engine
            pg.ocrLangs = r.langs
            ok++
          }
          // OCR_FAILED pages keep scanned=true on purpose: they still count
          // as awaiting usable OCR everywhere downstream — never faked.
        }
        extraction.scannedPages = extraction.pages.filter(p => p.scanned).length
        extraction.textChars = extraction.pages.reduce((s, p) => s + p.chars, 0)
        ocrStage = {
          available: true,
          attempted: ocr.results.length,
          ok,
          unattempted: Math.max(0, scannedTargets.length - ocr.results.length),
        }
      }
    }
  }

  const readablePages = extraction.pages.filter(p => !p.scanned && p.text.length > 0)
  const extractionNote = extraction.failedPages > 0
    ? ` ${extraction.failedPages} page${extraction.failedPages === 1 ? ' could' : 's could'} not be read by the PDF extractor and ${extraction.failedPages === 1 ? 'is' : 'are'} excluded from the analysis.`
    : ''
  const ocrRecoveredNote = ocrStage && ocrStage.available && ocrStage.attempted > 0
    ? ` OCR recovered usable text for ${ocrStage.ok} of ${ocrStage.attempted} scanned page${ocrStage.attempted === 1 ? '' : 's'}${ocrStage.unattempted > 0 ? ` (${ocrStage.unattempted} more were beyond the per-document OCR cap)` : ''}.`
    : ''
  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      pageCount: extraction.numPages,
      extractionJson: JSON.stringify(extraction.pages),
      status: readablePages.length === 0 ? 'NEEDS_OCR' : 'ANALYSING',
      statusDetail: readablePages.length === 0
        ? needsOcrStatusDetail(extraction, ocrStage)
        : `Riishe is mapping the document structure…${extractionNote}${ocrRecoveredNote}`,
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
        statusDetail: ocrStage?.available
          ? `The PDF has pages but no analysable structure was found in its readable text${ocrStage.attempted > 0 ? ` (OCR recovered ${ocrStage.ok} page${ocrStage.ok === 1 ? '' : 's'}, but the text still yields no analysable structure)` : ''}.`
          : 'The PDF has pages but no readable text that Riishe can analyse. OCR is not available yet.',
      },
    })
    return
  }

  // ── Partial retry: reuse stored successful parts, re-run the rest.
  // v6: previously SKIPPED units are re-attempted too — the deterministic
  // reference-list fallback makes retries convergent (the provider refusal no
  // longer dead-ends the section), so a carried-over skip would permanently
  // withhold recoverable content.
  let storedParts: (SectionAnalysis | null)[] | null = null
  if (canPartialRetry && stored) {
    const prev = stored._parts ?? []
    const prevOutcomes = stored.sectionOutcomes ?? []
    if (prev.length === units.length && prevOutcomes.length === units.length) {
      // keep only parts whose unit still counts as OK — everything else
      // (failed OR skipped) is re-attempted under the current pipeline
      storedParts = units.map((u, i) => (prevOutcomes[i]?.status === 'OK' ? prev[i] ?? null : null))
    }
  }

  // ── Stage 3: analyse every unit (failures recorded, never fatal)
  const parts: (SectionAnalysis | null)[] = new Array(units.length).fill(null)
  if (storedParts) for (let i = 0; i < units.length; i++) parts[i] = storedParts[i]

  const skipReasons = new Map<number, string>()
  let done = 0
  let failedCount = 0
  let skippedCount = 0
  for (const unit of units) {
    if (parts[unit.index]) continue // preserved from the previous run
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
    if (parts[i]) {
      return parts[i]!.deterministic
        ? {
            index: i, title: u.title, label, fromPage: u.fromPage, toPage: u.toPage,
            status: 'OK' as const, method: 'DETERMINISTIC' as const,
            note: parts[i]!.deterministicNote,
          }
        : { index: i, title: u.title, label, fromPage: u.fromPage, toPage: u.toPage, status: 'OK' as const, method: 'AI' as const }
    }
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
  const { merged, cov } = recomputeMergedAnalysis({
    title: doc.title,
    pages: extraction.pages,
    numPages: extraction.numPages,
    scannedPages: extraction.scannedPages,
    parts,
    outcomes,
    summary: '',
    structure,
    ocr: ocrStage,
  })
  merged.summary = await summarise(doc.title, extraction.pages, merged)
  merged.studyGaps = deriveStudyGaps(merged, cov, ocrStage)

  await db.studyDocument.update({
    where: { id: documentId },
    data: {
      status: 'READY',
      statusDetail: finalStatusDetail(cov, merged, ocrStage),
      analysisJson: JSON.stringify(merged),
    },
  })
}

/** The READY status line: honest about partial coverage, listing exactly what
 *  still requires processing. Shared by the live job and the upgrade path so
 *  a recomputed analysis reads exactly like a freshly analysed one.
 *  `ocr` carries the Stage 1b bookkeeping so remaining scanned pages are
 *  described truthfully ("no usable OCR text" vs "OCR not available"). */
export function finalStatusDetail(cov: CoverageMetrics, merged: { topics: unknown[] }, ocr?: OcrStageInfo | null): string {
  const partial = !cov.complete
  const pendingBits: string[] = []
  if (cov.unitsFailed > 0) pendingBits.push(`${cov.unitsFailed} failed section${cov.unitsFailed === 1 ? '' : 's'}`)
  if (cov.unitsSkipped > 0) pendingBits.push(`${cov.unitsSkipped} skipped section${cov.unitsSkipped === 1 ? '' : 's'} (${cov.skippedPages} pages)`)
  if (cov.scannedPages > 0) {
    pendingBits.push(
      ocr && ocr.available && ocr.attempted > 0
        ? `${cov.scannedPages} image-only page${cov.scannedPages === 1 ? '' : 's'} with no usable OCR text`
        : `${cov.scannedPages} image-only page${cov.scannedPages === 1 ? '' : 's'} awaiting OCR`,
    )
  }
  return partial
    ? `Ready (partially analysed) — analysed ${cov.analysedPages} of ${cov.totalPages} pages across ${cov.unitsOk}/${cov.unitsTotal} sections${pendingBits.length > 0 ? `; still requiring processing: ${pendingBits.join(', ')}` : ''}.`
    : `Ready — fully analysed: ${merged.topics.length} topic${merged.topics.length === 1 ? '' : 's'} across ${cov.unitsTotal} section${cov.unitsTotal === 1 ? '' : 's'}; every one of the ${cov.totalPages} pages was analysed or verified to carry no content.`
}

// ─── Deterministic Stage 4 (shared by the live job and version upgrades) ────

export interface RecomputeOpts {
  title: string
  pages: ExtractedPage[]
  numPages: number
  scannedPages: number
  /** per-section results (AI + deterministic), aligned with `outcomes` */
  parts: (SectionAnalysis | null)[]
  outcomes: SectionOutcome[]
  /** summary carried into the merged analysis (a fresh run replaces it) */
  summary: string
  /** structure detected over the same pages (Stage 2 output) */
  structure: ReturnType<typeof detectStructure>
  /** OCR stage bookkeeping (Stage 1b) — reflected in coverage/status wording
   *  so remaining scanned pages read truthfully. Absent/null = stage did not
   *  run (no scanned pages or the caller is a recompute without OCR). */
  ocr?: OcrStageInfo | null
}

/**
 * Everything between "all sections are settled" and "write the analysis" as
 * ONE pure function: page-verified canonicalisation, whole-section list
 * completeness, image-formula flagging, grounded study notes, coverage
 * accounting. `processDocument` runs it after analysis; a pipeline upgrade
 * can run it over a stored extraction + stored per-section results so the
 * improvement reaches an existing document WITHOUT re-asking the provider —
 * the merge is exactly what a fresh run would have produced from the same
 * section results. Nothing here invents content: every field is derived from
 * the extraction and the recorded section results.
 */
export function recomputeMergedAnalysis(opts: RecomputeOpts): { merged: StoredAnalysis; cov: CoverageMetrics } {
  const { structure } = opts
  const units = structure.units
  const readablePages = opts.pages.filter(p => !p.scanned && p.text.length > 0)
  const pageTextIndex = new Map<number, string>()
  for (const p of opts.pages) {
    if (!p.scanned && p.text) pageTextIndex.set(p.page, p.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
  }

  // v5: pages whose extracted text is only running headers/footers (the real
  // content is an image). Evidence list stored with the analysis; coverage
  // counts them in their own bucket instead of "analysed content".
  const contentlessPages = detectContentlessPages(opts.pages)
  const contentlessSet = new Set(contentlessPages)

  const topicInputs = collectTopicInputs(opts.parts, units, new Map(), structure.tocPages, buildTocInfoMap(structure.tocLayer), structure.tocLayer)
  const topics: AnalyzedTopic[] = canonicalizeTopics(topicInputs, { pageTextIndex, maxTopics: 200, maxSubtopicsPerTopic: 12 })

  // v7: a recovered list must cover the topic's WHOLE span (see below).
  completeSectionList(topics, opts.pages, opts.outcomes)

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
    { numPages: opts.numPages, scannedPages: opts.scannedPages, pages: opts.pages },
    readablePages,
    units,
    opts.outcomes,
    contentlessSet,
    structure.tocLayer,
  )

  // v6: furniture-only pages split by evidence — image plates present (form
  // facsimiles, Gazette reprints: awaiting OCR) vs verified non-content.
  const imageContentPages = contentlessPages.filter(p => {
    const page = opts.pages.find(x => x.page === p)
    return page ? page.imagePlates !== false : true
  })
  const nonContentPages = contentlessPages.filter(p => !imageContentPages.includes(p))

  // v5: per-group processing accounting — an entry is OK when every one of
  // its analysable pages sits in a successful unit; partial when some do.
  const groupStats = buildGroupStats(structure.tocLayer, opts.outcomes, opts.pages, contentlessSet)

  const merged: StoredAnalysis = {
    title: opts.title,
    summary: opts.summary,
    topics,
    definitions: mergeDefinitions(opts.parts, 60),
    keyFacts: mergeStudyFacts(opts.parts, 80, pageTextIndex),
    formulas: flagImageFormulas(opts.outcomes, opts.pages, mergeFormulas(opts.parts, 50, pageTextIndex)),
    misconceptions: mergeMisconceptions(opts.parts, 40),
    keyPages: [...new Set(topics.flatMap(t => t.pages.slice(0, 3)))].filter(p => p >= 1).sort((a, b) => a - b).slice(0, 60),
    unreadableSections: mergeUnreadable(opts.parts, 16),
    studyGaps: [],
    coverageNote: buildCoverageNote(cov, { imageContent: imageContentPages.length, nonContent: nonContentPages.length }, opts.ocr),
    pipelineVersion: PIPELINE_VERSION,
    coverage: cov,
    sectionOutcomes: opts.outcomes,
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
      // v6: evidence split of the furniture-text pages (see coverage note)
      imageContentPages,
      nonContentPages,
      groupStats,
    },
    _parts: opts.parts, // retained so a partial retry keeps every successful section
  }
  merged.studyGaps = deriveStudyGaps(merged, cov, opts.ocr)
  return { merged, cov }
}

/**
 * v7 — whole-section list completeness. A section long enough to be split
 * into several analysis units can have only SOME units refused by the
 * provider (and recovered deterministically) while the rest analyse as AI;
 * the merged topic would then carry a list that stops at the first refused
 * chunk (e.g. an 8-page city roster recovering only its first 4 pages). For
 * every source-heading topic that carries a recovered list, the topic's
 * ENTIRE page span is re-parsed with the deterministic extractor and the
 * result adopted when it recovers at least as much. Entries stay verbatim,
 * in source order, grouped exactly as the document groups them; unreadable
 * rows and serial gaps stay reported.
 */
function completeSectionList(topics: AnalyzedTopic[], pages: ExtractedPage[], outcomes: SectionOutcome[]): void {
  for (const t of topics) {
    if (t.origin !== 'SOURCE_HEADING' || !t.list || t.pages.length < 2) continue
    const from = Math.min(...t.pages)
    const to = Math.max(...t.pages)
    if (to <= from) continue
    const spanText = pages
      .filter(p => !p.scanned && p.text && p.page >= from && p.page <= to)
      .map(p => `[page ${p.page}]\n${p.text}`)
      .join('\n\n')
    if (!spanText) continue
    const full = extractReferenceList(spanText)
    if (full && full.totalEntries > t.list.totalEntries) {
      t.list = full
      t.subtopics = full.groups.flatMap(g => g.entries).slice(0, 12)
      // keep the outcome note consistent with the completed list — the
      // per-unit recovery note would otherwise understate what was recovered
      for (const o of outcomes) {
        if (o.method === 'DETERMINISTIC' && o.fromPage >= from && o.toPage <= to) {
          o.note = `Recovered ${full.totalEntries} entries in ${full.groups.length} group(s) deterministically from the PDF text layer after the AI provider refused the raw text; the section's full span (pages ${from}–${to}) was re-parsed so the list covers the whole section.`
        }
      }
    }
  }
}

// ─── Image-formula detection (v7) ──────────────────────────────────────────

const FORMULA_CUE_RE = /\b(?:calculated|computed|determined|expressed|written)\s+as\s*:?\s*$/
const WHERE_LINE_RE = /^\s*Where\b/i
/** short variable-like tokens ("x1", "p2", "ua") — never common English words */
const VAR_TOKEN_RE = /^(?:[a-z]\d|[a-z]{2})$/
const VAR_STOPWORDS = new Set(['is', 'it', 'be', 'as', 'at', 'or', 'an', 'we', 'so', 'if', 'do', 'by', 'up', 'no', 'on', 'in', 'of', 'to', 'ii', 'iii', 'iv'])

function variableTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const t of text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (VAR_TOKEN_RE.test(t) && !VAR_STOPWORDS.has(t)) out.add(t)
  }
  return out
}

/**
 * An equation the PDF prints only as an IMAGE leaves a characteristic trace
 * in the text layer: a describing sentence ("… is calculated as:") followed
 * by "Where:" variable definitions, with no equation between them. Such
 * formulas used to be silently MISSING from the notes. Each cue is compared
 * with the already-verified transcriptions: when the cue's variable
 * definitions are already covered by a stored formula (documents often
 * repeat the same equation as text on a later page), the cue is skipped;
 * otherwise a NEEDS_REVIEW entry carrying the VERBATIM describing sentence
 * is added — flagged for review, never reconstructed, never trusted.
 */
function flagImageFormulas(
  outcomes: SectionOutcome[],
  pages: ExtractedPage[],
  stored: FormulaNote[],
  cap = 6,
): FormulaNote[] {
  const out = [...stored]
  const storedNorm = stored.map(f => f.text.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
  const storedVars = storedNorm.map(n => variableTokens(n))
  const pageByNumber = new Map(pages.map(p => [p.page, p] as const))
  for (const o of outcomes) {
    if (o.status !== 'OK') continue // only successfully analysed sections carry honest page evidence
    for (let p = o.fromPage; p <= o.toPage; p++) {
      if (out.length - stored.length >= cap) return out
      const page = pageByNumber.get(p)
      if (!page || page.scanned || !page.text) continue
      const lines = page.text.split('\n')
      for (let i = 1; i < lines.length - 1; i++) {
        const cue = lines[i].trim()
        if (cue.length < 12 || !FORMULA_CUE_RE.test(cue)) continue
        if (!WHERE_LINE_RE.test(lines[i + 1])) continue
        // verbatim describing sentence: back up to the last sentence boundary
        const joined = `${lines[i - 1]?.trim() ?? ''} ${cue}`.replace(/\s+/g, ' ').trim()
        const dot = joined.lastIndexOf('. ')
        const sentence = (dot >= 0 ? joined.slice(dot + 2) : joined).trim()
        if (sentence.length < 20) continue
        // is the equation already captured by a verified transcription?
        const whereBlock = lines.slice(i + 1, i + 13).join(' ')
        const cueVars = variableTokens(whereBlock)
        let uncovered = 0
        for (const v of cueVars) if (!storedVars.some(set => set.has(v))) uncovered++
        if (uncovered < 2) continue // the same equation was transcribed from its text-layer copy
        // duplicate cue guard (identical descriptions on neighbouring pages)
        const norm = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
        if (storedNorm.some(n => jaccard(new Set(norm.split(' ')), new Set(n.split(' '))) >= 0.6)) continue
        storedNorm.push(norm)
        out.push({
          text: sentence.slice(0, 400),
          page: p,
          status: 'NEEDS_REVIEW',
          note: 'the equation itself is printed as an image in the PDF — only this describing sentence and its variable definitions survive in the text layer. Open the cited page and read the equation from the rendered page; no transcription is provided because none could be verified.',
        })
      }
    }
  }
  return out
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
    return recoverRefusedUnit(unit)
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
    return recoverRefusedUnit(unit, subChunks.length)
  }
  return { part: mergeSectionAnalyses(mergedParts) }
}

/**
 * v6 — a provider refusal must not prevent ordinary document extraction when
 * the source contains benign lists of examination locations (or any similar
 * reference table). Before giving up, the unit's pages are parsed by the
 * DETERMINISTIC reference-list extractor: entries come verbatim from the PDF
 * text layer, source order and grouping preserved, unreadable rows reported.
 * The recovered section is marked as a different METHOD in the outcomes —
 * never presented as AI analysis, never blended into its numbers.
 */
function recoverRefusedUnit(unit: AnalysisUnit, refusedParts?: number): SectionResult {
  const list = extractReferenceList(unit.text)
  if (!list || list.totalEntries === 0) {
    return {
      part: null,
      skippedReason: refusedParts
        ? `The AI provider's safety filter refused this section's text in full and in ${refusedParts} smaller parts (dense lists of names or categories are a known trigger), and no structured list could be recovered deterministically. Its pages are accounted as skipped, not analysed — no content was invented for them.`
        : 'The AI provider\'s safety filter refused to process this section\'s text (dense lists of names or categories are a known trigger), and no structured list could be recovered deterministically. Its pages are accounted as skipped, not analysed — no content was invented for them.',
    }
  }
  const title = unit.title ?? 'Reference list'
  const deterministicNote = list.unreadableRows.length > 0 || list.serialGaps.length > 0
    ? `Recovered ${list.totalEntries} entries deterministically from the PDF text layer after the AI provider refused the raw text${list.serialGaps.length > 0 ? `; serial gaps: ${list.serialGaps.join('; ')}` : ''}${list.unreadableRows.length > 0 ? `; ${list.unreadableRows.length} row(s) could not be parsed` : ''}.`
    : `Recovered ${list.totalEntries} entries in ${list.groups.length} group(s) deterministically from the PDF text layer after the AI provider refused the raw text.`
  return {
    part: {
      topics: [{
        name: title,
        subtopics: list.groups.flatMap(g => g.entries).slice(0, 12),
        pages: pagesBetween(unit.fromPage, unit.toPage),
        list,
      }],
      definitions: [],
      keyFacts: [{
        text: deterministicNote,
        page: unit.fromPage,
        kind: 'summary',
      }],
      formulas: [],
      misconceptions: [],
      unreadable: list.unreadableRows,
      deterministic: true,
      deterministicNote,
    },
  }
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
    deterministic: parts.some(p => p.deterministic) || undefined,
    deterministicNote: parts.map(p => p.deterministicNote).find(Boolean) || undefined,
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
  "keyFacts": [{"text": string, "page": number, "kind": "verbatim"|"summary"}],
  "formulas": [{"text": string, "page": number}],
  "misconceptions": [{"misconception": string, "correction": string, "page": number}],
  "unreadable": string[]
}

Rules:
- "topics": the concrete topics/concepts this text actually covers, using the document's own headings and terminology (3-8 at most; fewer is fine). Topic names must be SHORT noun phrases (≤ 8 words) — never full sentences. Do NOT invent topics, do NOT echo the section title unless the text genuinely develops it, and do NOT promote every heading you see.
- REFERENCE LISTS (abbreviations, glossaries, indexes, rosters, fee/centre/name tables): return exactly ONE topic named after the section's own heading or the list's own title, with the ACTUAL entries from the list as its subtopics (up to 12, verbatim, most study-relevant). NEVER invent thematic groupings the document did not write (e.g. "Government Bodies", "Educational Abbreviations" for an abbreviations list).
- "subtopics": concepts or key terms under each topic, found in this text — they are verified against the pages and invented or garbled ones are dropped.
- "pages" must cite page numbers from the [page N] markers in the text — never other numbers.
- "keyFacts": every fact MUST cite the [page N] it was read from, and MUST say "kind": "verbatim" when the statement/numbers are copied exactly from the text, or "summary" when you condensed it. Never state a fact the text does not support. Facts without a correct page are flagged and lose credibility — be precise.
- If this text is from a question paper, answer key or marks scheme, extract the subject areas the questions test (not the questions themselves) and note it in keyFacts.
- "unreadable": list page labels whose text is garbled, truncated or incomprehensible ([] if none).
- "misconceptions": only if the text supports a correction (common wrong belief vs what the text says).
- "formulas": mathematical/scientific formulas or rules stated in the text ([] if none). Each entry: {"text": string, "page": number}.
  · TRANSCRIBE VERBATIM: copy the formula exactly as the document prints it — keep its own letters, subscripts, brackets, operators and even its own typos. If the document writes "u_A, u_C" where "u_B" was clearly intended, transcribe "u_A, u_C" anyway; do not silently fix the source.
  · STACKED FRACTIONS: when the PDF splits a formula across lines (numerator above the bar, denominator below), transcribe it as "(numerator) / (denominator)" using ONLY the document's own words and symbols — copy EVERY qualifier the document prints inside the numerator and inside the denominator (e.g. "appeared in the session"); never shorten or paraphrase them.
  · If a formula appears only as an image or is described in words, return the describing sentence verbatim as the text — it will be flagged for review rather than trusted.
  · NEVER reconstruct, simplify or re-typeset a formula that is not literally written in the text.

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

function deriveStudyGaps(a: DocumentAnalysis, cov: CoverageMetrics, ocr?: OcrStageInfo | null): string[] {
  const gaps: string[] = []
  if (a.topics.length === 0) gaps.push('No clear topics were identified — the text may be too sparse for question generation.')
  if (a.definitions.length === 0) gaps.push('No key definitions were found — you may need supporting material for terminology-heavy questions.')
  if (a.formulas.length === 0) gaps.push('No formulas or rules were detected — calculation-based questions will not be generated.')
  const unverifiedFacts = a.keyFacts.filter(f => f.status === 'UNVERIFIED').length
  if (unverifiedFacts > 0) gaps.push(`${unverifiedFacts} study note${unverifiedFacts === 1 ? '' : 's'} could not be verified against any page of the document — ${unverifiedFacts === 1 ? 'it is' : 'they are'} flagged in the notes, do not rely on ${unverifiedFacts === 1 ? 'it' : 'them'} without checking the source.`)
  const reviewFormulas = a.formulas.filter(f => f.status === 'NEEDS_REVIEW').length
  if (reviewFormulas > 0) gaps.push(`${reviewFormulas} formula${reviewFormulas === 1 ? '' : 's'} could not be verified against the extracted text (likely printed as an image in the PDF) — ${reviewFormulas === 1 ? 'it is' : 'they are'} flagged for review and will not be treated as verified.`)
  if (a.unreadableSections.length > 0) gaps.push(`${a.unreadableSections.length} section${a.unreadableSections.length === 1 ? '' : 's'} were unreadable and excluded from the analysis.`)
  if (cov.scannedPages > 0) {
    gaps.push(
      ocr && ocr.available && ocr.attempted > 0
        ? `${cov.scannedPages} image-only page${cov.scannedPages === 1 ? ' still has' : 's still have'} no usable OCR text (the engine ran on ${ocr.attempted} page${ocr.attempted === 1 ? '' : 's'} but these did not yield readable text) — ${cov.scannedPages === 1 ? 'it is' : 'they are'} excluded from the analysis.`
        : `${cov.scannedPages} image-only page${cov.scannedPages === 1 ? ' needs' : 's need'} OCR to be analysed — OCR is not available yet.`,
    )
  }
  if ((cov.contentlessPages ?? 0) > 0) gaps.push(`${cov.contentlessPages} page${(cov.contentlessPages ?? 0) === 1 ? ' carries' : 's carry'} no analysable text — the content there is an image (or the page is blank) and is accounted separately.`)
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
