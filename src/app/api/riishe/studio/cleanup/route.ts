// ─── Riishe Phase 3H: user-initiated Studio history cleanup ──────────────────
// POST /api/riishe/studio/cleanup
//
// Two explicit intents in one guarded endpoint:
//   { guestId, olderThanDays }                        → PREVIEW (no deletion):
//       returns the exact number of records the confirmed cleanup would
//       remove, the cutoff actually used, and the fixed scope note.
//   { guestId, olderThanDays, confirm: 'CLEANUP' }    → CONFIRMED CLEANUP:
//       deletes AT MOST one bounded batch (500) of matching records and
//       reports the truthful deleted/remaining counts.
//
// Scope (fixed by design, stated in every preview):
//   - rows owned by THIS guestId (the same ownership scope every Studio
//     endpoint uses — claimed rows keep their guestId, so claimed history is
//     included exactly like the history list);
//   - status COMPLETED or ABANDONED only — IN_PROGRESS is never cleaned up;
//   - not updated since the cutoff (updatedAt < now - olderThanDays).
//
// Safety contract:
//   - sameOrigin CSRF-lite guard (mutating POST);
//   - assertLearningOwner(guestId) BEFORE any database read — foreign
//     claimant 403, thrown session lookup 503, guest-bearer preserved;
//   - the deletion re-asserts the FULL scope (ownership + status + cutoff) in
//     its WHERE clause in addition to the selected id list, so neither a
//     repeated request nor a concurrent request can delete out-of-scope rows;
//   - bounded batch (CLEANUP_BATCH_MAX) — every request is a bounded,
//     server-side database operation; `remaining` lets the learner repeat
//     deliberately instead of one unbounded bulk delete;
//   - truthful results: a failed delete surfaces as an error, never as a
//     success with guessed counts;
//   - NO automatic execution, NO background scheduler — cleanup runs only
//     when the user confirms it here. The retention preference never deletes
//     anything by itself.
//
// There is no DELETE of a foreign id here and no existence leak: all matching
// logic is scoped by guestId, and errors carry only generic text.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { sameOrigin } from '@/lib/auth'
import { assertLearningOwner, pruneRateLimits, rateLimited } from '@/lib/learning/scope'
import {
  previewStudioCleanup,
  confirmStudioCleanup,
  StudioStoreError,
  CLEANUP_BATCH_MAX,
  CLEANUP_SCOPE_NOTE,
} from '@/lib/riishe/studio-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Cleanup is cheap but destructive-adjacent: 6 requests / 10 min / owner. */
const CLEANUP_RATE = { windowMs: 10 * 60_000, max: 6 }

const bodySchema = z.object({
  guestId: z.string().min(8).max(64),
  olderThanDays: z.union([
    z.literal(30),
    z.literal(90),
    z.literal(180),
    z.literal(365),
  ]),
  /** Explicit confirmation constant — anything else is treated as a preview. */
  confirm: z.literal('CLEANUP').optional(),
})

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked' }, { status: 403 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  pruneRateLimits()
  if (rateLimited(`studio-cleanup:${body.guestId}`, CLEANUP_RATE.max, CLEANUP_RATE.windowMs)) {
    return NextResponse.json(
      { error: 'Too many cleanup requests in a row. Please try again in a few minutes.' },
      { status: 429 },
    )
  }

  // Fail-closed ownership gate — BEFORE any database read. Same 403/503
  // contract as every guarded Studio route.
  const owner = await assertLearningOwner(body.guestId)
  if (!owner.ok) {
    return NextResponse.json({ error: owner.error }, { status: owner.status })
  }

  try {
    if (body.confirm === 'CLEANUP') {
      const result = await confirmStudioCleanup(body.guestId, body.olderThanDays)
      return NextResponse.json({
        ok: true,
        deleted: result.deleted,
        remaining: result.remaining,
        olderThanDays: result.olderThanDays,
        cutoff: result.cutoff.toISOString(),
        scopeNote: CLEANUP_SCOPE_NOTE,
        batchMax: CLEANUP_BATCH_MAX,
      })
    }
    const preview = await previewStudioCleanup(body.guestId, body.olderThanDays)
    return NextResponse.json({
      preview: true,
      olderThanDays: preview.olderThanDays,
      cutoff: preview.cutoff.toISOString(),
      affected: preview.affected,
      scopeNote: preview.scopeNote,
      batchMax: CLEANUP_BATCH_MAX,
    })
  } catch (err) {
    if (err instanceof StudioStoreError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[api/riishe/studio/cleanup]', err)
    return NextResponse.json({ error: 'Could not complete the cleanup. Please try again.' }, { status: 500 })
  }
}
