// ─── Riishe document extraction: real PDF text, page by page ─────────────────
// Uses the already-installed pdfjs-dist (legacy build runs on Node without a
// worker). Produces per-page text with character counts so scanned / image-only
// pages are detected honestly — OCR is NOT available in this stack, and we say
// so instead of pretending to have read such pages.

export interface ExtractedPage {
  page: number
  chars: number
  text: string
  scanned: boolean
  /** Per-page extraction outcome. Older stored extractions lack the field —
   *  consumers treat a missing outcome with chars > 0 as 'extracted'. */
  outcome?: 'extracted' | 'scanned' | 'failed'
}

export interface ExtractionResult {
  pages: ExtractedPage[]
  numPages: number
  textChars: number
  scannedPages: number
  titleGuess: string | null
}

// A page with fewer readable characters than this is treated as image-only.
const SCANNED_PAGE_THRESHOLD = 32
const MAX_PAGES = 400 // hard safety cap for very large files

export async function extractPdfPages(data: Uint8Array): Promise<ExtractionResult> {
  // Imported lazily so route modules that never touch extraction don't pay for it
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  })
  const doc = await task.promise

  const numPages = Math.min(doc.numPages, MAX_PAGES)
  const pages: ExtractedPage[] = []
  let titleGuess: string | null = null

  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    // pdf.js text items are positioned fragments. Rebuild REAL lines using the
    // hasEOL flag so headings, TOC entries and page numbers survive as lines —
    // this is what makes deterministic structure detection possible later.
    const lines: string[] = []
    let line = ''
    for (const it of tc.items) {
      if (!('str' in it)) continue
      line += it.str ?? ''
      if (it.hasEOL) {
        const l = line.replace(/\s+/g, ' ').trim()
        if (l) lines.push(l)
        line = ''
      }
    }
    const tail = line.replace(/\s+/g, ' ').trim()
    if (tail) lines.push(tail)
    let text = lines.join('\n').trim()
    const chars = text.length
    const scanned = chars < SCANNED_PAGE_THRESHOLD
    if (!scanned) {
      if (!titleGuess) {
        // Heuristic: the first substantial line of page 1 is usually the title
        const firstLine = lines[0] ?? ''
        titleGuess = firstLine.replace(/\s+/g, ' ').slice(0, 120) || null
      }
    } else {
      text = ''
    }
    pages.push({ page: p, chars, text, scanned, outcome: scanned ? 'scanned' : 'extracted' })
    // Release page resources eagerly for large documents
    page.cleanup()
  }

  const textChars = pages.reduce((s, p) => s + p.chars, 0)
  const scannedPages = pages.filter(p => p.scanned).length

  await task.destroy()
  return { pages, numPages: doc.numPages ?? numPages, textChars, scannedPages, titleGuess }
}

// ─── Sectioning for long documents ────────────────────────────────────────────
// Coherent chunks that never split a page in half, keep page numbers, and stay
// within a size budget for model calls.

export interface DocSection {
  index: number
  label: string // "pages 1–4"
  fromPage: number
  toPage: number
  text: string
  chars: number
}

export function sectionPages(
  pages: ExtractedPage[],
  opts: { maxChars: number; maxSections: number },
): DocSection[] {
  const readable = pages.filter(p => !p.scanned && p.chars > 0)
  const sections: DocSection[] = []
  let cur: ExtractedPage[] = []
  let curChars = 0

  const flush = () => {
    if (cur.length === 0) return
    const from = cur[0].page
    const to = cur[cur.length - 1].page
    const text = cur.map(p => `[page ${p.page}]\n${p.text}`).join('\n\n')
    sections.push({
      index: sections.length,
      label: from === to ? `page ${from}` : `pages ${from}–${to}`,
      fromPage: from,
      toPage: to,
      text,
      chars: curChars,
    })
    cur = []
    curChars = 0
  }

  for (const page of readable) {
    // A single page longer than the budget still becomes its own (truncated) section
    if (page.chars > opts.maxChars) {
      flush()
      const text = `[page ${page.page}]\n${page.text.slice(0, opts.maxChars)}`
      sections.push({
        index: sections.length,
        label: `page ${page.page} (excerpt)`,
        fromPage: page.page,
        toPage: page.page,
        text,
        chars: text.length,
      })
      continue
    }
    if (curChars + page.chars > opts.maxChars) flush()
    cur.push(page)
    curChars += page.chars
    if (sections.length >= opts.maxSections) break
  }
  flush()
  return sections.slice(0, opts.maxSections)
}
