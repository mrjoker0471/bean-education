// ─── Riishe Deep Research sessions (Phase 3A) ────────────────────────────────
// POST starts a research run (quota-gated, durable job), GET lists the
// owner's sessions. Ownership follows the Riishe guest-identity model and is
// migrated to the student on sign-in claim, exactly like documents/tests.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { enqueueJob, recoverStaleResearch, reserveQuota, releaseQuota } from '@/lib/riishe/jobs'
import type { ResearchProgressDTO } from '@/lib/riishe/research'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const postSchema = z.object({
  guestId: z.string().min(8).max(64),
  kind: z.enum(['EXAM_PYQ', 'TOPIC', 'QUESTION', 'CONCEPT']),
  examSlug: z.string().max(120).optional(),
  examLabel: z.string().max(200).optional(),
  subjectLabel: z.string().max(200).optional(),
  topicLabel: z.string().max(200).optional(),
  yearFrom: z.number().int().min(1990).max(2035).optional(),
  yearTo: z.number().int().min(1990).max(2035).optional(),
  question: z.string().max(600).optional(),
  focusNote: z.string().max(300).optional(),
  documentIds: z.array(z.string().min(1)).max(3).optional(),
})

const listQuerySchema = z.object({
  guestId: z.string().min(8).max(64),
})

function sessionTitle(input: z.infer<typeof postSchema>): string {
  const parts: string[] = []
  if (input.examLabel) parts.push(input.examLabel)
  if (input.subjectLabel) parts.push(input.subjectLabel)
  if (input.topicLabel) parts.push(input.topicLabel)
  if (input.question) parts.push(input.question.slice(0, 60))
  const base = parts.filter(Boolean).join(' · ')
  if (base) return base.slice(0, 140)
  const yearPart = input.yearFrom || input.yearTo ? ` (${input.yearFrom ?? ''}–${input.yearTo ?? ''})` : ''
  return `${input.kind === 'EXAM_PYQ' ? 'Previous-year research' : input.kind === 'CONCEPT' ? 'Concept research' : 'Subject research'}${yearPart}`
}

export async function POST(req: NextRequest) {
  // Phase 3B fix: track the reservation so a failed start (e.g. session
  // creation throws) releases the slot instead of silently burning one of
  // the 6 hourly research runs.
  let reservedResearchFor: string | null = null
  try {
    const parsed = postSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid research brief' }, { status: 400 })
    }
    const input = parsed.data

    // Exam honesty: a named examSlug must resolve against the catalogue.
    let examLabel = input.examLabel?.trim() ?? undefined
    if (input.examSlug) {
      const exam = await db.exam.findUnique({ where: { slug: input.examSlug }, select: { slug: true, name: true } })
      if (!exam) {
        return NextResponse.json({ error: 'Unknown examination — choose one from the examination catalogue.' }, { status: 400 })
      }
      examLabel = examLabel || exam.name
    }

    // Attached materials must belong to the guest and be READY.
    const documentIds = input.documentIds ?? []
    if (documentIds.length) {
      const docs = await db.studyDocument.findMany({
        where: { id: { in: documentIds }, guestId: input.guestId },
        select: { id: true, status: true },
      })
      if (docs.length !== documentIds.length) {
        return NextResponse.json({ error: 'One or more attached materials were not found.' }, { status: 404 })
      }
      if (docs.some(d => d.status !== 'READY')) {
        return NextResponse.json({ error: 'Attached materials must finish processing before a research run.' }, { status: 409 })
      }
    }

    if (input.kind === 'EXAM_PYQ' && !input.examSlug && !input.examLabel) {
      return NextResponse.json({ error: 'Previous-year discovery needs an examination — choose one from the catalogue.' }, { status: 400 })
    }

    // Hourly research quota (6/hour) — honest 429, same convention as generate.
    const ok = await reserveQuota(input.guestId, 'research')
    if (!ok) {
      return NextResponse.json(
        { error: 'Hourly limit reached for research runs (6/hour). Please try again later.' },
        { status: 429 },
      )
    }
    reservedResearchFor = input.guestId

    const session = await db.researchSession.create({
      data: {
        guestId: input.guestId,
        title: sessionTitle({ ...input, examLabel }),
        kind: input.kind,
        inputJson: JSON.stringify(input),
        documentIdsJson: documentIds.length ? JSON.stringify(documentIds) : null,
        progressJson: JSON.stringify({
          stages: [{ stage: 'plan', state: 'PENDING' }],
          sourcesDiscovered: 0,
          sourcesChecked: 0,
          sourcesUnavailable: 0,
          searchesUsed: 0,
          fetchesUsed: 0,
          llmCallsUsed: 0,
          candidatesFound: 0,
          updatedAt: new Date().toISOString(),
        } satisfies ResearchProgressDTO),
      },
    })

    void enqueueJob({ kind: 'DEEP_RESEARCH', refId: session.id, ownerId: input.guestId })
    // The durable job now owns the run — the reservation stays consumed.
    reservedResearchFor = null

    return NextResponse.json({ sessionId: session.id }, { status: 201 })
  } catch (err) {
    if (reservedResearchFor) {
      await releaseQuota(reservedResearchFor, 'research').catch(() => undefined)
    }
    console.error('[api/riishe/research POST]', err)
    return NextResponse.json({ error: 'Could not start the research run.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { guestId } = parsed.data
    await recoverStaleResearch()

    const sessions = await db.researchSession.findMany({
      where: { guestId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { _count: { select: { sources: true } } },
    })
    const candidateCounts = await db.researchPyqCandidate.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessions.map(s => s.id) }, status: { not: 'DISCARDED' } },
      _count: { _all: true },
    })
    const candidateBySession = new Map(candidateCounts.map(c => [c.sessionId, c._count._all]))

    return NextResponse.json({
      sessions: sessions.map(s => {
        const progress = safeProgress(s.progressJson)
        return {
          id: s.id,
          title: s.title,
          kind: s.kind,
          status: s.status,
          statusDetail: s.statusDetail,
          createdAt: s.createdAt.toISOString(),
          finishedAt: s.finishedAt?.toISOString() ?? null,
          sourcesCount: s._count.sources,
          candidatesCount: candidateBySession.get(s.id) ?? 0,
          progress: progress
            ? {
                stages: progress.stages,
                searchesUsed: progress.searchesUsed,
                fetchesUsed: progress.fetchesUsed,
                llmCallsUsed: progress.llmCallsUsed,
              }
            : null,
        }
      }),
    })
  } catch (err) {
    console.error('[api/riishe/research GET]', err)
    return NextResponse.json({ error: 'Could not load research sessions.' }, { status: 500 })
  }
}

function safeProgress(raw: string | null): ResearchProgressDTO | null {
  try {
    const parsed = JSON.parse(raw ?? 'null') as ResearchProgressDTO | null
    return parsed && Array.isArray(parsed.stages) ? parsed : null
  } catch {
    return null
  }
}
