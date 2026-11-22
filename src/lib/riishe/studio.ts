// ─── Riishe Phase 3E: Interactive Learning Studio — server generation ────────
// Generates structured learning activities (concept maps, step-by-step
// explanations, formula walkthroughs, flashcards, mini-tests) through the SAME
// provider abstraction as every other Riishe feature (src/lib/riishe/ai.ts).
//
// Reliability contract:
//   1. Model output is never trusted: every payload passes a strict
//      programmatic validator (shape, bounds, ids, tree integrity, ranges).
//      One semantic repair retry is attempted with the exact validation
//      errors; a second failure is an honest 502 — never a fabricated activity.
//   2. Formula arithmetic is verified DETERMINISTICALLY: calculate steps carry
//      a plain arithmetic expression the server evaluates itself (recursive-
//      descent parser — never eval/Function). A walkthrough is only marked
//      `verified` when every numeric step and the final result match; otherwise
//      it is explicitly `illustrative`. Incomplete inputs can never produce a
//      verified claim.
//   3. Page references are only kept when the cited page was actually in the
//      fed material (same philosophy as chat citation verification); anything
//      else is stripped, never shown.
//   4. Rendering contract: activities are plain-text data. The UI renders them
//      through React text nodes (auto-escaped) — no HTML, no markdown, no
//      executable content is ever produced here.
//
// Provider seam: `chatJson` is injectable (StudioDeps) so tests can drive the
// full pipeline without contacting any provider.

import {
  STUDIO_MINITEST_HONESTY_NOTE,
  type StudioActivity,
  type StudioActivityKind,
  type StudioConceptMapDTO,
  type StudioConceptNodeDTO,
  type StudioFlashcardDTO,
  type StudioFlashcardKind,
  type StudioFlashcardsDTO,
  type StudioFormulaDTO,
  type StudioFormulaResultDTO,
  type StudioFormulaStage,
  type StudioFormulaStepDTO,
  type StudioFormulaVariableDTO,
  type StudioMiniTestDTO,
  type StudioQuizDifficulty,
  type StudioQuizQuestionDTO,
  type StudioStepsDTO,
  type StudioStepDTO,
  quizDifficultyRank,
} from '@/lib/riishe/studio-types'
import { responseLanguagePrompt, type RiisheResponseLanguage } from '@/lib/riishe/tutor'
import { chatJson, fenceDocumentText } from '@/lib/riishe/ai'

// ─── Honest failure types ─────────────────────────────────────────────────────

/** Model output failed programmatic validation (after the repair retry). */
export class StudioValidationError extends Error {
  constructor(public errors: string[]) {
    super(`studio payload rejected: ${errors.slice(0, 4).join('; ')}`)
    this.name = 'StudioValidationError'
  }
}

/** Generation could not produce a reliable activity — surfaced honestly as 502. */
export class StudioGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StudioGenerationError'
  }
}

// ─── Deterministic arithmetic evaluation (calculate-step verification) ────────

type Token = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' }

function tokenizeArithmetic(input: string): Token[] {
  const src = input
    .replace(/×/g, '*')
    .replace(/·/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/,/g, '')
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const start = i
      while (i < src.length && /[0-9.]/.test(src[i])) i++
      const raw = src.slice(start, i)
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(raw)) throw new Error(`bad number "${raw}"`)
      tokens.push({ t: 'num', v: parseFloat(raw) })
      continue
    }
    if (/[a-zA-Zπ]/.test(ch)) {
      const start = i
      while (i < src.length && /[a-zA-Zπ]/.test(src[i])) i++
      const word = src.slice(start, i)
      if (word.toLowerCase() === 'pi' || word === 'π') {
        tokens.push({ t: 'num', v: Math.PI })
        continue
      }
      throw new Error(`unknown identifier "${word}"`)
    }
    if ('+-*/%^'.includes(ch)) {
      tokens.push({ t: 'op', v: ch })
      i++
      continue
    }
    if (ch === '(' || ch === '[') {
      tokens.push({ t: 'lp' })
      i++
      continue
    }
    if (ch === ')' || ch === ']') {
      tokens.push({ t: 'rp' })
      i++
      continue
    }
    throw new Error(`unexpected character "${ch}"`)
  }
  return tokens
}

/**
 * Evaluate a plain arithmetic expression safely (no eval/Function).
 * Supports + - * / % ^ (also ** and × ÷ −), parentheses, decimals, unary
 * minus and the constant `pi`. Throws on anything else — division by zero,
 * unknown identifiers, trailing operators, malformed numbers.
 */
