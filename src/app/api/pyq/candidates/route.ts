// ─── Research PYQ candidate queue (Phase 3A) ─────────────────────────────────
// GET — the curator's discovery queue. Curator-only (requirePyqCurator), like
// every other /api/pyq route. Candidates are provenance records from web
// research: they carry NO student documents and NO personal data — only
// public-web source metadata, evidence excerpts and the research metadata.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePyqCurator } from '@/lib/roles'
import type { ResearchEvidenceDTO } from '@/lib/riishe/research'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const querySchema = z.object({
  status: z.enum(['DISCOVERED', 'SOURCE_CHECKED', 'PROMOTED', 'DISCARDED']).optional(),
  year: z.coerce.number().int().min(1990).max(2035).optional(),
  q: z.string().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

function parseEvidence(raw: string): ResearchEvidenceDTO[] {
  try {
    const parsed = JSON.parse(raw) as ResearchEvidenceDTO[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePyqCurator()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const q = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!q.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { status, year, limit, offset } = q.data
    const text = q.data.q?.trim()

    const where = {
      ...(status ? { status } : { status: { in: ['DISCOVERED', 'SOURCE_CHECKED'] } }),
      ...(year ? { year } : {}),
      ...(text ? { OR: [{ verbatimText: { contains: text } }, { evidenceJson: { contains: text } }, { paperTitle: { contains: text } }] } : {}),
    }

    const [rows, counts] = await Promise.all([
      db.researchPyqCandidate.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      db.researchPyqCandidate.groupBy({ by: ['status'], _count: { _all: true } }),
    ])

    const byStatus = Object.fromEntries(counts.map(c => [c.status, c._count._all]))

    return NextResponse.json({
      candidates: rows.map(c => ({
        id: c.id,
        status: c.status,
        examLabel: c.examLabel,
        examSlug: c.examSlug,
        subjectLabel: c.subjectLabel,
        topicLabel: c.topicLabel,
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
        answerKeyUrl: c.answerKeyUrl,
        answerKeyRef: c.answerKeyRef,
        proposedCorrectIndex: c.proposedCorrectIndex,
        hasOptions: !!c.optionsJson,
        verbatimText: c.rightsStatus === 'VERBATIM_PERMITTED' ? c.verbatimText : null,
        evidence: parseEvidence(c.evidenceJson),
        rightsStatus: c.rightsStatus,
        rightsNote: c.rightsNote,
        verificationNote: c.verificationNote,
        conflictNote: c.conflictNote,
        promotedQuestionId: c.promotedQuestionId,
        createdAt: c.createdAt.toISOString(),
      })),
      counts: {
        DISCOVERED: byStatus['DISCOVERED'] ?? 0,
        SOURCE_CHECKED: byStatus['SOURCE_CHECKED'] ?? 0,
        PROMOTED: byStatus['PROMOTED'] ?? 0,
        DISCARDED: byStatus['DISCARDED'] ?? 0,
      },
      limit,
      offset,
    })
  } catch (err) {
    console.error('[api/pyq/candidates GET]', err)
    return NextResponse.json({ error: 'Could not load the candidate queue.' }, { status: 500 })
  }
}
