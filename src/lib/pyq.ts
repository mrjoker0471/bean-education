// ─── PYQ (previous-year question) ingestion helpers — Phase 2A ────────────────
// PURE functions only: no database, no Next.js imports. Safe to call from the
// import route, the review route and offline tooling. Server-only because of
// node:crypto (never bundle this into client code).
//
// Design principles:
//   • Hashing is content-based: the same question text + options + answer key
//     always produces the same pyqHash, regardless of cosmetic differences
//     (case, punctuation, extra whitespace). This powers duplicate detection.
//   • Validation is row-scoped and returns a single honest error message —
//     one bad row never blocks a whole import batch.

import { createHash } from 'node:crypto'
import { isValidAnswerIndex } from '@/lib/answer-index'

export const PYQ_DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const
export type PyqDifficulty = (typeof PYQ_DIFFICULTIES)[number]

export const PYQ_YEAR_MIN = 1990
export const PYQ_YEAR_MAX = 2035

export interface PyqItemInput {
  text?: unknown
  options?: unknown
  correctIndex?: unknown
  explanation?: unknown
  difficulty?: unknown
  year?: unknown
  sourceRef?: unknown
  stageId?: unknown
  subjectId?: unknown
  topicId?: unknown
  language?: unknown
  [key: string]: unknown // imports may carry extra metadata (question no., marks …) — ignored
}

export interface PyqValidationResult {
  ok: boolean
  error?: string
}

/**
 * Normalize a string for content hashing: trim, collapse internal whitespace,
 * lowercase, and strip punctuation / smart quotes / symbols. Unicode-aware, so
 * letters and digits from any script (Tamil, Devanagari, Latin …) survive.
 * Punctuation-only differences between two imports therefore hash identically.
 */
export function normalizeForHash(s: string): string {
  return s
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation, smart quotes, symbols
    .replace(/\s+/g, ' ') // collapse all whitespace runs
    .toLowerCase()
    .trim()
}

/**
 * Content hash for duplicate detection: sha256 over a deterministic JSON
 * payload of the normalized question text, normalized options and the answer
 * key. Two imports of the same underlying question collide here even if the
 * source files differ in formatting or punctuation.
 */
export function computePyqHash(text: string, options: string[], correctIndex: number): string {
  const payload = JSON.stringify({
    text: normalizeForHash(text),
    options: options.map(normalizeForHash),
    correctIndex,
  })
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

/**
 * Validate one imported PYQ row. Rules:
 *   • text            — trimmed length 10..2000
 *   • options         — array of 2..6 non-empty strings, each <= 500 chars
 *   • correctIndex    — integer inside [0, options.length) via isValidAnswerIndex
 *   • explanation     — optional, trimmed length <= 4000 (empty string allowed)
 *   • difficulty      — optional, must be EASY | MEDIUM | HARD when present
 *   • year            — optional, integer 1990..2035 when present
 *   • sourceRef       — optional string (capped at 500 chars for row hygiene)
 *   • stageId / subjectId / topicId / language — optional strings
 *     (existence and exam-membership of the ids are checked by the import
 *     route against the database — this function stays pure)
 *
 * Never throws: unknown shapes produce { ok: false, error } so a malformed
 * row is recorded as an import failure instead of crashing the batch.
 */
export function validatePyqItem(item: PyqItemInput | unknown): PyqValidationResult {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return { ok: false, error: 'row is not a JSON object' }
  }
  const row = item as PyqItemInput

  // text — required
  if (typeof row.text !== 'string') return { ok: false, error: 'text must be a string' }
  const text = row.text.trim()
  if (text.length < 10) return { ok: false, error: 'text must be at least 10 characters' }
  if (text.length > 2000) return { ok: false, error: 'text must be at most 2000 characters' }

  // options — required, 2..6 non-empty strings, each <= 500 chars
  if (!Array.isArray(row.options)) return { ok: false, error: 'options must be an array of strings' }
  if (row.options.length < 2 || row.options.length > 6) {
    return { ok: false, error: `options must contain between 2 and 6 items (got ${row.options.length})` }
  }
  for (let i = 0; i < row.options.length; i++) {
    const opt = row.options[i]
    if (typeof opt !== 'string' || opt.trim().length === 0) {
      return { ok: false, error: `option ${i} must be a non-empty string` }
    }
    if (opt.trim().length > 500) {
      return { ok: false, error: `option ${i} must be at most 500 characters` }
    }
  }

  // correctIndex — one canonical range check, shared with test scoring
  if (!isValidAnswerIndex(row.correctIndex, row.options.length)) {
    return {
      ok: false,
      error: `correctIndex must be an integer between 0 and ${row.options.length - 1}`,
    }
  }

  // explanation — optional, max 4000 (an import without explanation is allowed;
  // quality is enforced later by the review workflow's written justification)
  if (row.explanation !== undefined && row.explanation !== null) {
    if (typeof row.explanation !== 'string') {
      return { ok: false, error: 'explanation must be a string' }
    }
    if (row.explanation.trim().length > 4000) {
      return { ok: false, error: 'explanation must be at most 4000 characters' }
    }
  }

  // difficulty — optional enum
  if (row.difficulty !== undefined && row.difficulty !== null) {
    if (typeof row.difficulty !== 'string' || !PYQ_DIFFICULTIES.includes(row.difficulty as PyqDifficulty)) {
      return { ok: false, error: 'difficulty must be one of EASY, MEDIUM or HARD' }
    }
  }

  // year — optional, sane exam-year window
  if (row.year !== undefined && row.year !== null) {
    if (typeof row.year !== 'number' || !Number.isInteger(row.year) || row.year < PYQ_YEAR_MIN || row.year > PYQ_YEAR_MAX) {
      return { ok: false, error: `year must be an integer between ${PYQ_YEAR_MIN} and ${PYQ_YEAR_MAX}` }
    }
  }

  // sourceRef — optional citation string, capped for row hygiene
  if (row.sourceRef !== undefined && row.sourceRef !== null) {
    if (typeof row.sourceRef !== 'string') {
      return { ok: false, error: 'sourceRef must be a string' }
    }
    if (row.sourceRef.trim().length > 500) {
      return { ok: false, error: 'sourceRef must be at most 500 characters' }
    }
  }

  // foreign-key & language fields — type checks only here
  for (const field of ['stageId', 'subjectId', 'topicId'] as const) {
    const v = row[field]
    if (v !== undefined && v !== null && (typeof v !== 'string' || v.trim().length === 0)) {
      return { ok: false, error: `${field} must be a non-empty string when provided` }
    }
  }
  if (row.language !== undefined && row.language !== null) {
    if (typeof row.language !== 'string' || row.language.trim().length === 0 || row.language.trim().length > 60) {
      return { ok: false, error: 'language must be a non-empty string of at most 60 characters when provided' }
    }
  }

  return { ok: true }
}

/**
 * Slug builder for PYQ canonical slugs. Primary form uses the catalogue exam
 * slug; the fallback slugifies the exam label (or paper title) for defensive
 * completeness. Used as: `pyq:${examSlug ?? slugify(examLabel ?? paperTitle)}:${year ?? 'na'}:${rowIndex}`
 */
export function slugifyLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'paper'
}
