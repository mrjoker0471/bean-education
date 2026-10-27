// ─── Riishe post-exam explanations: grounded mistake analysis ────────────────
// After submission the student's wrong answers are explained in batches:
// why the chosen option is wrong, the correct reasoning, the supporting
// excerpt + page refs, the concept tested, the misconception behind the
// error, and a revision target. Every explanation is grounded in the stored
// question evidence + document text — or honestly labelled as external.

import { db } from '@/lib/db'
import { safeParse } from '@/lib/serialize'
import { chatJson, fenceDocumentText, AI_UNAVAILABLE_MESSAGE } from './ai'
import type { RiisheExplanationPayload } from './types'

const BATCH = 5
const EXPLAIN_HOURLY_LIMIT = 6

/** Loose containment check (punctuation/whitespace insensitive) — shared logic
 * with the generation validator so "verbatim" means the same thing everywhere. */
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

interface ExplainInput {
  questionId: string
  text: string
  options: string[]
  correctIndex: number
  selectedIndex: number | null
  topic: string | null
  evidence: string | null
  pageRefs: number[]
  documentExcerpt: string
}

/** Background job: generate explanations for an attempt's incorrect answers. */
export async function explainAttemptJob(attemptId: string, guestId: string): Promise<void> {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.guestId !== guestId || attempt.source !== 'RIISHE') return
  if (!['SUBMITTED', 'TIMED_OUT'].includes(attempt.status)) return

  const questionIds = safeParse<string[]>(attempt.questionIdsJson, [])
  const answers = safeParse<Record<string, number>>(attempt.answersJson ?? '{}', {})
  const questions = await db.riisheQuestion.findMany({ where: { id: { in: questionIds } } })
  if (questions.length === 0) return
  const doc = await db.studyDocument.findUnique({ where: { id: questions[0].documentId } })
  if (!doc) return

  // Only the questions the student got wrong (skipped ones keep their stored explanation)
  const wrong = questions
    .filter(q => {
      const sel = answers[q.id]
      return sel !== undefined && sel >= 0 && sel !== q.correctIndex
    })
    .slice(0, 50)

  const already = await db.riisheExplanation.findMany({
    where: { attemptId, status: 'READY' },
    select: { questionId: true },
  })
  const done = new Set(already.map(r => r.questionId))
  // View model for the prompt: parsed options + the student's pick
  interface ExplainItem {
    id: string; text: string; options: string[]; correctIndex: number
    selectedIndex: number | null; topic: string | null; evidence: string | null
  }
  const todo: ExplainItem[] = wrong
    .filter(q => !done.has(q.id))
    .map(q => ({
      id: q.id,
      text: q.text,
      options: safeParse<string[]>(q.optionsJson, []),
      correctIndex: q.correctIndex,
      selectedIndex: answers[q.id] ?? null,
      topic: q.topic,
      evidence: q.evidence,
    }))
  if (todo.length === 0) return

  await db.riisheExplanation.deleteMany({ where: { attemptId, status: { in: ['PENDING'] } } })

  // Build a compact retrieval window: the evidence pages of the wrong questions
  const relevantPages = new Set<number>()
  const pageRefsByQuestion = new Map<string, number[]>()
  for (const q of wrong) {
    const refs = safeParse<number[]>(q.pageRefsJson ?? '[]', []).filter(n => Number.isFinite(n))
    pageRefsByQuestion.set(q.id, refs)
    for (const p of refs) relevantPages.add(p)
  }
  const pages = safeParse(doc.extractionJson ?? '[]', [] as { page: number; text: string; chars: number }[])
  const windowText = pages
    .filter(p => relevantPages.has(p.page) && p.text)
    .map(p => `[page ${p.page}]\n${p.text}`)
    .join('\n\n')
    .slice(0, 14000)

  let lastError: string | null = null
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH)
    try {
      const payload = await chatJson<{ explanations?: Partial<RiisheExplanationPayload>[] }>({
        system: 'You are Riishe, the exam-review teacher inside BEAN EXAMS. You diagnose exactly why a student picked a wrong answer and teach the correct reasoning. Output only valid JSON.',
        user: `For EACH question below, the student selected an incorrect option. Explain the mistake.

Return JSON: {"explanations": [{
  "whyWrong": string,          // why the STUDENT'S selected option is wrong — reference its letter and content
  "correctReasoning": string,  // step-by-step reasoning that leads to the correct option
  "excerpt": string,           // verbatim quote (≤300 chars) from the SOURCE EXCERPTS supporting the correct answer; "" if truly absent
  "pageRefs": number[],        // pages supporting the correct answer (from the [page N] markers); [] if not in the excerpt
  "concept": string,           // the underlying concept being tested
  "misconception": string|null,// the specific reasoning error the student likely made, if identifiable
  "revisionTopic": string,     // what to reread/revisit
  "grounding": "document"|"external" // "document" if supported by the excerpts; "external" if you needed outside knowledge (say which)
}]}

Rules:
- Be specific and fair: never invent quotes or page numbers. If the source does not settle the point, set grounding to "external" and explain what extra knowledge you used.
- Keep each field concise (1-4 sentences) and exam-useful.
- Address the student directly ("You chose B, but...").

${fenceDocumentText(doc.title, windowText || '(the relevant pages were not retrievable — explain from the question record only)')}

QUESTIONS (student's pick in brackets):
${batch.map((q, j) => `Q${j + 1} (id=${q.id}) ${q.text}
Options: ${q.options.map((o, k) => `${'ABCD'[k]}. ${o}`).join(' | ')}
Correct: ${'ABCD'[q.correctIndex]}. Student selected: ${q.selectedIndex !== null ? `${'ABCD'[q.selectedIndex]}. ${q.options[q.selectedIndex] ?? ''}` : 'no answer (skipped)'}
Recorded evidence: "${(q.evidence ?? '').slice(0, 250)}"`).join('\n\n')}`,
      })

      const list = payload.explanations
      if (Array.isArray(list)) {
        for (let j = 0; j < batch.length; j++) {
          const e = list[j]
          const q = batch[j]
          if (!e || typeof e !== 'object') continue
          let excerpt = String(e.excerpt ?? '').slice(0, 500)
          let pageRefs = (Array.isArray(e.pageRefs) ? e.pageRefs : []).map(Number).filter(n => Number.isFinite(n)).slice(0, 8)
          let grounding: 'document' | 'external' = e.grounding === 'external' ? 'external' : 'document'

          // Programmatic verification: a "document"-grounded explanation must
          // quote text that actually exists in the document window, and cite
          // only pages that were actually fed. Anything else is downgraded to
          // external — a fabricated quote must never be shown as source-backed.
          if (grounding === 'document') {
            const inWindow = excerpt && excerpt.length >= 12 && evidenceInText(excerpt, windowText)
            const knownEvidence = excerpt && q.evidence && evidenceInText(excerpt, q.evidence)
            const pagesOk = pageRefs.length === 0 || pageRefs.some(p => relevantPages.has(p))
            if (!(inWindow || knownEvidence) || !pagesOk) {
              // Fall back to the question's own validated evidence excerpt
              if (q.evidence && q.evidence.length >= 12 && evidenceInText(q.evidence, windowText)) {
                excerpt = q.evidence.slice(0, 500)
                pageRefs = pageRefsByQuestion.get(q.id) ?? []
                grounding = 'document'
              } else {
                grounding = 'external'
                excerpt = ''
                pageRefs = []
              }
            }
          } else {
            // Even external explanations must not display invented quotes
            if (excerpt && !evidenceInText(excerpt, windowText) && !(q.evidence && evidenceInText(excerpt, q.evidence))) {
              excerpt = ''
              pageRefs = []
            }
          }

          const payloadClean: RiisheExplanationPayload = {
            whyWrong: String(e.whyWrong ?? '').slice(0, 1200),
            correctReasoning: String(e.correctReasoning ?? '').slice(0, 1600),
            excerpt,
            pageRefs,
            concept: String(e.concept ?? q.topic ?? '').slice(0, 200),
            misconception: e.misconception ? String(e.misconception).slice(0, 400) : null,
            revisionTopic: String(e.revisionTopic ?? q.topic ?? '').slice(0, 200),
            grounding,
          }
          await db.riisheExplanation.upsert({
            where: { attemptId_questionId: { attemptId, questionId: q.id } },
            create: { attemptId, questionId: q.id, status: 'READY', payloadJson: JSON.stringify(payloadClean) },
            update: { status: 'READY', payloadJson: JSON.stringify(payloadClean) },
          })
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.error('[riishe explain] batch failed:', err)
      // Preserve what was generated; leave remaining questions for a retry
      break
    }
  }

  if (lastError) {
    // Store FAILED markers for missing ones so the UI can offer an honest retry
    const remaining = todo.filter(q => !done.has(q.id))
    const made = await db.riisheExplanation.findMany({ where: { attemptId }, select: { questionId: true } })
    const madeSet = new Set(made.map(m => m.questionId))
    for (const q of remaining) {
      if (!madeSet.has(q.id)) {
        await db.riisheExplanation.upsert({
          where: { attemptId_questionId: { attemptId, questionId: q.id } },
          create: { attemptId, questionId: q.id, status: 'FAILED', payloadJson: JSON.stringify({ whyWrong: `Explanation generation failed: ${AI_UNAVAILABLE_MESSAGE}` }) },
          update: { status: 'FAILED', payloadJson: JSON.stringify({ whyWrong: `Explanation generation failed: ${AI_UNAVAILABLE_MESSAGE}` }) },
        })
      }
    }
  }
}

export { EXPLAIN_HOURLY_LIMIT }
export type { ExplainInput }
