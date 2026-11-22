// ─── Riishe Phase 3E: Interactive Learning Studio — shared types & helpers ───
// Client-safe by design (same contract as tutor.ts): no provider, no DB, no
// server-only import. The UI and the API client share the exact activity
// shapes and labels the server validates against.
//
// Reliability contract (Phase 3E Part 4): every activity payload the model
// produces passes through server-side programmatic validation in
// src/lib/riishe/studio.ts BEFORE it reaches this module's consumers. The UI
// renders validated plain text only — never model-generated HTML or executable
// content (React text-node escaping; no dangerouslySetInnerHTML anywhere).
//
// Honesty contract (Phase 3E Part 5, carried into Phase 3F): an opened
// flashcard or a generated activity NEVER changes mastery/revision/attempt
// records — studio results are self-study aids, and every activity carries
// that framing. Phase 3F adds persistence for CONTINUITY only: activities and
// their learner interactions are saved so the student can resume and review
// them, but that evidence stays in the studio record and never feeds the exam
// mastery systems (see docs/PHASE-3F-RIISHE-LEARNING-CONTINUITY.md).

import type { RiisheResponseLanguage } from '@/lib/riishe/tutor'

// ─── Activity kinds ───────────────────────────────────────────────────────────

export const STUDIO_ACTIVITY_KINDS = ['concept-map', 'steps', 'formula', 'flashcards', 'mini-test'] as const

export type StudioActivityKind = (typeof STUDIO_ACTIVITY_KINDS)[number]

/** UI labels + one-line descriptions for the activity picker (English chrome). */
export const STUDIO_ACTIVITY_LABELS: Record<StudioActivityKind, string> = {
  'concept-map': 'Concept map',
  steps: 'Step-by-step',
  formula: 'Formula walkthrough',
  flashcards: 'Flashcards',
  'mini-test': 'Mini-test',
}

export const STUDIO_ACTIVITY_HINTS: Record<StudioActivityKind, string> = {
  'concept-map': 'See how the ideas of a topic connect',
  steps: 'Study a concept one focused step at a time',
  formula: 'Walk through a formula, symbol by symbol',
  flashcards: 'Revise definitions, facts and formulas',
  'mini-test': 'Check your understanding with a short quiz',
}

// ─── Concept map ──────────────────────────────────────────────────────────────

/** One concept node. `parent === null` marks the single central concept. */
export interface StudioConceptNodeDTO {
  /** Short slug id, unique within the map (validated server-side). */
  id: string
  label: string
  /** Parent node id, or null for the single root. */
  parent: string | null
  /** Plain-language explanation shown when the node is selected. */
  explanation: string
}

export interface StudioConceptMapDTO {
  kind: 'concept-map'
  title: string
  nodes: StudioConceptNodeDTO[]
}

// ─── Step-by-step explanation ─────────────────────────────────────────────────

export interface StudioStepDTO {
  title: string
  body: string
  /** Optional worked example tied to this step (plain text). */
  example?: string
}

export interface StudioStepsDTO {
  kind: 'steps'
  title: string
  steps: StudioStepDTO[]
}

// ─── Formula walkthrough ──────────────────────────────────────────────────────

export type StudioFormulaStage = 'substitute' | 'calculate'

export interface StudioFormulaStepDTO {
  stage: StudioFormulaStage
  description: string
  /**
   * Calculate-stage only: a plain arithmetic expression the server evaluated
   * deterministically (numbers, + - * / % ^, parentheses, `pi`). Absent when
   * the step is purely explanatory.
   */
  expression?: string
  /** The model's claimed numeric result for `expression`, as text. */
  claimedResult?: string
  /** Server-computed deterministic check — added by validation, never by the model. */
  verification?: StudioFormulaVerificationDTO
}

export interface StudioFormulaVerificationDTO {
  /** The server's own computed value, formatted for display. Empty when the expression could not be evaluated. */
  computed: string
  matches: boolean
  note?: string
}

export interface StudioFormulaVariableDTO {
  symbol: string
  meaning: string
}

export interface StudioFormulaResultDTO {
  value: string
  units?: string
  /**
   * true only when every numeric calculate step was evaluated server-side and
   * matched the model's claimed result. Never fabricated.
   */
  verified: boolean
  /**
   * true when the walkthrough is illustrative rather than a verified
   * computation (no numeric substitution, unverified arithmetic, or
   * incomplete inputs). `illustrative: false` requires `verified: true`.
   */
  illustrative: boolean
  note?: string
}

