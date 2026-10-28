import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { recoverStaleTests, queueOnce } from '@/lib/riishe/jobs'
import { generateTestJob } from '@/lib/riishe/generate'
import { DEFAULT_DISTRIBUTION, type QuestionCategory } from '@/lib/riishe/types'
import { findExamPattern } from '@/lib/riishe/exam-pattern'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CATEGORIES: QuestionCategory[] = ['FOUNDATION', 'APPLICATION', 'STATEMENT', 'MULTISTEP', 'MISCONCEPTION']

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  /** Multi-document practice (1–8 documents). Every id must belong to the guest. */
  documentIds: z.array(z.string().min(6).max(64)).min(1).max(8).optional(),
  /** Single-document (workspace) form. */
  documentId: z.string().min(6).max(64).optional(),
  focusTopics: z.array(z.string().max(120)).max(8).optional(),
  weakFocus: z.boolean().optional(),
  timed: z.boolean().optional(),
  /** Explicit per-question timing (minutes); 0 = untimed. Default: 1 min/question. */
  durationMin: z.number().int().min(0).max(240).optional(),
  /** 50/100-and-beyond practice: the batch budget scales with the count, and
   *  only validated questions are ever published (never padded to the count). */
  count: z.number().int().min(4).max(200).optional(),
  difficultyFocus: z.enum(['MIXED', 'FOUNDATIONAL', 'INTERMEDIATE', 'ADVANCED']).optional(),
  /** Question-type mix — a subset of categories. The requested counts are
   *  re-scaled over the selection so the total still equals `count`. */
  categories: z.array(z.enum(['FOUNDATION', 'APPLICATION', 'STATEMENT', 'MULTISTEP', 'MISCONCEPTION'])).min(1).max(5).optional(),
  /** Explicit student-chosen practice scoring. When absent, a VERIFIED exam
   *  pattern may be offered; otherwise plain +1/0. */
  scoring: z.object({ marksPerQuestion: z.number().int().min(1).max(10), negativeMark: z.number().int().min(0).max(10) }).optional(),
})

