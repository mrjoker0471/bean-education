// ─── OPS-1A: GET /api/healthz — real application readiness endpoint ──────────
// Unauthenticated, cheap, leak-safe. Proxies, platform health checks and
// operators get the app's ACTUAL readiness state:
//   • 200 — the database answers a bounded probe AND all three durable-queue
//     worker loops (Riishe, CI evaluations, specialist fleet) are registered
//     in this process (eagerly bootstrapped by src/instrumentation.ts).
//   • 503 — any required startup dependency is unhealthy or not registered.
// The response is the minimal contract from src/lib/health.ts — no database
// details, no environment values, no secrets, no stack traces, no user data.

import { NextResponse } from 'next/server'
import { performHealthCheck } from '@/lib/health'

// The probe touches the Prisma engine (native, SQLite) and reads the
// in-process worker registration singletons — Node.js runtime only.
export const runtime = 'nodejs'

// Readiness must never be cached — every request reflects the current state.
export const dynamic = 'force-dynamic'

export async function GET() {
  const { body, httpStatus } = await performHealthCheck()
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { 'Cache-Control': 'no-store' },
  })
}
