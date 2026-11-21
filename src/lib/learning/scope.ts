// ─── Learning API shared helpers (Phase 3B) ──────────────────────────────────
// Scope follows the app-wide guest-identity convention used by /api/progress
// and /api/attempts: the working identity is the guestId param (8-64 chars),
// validated with zod everywhere. Mutating routes add the sameOrigin CSRF-lite
// guard plus a per-owner in-memory rate limit, matching the existing pattern
// used by the Riishe chat routes (no middleware exists in this app by design).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionStudent } from '@/lib/auth'

export const guestIdSchema = z.string().min(8).max(64)

/** Parse + validate the guestId query param; null when missing/invalid. */
export function guestIdFromQuery(req: NextRequest): string | null {
  const raw = new URL(req.url).searchParams.get('guestId')
  if (!raw) return null
  const parsed = guestIdSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ─── In-memory rate limiter (per owner + bucket) ───────────────────────────────
// Mirrors the ad-hoc limiter pattern in src/app/api/riishe/chat/route.ts.

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = buckets.get(key)
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count++
  if (entry.count > limit) return true
  return false
}

// Prune occasionally so the map cannot grow unbounded in a long-lived process.
const MAX_BUCKETS = 5000
export function pruneRateLimits(): void {
  if (buckets.size < MAX_BUCKETS) return
  const now = Date.now()
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
}

// ─── Learner-local day keys (YYYY-MM-DD) ───────────────────────────────────────
// Every day-keyed surface (daily plans, revision due state, observed-activity
// grouping) is computed in an EXPLICIT timezone — never the accidental
// host/container timezone. Product default: Asia/Kolkata (the app's exam
// audience; a fixed +05:30 offset with no DST, so day boundaries are stable
// year-round). A client may pass its own IANA zone per request ("learner
// timezone"); it is validated here and falls back to the product default when
// missing or malformed. The policy is documented in
// docs/PHASE3B_PERSONAL_LEARNING_INTELLIGENCE.md (§ Timezone policy).

export const PRODUCT_TIMEZONE = 'Asia/Kolkata'

// IANA zone ids: Area/Place segments — no separators that could smuggle paths
// or expressions; bounded length. Anything else (or an unknown zone) falls
// back to the documented product default.
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+-]{1,40}(\/[A-Za-z0-9_+-]{1,40}){0,3}$/

/** Validate an untrusted timezone identifier; the product default otherwise. */
export function resolveLearnerTimezone(raw: string | null | undefined): string {
  if (!raw || raw.length > 64 || !TIMEZONE_PATTERN.test(raw)) return PRODUCT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: raw }) // throws for unknown zones
    return raw
  } catch {
    return PRODUCT_TIMEZONE
  }
}

const dayKeyFormatterCache = new Map<string, Intl.DateTimeFormat>()
function dayKeyFormatter(tz: string): Intl.DateTimeFormat {
  let f = dayKeyFormatterCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayKeyFormatterCache.set(tz, f)
  }
  return f
}

const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>()
function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = offsetFormatterCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    offsetFormatterCache.set(tz, f)
  }
  return f
}

/** Milliseconds that `tz` is ahead of UTC at the given instant. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const parts: Record<string, number> = {}
  for (const p of offsetFormatter(tz).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
  return asUTC - instant.getTime()
}

/** The calendar date (YYYY-MM-DD) of instant `d` as seen in `tz`. */
export function dateKeyOf(d: Date, tz: string = PRODUCT_TIMEZONE): string {
  return dayKeyFormatter(tz).format(d)
}

export function todayKey(tz: string = PRODUCT_TIMEZONE): string {
  return dateKeyOf(new Date(), tz)
}

/** Parse YYYY-MM-DD into the instant of that day's local midnight in `tz`; null when invalid. */
export function dateKeyStart(key: string, tz: string = PRODUCT_TIMEZONE): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [y, m, d] = key.split('-').map(Number)
  const naiveMs = Date.UTC(y, m - 1, d)
  const naive = new Date(naiveMs)
  if (naive.getUTCFullYear() !== y || naive.getUTCMonth() !== m - 1 || naive.getUTCDate() !== d) return null
  // Wall-clock midnight → instant: subtract the zone's offset at that wall
  // clock, then refine once (covers zones whose offset changes at midnight).
  const offset = zoneOffsetMs(naive, tz)
  const first = new Date(naiveMs - offset)
  const refined = zoneOffsetMs(first, tz)
  return refined === offset ? first : new Date(naiveMs - refined)
}

/** The instant of the day AFTER `key` at local midnight in `tz` (DST-safe). */
export function dateKeyEnd(key: string, tz: string = PRODUCT_TIMEZONE): Date | null {
  return dateKeyStart(shiftDateKey(key, 1), tz)
}

/** Pure calendar arithmetic on the key itself (month lengths / leap years included). */
export function shiftDateKey(key: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return key
  const shifted = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

// ─── Claimed-account resolution ────────────────────────────────────────────────
// Goals and preferences live on Student (studentId-only), while the learning
// tables are guestId-first. When a guest identity has been claimed, its rows
// carry the account id — resolve it from the most recent attempt (attempts are
// the one table every learner journey writes).

export async function claimedStudentIdFor(guestId: string): Promise<string | null> {
  const row = await db.attempt.findFirst({
    where: { guestId },
    select: { studentId: true },
    orderBy: { startedAt: 'desc' },
  })
  return row?.studentId ?? null
}

// ─── Ownership guard (guest-bearer + claim model) ──────────────────────────────
// The learning API is guest-first: the guestId is an opaque bearer identifier
// held by the client — the SAME product contract as /api/progress and
// /api/attempts (and it is honestly described that way in the docs; these
// routes are NOT session-bound for unclaimed guests).
//
// Where the existing claim model allows a real check, it is enforced: when a
// SIGNED-IN session exists, a guest identity that has been CLAIMED by a
// different account is rejected (403). Claimed identities carry the claimant's
// studentId on their rows (claim-guest stamps every owned table), and attempts
// are the one table every learner journey writes, so the claimant is resolved
// from there (same helper the planner uses). Unclaimed guest identities keep
// working for guests and for a signed-in learner before they claim.
//
// No client-supplied studentId exists in any learning request schema — the
// account side of the check always comes from the server-side session.
export type LearningOwnerCheck = { ok: true } | { ok: false; status: number; error: string }

export async function assertLearningOwner(guestId: string): Promise<LearningOwnerCheck> {
  let sessionStudentId: string | null = null
  try {
    const student = await getSessionStudent()
    sessionStudentId = student?.id ?? null
  } catch {
    // No request scope (direct handler invocation outside Next's context, e.g.
    // route tests without an auth mock) → behave as the pure guest context.
    sessionStudentId = null
  }
  if (!sessionStudentId) return { ok: true } // guest bearer mode (no session to check against)
  const claimedBy = await claimedStudentIdFor(guestId)
  if (claimedBy && claimedBy !== sessionStudentId) {
    return { ok: false, status: 403, error: 'This learning history belongs to a different account.' }
  }
  return { ok: true }
}
