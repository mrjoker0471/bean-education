// ─── BEAN Live Classroom (Phase 5): teacher moderation ────────────────────────
// POST /api/teach/classes/:id/live/moderate — approved class owner only.
//
// Supported actions (spec §6):
//   MUTE_AUDIO         — server-side mute of a participant's published audio
//                        track (trackSid optional: the participant's active
//                        microphone track is used when omitted)
//   REMOVE_PARTICIPANT — remove a participant from the room (reason mandatory)
//
// Every action is audited (append-only). Participants can never gain room
// admin powers — moderation goes through the BEAN server SDK client only.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { sameOrigin } from '@/lib/auth'
import { requireApprovedTeacher, appendAudit, AUDIT_ENTITY } from '@/lib/teach'
import { AUDIT_LIVE_ACTION, LIVE_SESSION_STATUS, MODERATION_REASON_MAX } from '@/lib/livekit/live'
import { muteParticipantAudioGuarded, removeParticipantGuarded } from '@/lib/livekit/room'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const moderateSchema = z.object({
  action: z.enum(['MUTE_AUDIO', 'REMOVE_PARTICIPANT']),
  /** LiveKit participant identity — must belong to this room's BEAN session. */
  identity: z.string().min(1).max(120),
  /** Optional track sid for targeted muting. */
  trackSid: z.string().min(1).max(120).optional(),
  /** Required for removal; bounded. */
  reason: z.string().max(MODERATION_REASON_MAX).optional(),
})

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

    const body = await req.json().catch(() => null)
    const parsed = moderateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid moderation request.' }, { status: 400 })
    }
    if (parsed.data.action === 'REMOVE_PARTICIPANT' && !parsed.data.reason?.trim()) {
      return NextResponse.json({ error: 'A removal reason is required.' }, { status: 400 })
    }

    const live = await db.liveClassSession.findUnique({
      where: { classSessionId: id },
      select: {
        id: true, roomName: true, status: true,
        classSession: { select: { id: true, teacherProfileId: true } },
      },
    })
    if (!live || live.classSession.teacherProfileId !== profile.id) {
      return NextResponse.json({ error: 'Class not found or not yours to moderate.' }, { status: 404 })
    }
    if (live.status !== LIVE_SESSION_STATUS.LIVE) {
      return NextResponse.json({ error: 'The classroom is not live.' }, { status: 409 })
    }

    // Guard against arbitrary room access: the identity must belong to a
    // participant of THIS live session (BEAN-derived, opaque `bean:<id>`).
    const participant = await db.liveClassParticipant.findUnique({
      where: { liveClassSessionId_participantIdentity: { liveClassSessionId: live.id, participantIdentity: parsed.data.identity } },
      select: { id: true, studentId: true, participantRole: true },
    })
    if (!participant) {
      return NextResponse.json({ error: 'That participant is not part of this classroom.' }, { status: 404 })
    }
    if (participant.studentId === student.id) {
      return NextResponse.json({ error: 'You cannot moderate yourself.' }, { status: 400 })
    }

    let result: { ok: boolean; error?: string }
    if (parsed.data.action === 'MUTE_AUDIO') {
      result = await muteParticipantAudioGuarded(live.roomName, parsed.data.identity, parsed.data.trackSid)
    } else {
      result = await removeParticipantGuarded(live.roomName, parsed.data.identity)
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error === 'no_audio_track' ? 'No published audio track found for that participant.' : 'The moderation action failed on the realtime provider.' },
        { status: 502 },
      )
    }

    await db.$transaction(async (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => {
      await appendAudit(tx, {
        entityType: AUDIT_ENTITY.CLASS_SESSION,
        entityId: id,
        actorId: student.id,
        actorRole: student.role,
        action: parsed.data.action === 'MUTE_AUDIO' ? AUDIT_LIVE_ACTION.MUTED : AUDIT_LIVE_ACTION.REMOVED,
        detail: `${parsed.data.action} → participant ${participant.participantRole.toLowerCase()} (studentId hidden)${parsed.data.reason ? ` — reason: ${parsed.data.reason}` : ''}`,
      })
    })

    return NextResponse.json({ ok: true, action: parsed.data.action, identity: parsed.data.identity })
  } catch (err) {
    console.error('[api/teach/classes/:id/live/moderate POST]', err)
    return NextResponse.json({ error: 'Could not apply the moderation action — please try again.' }, { status: 500 })
  }
}
