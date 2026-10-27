// ─── Riishe topic canonicalisation: dedupe + hierarchy + page verification ───
// Pure, deterministic post-processing over per-section model output.
//
// v4 — origin-aware merging. Every topic input carries an ORIGIN:
//   • SOURCE_HEADING — the document's own section title (from the contents
//     table or a body heading). These are the document's real structure:
//     they are kept verbatim, never renamed, and never absorbed into an
//     AI-inferred topic. Same-title chunk continuations of one long section
//     merge; different sections never do, however similar they sound.
//   • AI_INFERRED — a study topic Riishe identified INSIDE a source section.
//     These may merge with each other when they sit in the same section, or
//     merge INTO a source heading they merely echo. They must never reach
//     across the document and fuse with a different section's topic.
//
// Page verification is word-boundary based (substring checks falsely
// supported fragments like "alfunction" inside "malfunction"), with light
// plural handling. Subtopics that no supporting page evidences are dropped
// instead of being shown as invented keywords.
//
// The same input always produces the same output, so re-analysis cannot
// re-introduce duplicates.

import type { AnalyzedTopic, TopicOrigin, TitleSource } from './types'
import { extractNumberToken } from './structure'

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

// ─── Evidence: word-boundary token lookup in page text ────────────────────────

const tokenReCache = new Map<string, RegExp>()

function wordRe(token: string): RegExp {
  let re = tokenReCache.get(token)
  if (!re) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`\\b${esc}\\b`)
    tokenReCache.set(token, re)
  }
  return re
}

/**
 * Does `token` occur in the (already lowercased, punctuation-collapsed) page
 * text as a whole word? Light plural handling both ways, because titles stem
 * plurals ("universities" → "university") while page text keeps them.
 */
export function pageHasToken(text: string, token: string): boolean {
  if (!token) return false
  if (wordRe(token).test(text)) return true
  if (token.length > 3 && token.endsWith('s') && wordRe(token.slice(0, -1)).test(text)) return true
  if (wordRe(`${token}s`).test(text)) return true
  if (wordRe(`${token}es`).test(text)) return true
  return false
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
  /** v4: what this title represents in the document (default: AI_INFERRED for model output) */
  origin?: TopicOrigin
  /** v4: where the title wording came from */
  titleSource?: TitleSource
  /** v4: the document's own numbering token ("Chapter-4", "VII"), when the title carries one */
  numbering?: string | null
  /** v4: printed page the contents table claims for this section */
  tocPrintedPage?: number | null
  /** v4: physical page where the contents claim was matched in the body */
  tocMatchPage?: number | null
  /** v4: false when the section's own pages could not confirm the title */
  structureVerified?: boolean
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
 *  • at least one meaningful title token occurs on that page as a whole word.
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
    if (tokens.some(t => pageHasToken(text, t))) supported.push(p)
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
  origin: TopicOrigin
  titleSource: TitleSource
  numbering: string | null
  tocPrintedPage: number | null
  tocMatchPage: number | null
  structureVerified: boolean
  aliases: string[]
  subtopics: string[]
  pages: number[]
  anchoredPage: number | null
  units: Set<number>
  unitRefs: { unitIndex: number; title: string | null; fromPage: number; toPage: number }[]
  tokens: Set<string>
  norm: string
  parentRef: WorkingTopic | null
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
    out.push(cand.raw.slice(0, 240))
    if (out.length >= max) break
  }
  return out
}

function rangesOverlap(a: WorkingTopic, b: WorkingTopic): boolean {
  return a.unitRefs.some(u => b.unitRefs.some(v => u.fromPage <= v.toPage && v.fromPage <= u.toPage))
}

/** Same parent section = both topics' first unit sits under the same heading title. */
function sameParentSection(a: WorkingTopic, b: WorkingTopic): boolean {
  const ta = a.unitRefs[0]?.title ?? null
  const tb = b.unitRefs[0]?.title ?? null
  if (ta === null && tb === null) return true // both unparented chunks
  if (ta === null || tb === null) return false
  return normalizeTitle(ta) === normalizeTitle(tb)
}

