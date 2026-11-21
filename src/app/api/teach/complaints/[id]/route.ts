// ─── BEAN Trust & Quality (Phase 6): own complaint detail + add information ──
// GET   /api/teach/complaints/:id — the complainant's own case file (admin
//       notes redacted by the mapper). Another student's complaint is simply
//       not reachable (404-style denial); teachers can never read complaints.
// PATCH /api/teach/complaints/:id — the complainant supplies requested
//       information (INFO_PROVIDED event, append-only).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireStudent, sameOrigin } from '@/lib/auth'
import { complaintInfoSchema } from '@/lib/trust-schema'
import { toOwnComplaint } from '@/lib/trust-dto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const { id } = await params
    const complaint = await db.teachComplaint.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    })
    // Ownership check is intrinsic — non-owners (including teachers and other
    // students) get an identical "not found" answer with no case existence leak.
    if (!complaint || complaint.complainantId !== student.id) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }
    const classTitle = complaint.classSessionId
      ? (await db.classSession.findUnique({ where: { id: complaint.classSessionId }, select: { title: true } }))?.title ?? null
      : null
    return NextResponse.json({
      complaint: toOwnComplaint({ ...complaint, classSession: classTitle ? { title: classTitle } : null }),
    })
  } catch (err) {
    console.error('[api/teach/complaints/:id GET]', err)
    return NextResponse.json({ error: 'Could not load the report — please try again.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const student = await requireStudent()
    if (!student) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

    const body = await req.json().catch(() => null)
    const parsed = complaintInfoSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid information' }, { status: 400 })
    }

    const { id } = await params
    const outcome = await db.$transaction(async (tx) => {
      const complaint = await tx.teachComplaint.findUnique({ where: { id } })
      if (!complaint || complaint.complainantId !== student.id) return { kind: 'notFound' as const }
      await tx.complaintEvent.create({
        data: {
          complaintId: complaint.id,
          actorId: student.id,
          actorRole: student.role,
          action: 'INFO_PROVIDED',
          detail: parsed.data.detail,
        },
      })
      await tx.teachComplaint.update({
        where: { id: complaint.id },
        data: { updatedAt: new Date() },
      })
      return { kind: 'ok' as const }
    })

    if (outcome.kind !== 'ok') return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/teach/complaints/:id PATCH]', err)
    return NextResponse.json({ error: 'Could not add your information — please try again.' }, { status: 500 })
  }
}
