// ─── BEAN Teach (Phase 4A): admin — approve or reject an application ─────────
// POST /api/admin/teach/applications/:id/review — ADMIN only.
//   APPROVE → TeacherProfile becomes APPROVED, is published to the marketplace,
//             reviewer identity/role/date/note recorded.
//   REJECT  → REQUIRES a written reason (10..400 chars); profile REJECTED and
//             unpublished; the reason is shown to the applicant so they can
//             correct and resubmit.
// Every decision appends to the append-only TeachAuditEvent trail (reviewer,
// role held, action, note, time) — earlier decisions are never erased.
// Guards: an admin can NEVER approve their own application, and no public API
// can grant ADMIN privileges (roles change only via the operator CLI).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { appendAudit, AUDIT_ACTION, AUDIT_ENTITY, TEACH_STATUS, toAdminApplicationDTO } from '@/lib/teach'
import { requireAdmin } from '@/lib/teach'
import { adminTeachReviewSchema } from '@/lib/teach-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NOTE_MIN = 10
const NOTE_MAX = 400

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0]

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireAdmin()
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { student } = guard

    const parsed = adminTeachReviewSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid review request.' }, { status: 400 })
    }
    const { action } = parsed.data
    const note = parsed.data.note?.trim() ?? ''

    const { id } = await params
    const profile = await db.teacherProfile.findUnique({ where: { id } })
    if (!profile) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    // Integrity: no self-review — the reviewer must not be the applicant.
    if (profile.studentId === student.id) {
      return NextResponse.json({ error: 'You cannot review your own application.' }, { status: 403 })
    }

    if (action === 'REJECT' && note.length < NOTE_MIN) {
      return NextResponse.json(
        { error: `A rejection needs a written reason of at least ${NOTE_MIN} characters so the applicant can correct it.` },
        { status: 400 },
      )
    }
    if (note.length > NOTE_MAX) {
      return NextResponse.json({ error: `Review note must be at most ${NOTE_MAX} characters.` }, { status: 400 })
    }
    if (action === 'APPROVE' && profile.verificationStatus === TEACH_STATUS.APPROVED) {
      return NextResponse.json({ error: 'This teacher is already approved.' }, { status: 409 })
    }

    const now = new Date()
    const updated = await db.$transaction(async (tx: Tx) => {
      const row = await tx.teacherProfile.update({
        where: { id: profile.id },
        data:
          action === 'APPROVE'
            ? {
                verificationStatus: TEACH_STATUS.APPROVED,
                isPublished: true, // approval makes the profile publicly discoverable
                reviewedBy: student.id,
                reviewedAt: now,
                reviewNote: note || null,
              }
            : {
                verificationStatus: TEACH_STATUS.REJECTED,
                isPublished: false, // never publicly visible while rejected
                reviewedBy: student.id,
                reviewedAt: now,
                reviewNote: note,
              },
      })
      await appendAudit(tx, {
        entityType: AUDIT_ENTITY.TEACHER_PROFILE,
        entityId: profile.id,
        actorId: student.id,
        actorRole: student.role,
        action: action === 'APPROVE' ? AUDIT_ACTION.APPROVE : AUDIT_ACTION.REJECT,
        detail: note || (action === 'APPROVE' ? 'Application approved.' : 'Application rejected.'),
      })
      return row
    })

    const history = await db.teachAuditEvent.findMany({
      where: { entityType: AUDIT_ENTITY.TEACHER_PROFILE, entityId: profile.id },
      orderBy: { createdAt: 'asc' },
    })
    const refreshed = await db.teacherProfile.findUnique({
      where: { id: updated.id },
      include: { student: { select: { displayName: true, email: true, learningLevel: true } } },
    })
    if (!refreshed) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }
    return NextResponse.json({
      application: toAdminApplicationDTO(
        refreshed,
        { displayName: refreshed.student.displayName, email: refreshed.student.email, learningLevel: refreshed.student.learningLevel },
        history,
      ),
    })
  } catch (err) {
    console.error('[api/admin/teach/applications/:id/review POST]', err)
    return NextResponse.json({ error: 'Could not record the review — please try again.' }, { status: 500 })
  }
}
