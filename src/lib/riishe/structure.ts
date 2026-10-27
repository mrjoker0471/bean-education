// ─── Riishe document structure detection (deterministic, no AI) ──────────────
// Infers a document's real organisation from the extracted text itself:
//   • table of contents (detected + validated against the body)
//   • headings (numbered, chapter-style, ALL-CAPS, Title-Case) with levels
//   • question-paper layouts (so question banks are not exploded into "topics")
//   • printed page numbers vs physical PDF pages (arabic offset + roman front
//     matter) so page references can show both honestly
// and turns all of that into structure-aware ANALYSIS UNITS that cover the
// whole document — never an arbitrary "first N pages" slice.
//
// Everything here is pure and deterministic: the same extraction always
// produces the same structure, so re-analysis is repeatable and unit-testable.

import type { ExtractedPage } from './extract'

// ─── Public shapes ────────────────────────────────────────────────────────────

export type StructureKind = 'TOC_GUIDED' | 'HEADING_GUIDED' | 'QUESTION_PAPER' | 'UNSTRUCTURED'

export interface TocEntry {
  title: string
  page: number | null // physical page the entry claims (1-based)
}

export interface HeadingHit {
  title: string
  page: number
  lineIdx: number // line index within its page
  level: 1 | 2
  score: number
  fromToc: boolean // title matches a validated TOC entry
}

export interface PrintedPageInfo {
  /** physical = printed + offset, when a consistent arabic numbering was found */
  offset: number | null
  /** front matter used roman numerals (i, ii, iii …) */
  romanFrontMatter: boolean
}

export interface AnalysisUnit {
  index: number
  /** heading the unit sits under (null for un-headed chunks / front matter) */
  title: string | null
  level: 1 | 2 | null
  fromPage: number
  toPage: number
  text: string // includes "[page N]" markers, real line breaks preserved
  chars: number
  kind: 'SECTION' | 'FRONT' | 'CHUNK' | 'OVERFLOW'
}

export interface DetectedStructure {
  kind: StructureKind
  toc: TocEntry[]
  tocValidated: boolean
  headings: HeadingHit[]
  printed: PrintedPageInfo
  units: AnalysisUnit[]
  tocPages: number[]
}

// ─── Tuning constants ─────────────────────────────────────────────────────────

const HEADING_MAX_LEN = 95
const TOC_MIN_ENTRIES = 4
const HEADING_DENSITY_LIMIT = 0.45 // >45% heading-looking lines ⇒ not headings
const QUESTION_LINE_RATIO = 0.12
const MIN_UNIT_CHARS = 1200 // merge tiny sections forward instead of one-call-per-heading

