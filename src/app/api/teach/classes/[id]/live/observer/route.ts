// ─── BEAN Classroom Intelligence (CI-3D): live classroom observer control ─────
// Explicit dispatch surface for the consent-gated, visible, structured-only
// observer. The observer is NEVER auto-attached: an authorised teacher action
// through this route is the only client path, and every authorising check
// (ownership, approved profile, LIVE room, current consent, capacity,
// one-per-room) runs server-side in getObserverEligibility — the route never
// trusts a client-supplied identity for anything.
//
// GET    — the class's observer session status (owner only).
// POST   — explicitly dispatch the observer for the LIVE room (owner only).
// DELETE — withdraw the observer mid-class (owner only); the observer leaves
//          and its row is terminal-honest. Class attendance/completion are
//          never affected by any observer outcome.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher } from '@/lib/teach'
import {
  dispatchObserverForSession,
  cancelObserverSession,
  observerRunPromise,
  toObserverDTO,
  OBSERVER_LEFT_REASON,
} from '@/lib/ci/fleet/observer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DISPATCH_ERROR_STATUS: Record<string, number> = {
  class_not_found: 404,
  no_live_session: 409,
  room_not_live: 409,
  teacher_not_authorised: 403,
  no_consent: 409,
  already_observing: 409,
  observer_capacity_full: 503,
  livekit_not_configured: 503,
}

const DISPATCH_ERROR_MESSAGE: Record<string, string> = {
  class_not_found: 'Class not found.',
  no_live_session: 'This class has no live session.',
  room_not_live: 'The observer can only join a live classroom.',
  teacher_not_authorised: 'Only the approved teacher who owns this class can manage the observer.',
  no_consent: 'Classroom Intelligence consent must be granted before the observer can join.',
  already_observing: 'An observer is already attached to this classroom.',
  observer_capacity_full: 'The observer pool is at capacity right now — please try again later.',
  livekit_not_configured: 'Live classroom provider is not configured.',
}

/** Load the class + its observer row, scoped by the authenticated owner. */
async function ownedClassObserver(classId: string, profileId: string) {
  const cls = await db.classSession.findUnique({
    where: { id: classId },
    select: {
      id: true,
      teacherProfileId: true,
      liveSession: {
        select: {
          id: true,
          status: true,
          observerSession: {
            select: {
              id: true,
              status: true,
              leftReason: true,
              consentMode: true,
              transcriptionEnabled: true,
              canPublishMedia: true,
              reconnectCount: true,
              connectedSeconds: true,
              createdAt: true,
              connectedAt: true,
              leftAt: true,
              evidenceJson: true,
            },
          },
        },
      },
    },
  })
  if (!cls || cls.teacherProfileId !== profileId) return null
  return cls
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { id } = await params
    const cls = await ownedClassObserver(id, guard.profile.id)
    if (!cls) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }
    return NextResponse.json({
      liveStatus: cls.liveSession?.status ?? null,
      observer: cls.liveSession?.observerSession ? toObserverDTO(cls.liveSession.observerSession) : null,
    })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/observer GET]', err)
    return NextResponse.json({ error: 'Could not load the observer status.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { student, profile } = guard
    const { id } = await params

    const cls = await ownedClassObserver(id, profile.id)
    if (!cls) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }

    // Explicit dispatch: the authorising identity is the session-resolved
    // teacher — never anything from the request body.
    const outcome = await dispatchObserverForSession({
      classSessionId: id,
      dispatchedBy: student.id,
    })
    if (!outcome.dispatched) {
      return NextResponse.json(
        { error: DISPATCH_ERROR_MESSAGE[outcome.reason] ?? 'The observer could not be dispatched.', reason: outcome.reason },
        { status: DISPATCH_ERROR_STATUS[outcome.reason] ?? 409 },
      )
    }

    // When this process owns the run, report the connected state promptly.
    const run = observerRunPromise(outcome.observerSessionId)
    if (run) await run.then(() => undefined).catch(() => undefined)

    const fresh = await db.classroomObserverSession.findUnique({
      where: { id: outcome.observerSessionId },
      select: {
        id: true,
        status: true,
        leftReason: true,
        consentMode: true,
        transcriptionEnabled: true,
        canPublishMedia: true,
        reconnectCount: true,
        connectedSeconds: true,
        createdAt: true,
        connectedAt: true,
        leftAt: true,
        evidenceJson: true,
      },
    })
    return NextResponse.json({ observer: fresh ? toObserverDTO(fresh) : null })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/observer POST]', err)
    return NextResponse.json({ error: 'Could not dispatch the observer — please try again.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
    }
    const guard = await requireApprovedTeacher()
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }
    const { id } = await params
    const cls = await ownedClassObserver(id, guard.profile.id)
    if (!cls) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 })
    }
    const observerId = cls.liveSession?.observerSession?.id
    if (!observerId) {
      return NextResponse.json({ error: 'No observer has been attached to this classroom.' }, { status: 409 })
    }
    const cancelled = await cancelObserverSession(observerId, OBSERVER_LEFT_REASON.TEACHER_CANCELLED)
    const run = observerRunPromise(observerId)
    if (run) await run.then(() => undefined).catch(() => undefined)
    return NextResponse.json({ cancelled })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/observer DELETE]', err)
    return NextResponse.json({ error: 'Could not remove the observer — please try again.' }, { status: 500 })
  }
}
