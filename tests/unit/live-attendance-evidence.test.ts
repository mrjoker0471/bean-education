// ─── BEAN Live Classroom (Phase 5): verified attendance evidence logic ────────
// Pure-function proofs for the interval accounting and the (advisory)
// attendance suggestion: idempotent joins/leaves, out-of-order clamps,
// effective connected time, and the documented suggestion threshold.

import { describe, it, expect } from 'bun:test'
import {
  applyParticipantJoined,
  applyParticipantLeft,
  closeOpenInterval,
  effectiveConnectedSeconds,
  suggestedAttendance,
  toLiveEvidenceDTO,
  isInsideLiveWindow,
  participantIdentity,
  studentIdFromIdentity,
  JOIN_WINDOW_BEFORE_MINUTES,
} from '@/lib/livekit/live'

const T0 = new Date('2026-11-18T10:00:00Z')
const T1 = new Date('2026-11-18T10:10:00Z') // +10 min
const T2 = new Date('2026-11-18T10:20:00Z') // +20 min
const T3 = new Date('2026-11-18T10:30:00Z') // +30 min

const BLANK = { firstJoinedAt: null, activeSince: null, lastLeftAt: null, totalConnectedSeconds: 0, reconnectCount: 0 }

describe('interval accounting — idempotency & ordering', () => {
  it('a first join opens an interval and records firstJoinedAt', () => {
    const { state, kind } = applyParticipantJoined(BLANK, T0)
    expect(kind).toBe('joined')
    expect(state.activeSince!.getTime()).toBe(T0.getTime())
    expect(state.firstJoinedAt!.getTime()).toBe(T0.getTime())
    expect(state.reconnectCount).toBe(0)
  })

  it('a duplicate join while connected is a no-op', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    const again = applyParticipantJoined(joined, T1)
    expect(again.kind).toBe('noop')
    expect(again.state.activeSince!.getTime()).toBe(T0.getTime()) // interval untouched
  })

  it('a leave closes the interval with exact seconds', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    const left = applyParticipantLeft(joined, T1)
    expect(left.kind).toBe('left')
    expect(left.state.totalConnectedSeconds).toBe(600)
    expect(left.state.activeSince).toBeNull()
    expect(left.state.lastLeftAt!.getTime()).toBe(T1.getTime())
  })

  it('a duplicate leave is a no-op — never double-subtracted', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    const left = applyParticipantLeft(joined, T1).state
    const again = applyParticipantLeft(left, T2)
    expect(again.kind).toBe('noop')
    expect(again.state.totalConnectedSeconds).toBe(600)
  })

  it('a reconnection opens a new interval and counts the reconnection', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    const left = applyParticipantLeft(joined, T1).state
    const rejoined = applyParticipantJoined(left, T2)
    expect(rejoined.kind).toBe('joined')
    expect(rejoined.state.reconnectCount).toBe(1)
    expect(rejoined.state.firstJoinedAt!.getTime()).toBe(T0.getTime()) // history kept
    expect(rejoined.state.totalConnectedSeconds).toBe(600) // accumulated time kept
  })

  it('an out-of-order leave is clamped — negative durations are impossible', () => {
    const joined = applyParticipantJoined(BLANK, T1).state // join at T1
    const staleLeft = applyParticipantLeft(joined, T0) // leave claims T0 < T1
    expect(staleLeft.state.totalConnectedSeconds).toBe(0) // clamped, not negative
    expect(staleLeft.state.lastLeftAt!.getTime()).toBe(T1.getTime())
  })

  it('an out-of-order rejoin after leave does not precede lastLeftAt', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    const left = applyParticipantLeft(joined, T2).state
    const staleRejoin = applyParticipantJoined(left, T1) // claims T1 < T2
    expect(staleRejoin.state.activeSince!.getTime()).toBe(T2.getTime()) // clamped
    expect(staleRejoin.state.reconnectCount).toBe(1)
  })

  it('closeOpenInterval conservatively closes at the given boundary', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    const closed = closeOpenInterval(joined, T1)
    expect(closed.activeSince).toBeNull()
    expect(closed.totalConnectedSeconds).toBe(600)
    // Already-closed state stays untouched.
    expect(closeOpenInterval(closed, T2).totalConnectedSeconds).toBe(600)
  })

  it('effectiveConnectedSeconds includes an open interval up to `until`', () => {
    const joined = applyParticipantJoined(BLANK, T0).state
    expect(effectiveConnectedSeconds(joined, T1)).toBe(600)
    const closed = applyParticipantLeft(joined, T1).state
    expect(effectiveConnectedSeconds(closed, T3)).toBe(600) // no phantom time after leave
  })
})

describe('attendance suggestion (advisory, documented threshold)', () => {
  it('≥60% of a 60-minute class suggests ATTENDED', () => {
    expect(suggestedAttendance(36 * 60, 60)).toBe('ATTENDED')
    expect(suggestedAttendance(59 * 60, 60)).toBe('ATTENDED')
  })

  it('below the threshold with meaningful presence suggests NO_SHOW', () => {
    expect(suggestedAttendance(10 * 60, 60)).toBe('NO_SHOW')
    expect(suggestedAttendance(30, 60)).toBe('NO_SHOW')
  })

  it('effectively absent (never connected) returns null — teacher decides freely', () => {
    expect(suggestedAttendance(0, 60)).toBeNull()
    expect(suggestedAttendance(29, 60)).toBeNull()
  })

  it('evidence maps per enrolled booking — other students never appear', () => {
    const participants = [
      { studentId: 's1', firstJoinedAt: T0, lastLeftAt: T1, activeSince: null, totalConnectedSeconds: 600, reconnectCount: 1, student: { displayName: 'One' } },
    ]
    const bookings = [
      { studentId: 's1', status: 'CONFIRMED' },
      { studentId: 's2', status: 'CONFIRMED' },
    ]
    const evidence = toLiveEvidenceDTO(participants, bookings, 60, T3)
    expect(evidence.length).toBe(2)
    expect(evidence[0].studentId).toBe('s1')
    expect(evidence[0].totalConnectedSeconds).toBe(600)
    expect(evidence[0].suggestedAttendance).toBe('NO_SHOW') // 10 of 60 minutes
    expect(evidence[1].studentId).toBe('s2')
    expect(evidence[1].totalConnectedSeconds).toBe(0)
    expect(evidence[1].suggestedAttendance).toBeNull()
  })
})

describe('window & identity rules', () => {
  it('the live window opens 15 minutes before start and closes at scheduled end', () => {
    const start = new Date('2026-11-18T12:00:00Z')
    expect(isInsideLiveWindow(start, 60, new Date(start.getTime() - 16 * 60_000))).toBe(false)
    expect(isInsideLiveWindow(start, 60, new Date(start.getTime() - 15 * 60_000))).toBe(true)
    expect(isInsideLiveWindow(start, 60, new Date(start.getTime() + 30 * 60_000))).toBe(true)
    expect(isInsideLiveWindow(start, 60, new Date(start.getTime() + 60 * 60_000))).toBe(false)
    expect(JOIN_WINDOW_BEFORE_MINUTES).toBe(15)
  })

  it('participant identity is opaque and round-trips to the student id', () => {
    expect(participantIdentity('stu_123')).toBe('bean:stu_123')
    expect(studentIdFromIdentity('bean:stu_123')).toBe('stu_123')
    expect(studentIdFromIdentity('someone-else')).toBeNull()
    expect(studentIdFromIdentity('bean:')).toBeNull()
  })
})
