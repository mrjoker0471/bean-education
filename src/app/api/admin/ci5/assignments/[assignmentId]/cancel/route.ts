// ─── BEAN Classroom Intelligence (CI-5C): admin assignment cancellation ──────
// POST /api/admin/ci5/assignments/[assignmentId]/cancel — reason required,
// append-only audit event.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/teach'
import { cancelAssignment, assignmentDbFromPrisma } from '@/lib/ci/fleet/assignments'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { assignmentId } = await params
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }
    const result = await cancelAssignment(
      assignmentDbFromPrisma(db),
      { studentId: guard.student.id, displayName: guard.student.displayName ?? 'BEAN admin' },
      assignmentId,
      typeof body.reason === 'string' ? body.reason : '',
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ assignment: { id: result.assignment.id, status: result.assignment.status } })
  } catch (err) {
    console.error('[api/admin/ci5/assignments/[assignmentId]/cancel POST]', err)
    return NextResponse.json({ error: 'Could not cancel the assignment — please try again.' }, { status: 500 })
  }
}
