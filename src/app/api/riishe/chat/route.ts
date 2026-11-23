import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { safeParse } from '@/lib/serialize'
import { chat, fenceDocumentText, parseSourceTag, flagsOutsideMaterial, stylePrompt, webSearch, TIME_SENSITIVE_RE, type WebResult, type SourceState } from '@/lib/riishe/ai'
import { buildLearningDigest } from '@/lib/learning/insights'
import { assertLearningOwner } from '@/lib/learning/scope'
import {
  RIISHE_TUTOR_MODES,
  RIISHE_RESPONSE_LANGUAGES,
  DEFAULT_TUTOR_MODE,
  tutorModePrompt,
  responseLanguagePrompt,
  learnerAdaptationPrompt,
  type RiisheTutorMode,
  type RiisheResponseLanguage,
} from '@/lib/riishe/tutor'
import { disclosureLine } from '@/lib/riishe/disclosures'
import { sectionPages, type ExtractedPage } from '@/lib/riishe/extract'
import { SectionIndex } from '@/lib/riishe/index'
import type { RiisheChatSourceDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─── Lightweight in-memory rate limit: 20 chats / 10 min / guest ─────────────
const RATE = { windowMs: 10 * 60_000, max: 20 }
const rateMap = new Map<string, number[]>()
function rateLimited(guestId: string): boolean {
  const now = Date.now()
  const arr = (rateMap.get(guestId) ?? []).filter(t => now - t < RATE.windowMs)
  if (arr.length >= RATE.max) return true
  arr.push(now)
  rateMap.set(guestId, arr)
  return false
}

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(6000),
})

/** Sections must show at least this much query signal to enter the grounding
 *  window. Zero-signal sections are noise, not grounding — including them made
 *  every question look "in scope" and invited mis-citation. */
const MIN_RELEVANCE = 0.05

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  messages: z.array(messageSchema).min(1).max(24),
  /** Document-scoped chat (workspace). */
  documentId: z.string().optional(),
  /** Explicit material scope from the hub chat's document selector (1–8 docs). */
  documentIds: z.array(z.string().min(1).max(64)).max(8).optional(),
  /** Per-question review chat — full context loaded server-side. */
  attemptId: z.string().optional(),
  questionId: z.string().optional(),
  /** Topic focus (discovered topic / chapter name) — steers retrieval only. */
  topic: z.string().max(160).optional(),
  /** Presentation style — depth/wording only, never the sources. */
  style: z.enum(['exam-focused', 'simple', 'detailed']).optional(),
  /** Phase 3C — teaching mode: how Riishe teaches, never what it may claim. */
  tutorMode: z.enum(RIISHE_TUTOR_MODES).optional(),
  /** Phase 3C — response language; omitted/'auto' preserves the existing default. */
  responseLanguage: z.enum(RIISHE_RESPONSE_LANGUAGES).optional(),
})

/** Legacy rows may carry 'external' or null — both display honestly as general knowledge. */
function normalizeGrounding(raw: string | null | undefined): 'document' | 'mixed' | 'general' | null {
  if (raw === 'document' || raw === 'mixed' || raw === 'general') return raw
  return 'general'
}

interface ChatTurnDTO {
  id: string
  role: 'user' | 'assistant'
  content: string
  pagesCited: number[]
  grounding: 'document' | 'mixed' | 'general' | null
  sources: RiisheChatSourceDTO[]
  /** Phase 3D: teaching preference in force for this assistant turn
   *  (null = user turn or legacy row → the client falls back to EXPLAIN). */
  tutorMode: RiisheTutorMode | null
  /** Phase 3D: response language in force for this assistant turn
   *  (null = user turn or legacy row → the client falls back to 'auto'). */
  responseLanguage: RiisheResponseLanguage | null
  createdAt: string
}

/** Legacy rows may carry unknown or missing preference values — both display
 *  honestly as the documented defaults (EXPLAIN / auto) on the client. */