export interface BuildUnitsOptions {
  maxUnitChars: number
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const WORD_RE = /[A-Za-z]/

function linesOf(page: ExtractedPage): string[] {
  return page.text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
}

function letters(s: string): string {
  return s.replace(/[^A-Za-z]/g, '')
}

function upperRatio(s: string): number {
  const ls = letters(s)
  if (ls.length === 0) return 0
  let up = 0
  for (const c of ls) if (c === c.toUpperCase() && c !== c.toLowerCase()) up++
  return up / ls.length
}

function titleCaseRatio(s: string): number {
  const words = s.split(/\s+/).filter(w => WORD_RE.test(w))
  if (words.length === 0) return 0
  let cap = 0
  for (const w of words) {
    const first = letters(w)[0]
    if (first && first === first.toUpperCase()) cap++
  }
  return cap / words.length
}

const NON_HEADING_RE = /^(page|fig(?:ure)?|table|source|note|answer|marks?|time\s*[:–-]|total|name|roll|date|reg(istration)?\s*(no|number))/i

// ─── TOC detection ────────────────────────────────────────────────────────────

const TOC_LEADER_RE = /^(.{2,90}?)[\s.·⋅•‣⁃…]{2,}(\d{1,3})(?:\s*[-–—]\s*\d{1,3})?$/
const TOC_GAP_RE = /^(.{2,90}?)\s{3,}(\d{1,3})(?:\s*[-–—]\s*\d{1,3})?$/
// Real contents tables often use a single space: "Chapter-1 Introduction 13-14"
const TOC_TAIL_RE = /^(.{2,90}?)\s+(\d{1,3})(?:\s*[-–—]\s*\d{1,3})?$/
const TOC_PAGE_HINT_RE = /^(index|contents?|table of contents|content page no\.?|appendices?)\s*$/i
/** Running footer/header furniture: "Page |2", "- 12 -", "12" */
const TOC_PAGE_LABEL_RE = /^page\s*[|:\-]?\s*\d+/i
const ROW_NUMBER_PREFIX_RE = /^\d{1,2}\.\s/

interface TocPageResult {
  page: number
  entries: TocEntry[]
}

/**
 * Parse one contents page into entries.
 *
 * Real TOCs wrap long rows across several physical lines:
 *   "6. VI Procedure to be adopted for compilation of NTA Score"
 *   "for Multi Shifts Papers in CUET (UG) 2026 58-67"
 *   "8. VIII Certificate regarding physical limitation in an Examinee"
 *   "to Write 71"
 * A naive per-line parse turns those continuations into bogus standalone
 * sections ("for Multi Shifts Papers…", "to Write") and loses the real ones.
 * So lines are walked in order with a PENDING title buffer:
 *   • a line with a trailing page number completes an entry (pending text is
 *     prepended; a pure-number "title" like "2026 74-94" is treated as the
 *     wrapped page of the pending text);
 *   • a plain title-looking line without a page number is held as pending;
 *   • row-number restarts ("1. I List of …"), headers/footers (repeated lines),
 *     page labels and contents-hint lines reset or skip the buffer.
 * As a final safety net, an entry whose title begins lowercase is merged into
 * the previous entry (it is the tail of a wrapped row that carried its own
 * page number).
 */
function detectTocOnPage(page: ExtractedPage, furniture: Set<string>): TocEntry[] {
  const lines = linesOf(page)
  if (lines.length < TOC_MIN_ENTRIES) return []
  const entries: TocEntry[] = []
  let pending = ''
  let hintSeen = false

  const pushEntry = (rawTitle: string, num: number | null) => {
    const title = cleanTitle(rawTitle)
    if (title.length < 2 || !WORD_RE.test(title)) return
    entries.push({ title, page: Number.isFinite(num) ? num : null })
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (TOC_PAGE_HINT_RE.test(line)) { hintSeen = true; pending = ''; continue }

    const m = TOC_LEADER_RE.exec(line) ?? TOC_GAP_RE.exec(line) ?? TOC_TAIL_RE.exec(line)
    if (m) {
      const rawTitle = m[1].replace(/[\s.·⋅•‣⁃…]+$/g, '').trim()
      const num = Number(m[2])
      // A row-number restart ("1. I List of Central Universities 35") is a NEW
      // row, never the continuation of the pending text above it.
      const startsNewRow = ROW_NUMBER_PREFIX_RE.test(rawTitle) || NUMBERED_L2_RE.test(rawTitle)
      if (PURE_NUMBER_RE.test(rawTitle)) {
        // "2026 74-94" — the wrapped row's tail is part of the title and the
        // number completes the pending entry ("… CUET (UG) – 2026  74-94").
        if (pending) { pushEntry(`${pending} ${rawTitle}`, num); pending = '' }
        continue
      }
      if (rawTitle.length < 2 || rawTitle.length > 90 || !WORD_RE.test(rawTitle)) continue
      // Data rows of reference lists ("101  Ahmedabad  Zone  2") start with a
      // multi-digit code and are NOT contents entries — they would flood the
      // TOC with junk sections on list-heavy documents.
      if (/^\d{2,}\s/.test(rawTitle)) continue
      if (startsNewRow || !pending) {
        if (pending) { pending = ''; }
        // lowercase-start titles are wrapped tails of the previous entry
        const prev = entries[entries.length - 1]
        if (prev && /^[a-z]/.test(rawTitle)) {
          prev.title = cleanTitle(`${prev.title} ${rawTitle}`).slice(0, 120)
          if (num !== null && !Number.isNaN(num)) prev.page = num
          continue
        }
        pushEntry(rawTitle, num)
      } else {
        pending = `${pending} ${rawTitle}`.slice(0, 240)
        pushEntry(pending, num)
        pending = ''
      }
      continue
    }

    // No page number on this line — hold as pending title text when it can
    // plausibly be one (running headers repeat across pages and are excluded).
    if (TOC_PAGE_LABEL_RE.test(line) || PURE_NUMBER_RE.test(line)) {
      // A bare number after pending title text is the wrapped row's page
      // ("9. IX / Certificate for person … / … in writing / 72").
      if (PURE_NUMBER_RE.test(line) && pending && !TOC_PAGE_LABEL_RE.test(line)) {
        pushEntry(pending, Number(line))
        pending = ''
      }
      continue
    }
    if (furniture.has(normKey(line))) continue
    if (line.length < 8 || line.length > 120) continue
    if (!WORD_RE.test(line)) continue
    if (entries.length === 0 && !hintSeen) continue // title/header before any entry
    pending = pending ? `${pending} ${line}` : line
  }

  // A page is a TOC page when either a clear majority of its lines are entries,
  // or it announces itself (Index / Contents / Appendices) and has several.
  const announces = hintSeen || lines.slice(0, 6).some(l => TOC_PAGE_HINT_RE.test(l))
  const threshold = announces
    ? Math.max(TOC_MIN_ENTRIES, Math.ceil(lines.length * 0.25))
    : Math.max(TOC_MIN_ENTRIES, Math.ceil(lines.length * 0.5))
  if (entries.length < threshold) return []
  // Real contents tables point FORWARD through the document; a page whose
  // claimed numbers cycle (1,2,3,4,1,2…) is a data list, not a contents page.
  const numbered = entries.filter(e => e.page !== null) as (TocEntry & { page: number })[]
  if (numbered.length >= TOC_MIN_ENTRIES) {
    let downs = 0
    for (let i = 1; i < numbered.length; i++) if (numbered[i].page < numbered[i - 1].page - 2) downs++
    if (downs / (numbered.length - 1) > 0.25) return []
  }
  return entries
}

/** Validate a TOC: entry pages must be plausible and broadly increasing. */
function validateToc(entries: TocEntry[], numPages: number): boolean {
  const withPages = entries.filter(e => e.page !== null) as (TocEntry & { page: number })[]
  if (withPages.length < TOC_MIN_ENTRIES) return false
  let inRange = 0
  for (const e of withPages) if (e.page >= 1 && e.page <= numPages) inRange++
  if (inRange / withPages.length < 0.8) return false
  // Broadly increasing: allow local noise (multi-column TOCs reorder), but the
  // overall trend must go up — otherwise the "TOC" is likely a name list.
  let up = 0
  let total = 0
  for (let i = 1; i < withPages.length; i++) {
    total++
    if (withPages[i].page >= withPages[i - 1].page - 2) up++
  }
  return total === 0 || up / total >= 0.75
}

// ─── Heading detection ────────────────────────────────────────────────────────

const CHAPTER_WORD_RE =
  /^(chapter|unit|section|part|module|appendix|annexure|annex|experiment|activity|practical|lesson)\s*[-–—:]?\s*([0-9ivxlcdm]+|[a-z])\b[\s.:–—-]*(.*)$/i
const NUMBERED_L1_RE = /^(\d{1,2})[.)]\s+(\S.*)$/
const NUMBERED_L2_RE = /^(\d{1,2})\.(\d{1,2})[.)]?\s+(\S.*)$/
const SECTION_LABEL_RE = /^(section|part|paper|book)\s+[-–—:]?\s*([A-Z0-9IVX]{1,4})\b(.*)$/i
const QUESTION_LINE_RE = /^\d{1,3}[.)]\s+(.{10,})$/
const PURE_NUMBER_RE = /^\d{1,4}$/
const ROMAN_RE = /^(?:[ivxlcdm]{1,7})$/i
/** "CHAPTER 10", "Appendix VII", "UNIT 3" — a bare label with no title text */
const BARE_CHAPTER_RE = /^(chapter|unit|part|section|appendix|annexure|annex)\s*[-–—:]?\s*([0-9ivxlcdm]{1,5}|[a-z])\.?$/i

