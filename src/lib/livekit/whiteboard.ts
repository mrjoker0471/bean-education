// ─── BEAN Live Classroom (Phase 5): whiteboard protocol ───────────────────────
// One shared contract for the realtime data channel (LiveKit reliable data
// messages) and the persisted snapshot (LiveWhiteboardState.snapshotJson).
//
// Security properties:
//   • Versioned messages — unknown versions are dropped, not guessed at.
//   • Strictly bounded payloads (points per stroke, strokes per snapshot,
//     serialised byte size) so one abusive client cannot exhaust memory/db.
//   • Coordinates are normalised floats 0..1 — canvas pixel-perfect scaling
//     happens client-side, and no foreign data shape can enter the pipeline.
//   • Colors come from a fixed palette — no arbitrary strings, no HTML/script
//     injection surface anywhere in the board.
//   • The SERVER re-validates every persisted snapshot (the client validates
//     for speed, the server for truth — never the other way around).
//
// Authorisation (enforced elsewhere, summarised here):
//   • Only the session's teacher may SEND wb messages and SAVE snapshots
//     (data-channel receivers check the publisher identity; the snapshot API
//     checks BEAN ownership).
//   • Students send only a sync request; they never mutate board state.

import { z } from 'zod'

export const WB_PROTOCOL_VERSION = 1

/** Fixed stroke palette (BEAN gold + chalk neutrals). */
export const WB_COLORS = ['#d4af37', '#e8e2d0', '#8a8f98', '#c0392b', '#2e7d32', '#f5f0e1'] as const
export const WB_MAX_STROKES = 500
export const WB_MAX_POINTS_PER_STROKE = 1000
export const WB_MAX_SNAPSHOT_BYTES = 200_000 // 200 KB hard cap
export const WB_BRUSH_SIZE_MIN = 1
export const WB_BRUSH_SIZE_MAX = 24
/** Data-message topic strings on the LiveKit data channel. */
export const WB_TOPIC = 'bean.wb.v1'
export const HAND_TOPIC = 'bean.hand.v1'

export const wbStrokeSchema = z.object({
  id: z.string().min(1).max(40),
  mode: z.enum(['pen', 'eraser']),
  color: z.enum(WB_COLORS),
  size: z.number().int().min(WB_BRUSH_SIZE_MIN).max(WB_BRUSH_SIZE_MAX),
  /** Normalised [x, y] pairs in 0..1 canvas space (round-trip safe). */
  points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(WB_MAX_POINTS_PER_STROKE),
})

export const wbSnapshotSchema = z.object({
  v: z.literal(WB_PROTOCOL_VERSION),
  strokes: z.array(wbStrokeSchema).max(WB_MAX_STROKES),
})

export type WBStroke = z.infer<typeof wbStrokeSchema>
export type WBSnapshot = z.infer<typeof wbSnapshotSchema>

// ─── Data-channel message shapes (validated on receipt) ──────────────────────

export const wbMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stroke'), v: z.literal(WB_PROTOCOL_VERSION), stroke: wbStrokeSchema }),
  z.object({ type: z.literal('undo'), v: z.literal(WB_PROTOCOL_VERSION) }),
  z.object({ type: z.literal('clear'), v: z.literal(WB_PROTOCOL_VERSION) }),
  /** Late joiner asks the teacher for the current snapshot. */
  z.object({ type: z.literal('request-sync'), v: z.literal(WB_PROTOCOL_VERSION) }),
  /** Teacher replies with the authoritative snapshot (bounded). */
  z.object({ type: z.literal('sync'), v: z.literal(WB_PROTOCOL_VERSION), snapshot: wbSnapshotSchema }),
])

export type WBMessage = z.infer<typeof wbMessageSchema>

export const handMessageSchema = z.object({
  type: z.literal('hand'),
  raised: z.boolean(),
})

export type HandMessage = z.infer<typeof handMessageSchema>

/**
 * Serialised byte size guard for a full snapshot (pre-persist check).
 * Structural input so callers can pass either the zod type or the client DTO.
 */
export function snapshotByteSize(snapshot: { strokes: unknown[] }): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length
}

/** True when a decoded data message came from the session's teacher. */
export function isTeacherIdentity(identity: string, teacherIdentity: string): boolean {
  return identity === teacherIdentity
}