function normalizeTutorMode(raw: string | null | undefined): RiisheTutorMode | null {
  return (RIISHE_TUTOR_MODES as readonly string[]).includes(raw ?? '') ? (raw as RiisheTutorMode) : null
}
function normalizeResponseLanguage(raw: string | null | undefined): RiisheResponseLanguage | null {
  return (RIISHE_RESPONSE_LANGUAGES as readonly string[]).includes(raw ?? '') ? (raw as RiisheResponseLanguage) : null
}

// GET — load the persisted conversation (owner only, newest last)
export async function GET(req: NextRequest) {
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams)
    const parsed = z.object({
      guestId: z.string().min(8).max(64),
      documentId: z.string().optional(),
      attemptId: z.string().optional(),
      questionId: z.string().optional(),
    }).safeParse(params)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, documentId, attemptId, questionId } = parsed.data

    // Phase 3D.1: the persisted conversation is protected history — verify
    // account ownership of a claimed guest identity BEFORE any database read.
    // Same guard contract as the learning routes: an unauthenticated guest whose
    // session resolution completes keeps the guest-bearer contract; a signed-in
    // claimant keeps access; a foreign signed-in account gets 403; a session or
    // claim-lookup failure fails CLOSED with the generic 503 (never guest
    // access, never an "unclaimed" fallback). The response carries only the
    // guard's generic error text — no turn contents, preference metadata or
    // account details. tutorMode/responseLanguage metadata is presentation
    // state only and never authorizes this read.
    const owner = await assertLearningOwner(guestId)
    if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

    const where: Record<string, unknown> = { guestId }
    if (attemptId && questionId) {
      where.attemptId = attemptId
      where.questionId = questionId
    } else if (documentId) {
      where.documentId = documentId
      where.attemptId = null
    } else {
      where.documentId = null
      where.attemptId = null
    }

    const turns = await db.riisheChatTurn.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 30,
    })
    const ordered = turns.reverse()

    const list: ChatTurnDTO[] = ordered.map(t => ({
      id: t.id,
      role: t.role as 'user' | 'assistant',
      content: t.content,
      pagesCited: safeParse<number[]>(t.pagesCitedJson ?? '[]', []),
      grounding: t.role === 'assistant' ? normalizeGrounding(t.grounding) : null,
      sources: t.role === 'assistant' ? safeParse<RiisheChatSourceDTO[]>(t.sourcesJson ?? '[]', []) : [],
      // Phase 3D: preference metadata rides only on assistant turns; anything
      // unknown or missing normalises to null (client default EXPLAIN / auto).
      tutorMode: t.role === 'assistant' ? normalizeTutorMode(t.tutorMode) : null,
      responseLanguage: t.role === 'assistant' ? normalizeResponseLanguage(t.responseLanguage) : null,
      createdAt: t.createdAt.toISOString(),
    }))
    return NextResponse.json({ turns: list })
  } catch (err) {
    console.error('[api/riishe/chat GET]', err)
    return NextResponse.json({ error: 'Failed to load the conversation' }, { status: 500 })
  }
}

