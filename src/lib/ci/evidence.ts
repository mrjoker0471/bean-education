// ─── BEAN Classroom Intelligence (CI-1): authorised evidence gathering ───────
// The single place that decides what the agents are allowed to see.
//
// Observation charter (docs/CLASSROOM-INTELLIGENCE-PRIVACY-AND-SECURITY.md):
//   • LESSON PLAN        — the class's own title/description/subject/level
//   • ATTENDANCE RECORD  — booking counts by verified attendance status
//   • PARTICIPANT INTERVALS — verified LiveKit connection evidence, AGGREGATE
//     only (totals; no identities, no per-student rows to the model)
//   • WHITEBOARD SNAPSHOT — structure only (stroke counts); the board stores
//     pen/eraser geometry with no text objects, so nothing textual exists to
//     read — the register records availability honestly
//   • TEACHER LESSON NOTES — opt-in teacher-provided text, never collected
//     by BEAN itself
//
// What is NEVER collected: audio, video, screen content, chat transcripts,
// per-student behaviour profiles, cameras-off/silence "engagement" signals.
// A failed evidence read is recorded honestly (available=false), never
// silently dropped and never invented.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { CI_EVIDENCE_KIND } from './constants'

// ─── Evidence shapes ───────────────────────────────────────────────────────────

export interface LessonPlanEvidence {
  title: string
  description: string
  subject: string
  targetLevel: string
  language: string
  durationMinutes: number
  startsAtIso: string
  timeZone: string
}

export interface AttendanceEvidence {
  attended: number
  noShow: number
  cancelled: number
  confirmedNotMarked: number
  totalBookings: number
}

export interface ParticipantIntervalsEvidence {
  teacherConnectedSeconds: number
  studentConnectedSecondsTotal: number
  studentConnectedSecondsMean: number
  studentReconnectCountTotal: number
  studentsWithAnyConnection: number
  liveSessionStatus: string | null
  liveSessionEndedReason: string | null
  actualParticipantMinutes: number | null
  /** Machine-readable semantics note: these are AGGREGATES, not per-student
   *  data, and participant-minutes are not wall-clock session length. */
  legend: string
}

export interface WhiteboardEvidence {
  available: boolean
  strokeCount: number | null
  /** The board carries pen/eraser geometry only — no text can be extracted. */
  note: string
}

export interface EvidenceBundle {
  classSessionId: string
  lessonPlan: LessonPlanEvidence
  attendance: AttendanceEvidence
  participantIntervals: ParticipantIntervalsEvidence | null
  whiteboard: WhiteboardEvidence
  teacherNotes: string | null
}

// ─── Zod view: what leaves this module for the agents (bounded, no identities)

export const PARTICIPANT_INTERVALS_LEGEND =
  'All figures here are whole-class AGGREGATES from verified connection evidence — there is no per-student data. ' +
  'Seconds are summed verified connection time. actualParticipantMinutes is the SUM of every participant\'s verified connection time expressed in participant-minutes (three attendees connected 45 minutes each = 135), NOT the wall-clock length of the session. ' +
  'Reconnect counts network hiccups and is never a measure of engagement or teaching quality.'

export const evidenceViewSchema = z.object({
  classSessionId: z.string().min(1),
  lessonPlan: z.object({
    title: z.string().max(120),
    description: z.string().max(2000),
    subject: z.string().max(60),
    targetLevel: z.string().max(40),
    language: z.string().max(40),
    durationMinutes: z.number().int().positive(),
    startsAtIso: z.string(),
    timeZone: z.string().max(60),
  }),
  attendance: z.object({
    attended: z.number().int().nonnegative(),
    noShow: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    confirmedNotMarked: z.number().int().nonnegative(),
    totalBookings: z.number().int().nonnegative(),
  }),
  participantIntervals: z
    .object({
      teacherConnectedSeconds: z.number().int().nonnegative(),
      studentConnectedSecondsTotal: z.number().int().nonnegative(),
      studentConnectedSecondsMean: z.number().int().nonnegative(),
      studentReconnectCountTotal: z.number().int().nonnegative(),
      studentsWithAnyConnection: z.number().int().nonnegative(),
      liveSessionStatus: z.string().nullable(),
      liveSessionEndedReason: z.string().nullable(),
      actualParticipantMinutes: z.number().int().nonnegative().nullable(),
      legend: z.string(),
    })
    .nullable(),
  whiteboard: z.object({
    available: z.boolean(),
    strokeCount: z.number().int().nonnegative().nullable(),
    note: z.string(),
  }),
  teacherNotesAvailable: z.boolean(),
})
export type EvidenceView = z.infer<typeof evidenceViewSchema>

