// ─── BEAN Teach (Phase 4A): publish a class ──────────────────────────────────
// POST /api/teach/classes/:id/publish — approved owner teacher only.
// Publication requirements (all re-checked server-side): class is DRAFT, all
// fields valid, schedule in the future. Note the guard is requireApprovedTeacher
// (not just ownership) — a teacher whose profile fell back to PENDING after a
// verification-relevant edit cannot publish anything until re-approved.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher, toPublicClass } from '@/lib/teach'
import { trustStateFor, restrictionMessage } from '@/lib/trust'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { profile } = guard

    const { id } = await params

    // Phase 6 trust enforcement: both listing restrictions block publishing.
    const trust = await trustStateFor(profile.id, new Date())
    if (trust.pausedListings || trust.suspendedPublishing) {
      return NextResponse.json({ error: restrictionMessage(trust) }, { status: 403 })
    }

    const session = await db.classSession.findUnique({ where: { id } })
    if (!session || session.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }
    if (session.status === 'PUBLISHED') {
      return NextResponse.json({ error: 'This class is already published.' }, { status: 409 })
    }
    if (session.status !== 'DRAFT') {
      return NextResponse.json({ error: `A ${session.status.toLowerCase()} class cannot be published.` }, { status: 409 })
    }
    if (session.startsAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'The schedule is in the past — edit the class before publishing.' }, { status: 409 })
    }
    if (session.minimumStudents > session.capacity || session.capacity < 1) {
      return NextResponse.json({ error: 'Fix capacity and minimum enrolment before publishing.' }, { status: 409 })
    }

    const updated = await db.classSession.update({
      where: { id: session.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
    return NextResponse.json({ class: toPublicClass(updated, profile) })
  } catch (err) {
    console.error('[api/teach/classes/:id/publish POST]', err)
    return NextResponse.json({ error: 'Could not publish the class — please try again.' }, { status: 500 })
  }
}
