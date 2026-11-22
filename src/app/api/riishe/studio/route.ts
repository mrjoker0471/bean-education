// ─── Riishe Phase 3E: Interactive Learning Studio — activity generation ──────
// POST /api/riishe/studio
//
// Generates ONE structured learning activity (concept map, step-by-step
// explanation, formula walkthrough, flashcards or mini-test) for a topic,
// grounded in the student's own material through the same retrieval helpers
// the tutor chat uses (sectionPages + SectionIndex + fenceDocumentText).
//
// Contracts preserved from the existing Riishe API surface:
//   - zod body validation → 400 'Invalid request'
//   - sameOrigin CSRF-lite guard (mutating POST, same as /api/learning/plan)
//   - per-owner in-memory rate limit (activities cost one provider call each)
//   - assertLearningOwner BEFORE ANY database read (Phase 3B.1/3D.1
//     fail-closed semantics: guest-bearer passes, claimant passes, a foreign
//     claimant gets 403, a thrown session lookup gets 503 — a client-supplied
//     guestId alone can never bypass claimed-account ownership)
//   - document ownership by guestId equality; 404 without existence leaks
//   - honest failures: provider/validation problems are 502s with human text,
//     never a fabricated activity
//
// Persistence (Phase 3F): every successfully generated + validated activity is
// saved as one RiisheStudioActivity row (status IN_PROGRESS) carrying the
// validated snapshot, so the student can resume it and find it in their
// Studio history. Resume NEVER reruns generation — the stored snapshot is
// rendered as-is. Persistence is a continuity hook: a store failure degrades
// to the Phase 3E ephemeral behaviour (logged, activity still returned), it
// never fails the generation response.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { assertLearningOwner, pruneRateLimits, rateLimited } from '@/lib/learning/scope'
import { RIISHE_RESPONSE_LANGUAGES } from '@/lib/riishe/tutor'
import { STUDIO_ACTIVITY_KINDS } from '@/lib/riishe/studio-types'
import {
  generateStudioActivity,
  StudioGenerationError,
  type StudioMaterialBlock,
} from '@/lib/riishe/studio'
import { sectionPages, type ExtractedPage } from '@/lib/riishe/extract'
import { SectionIndex } from '@/lib/riishe/index'
import { safeParse } from '@/lib/serialize'
import { saveGeneratedActivity, listStudioActivities, StudioStoreError } from '@/lib/riishe/studio-store'
import { STUDIO_STATUSES } from '@/lib/riishe/studio-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Activities are heavier than chat turns (one provider call each): 12 / 10 min. */
const STUDIO_RATE = { windowMs: 10 * 60_000, max: 12 }
/** Same relevance floor as the chat route — zero-score sections never ground. */
const MIN_RELEVANCE = 0.05

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  kind: z.enum(STUDIO_ACTIVITY_KINDS),
  topic: z.string().max(160).optional(),
  documentId: z.string().min(1).max(64).optional(),
  documentIds: z.array(z.string().min(1).max(64)).max(8).optional(),
  responseLanguage: z.enum(RIISHE_RESPONSE_LANGUAGES).optional(),
})

