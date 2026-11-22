// ─── Riishe Phase 3F: Learning Studio continuity — activity record ───────────
// GET / PATCH / DELETE /api/riishe/studio/[id]
//
// GET    — full record (validated snapshot + progress + evidence) for resume
//          or review. Touches lastAccessedAt best-effort. Never reruns
//          generation: reopening an existing activity restores it as stored.
// PATCH  — three explicit intents only (no client-supplied lifecycle status):
//            { guestId, progress }                  → save UI progress
//            { guestId, action: 'complete', responses? } → complete once
//            { guestId, action: 'abandon' }         → discard
//          Completion is server-computed and idempotent: a repeated completion
//          returns the stored summary unchanged and never re-records, so
//          double submits cannot inflate anything.
// DELETE — removes one history record (row-scoped; responses live on the row,
//          so deletion leaves no orphaned learner data).
//
// Security (same fail-closed contract as every guarded learning route):
//   - sameOrigin CSRF-lite guard on PATCH/DELETE (mutating verbs)
//   - assertLearningOwner(guestId) BEFORE any database read → foreign claimant
//     403, session/claim lookup failure 503, guest-bearer preserved
//   - every store call scopes by { id, guestId } — a valid activity id
//     belonging to a different guest is indistinguishable from a missing one
//     (404, no existence leak), so client-supplied ids cannot bypass ownership
//   - error responses carry only generic text — no activity, response, answer
//     or progress data ever leaks

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sameOrigin } from '@/lib/auth'
import { assertLearningOwner } from '@/lib/learning/scope'
import {
  getStudioActivity,
  saveStudioProgress,
  completeStudioActivity,
  abandonStudioActivity,
  deleteStudioActivity,
  StudioStoreError,
} from '@/lib/riishe/studio-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const guestIdSchema = z.string().min(8).max(64)
const idSchema = z.string().min(1).max(64)

const patchSchema = z.object({
  guestId: guestIdSchema,
  /** Save UI progress (per-kind validated server-side against the snapshot). */
  progress: z.unknown().optional(),
  /** Explicit completion: carries learner responses where the kind has them. */
  action: z.enum(['complete', 'abandon']).optional(),
  responses: z.unknown().optional(),
})

function storeErrorResponse(err: unknown) {
  if (err instanceof StudioStoreError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('[api/riishe/studio/[id]]', err)
  return NextResponse.json({ error: 'Something went wrong with this activity. Please try again.' }, { status: 500 })
}

// GET — the full record for one owned activity.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const params = Object.fromEntries(new URL(req.url).searchParams)
  const parsed = z.object({ guestId: guestIdSchema }).safeParse(params)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Fail-closed ownership gate — BEFORE any database read.
  const owner = await assertLearningOwner(parsed.data.guestId)
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status })
  }

  try {
    const record = await getStudioActivity(parsed.data.guestId, id)
    if (!record) {
      return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
    }
    return NextResponse.json({ record })
  } catch (err) {
    return storeErrorResponse(err)
  }
}

// PATCH — progress save / complete / abandon (explicit intents only).
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  let body: z.infer<typeof patchSchema>
  try {
    const parsed = patchSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Fail-closed ownership gate — BEFORE any database read.
  const owner = await assertLearningOwner(body.guestId)
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status })
  }

  try {
    if (body.action === 'complete') {
      const { record, alreadyCompleted } = await completeStudioActivity(body.guestId, id, body.responses ?? null)
      return NextResponse.json({ record, alreadyCompleted })
    }
    if (body.action === 'abandon') {
      await abandonStudioActivity(body.guestId, id)
      return NextResponse.json({ ok: true })
    }
    if (body.progress !== undefined || body.responses !== undefined) {
      await saveStudioProgress(body.guestId, id, body.progress, body.responses)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (err) {
    return storeErrorResponse(err)
  }
}

// DELETE — remove one owned history record.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  let guestId: string | undefined
  try {
    const parsed = z.object({ guestId: guestIdSchema }).safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    guestId = parsed.data.guestId
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Fail-closed ownership gate — BEFORE any database read.
  const owner = await assertLearningOwner(guestId)
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status })
  }

  try {
    await deleteStudioActivity(guestId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return storeErrorResponse(err)
  }
}
