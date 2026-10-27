// ─── Riishe topic canonicalisation: dedupe + hierarchy + page verification ───
// Pure, deterministic post-processing over per-section model output:
//   1. normalise titles (punctuation, abbreviations, articles, case)
//   2. merge genuine duplicates — exact normalised match, token similarity,
//      or safe containment — while PRESERVING distinct concepts that merely
//      sound similar (distinct concepts inside different parent sections are
//      never merged)
//   3. keep a canonical title + aliases for everything merged
//   4. verify claimed page references against the actual extracted page text
//      (a page number that appears nowhere near the topic's words is dropped)
// The same input always produces the same output, so re-analysis cannot
// re-introduce duplicates.

import type { AnalyzedTopic } from './types'

// ─── Title normalisation ──────────────────────────────────────────────────────

const ABBREV_EXPANSIONS: [RegExp, string][] = [
  [/\band\b/g, ' and '],
  [/&/g, ' and '],
  [/\bw\/\b/g, ' with '],
  [/\bvs\.?\b/g, ' versus '],
  [/\be\.?\s?g\.?\b/g, ' '],
  [/\bi\.?\s?e\.?\b/g, ' '],
  [/\betc\.?\b/g, ' '],
]

/** Aggressive normal form used for duplicate detection only (never display). */
export function normalizeTitle(s: string): string {
  let t = s.toLowerCase()
  for (const [re, rep] of ABBREV_EXPANSIONS) t = t.replace(re, rep)
  t = t
    .replace(/\(([^)]*)\)/g, ' $1 ') // keep parenthetical words but unhook them
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)) // light plural stemming
    .join(' ')
    .replace(/\b(the|a|an|of|for|and|in|to|on|with|by)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t
}

export function titleTokens(s: string): string[] {
  return normalizeTitle(s).split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w))
}

const STOPWORDS = new Set([
  'introduction', 'about', 'chapter', 'unit', 'section', 'part', 'appendix',
])

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

// ─── Input shape ──────────────────────────────────────────────────────────────

export interface TopicInput {
  name: string
  subtopics: string[]
  pages: number[]
  /** analysis unit this came from — anchors hierarchy + trusted page range */
  unitIndex: number
  unitTitle: string | null
  unitFromPage: number
  unitToPage: number
  /** heading-derived topics carry a verified anchor page */
  anchored?: boolean
}

export interface CanonicalizeOptions {
  /** page number → normalized page text, for reference verification */
  pageTextIndex: Map<number, string>
  maxTopics?: number
  maxSubtopicsPerTopic?: number
}

// ─── Page verification ────────────────────────────────────────────────────────

/**
 * Keep only page references the document itself supports:
 *  • the page lies in one of the units the topic was extracted from (the model
 *    was shown exactly those [page N] markers) — a topic merged from several
 *    chunks of one long section keeps its full span, it is not clamped to the
 *    first chunk, AND
 *  • at least one meaningful title token occurs on that page.
 * Heading-anchored pages are always kept. If nothing survives, fall back to
 * the unit ranges (still document-derived — never invented).
 */
export function verifyPages(
  name: string,
  claimed: number[],
  unitRanges: { fromPage: number; toPage: number }[],
  pageTextIndex: Map<number, string>,
  anchoredPage: number | null,
): { pages: number[]; verified: boolean } {
  const inAnyRange = (p: number) => unitRanges.some(r => p >= r.fromPage && p <= r.toPage)
  const inRange = [...new Set(claimed.filter(inAnyRange))].sort((a, b) => a - b)
  const tokens = titleTokens(name).filter(t => t.length > 3)
  const supported: number[] = []
  for (const p of inRange) {
    const text = pageTextIndex.get(p)
    if (!text) continue
    if (tokens.length === 0) {
      supported.push(p)
      continue
    }
    if (tokens.some(t => text.includes(t))) supported.push(p)
  }
  const pages = anchoredPage !== null && !supported.includes(anchoredPage)
    ? [...supported, anchoredPage].sort((a, b) => a - b)
    : supported
  const final = pages.length > 0
    ? pages.slice(0, 30)
    : inRange.slice(0, 30)
  return { pages: final, verified: supported.length > 0 || anchoredPage !== null }
}

// ─── Duplicate merging ────────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.72
const CONTAIN_MIN_LEN = 10 // shorter title must be ≥10 normalized chars to merge by containment

interface WorkingTopic {
  name: string
  nameScore: number // canonical-title preference score
  aliases: string[]
  subtopics: string[]
  pages: number[]
  anchoredPage: number | null
  units: Set<number>
  unitRefs: { unitIndex: number; title: string | null; fromPage: number; toPage: number }[]
  tokens: Set<string>
  norm: string
}

/** Prefer the variant that looks most like the document's own wording. */
function titleScore(name: string, fromTocish: boolean): number {
  let score = 0
  if (fromTocish) score += 3
  if (/\d/.test(name)) score += 1 // numbered headings are literal document text
  if (name === name.toUpperCase() && /[A-Z]/.test(name)) score += 1 // caps headings are literal
  score += Math.min(name.length, 60) / 60 // longer = more informative
  return score
}

