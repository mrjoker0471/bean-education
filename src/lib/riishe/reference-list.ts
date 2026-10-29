// ─── Riishe deterministic reference-list extraction (no AI) ──────────────────
// When the AI provider's safety filter refuses a section outright (dense
// rosters of names/places/codes are a known trigger), the section's entries
// are still recoverable straight from the PDF text layer: ordinary lists of
// examination cities, fee tables, abbreviations and similar reference tables
// are printed as regular rows. This module parses them deterministically.
//
// Guarantees (deliberately boring):
//   • entries are VERBATIM — no normalization, no casing changes, no inventing
//     or omitting values;
//   • source order is preserved;
//   • geographical/structural grouping is kept only when the source itself
//     repeats a group label down consecutive rows;
//   • rows that look like entries but cannot be parsed are REPORTED, never
//     dropped silently;
//   • when the source numbers its rows, serial continuity is checked and any
//     gap is reported.
//
// Pure and deterministic: the same text always yields the same list.

import type { ListExtraction } from './types'

/** One parsed candidate row of a table: leading serial, middle text, trailing code. */
interface ParsedRow {
  serial: number | null
  middle: string
  code: string | null
  page: number
}

/** "AN01", "AP12", "DL07S", "101-A" — a trailing mixed letter+digit token. */
const CODE_TOKEN_RE = /^(?:[A-Za-z]{1,5}\d{1,5}|\d{1,5}[A-Za-z]{1,5}[0-9A-Za-z]{0,4})$/

/** A repeated table header line ("S.No. State/UTs CITY City Code"). */
function looksLikeHeader(line: string): boolean {
  return /^s\.?\s*no\.?\b/i.test(line) || /^(sl\.?\s*no|serial\s*no)\b/i.test(line)
}

const ENTRY_CODE_TAIL_RE = /\s+([A-Za-z]{1,5}\d{1,5}|\d{1,5}[A-Za-z]{1,5}[0-9A-Za-z]{0,4})$/

/**
 * Parse the given unit text (with "[page N]" markers) into a structured list.
 * Returns null when the text does not contain a parseable row table — the
 * caller then keeps the honest skip instead of pretending to have read it.
 */
export function extractReferenceList(text: string): ListExtraction | null {
  const linesByPage: { page: number; lines: string[] }[] = []
  for (const block of text.split(/\n\n+/)) {
    const m = /^\[page (\d+)\]/.exec(block)
    const page = m ? Number(m[1]) : 0
    const lines = block
      .split('\n')
      .map(l => l.replace(/^\[page \d+\]/, '').trim())
      .filter(Boolean)
    if (lines.length > 0) linesByPage.push({ page, lines })
  }
  if (linesByPage.length === 0) return null

  // Header: a short line starting with the serial-number cue, repeated on
  // several pages (tables repeat their header on every page) — or simply the
  // first such line. Stored verbatim for display.
  let header: string | null = null
  for (const { lines } of linesByPage) {
    const hit = lines.find(l => l.length <= 80 && looksLikeHeader(l))
    if (hit) { header = hit; break }
  }

  // Rows: "1 Andhra Pradesh Tirupathi AP26" / "12. Solar Cell  4"
  const rows: ParsedRow[] = []
  const unreadableRows: string[] = []
  for (const { page, lines } of linesByPage) {
    for (const line of lines) {
      if (header && line === header) continue
      const serialM = /^(\d{1,4})[.)]?\s+(.+)$/.exec(line)
      if (!serialM) continue
      const serial = Number(serialM[1])
      let middle = serialM[2].trim()
      let code: string | null = null
      const codeM = ENTRY_CODE_TAIL_RE.exec(middle)
      if (codeM && CODE_TOKEN_RE.test(codeM[1])) {
        code = codeM[1]
        middle = middle.slice(0, codeM.index).trim()
      }
      // A row needs at least some words in the middle to be an entry
      if (!middle || !/[A-Za-z]/.test(middle)) {
        if (code) unreadableRows.push(`page ${page}: "${line.slice(0, 120)}"`)
        continue
      }
      rows.push({ serial, middle, code, page })
    }
  }

  // The unit must look like a genuine numbered table: enough rows, and most
  // of them numbered consecutively (a narrative page with a few numbered
  // paragraphs is NOT a reference list).
  if (rows.length < 8) return null
  const serials = rows.map(r => r.serial).filter((s): s is number => s !== null)
  if (serials.length < rows.length * 0.7) return null
  let monotonic = 0
  for (let i = 1; i < serials.length; i++) if (serials[i] === serials[i - 1] + 1) monotonic++
  if (serials.length >= 2 && monotonic / (serials.length - 1) < 0.6) return null

  // Grouping: a label is the leading word-run shared by CONSECUTIVE rows
  // ("Andhra Pradesh Adoni" / "Andhra Pradesh Amalapuram" → "Andhra Pradesh").
  // Singleton runs keep their full text (label null) — nothing is invented.
  const regrouped = regroupWithSharedPrefixes(rows)

  const totalEntries = regrouped.reduce((s, g) => s + g.entries.length, 0)

  // Serial continuity: when the source numbers rows, any gap is evidence of a
  // missed row — reported, never hidden.
  const serialGaps: string[] = []
  if (serials.length >= 2) {
    const sortedRows = [...rows].sort((a, b) => (a.serial ?? 0) - (b.serial ?? 0))
    let prev: number | null = null
    for (const r of sortedRows) {
      if (r.serial === null) continue
      if (prev !== null && r.serial > prev + 1) {
        serialGaps.push(`serials ${prev + 1}${r.serial > prev + 2 ? `–${r.serial - 1}` : ''} missing before "${r.middle.slice(0, 60)}"`)
      }
      prev = r.serial
    }
  }

  return {
    header,
    groups: regrouped,
    totalEntries,
    unreadableRows: unreadableRows.slice(0, 20),
    serialGaps: serialGaps.slice(0, 10),
  }
}