/** Normalised text used for verbatim-containment checks between a reply and a source window. */
function normalizeForContainment(text: string): string {
  return text.toLowerCase().replace(/\[page \d+\]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** True when the reply quotes a source window verbatim (≥ 60 normalized chars). */
function replyQuotesWindow(reply: string, windowText: string): boolean {
  const normReply = normalizeForContainment(reply)
  const normWindow = normalizeForContainment(windowText)
  if (normReply.length < 60 || normWindow.length < 60) return false
  // Check reply sentences (and sliding chunks) against the window text.
  const sentences = normReply.split(/(?<=[.!?])\s+/).filter(s => s.length >= 60)
  for (const s of sentences) {
    if (normWindow.includes(s)) return true
  }
  return false
}

// POST — ask Riishe a follow-up question (document-grounded when possible)
export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, messages, documentId, documentIds, attemptId, questionId, topic, style, tutorMode, responseLanguage } = parsed.data
    // Teaching mode defaults to EXPLAIN when the client does not send one.
    const effectiveTutorMode: RiisheTutorMode = tutorMode ?? DEFAULT_TUTOR_MODE

    if (rateLimited(guestId)) {
      return NextResponse.json({ error: 'You are sending questions very quickly — please wait a minute and try again.' }, { status: 429 })
    }

    // ── Ownership checks (never answer across accounts) ──
    let questionContext = ''
    let questionEvidence: { documentId: string; title: string; pages: number[]; excerpt: string } | null = null
    let groundingDocIds: string[] = []
    // Pages the reviewed question itself cites — always part of the window
    let pinnedPagesByDoc = new Map<string, Set<number>>()
    let isPerQuestion = false
    if (attemptId && questionId) {
      isPerQuestion = true
      const attempt = await db.attempt.findUnique({ where: { id: attemptId } })
      if (!attempt || attempt.guestId !== guestId || attempt.source !== 'RIISHE') {
        return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
      }
      const questionIds = safeParse<string[]>(attempt.questionIdsJson, [])
      if (!questionIds.includes(questionId)) {
        return NextResponse.json({ error: 'Question not found' }, { status: 404 })
      }
      const q = await db.riisheQuestion.findUnique({ where: { id: questionId } })
      if (!q) return NextResponse.json({ error: 'Question not found' }, { status: 404 })
      const answers = safeParse<Record<string, number>>(attempt.answersJson ?? '{}', {})
      const selected = answers[q.id]
      const explanation = await db.riisheExplanation.findUnique({
        where: { attemptId_questionId: { attemptId, questionId } },
      })
      const payload = explanation?.status === 'READY' ? safeParse<Record<string, unknown>>(explanation.payloadJson ?? '{}', {}) : null
      // Pin the question's own evidence pages so the tutor always sees them
      const qRefs = safeParse<number[]>(q.pageRefsJson ?? '[]', [])
      if (qRefs.length > 0) pinnedPagesByDoc.set(q.documentId, new Set(qRefs))
      questionContext = [
        `The student is reviewing this practice question:`,
        `Question: ${q.text}`,
        `Options: ${safeParse<string[]>(q.optionsJson, []).map((o, i) => `${'ABCD'[i]}. ${o}`).join(' | ')}`,
        `Correct answer: ${'ABCD'[q.correctIndex]}. ${q.explanation}`,
        `Student's answer: ${selected === undefined || selected < 0 ? 'no answer (skipped)' : `${'ABCD'[selected]}. ${safeParse<string[]>(q.optionsJson, [])[selected] ?? ''}`} — ${selected === q.correctIndex ? 'correct' : 'incorrect'}`,
        `Evidence recorded for this question: "${(q.evidence ?? '').slice(0, 300)}" (source pages: ${safeParse<number[]>(q.pageRefsJson ?? '[]', []).join(', ') || 'none'})`,
        payload ? `Already-shown explanation: ${String(payload.correctReasoning ?? '').slice(0, 600)}` : '',
        `Answer follow-up questions about THIS question from its source document. When you explain why an option is right or wrong, answer from the recorded evidence and cite its source pages. If part of your explanation is not supported by the material, say so explicitly. The question and the option text stay in front of you — never lose them when the follow-up is short ("why?", "explain step by step").`,
      ].filter(Boolean).join('\n')
      groundingDocIds = [...new Set([q.documentId])]
      // The question's own recorded evidence is always a citable source — even
      // when it carries no page refs (then the panel shows it without chips).
      questionEvidence = {
        documentId: q.documentId,
        title: '', // filled after doc lookup below
        pages: qRefs.length > 0 ? [Math.min(...qRefs), Math.max(...qRefs)] : [],
        excerpt: (q.evidence ?? q.explanation ?? '').slice(0, 260),
      }
    } else if (documentId) {
      const doc = await db.studyDocument.findUnique({ where: { id: documentId }, select: { id: true, guestId: true } })
      if (!doc || doc.guestId !== guestId) {
        return NextResponse.json({ error: 'Material not found' }, { status: 404 })
      }
      groundingDocIds = [documentId]
    } else if (documentIds && documentIds.length > 0) {
      // Hub chat with an explicit material scope. Every id must belong to the
      // student and be analysable — stranger or unknown ids are a 404, never a
      // silent fallback to a wider (or someone else's) context.
      const docs = await db.studyDocument.findMany({
        where: { id: { in: documentIds }, guestId },
        select: { id: true, status: true },
      })
      const usable = docs.filter(d => d.status === 'READY')
      if (usable.length === 0) {
        return NextResponse.json({ error: 'Material not found' }, { status: 404 })
      }
      groundingDocIds = usable.map(d => d.id)
    } else {
      // Hub chat, whole library: ground across the guest's READY documents (bounded)
      const ready = await db.studyDocument.findMany({
        where: { guestId, status: 'READY' },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      })
      groundingDocIds = ready.map(d => d.id)
    }

    // ── Build the grounded retrieval window from the documents ──
    // Follow-up inheritance: the retrieval query carries the current question
    // AND the previous user turn, so short follow-ups ("why?") still retrieve
    // what the conversation is actually about. The topic focus always rides along.
    const userMsgs = messages.filter(m => m.role === 'user')
    const lastUser = userMsgs[userMsgs.length - 1]?.content ?? ''
    const prevUser = userMsgs.length > 1 ? userMsgs[userMsgs.length - 2]?.content ?? '' : ''
    // The previous assistant answer anchors short follow-ups ("explain the
    // second point", "why?") to what the conversation is actually about.
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')?.content ?? ''
    const retrievalQuery = [lastUser, prevUser].filter(Boolean).join(' ').slice(0, 1200)

    interface GroundWindow { label: string; text: string; docId: string; docTitle: string; fromPage: number; toPage: number }
    const windows: GroundWindow[] = []
    let maxPageOf: Map<string, number> = new Map()
    const docTitleOf = new Map<string, string>()
    if (groundingDocIds.length > 0) {
      const docs = await db.studyDocument.findMany({ where: { id: { in: groundingDocIds } } })
      const perDoc = Math.max(3, Math.floor(30 / Math.max(1, docs.length)))
      type PageRec = ExtractedPage
      for (const d of docs) {
        docTitleOf.set(d.id, d.title)
        const pages = safeParse<PageRec[]>(d.extractionJson ?? '[]', []).filter(p => p.outcome === 'extracted' || (!p.outcome && p.chars > 0))
        maxPageOf.set(d.id, d.pageCount ?? pages.reduce((m, p) => Math.max(m, p.page), 0))
        if (pages.length === 0) continue
        const secs = sectionPages(pages, { maxChars: 5000, maxSections: perDoc })
        const index = secs.length > 0 ? new SectionIndex(secs) : null
        const phrases = [retrievalQuery, topic, lastAssistant.slice(0, 400)]
          .map(s => (s ?? '').trim())
          .filter((s): s is string => s.length > 0)
        const scored = index && phrases.length > 0 ? index.retrieveWithScores(phrases, 8) : []
        // Relevance floor: sections that matched nothing stay out of the
        // grounding window — the model must never receive filler excerpts that
        // make an unrelated question look in-scope.
        const top = scored.filter(x => x.score >= MIN_RELEVANCE).slice(0, 3).map(x => x.section)
        const seen = new Set<string>()
        for (const s of top) {
          seen.add(s.label)
          windows.push({
            label: `${d.title} · ${s.label}`,
            text: s.text,
            docId: d.id,
            docTitle: d.title,
            fromPage: s.fromPage,
            toPage: s.toPage,
          })
        }
        // Pinned pages (the reviewed question's own evidence) are always included
        const pinned = pinnedPagesByDoc.get(d.id)
        if (pinned && pinned.size > 0) {
          const pinnedText = pages
            .filter(p => pinned.has(p.page) && p.text)
            .map(p => `[page ${p.page}]\n${p.text.slice(0, 2600)}`)
            .join('\n\n')
          if (pinnedText) {
            const from = Math.min(...pinned)
            const to = Math.max(...pinned)
            const label = from === to ? `page ${from}` : `pages ${from}–${to}`
            if (!seen.has(label)) {
              windows.push({ label: `${d.title} · ${label}`, text: pinnedText, docId: d.id, docTitle: d.title, fromPage: from, toPage: to })
              seen.add(label)
            }
          }
        }
      }
    }
    if (questionEvidence && !questionEvidence.title) {
      questionEvidence.title = docTitleOf.get(questionEvidence.documentId) ?? 'Your document'
    }

    const retrievalText = windows.length > 0
      ? windows.map(w => `--- EXCERPT (${w.label}) ---\n${w.text}`).join('\n\n')
      : ''

    // ── Live retrieval for time-sensitive questions (configured web_search) ──
    // Used only when the question needs current information. Results are
    // external reference data, machine-marked [web N] and kept clearly apart
    // from the student's material. Failures are honest — never faked.
    const wantsLive = TIME_SENSITIVE_RE.test(lastUser)
    let webResults: WebResult[] = []
    let liveLookupFailed = false
    if (wantsLive) {
      try {
        webResults = await webSearch(lastUser, 4)
      } catch (err) {
        console.error('[api/riishe/chat] live retrieval failed:', err)
        liveLookupFailed = true
      }
    }
    const webBlock = webResults.length > 0
      ? `LIVE WEB RESULTS — retrieved moments ago for this question. External, untrusted reference data: NOT the student's material. Never cite them as document pages, never present them as excerpts from the uploads. If you use one, mark the claim with its [web N] number right after the claim and introduce that part with "From live web results:".\n${webResults.map((r, i) => `[web ${i + 1}] ${r.name} — ${r.host}${r.date ? ` — ${r.date}` : ''}\n${r.snippet}`).join('\n\n')}`
      : ''

    // ── System prompt: honest, grounded, style-separated, injection-fenced ──
    // Phase 3B: a server-computed digest of the learner's real records is
    // injected so explanations lean on actual gaps. Built only from DB rows —
    // client-supplied progress values are never trusted. Empty when there is
    // no data (the prompt is unchanged). Ownership: when a signed-in session
    // exists and the guest identity was claimed by a DIFFERENT account, the
    // digest is withheld — one account's learning profile never enriches
    // another account's prompt (guest-bearer chat itself is pre-existing).
    // Phase 3C: teaching mode (how to teach), response language (which
    // language to answer in) and learner-adaptation instructions ride on top.
    // They are presentation/teaching preferences only — retrieval scope,
    // source-evidence verification, citation checks and disclosure rules are
    // computed independently below and are never weakened by them.
    const digestOwner = await assertLearningOwner(guestId)
    const learningContext = digestOwner.ok ? await buildLearningDigest(guestId) : ''
    const topicLine = topic
      ? `The student is focusing on the topic "${topic}" from their uploaded material — prioritise excerpts that discuss it.`
      : ''
    const system = [
      'You are Riishe, the AI study tutor inside BEAN Education. The student practises from their own uploaded documents.',
      questionContext ? `CONTEXT — the student is asking about a specific question from their practice attempt:\n${questionContext}` : '',
      learningContext,
      // Phase 3C — how to adapt teaching to the (verified) learner evidence,
      // or an explicit honesty rule when no evidence is available.
      learnerAdaptationPrompt(learningContext !== ''),
      // Phase 3C — the selected teaching mode (defaults to EXPLAIN).
      tutorModePrompt(effectiveTutorMode),
      topicLine,
      retrievalText
        ? `GROUNDING: factual explanations about the material MUST come from the excerpts below. When you state a fact from an excerpt, cite it as (DocumentName, page N) using the [page N] markers. If the excerpts do not contain what the student asks about, say plainly that your uploaded-material text does not cover it — then, if you use general knowledge, introduce it with "Outside your uploaded material:" so the student can tell the difference. Never invent page numbers or quotes.`
        : `No relevant passage from the student's uploaded material was retrieved for this question (nothing analysed, or nothing matches). Do not pretend to quote their documents — if the material does not cover it, say so plainly, then answer from general knowledge and introduce that part with "Outside your uploaded material:".`,
      // Three explicit answer-source modes + honest time-sensitive handling
      `ANSWER-SOURCE MODES — every reply is one of: DOCUMENT-GROUNDED (facts about the material come from the excerpts, with real page citations), GENERAL KNOWLEDGE (not verified against the student's uploaded material — label it as such; live web results are also outside the material), or MIXED CONTEXT (both, kept clearly apart).`,
      // Live web results / honest disclosure when a live lookup was not possible
      webBlock,
      wantsLive && webResults.length === 0
        ? `LIVE LOOKUP UNAVAILABLE: this question needs current information, but the live web lookup ${liveLookupFailed ? 'failed just now' : 'returned no usable results'}. Never claim you checked anything live — state plainly that the information is NOT verified as current and recommend checking an official source.`
        : '',
      // Response language — presentation only; '' for auto/omitted (existing default)
      responseLanguagePrompt(responseLanguage),
      // Presentation style — depth only, never sources
      stylePrompt(style),
      'Keep answers concise (2-6 sentences unless asked for step-by-step), exam-useful and encouraging. You may quiz the student with a short follow-up question when that helps.',
      // Machine-readable source tag protocol (stripped server-side before display)
      'Start every reply with exactly one source tag on its own first line: [SOURCES: DOCUMENT] if the material facts come from the provided excerpts with page citations, [SOURCES: MIXED] if you combine excerpts with outside knowledge (live web results count as outside knowledge), [SOURCES: GENERAL] if you used neither — web-only answers are GENERAL because the web is not the student\'s material. The tag is interface metadata — never mention it inside the answer. Choose honestly: DOCUMENT requires real citations from the excerpts you were actually given.',
      retrievalText ? fenceDocumentText('student study material', retrievalText) : '',
    ].filter(Boolean).join('\n\n')

    // ── Provider call (plain text reply; provider failures are honest) ──
    const history = messages.slice(-12).map(m => ({ role: m.role, content: m.content }))
    let reply: string
    try {
      reply = await chat([{ role: 'assistant', content: system }, ...history])
    } catch (err) {
      console.error('[api/riishe/chat POST]', err)
      return NextResponse.json({ error: 'Riishe could not reach the AI provider just now. Your question was not lost — try again in a moment.' }, { status: 502 })
    }

    // Strip the self-reported source tag; it is metadata, never user-visible.
    const { tag, body } = parseSourceTag(reply)
    let replyBody = body.trim().slice(0, 6000)

    // Which numbered web results did the answer actually use? Machine markers
    // are verified against the results that were really provided, then stripped
    // from the visible text — the sources panel carries them instead.
    const webUsedIdx = new Set<number>()
    const scanWebMarkers = (text: string) => {
      webUsedIdx.clear()
      const wmRe = /\[web (\d+)\]/gi
      let wmx: RegExpExecArray | null
      while ((wmx = wmRe.exec(text)) !== null) {
        const idx = Number(wmx[1])
        if (webResults[idx - 1]) webUsedIdx.add(idx - 1)
      }
    }
    scanWebMarkers(replyBody)
    replyBody = replyBody.replace(/\s*\[web \d+\]/gi, '').trim()

    // A tag-only reply ("[SOURCES: GENERAL]" with nothing after it) carries no
    // answer at all. One honest retry, then a real error — never store or show
    // an empty reply as if it were an answer.
    if (!replyBody) {
      try {
        const retry = await chat([
          { role: 'assistant', content: system },
          ...history,
          { role: 'user', content: `${lastUser}\n\nIMPORTANT: Your previous reply was empty. Answer the question above in plain text now.` },
        ])
        const retryBody = parseSourceTag(retry).body.trim().slice(0, 6000)
        if (retryBody) {
          scanWebMarkers(retryBody)
          replyBody = retryBody.replace(/\s*\[web \d+\]/gi, '').trim()
        }
      } catch (err) {
        console.error('[api/riishe/chat] empty-reply retry failed:', err)
      }
    }
    if (!replyBody) {
      return NextResponse.json({ error: 'The AI provider returned an empty response. Please try again in a moment.' }, { status: 502 })
    }
    const webUsed = webUsedIdx.size > 0

    // ── Verify document use INDEPENDENTLY of the model's tag ──
    // 1. Page citations count only when the cited page marker really exists in
    //    that document's retrieved window (no invented citations).
    const pagesByDoc = new Map<string, Set<number>>()
    const pagePattern = /\(page (\d+)\)|\[page (\d+)\]|page (\d+)\b/gi
    let m: RegExpExecArray | null
    while ((m = pagePattern.exec(replyBody)) !== null) {
      const p = Number(m[1] ?? m[2] ?? m[3])
      if (!Number.isFinite(p) || p < 1) continue
      // Attribute to the window whose text actually contains that page marker.
      for (const w of windows) {
        const maxPage = maxPageOf.get(w.docId) ?? 99999
        if (p <= maxPage && w.text.includes(`[page ${p}]`)) {
          let set = pagesByDoc.get(w.docId)
          if (!set) { set = new Set(); pagesByDoc.set(w.docId, set) }
          set.add(p)
        }
      }
    }
    // 2. Verbatim-quote containment catches material use without page markers.
    let quoted = false
    if (windows.length > 0 && replyBody.length >= 60) {
      for (const w of windows) {
        if (replyQuotesWindow(replyBody, w.text)) { quoted = true; break }
      }
    }
    const verifiedCitations = [...pagesByDoc.values()].reduce((s, set) => s + set.size, 0)

    // 3. Question-review scope: the pinned question + recorded evidence are
    //    stored document data — an explanation drawn from them is material use.
    const usedStoredEvidence = isPerQuestion && tag !== 'general'

    const usedMaterial = verifiedCitations > 0 || quoted || usedStoredEvidence
    const outside = flagsOutsideMaterial(replyBody)
    let grounding: SourceState
    if (usedMaterial && (outside || tag === 'mixed' || webUsed)) grounding = 'mixed'
    else if (usedMaterial) grounding = 'document'
    else grounding = 'general' // web-only and fully external answers stay 'general'
    // A 'document' claim with zero verifiable citations and no question context
    // is downgraded — never present unverified material claims as grounded.
    if (tag === 'document' && !usedMaterial) grounding = 'general'

    // Deterministic disclosure — the badge and sources panel always label the
    // source state, and the visible text must say it too, even when the model
    // forgets. Applied only to pure-external answers (never mixed/document):
    //   1. web-only answers get the live-web origin line,
    //   2. answers with nothing from the uploads get the outside-material line,
    //   3. time-sensitive answers whose live lookup failed get an explicit
    //      "not verified as current" note instead of silent stale facts.
    // Phase 3D: when the student explicitly selected a response language, the
    // disclosure line is written in THAT language (same meaning, same
    // uncertainty); 'auto'/omitted keeps the pre-existing English behaviour.
    // The grounding computation above is untouched — only the visible prefix
    // is localized.
    const disclosureLang = responseLanguage && responseLanguage !== 'auto' ? responseLanguage : undefined
    const saysOutside =
      flagsOutsideMaterial(replyBody) ||
      /general knowledge|not verified|cannot verif|can't verif|not covered|your (?:uploaded )?(?:material|notes?|documents?) (?:do|does) not|doesn't cover|does not cover|no live data|official source/i.test(replyBody)
    const saysWeb = /live web|web results/i.test(replyBody)
    const saysUnverified =
      /not verified|cannot verif|can't verif|unable to verif|no live|live (?:data|lookup|results|web)|not be current|may (?:be|have) (?:changed|outdated)|outdated|official source|up.to.date|real.?time/i.test(replyBody)
    if (grounding === 'general' && !isPerQuestion && !webUsed) {
      if (wantsLive && !saysUnverified) {
        replyBody = `${disclosureLine('notVerifiedCurrent', disclosureLang)}${replyBody}`
      }
      if (!saysOutside && groundingDocIds.length > 0) {
        replyBody = `${disclosureLine('outsideMaterial', disclosureLang)}${replyBody}`
      }
    } else if (grounding === 'general' && !isPerQuestion && webUsed && !saysWeb) {
      replyBody = `${disclosureLine('liveWeb', disclosureLang)}${replyBody}`
    }

    // ── Sources actually behind this answer (for the truthful context panel) ──
    const sources: RiisheChatSourceDTO[] = []
    if (grounding === 'document' || grounding === 'mixed') {
      for (const w of windows) {
        const cited = [...(pagesByDoc.get(w.docId) ?? [])].filter(p => p >= w.fromPage && p <= w.toPage)
        // Include windows whose pages were cited, or (when use was verified by
        // quote/question-context instead of page markers) the retrieved windows.
        const relevant = cited.length > 0 || ((quoted || usedStoredEvidence) && verifiedCitations === 0)
        if (!relevant) continue
        const excerpt = w.text.replace(/\[page \d+\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
        sources.push({
          documentId: w.docId,
          title: w.docTitle,
          pages: cited.length > 0 ? [Math.min(...cited), Math.max(...cited)] : [w.fromPage, w.toPage],
          excerpt,
        })
        if (sources.length >= 6) break
      }
      // Per-question scope with no page markers: the recorded question evidence IS the source.
      if (sources.length === 0 && questionEvidence) {
        sources.push(questionEvidence)
      }
    }
    // Live web sources the answer verifiably used (via [web N] markers) —
    // shown even for 'general' answers, since they are the real sources used.
    for (const i of [...webUsedIdx].slice(0, 4)) {
      const r = webResults[i]
      if (!r) continue
      sources.push({
        documentId: '',
        title: r.name,
        pages: [],
        excerpt: r.snippet,
        kind: 'web',
        url: r.url,
        detail: `${r.host}${r.date ? ` · ${r.date}` : ''} · retrieved live just now`,
      })
    }

    // Persist the conversation (guest-scoped)
    await db.riisheChatTurn.create({
      data: {
        guestId,
        documentId: documentId ?? null,
        attemptId: attemptId ?? null,
        questionId: questionId ?? null,
        role: 'user',
        content: (lastUser || '').slice(0, 6000),
      },
    })
    const saved = await db.riisheChatTurn.create({
      data: {
        guestId,
        documentId: documentId ?? null,
        attemptId: attemptId ?? null,
        questionId: questionId ?? null,
        role: 'assistant',
        content: replyBody,
        pagesCitedJson: JSON.stringify([...pagesByDoc.values()].flatMap(s => [...s]).sort((a, b) => a - b).slice(0, 12)),
        grounding,
        sourcesJson: JSON.stringify(sources),
        // Phase 3D: the preference in force for THIS answer rides on the
        // assistant turn (conversation-scoped persistence). The user turn
        // carries no preference metadata by design.
        tutorMode: effectiveTutorMode,
        responseLanguage: responseLanguage ?? 'auto',
      },
    })

    return NextResponse.json({
      reply: replyBody,
      pagesCited: [...pagesByDoc.values()].flatMap(s => [...s]).sort((a, b) => a - b).slice(0, 12),
      grounding,
      sources,
      turnId: saved.id,
      // Phase 3D: the effective settings used for this reply (server truth).
      tutorMode: effectiveTutorMode,
      responseLanguage: responseLanguage ?? 'auto',
    })
  } catch (err) {
    console.error('[api/riishe/chat POST]', err)
    return NextResponse.json({ error: 'Could not answer that just now — please try again.' }, { status: 500 })
  }
}