export interface StudioFormulaDTO {
  kind: 'formula'
  title: string
  formula: string
  variables: StudioFormulaVariableDTO[]
  steps: StudioFormulaStepDTO[]
  result?: StudioFormulaResultDTO
  /** Honest limitation note (e.g. material does not provide concrete inputs). */
  caveat?: string
}

// ─── Flashcards ───────────────────────────────────────────────────────────────

export type StudioFlashcardKind = 'definition' | 'fact' | 'formula' | 'qa'

export interface StudioFlashcardDTO {
  front: string
  back: string
  kindTag?: StudioFlashcardKind
}

export interface StudioFlashcardsDTO {
  kind: 'flashcards'
  title: string
  cards: StudioFlashcardDTO[]
}

export const STUDIO_FLASHCARD_KIND_LABELS: Record<StudioFlashcardKind, string> = {
  definition: 'Definition',
  fact: 'Fact',
  formula: 'Formula',
  qa: 'Question',
}

// ─── Phase 3G: graded recall (type-the-answer flashcards) ─────────────────────
//
// Phase 3F left flashcard recall self-reported (documented limitation §11.4:
// "a future graded-recall mode (type-the-answer checking) could strengthen
// it"). Phase 3G adds an OPTIONAL graded-recall step: before revealing the
// answer, the learner can type what they recall, and a deterministic,
// documented text-similarity heuristic grades the attempt against the card's
// answer.
//
// Honesty contract (extends the Phase 3E/3F one):
//   - The verdict is APPROXIMATE TEXT MATCHING, never semantic understanding.
//     A correct idea phrased differently can be marked wrong — the card's real
//     answer is always shown after the check, and the note below says so.
//   - The verdict is evidence INSIDE the studio record only. It never feeds
//     TopicMastery, attempts, revision or any exam mastery surface (the same
//     zero-contribution rule as Phase 3F).
//   - The stored completion result is recomputed SERVER-SIDE from the stored
//     snapshot + stored typed answers (identical helper). Client verdicts are
//     display-only and never trusted for the stored result.
//   - Self-marked recall (Phase 3F) stays available and is never overwritten
//     by typing; the two evidence kinds are labelled and reported separately.

export type StudioRecallVerdict = 'correct' | 'partial' | 'incorrect'

/**
 * Deterministic token-similarity thresholds for graded recall. Documented
 * heuristics — deliberately simple and explainable, not a semantic grader.
 */
export const GRADE_CORRECT_THRESHOLD = 0.75
export const GRADE_PARTIAL_THRESHOLD = 0.4
/** Typed input with more than 3x the expected token count caps at partial. */
export const GRADE_SPAM_TOKEN_RATIO = 3

/** Fixed honest framing for graded recall (English chrome, deterministic). */
export const STUDIO_GRADED_RECALL_NOTE =
  'Typed answers are checked by approximate text matching — a correct idea phrased differently can be marked wrong. The card\'s answer is always shown, and this evidence stays in the studio record without changing mastery.'

/**
 * Normalize text for comparison: NFKC (superscripts → digits), lowercase,
 * strip diacritics, punctuation → space, collapse whitespace. Exported for
 * tests; the UI and server share the identical code path via gradeTypedRecall.
 */
export function normalizeRecallText(raw: string): string {
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/[’'`\u2018\u201C\u201D]/g, '') // apostrophes/quotes stay IN the word (newton's → newtons)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // remaining punctuation and symbols → space
    .replace(/\s+/g, ' ')
    .trim()
}

function recallTokens(normalized: string): string[] {
  return normalized.length > 0 ? normalized.split(' ').filter(Boolean) : []
}

/** Token-set overlap (Jaccard): |A∩B| / |A∪B|. Empty side → 0. */
function recallTokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let shared = 0
  for (const t of setB) if (setA.has(t)) shared++
  return shared / (setA.size + setB.size - shared)
}

/**
 * Operator characters are significant for formula-style answers — but two
 * notation-only families are lenient: multiplication dots (·, ×, * — because
 * juxtaposition "ma" equals explicit multiplication "m · a" in plain typing)
 * and the ASCII caret superscript notation ("mc^2" ≡ "mc²"). Division,
 * addition, subtraction and equality are compared exactly: "m/a" vs "m·a"
 * is a different formula and must not grade correct.
 */
function significantOps(raw: string): string {
  const ops = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[·×∗∙⋅]/g, '*')
    .replace(/÷/g, '/')
    .match(/[+=*/^%<>\u2212-]/g)
  // Lenient notation families: multiplication dots (juxtaposition "ma" equals
  // "m · a") and ASCII caret superscripts ("mc^2" ≡ "mc²").
  return (ops ?? []).filter(op => op !== '*' && op !== '^').join('')
}

