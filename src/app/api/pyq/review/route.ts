// ─── PYQ review (verification workflow) — Phase 2A, role-gated Phase 2B ────────
// POST /api/pyq/review — an authorised PYQ_CURATOR or ADMIN approves or rejects
// an imported PYQ row. Every other identity is refused:
//   • guests           → 401 (verification needs an accountable reviewer)
//   • plain STUDENTs   → 403 (role is checked server-side; the UI hides the
//                        workspace but never relies on that alone)
// Every decision is ALSO appended to the PyqReviewEvent audit trail (reviewer,
// role held, action, justification, timestamp) so re-reviews never erase the
// earlier decision's record.
//
// Honesty rules enforced here:
//   • APPROVE requires a written justification (10..400 chars) — a verification
//     without a reason is not a verification.
//   • APPROVE is allowed from PYQ_UNVERIFIED (first verification) and from
//     PYQ_VERIFIED (re-confirmation / re-review).
//   • REJECT is only allowed from PYQ_UNVERIFIED. An already-verified record
//     cannot be rejected from here (409) — unverifying a reviewed answer is a
//     deliberate curation action, not a one-click downgrade.
//   • ORIGINAL rows (and any non-PYQ sourceType) are never touched → 409.
//     REJECTED rows are excluded from test selection (see api/tests/start).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requirePyqCurator } from '@/lib/roles'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const REVIEW_NOTE_MAX = 400
const REVIEW_NOTE_MIN = 10

const bodySchema = z.object({
  questionId: z.string().min(1),
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(REVIEW_NOTE_MAX).optional(),
})

export async function POST(req: NextRequest) {
  try {
    // CSRF-lite guard — Phase 3A hardening: the same origin check every other
    // mutating BEAN route applies (session-cookie authenticity).
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    }
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { questionId, action, note: rawNote } = parsed.data

    // ── Role gate: PYQ curation is restricted to PYQ_CURATOR / ADMIN ──
    const guard = await requirePyqCurator()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { student } = guard

    const question = await db.question.findUnique({ where: { id: questionId } })
    if (!question) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    // Only PYQ rows are reviewable — ORIGINAL / AI-generated rows are untouchable.
    if (question.sourceType !== 'PYQ_UNVERIFIED' && question.sourceType !== 'PYQ_VERIFIED') {
      return NextResponse.json(
        { error: `Only imported PYQ rows can be reviewed — this question is ${question.sourceType}.` },
        { status: 409 },
      )
    }

    const note = rawNote?.trim() ?? ''

    if (action === 'APPROVE') {
      // A verification needs a written justification: 10..400 chars.
      if (note.length < REVIEW_NOTE_MIN) {
        return NextResponse.json(
          { error: `A verification needs a written justification of at least ${REVIEW_NOTE_MIN} characters.` },
          { status: 400 },
        )
      }
      if (note.length > REVIEW_NOTE_MAX) {
        return NextResponse.json({ error: `Review note must be at most ${REVIEW_NOTE_MAX} characters.` }, { status: 400 })
      }
      const updated = await db.$transaction(async tx => {
        const u = await tx.question.update({
          where: { id: question.id },
          data: {
            sourceType: 'PYQ_VERIFIED',
            verificationStatus: 'VERIFIED',
            reviewedBy: student.id,
            reviewedAt: new Date(),
            reviewNote: note,
          },
        })
        // Append-only audit: who verified, with which role, why, when — written
        // in the SAME transaction as the decision so the trail cannot lose it.
        await tx.pyqReviewEvent.create({
          data: {
            questionId: u.id,
            reviewerId: student.id,
            reviewerRole: student.role,
            action: 'APPROVE',
            note,
          },
        })
        return u
      })
      return NextResponse.json({
        id: updated.id,
        sourceType: updated.sourceType,
        verificationStatus: updated.verificationStatus,
      })
    }

    // action === 'REJECT' — only from the unverified state.
    if (question.sourceType === 'PYQ_VERIFIED') {
      return NextResponse.json(
        { error: 'A verified PYQ cannot be rejected here — unverification is a deliberate curation action outside this endpoint.' },
        { status: 409 },
      )
    }
    const updated = await db.$transaction(async tx => {
      const u = await tx.question.update({
        where: { id: question.id },
        data: {
          verificationStatus: 'REJECTED',
          reviewedBy: student.id,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      })
      // Append-only audit for the rejection as well (note optional here).
      await tx.pyqReviewEvent.create({
        data: {
          questionId: u.id,
          reviewerId: student.id,
          reviewerRole: student.role,
          action: 'REJECT',
          note: note || null,
        },
      })
      return u
    })
    return NextResponse.json({
      id: updated.id,
      sourceType: updated.sourceType,
      verificationStatus: updated.verificationStatus,
    })
  } catch (err) {
    console.error('[api/pyq/review]', err)
    return NextResponse.json({ error: 'Review failed — please try again.' }, { status: 500 })
  }
}