// POST — create a RiisheTest and kick the generation job.
// Duplicate protection: a QUEUED/GENERATING test for the same scope returns the
// existing test instead of spawning a second job.
export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, focusTopics, weakFocus, timed, durationMin, count, categories, scoring } = parsed.data

    // Resolve the source documents (multi-document first, single-doc fallback)
    const requestedIds = [...new Set(parsed.data.documentIds ?? (parsed.data.documentId ? [parsed.data.documentId] : []))]
    if (requestedIds.length === 0) return NextResponse.json({ error: 'No document selected' }, { status: 400 })

    const docs = await db.studyDocument.findMany({ where: { id: { in: requestedIds }, guestId } })
    if (docs.length !== requestedIds.length) {
      // A stranger's or unknown id never silently degrades the scope — 404.
      return NextResponse.json({ error: 'Material not found' }, { status: 404 })
    }
    const notReady = docs.find(d => d.status === 'NEEDS_OCR')
    if (notReady) {
      return NextResponse.json({ error: `"${notReady.title}" has no extractable text (scanned images) — Riishe cannot generate questions from it.` }, { status: 409 })
    }
    const unready = docs.find(d => d.status !== 'READY')
    if (unready) {
      return NextResponse.json({ error: 'Riishe is still analysing a selected document — wait for it to be Ready, then generate the test.' }, { status: 409 })
    }

    await recoverStaleTests()

    // Primary document = first requested (workspace form always has exactly one)
    const primary = docs.find(d => d.id === requestedIds[0]) ?? docs[0]
    const focus = (focusTopics ?? []).filter(Boolean)
    const requested = count ?? 50

    // Scope key covers every dimension a student can choose, so an identical
    // retry reuses the in-flight test instead of spawning a duplicate.
    const sourceDocIds = requestedIds.filter(id => id !== primary.id)
    const inFlight = await db.riisheTest.findFirst({
      where: { guestId, status: { in: ['QUEUED', 'GENERATING'] }, documentId: primary.id },
      orderBy: { createdAt: 'desc' },
    })
    if (inFlight) {
      const sameScope =
        jsonArr(inFlight.focusTopicsJson).slice().sort().join('|') === focus.slice().sort().join('|') &&
        jsonArr(inFlight.sourceDocIdsJson).slice().sort().join('|') === [primary.id, ...sourceDocIds].slice().sort().join('|') &&
        inFlight.requestedCount === requested &&
        (weakFocus ?? false) === inFlight.weakFocus
      if (sameScope) {
        // A generation for this exact scope is already running — return it (idempotent retry)
        return NextResponse.json({ testId: inFlight.id, existing: true })
      }
    }

    const timedFinal = timed !== false
    const duration = durationMin !== undefined
      ? durationMin
      : timedFinal ? Math.max(10, requested) : 0

    // ── Scoring: explicit choice > verified exam pattern > plain +1/0 ──
    let config: {
      timed: boolean; durationMin: number; marksPerQuestion: number; negativeMark: number;
      scoringModel?: string; patternLabel?: string
    }
    if (scoring) {
      config = { timed: timedFinal, durationMin: duration, ...scoring, scoringModel: 'CUSTOM' }
    } else {
      const pattern = await findExamPattern(primary.examLabel)
      config = pattern
        ? {
            timed: timedFinal, durationMin: duration,
            marksPerQuestion: pattern.marksPerQuestion, negativeMark: pattern.negativeMark,
            scoringModel: 'EXAM_PATTERN',
            patternLabel: `${pattern.examName} pattern (+${pattern.marksPerQuestion} correct${pattern.negativeMark > 0 ? ` / −${pattern.negativeMark} wrong` : ''}) — practice scoring, not an official result`,
          }
        : { timed: timedFinal, durationMin: duration, marksPerQuestion: 1, negativeMark: 0, scoringModel: 'CUSTOM' }
    }

    // ── Distribution: scale to the requested count over the chosen categories ──
    const activeCats = (categories && categories.length > 0 ? categories : CATEGORIES).filter(c => CATEGORIES.includes(c))
    const base = activeCats.map(c => ({ cat: c, v: DEFAULT_DISTRIBUTION[c] }))
    const baseSum = base.reduce((s, x) => s + x.v, 0)
    const distribution: Record<string, number> = {}
    let allocated = 0
    for (let i = 0; i < base.length; i++) {
      const isLast = i === base.length - 1
      const v = isLast
        ? requested - allocated
        : Math.max(1, Math.round((base[i].v / baseSum) * requested))
      distribution[base[i].cat] = Math.max(1, isLast ? Math.max(1, v) : v)
      allocated += distribution[base[i].cat]
    }

    const test = await db.riisheTest.create({
      data: {
        guestId,
        documentId: primary.id,
        title: buildTitle(docs.length === 1 ? primary.title : `${docs.length} documents`, focus, weakFocus ?? false),
        status: 'QUEUED',
        statusDetail: 'Queued — generation starts shortly…',
        focusTopicsJson: JSON.stringify(focus),
        weakFocus: weakFocus ?? false,
        requestedCount: requested,
        configJson: JSON.stringify(config),
        distributionJson: JSON.stringify(distribution),
        // Always stored (primary first) so in-flight scope comparison is uniform
        // between single-document and multi-document requests.
        sourceDocIdsJson: JSON.stringify([primary.id, ...sourceDocIds]),
      },
    })

    void queueOnce(guestId, `test:${test.id}`, () => generateTestJob(test.id))

    return NextResponse.json({ testId: test.id })
  } catch (err) {
    console.error('[api/riishe/generate]', err)
    return NextResponse.json({ error: 'Could not start test generation' }, { status: 500 })
  }
}

function buildTitle(docTitle: string, focus: string[], weak: boolean): string {
  const clean = docTitle.slice(0, 80)
  if (weak) return `${clean} — Weak-area focus`
  if (focus.length === 1) return `${clean} — ${focus[0].slice(0, 60)}`
  return `${clean} — Riishe test`
}

function jsonArr(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
