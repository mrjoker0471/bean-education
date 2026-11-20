// ─── Research candidate promotion (Phase 3A) ─────────────────────────────────
// POST — a curator moves one SOURCE_CHECKED candidate into the existing review
// queue as a PYQ_UNVERIFIED Question. This endpoint deliberately does NOT and
// CANNOT verify anything: only /api/pyq/review can approve a question, and its
// contract (mandatory justification, append-only audit, role gate) is the sole
// verification authority.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requirePyqCurator } from '@/lib/roles'
import { promoteCandidate } from '@/lib/pyq-candidates'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  text: z.string().max(2000).optional(),
  options: z.array(z.string().max(500)).max(6).optional(),
  correctIndex: z.number().int().min(0).max(5).optional(),
  explanation: z.string().max(4000).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  language: z.string().max(60).optional(),
  year: z.number().int().min(1990).max(2035).optional(),
  examSlug: z.string().max(120).optional(),
  stageId: z.string().optional(),
  subjectId: z.string().optional(),
  topicId: z.string().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // CSRF-lite: the same guard every other mutating BEAN route applies.
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }
  try {
    const guard = await requirePyqCurator()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const { id } = await params
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid promotion payload' }, { status: 400 })
    }

    const result = await promoteCandidate(guard.student, id, parsed.data)
    if (!result.ok) {
      return NextResponse.json({ error: result.error, ...(result.duplicateOf ? { duplicateOf: result.duplicateOf } : {}) }, { status: result.status })
    }
    return NextResponse.json({ questionId: result.questionId, batchId: result.batchId })
  } catch (err) {
    console.error('[api/pyq/candidates/[id]/promote POST]', err)
    return NextResponse.json({ error: 'Could not promote the candidate.' }, { status: 500 })
  }
}
