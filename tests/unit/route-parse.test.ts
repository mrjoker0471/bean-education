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
