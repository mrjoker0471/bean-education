// ─── Riishe test generation: 50 challenging, VALIDATED questions ─────────────
// Pipeline (all server-side, background job):
//   1. Retrieve page-aligned sections relevant to the focus topics.
//   2. Generate per-category batches (configurable distribution) with strict
//      grounding rules — every question must cite pages + a verbatim excerpt.
//   3. Programmatic validation: structure, duplicates, evidence-in-document
//      check, page-range check.
//   4. LLM validation pass: is the keyed answer actually correct and supported?
//   5. Top-up rounds until the requested count is validated or the batch
//      budget is spent.
//   6. Publish only validated questions. Short/poor sources get a smaller
//      validated test with an honest note — never 50 unchecked outputs.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { sectionPages, type ExtractedPage } from './extract'
import { detectStructure } from './structure'
import { normalizeTitle } from './dedupe'
import { chatJson, fenceDocumentText, AI_UNAVAILABLE_MESSAGE, isRateLimitError } from './ai'
import {
  DEFAULT_DISTRIBUTION, CATEGORY_LABELS,
  type DocumentAnalysis, type GeneratedQuestion, type QuestionCategory, type RiisheTestStats,
} from './types'

const GEN_SECTION_CHARS = 4200
const BATCH_SIZE = 10
const MAX_BATCHES = 9 // generation batch budget (incl. top-ups)
const MIN_PUBLISHABLE = 4
const RATE_LIMIT_BACKOFF_MS = 15_000

/** Provider outages that make further batches pointless this run. */
function isProviderUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /empty provider|temporar|timeout|unavailable|ECONN|ENOTFOUND|network/i.test(msg)
}

interface CandidateQuestion extends GeneratedQuestion {
  sectionIdx: number
  dupKey: string
  validationNote?: string
}

// ─── Normalisation / duplicate detection ──────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(w => w.length > 2))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter)
}

/** Loose containment check for evidence: whitespace/punctuation insensitive. */
function evidenceInText(evidence: string, text: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const ev = norm(evidence)
  if (ev.length < 12) return false
  const hay = norm(text)
  if (hay.includes(ev)) return true
  // Sliding window: evidence may reflow across line breaks
  const words = ev.split(' ')
  if (words.length >= 4) {
    const half = Math.floor(words.length / 2)
    return hay.includes(words.slice(0, half).join(' ')) || hay.includes(words.slice(half).join(' '))
  }
  return false
}

// ─── Retrieval: which sections feed each batch? ────────────────────────────────

interface GenSection {
  label: string
  text: string
  fromPage: number
  toPage: number
}

/**
 * Build the generation section pool from the WHOLE document using the same
 * deterministic structure detection the analysis pipeline uses (so retrieval
 * can never be silently limited to the first few pages). When the student
 * picked focus topics, the pool leads with the ACTUAL pages those topics sit
 * on (from the verified analysis page references), padded with balanced
 * coverage so batches always have enough material.
 */
