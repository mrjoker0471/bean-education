import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { queueOnce } from '@/lib/riishe/jobs'
import { processDocument } from '@/lib/riishe/pipeline'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const retrySchema = z.object({ guestId: z.string().min(8).max(64) })

// POST — retry a FAILED processing job (owner only; READY/NEEDS_OCR need no retry)
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const parsed = retrySchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const doc = await db.studyDocument.findUnique({ where: { id } })
    if (!doc || doc.guestId !== parsed.data.guestId) {
      return NextResponse.json({ error: 'Material not found' }, { status: 404 })
    }
    if (doc.status === 'NEEDS_OCR') {
      return NextResponse.json({ error: 'This document has no extractable text (scanned images) — OCR is not available yet, so retrying cannot help.' }, { status: 409 })
    }
    if (!['FAILED', 'QUEUED'].includes(doc.status)) {
      return NextResponse.json({ error: 'This document is already processed or processing.' }, { status: 409 })
    }

    await db.studyDocument.update({
      where: { id },
      data: { status: 'QUEUED', statusDetail: 'Queued for a retry…' },
    })
    void queueOnce(doc.guestId, `doc:${id}`, () => processDocument(id))
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/materials/[id]/retry]', err)
    return NextResponse.json({ error: 'Could not retry processing' }, { status: 500 })
  }
}
