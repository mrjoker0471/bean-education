import { describe, it, expect } from 'bun:test'
import { parseHash } from '@/lib/store'

// Hash router additions (Phase 2A): the #/auth route must parse and round-trip
// while every existing route keeps parsing exactly as before.

describe('parseHash', () => {
  it('parses the auth route', () => {
    expect(parseHash('#/auth')).toEqual({ view: 'auth' })
  })

  it('keeps existing routes parsing correctly', () => {
    expect(parseHash('#/')).toEqual({ view: 'home' })
    expect(parseHash('')).toEqual({ view: 'home' })
    expect(parseHash('#/catalog?category=engineering&q=gate')).toEqual({ view: 'catalog', category: 'engineering', q: 'gate' })
    expect(parseHash('#/exam/cuet-ug?tab=syllabus')).toEqual({ view: 'exam', slug: 'cuet-ug', tab: 'syllabus' })
    expect(parseHash('#/topic/abc')).toEqual({ view: 'topic', topicId: 'abc' })
    expect(parseHash('#/result/xyz?q=q1')).toEqual({ view: 'result', attemptId: 'xyz', questionId: 'q1' })
    expect(parseHash('#/riishe')).toEqual({ view: 'riishe' })
    expect(parseHash('#/nope')).toEqual({ view: 'not-found' })
  })
})

describe('parseHash — BEAN Teach routes (Phase 4A)', () => {
  it('parses the classes marketplace and detail routes', () => {
    expect(parseHash('#/classes')).toEqual({ view: 'classes', tab: 'browse' })
    expect(parseHash('#/classes?tab=bookings')).toEqual({ view: 'classes', tab: 'bookings' })
    expect(parseHash('#/classes/abc123')).toEqual({ view: 'class', classId: 'abc123' })
  })

  it('parses the teach apply/dashboard/review routes', () => {
    expect(parseHash('#/teach/apply')).toEqual({ view: 'teach-apply' })
    expect(parseHash('#/teach/dashboard')).toEqual({ view: 'teach-dashboard' })
    expect(parseHash('#/teach/review')).toEqual({ view: 'teach-review' })
  })

  it('unknown teach sub-routes fall through to not-found', () => {
    expect(parseHash('#/teach')).toEqual({ view: 'not-found' })
    expect(parseHash('#/teach/nope')).toEqual({ view: 'not-found' })
  })

  it('round-trips the new routes through routeToHash', async () => {
    const { routeToHash } = await import('@/lib/store')
    expect(routeToHash({ view: 'classes' })).toBe('#/classes')
    expect(routeToHash({ view: 'classes', tab: 'bookings' })).toBe('#/classes?tab=bookings')
    expect(routeToHash({ view: 'class', classId: 'abc' })).toBe('#/classes/abc')
    expect(routeToHash({ view: 'teach-apply' })).toBe('#/teach/apply')
    expect(routeToHash({ view: 'teach-dashboard' })).toBe('#/teach/dashboard')
    expect(routeToHash({ view: 'teach-review' })).toBe('#/teach/review')
  })
})