// ─── Gathering ────────────────────────────────────────────────────────────────

/**
 * Gather the authorised evidence bundle for a class. Throws only when the
 * class itself is missing (caller owns that decision); every optional source
 * degrades to an honest "unavailable" record instead.
 */
export async function gatherEvidence(classSessionId: string): Promise<EvidenceBundle> {
  const cls = await db.classSession.findUnique({
    where: { id: classSessionId },
    select: {
      id: true,
      title: true,
      description: true,
      subject: true,
      targetLevel: true,
      language: true,
      durationMinutes: true,
      startsAt: true,
      timeZone: true,
      liveSession: {
        select: {
          id: true,
          status: true,
          endReason: true,
          actualParticipantMinutes: true,
          whiteboard: { select: { snapshotJson: true } },
          participants: {
            select: {
              participantRole: true,
              totalConnectedSeconds: true,
              reconnectCount: true,
            },
          },
        },
      },
      bookings: { select: { id: true, status: true } },
    },
  })
  if (!cls) throw new Error('Class not found for evidence gathering')

  const attendance = {
    attended: 0,
    noShow: 0,
    cancelled: 0,
    confirmedNotMarked: 0,
    totalBookings: cls.bookings.length,
  }
  for (const b of cls.bookings) {
    if (b.status === 'ATTENDED') attendance.attended += 1
    else if (b.status === 'NO_SHOW') attendance.noShow += 1
    else if (b.status === 'CANCELLED') attendance.cancelled += 1
    else attendance.confirmedNotMarked += 1
  }

  let participantIntervals: ParticipantIntervalsEvidence | null = null
  if (cls.liveSession) {
    const students = cls.liveSession.participants.filter((p) => p.participantRole === 'STUDENT')
    const teacherSeconds = cls.liveSession.participants
      .filter((p) => p.participantRole === 'TEACHER')
      .reduce((s, p) => s + p.totalConnectedSeconds, 0)
    const studentTotal = students.reduce((s, p) => s + p.totalConnectedSeconds, 0)
    participantIntervals = {
      teacherConnectedSeconds: teacherSeconds,
      studentConnectedSecondsTotal: studentTotal,
      studentConnectedSecondsMean: students.length > 0 ? Math.round(studentTotal / students.length) : 0,
      studentReconnectCountTotal: students.reduce((s, p) => s + p.reconnectCount, 0),
      studentsWithAnyConnection: students.filter((p) => p.totalConnectedSeconds > 0).length,
      liveSessionStatus: cls.liveSession.status,
      liveSessionEndedReason: cls.liveSession.endReason,
      actualParticipantMinutes: cls.liveSession.actualParticipantMinutes,
      legend: PARTICIPANT_INTERVALS_LEGEND,
    }
  }

  let whiteboard: WhiteboardEvidence = {
    available: false,
    strokeCount: null,
    note: 'No whiteboard snapshot was saved for this session.',
  }
  const snapshotJson = cls.liveSession?.whiteboard?.snapshotJson
  if (snapshotJson) {
    try {
      const parsed = z.object({ strokes: z.array(z.unknown()).max(500) }).safeParse(JSON.parse(snapshotJson))
      if (parsed.success) {
        whiteboard = {
          available: parsed.data.strokes.length > 0,
          strokeCount: parsed.data.strokes.length,
          note:
            parsed.data.strokes.length > 0
              ? `The teacher's whiteboard snapshot exists (${parsed.data.strokes.length} strokes). It stores drawing geometry only — no text, so no board content can be read or quoted.`
              : 'A whiteboard snapshot exists but contains no strokes.',
        }
      }
    } catch {
      // Malformed snapshot: record honestly, never guess.
      whiteboard = { available: false, strokeCount: null, note: 'A whiteboard snapshot existed but could not be parsed; it was excluded.' }
    }
  }

  return {
    classSessionId: cls.id,
    lessonPlan: {
      title: cls.title,
      description: cls.description,
      subject: cls.subject,
      targetLevel: cls.targetLevel,
      language: cls.language,
      durationMinutes: cls.durationMinutes,
      startsAtIso: cls.startsAt.toISOString(),
      timeZone: cls.timeZone,
    },
    attendance,
    participantIntervals,
    whiteboard,
    teacherNotes: null, // filled by the pipeline from the job row (teacher opt-in)
  }
}

