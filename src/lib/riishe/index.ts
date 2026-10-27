// ─── Riishe section index: searchable retrieval over page-aligned sections ───
// A lightweight TF-weighted inverted index built once per job from the
// document's sections. Generation and explanation jobs use it to retrieve the
// most relevant excerpts for a topic focus instead of naive string scans, so
// questions are generated from the passages that actually discuss the topic.

import type { DocSection } from './extract'

const STOPWORDS = new Set(
  ('a an and are as at be by for from has have in into is it its of on or that the to was were will with this these those ' +
   'their there than then they them under upon which who whose what when where why how not no nor but if while about above ' +
   'after all also any because been before being between both can cannot could did do does down during each few more most ' +
   'other over own same some such only very just etc').split(' '),
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && w.length < 40 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

export interface IndexedSection extends DocSection {
  /** token → term frequency */
  tf: Map<string, number>
  /** unique token count (length normaliser) */
  length: number
}

export class SectionIndex {
  readonly sections: IndexedSection[]
  /** token → number of sections containing it */
  private df: Map<string, number>

  constructor(sections: DocSection[]) {
    this.sections = sections.map(s => {
      const tf = new Map<string, number>()
      for (const w of tokenize(s.text)) tf.set(w, (tf.get(w) ?? 0) + 1)
      return { ...s, tf, length: tf.size }
    })
    this.df = new Map()
    for (const s of this.sections) {
      for (const w of s.tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1)
    }
  }

  /** Score one query phrase against one section (sum of IDF-weighted TF). */
  private scoreSection(section: IndexedSection, queryTokens: string[]): number {
    if (queryTokens.length === 0 || section.length === 0) return 0
    let score = 0
    for (const w of queryTokens) {
      const f = section.tf.get(w)
      if (!f) continue
      const idf = Math.log(1 + this.sections.length / (this.df.get(w) ?? 1))
      // Squashed TF to avoid very long sections dominating
      score += idf * (1 + Math.log(f))
      // Exact phrase bonus
      if (section.text.toLowerCase().includes(w)) score += 0.25
    }
    // Small length normalisation
    return score / Math.sqrt(section.length)
  }

  /**
   * Retrieve the top-k sections for a set of focus phrases (topic names).
   * Phrases are matched on their tokens AND as substrings (multi-word topic
   * names like "Examination Scheme" score high when the phrase appears).
   */
  retrieve(focus: string[], k: number): IndexedSection[] {
    return this.retrieveWithScores(focus, k).map(x => x.section)
  }

  /**
   * Same ranking as {@link retrieve}, but the relevance score travels with the
   * result so callers can tell a real match apart from an arbitrary top-k of
   * zero-score sections. Callers use this to keep unrelated questions out of
   * the grounding window instead of pretending the material covers them.
   */
  retrieveWithScores(focus: string[], k: number): { section: IndexedSection; score: number }[] {
    if (this.sections.length === 0) return []
    const focusClean = focus.map(f => f.trim()).filter(Boolean)
    if (focusClean.length === 0) return this.sections.map(s => ({ section: s, score: 0 }))

    const scored = this.sections.map(s => {
      const hay = s.text.toLowerCase()
      let score = 0
      for (const phrase of focusClean) {
        const phraseTokens = tokenize(phrase)
        score += this.scoreSection(s, phraseTokens)
        // Whole-phrase substring match is a strong signal
        const np = phrase.toLowerCase()
        if (np.length >= 6 && hay.includes(np)) score += 6
      }
      return { section: s, score }
    })
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, Math.max(1, k))
  }

  /**
   * Best-effort verbatim snippet from a page's text for a phrase (used to keep
   * evidence quotes short and on-page). Returns null when nothing matches.
   */
  static bestSnippet(pageText: string, phrase: string, maxLen = 280): string | null {
    const hay = pageText.toLowerCase()
    const np = phrase.toLowerCase().trim()
    if (!np) return null
    const idx = hay.indexOf(np)
    if (idx === -1) {
      // Fall back to first query token
      const tokens = tokenize(np)
      if (tokens.length === 0) return null
      const ti = hay.indexOf(tokens[0])
      if (ti === -1) return null
      const start = Math.max(0, ti - 80)
      return pageText.slice(start, start + maxLen).trim()
    }
    const start = Math.max(0, idx - 100)
    return pageText.slice(start, start + maxLen).trim()
  }
}
