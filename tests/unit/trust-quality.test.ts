// ─── BEAN Trust & Quality (Phase 6): pure domain rules ───────────────────────
// Unit tests for the pure decision functions in src/lib/trust.ts — no
// database, no HTTP. These prove the documented policy math: review
// eligibility, quality metrics (incl. "never fabricate a zero-star score"),
// edit windows, complaint severity derivation and rate-limit thresholds.

import { describe, it, expect } from 'bun:test'
import {
  computeTeacherQuality,
  evaluateReviewEligibility,
  isWithinEditWindow,
  isValidRating,
  deriveComplaintSeverity,
  rateLimited,
  RATE_LIMITS,
  QUALITY_MIN_SAMPLE,
  type QualityReviewRow,
} from '@/lib/trust'

const NOW = new Date('2026-11-19T12:00:00.000Z')

function classRow(overrides: Partial<{ startsAt: Date; durationMinutes: number; status: string }> = {}) {
  return {
    id: 'c1',
    teacherProfileId: 'tp-1',
    startsAt: overrides.startsAt ?? new Date(NOW.getTime() - 3 * 3600_000),
    durationMinutes: overrides.durationMinutes ?? 60,
    status: overrides.status ?? 'PUBLISHED',
  }
}

function booking(overrides: Partial<{ id: string; studentId: string; classSessionId: string; status: string }> = {}) {
  return {
    id: 'bk-1',
    studentId: overrides.studentId ?? 'student-1',
    classSessionId: overrides.classSessionId ?? 'c1',
    status: overrides.status ?? 'ATTENDED',
  }
}

