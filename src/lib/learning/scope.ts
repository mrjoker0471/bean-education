// ─── Learning API shared helpers (Phase 3B) ──────────────────────────────────
// Scope follows the app-wide guest-identity convention used by /api/progress
// and /api/attempts: the working identity is the guestId param (8-64 chars),
// validated with zod everywhere. Mutating routes add the sameOrigin CSRF-lite
// guard plus a per-owner in-memory rate limit, matching the existing pattern
// used by the Riishe chat routes (no middleware exists in this app by design).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

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

// ─── Server-local date keys (YYYY-MM-DD) ───────────────────────────────────────

export function dateKeyOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayKey(): string {
  return dateKeyOf(new Date())
}

/** Parse YYYY-MM-DD into a server-local Date at 00:00; null when invalid. */
export function dateKeyStart(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

export function dateKeyEnd(key: string): Date | null {
  const start = dateKeyStart(key)
  if (!start) return null
  return new Date(start.getTime() + 24 * 3600_000)
}

export function shiftDateKey(key: string, days: number): string {
  const start = dateKeyStart(key)
  if (!start) return key
  return dateKeyOf(new Date(start.getTime() + days * 24 * 3600_000))
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