interface LineHit {
  title: string
  level: 1 | 2
  score: number
  page: number
  lineIdx: number
}

function headingScore(line: string, inTocTitles: Set<string>): { level: 1 | 2; score: number; title: string } | null {
  const raw = line.trim()
  if (raw.length < 3 || raw.length > HEADING_MAX_LEN) return null
  if (PURE_NUMBER_RE.test(raw)) return null
  if (/[.,;:]$/.test(raw) && !NUMBERED_L1_RE.test(raw) && !NUMBERED_L2_RE.test(raw)) return null
  if (NON_HEADING_RE.test(raw)) return null

  // x.y numbered subsection — strongest hierarchical signal
  const l2 = NUMBERED_L2_RE.exec(raw)
  if (l2 && l2[3].length >= 3 && WORD_RE.test(l2[3])) {
    return { level: 2, score: 6, title: l2[3].trim() }
  }

  // Chapter / Unit / Appendix … style — keep the document's own wording
  const ch = CHAPTER_WORD_RE.exec(raw)
  if (ch) {
    return { level: 1, score: 7, title: cleanTitle(raw) }
  }

  // "Section A", "PART — I"
  const sec = SECTION_LABEL_RE.exec(raw)
  if (sec && (sec[3] ?? '').trim().length < 40) {
    return { level: 1, score: 5, title: cleanTitle(raw) }
  }

  // Numbered top-level heading "12. Reservation Policy"
  const l1 = NUMBERED_L1_RE.exec(raw)
  if (l1) {
    const title = l1[2].trim()
    if (title.length >= 3 && WORD_RE.test(title) && !QUESTION_LINE_RE.test(raw)) {
      const bonus = inTocTitles.has(normKey(title)) ? 2 : 0
      return { level: 1, score: 4 + bonus, title: cleanTitle(title) }
    }
    return null
  }

  // ALL-CAPS short line
  const ls = letters(raw)
  if (ls.length >= 4 && upperRatio(raw) >= 0.8 && raw.split(/\s+/).length <= 12) {
    const bonus = inTocTitles.has(normKey(raw)) ? 2 : 0
    return { level: 1, score: 3 + bonus, title: cleanTitle(raw) }
  }

  // Title-Case short line (two+ capitalised words, no ending punctuation)
  const words = raw.split(/\s+/)
  if (words.length >= 2 && words.length <= 10 && titleCaseRatio(raw) >= 0.7 && raw.length >= 8) {
    const bonus = inTocTitles.has(normKey(raw)) ? 3 : 0
    // Without a TOC match, plain Title-Case lines are weak signals — they are
    // often names, table headers or list items. Only TOC-corroborated ones or
    // clearly heading-ish lines (no verb-ish trailing punctuation) pass.
    if (bonus > 0) return { level: 1, score: 3 + bonus, title: cleanTitle(raw) }
    return null
  }

  return null
}

