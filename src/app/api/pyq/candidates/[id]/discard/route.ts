// ─── Research candidate discard (Phase 3A) ───────────────────────────────────
// POST — marks a candidate DISCARDED. Allowed for:
//   • curators (any non-promoted candidate), or
//   • the candidate's own owner (guest match) for non-promoted candidates.
// PROMOTED candidates can never be discarded — they already carry curation
// state tied to a real Question row.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sameOrigin, requireStudent } from '@/lib/auth'
import { hasRole, PYQ_CURATOR_ROLES } from '@/lib/roles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  guestId: z.string().min(8).max(64).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  }
  try {
    const { id } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    const guestId = parsed.success ? parsed.data.guestId : undefined

    const student = await requireStudent()
    const isCurator = !!student && hasRole(student.role, PYQ_CURATOR_ROLES)
    if (!student && !guestId) {
      return NextResponse.json({ error: 'Sign in required to discard candidates.' }, { status: 401 })
    }

    const candidate = await db.researchPyqCandidate.findUnique({ where: { id }, select: { id: true, status: true, guestId: true } })
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }
    if (candidate.status === 'PROMOTED') {
      return NextResponse.json({ error: 'A promoted candidate is part of the curation record and cannot be discarded.' }, { status: 409 })
    }

    if (isCurator) {
      // Curators may discard any non-promoted candidate.
    } else if (guestId && candidate.guestId === guestId) {
      // Owners may discard their own candidate.
    } else {
      return NextResponse.json({ error: 'You can only discard your own candidates.' }, { status: 403 })
    }

    await db.researchPyqCandidate.update({
      where: { id },
      data: { status: 'DISCARDED' },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/pyq/candidates/[id]/discard POST]', err)
    return NextResponse.json({ error: 'Could not discard the candidate.' }, { status: 500 })
  }
}
