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
 */
export interface StudioActivityResponses {
  selfRecall?: Record<string, 'recalled' | 'missed'>
  answers?: (number | null)[]
}

/** Server-computed completion summaries — never a client score, never mastery. */
export type StudioActivityResult =
  | { type: 'mini-test'; correct: number; answered: number; total: number; percent: number }
  | { type: 'flashcards'; cardsTotal: number; cardsReviewed: number; recalled: number; missed: number }
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
}