// GET — paged Studio history + honest evidence roll-up (Phase 3F + 3H).
// Same guarded contract as the chat-history GET: ownership is verified BEFORE
// any database read; rows are guestId-scoped; errors never carry activity data.
// Phase 3H query params (all optional, all server-validated):
//   cursor  — opaque page cursor from the previous response's nextCursor
//   limit   — page size 1..100 (default 50)
//   kind    — filter by activity kind
//   status  — filter by lifecycle status
//   search  — case-insensitive substring match on topic / document title
// Response: { items, evidence, nextCursor, totalMatching } — items is ONE
// page; totalMatching is the exact count of records matching the filters;
// evidence describes the whole history with exact status counts.
const historyQuerySchema = z.object({
  guestId: z.string().min(8).max(64),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  kind: z.enum(STUDIO_ACTIVITY_KINDS).optional(),
  status: z.enum(STUDIO_STATUSES).optional(),
  search: z.string().max(120).optional(),
})

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = historyQuerySchema.safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const owner = await assertLearningOwner(parsed.data.guestId)
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status })
  }

  try {
    const { items, evidence, nextCursor, totalMatching } = await listStudioActivities(parsed.data.guestId, {
      cursor: parsed.data.cursor ?? null,
      limit: parsed.data.limit,
      kind: parsed.data.kind ?? null,
      status: parsed.data.status ?? null,
      search: parsed.data.search ?? null,
    })
    return NextResponse.json({ items, evidence, nextCursor, totalMatching })
  } catch (err) {
    if (err instanceof StudioStoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[api/riishe/studio GET]', err)
    return NextResponse.json({ error: 'Could not load your Studio history. Please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { guestId, kind } = body
  const responseLanguage = body.responseLanguage ?? 'auto'

  pruneRateLimits()
  if (rateLimited(`studio:${guestId}`, STUDIO_RATE.max, STUDIO_RATE.windowMs)) {
    return NextResponse.json(
      { error: 'Riishe Studio needs a short break — too many activities generated in a row. Please try again in a few minutes.' },
      { status: 429 },
    )
  }

  // Fail-closed ownership gate — runs BEFORE any database read. Same
  // 403/503 contract as the guarded chat-history GET (Phase 3D.1).
  const owner = await assertLearningOwner(guestId)
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status })
  }

  try {
    // ── Resolve the grounding scope (documents are guestId-equality read) ──
    const requestedIds = body.documentIds && body.documentIds.length > 0
      ? body.documentIds
      : body.documentId
        ? [body.documentId]
        : []

    interface DocRow { id: string; title: string; status: string; pageCount: number | null; extractionJson: string | null }
    let docs: DocRow[] = []
    if (requestedIds.length > 0) {
      const found = await db.studyDocument.findMany({
        where: { id: { in: requestedIds }, guestId },
      })
      // Every requested id must exist AND belong to this guest — no partial
      // scoping that silently swaps in other material, no existence leaks.
      if (found.length !== requestedIds.length) {
        return NextResponse.json({ error: 'Material not found' }, { status: 404 })
      }
      const notReady = found.filter(d => d.status !== 'READY')
      if (notReady.length > 0) {
        return NextResponse.json(
          { error: 'One of the selected materials is not ready yet — try again once it finishes analysing.' },
          { status: 409 },
        )
      }
      docs = found
    } else {
      // Hub scope: the most recently updated READY materials, same breadth as chat.
      docs = await db.studyDocument.findMany({
        where: { guestId, status: 'READY' },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      })
    }

    // ── Build the grounded retrieval blocks (chat-route retrieval pattern) ──
    const topic = (body.topic ?? '').trim().slice(0, 160) || docs[0]?.title?.slice(0, 160) || ''
    if (!topic) {
      return NextResponse.json({ error: 'Topic required' }, { status: 400 })
    }

    const blocks: StudioMaterialBlock[] = []
    if (docs.length > 0) {
      const perDoc = docs.length === 1 ? 4 : Math.max(2, Math.floor(14 / docs.length))
      for (const d of docs) {
        const pages = safeParse<ExtractedPage[]>(d.extractionJson ?? '[]', []).filter(
          p => p.outcome === 'extracted' || (!p.outcome && p.chars > 0),
        )
        if (pages.length === 0) continue
        const secs = sectionPages(pages, { maxChars: 2600, maxSections: perDoc })
        if (secs.length === 0) continue
        const index = new SectionIndex(secs)
        const scored = index.retrieveWithScores([topic], 8)
        const top = scored.filter(x => x.score >= MIN_RELEVANCE).slice(0, docs.length === 1 ? 4 : 3).map(x => x.section)
        const chosen = top.length > 0 ? top : secs.slice(0, docs.length === 1 ? 2 : 1)
        for (const s of chosen) {
          const pageRange: number[] = []
          for (let p = s.fromPage; p <= s.toPage; p++) pageRange.push(p)
          blocks.push({ label: `${d.title} · ${s.label}`, text: s.text, pages: pageRange })
        }
      }
    }

    const groundingContext = blocks.length > 0
      ? { mode: 'document' as const, docTitle: docs.length === 1 ? docs[0].title : undefined, blocks }
      : { mode: 'general' as const, blocks: [] }

    const result = await generateStudioActivity({ kind, topic, grounding: groundingContext, responseLanguage })

    // ── Phase 3F continuity: persist the validated snapshot (best-effort) ──
    // The single primary document is recorded for history traceability when
    // the scope was exactly one document (multi-doc and hub scopes stay
    // unattributed — the same honesty rule as docTitle above).
    let activityId: string | undefined
    try {
      activityId = await saveGeneratedActivity({
        guestId,
        activity: result.activity,
        topic,
        grounding: result.grounding,
        documentId: requestedIds.length === 1 ? requestedIds[0] : null,
        documentTitle: result.docTitle ?? null,
        responseLanguage,
      })
    } catch (persistErr) {
      // Continuity must never break generation: degrade to the Phase 3E
      // ephemeral behaviour and log — no fabricated activityId is returned.
      console.error('[api/riishe/studio] activity persistence failed (non-fatal)', persistErr)
    }

    return NextResponse.json({
      activity: result.activity,
      grounding: result.grounding,
      ...(result.docTitle ? { docTitle: result.docTitle } : {}),
      responseLanguage,
      topic,
      ...(activityId ? { activityId } : {}),
    })
  } catch (err) {
    if (err instanceof StudioGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    console.error('[api/riishe/studio]', err)
    return NextResponse.json({ error: 'Something went wrong while preparing the activity. Please try again.' }, { status: 500 })
  }
}
