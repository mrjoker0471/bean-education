import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { recoverStaleTests, queueOnce } from '@/lib/riishe/jobs'
import { generateTestJob } from '@/lib/riishe/generate'
import { DEFAULT_DISTRIBUTION } from '@/lib/riishe/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  documentId: z.string().min(6),
  focusTopics: z.array(z.string().max(120)).max(5).optional(),
  weakFocus: z.boolean().optional(),
  timed: z.boolean().optional(),
  count: z.number().int().min(4).max(50).optional(),
})

// POST — create a RiisheTest and kick the generation job.
// Duplicate protection: a QUEUED/GENERATING test for the same scope returns the
// existing test instead of spawning a second job.
export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId, documentId, focusTopics, weakFocus, timed } = parsed.data

    const doc = await db.studyDocument.findUnique({ where: { id: documentId } })
    if (!doc || doc.guestId !== guestId) {
      return NextResponse.json({ error: 'Material not found' }, { status: 404 })
    }
    if (doc.status === 'NEEDS_OCR') {
      return NextResponse.json({ error: 'This document has no extractable text (scanned images) — Riishe cannot generate questions from it.' }, { status: 409 })
    }
    if (doc.status !== 'READY') {
      return NextResponse.json({ error: 'Riishe is still analysing this document — wait for it to be Ready, then generate the test.' }, { status: 409 })
    }

    await recoverStaleTests()

    const focus = (focusTopics ?? []).filter(Boolean)
    const scopeKey = `gen:${documentId}:${focus.slice().sort().join('|')}:${weakFocus ? 'weak' : 'all'}`
    const inFlight = await db.riisheTest.findFirst({
      where: { documentId, guestId, status: { in: ['QUEUED', 'GENERATING'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (inFlight) {
      // A generation for this document is already running — return it (idempotent retry)
      return NextResponse.json({ testId: inFlight.id, existing: true })
    }

    const count = parsed.data.count ?? 50
    const durationMin = timed === false ? 0 : Math.max(10, count) // 1 min/question for timed; 0 = untimed

    const test = await db.riisheTest.create({
      data: {
        guestId,
        documentId,
        title: buildTitle(doc.title, focus, weakFocus ?? false),
        status: 'QUEUED',
        statusDetail: 'Queued — generation starts shortly…',
        focusTopicsJson: JSON.stringify(focus),
        weakFocus: weakFocus ?? false,
        requestedCount: count,
        configJson: JSON.stringify({
          timed: timed !== false,
          durationMin,
          marksPerQuestion: 1,
          negativeMark: 0,
        }),
        distributionJson: JSON.stringify(scaleDistribution(count)),
      },
    })

    void queueOnce(guestId, `test:${test.id}`, () => generateTestJob(test.id))

    return NextResponse.json({ testId: test.id, scopeKey: void 0 })
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

function scaleDistribution(count: number): Record<string, number> {
  const scale = count / 50
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(DEFAULT_DISTRIBUTION)) {
    out[k] = Math.max(1, Math.round(v * scale))
  }
  return out
}
