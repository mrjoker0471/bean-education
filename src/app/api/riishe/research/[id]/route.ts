// ─── Research session detail (Phase 3A) ──────────────────────────────────────
// GET returns the full research workspace state: session, per-source lifecycle
// (class, status, evidence, conflicts), findings, summary, candidates and the
// real cost counters. DELETE cancels an in-flight run or removes a finished
// session (candidate curation records survive by design — they carry their own
// provenance and remain visible in the curator queue).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { cancelJob, recoverStaleResearch } from '@/lib/riishe/jobs'
import type { ResearchFindingDTO, ResearchProgressDTO, ResearchSummaryDTO, ResearchEvidenceDTO } from '@/lib/riishe/research'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const idSchema = z.object({ id: z.string().min(1) })
const querySchema = z.object({ guestId: z.string().min(8).max(64) })

function parseJson<T>(raw: string | null, fallback: T): T {
  try {
    return JSON.parse(raw ?? '') as T
  } catch {
    return fallback
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = idSchema.parse(await params)
    const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!q.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { guestId } = q.data

    await recoverStaleResearch([id])
    const session = await db.researchSession.findFirst({
      where: { id, guestId },
      include: { _count: { select: { sources: true } } },
    })
    if (!session) {
      return NextResponse.json({ error: 'Research session not found' }, { status: 404 })
    }

    const sources = await db.researchSource.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } })
    const candidates = await db.researchPyqCandidate.findMany({ where: { sessionId: id, status: { not: 'DISCARDED' } }, orderBy: { createdAt: 'asc' } })

    return NextResponse.json({
      session: {
        id: session.id,
        title: session.title,
        kind: session.kind,
        status: session.status,
        statusDetail: session.statusDetail,
        input: parseJson<Record<string, unknown>>(session.inputJson, {}),
        progress: parseJson<ResearchProgressDTO | null>(session.progressJson, null),
        findings: parseJson<ResearchFindingDTO[]>(session.findingsJson, []),
        summary: parseJson<ResearchSummaryDTO | null>(session.summaryJson, null),
        followUps: parseJson<string[]>(session.followUpsJson, []),
        searchesUsed: session.searchesUsed,
        fetchesUsed: session.fetchesUsed,
        llmCallsUsed: session.llmCallsUsed,
        createdAt: session.createdAt.toISOString(),
        finishedAt: session.finishedAt?.toISOString() ?? null,
        sourcesCount: session._count.sources,
      },
      sources: sources.map(s => ({
        id: s.id,
        url: s.url,
        title: s.title,
        host: s.host,
        kind: s.kind,
        documentId: s.documentId,
        sourceClass: s.sourceClass,
        classReason: s.classReason,
        status: s.status,
        reachable: s.reachable,
        httpStatus: s.httpStatus,
        contentKind: s.contentKind,
        publishedDate: s.publishedDate,
        retrievedAt: s.retrievedAt?.toISOString() ?? null,
        snippet: s.snippet,
        evidence: parseJson<ResearchEvidenceDTO[]>(s.evidenceJson, []),
        conflictFlag: s.conflictFlag,
        rightsNote: s.rightsNote,
        notes: parseJson<Record<string, unknown> | null>(s.notesJson, null),
      })),
      candidates: candidates.map(c => ({
        id: c.id,
        status: c.status,
        examLabel: c.examLabel,
        examSlug: c.examSlug,
        subjectLabel: c.subjectLabel,
        year: c.year,
        sessionLabel: c.sessionLabel,
        questionNumber: c.questionNumber,
        paperTitle: c.paperTitle,
        sourceUrl: c.sourceUrl,
        sourceTitle: c.sourceTitle,
        sourcePublisher: c.sourcePublisher,
        sourceClass: c.sourceClass,
        retrievedAt: c.retrievedAt?.toISOString() ?? null,
        locator: c.locator,
        proposedCorrectIndex: c.proposedCorrectIndex,
        hasVerbatim: !!c.verbatimText,
        rightsStatus: c.rightsStatus,
        rightsNote: c.rightsNote,
        verificationNote: c.verificationNote,
        conflictNote: c.conflictNote,
        evidence: parseJson<ResearchEvidenceDTO[]>(c.evidenceJson, []),
        promotedQuestionId: c.promotedQuestionId,
      })),
    })
  } catch (err) {
    console.error('[api/riishe/research/[id] GET]', err)
    return NextResponse.json({ error: 'Could not load the research session.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = idSchema.parse(await params)
    const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!q.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { guestId } = q.data

    const session = await db.researchSession.findFirst({ where: { id, guestId }, select: { id: true, status: true } })
    if (!session) {
      return NextResponse.json({ error: 'Research session not found' }, { status: 404 })
    }

    await cancelJob('DEEP_RESEARCH', id)
    // ResearchSource rows cascade; ResearchPyqCandidate rows survive by design.
    await db.researchSession.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/riishe/research/[id] DELETE]', err)
    return NextResponse.json({ error: 'Could not delete the research session.' }, { status: 500 })
  }
}