/**
 * Grade one typed recall attempt against the card's expected answer.
 * Deterministic and pure — the UI uses it for immediate feedback and the
 * server re-runs the identical function when computing the stored result.
 *
 * An empty (or whitespace-only) attempt returns `null`: an attempt that was
 * never made is not evidence and must not be graded.
 */
export function gradeTypedRecall(expected: string, typed: string): StudioRecallVerdict | null {
  const exp = normalizeRecallText(expected)
  const got = normalizeRecallText(typed)
  if (got.length === 0) return null
  if (exp.length === 0) return 'incorrect'
  if (got === exp) {
    // Identical after normalization — but operators were stripped by
    // normalization, so for formula-like answers they are still compared
    // (m/a vs m·a must not grade correct). Notation-lenient families (dots,
    // carets) are ignored by significantOps.
    return significantOps(expected) === significantOps(typed) ? 'correct' : 'partial'
  }

  const expTokens = recallTokens(exp)
  const gotTokens = recallTokens(got)
  const expCompact = exp.replace(/\s+/g, '')
  const gotCompact = got.replace(/\s+/g, '')

  let similarity: number
  if (expCompact === gotCompact) {
    // Same letters and numbers in the same order. Operators are significant
    // (m/a ≠ m·a) except the lenient notation families above; a same-letters
    // different-significant-operators attempt caps at partial.
    similarity = significantOps(expected) === significantOps(typed) ? 1 : GRADE_PARTIAL_THRESHOLD
  } else if (expTokens.length === 1 || gotTokens.length === 1) {
    // Single-token answers (formulas, terms): a typed substring counts as
    // partial only when it is long enough (≥4 chars) that a one-letter slip or
    // a common word cannot inflate the verdict.
    if (gotCompact === expCompact) similarity = 1
    else if (gotCompact.length >= 4 && expCompact.includes(gotCompact)) similarity = GRADE_PARTIAL_THRESHOLD
    else similarity = recallTokenOverlap(expTokens, gotTokens)
  } else {
    similarity = recallTokenOverlap(expTokens, gotTokens)
  }

  let verdict: StudioRecallVerdict
  if (similarity >= GRADE_CORRECT_THRESHOLD) verdict = 'correct'
  else if (similarity >= GRADE_PARTIAL_THRESHOLD) verdict = 'partial'
  else verdict = 'incorrect'
  // Spam guard: input far longer than the answer cannot count as fully correct.
  if (verdict === 'correct' && gotTokens.length > expTokens.length * GRADE_SPAM_TOKEN_RATIO) {
    verdict = 'partial'
  }
  return verdict
}

/** Server-computed graded-recall counts — present only when ≥1 card was typed. */
export interface StudioGradedRecallSummary {
  attempted: number
  correct: number
  partial: number
  incorrect: number
}

// ─── Mini-test ────────────────────────────────────────────────────────────────

export type StudioQuizDifficulty = 'foundation' | 'application' | 'advanced'

export interface StudioQuizQuestionDTO {
  prompt: string
  /** 3–5 distinct plain-text options; `correctIndex` points into this array. */
  options: string[]
  correctIndex: number
  /** Accessible explanation of why the marked answer is correct or wrong. */
  explanation: string
  difficulty?: StudioQuizDifficulty
  /** Verified page reference into the grounded document — present only when the page exists in the fed material. */
  pageRef?: number
}

export interface StudioMiniTestDTO {
  kind: 'mini-test'
  title: string
  questions: StudioQuizQuestionDTO[]
  /** Fixed honest framing — set server-side, shown on the summary. */
  honestyNote: string
}

/** Fixed honest framing for the mini-test (English chrome, deterministic). */
export const STUDIO_MINITEST_HONESTY_NOTE =
  'This is a short self-check on the topic you chose. Completing it does not create attempt records or change your mastery — real practice tests are what update those.'

// ─── Envelope ─────────────────────────────────────────────────────────────────

export type StudioActivity =
  | StudioConceptMapDTO
  | StudioStepsDTO
  | StudioFormulaDTO
  | StudioFlashcardsDTO
  | StudioMiniTestDTO

export interface StudioGenerateResponseDTO {
  activity: StudioActivity
  /** 'document' = grounded in the student's material; 'general' = not verified against it. */
  grounding: 'document' | 'general'
  docTitle?: string
  responseLanguage: RiisheResponseLanguage
  topic: string
  /**
   * Phase 3F: the persisted activity record id (resume/history key). Present on
   * every successful generation — the activity is saved IN_PROGRESS server-side.
   */
  activityId?: string
}