export function buildGenerationSections(
  pages: ExtractedPage[],
  numPages: number,
  analysis: DocumentAnalysis | null,
  focus: string[],
): GenSection[] {
  const readable = pages.filter(p => !p.scanned && p.text.length > 0)
  const pageByNumber = new Map(readable.map(p => [p.page, p] as const))
  const textOf = (from: number, to: number) =>
    readable
      .filter(p => p.page >= from && p.page <= to)
      .map(p => `[page ${p.page}]\n${p.text}`)
      .join('\n\n')

  const fromUnits = (): GenSection[] => {
    const structure = detectStructure(pages, numPages, { maxUnitChars: GEN_SECTION_CHARS })
    if (structure.units.length === 0) return []
    return structure.units.map(u => ({
      label: u.title ? `${u.title} — pages ${u.fromPage}${u.toPage !== u.fromPage ? `–${u.toPage}` : ''}` : u.fromPage === u.toPage ? `page ${u.fromPage}` : `pages ${u.fromPage}–${u.toPage}`,
      text: textOf(u.fromPage, u.toPage),
      fromPage: u.fromPage,
      toPage: u.toPage,
    }))
  }

  const fallbackSections = (): GenSection[] =>
    sectionPages(pages, { maxChars: GEN_SECTION_CHARS, maxSections: 400 }).map(s => ({
      label: s.label,
      text: s.text,
      fromPage: s.fromPage,
      toPage: s.toPage,
    }))

  let sections = fromUnits()
  if (sections.length === 0) sections = fallbackSections()
  if (sections.length === 0) return []

  if (focus.length > 0 && analysis?.topics?.length) {
    const normFocus = new Set(focus.map(f => normalizeTitle(f)))
    const matched = analysis.topics.filter(t =>
      normFocus.has(normalizeTitle(t.name)) ||
      (t.aliases ?? []).some(a => normFocus.has(normalizeTitle(a))),
    )
    // include children of matched sections so the focus covers the sub-topics too
    const byParent = new Map(analysis.topics.map(t => [t.id ?? '', t] as const))
    for (const t of analysis.topics) {
      if (t.parentId && byParent.get(t.parentId) && matched.some(m => m.id === t.parentId)) matched.push(t)
    }
    const pageSet = new Set<number>()
    for (const t of matched) for (const p of t.pages) if (pageByNumber.has(p)) pageSet.add(p)
    if (pageSet.size > 0) {
      // expand by one page for context, then group into contiguous runs
      for (const p of [...pageSet]) {
        if (pageByNumber.has(p - 1)) pageSet.add(p - 1)
        if (pageByNumber.has(p + 1)) pageSet.add(p + 1)
      }
      const sorted = [...pageSet].sort((a, b) => a - b)
      const runs: { from: number; to: number }[] = []
      for (const p of sorted) {
        const last = runs[runs.length - 1]
        if (last && p <= last.to + 1) last.to = p
        else runs.push({ from: p, to: p })
      }
      const focusSections: GenSection[] = runs
        .map(r => ({
          label: r.from === r.to ? `page ${r.from}` : `pages ${r.from}–${r.to}`,
          text: textOf(r.from, r.to).slice(0, GEN_SECTION_CHARS * 2),
          fromPage: r.from,
          toPage: r.to,
        }))
        .filter(s => s.text.length > 0)
      const totalChars = focusSections.reduce((s, x) => s + x.text.length, 0)
      if (focusSections.length > 0 && totalChars >= 1500) {
        // top up with balanced coverage if the focus area is thin
        const out = [...focusSections]
        let chars = totalChars
        for (const sec of sections) {
          if (chars >= 6000) break
          if (out.some(o => o.fromPage <= sec.toPage && sec.fromPage <= o.toPage)) continue
          out.push(sec)
          chars += sec.text.length
        }
        return out
      }
    }
  }
  return sections
}

function scoreSection(sectionText: string, focus: string[]): number {
  if (focus.length === 0) return 0
  const hay = normalize(sectionText)
  let score = 0
  for (const f of focus) {
    const nf = normalize(f)
    if (nf && hay.includes(nf)) score += 2
    for (const w of nf.split(' ')) {
      if (w.length > 4 && hay.includes(w)) score += 1
    }
  }
  return score
}

function pickSections(
  sections: GenSection[],
  focus: string[],
  cursor: { i: number },
  count: number,
): GenSection[] {
  if (focus.length > 0) {
    const ranked = [...sections].sort((a, b) => scoreSection(b.text, focus) - scoreSection(a.text, focus))
    const top = ranked.slice(0, count)
    if (scoreSection(top[top.length - 1]?.text ?? '', focus) > 0) return top
  }
  // Balanced round-robin over the document
  const out: typeof sections = []
  for (let k = 0; k < count && sections.length > 0; k++) {
    out.push(sections[cursor.i % sections.length])
    cursor.i++
  }
  return out
}

// ─── Generation prompts ────────────────────────────────────────────────────────