export function canonicalizeTopics(inputs: TopicInput[], opts: CanonicalizeOptions): AnalyzedTopic[] {
  const maxSubs = opts.maxSubtopicsPerTopic ?? 12
  const NAME_CAP = 240

  const makeWorking = (input: TopicInput): WorkingTopic => {
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_CAP)
    const origin: TopicOrigin = input.origin ?? (input.anchored ? 'SOURCE_HEADING' : 'AI_INFERRED')
    const titleSource: TitleSource = input.titleSource ?? (origin === 'SOURCE_HEADING' ? 'body' : 'inferred')
    // source headings carry the document's own numbering even when the caller
    // did not extract it — it is part of the title itself
    const numbering = input.numbering ?? (origin === 'SOURCE_HEADING' ? extractNumberToken(name) : null)
    return {
      name,
      nameScore: titleScore(name, origin === 'SOURCE_HEADING' && input.titleSource === 'toc'),
      origin,
      titleSource,
      numbering,
      tocPrintedPage: input.tocPrintedPage ?? null,
      tocMatchPage: input.tocMatchPage ?? null,
      structureVerified: input.structureVerified ?? true,
      aliases: [],
      subtopics: [],
      pages: [],
      anchoredPage: input.anchored ? input.unitFromPage : null,
      units: new Set([input.unitIndex]),
      unitRefs: [],
      tokens: new Set(titleTokens(name)),
      norm: normalizeTitle(name),
      parentRef: null,
    }
  }

  // 1 ── build working topics. Exact-normalised matches merge ONLY when they
  // belong together: chunk continuations of one section (same unit title or
  // overlapping ranges) always fuse; a model echo of a section title always
  // merges INTO that heading; but two same-named topics from DIFFERENT
  // sections stay separate ("Marking Scheme" in two chapters is two things).
  const work: WorkingTopic[] = []
  const byNorm = new Map<string, WorkingTopic[]>()
  for (const input of inputs) {
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_CAP)
    if (!name) continue
    const norm = normalizeTitle(name)
    if (!norm) continue
    const wt = makeWorking(input)
    mergeInto(wt, input, maxSubs)
    const bucket = byNorm.get(norm) ?? []
    let target: WorkingTopic | null = null
    for (const existing of bucket) {
      if (wt.origin === 'SOURCE_HEADING' && existing.origin === 'SOURCE_HEADING') {
        // two source headings with the same title: chunk continuations only
        if (sameParentSection(existing, wt) || rangesOverlap(existing, wt)) { target = existing; break }
        continue
      }
      if (wt.origin === 'SOURCE_HEADING' || existing.origin === 'SOURCE_HEADING') {
        // a model echo of a real section title merges into the heading
        target = existing
        break
      }
      // both inferred: same area only
      if (sameParentSection(existing, wt) || rangesOverlap(existing, wt)) { target = existing; break }
    }
    if (target) {
      if (wt.origin === 'SOURCE_HEADING' && target.origin !== 'SOURCE_HEADING') {
        promoteToHeading(target, input)
      } else if (wt.name !== target.name && !target.aliases.includes(wt.name)) {
        target.aliases.push(wt.name)
      }
      mergeInto(target, input, maxSubs)
    } else {
      work.push(wt)
      bucket.push(wt)
      byNorm.set(norm, bucket)
    }
  }

  // 2 ── near-duplicate pass with origin + location guards.
  //   • two source headings merge only when their ranges overlap (chunks of one
  //     section) — distinct sections never fuse, however similar they sound;
  //   • a source heading and an inferred topic merge only in the same area AND
  //     the heading stays canonical (the inferred wording becomes an alias);
  //   • two inferred topics merge at the standard threshold when they sit in
  //     the same section, and only at a much higher bar across sections.
  const sorted = [...work].sort((a, b) => nameOrderKey(a) - nameOrderKey(b) || a.name.localeCompare(b.name))
  const kept: WorkingTopic[] = []
  for (const t of sorted) {
    let target: WorkingTopic | null = null
    for (const k of kept) {
      if (!similarEnough(t, k)) continue
      target = k
      break
    }
    if (!target) {
      kept.push(t)
      continue
    }
    // A source heading must never be absorbed into an inferred topic
    if (t.origin === 'SOURCE_HEADING' && target.origin !== 'SOURCE_HEADING') {
      absorbInto(t, target) // heading absorbs the inferred echo
      const idx = kept.indexOf(target)
      if (idx >= 0) kept[idx] = t
      // re-link any earlier absorbed refs is unnecessary: parentRef set later
    } else {
      absorbInto(target, t)
    }
  }

  // 3 ── page verification per topic (before hierarchy, pages drive ordering)
  const topics: AnalyzedTopic[] = kept.map(t => {
    const ranges = t.unitRefs.map(r => ({ fromPage: r.fromPage, toPage: r.toPage }))
    const verified = verifyPages(t.name, [...t.pages], ranges, opts.pageTextIndex, t.anchoredPage)
    return {
      id: '', // assigned after final ordering (no remapping → no dangling parents)
      name: t.name,
      subtopics: t.subtopics,
      pages: verified.pages,
      aliases: t.aliases.length > 0 ? t.aliases.slice(0, 6) : undefined,
      pageVerified: verified.verified,
      origin: t.origin,
      titleSource: t.titleSource,
      numbering: t.numbering,
      tocPrintedPage: t.tocPrintedPage,
      tocMatchPage: t.tocMatchPage,
      structureVerified: t.structureVerified,
    } satisfies AnalyzedTopic
  })
  const topicOf = new Map<WorkingTopic, AnalyzedTopic>(kept.map((t, i) => [t, topics[i]]))

  // 4 ── hierarchy. Source headings are level 1 (the document's own skeleton).
  // Inferred topics attach to the source heading of the unit they came from —
  // a direct, deterministic lookup, never a fuzzy match that can self-parent.
  const headingByUnitTitle = new Map<string, WorkingTopic>()
  for (const t of kept) {
    if (t.origin !== 'SOURCE_HEADING') continue
    const key = normalizeTitle(t.name)
    if (key && !headingByUnitTitle.has(key)) headingByUnitTitle.set(key, t)
  }
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i]
    const a = topics[i]
    if (t.origin === 'SOURCE_HEADING') {
      a.level = 1
      a.parentId = null
      continue
    }
    const unitTitle = t.unitRefs[0]?.title ?? null
    const parent = unitTitle ? headingByUnitTitle.get(normalizeTitle(unitTitle)) ?? null : null
    if (parent && parent !== t) {
      t.parentRef = parent
      a.level = 2
    } else {
      a.level = 1
      a.parentId = null
    }
  }

  // 5 ── subtopic evidence filter: a subtopic no supporting page evidences is
  // noise (model fragments like "alfunction", or outright inventions). A
  // subtopic is kept when ANY of its meaningful tokens occurs as a whole word
  // on any page of the topic's own units.
  const unitPagesOf = (t: WorkingTopic): number[] => {
    const set = new Set<number>()
    for (const r of t.unitRefs) for (let p = r.fromPage; p <= r.toPage; p++) set.add(p)
    return [...set]
  }
  for (let i = 0; i < kept.length; i++) {
    const t = kept[i]
    const a = topics[i]
    if (a.subtopics.length === 0) continue
    const pageTexts = unitPagesOf(t).map(p => opts.pageTextIndex.get(p)).filter((s): s is string => !!s)
    if (pageTexts.length === 0) continue // no readable pages — keep subtopics as-is
    a.subtopics = a.subtopics.filter(sub => {
      const tokens = titleTokens(sub).filter(x => x.length > 2)
      if (tokens.length === 0) return false
      return tokens.some(tok => pageTexts.some(txt => pageHasToken(txt, tok)))
    }).slice(0, maxSubs)
  }

  // 6 ── order by first appearance (page, then unit) for a stable, readable list
  const orderKey = (a: AnalyzedTopic) => a.pages[0] ?? 99999
  const withOrder = topics.map((a, i) => ({ a, i }))
  withOrder.sort((x, y) => orderKey(x.a) - orderKey(y.a) || x.i - y.i)
  const ordered = withOrder.map(x => x.a)

  // ids are assigned ONCE from the final order; parent links resolve through
  // the object graph, so a parent id can never collide with a child id.
  ordered.forEach((a, i) => {
    a.id = `t${i + 1}`
  })
  for (let i = 0; i < kept.length; i++) {
    const parentRef = kept[i].parentRef
    if (!parentRef) continue
    const parentTopic = topicOf.get(parentRef)
    if (parentTopic) topics[i].parentId = parentTopic.id
    else topics[i].parentId = null
  }

  const max = opts.maxTopics ?? 200
  return capTopicsFairly(ordered, max)
}

