// ─── BEAN Trust & Quality (Phase 6): admin complaint detail ──────────────────
// GET /api/admin/trust/complaints/:id — ADMIN-only full case file with the
// append-only event history (full notes, unredacted). Guarding is server-side
// ADMIN authorization — not UI hiding.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/teach'
import { toAdminComplaint } from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const { id } = await params
    const complaint = await db.teachComplaint.findUnique({
      where: { id },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        complainant: { select: { id: true, displayName: true, email: true } },
      },
    })
    if (!complaint) return NextResponse.json({ error: 'Complaint not found' }, { status: 404 })
    const classTitle = complaint.classSessionId
      ? (await db.classSession.findUnique({ where: { id: complaint.classSessionId }, select: { title: true } }))?.title ?? null
      : null
    return NextResponse.json({
      complaint: toAdminComplaint({ ...complaint, classSession: classTitle ? { title: classTitle } : null }),
    })
  } catch (err) {
    console.error('[api/admin/trust/complaints/:id GET]', err)
    return NextResponse.json({ error: 'Could not load the complaint — please try again.' }, { status: 500 })
  }
}