const CATEGORY_RULES: Record<QuestionCategory, string> = {
  FOUNDATION: `Test direct conceptual understanding of definitions, core ideas and classifications from the material. Clear, factual, unambiguous stems. Difficulty: mostly EASY/MEDIUM with 1-2 HARD.`,
  APPLICATION: `Apply concepts from the material to NEW situations, examples, cases or short problems the student has not seen verbatim. Require a reasoning step, not recall. Difficulty: mostly MEDIUM/HARD.`,
  STATEMENT: `Use statement-based formats: give 2-3 numbered statements and ask which are correct (e.g. "Which of the following statements are correct?"), OR comparison questions between two concepts from the material, OR assertion/reasoning pairs where the subject suits it. Difficulty: MEDIUM/HARD.`,
  MULTISTEP: `Multi-step reasoning, scenario analysis, or calculation questions ONLY where the material provides enough data/rules. The stem may set up a situation requiring 2-3 chained inferences. Difficulty: HARD-leaning.`,
  MISCONCEPTION: `Target the misconceptions/ traps documented in the material: options must include the specific wrong belief as a plausible distractor alongside the correct answer. The question must still be fair and answerable purely from the material. Difficulty: MEDIUM/HARD.`,
}

function generationPrompt(opts: {
  category: QuestionCategory
  count: number
  sections: { label: string; text: string }[]
  focus: string[]
  avoid: string[]
  examLabel: string | null
  questionPaper?: boolean
}): string {
  const docText = opts.sections
    .map(s => `--- SOURCE EXCERPT (${s.label}) ---\n${s.text}`)
    .join('\n\n')
  return `You are Riishe, the exam-question engine inside BEAN EXAMS. Generate EXACTLY ${opts.count} challenging multiple-choice questions of the category "${CATEGORY_LABELS[opts.category]}" for an Indian competitive-exam student${opts.examLabel ? ` preparing for ${opts.examLabel}` : ''}.

${CATEGORY_RULES[opts.category]}

STRICT GROUNDING RULES:
- Every question, every option and the correct answer MUST be supported by the SOURCE EXCERPTS below. Do not use outside facts.
- "evidence" = a verbatim quote (max 300 characters) copied EXACTLY from the excerpts that supports the correct answer.
- "pageRefs" = the [page N] numbers whose excerpts support the answer.
- If the excerpts don't contain enough for ${opts.count} good questions, generate fewer — quality over quantity.
- 4 options each, exactly ONE correct. Distractors must be plausible (same topic, subtle differences) but clearly wrong to someone who knows the material.
- "topic" = the specific subtopic this question tests.
- Language: clear English, exam-style stems, no ambiguity, no trick wording that punishes careful readers.
- Vary stems; do not reword the same question twice.
${opts.questionPaper ? '\nNOTE: this source is a question paper / marks scheme. Use its questions to inform the STYLE and difficulty of your questions only — factual support still comes from the content the paper itself contains (its questions, options, instructions and data). Never treat a question\'s wording as evidence for a fact.' : ''}
${opts.focus.length ? `\nThe student asked to focus on: ${opts.focus.join('; ')}. Skip content unrelated to these topics.` : ''}
${opts.avoid.length ? `\nDo NOT duplicate or reword these existing question stems:\n${opts.avoid.map(a => `- ${a}`).join('\n')}` : ''}

${fenceDocumentText('student study material', docText)}

Return ONLY a JSON array; each element:
{"text": string, "options": [string, string, string, string], "correctIndex": 0|1|2|3, "explanation": string, "difficulty": "EASY"|"MEDIUM"|"HARD", "topic": string, "pageRefs": number[], "evidence": string}

"explanation" must teach: why the correct answer is right AND why the tempting wrong options fail (2-4 sentences).`
}

interface RawQuestion {
  text?: string
  options?: string[]
  correctIndex?: number
  explanation?: string
  difficulty?: string
  topic?: string
  pageRefs?: number[]
  evidence?: string
}

interface ValidationVerdict {
  index: number
  verdict: 'VALID' | 'INVALID'
  note?: string
}

// ─── Programmatic validation ───────────────────────────────────────────────────