// ─── Pure helpers (shared by UI + tests) ──────────────────────────────────────

/** Children lookup for a validated concept map (parent → child ids). */
export function conceptChildrenMap(nodes: StudioConceptNodeDTO[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    const list = map.get(n.parent) ?? []
    list.push(n.id)
    map.set(n.parent, list)
  }
  return map
}

/** Depth of a node within a validated tree (root = 0). */
export function conceptDepthOf(nodes: StudioConceptNodeDTO[], id: string): number {
  const byId = new Map(nodes.map(n => [n.id, n]))
  let cur = byId.get(id)
  let depth = 0
  while (cur && cur.parent) {
    depth++
    cur = byId.get(cur.parent)
    if (depth > 64) return depth // defensive; validated maps are trees
  }
  return depth
}

/** Related concepts for the selected node: its parent first, then children. */
export function conceptRelatedIds(nodes: StudioConceptNodeDTO[], id: string): string[] {
  const node = nodes.find(n => n.id === id)
  if (!node) return []
  const related: string[] = []
  if (node.parent) related.push(node.parent)
  for (const n of nodes) if (n.parent === id) related.push(n.id)
  return related
}

export interface StudioQuizScore {
  correct: number
  answered: number
  total: number
  percent: number
}

/** Deterministic client-side scoring of a submitted mini-test. */
export function scoreMiniTest(
  questions: Pick<StudioQuizQuestionDTO, 'correctIndex'>[],
  answers: (number | null)[],
): StudioQuizScore {
  let correct = 0
  let answered = 0
  for (let i = 0; i < questions.length; i++) {
    const a = answers[i]
    if (a == null) continue
    answered++
    if (a === questions[i].correctIndex) correct++
  }
  const total = questions.length
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100)
  return { correct, answered, total, percent }
}

/** Difficulty ordering for mini-test questions (foundation first). */
const DIFFICULTY_RANK: Record<StudioQuizDifficulty, number> = {
  foundation: 0,
  application: 1,
  advanced: 2,
}

export function quizDifficultyRank(d?: StudioQuizDifficulty): number {
  return d ? DIFFICULTY_RANK[d] : 1
}

/**
 * Deterministic Fisher–Yates shuffle (mulberry32 PRNG). Seeded so shuffles are
 * reproducible in tests and stable for a given seed.
 */
export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const out = [...items]
  let s = seed >>> 0
  const rand = () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ─── Phase 3F: continuity DTOs (persistence, resume, history, evidence) ──────
// Client-safe shared contract for the Studio persistence surfaces. The SERVER
// validates every stored field with zod in src/lib/riishe/studio-store.ts;
// these interfaces are the render/transport shapes. Lifecycle transitions are
// never client-supplied — the client only sends progress, responses and
// explicit complete/abandon intents, and the server enforces the transition
// rules and idempotency.

/** Version of the validated activity snapshot schema stored in activityJson. */
export const STUDIO_SCHEMA_VERSION = 1

export const STUDIO_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABANDONED'] as const
export type StudioActivityStatus = (typeof STUDIO_STATUSES)[number]

/** English chrome labels. "Completed" never implies mastery. */
export const STUDIO_STATUS_LABELS: Record<StudioActivityStatus, string> = {
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  ABANDONED: 'Discarded',
}

/**
 * UI progress state per kind (restored on resume; saved while in progress).
 * Kept as one flat interface with optional per-kind fields — the server
 * validates the exact per-kind shape before storing.
 */
export interface StudioActivityProgress {
  /** concept-map: selected node + expanded set. */
  selectedNodeId?: string
  expandedIds?: string[]
  /** steps: current step and the furthest step reached. */
  stepIndex?: number
  maxStepReached?: number
  /** flashcards: display order (card indexes), position, reveal state, reviewed set. */
  order?: number[]
  index?: number
  revealed?: boolean
  reviewed?: number[]
  /** mini-test: current question, chosen/submitted answers, finished flag. */
  answers?: (number | null)[]
  submitted?: boolean[]
  finished?: boolean
}

/**
 * Learner interaction evidence, stored separately from generated content.
 * - flashcards: self-marked recall per card index — recorded only after the
 *   answer was revealed. A reveal without a self-mark stays review, never
 *   evidence. `recalled` / `missed` are the student's own assessment.
 * - mini-test: the submitted answers; the score is recomputed server-side.
 * - flashcards (Phase 3G): `typedRecall` — what the learner TYPED before
 *   revealing, per card index. Objective recall evidence: the verdict is
 *   recomputed server-side from the stored snapshot via gradeTypedRecall.
 *   Optional per card; empty input is never stored as an attempt.
 */