/** Evidence view handed to the agents: aggregates only, notes presence flag. */
export function toEvidenceView(bundle: EvidenceBundle): EvidenceView {
  return evidenceViewSchema.parse({
    classSessionId: bundle.classSessionId,
    lessonPlan: bundle.lessonPlan,
    attendance: bundle.attendance,
    participantIntervals: bundle.participantIntervals,
    whiteboard: bundle.whiteboard,
    teacherNotesAvailable: typeof bundle.teacherNotes === 'string' && bundle.teacherNotes.trim().length > 0,
  })
}

/** Stable digest of the exact evidence payload an agent saw (audit trail). */
export function evidenceDigest(view: EvidenceView, teacherNotes: string | null): string {
  return createHash('sha256')
    .update(JSON.stringify({ view, notesLen: teacherNotes?.length ?? null }))
    .digest('hex')
}

// ─── Evidence register rows (persisted with the report) ──────────────────────

export interface EvidenceRefSpec {
  kind: (typeof CI_EVIDENCE_KIND)[keyof typeof CI_EVIDENCE_KIND]
  refId: string | null
  summary: string
  available: boolean
}

/** Build the honest evidence register for a report from the bundle. */
export function buildEvidenceRefs(bundle: EvidenceBundle): EvidenceRefSpec[] {
  const refs: EvidenceRefSpec[] = [
    {
      kind: CI_EVIDENCE_KIND.LESSON_PLAN,
      refId: bundle.classSessionId,
      available: true,
      summary: `Lesson plan: "${bundle.lessonPlan.title}" (${bundle.lessonPlan.subject}, ${bundle.lessonPlan.targetLevel}, ${bundle.lessonPlan.durationMinutes} min, ${bundle.lessonPlan.language}).`,
    },
    {
      kind: CI_EVIDENCE_KIND.ATTENDANCE_RECORD,
      refId: bundle.classSessionId,
      available: bundle.attendance.totalBookings > 0,
      summary:
        bundle.attendance.totalBookings > 0
          ? `Verified attendance: ${bundle.attendance.attended} attended, ${bundle.attendance.noShow} no-show, ${bundle.attendance.cancelled} cancelled, ${bundle.attendance.confirmedNotMarked} unmarked (${bundle.attendance.totalBookings} bookings).`
          : 'No bookings existed for this class.',
    },
  ]
  if (bundle.participantIntervals) {
    refs.push({
      kind: CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
      refId: bundle.classSessionId,
      available: true,
      summary: `Verified connection intervals (aggregate): teacher ${Math.round(bundle.participantIntervals.teacherConnectedSeconds / 60)} min; students ${Math.round(bundle.participantIntervals.studentConnectedSecondsTotal / 60)} min total, mean ${Math.round(bundle.participantIntervals.studentConnectedSecondsMean / 60)} min across ${bundle.participantIntervals.studentsWithAnyConnection} connected student(s); live session ${bundle.participantIntervals.liveSessionStatus ?? 'unknown'}.`,
    })
  } else {
    refs.push({
      kind: CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
      refId: null,
      available: false,
      summary: 'No live session existed for this class — no connection evidence available.',
    })
  }
  refs.push({
    kind: CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT,
    refId: bundle.classSessionId,
    available: bundle.whiteboard.available,
    summary: bundle.whiteboard.note,
  })
  refs.push({
    kind: CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES,
    refId: bundle.classSessionId,
    available: typeof bundle.teacherNotes === 'string' && bundle.teacherNotes.trim().length > 0,
    summary:
      typeof bundle.teacherNotes === 'string' && bundle.teacherNotes.trim().length > 0
        ? `Teacher-provided lesson notes were included (opt-in, ${bundle.teacherNotes.length} characters).`
        : 'No teacher lesson notes were provided for this evaluation.',
  })
  return refs
}