function programmaticValidate(
  raw: RawQuestion,
  category: QuestionCategory,
  sections: { text: string; fromPage: number; toPage: number }[],
): CandidateQuestion | { reject: string } {
  const text = String(raw.text ?? '').trim()
  const options = (raw.options ?? []).map(o => String(o ?? '').trim())
  const correctIndex = Number(raw.correctIndex)
  const explanation = String(raw.explanation ?? '').trim()
  const evidence = String(raw.evidence ?? '').trim()
  const pageRefs = (raw.pageRefs ?? []).map(Number).filter(n => Number.isFinite(n))
  const difficulty = ['EASY', 'MEDIUM', 'HARD'].includes(String(raw.difficulty)) ? String(raw.difficulty) : 'MEDIUM'
  const topic = String(raw.topic ?? '').trim().slice(0, 120) || 'General'

  if (text.length < 20 || text.length > 800) return { reject: 'stem too short/long' }
  if (options.length !== 4 || options.some(o => o.length === 0 || o.length > 300)) return { reject: 'options invalid' }
  const normed = options.map(o => normalize(o))
  if (new Set(normed).size !== 4) return { reject: 'duplicate options' }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) return { reject: 'bad correctIndex' }
  if (explanation.length < 40) return { reject: 'explanation too thin' }
  if (!evidence) return { reject: 'no evidence' }
  if (evidence.length > 600) return { reject: 'evidence too long' }

  // Evidence must actually exist in the fed sections (grounding check)
  const covered = sections.find(s => evidenceInText(evidence, s.text))
  if (!covered) return { reject: 'evidence not found in source text' }
  // Page refs must point into the fed section range
  const validPages = pageRefs.filter(p => covered.fromPage <= p && p <= covered.toPage)
  if (validPages.length === 0) return { reject: 'page refs out of range' }

  return {
    text, options, correctIndex, explanation,
    difficulty: difficulty as GeneratedQuestion['difficulty'],
    category, topic, pageRefs: validPages, evidence,
    sectionIdx: sections.indexOf(covered),
    dupKey: normalize(text).slice(0, 140),
  }
}

// ─── The job ───────────────────────────────────────────────────────────────────