/** Order key preferring source headings and richer titles (deterministic). */
function nameOrderKey(t: WorkingTopic): number {
  return (t.origin === 'SOURCE_HEADING' ? 0 : 1)
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
  const overlap = rangesOverlap(a, b)
  const sameSection = sameParentSection(a, b)

  if (a.origin === 'SOURCE_HEADING' && b.origin === 'SOURCE_HEADING') {
    // two source headings: only chunk continuations of the same section merge
    // (even identical titles in different sections stay separate)
    return overlap
  }

  const j = jaccard(a.tokens, b.tokens)
  if (a.origin === 'SOURCE_HEADING' || b.origin === 'SOURCE_HEADING') {
    // heading + inferred echo: must sit in the same area and be clearly the same idea
    if (!overlap) return false
    if (j >= SIMILARITY_THRESHOLD) return true
    const shorter = a.norm.length <= b.norm.length ? a.norm : b.norm
    const longer = a.norm.length <= b.norm.length ? b.norm : a.norm
    return shorter.length >= CONTAIN_MIN_LEN && longer.includes(shorter)
  }

  // both inferred: only the same area of the document may fuse — distinct
  // sections keep their own topics even when the wording is identical
  // ("Marking Scheme" in two different chapters is two different things)
  if (!(sameSection || overlap)) return false
  if (j >= SIMILARITY_THRESHOLD) return true
  // Safe containment: "eligibility" ⊂ "eligibility criteria" (same idea,
  // different extraction wording).
  const shorter = a.norm.length <= b.norm.length ? a.norm : b.norm
  const longer = a.norm.length <= b.norm.length ? b.norm : a.norm
  return shorter.length >= CONTAIN_MIN_LEN && longer.includes(shorter)
}