export interface StudioActivityResponses {
  selfRecall?: Record<string, 'recalled' | 'missed'>
  answers?: (number | null)[]
  typedRecall?: Record<string, string>
}

/** Server-computed completion summaries — never a client score, never mastery. */
export type StudioActivityResult =
  | { type: 'mini-test'; correct: number; answered: number; total: number; percent: number }
  | {
      type: 'flashcards'
      cardsTotal: number
      cardsReviewed: number
      recalled: number
      missed: number
      /** Phase 3G: server-recomputed graded-recall counts; present only when ≥1 card was typed. */
      graded?: StudioGradedRecallSummary
    }
  | { type: 'steps'; stepsStudied: number; stepsTotal: number }
  | { type: 'formula'; verified: boolean; illustrative: boolean }
  | { type: 'concept-map'; conceptsTotal: number }

/** Compact history row (no activity snapshot — fetch the record to resume). */
export interface StudioHistoryItemDTO {
  id: string
  kind: StudioActivityKind
  topic: string
  status: StudioActivityStatus
  grounding: 'document' | 'general'
  documentTitle?: string
  responseLanguage?: RiisheResponseLanguage
  createdAt: string
  updatedAt: string
  completedAt?: string
  result: StudioActivityResult | null
}

/** Full record — the resume payload (validated snapshot + progress + evidence). */
export interface StudioActivityRecordDTO extends StudioHistoryItemDTO {
  documentId?: string
  activity: StudioActivity
  progress: StudioActivityProgress | null
  responses: StudioActivityResponses | null
}

/** Compact, honest self-study evidence roll-up for the Studio panel. */
export interface StudioEvidenceSummaryDTO {
  total: number
  inProgress: number
  completed: number
  abandoned: number
  miniTestsCompleted: number
  miniTestPercentAvg: number | null
  cardsReviewed: number
  cardsRecalled: number
  /**
   * Phase 3H: true when the per-kind evidence aggregates were computed from a
   * bounded server-side scan (more matching records exist than were scanned).
   * Status counts and the total are ALWAYS exact (SQL counts) — only the
   * mini-test/flashcard aggregates can be bounded, and the UI says so.
   */
  truncated?: boolean
}

// ─── Phase 3H: history discovery, retention, cleanup ──────────────────────────

/** Default page size for the history list (same bound as the Phase 3F list). */
export const STUDIO_HISTORY_PAGE_SIZE_DEFAULT = 50
/** Hard server-side cap on the requested page size. */
export const STUDIO_HISTORY_PAGE_SIZE_MAX = 100

/**
 * Named retention choices (days). `null` / absent = keep history forever
 * (the default for every existing user — nothing is deleted automatically).
 * The preference never deletes anything by itself: it only feeds the explicit
 * user-initiated cleanup workflow (preview → confirm).
 */
export const STUDIO_RETENTION_DAYS = [30, 90, 180, 365] as const
export type StudioRetentionDays = (typeof STUDIO_RETENTION_DAYS)[number]

/** Opaque pagination cursor: base64url JSON `{ u: updatedAtISO, i: id }`. */
export interface StudioHistoryCursor {
  u: string
  i: string
}

/**
 * One page of the Studio history list (Phase 3H). `items` is a single page
 * (most recently updated first, deterministic `(updatedAt desc, id desc)`
 * ordering); `totalMatching` is the EXACT count of the owner's records that
 * match the current filters; `nextCursor` is null on the last page.
 */
export interface StudioHistoryPageDTO {
  items: StudioHistoryItemDTO[]
  evidence: StudioEvidenceSummaryDTO
  nextCursor: string | null
  totalMatching: number
}

/** Preview payload for the user-initiated cleanup (no deletion happened). */
export interface StudioCleanupPreviewDTO {
  preview: true
  olderThanDays: number
  /** ISO cutoff actually used — activities not updated since this moment. */
  cutoff: string
  /** Exact number of records the confirmed cleanup would delete. */
  affected: number
  /** Fixed honesty note about the scope (in-progress is never cleaned). */
  scopeNote: string
}

/** Confirmed cleanup result — truthful counts, including partial batches. */
export interface StudioCleanupResultDTO {
  ok: true
  deleted: number
  /** Records still matching the scope after this batch (repeat is safe). */
  remaining: number
  olderThanDays: number
  cutoff: string
}

export type StudioCleanupResponseDTO = StudioCleanupPreviewDTO | StudioCleanupResultDTO