export async function generateTestJob(testId: string): Promise<void> {
  const test = await db.riisheTest.findUnique({ where: { id: testId }, include: { document: true } })
  if (!test || !['QUEUED', 'FAILED'].includes(test.status)) return
  const doc = test.document
  if (!doc || doc.status !== 'READY' || !doc.extractionJson) {
    await db.riisheTest.update({
      where: { id: testId },
      data: { status: 'FAILED', statusDetail: 'The document is not analysed yet. Wait for processing to finish, then try again.' },
    })
    return
  }

  await db.riisheTest.update({
    where: { id: testId },
    data: { status: 'GENERATING', statusDetail: 'Selecting relevant sections…', updatedAt: new Date() },
  })

  const pages = safeParse(doc.extractionJson, [] as ExtractedPage[])
  const analysis = safeParse<DocumentAnalysis | null>(doc.analysisJson, null)
  const focus = safeParse<string[]>(test.focusTopicsJson ?? '[]', []).filter(Boolean)

  // Whole-document, structure-aware retrieval (never limited to the first pages)
  const sections = buildGenerationSections(pages, doc.pageCount ?? pages.length, analysis, focus)
  if (sections.length === 0) {
    await db.riisheTest.update({
      where: { id: testId },
      data: { status: 'FAILED', statusDetail: 'The document has no analysable text, so questions cannot be generated from it.' },
    })
    return
  }

  // Distribution: focus tests may compress the mix, balanced tests use the default
  const requested = Math.min(50, Math.max(4, test.requestedCount || 50))
  const dist: Record<QuestionCategory, number> = { ...DEFAULT_DISTRIBUTION }
  if (requested !== 50) {
    const scale = requested / 50
    for (const k of Object.keys(dist) as QuestionCategory[]) dist[k] = Math.max(1, Math.round(dist[k] * scale))
  }
  const focusCat: QuestionCategory[] = focus.length > 0
    ? ['FOUNDATION', 'APPLICATION', 'STATEMENT', 'MULTISTEP', 'MISCONCEPTION']
    : ['FOUNDATION', 'APPLICATION', 'STATEMENT', 'MULTISTEP', 'MISCONCEPTION']

  // Build the initial batch plan (category → chunk of ≤ BATCH_SIZE)
  const plan: { category: QuestionCategory; count: number }[] = []
  for (const cat of focusCat) {
    let remaining = dist[cat]
    while (remaining > 0) {
      plan.push({ category: cat, count: Math.min(BATCH_SIZE, remaining) })
      remaining -= BATCH_SIZE
    }
  }

  const candidates: CandidateQuestion[] = []
  const seenKeys = new Set<string>()
  let llmCalls = 0
  let batches = 0
  let providerFailed = false
  /** true when batches were refused by rate limiting — the failure message must
   *  say so instead of falsely claiming the document lacks content. */
  let providerThrottled = false

  const cursor = { i: 0 }

  const runBatch = async (category: QuestionCategory, count: number): Promise<void> => {
    if (batches >= MAX_BATCHES) return
    batches++
    const secs = pickSections(sections, focus, cursor, category === 'MISCONCEPTION' ? 3 : 2)
    const avoid = candidates.slice(-30).map(c => c.text.slice(0, 90))
    const callGenerate = async (): Promise<RawQuestion[]> => {
      llmCalls++
      const raws = await chatJson<RawQuestion[]>({
        system: 'You are Riishe, a meticulous exam-question generator. Output only valid JSON.',
        user: generationPrompt({
          category, count,
          sections: secs.map(s => ({ label: s.label, text: s.text })),
          focus, avoid,
          examLabel: doc.examLabel,
          questionPaper: analysis?.structure?.kind === 'QUESTION_PAPER',
        }),
      })
      return Array.isArray(raws) ? raws : []
    }
    let raws: RawQuestion[]
    try {
      raws = await callGenerate()
    } catch (err) {
      if (isRateLimitError(err)) {
        // One bounded backoff per batch — sustained throttling still ends the
        // run honestly (see the publish message), it is never hidden.
        providerThrottled = true
        console.warn('[riishe generate] rate limited — backing off 15s once')
        await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS))
        try {
          raws = await callGenerate()
        } catch (err2) {
          providerFailed = providerFailed || isProviderUnavailable(err2)
          console.error('[riishe generate] batch failed after rate-limit backoff:', err2)
          return
        }
      } else {
        if (isProviderUnavailable(err)) providerFailed = true
        console.error('[riishe generate] batch failed:', err)
        return
      }
    }

    // Programmatic validation
    const passed: CandidateQuestion[] = []
    for (const raw of raws) {
      const v = programmaticValidate(raw, category, secs)
      if ('reject' in v) continue
      if (seenKeys.has(v.dupKey)) continue
      // Near-duplicate check against everything so far
      const tokens = tokenSet(v.text)
      if (candidates.some(c => jaccard(tokenSet(c.text), tokens) > 0.78)) continue
      seenKeys.add(v.dupKey)
      candidates.push(v)
      passed.push(v)
    }

    // LLM validation pass over the survivors of this batch
    if (passed.length > 0) {
      try {
        llmCalls++
        const verdicts = await chatJson<ValidationVerdict[]>({
          system: 'You are Riishe\'s question validator. You verify MCQs against source text. Output only valid JSON.',
          user: `Verify each question below against the SOURCE EXCERPTS. Check: (1) the keyed answer is factually correct per the source, (2) exactly one clearly correct option, (3) distractors are wrong, (4) the stem is clear and answerable from the source alone.

Return a JSON array: [{"index": <position in the list starting at 0>, "verdict": "VALID"|"INVALID", "note": short reason}]

${fenceDocumentText('student study material', secs.map(s => `--- (${s.label}) ---\n${s.text}`).join('\n\n'))}

QUESTIONS:
${passed.map((q, i) => `Q${i}. ${q.text}\nOptions: ${q.options.map((o, j) => `${'ABCD'[j]}. ${o}`).join(' | ')}\nKeyed correct: ${'ABCD'[q.correctIndex]}\nEvidence: "${q.evidence.slice(0, 250)}"`).join('\n\n')}`,
        })
        const byIndex = new Map<number, ValidationVerdict>()
        for (const v of (Array.isArray(verdicts) ? verdicts : [])) {
          if (v && typeof v.index === 'number') byIndex.set(v.index, v)
        }
        for (let i = passed.length - 1; i >= 0; i--) {
          const verdict = byIndex.get(i)
          const q = passed[i]
          const idx = candidates.indexOf(q)
          if (verdict?.verdict === 'INVALID') {
            if (idx >= 0) candidates.splice(idx, 1)
          } else if (verdict?.note) {
            q.validationNote = String(verdict.note).slice(0, 200)
          }
        }
      } catch { /* validator failure keeps the programmatic verdicts — honest middle ground */ }
    }
  }

  // Initial batches
  for (const step of plan) {
    if (countValid() >= requested) break
    await runBatch(step.category, step.count)
    await db.riisheTest.update({
      where: { id: testId },
      data: { statusDetail: `Generated ${candidates.length} candidate questions so far…` },
    }).catch(() => {})
  }

  // Top-up rounds (categories with the largest deficits first)
  let guard = 0
  while (countValid() < requested && batches < MAX_BATCHES && guard < 4 && !providerFailed) {
    guard++
    const deficit = categoryDeficit(dist, candidates, requested)
    const cat = deficit[0]?.category ?? 'APPLICATION'
    await runBatch(cat, Math.min(BATCH_SIZE, requested - countValid()))
  }

  function countValid(): number {
    return candidates.length
  }

  // ── Publish ──
  const published = candidates.slice(0, requested)
  if (published.length < MIN_PUBLISHABLE) {
    const throttleNote = providerThrottled
      ? 'The AI provider kept rate-limiting generation, so no validated questions could be produced yet — this says nothing about the document itself. Your analysis is safe; please try generating again in a few minutes.'
      : `Only ${published.length} question${published.length === 1 ? '' : 's'} passed validation — the document does not contain enough reliable, testable content for a full test. Try a more detailed document or a different topic.`
    await db.riisheTest.update({
      where: { id: testId },
      data: {
        status: 'FAILED',
        statusDetail: providerFailed
          ? `Question generation failed: ${AI_UNAVAILABLE_MESSAGE}`
          : throttleNote,
        statsJson: JSON.stringify(statsSnapshot(candidates, llmCalls, batches)),
      },
    })
    return
  }

  // Persist questions + publish
  await db.riisheQuestion.deleteMany({ where: { testId } })
  const rows = published.map((q, i) => ({
    testId,
    documentId: doc.id,
    order: i + 1,
    text: q.text,
    optionsJson: JSON.stringify(q.options),
    correctIndex: q.correctIndex,
    explanation: q.explanation,
    difficulty: q.difficulty,
    category: q.category,
    topic: q.topic,
    pageRefsJson: JSON.stringify(q.pageRefs),
    evidence: q.evidence.slice(0, 600),
    status: 'VALIDATED',
    validationNote: q.validationNote ?? null,
  }))
  await db.riisheQuestion.createMany({ data: rows })
  const saved = await db.riisheQuestion.findMany({ where: { testId }, select: { id: true }, orderBy: { order: 'asc' } })

  const rejected = llmCalls > 0 ? Math.max(0, batches * BATCH_SIZE - candidates.length) : 0
  const honestNote = published.length < requested
    ? providerThrottled
      ? `${published.length} of the requested ${requested} questions validated — the AI provider rate-limited some batches, so the test is smaller than requested. Try generating again later for more.`
      : `${published.length} of the requested ${requested} questions validated — the material supports a test of this size.`
    : null

  await db.riisheTest.update({
    where: { id: testId },
    data: {
      status: 'READY',
      statusDetail: honestNote,
      questionIdsJson: JSON.stringify(saved.map(q => q.id)),
      statsJson: JSON.stringify(statsSnapshot(published, llmCalls, batches, rejected)),
    },
  })

  function statsSnapshot(list: CandidateQuestion[], calls: number, batchCount: number, rejectedCount?: number): RiisheTestStats {
    const byCategory: RiisheTestStats['byCategory'] = {}
    const byDifficulty = { EASY: 0, MEDIUM: 0, HARD: 0 }
    for (const q of list) {
      byCategory[q.category] = (byCategory[q.category] ?? 0) + 1
      byDifficulty[q.difficulty as 'EASY' | 'MEDIUM' | 'HARD']++
    }
    return {
      generated: list.length,
      validated: list.length,
      rejected: rejectedCount ?? Math.max(0, batchCount * BATCH_SIZE - list.length),
      byCategory,
      byDifficulty,
      llmCalls: calls,
      batches: batchCount,
    }
  }

  function categoryDeficit(distMap: Record<QuestionCategory, number>, list: CandidateQuestion[], total: number): { category: QuestionCategory; deficit: number }[] {
    return (Object.keys(distMap) as QuestionCategory[])
      .map(cat => ({ category: cat, deficit: Math.round(distMap[cat] / 50 * total) - list.filter(q => q.category === cat).length }))
      .sort((a, b) => b.deficit - a.deficit)
  }
}