function cleanTitle(t: string): string {
  return t.replace(/\s+/g, ' ').replace(/[.:]\s*$/, '').trim().slice(0, 90)
}

/** Remove leading row numbers from a TOC entry title: "1.1 About NTA" → "About NTA". */
function stripEntryTitle(t: string): string {
  return t
    .replace(/^\d{1,2}\.\d{1,2}\s*[.)]?\s*/, '')
    .replace(/^\d{1,2}\s*[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** x.y subsection rows of a contents table ("1.1 About NTA  13") */
const SUBSECTION_ROW_RE = /^\d{1,2}\.\d{1,2}\b/

/** Normalisation used to correlate TOC titles with body headings. */
export function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|of|for|and|in|to|on)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Printed page number detection ────────────────────────────────────────────

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

function romanToInt(s: string): number | null {
  const str = s.toLowerCase()
  if (!/^[ivxlcdm]+$/.test(str)) return null
  let total = 0
  let prev = 0
  for (let i = str.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[str[i]]
    if (v < prev) total -= v
    else {
      total += v
      prev = v
    }
  }
  return total >= 1 ? total : null
}

function printedLabelFromEdge(lines: string[]): string | null {
  const edges = [...lines.slice(0, 2), ...lines.slice(-2)]
  for (const line of edges) {
    if (line.length > 40) continue
    // "Page 12 of 96", "Page |12", "Page | 12", "12", "- 12 -", "12."
    const m1 = /^page\s*[|:\-]?\s*(\d{1,4})(?:\s*(?:of|\/)\s*\d{1,4})?$/i.exec(line)
    if (m1) return m1[1]
    const m2 = /^[-–—\s]*(\d{1,4})[-–—\s.]*$/.exec(line)
    if (m2) return m2[1]
    if (ROMAN_RE.test(line) && line.length <= 7) {
      const v = romanToInt(line)
      if (v !== null && v <= 100) return line.toLowerCase()
    }
  }
  return null
}

export function detectPrintedPages(pages: ExtractedPage[]): PrintedPageInfo {
  const pairs: { physical: number; printed: number | null; roman: boolean }[] = []
  for (const p of pages) {
    if (p.scanned || !p.text) {
      pairs.push({ physical: p.page, printed: null, roman: false })
      continue
    }
    const label = printedLabelFromEdge(linesOf(p))
    if (label === null) {
      pairs.push({ physical: p.page, printed: null, roman: false })
    } else if (/^\d+$/.test(label)) {
      pairs.push({ physical: p.page, printed: Number(label), roman: false })
    } else {
      pairs.push({ physical: p.page, printed: romanToInt(label), roman: true })
    }
  }

  // Roman front matter anywhere in the first 15% of the document
  const headCount = Math.max(1, Math.ceil(pairs.length * 0.15))
  const romanFrontMatter = pairs.slice(0, headCount).some(p => p.roman && p.printed !== null)

  // Longest consistent arabic run: printed = physical + offset
  let bestOffset: number | null = null
  let bestRun = 0
  const byOffset = new Map<number, number>()
  for (const p of pairs) {
    if (p.printed === null || p.roman) continue
    const offset = p.physical - p.printed
    if (offset < 0 || offset > 60) continue // cover/plate offsets beyond 60 are implausible
    byOffset.set(offset, (byOffset.get(offset) ?? 0) + 1)
  }
  for (const [offset, count] of byOffset) {
    if (count > bestRun) {
      bestRun = count
      bestOffset = offset
    }
  }
  // Require the offset to hold for a meaningful share of pages (≥5 and ≥25%)
  const arabicPages = pairs.filter(p => p.printed !== null && !p.roman).length
  if (bestOffset !== null && !(bestRun >= 5 && bestRun >= arabicPages * 0.5 && arabicPages >= pages.length * 0.25)) {
    bestOffset = null
  }
  return { offset: bestOffset, romanFrontMatter }
}

// ─── Main detection ───────────────────────────────────────────────────────────

export function detectStructure(pages: ExtractedPage[], numPages: number, opts: BuildUnitsOptions): DetectedStructure {
  const readable = pages.filter(p => !p.scanned && p.text.length > 0)
  const printed = detectPrintedPages(pages)

  // Running headers/footers repeat across pages; inside a contents table such
  // lines must never be mistaken for a wrapped title row.
  const furniture = new Set<string>()
  {
    const freq = new Map<string, Set<number>>()
    for (const p of readable.slice(0, 15)) {
      for (const l of linesOf(p)) {
        if (l.length < 4 || l.length > 70) continue
        const key = normKey(l)
        if (!key) continue
        const set = freq.get(key) ?? new Set<number>()
        set.add(p.page)
        freq.set(key, set)
      }
    }
    for (const [key, pageSet] of freq) if (pageSet.size >= 2) furniture.add(key)
  }

  // 1 ── TOC pages
  const tocPages: TocPageResult[] = []
  for (const p of readable.slice(0, 15)) {
    const entries = detectTocOnPage(p, furniture)
    if (entries.length > 0) tocPages.push({ page: p.page, entries })
  }
  const allTocEntries = tocPages.flatMap(t => t.entries)
  const tocValidated = validateToc(allTocEntries, numPages)
  // Titles stripped of leading row numbers ("1.1 About NTA" → "About NTA") so
  // TOC entries correlate with the body's own headings.
  const tocTitleKeys = new Set(allTocEntries.map(e => normKey(stripEntryTitle(e.title))))

  // 2 ── Heading candidates over all readable lines
  const hits: LineHit[] = []
  let questionLines = 0
  let contentLines = 0
  for (const p of readable) {
    const onTocPage = tocPages.some(t => t.page === p.page)
    const lines = linesOf(p)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length >= 12) contentLines++
      if (QUESTION_LINE_RE.test(line)) questionLines++
      if (onTocPage) continue // TOC lines look like headings but are not
      const h = headingScore(line, tocTitleKeys)
      if (!h) continue
      // Bare "CHAPTER 10" / "APPENDIX VII" headings: the real title often sits
      // on the next line — merge it so the topic keeps the document's wording.
      let title = h.title
      let consumedExtra = 0
      const bare = BARE_CHAPTER_RE.exec(h.title)
      if (bare) {
        const next = lines[i + 1]
        if (
          next && next.length >= 3 && next.length <= 90 && !PURE_NUMBER_RE.test(next) &&
          !NON_HEADING_RE.test(next) && !headingScore(next, tocTitleKeys) && !QUESTION_LINE_RE.test(next)
        ) {
          title = cleanTitle(`${h.title} ${next}`)
          consumedExtra = 1
        }
      }
      hits.push({ title, level: h.level, score: h.score, page: p.page, lineIdx: i })
      i += consumedExtra
    }
  }

  // 3 ── Question-paper layout? High numbered-line density + explicit marks
  // instructions near the front — both together, so ordinary numbered lists in
  // textbooks (or a phone directory) are not misclassified.
  const marksMention = readable
    .slice(0, 8)
    .some(p => /marks?\s*[:：]|max(?:imum)?\s*marks|time\s*(?:allowed|:)\s*\d/i.test(p.text))
  const questionPaper =
    contentLines > 30 && questionLines / Math.max(1, contentLines) >= QUESTION_LINE_RATIO && marksMention

  // 4 ── Heading density sanity: too many "headings" ⇒ they are not headings
  let headingHits = hits.filter(h => h.score >= 4)
  const density = contentLines > 0 ? headingHits.length / contentLines : 0
  if (density > HEADING_DENSITY_LIMIT) headingHits = headingHits.filter(h => h.score >= 6)
  if (contentLines > 0 && headingHits.length / contentLines > HEADING_DENSITY_LIMIT) headingHits = []

  // 5 ── Corroborate with the TOC: boost + mark
  const headings: HeadingHit[] = []
  let lastKey = ''
  for (const h of headingHits) {
    const key = normKey(h.title)
    if (!key || key === lastKey) continue // consecutive duplicate line
    lastKey = key
    headings.push({
      title: h.title,
      page: h.page,
      lineIdx: h.lineIdx,
      level: h.level,
      score: h.score,
      fromToc: tocTitleKeys.has(key),
    })
  }

  // Drop weak one-off headings when a TOC exists (they are usually noise);
  // keep everything when the TOC corroborates them.
  const filtered = headings.filter(h => !tocValidated || h.fromToc || h.score >= 4)

  // 6 ── Units. When a validated TOC exists, the document's own contents table
  // (validated against the body) defines the major sections — that is more
  // faithful than any heading heuristic. Headings are the fallback.
  let units: AnalysisUnit[] | null = null
  let kind: StructureKind
  if (questionPaper) {
    kind = 'QUESTION_PAPER'
  } else {
    if (tocValidated) units = buildTocUnits(readable, allTocEntries, printed.offset, opts)
    if (units && units.length >= 2) {
      kind = 'TOC_GUIDED'
    } else {
      units = null
      kind = filtered.length >= 3 ? (tocValidated ? 'TOC_GUIDED' : 'HEADING_GUIDED') : 'UNSTRUCTURED'
    }
  }
  if (!units) units = buildUnits(readable, filtered, kind, opts)

  return {
    kind,
    toc: allTocEntries,
    tocValidated,
    headings: filtered,
    printed,
    units,
    tocPages: tocPages.map(t => t.page),
  }
}

