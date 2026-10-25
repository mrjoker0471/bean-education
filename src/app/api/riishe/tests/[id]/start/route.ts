import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const bodySchema = z.object({ guestId: z.string().min(8).max(64) })

// POST — start (or resume) an exam session from a READY Riishe test.
// The attempt copies the validated question ids; scoring stays server-side and
// the existing /api/attempts engine handles the session.
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { guestId } = parsed.data

    const test = await db.riisheTest.findUnique({ where: { id }, include: { document: true } })
    if (!test || test.guestId !== guestId) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 })
    }
    if (test.status !== 'READY' || !test.questionIdsJson) {
      return NextResponse.json({ error: 'This test is not ready yet.' }, { status: 409 })
    }

    // Resume: an unfinished attempt for this exact test returns itself
    const existing = await db.attempt.findFirst({
      where: { guestId, riisheTestId: id, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
    })
    if (existing) {
      const config = safeCfg(test.configJson)
      const expires = existing.startedAt.getTime() + (config.timed ? (config.durationMin + 5) * 60_000 : 24 * 3600_000)
      if (Date.now() < expires) {
        return NextResponse.json({ attemptId: existing.id, resumed: true })
      }
      await db.attempt.update({ where: { id: existing.id }, data: { status: 'ABANDONED' } })
    }

    const questionIds = safeArr(test.questionIdsJson)
    const config = safeCfg(test.configJson)
    if (questionIds.length < 1) {
      return NextResponse.json({ error: 'This test has no validated questions.' }, { status: 409 })
    }

    const attempt = await db.attempt.create({
      data: {
        guestId,
        source: 'RIISHE',
        documentId: test.documentId,
        riisheTestId: test.id,
        examId: null,
        examLabel: 'Riishe AI',
        title: test.title,
        configJson: JSON.stringify(config),
        questionIdsJson: JSON.stringify(questionIds),
        answersJson: JSON.stringify({}),
        status: 'IN_PROGRESS',
      },
    })

    return NextResponse.json({ attemptId: attempt.id, resumed: false })
  } catch (err) {
    console.error('[api/riishe/tests/[id]/start]', err)
    return NextResponse.json({ error: 'Could not start the test' }, { status: 500 })
  }
}

function safeArr(json: string | null): string[] {
  if (!json) return []
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : [] } catch { return [] }
}
function safeCfg(json: string) {
  try { return JSON.parse(json) } catch { return { timed: true, durationMin: 50, marksPerQuestion: 1, negativeMark: 0 } }
}
