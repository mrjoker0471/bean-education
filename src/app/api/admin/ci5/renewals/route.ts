// ─── BEAN Classroom Intelligence (CI-5H): renewal-demand queue ────────────────
// GET  /api/admin/ci5/renewals — open + resolved re-review demands.
// POST /api/admin/ci5/renewals — record a demand (server-authorised; duplicate
//      OPEN demands for the same subject+trigger refuse).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { recordRenewalDemand, listRenewalDemands, renewalDbFromPrisma } from '@/lib/ci/fleet/re-review'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const rows = await listRenewalDemands(renewalDbFromPrisma(db), {
      status: url.searchParams.get('status') ?? undefined,
      subjectKey: url.searchParams.get('subjectKey') ?? undefined,
    })
    return NextResponse.json({ demands: rows })
  } catch (err) {
    console.error('[api/admin/ci5/renewals GET]', err)
    return NextResponse.json({ error: 'Could not load the renewal queue — please try again.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await recordRenewalDemand(renewalDbFromPrisma(db), { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' }, body)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ demand: { id: result.value.id, subjectKey: result.value.subjectKey, trigger: result.value.trigger, status: result.value.status } }, { status: 201 })
  } catch (err) {
    console.error('[api/admin/ci5/renewals POST]', err)
    return NextResponse.json({ error: 'Could not record the renewal demand — please try again.' }, { status: 500 })
  }
}