// ─── Analysis units ───────────────────────────────────────────────────────────

/**
 * Build units directly from a VALIDATED table of contents: each major (non
 * x.y) entry becomes a section whose physical start page is the entry's page
 * (printed + detected offset) — but only when the body page actually contains
 * the entry's words. If too few entries verify, returns null so the caller
 * falls back to heading-anchored units. This is what makes page references
 * land on the right page in documents with a real contents table.
 */
export function buildTocUnits(
  readable: ExtractedPage[],
  entries: TocEntry[],
  printedOffset: number | null,
  opts: BuildUnitsOptions,
): AnalysisUnit[] | null {
  const physicalOf = (printed: number) => (printedOffset !== null ? printed + printedOffset : printed)
  const pageByNumber = new Map(readable.map(p => [p.page, p] as const))
  const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ')

  const majors = entries
    .filter(e => e.page !== null && !SUBSECTION_ROW_RE.test(e.title.trim()))
    .map(e => ({ title: stripEntryTitle(e.title), physical: physicalOf(e.page as number) }))
    .filter(x => x.title.length >= 2 && x.title.length <= 95)
  if (majors.length < TOC_MIN_ENTRIES) return null

  // Wrapped TOC rows continue on the next line claiming the same page —
  // "…General Aptitude" + "Test under CUET (UG) – 2026 37-38" are ONE section.
  const mergedMajors: { title: string; physical: number }[] = []
  for (const m of majors) {
    const prev = mergedMajors[mergedMajors.length - 1]
    if (prev && prev.physical === m.physical) {
      prev.title = cleanTitle(`${prev.title} ${m.title}`)
      continue
    }
    mergedMajors.push({ ...m })
  }
  if (mergedMajors.length < TOC_MIN_ENTRIES) return null

  // Verify each entry against the physical page it claims
  const verified: { title: string; physical: number }[] = []
  for (const m of mergedMajors) {
    const page = pageByNumber.get(m.physical)
    if (!page) continue
    const hay = normText(page.text)
    const tokens = normKey(m.title).split(' ').filter(t => t.length > 3)
    const hit = tokens.length === 0 || tokens.some(t => hay.includes(t))
    if (hit) verified.push(m)
  }
  if (verified.length < TOC_MIN_ENTRIES || verified.length < Math.ceil(majors.length * 0.5)) return null

  verified.sort((a, b) => a.physical - b.physical)
  const cleaned = verified.filter((v, i) => i === 0 || v.physical > verified[i - 1].physical)
  if (cleaned.length < TOC_MIN_ENTRIES) return null

  const units: AnalysisUnit[] = []
  const textOf = (from: number, to: number) =>
    readable
      .filter(p => p.page >= from && p.page <= to)
      .map(p => `[page ${p.page}]\n${p.text}`)
      .join('\n\n')

  const pushRange = (title: string | null, from: number, to: number, kind: AnalysisUnit['kind']) => {
    const pagesSlice = readable.filter(p => p.page >= from && p.page <= to)
    if (pagesSlice.length === 0) return
    // oversize ranges split into consecutive chunks under the same title
    let start = pagesSlice[0]
    let prev = pagesSlice[0]
    let chars = 0
    const flush = () => {
      units.push({
        index: units.length, title, level: title ? 1 : null,
        fromPage: start.page, toPage: prev.page, text: textOf(start.page, prev.page),
        chars, kind,
      })
    }
    for (const p of pagesSlice) {
      if (chars > 0 && chars + p.text.length > opts.maxUnitChars) {
        flush()
        start = p
        chars = 0
      }
      chars += p.text.length
      prev = p
    }
    if (chars > 0) flush()
  }

  // Front matter: everything before the first verified entry
  const first = cleaned[0].physical
  const front = readable.filter(p => p.page < first)
  if (front.length > 0) pushRange(null, front[0].page, front[front.length - 1].page, 'FRONT')

  for (let i = 0; i < cleaned.length; i++) {
    const from = cleaned[i].physical
    const to = i + 1 < cleaned.length ? Math.min(cleaned[i + 1].physical - 1, readable[readable.length - 1].page) : readable[readable.length - 1].page
    if (to < from) continue
    pushRange(cleaned[i].title, from, to, 'SECTION')
  }

  return units.length >= 2 ? units.map((u, i) => ({ ...u, index: i })) : null
}

