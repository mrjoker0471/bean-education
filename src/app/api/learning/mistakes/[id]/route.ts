// PATCH /api/learning/mistakes/[id] — student self-tagging + a short note.
// The system category is never overwritten by the client; the self-tag is
// stored separately and displayed as a self-report. Ownership is enforced by
// guestId (foreign rows are 404, matching the attempts routes).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { guestIdSchema, rateLimited, pruneRateLimits } from '@/lib/learning/scope'
import { mistakeRowToDTO, normalizeStudentTag } from '@/lib/learning/mistakes'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: guestIdSchema,
  studentTag: z.enum(['CONCEPT', 'FACT', 'FORMULA', 'MISREAD']).nullable().optional(),
  note: z.string().max(280).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
    pruneRateLimits()

    const { id } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    if (rateLimited(`mistake-tag:${parsed.data.guestId}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many updates — slow down for a moment.' }, { status: 429 })
    }

    const row = await db.mistakeRecord.findUnique({ where: { id } })
    if (!row || row.guestId !== parsed.data.guestId) {
      return NextResponse.json({ error: 'Mistake record not found' }, { status: 404 })
    }

    const data: { studentTag?: string | null; note?: string | null } = {}
    if (parsed.data.studentTag !== undefined) data.studentTag = normalizeStudentTag(parsed.data.studentTag)
    if (parsed.data.note !== undefined) data.note = parsed.data.note?.trim() || null

    const updated = await db.mistakeRecord.update({ where: { id }, data })
    const timesWrong = await db.mistakeRecord.count({ where: { guestId: parsed.data.guestId, questionId: updated.questionId } })
    return NextResponse.json({ mistake: mistakeRowToDTO(updated, timesWrong) })
  } catch (err) {
    console.error('[api/learning/mistakes/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update the mistake record' }, { status: 500 })
  }
}