function mergeSubtopicLists(existing: string[], incoming: string[], max: number): string[] {
  const keptKeys: string[] = []
  const out: string[] = []
  const candidates = [...existing, ...incoming]
  const tokens = candidates.map(c => ({ raw: c, t: new Set(titleTokens(c)), k: normalizeTitle(c) }))
  for (const cand of tokens) {
    const key = [...cand.t].sort().join(' ')
    if (!key) continue
    let dup = false
    for (const kept of keptKeys) {
      // near-duplicate by token overlap OR safe containment ("tests subject covered"
      // ⊂ "test subject covered under cuet ug 2026") — same idea, different wording
      const keptTokens = new Set(kept.split(' '))
      const shorter = cand.k.length <= kept.length ? cand.k : kept
      const longer = cand.k.length <= kept.length ? kept : cand.k
      if (
        jaccard(cand.t, keptTokens) >= 0.8 ||
        (shorter.length >= 10 && longer.includes(shorter))
      ) {
        dup = true
        break
      }
    }
    if (dup) continue
    keptKeys.push(key)
    out.push(cand.raw.slice(0, 120))
    if (out.length >= max) break
  }
  return out
}

export function canonicalizeTopics(inputs: TopicInput[], opts: CanonicalizeOptions): AnalyzedTopic[] {
  const maxSubs = opts.maxSubtopicsPerTopic ?? 12

  // 1 ── build working topics, merging exact normalised matches immediately
  const work: WorkingTopic[] = []
  const byNorm = new Map<string, WorkingTopic>()
  for (const input of inputs) {
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    if (!name) continue
    const norm = normalizeTitle(name)
    if (!norm) continue
    const tokens = new Set(titleTokens(name))
    const anchor = input.anchored ? input.unitFromPage : null
    const existing = byNorm.get(norm)
    if (existing) {
      // Record the variant wording as an alias before merging
      if (input.name !== existing.name && !existing.aliases.includes(input.name)) {
        existing.aliases.push(input.name)
      }
      mergeInto(existing, input, anchor, maxSubs)
      continue
    }
    const wt: WorkingTopic = {
      name,
      nameScore: titleScore(name, false),
      aliases: [],
      subtopics: [],
      pages: [],
      anchoredPage: anchor,
      units: new Set([input.unitIndex]),
      unitRefs: [{ unitIndex: input.unitIndex, title: input.unitTitle, fromPage: input.unitFromPage, toPage: input.unitToPage }],
      tokens,
      norm,
    }
    mergeInto(wt, input, anchor, maxSubs)
    work.push(wt)
    byNorm.set(norm, wt)
  }

  // 2 ── near-duplicate pass: token similarity or safe containment.
  // Distinct concepts in DIFFERENT parent units are never merged unless the
  // match is overwhelming (exact containment of a long title), because two
  // chapters may legitimately cover similar-sounding ideas.
  const sorted = [...work].sort((a, b) => b.nameScore - a.nameScore)
  const kept: WorkingTopic[] = []
  const absorbed = new Map<WorkingTopic, WorkingTopic>()
  for (const t of sorted) {
    let target: WorkingTopic | null = null
    for (const k of kept) {
      if (similarEnough(t, k)) {
        target = k
        break
      }
    }
    if (target) {
      absorbInto(target, t)
      absorbed.set(t, target)
    } else {
      kept.push(t)
    }
  }

  // 3 ── hierarchy: parent assignment by unit containment
  const topics: AnalyzedTopic[] = kept.map((t, i) => {
    const ranges = t.unitRefs.map(r => ({ fromPage: r.fromPage, toPage: r.toPage }))
    const claimedPages = [...t.pages]
    const verified = verifyPages(t.name, claimedPages, ranges, opts.pageTextIndex, t.anchoredPage)
    return {
      id: `t${i + 1}`,
      name: t.name,
      subtopics: t.subtopics,
      pages: verified.pages,
      aliases: t.aliases.length > 0 ? t.aliases.slice(0, 6) : undefined,
      pageVerified: verified.verified,
    } satisfies AnalyzedTopic
  })

  // Assign parents: a topic is level 2 when its unit had a heading AND that
  // heading itself became a topic with a superset page range.
  const unitTitleNorms = new Map<string, AnalyzedTopic>()
  for (const input of inputs) {
    if (!input.unitTitle) continue
    const norm = normalizeTitle(input.unitTitle)
    if (!norm || unitTitleNorms.has(norm)) continue
    const topic = topics.find(t => normalizeTitle(t.name) === norm)
    if (topic) unitTitleNorms.set(norm, topic)
  }
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i]
    const ref = kept[i]?.unitRefs[0]
    const unitTitle = ref?.title ?? null
    const parent = unitTitle ? unitTitleNorms.get(normalizeTitle(unitTitle)) : undefined
    if (parent && parent !== t) {
      t.level = 2
      t.parentId = parent.id ?? null
    } else {
      t.level = 1
      t.parentId = null
    }
  }

  // 4 ── order by first appearance (page, then unit) for a stable, readable list
  const orderKey = (t: AnalyzedTopic) => t.pages[0] ?? 99999
  const withOrder = topics
    .map((t, i) => ({ t, i }))
  withOrder.sort((a, b) => orderKey(a.t) - orderKey(b.t) || a.i - b.i)
  const ordered = withOrder.map(x => x.t)
  // renumber ids after ordering so parent links stay valid
  const idMap = new Map<string, string>()
  ordered.forEach((t, i) => {
    idMap.set(t.id ?? `t${i + 1}`, `t${i + 1}`)
  })
  for (const t of ordered) {
    const newId = idMap.get(t.id ?? '') ?? t.id
    t.id = newId
    if (t.parentId) t.parentId = idMap.get(t.parentId) ?? t.parentId
  }

  const max = opts.maxTopics ?? 200
  return capTopicsFairly(ordered, max)
}