export function evaluateArithmetic(expression: string): number {
  const tokens = tokenizeArithmetic(expression)
  if (tokens.length === 0) throw new Error('empty expression')
  let pos = 0

  const peek = () => tokens[pos]

  function parseExpression(): number {
    // additive: term (('+'|'-') term)*
    let value = parseTerm()
    while (peek()?.t === 'op' && ((peek() as { t: 'op'; v: string }).v === '+' || (peek() as { t: 'op'; v: string }).v === '-')) {
      const op = (tokens[pos++] as { t: 'op'; v: string }).v
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  function parseTerm(): number {
    // multiplicative: factor (('*'|'/'|'%') factor)*
    let value = parsePower()
    while (peek()?.t === 'op' && ['*', '/', '%'].includes((peek() as { t: 'op'; v: string }).v)) {
      const op = (tokens[pos++] as { t: 'op'; v: string }).v
      const rhs = parsePower()
      if ((op === '/' || op === '%') && rhs === 0) throw new Error('division by zero')
      value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs
    }
    return value
  }

  function parsePower(): number {
    // right-associative exponentiation: unary ('^' unary)*
    const base = parseUnary()
    if (peek()?.t === 'op' && (peek() as { t: 'op'; v: string }).v === '^') {
      pos++
      const exponent = parsePower()
      const result = Math.pow(base, exponent)
      if (!Number.isFinite(result)) throw new Error('result is not finite')
      return result
    }
    return base
  }

  function parseUnary(): number {
    if (peek()?.t === 'op' && ((peek() as { t: 'op'; v: string }).v === '-' || (peek() as { t: 'op'; v: string }).v === '+')) {
      const op = (tokens[pos++] as { t: 'op'; v: string }).v
      const value = parseUnary()
      return op === '-' ? -value : value
    }
    return parsePrimary()
  }

  function parsePrimary(): number {
    const tok = peek()
    if (!tok) throw new Error('unexpected end of expression')
    if (tok.t === 'num') {
      pos++
      return tok.v
    }
    if (tok.t === 'lp') {
      pos++
      const value = parseExpression()
      if (peek()?.t !== 'rp') throw new Error('missing closing parenthesis')
      pos++
      return value
    }
    throw new Error('unexpected token')
  }

  const result = parseExpression()
  if (pos !== tokens.length) throw new Error('unexpected trailing tokens')
  if (!Number.isFinite(result)) throw new Error('result is not finite')
  return result
}

/** Format a computed number for display (≤6 decimals, trailing zeros trimmed). */
export function formatComputedNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  const rounded = Math.abs(n) < 1e-12 ? 0 : n
  const text = rounded.toFixed(6).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}

/** Parse the model's claimed numeric result ("≈ 12.56 cm²" → 12.56). */
export function parseClaimedNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').replace(/[≈~]\s*/, '').trim()
  const m = cleaned.match(/-?(?:\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)
  if (!m) return null
  const value = parseFloat(m[0])
  return Number.isFinite(value) ? value : null
}

/**
 * Precision-aware claim verification: the model's claim is checked at the
 * precision it actually states (models legitimately round — "≈ 12.57" is a
 * correct claim for pi·2²), while wrong arithmetic at ANY precision fails.
 */
function claimMatches(claimed: string, computed: number): boolean {
  const cleaned = claimed.replace(/,/g, '').replace(/[≈~]\s*/, '').trim()
  const m = cleaned.match(/-?(?:\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)
  if (!m) return false
  const value = parseFloat(m[0])
  if (!Number.isFinite(value)) return false
  const dot = m[0].indexOf('.')
  const decimals = dot === -1 ? 0 : Math.min(m[0].length - dot - 1, 6)
  const scale = Math.pow(10, decimals)
  const rounded = Math.round(computed * scale) / scale
  return Math.abs(rounded - value) <= 1e-9 * Math.max(1, Math.abs(value))
}

// ─── String normalisation (cosmetic safety — never structural) ────────────────

/** Trim, strip control characters and collapse long whitespace in model text. */
function cleanText(raw: unknown, maxLen: number): string {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() : text
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

// ─── Per-kind validators (normalise + reject; never fabricate) ────────────────

export function normalizeConceptMap(raw: unknown): StudioConceptMapDTO {
  if (typeof raw !== 'object' || raw === null) throw new StudioValidationError(['payload is not an object'])
  const obj = raw as Record<string, unknown>
  const errors: string[] = []

  const nodesRaw = obj.nodes
  if (!Array.isArray(nodesRaw) || nodesRaw.length < 3 || nodesRaw.length > 40) {
    throw new StudioValidationError(['concept map needs 3–40 nodes'])
  }

  const seenIds = new Set<string>()
  const nodes: StudioConceptNodeDTO[] = []
  let rootCount = 0
  for (const item of nodesRaw) {
    if (typeof item !== 'object' || item === null) {
      errors.push('node is not an object')
      continue
    }
    const n = item as Record<string, unknown>
    const id = cleanText(n.id, 32)
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id)) {
      errors.push(`invalid node id "${String(n.id).slice(0, 40)}"`)
      continue
    }
    if (seenIds.has(id)) {
      errors.push(`duplicate node id "${id}"`)
      continue
    }
    const label = cleanText(n.label, 120)
    const explanation = cleanText(n.explanation, 1200)
    if (!label) {
      errors.push(`node "${id}" has an empty label`)
      continue
    }
    if (!explanation) {
      errors.push(`node "${id}" has an empty explanation`)
      continue
    }
    let parent: string | null = null
    if (n.parent != null) {
      parent = cleanText(n.parent, 32) || null
      if (parent && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(parent)) {
        errors.push(`node "${id}" has an invalid parent reference`)
        continue
      }
    }
    if (parent === null) rootCount++
    seenIds.add(id)
    nodes.push({ id, label, parent, explanation })
  }
  if (errors.length > 0) throw new StudioValidationError(errors)
  if (rootCount !== 1) throw new StudioValidationError([`concept map must have exactly one central concept (found ${rootCount})`])

  // Parent references must exist; the graph must be a tree rooted at it.
  const byId = new Map(nodes.map(n => [n.id, n]))
  for (const node of nodes) {
    if (node.parent && !byId.has(node.parent)) {
      throw new StudioValidationError([`node "${node.id}" references unknown parent "${node.parent}"`])
    }
  }
  const depthOf = (id: string): number => {
    let cur = byId.get(id)
    let depth = 0
    const seen = new Set<string>()
    while (cur && cur.parent) {
      if (seen.has(cur.id)) throw new StudioValidationError([`concept map contains a cycle at "${cur.id}"`])
      seen.add(cur.id)
      depth++
      cur = byId.get(cur.parent)
      if (depth > 40) throw new StudioValidationError(['concept map is too deep (cycle suspected)'])
    }
    return depth
  }
  let maxDepth = 0
  for (const node of nodes) maxDepth = Math.max(maxDepth, depthOf(node.id))
  if (maxDepth > 5) throw new StudioValidationError([`concept map is deeper than 5 levels (${maxDepth})`])

  // Deterministic order: BFS from the root so parents always render first.
  const root = nodes.find(n => n.parent === null) as StudioConceptNodeDTO
  const childrenOf = new Map<string, string[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    const list = childrenOf.get(n.parent) ?? []
    list.push(n.id)
    childrenOf.set(n.parent, list)
  }
  const ordered: StudioConceptNodeDTO[] = []
  const queue: string[] = [root.id]
  while (queue.length > 0) {
    const id = queue.shift() as string
    const node = byId.get(id) as StudioConceptNodeDTO
    ordered.push(node)
    for (const child of childrenOf.get(id) ?? []) queue.push(child)
  }

  return { kind: 'concept-map', title: cleanText(obj.title, 120) || 'Concept map', nodes: ordered }
}

export function normalizeSteps(raw: unknown): StudioStepsDTO {
  if (typeof raw !== 'object' || raw === null) throw new StudioValidationError(['payload is not an object'])
  const obj = raw as Record<string, unknown>
  const errors: string[] = []
  const stepsRaw = obj.steps
  if (!Array.isArray(stepsRaw) || stepsRaw.length < 3 || stepsRaw.length > 12) {
    throw new StudioValidationError(['step-by-step explanation needs 3–12 steps'])
  }
  const steps: StudioStepDTO[] = []
  for (const item of stepsRaw) {
    if (typeof item !== 'object' || item === null) {
      errors.push('step is not an object')
      continue
    }
    const s = item as Record<string, unknown>
    const title = cleanText(s.title, 160)
    const body = cleanText(s.body, 1500)
    if (!title) errors.push('a step has an empty title')
    if (!body) errors.push(`step "${title || '?'}" has an empty body`)
    if (!title || !body) continue
    const example = isNonEmptyString(s.example) ? cleanText(s.example, 800) : undefined
    steps.push({ title, body, ...(example ? { example } : {}) })
  }
  if (errors.length > 0) throw new StudioValidationError(errors)
  return { kind: 'steps', title: cleanText(obj.title, 160) || 'Step-by-step explanation', steps }
}

export function normalizeFormula(raw: unknown): StudioFormulaDTO {
  if (typeof raw !== 'object' || raw === null) throw new StudioValidationError(['payload is not an object'])
  const obj = raw as Record<string, unknown>
  const errors: string[] = []

  const formula = cleanText(obj.formula, 300)
  if (!formula) errors.push('formula is empty')

  const varsRaw = obj.variables
  if (!Array.isArray(varsRaw) || varsRaw.length < 1 || varsRaw.length > 8) {
    errors.push('formula needs 1–8 variables')
  }
  const variables: StudioFormulaVariableDTO[] = []
  if (Array.isArray(varsRaw)) {
    for (const item of varsRaw) {
      if (typeof item !== 'object' || item === null) {
        errors.push('variable is not an object')
        continue
      }
      const v = item as Record<string, unknown>
      const symbol = cleanText(v.symbol, 24)
      const meaning = cleanText(v.meaning, 200)
      if (!symbol || !meaning) {
        errors.push('a variable is missing its symbol or meaning')
        continue
      }
      variables.push({ symbol, meaning })
    }
  }

  const stepsRaw = obj.steps
  if (!Array.isArray(stepsRaw) || stepsRaw.length < 1 || stepsRaw.length > 12) {
    errors.push('formula walkthrough needs 1–12 steps')
  }
  const steps: StudioFormulaStepDTO[] = []
  let sawCalculate = false
  if (Array.isArray(stepsRaw)) {
    for (const item of stepsRaw) {
      if (typeof item !== 'object' || item === null) {
        errors.push('formula step is not an object')
        continue
      }
      const s = item as Record<string, unknown>
      const stage = s.stage === 'substitute' ? 'substitute' : s.stage === 'calculate' ? 'calculate' : null
      if (!stage) {
        errors.push(`formula step stage must be "substitute" or "calculate" (got "${String(s.stage).slice(0, 24)}")`)
        continue
      }
      if (stage === 'calculate') sawCalculate = true
      else if (sawCalculate) errors.push('substitute steps must come before calculate steps')
      const description = cleanText(s.description, 400)
      if (!description) {
        errors.push('a formula step has an empty description')
        continue
      }
      const expression = isNonEmptyString(s.expression) ? cleanText(s.expression, 200) : undefined
      const claimedResult = isNonEmptyString(s.claimedResult) ? cleanText(s.claimedResult, 120) : undefined
      steps.push({
        stage,
        description,
        ...(expression ? { expression } : {}),
        ...(claimedResult ? { claimedResult } : {}),
      })
    }
  }
  if (errors.length > 0) throw new StudioValidationError(errors)

  // Deterministic verification pass — the server, never the model, decides
  // whether the walkthrough may be called verified.
  let allMatched = true
  let exprCount = 0
  let lastComputed: number | null = null
  let failureNote: string | undefined
  for (const step of steps) {
    if (step.stage !== 'calculate' || !step.expression) continue
    exprCount++
    let computed: number | null = null
    let note: string | undefined
    try {
      computed = evaluateArithmetic(step.expression)
    } catch (err) {
      note = err instanceof Error ? err.message : 'expression could not be evaluated'
    }
    if (computed != null) {
      lastComputed = computed
      const matches = step.claimedResult != null && claimMatches(step.claimedResult, computed)
      step.verification = {
        computed: formatComputedNumber(computed),
        matches,
        ...(matches ? {} : { note: note ?? (step.claimedResult != null ? 'claimed result does not match the recomputed value' : 'no claimed result to check against') }),
      }
      if (!matches) {
        allMatched = false
        failureNote = failureNote ?? step.verification.note
      }
    } else {
      allMatched = false
      failureNote = failureNote ?? note
      step.verification = { computed: '', matches: false, note: note ?? 'expression could not be evaluated' }
    }
  }

  let result: StudioFormulaResultDTO | undefined
  const resultRaw = obj.result
  if (typeof resultRaw === 'object' && resultRaw !== null) {
    const r = resultRaw as Record<string, unknown>
    const value = cleanText(r.value, 120)
    if (value) {
      const units = isNonEmptyString(r.units) ? cleanText(r.units, 60) : undefined
      const verified =
        exprCount > 0 &&
        allMatched &&
        lastComputed != null &&
        claimMatches(value, lastComputed)
      result = {
        value,
        ...(units ? { units } : {}),
        verified,
        illustrative: !verified,
        ...(verified ? {} : { note: failureNote ?? (exprCount === 0 ? 'No numeric substitution was provided, so the walkthrough stays illustrative.' : 'Arithmetic could not be fully verified.') }),
      }
    }
  }

  const caveat = isNonEmptyString(obj.caveat) ? cleanText(obj.caveat, 300) : undefined

  // A walkthrough with numeric steps must land on a result — otherwise the
  // verification chain has nothing to conclude and the activity would present
  // arithmetic without an answer.
  if (exprCount > 0 && !result) {
    throw new StudioValidationError(['result is required when numeric calculate steps are present'])
  }

  return {
    kind: 'formula',
    title: cleanText(obj.title, 160) || 'Formula walkthrough',
    formula,
    variables,
    steps,
    ...(result ? { result } : {}),
    ...(caveat ? { caveat } : {}),
  }
}

const FLASHCARD_TAGS: StudioFlashcardKind[] = ['definition', 'fact', 'formula', 'qa']

export function normalizeFlashcards(raw: unknown): StudioFlashcardsDTO {
  if (typeof raw !== 'object' || raw === null) throw new StudioValidationError(['payload is not an object'])
  const obj = raw as Record<string, unknown>
  const errors: string[] = []
  const cardsRaw = obj.cards
  if (!Array.isArray(cardsRaw) || cardsRaw.length < 4 || cardsRaw.length > 30) {
    throw new StudioValidationError(['flashcard set needs 4–30 cards'])
  }
  const cards: StudioFlashcardDTO[] = []
  for (const item of cardsRaw) {
    if (typeof item !== 'object' || item === null) {
      errors.push('card is not an object')
      continue
    }
    const c = item as Record<string, unknown>
    const front = cleanText(c.front, 300)
    const back = cleanText(c.back, 1200)
    if (!front || !back) {
      errors.push('a card is missing its front or back')
      continue
    }
    const kindTag = FLASHCARD_TAGS.includes(c.kindTag as StudioFlashcardKind) ? (c.kindTag as StudioFlashcardKind) : undefined
    cards.push({ front, back, ...(kindTag ? { kindTag } : {}) })
  }
  if (errors.length > 0) throw new StudioValidationError(errors)
  return { kind: 'flashcards', title: cleanText(obj.title, 160) || 'Revision flashcards', cards }
}

const QUIZ_DIFFICULTIES: StudioQuizDifficulty[] = ['foundation', 'application', 'advanced']

export function normalizeMiniTest(raw: unknown, allowedPages: Set<number> | null): StudioMiniTestDTO {
  if (typeof raw !== 'object' || raw === null) throw new StudioValidationError(['payload is not an object'])
  const obj = raw as Record<string, unknown>
  const errors: string[] = []
  const questionsRaw = obj.questions
  if (!Array.isArray(questionsRaw) || questionsRaw.length < 3 || questionsRaw.length > 10) {
    throw new StudioValidationError(['mini-test needs 3–10 questions'])
  }
  const questions: StudioQuizQuestionDTO[] = []
  for (const item of questionsRaw) {
    if (typeof item !== 'object' || item === null) {
      errors.push('question is not an object')
      continue
    }
    const q = item as Record<string, unknown>
    const prompt = cleanText(q.prompt, 600)
    const optionsRaw = q.options
    if (!Array.isArray(optionsRaw) || optionsRaw.length < 3 || optionsRaw.length > 5) {
      errors.push(`question "${prompt.slice(0, 40) || '?'}" needs 3–5 options`)
      continue
    }
    const options = optionsRaw.map(o => cleanText(o, 200)).filter(o => o.length > 0)
    const unique = new Set(options.map(o => o.toLowerCase()))
    if (options.length !== optionsRaw.length || unique.size !== options.length) {
      errors.push(`question "${prompt.slice(0, 40) || '?'}" has empty or duplicate options`)
      continue
    }
    const correctIndex = typeof q.correctIndex === 'number' && Number.isInteger(q.correctIndex) ? q.correctIndex : -1
    if (correctIndex < 0 || correctIndex >= options.length) {
      errors.push(`question "${prompt.slice(0, 40) || '?'}" has an out-of-range correctIndex`)
      continue
    }
    const explanation = cleanText(q.explanation, 1200)
    if (explanation.length < 20) {
      errors.push(`question "${prompt.slice(0, 40) || '?'}" needs a real explanation (≥20 chars)`)
      continue
    }
    if (!prompt || prompt.length < 10) {
      errors.push('a question has an empty or too-short prompt')
      continue
    }
    const difficulty = QUIZ_DIFFICULTIES.includes(q.difficulty as StudioQuizDifficulty) ? (q.difficulty as StudioQuizDifficulty) : undefined
    // Page references are only kept when the cited page was actually fed to
    // the model — anything else is stripped, never shown (no fabricated citations).
    let pageRef: number | undefined
    if (typeof q.pageRef === 'number' && Number.isInteger(q.pageRef) && q.pageRef > 0) {
      if (allowedPages && allowedPages.has(q.pageRef)) pageRef = q.pageRef
    }
    questions.push({
      prompt,
      options,
      correctIndex,
      explanation,
      ...(difficulty ? { difficulty } : {}),
      ...(pageRef != null ? { pageRef } : {}),
    })
  }
  if (errors.length > 0) throw new StudioValidationError(errors)
  // Honest difficulty progression: foundation first (stable sort keeps model order within a tier).
  questions.sort((a, b) => quizDifficultyRank(a.difficulty) - quizDifficultyRank(b.difficulty))
  return { kind: 'mini-test', title: cleanText(obj.title, 160) || 'Mini-test', questions, honestyNote: STUDIO_MINITEST_HONESTY_NOTE }
}

// ─── Prompt construction ──────────────────────────────────────────────────────

const SHARED_OUTPUT_RULES = [
  'OUTPUT RULES (apply to every string value):',
  '- Plain text only: never HTML, markdown tables, code fences, LaTeX or emoji.',
  '- Explain difficult terminology in accessible language the first time it appears.',
  '- Be honest about uncertainty: if the material does not cover part of the topic, keep to what you can support instead of inventing facts.',
  '- Never fabricate sources, page numbers or verification claims.',
].join('\n')

const MATERIAL_RULES_DOCUMENT = [
  'SOURCE RULES:',
  '- Base factual content on the student material provided in the user message.',
  '- If the material does not cover the requested topic well, you may still build the activity from general knowledge — accuracy and accessibility come first.',
].join('\n')

function studioLanguageBlock(lang: RiisheResponseLanguage): string {
  const base = responseLanguagePrompt(lang)
  if (!base) {
    return 'LANGUAGE: match the language of the topic text naturally; if it is not clearly one language, use simple English.'
  }
  return `LANGUAGE: every string value in the JSON (titles, labels, explanations, options) must be written in the language specified below. Keep formulas, symbols, identifiers and page numbers unchanged.\n${base}`
}

function conceptMapPrompt(topic: string): string {
  return [
    `STUDIO TASK — VISUAL CONCEPT MAP for the topic "${topic}".`,
    'Return ONLY a JSON object with this exact shape:',
    '{ "title": string, "nodes": [ { "id": string, "label": string, "parent": string | null, "explanation": string } ] }',
    'STRUCTURE RULES:',
    '- 6–24 nodes forming a tree; exactly ONE node has parent null — the central concept named by the topic.',
    '- Every other node references its parent by id; parent must exist; no cycles; depth at most 4.',
    '- ids are short slugs like "n1" (letters, digits, - and _ only), unique.',
    '- labels are 2–80 characters; explanations 1–3 accessible sentences, up to 500 characters.',
    '- Children refine their parent; siblings stay distinct; cover the whole topic, not one corner of it.',
    SHARED_OUTPUT_RULES,
  ].join('\n')
}

function stepsPrompt(topic: string): string {
  return [
    `STUDIO TASK — STEP-BY-STEP EXPLANATION of "${topic}".`,
    'Return ONLY a JSON object with this exact shape:',
    '{ "title": string, "steps": [ { "title": string, "body": string, "example": string (optional) } ] }',
    'STRUCTURE RULES:',
    '- 4–8 steps. Each step teaches ONE focused idea; together they build the topic from basics to mastery.',
    '- title ≤ 100 characters; body ≤ 900 characters (2–6 sentences); example (when useful) ≤ 500 characters.',
    '- Order steps so each one only relies on earlier steps; define any new term in the step where it first appears.',
    '- Use at least one concrete example across the sequence when the topic allows it.',
    SHARED_OUTPUT_RULES,
  ].join('\n')
}

function formulaPrompt(topic: string): string {
  return [
    `STUDIO TASK — FORMULA WALKTHROUGH for "${topic}".`,
    'Pick the single most important formula for this topic from the material. Return ONLY a JSON object with this exact shape:',
    '{ "title": string, "formula": string, "variables": [ { "symbol": string, "meaning": string } ], "steps": [ { "stage": "substitute" | "calculate", "description": string, "expression": string (optional), "claimedResult": string (optional) } ], "result": { "value": string, "units": string (optional) }, "caveat": string (optional) }',
    'STRUCTURE RULES:',
    '- formula: the formula itself in plain notation (use * / ^ and parentheses), ≤ 200 characters.',
    '- variables: every symbol in the formula with a one-line accessible meaning (≤ 150 characters each).',
    '- steps 2–8, in order: first "substitute" stage(s) (put concrete values into the formula, describe each substitution), then "calculate" stage(s) (do the arithmetic in order).',
    '- For every calculate step, put the pure arithmetic in "expression" using ONLY numbers, + - * / % ^ ( ) and pi — no units, no words, no symbols. Also give "claimedResult": the numeric result you expect (units may follow the number).',
    '- The server recomputes every expression itself and shows students whether your claimed results match. Never round intermediates so aggressively that the final result breaks.',
    '- result: the final answer with its units. If the material gives no concrete values, build ONE illustrative example with clearly stated assumed values and explain that in "caveat" — the server labels unverified walkthroughs as illustrative; never claim verified accuracy yourself.',
    SHARED_OUTPUT_RULES,
  ].join('\n')
}

function flashcardsPrompt(topic: string): string {
  return [
    `STUDIO TASK — REVISION FLASHCARDS for "${topic}".`,
    'Return ONLY a JSON object with this exact shape:',
    '{ "title": string, "cards": [ { "front": string, "back": string, "kindTag": "definition" | "fact" | "formula" | "qa" } ] }',
    'STRUCTURE RULES:',
    '- 6–14 cards mixing the useful kinds: definitions, key facts, formulas, and short question→answer pairs (kindTag "qa" for those).',
    '- front ≤ 200 characters (the prompt to recall); back ≤ 700 characters (the answer or explanation).',
    '- Each card must stand on its own; do not rely on card order; do not duplicate the same fact twice.',
    '- Formula cards: front shows the formula or what it computes; back explains the symbols and when to use it.',
    SHARED_OUTPUT_RULES,
  ].join('\n')
}

function miniTestPrompt(topic: string): string {
  return [
    `STUDIO TASK — SHORT SELF-CHECK MINI-TEST on "${topic}".`,
    'Return ONLY a JSON object with this exact shape:',
    '{ "title": string, "questions": [ { "prompt": string, "options": [string, string, string, string], "correctIndex": number, "explanation": string, "difficulty": "foundation" | "application" | "advanced", "pageRef": number (optional) } ] }',
    'STRUCTURE RULES:',
    '- 5–8 multiple-choice questions, each with 4 distinct options.',
    '- Order questions from foundation to advanced difficulty; set "difficulty" accordingly.',
    '- prompt ≤ 400 characters; options ≤ 150 characters each, exactly one correct; correctIndex is the 0-based index of the correct option.',
    '- explanation ≥ 40 characters: say WHY the correct answer is right and what mistake the wrong options invite.',
    '- Only include "pageRef" when the tested fact visibly appears in the numbered pages of the provided material ([page N] markers); otherwise omit the field entirely.',
    '- Test understanding and application, not trivia; never present invented content as a real past exam question.',
    SHARED_OUTPUT_RULES,
  ].join('\n')
}

function promptForKind(kind: StudioActivityKind, topic: string): string {
  switch (kind) {
    case 'concept-map':
      return conceptMapPrompt(topic)
    case 'steps':
      return stepsPrompt(topic)
    case 'formula':
      return formulaPrompt(topic)
    case 'flashcards':
      return flashcardsPrompt(topic)
    case 'mini-test':
      return miniTestPrompt(topic)
  }
}

// ─── Generation pipeline ──────────────────────────────────────────────────────

/** One grounded material window handed to the generator (pre-fetched by the route). */
export interface StudioMaterialBlock {
  /** Human label, e.g. "Physics Essentials — pages 3–5". */
  label: string
  text: string
  /** Page numbers contained in this block (drives citation validation). */
  pages: number[]
}

export interface StudioGroundingContext {
  mode: 'document' | 'general'
  docTitle?: string
  blocks: StudioMaterialBlock[]
}

export interface StudioDeps {
  chatJson: <T>(opts: { system: string; user: string; retryNote?: string }) => Promise<T>
}

export interface StudioGenerateInput {
  kind: StudioActivityKind
  topic: string
  grounding: StudioGroundingContext
  responseLanguage: RiisheResponseLanguage
  /** Injectable provider seam (defaults to the real chatJson). */
  deps?: StudioDeps
}

export interface StudioGenerationResult {
  activity: StudioActivity
  grounding: 'document' | 'general'
  docTitle?: string
}

const MAX_MATERIAL_CHARS = 12_000

function materialUserBlock(grounding: StudioGroundingContext): string {
  if (grounding.mode === 'general' || grounding.blocks.length === 0) {
    return 'No uploaded material covers this topic — build the activity from general knowledge and stay honest about it.'
  }
  const joined = grounding.blocks
    .map(b => `── ${b.label} ──\n${b.text}`)
    .join('\n\n')
    .slice(0, MAX_MATERIAL_CHARS)
  return fenceDocumentText('student study material', joined)
}

function validatePayload(kind: StudioActivityKind, payload: unknown, allowedPages: Set<number> | null): StudioActivity {
  switch (kind) {
    case 'concept-map':
      return normalizeConceptMap(payload)
    case 'steps':
      return normalizeSteps(payload)
    case 'formula':
      return normalizeFormula(payload)
    case 'flashcards':
      return normalizeFlashcards(payload)
    case 'mini-test':
      return normalizeMiniTest(payload, allowedPages)
  }
}

const ACTIVITY_NOUNS: Record<StudioActivityKind, string> = {
  'concept-map': 'concept map',
  steps: 'step-by-step explanation',
  formula: 'formula walkthrough',
  flashcards: 'flashcard set',
  'mini-test': 'mini-test',
}

/**
 * Generate + validate one studio activity. Throws StudioGenerationError with a
 * human message when no reliable activity could be produced — callers surface
 * that honestly (502), never a fake activity.
 */
export async function generateStudioActivity(input: StudioGenerateInput): Promise<StudioGenerationResult> {
  const { kind, topic, grounding, responseLanguage } = input
  const chatJsonFn = input.deps?.chatJson ?? chatJson
  const allowedPages =
    grounding.mode === 'document' ? new Set(grounding.blocks.flatMap(b => b.pages)) : null

  const system = [
    promptForKind(kind, topic),
    MATERIAL_RULES_DOCUMENT,
    studioLanguageBlock(responseLanguage),
  ].join('\n\n')
  const user = [
    `Topic: ${topic}`,
    '',
    materialUserBlock(grounding),
  ].join('\n')

  let payload: unknown
  try {
    payload = await chatJsonFn<unknown>({ system, user })
    return finish(kind, payload, allowedPages, grounding)
  } catch (err) {
    if (err instanceof StudioValidationError) {
      // One semantic repair retry with the exact validation errors.
      try {
        const repaired = await chatJsonFn<unknown>({
          system,
          user: `${user}\n\nIMPORTANT: your previous JSON was rejected by validation: ${err.errors.join('; ')}. Fix exactly these problems and return the corrected JSON object with the same shape. Return ONLY the JSON value.`,
        })
        return finish(kind, repaired, allowedPages, grounding)
      } catch (retryErr) {
        if (retryErr instanceof StudioValidationError) {
          throw new StudioGenerationError(
            `Riishe could not build a reliable ${ACTIVITY_NOUNS[kind]} from this material right now (output failed validation twice). Please try again, or rephrase the topic.`,
          )
        }
        throw new StudioGenerationError(providerFailureMessage(kind))
      }
    }
    throw new StudioGenerationError(providerFailureMessage(kind))
  }
}

function providerFailureMessage(kind: StudioActivityKind): string {
  return `Riishe could not reach the AI provider just now, so no ${ACTIVITY_NOUNS[kind]} was generated. Please try again in a moment.`
}

function finish(
  kind: StudioActivityKind,
  payload: unknown,
  allowedPages: Set<number> | null,
  grounding: StudioGroundingContext,
): StudioGenerationResult {
  const activity = validatePayload(kind, payload, allowedPages)
  return {
    activity,
    grounding: grounding.mode === 'document' && grounding.blocks.length > 0 ? 'document' : 'general',
    ...(grounding.mode === 'document' && grounding.docTitle ? { docTitle: grounding.docTitle } : {}),
  }
}
