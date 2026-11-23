// ─── Shared in-memory rate limiter (server-side) ─────────────────────────────
// Small sliding-window limiter for authentication, OAuth initiation, privacy
// grievances and other sensitive actions. Single-process memory only — the
// same model the learning scopes already use (learning/scope.ts). Pruning
// happens opportunistically; state resets on process restart, which is an
// accepted trade-off for this deployment (documented in the readiness doc).

const buckets = new Map<string, number[]>()

function prune(now: number): void {
  if (buckets.size < 512) return
  for (const [key, hits] of buckets) {
    const alive = hits.filter(t => now - t < 3_600_000)
    if (alive.length === 0) buckets.delete(key)
    else buckets.set(key, alive)
  }
}

/** Record a hit and return true when the caller is over the limit.
 *  `limit` hits per `windowMs` are allowed; the (limit+1)-th returns true. */
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  prune(now)
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs)
  hits.push(now)
  buckets.set(key, hits)
  return hits.length > limit
}

/** Best-effort client identity for rate-limit keys (proxy-aware). */
export function clientKey(req: { headers: { get(name: string): string | null } }, scope: string): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0]?.trim() || 'local'
  return `${scope}:${ip}`
}

/** Reset all buckets — test helper only. */
export function resetRateLimits(): void {
  buckets.clear()
}
