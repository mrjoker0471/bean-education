// ─── BEAN Classroom Intelligence (CI-5H): resolve a renewal demand ────────────
// POST /api/admin/ci5/renewals/[demandId]/resolve — reasoned admin resolution;
// previous approvals were never erased, the resolution closes the demand.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { resolveRenewalDemand, renewalDbFromPrisma } from '@/lib/ci/fleet/re-review'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ demandId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { demandId } = await params
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await resolveRenewalDemand(renewalDbFromPrisma(db), { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' }, demandId, { resolution: body.resolution })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ demand: { id: result.value.id, status: result.value.status, resolvedBy: result.value.resolvedBy } })
  } catch (err) {
    console.error('[api/admin/ci5/renewals/[demandId]/resolve POST]', err)
    return NextResponse.json({ error: 'Could not resolve the demand — please try again.' }, { status: 500 })
  }
}