/**
 * Size ceiling that never sacrifices document coverage:
 *   • every level-1 (major section) topic is ALWAYS kept — dropping one would
 *     erase a whole region of the document from the topic list;
 *   • when level-2 concepts must be trimmed, they are dropped round-robin
 *     across parents (and within a parent in document order), so the cut is
 *     spread over the whole document instead of silently amputating its tail
 *     (a plain `slice` on the page-ordered list dropped every topic past the
 *     cap — the back half of a long document vanished).
 * Deterministic: same input, same survivors.
 */
function capTopicsFairly(ordered: AnalyzedTopic[], max: number): AnalyzedTopic[] {
  if (ordered.length <= max) return ordered
  const tops = ordered.filter(t => t.level !== 2)
  const children = ordered.filter(t => t.level === 2)
  const budget = Math.max(0, max - tops.length)
  if (children.length <= budget) return ordered

  const byParent = new Map<string, AnalyzedTopic[]>()
  for (const c of children) {
    const key = c.parentId ?? '_root'
    const list = byParent.get(key) ?? []
    list.push(c)
    byParent.set(key, list)
  }
  const keptChildren: AnalyzedTopic[] = []
  let added = true
  while (keptChildren.length < budget && added) {
    added = false
    for (const list of byParent.values()) {
      if (list.length === 0) continue
      keptChildren.push(list.shift() as AnalyzedTopic)
      added = true
      if (keptChildren.length >= budget) break
    }
  }
  const keptIds = new Set(keptChildren.map(t => t.id))
  return [...tops, ...keptChildren].sort((a, b) => (a.pages[0] ?? 99999) - (b.pages[0] ?? 99999))
    .filter(t => t.level !== 2 || keptIds.has(t.id))
}

function similarEnough(a: WorkingTopic, b: WorkingTopic): boolean {
  if (a.norm === b.norm) return true
  const j = jaccard(a.tokens, b.tokens)
  // Same document area (overlapping unit ranges) → merge more aggressively
  const overlap = a.unitRefs.some(u => b.unitRefs.some(v => u.fromPage <= v.toPage && v.fromPage <= u.toPage))
  const threshold = overlap ? SIMILARITY_THRESHOLD : Math.max(SIMILARITY_THRESHOLD, 0.85)
  if (j >= threshold) return true
  // Safe containment: "eligibility" ⊂ "eligibility criteria" (same idea,
  // different extraction wording). Only when the shorter title is meaningful
  // and the pair sits in the same area of the document.
  if (overlap || a.units.size === 0) {
    const shorter = a.norm.length <= b.norm.length ? a.norm : b.norm
    const longer = a.norm.length <= b.norm.length ? b.norm : a.norm
    if (shorter.length >= CONTAIN_MIN_LEN && longer.includes(shorter)) return true
  }
  return false
}

function mergeInto(target: WorkingTopic, input: TopicInput, anchor: number | null, maxSubs: number): void {
  target.units.add(input.unitIndex)
  target.unitRefs.push({ unitIndex: input.unitIndex, title: input.unitTitle, fromPage: input.unitFromPage, toPage: input.unitToPage })
  target.subtopics = mergeSubtopicLists(target.subtopics, input.subtopics ?? [], maxSubs)
  target.pages = [...new Set([...target.pages, ...input.pages])].sort((a, b) => a - b)
  if (anchor !== null) target.anchoredPage = target.anchoredPage ?? anchor
}

function absorbInto(target: WorkingTopic, other: WorkingTopic): void {
  // Canonical title: keep the better-scoring variant, remember the other
  if (other.nameScore > target.nameScore) {
    target.aliases.push(target.name)
    target.name = other.name
    target.nameScore = other.nameScore
    target.norm = other.norm
    target.tokens = other.tokens
  } else {
    target.aliases.push(other.name)
  }
  target.aliases.push(...other.aliases)
  target.subtopics = mergeSubtopicLists(target.subtopics, other.subtopics, 12)
  target.pages = [...new Set([...target.pages, ...other.pages])].sort((a, b) => a - b)
  target.anchoredPage = target.anchoredPage ?? other.anchoredPage
  for (const u of other.units) target.units.add(u)
  target.unitRefs.push(...other.unitRefs)
}