describe('evaluateReviewEligibility — the eligibility matrix', () => {
  const cls = classRow()

  it('ATTENDED booking after class end is eligible', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking(), classSession: cls, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(true)
  })

  it('a guest session (no booking) is not eligible — 403 with attendance wording', () => {
    const verdict = evaluateReviewEligibility({ studentId: 'student-1', booking: null, classSession: cls, existingReview: null, now: NOW })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('another student cannot review someone else’s class booking (403)', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-2', booking: booking({ studentId: 'student-1' }), classSession: cls, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('cancelled bookings cannot review (403)', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking({ status: 'CANCELLED' }), classSession: cls, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('NO_SHOW bookings cannot review (403)', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking({ status: 'NO_SHOW' }), classSession: cls, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('a booking the teacher has not yet marked ATTENDED cannot review (403)', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking({ status: 'CONFIRMED' }), classSession: cls, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('a review cannot be written before the class has ended (403)', () => {
    const running = classRow({ startsAt: new Date(NOW.getTime() - 30 * 60_000) })
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking(), classSession: running, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('a second review for the same booking is rejected (409)', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking(), classSession: cls, existingReview: { id: 'rv-1' }, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(409)
  })

  it('a booking whose classSessionId differs from the class is rejected (403)', () => {
    const verdict = evaluateReviewEligibility({
      studentId: 'student-1', booking: booking({ classSessionId: 'other-class' }), classSession: cls, existingReview: null, now: NOW,
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(403)
  })

  it('a missing class is 404', () => {
    const verdict = evaluateReviewEligibility({ studentId: 'student-1', booking: booking(), classSession: null, existingReview: null, now: NOW })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.status).toBe(404)
  })
})

describe('computeTeacherQuality — public rating math', () => {
  const row = (rating: number, status = 'PUBLISHED', isVerified = true): QualityReviewRow => ({ rating, status, isVerified })

  it('averages only PUBLISHED verified reviews and rounds to 1 decimal', () => {
    const m = computeTeacherQuality([row(5), row(4), row(4)], { completedClasses: 3, cancelledClasses: 1, publishedClasses: 2 })
    expect(m.averageRating).toBe(4.3)
    expect(m.reviewCount).toBe(3)
    expect(m.sampleSufficient).toBe(true)
  })

  it('hidden reviews are excluded from the average and the count', () => {
    const m = computeTeacherQuality([row(1, 'HIDDEN'), row(5), row(4), row(4)], { completedClasses: 3, cancelledClasses: 0, publishedClasses: 2 })
    expect(m.averageRating).toBe(4.3)
    expect(m.reviewCount).toBe(3)
  })

  it('FLAGGED reviews are excluded from aggregates while under moderation', () => {
    const m = computeTeacherQuality([row(1, 'FLAGGED'), row(5), row(4), row(4)], { completedClasses: 3, cancelledClasses: 0, publishedClasses: 2 })
    expect(m.averageRating).toBe(4.3)
    expect(m.reviewCount).toBe(3)
  })

  it('unverified reviews are excluded', () => {
    const m = computeTeacherQuality([row(1, 'PUBLISHED', false), row(5), row(4), row(4)], { completedClasses: 2, cancelledClasses: 0, publishedClasses: 1 })
    expect(m.averageRating).toBe(4.3)
    expect(m.reviewCount).toBe(3)
  })

  it('no reviews → averageRating null (NEVER a fabricated zero-star score)', () => {
    const m = computeTeacherQuality([], { completedClasses: 0, cancelledClasses: 0, publishedClasses: 0 })
    expect(m.averageRating).toBeNull()
    expect(m.reviewCount).toBe(0)
    expect(m.sampleSufficient).toBe(false)
    expect(m.completionRate).toBeNull()
  })

  it('below the minimum sample threshold the numeric average is not publishable', () => {
    const rows: QualityReviewRow[] = Array.from({ length: QUALITY_MIN_SAMPLE - 1 }, () => row(5))
    const m = computeTeacherQuality(rows, { completedClasses: 1, cancelledClasses: 0, publishedClasses: 1 })
    expect(m.averageRating).not.toBeNull()
    expect(m.sampleSufficient).toBe(false)
  })

  it('exactly at the minimum sample the average becomes publishable', () => {
    const rows: QualityReviewRow[] = Array.from({ length: QUALITY_MIN_SAMPLE }, () => row(4))
    const m = computeTeacherQuality(rows, { completedClasses: 1, cancelledClasses: 0, publishedClasses: 1 })
    expect(m.sampleSufficient).toBe(true)
    expect(m.averageRating).toBe(4)
  })

  it('completion rate = completed / (completed + cancelled), null with no denominator', () => {
    const m = computeTeacherQuality([], { completedClasses: 3, cancelledClasses: 1, publishedClasses: 2 })
    expect(m.completionRate).toBe(0.75)
    const empty = computeTeacherQuality([], { completedClasses: 0, cancelledClasses: 0, publishedClasses: 0 })
    expect(empty.completionRate).toBeNull()
  })
})

describe('edit windows and rating bounds', () => {
  it('the 7-day review edit window includes the 7th day and excludes the 8th', () => {
    const created = new Date(NOW.getTime() - 7 * 24 * 3600_000)
    expect(isWithinEditWindow(created, NOW, 7)).toBe(true)
    const created8 = new Date(NOW.getTime() - 8 * 24 * 3600_000)
    expect(isWithinEditWindow(created8, NOW, 7)).toBe(false)
  })

  it('ratings must be whole numbers 1–5', () => {
    expect(isValidRating(1)).toBe(true)
    expect(isValidRating(5)).toBe(true)
    expect(isValidRating(0)).toBe(false)
    expect(isValidRating(6)).toBe(false)
    expect(isValidRating(3.5)).toBe(false)
    expect(isValidRating(Number.NaN)).toBe(false)
  })
})

describe('complaint severity derivation — server decides, clients never assert', () => {
  it('sensitive categories escalate (safeguarding with minor context → CRITICAL)', () => {
    expect(deriveComplaintSeverity('SAFEGUARDING', false)).toBe('HIGH')
    expect(deriveComplaintSeverity('SAFEGUARDING', true)).toBe('CRITICAL')
    expect(deriveComplaintSeverity('HARASSMENT', false)).toBe('HIGH')
    expect(deriveComplaintSeverity('DISCRIMINATION', false)).toBe('HIGH')
  })

  it('conduct categories are HIGH, everything else NORMAL', () => {
    expect(deriveComplaintSeverity('TEACHER_CONDUCT', false)).toBe('HIGH')
    expect(deriveComplaintSeverity('STUDENT_CONDUCT', false)).toBe('HIGH')
    expect(deriveComplaintSeverity('TEACHING_QUALITY', false)).toBe('NORMAL')
    expect(deriveComplaintSeverity('TECHNICAL_PROBLEM', false)).toBe('NORMAL')
  })
})

describe('anti-spam rate limits', () => {
  it('blocks only at/after the configured cap', () => {
    expect(rateLimited('REVIEWS_PER_DAY', RATE_LIMITS.REVIEWS_PER_DAY)).toBe(true)
    expect(rateLimited('REVIEWS_PER_DAY', RATE_LIMITS.REVIEWS_PER_DAY - 1)).toBe(false)
    expect(rateLimited('COMPLAINTS_PER_DAY', 0)).toBe(false)
    expect(rateLimited('APPEALS_PER_DAY', RATE_LIMITS.APPEALS_PER_DAY)).toBe(true)
    expect(rateLimited('FLAGS_PER_DAY', RATE_LIMITS.FLAGS_PER_DAY - 1)).toBe(false)
  })
})