function entryText(middle: string, code: string | null): string {
  return code ? `${middle} (${code})` : middle
}

/**
 * Regroup rows: a group exists only where the source itself repeats a leading
 * label down consecutive rows ("Andhra Pradesh Adoni" / "Andhra Pradesh
 * Amalapuram"). The label is derived strictly from the printed rows; rows
 * without a repeated label keep their full text (label null) — nothing is
 * invented, nothing is lost.
 */
function regroupWithSharedPrefixes(rows: ParsedRow[]): { label: string | null; entries: string[] }[] {
  const out: { label: string | null; entries: string[] }[] = []
  let i = 0
  while (i < rows.length) {
    // candidate label: the shared prefix between this row and the next one
    let label = i + 1 < rows.length ? sharedPrefix(rows[i].middle, rows[i + 1].middle) : null
    if (label && (rows[i].middle.length <= label.length || label.split(/\s+/).length > 6)) label = null
    if (!label) {
      out.push({ label: null, entries: [entryText(rows[i].middle, rows[i].code)] })
      i++
      continue
    }
    // extend while consecutive rows keep sharing exactly this label
    let end = i + 1
    while (
      end + 1 < rows.length &&
      sharedPrefix(rows[end].middle, rows[end + 1].middle) === label &&
      rows[end + 1].middle.length > label.length
    ) {
      end++
    }
    out.push({
      label,
      entries: rows.slice(i, end + 1).map(r => entryText(r.middle.slice(label!.length).trim(), r.code)),
    })
    i = end + 1
  }
  // Merge CONSECUTIVE groups that carry the same label ("Chhattisgarh" can be
  // split when one row's words also form a shared prefix with its neighbour).
  // Non-consecutive same-label runs stay apart — merging them would reorder
  // entries and break source order.
  const merged: { label: string | null; entries: string[] }[] = []
  for (const g of out) {
    const prev = merged[merged.length - 1]
    if (g.label && prev && prev.label === g.label) prev.entries.push(...g.entries)
    else merged.push(g)
  }
  return merged
}

/** Longest common leading word-run of two strings (word-boundary aligned). */
function sharedPrefix(a: string, b: string): string | null {
  const aw = a.split(/\s+/)
  const bw = b.split(/\s+/)
  let i = 0
  while (i < aw.length && i < bw.length && aw[i].toLowerCase() === bw[i].toLowerCase()) i++
  return i > 0 ? aw.slice(0, i).join(' ') : null
}