/**
 * Build analysis units that cover every readable page exactly once.
 * TOC/heading-guided documents are sliced at real heading boundaries (level-1
 * sections, split at level-2 subsections when oversize); everything else falls
 * back to whole-document page chunks. Tiny neighbouring sections are merged so
 * one-line headings don't each cost a model call, and oversize sections are
 * split further so no single call exceeds the char budget.
 */
export function buildUnits(
  readable: ExtractedPage[],
  headings: HeadingHit[],
  kind: StructureKind,
  opts: BuildUnitsOptions,
): AnalysisUnit[] {
  const units: AnalysisUnit[] = []

  const pushUnit = (u: Omit<AnalysisUnit, 'index'>) => {
    units.push({ ...u, index: units.length })
  }

  const textOf = (from: ExtractedPage, to: ExtractedPage) =>
    readable
      .slice(readable.indexOf(from), readable.indexOf(to) + 1)
      .map(p => `[page ${p.page}]\n${p.text}`)
      .join('\n\n')

  if (kind === 'TOC_GUIDED' || kind === 'HEADING_GUIDED') {
    // Anchor each level-1 heading to its page; sections span to the next level-1 anchor.
    const anchors = headings
      .filter(h => h.level === 1)
      .sort((a, b) => a.page - b.page || a.lineIdx - b.lineIdx)
    // Collapse anchors that land on the same page with the same key (repeat prints)
    const deduped: HeadingHit[] = []
    for (const a of anchors) {
      const prev = deduped[deduped.length - 1]
      if (prev && prev.page === a.page && normKey(prev.title) === normKey(a.title)) continue
      deduped.push(a)
    }


    // Front matter: readable pages before the first anchor
    const firstAnchorPage = deduped[0]?.page ?? null
    const frontPages = firstAnchorPage ? readable.filter(p => p.page < firstAnchorPage) : []
    if (frontPages.length > 0) {
      const from = frontPages[0]
      const to = frontPages[frontPages.length - 1]
      pushUnit({ title: null, level: null, fromPage: from.page, toPage: to.page, text: textOf(from, to), chars: frontPages.reduce((s, p) => s + p.text.length, 0), kind: 'FRONT' })
    }

    for (let i = 0; i < deduped.length; i++) {
      const anchor = deduped[i]
      const nextPage = deduped[i + 1]?.page ?? null
      const sectionPagesList = readable.filter(p => p.page >= anchor.page && (nextPage === null || p.page < nextPage))
      if (sectionPagesList.length === 0) continue
      // Split oversize sections at level-2 heading pages within the section
      const subAnchors = headings
        .filter(h => h.level === 2 && h.page >= anchor.page && (nextPage === null || h.page < nextPage))
        .sort((a, b) => a.page - b.page)
      const segments: { from: ExtractedPage; to: ExtractedPage; title: string | null }[] = []
      let cursorPage = anchor.page
      for (const sub of subAnchors) {
        if (sub.page <= cursorPage) continue
        const from = readable.find(p => p.page === cursorPage)
        const to = readable.find(p => p.page === sub.page - 1) ?? readable.find(p => p.page === cursorPage)
        if (from && to) segments.push({ from, to, title: null })
        cursorPage = sub.page
      }
      {
        const from = readable.find(p => p.page === cursorPage)
        const to = sectionPagesList[sectionPagesList.length - 1]
        if (from && to) segments.push({ from, to, title: null })
      }

      let pendingFrom: ExtractedPage | null = null
      let pendingChars = 0
      let pendingStartPage = anchor.page
      const flushPending = (upto: ExtractedPage) => {
        if (!pendingFrom) return
        pushUnit({
          title: anchor.title,
          level: 1,
          fromPage: pendingStartPage,
          toPage: upto.page,
          text: textOf(pendingFrom, upto),
          chars: pendingChars,
          kind: 'SECTION',
        })
        pendingFrom = null
        pendingChars = 0
      }
      for (const seg of segments) {
        const segPages = readable.filter(p => p.page >= seg.from.page && p.page <= seg.to.page)
        const segChars = segPages.reduce((s, p) => s + p.text.length, 0)
        if (!pendingFrom) {
          pendingFrom = segPages[0]
          pendingStartPage = pendingFrom.page
          pendingChars = segChars
        } else {
          pendingChars += segChars
        }
        if (pendingChars >= opts.maxUnitChars) flushPending(seg.to)
      }
      flushPending(segments[segments.length - 1]?.to ?? sectionPagesList[sectionPagesList.length - 1])
    }

    // Sanity: any readable pages beyond the last anchor (appendices etc.)
    const lastCovered = units.reduce((m, u) => Math.max(m, u.toPage), 0)
    const tail = readable.filter(p => p.page > lastCovered)
    if (tail.length > 0) {
      pushUnit({
        title: deduped.length > 0 ? 'Appendix & back matter' : null,
        level: deduped.length > 0 ? 1 : null,
        fromPage: tail[0].page,
        toPage: tail[tail.length - 1].page,
        text: textOf(tail[0], tail[tail.length - 1]),
        chars: tail.reduce((s, p) => s + p.text.length, 0),
        kind: 'SECTION',
      })
    }

    // Merge tiny units forward (a 1-line heading should not cost a model call)
    return mergeTinyUnits(units, opts.maxUnitChars)
  }

  // Fallback: UNSTRUCTURED / QUESTION_PAPER — page chunks across the WHOLE doc
  let cur: ExtractedPage[] = []
  let curChars = 0
  const flush = () => {
    if (cur.length === 0) return
    const from = cur[0]
    const to = cur[cur.length - 1]
    pushUnit({
      title: null,
      level: null,
      fromPage: from.page,
      toPage: to.page,
      text: textOf(from, to),
      chars: curChars,
      kind: kind === 'QUESTION_PAPER' ? 'CHUNK' : 'CHUNK',
    })
    cur = []
    curChars = 0
  }
  for (const p of readable) {
    if (p.text.length > opts.maxUnitChars) {
      flush()
      const text = `[page ${p.page}]\n${p.text.slice(0, opts.maxUnitChars)}`
      pushUnit({ title: null, level: null, fromPage: p.page, toPage: p.page, text, chars: text.length, kind: 'OVERFLOW' })
      continue
    }
    if (curChars + p.text.length > opts.maxUnitChars) flush()
    cur.push(p)
    curChars += p.text.length
  }
  flush()
  return units
}

function mergeTinyUnits(units: AnalysisUnit[], maxUnitChars: number): AnalysisUnit[] {
  const out: AnalysisUnit[] = []
  for (const u of units) {
    const prev = out[out.length - 1]
    const tiny = u.chars < MIN_UNIT_CHARS
    if (
      tiny && prev && prev.kind === 'SECTION' && u.kind === 'SECTION' &&
      prev.title === u.title && // never fuse two different sections — a short chapter is still a chapter
      prev.chars + u.chars <= maxUnitChars
    ) {
      prev.toPage = u.toPage
      prev.text = `${prev.text}\n\n${u.text}`
      prev.chars += u.chars
      continue
    }
    out.push({ ...u })
  }
  return out.map((u, i) => ({ ...u, index: i }))
}