/** The model echoed a real section title — turn the working topic into the heading. */
function promoteToHeading(target: WorkingTopic, input: TopicInput): void {
  target.origin = 'SOURCE_HEADING'
  target.titleSource = input.titleSource ?? 'body'
  target.numbering = input.numbering ?? target.numbering
  target.tocPrintedPage = input.tocPrintedPage ?? target.tocPrintedPage
  target.tocMatchPage = input.tocMatchPage ?? target.tocMatchPage
  target.structureVerified = input.structureVerified ?? target.structureVerified
  target.anchoredPage = target.anchoredPage ?? (input.anchored ? input.unitFromPage : null)
  // the document's own wording becomes the canonical title
  const docName = String(input.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
  if (docName && docName !== target.name) {
    if (!target.aliases.includes(target.name)) target.aliases.push(target.name)
    target.name = docName
    target.norm = normalizeTitle(docName)
    target.tokens = new Set(titleTokens(docName))
    target.nameScore = titleScore(docName, true)
  }
}

function mergeInto(target: WorkingTopic, input: TopicInput, maxSubs: number): void {
  target.units.add(input.unitIndex)
  target.unitRefs.push({ unitIndex: input.unitIndex, title: input.unitTitle, fromPage: input.unitFromPage, toPage: input.unitToPage })
  target.subtopics = mergeSubtopicLists(target.subtopics, input.subtopics ?? [], maxSubs)
  target.pages = [...new Set([...target.pages, ...input.pages])].sort((a, b) => a - b)
  if (input.anchored && target.anchoredPage === null) target.anchoredPage = input.unitFromPage
  if (target.origin === 'SOURCE_HEADING') {
    target.numbering = input.numbering ?? target.numbering
    target.tocPrintedPage = input.tocPrintedPage ?? target.tocPrintedPage
    target.tocMatchPage = input.tocMatchPage ?? target.tocMatchPage
    if (input.structureVerified === false) target.structureVerified = false
  }
}

function absorbInto(target: WorkingTopic, other: WorkingTopic): void {
  // Canonical title preference: source headings always win; otherwise the
  // better-scoring variant stays and the other becomes an alias.
  const otherWins = target.origin !== 'SOURCE_HEADING' && other.origin !== 'SOURCE_HEADING' &&
    other.nameScore > target.nameScore
  if (otherWins) {
    target.aliases.push(target.name)
    target.name = other.name
    target.nameScore = other.nameScore
    target.norm = other.norm
    target.tokens = other.tokens
  } else if (target.name !== other.name) {
    target.aliases.push(other.name)
  }
  target.aliases.push(...other.aliases)
  target.subtopics = mergeSubtopicLists(target.subtopics, other.subtopics, 12)
  target.pages = [...new Set([...target.pages, ...other.pages])].sort((a, b) => a - b)
  target.anchoredPage = target.anchoredPage ?? other.anchoredPage
  for (const u of other.units) target.units.add(u)
  target.unitRefs.push(...other.unitRefs)
  // document-derived metadata survives absorption
  if (other.origin === 'SOURCE_HEADING' && target.origin !== 'SOURCE_HEADING') {
    target.origin = other.origin
    target.titleSource = other.titleSource
    target.numbering = other.numbering
    target.tocPrintedPage = other.tocPrintedPage
    target.tocMatchPage = other.tocMatchPage
    target.structureVerified = other.structureVerified
  } else if (target.origin === 'SOURCE_HEADING') {
    target.numbering = target.numbering ?? other.numbering
    target.tocPrintedPage = target.tocPrintedPage ?? other.tocPrintedPage
    target.tocMatchPage = target.tocMatchPage ?? other.tocMatchPage
    if (other.structureVerified === false) target.structureVerified = false
  }
}
