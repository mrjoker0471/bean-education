import { describe, it, expect } from 'bun:test'
import { normalizeForHash, computePyqHash, validatePyqItem } from '@/lib/pyq'

// Phase 2A: PYQ duplicate detection must be content-stable (case, punctuation
// and whitespace differences must NOT create phantom duplicates), and row
// validation must reject malformed rows with one honest error each.

describe('normalizeForHash', () => {
  it('is stable across case, punctuation and whitespace noise', () => {
    const a = normalizeForHash('What is the capital of India?')
    const b = normalizeForHash('  what  is  the  Capital   of  India!  ')
    expect(a).toBe(b)
  })

  it('collapses smart quotes and strips punctuation', () => {
    const a = normalizeForHash('The "right" answer…')
    const b = normalizeForHash('The right answer')
    expect(a).toBe(b)
  })
})

describe('computePyqHash', () => {
  it('is identical for cosmetically different but content-identical questions', () => {
    const h1 = computePyqHash('Which Article covers Emergency?', ['Article 352', 'Article 356', 'Article 360', 'Article 368'], 0)
    const h2 = computePyqHash('which article covers emergency', ['article 352 ', 'Article 356.', 'ARTICLE 360', 'article 368'], 0)
    expect(h1).toBe(h2)
  })

  it('changes when the keyed answer changes', () => {
    const base = (correct: number) => computePyqHash('Pick one', ['A', 'B', 'C', 'D'], correct)
    expect(base(0)).not.toBe(base(1))
  })

  it('changes when an option changes', () => {
    const h1 = computePyqHash('Pick one', ['A', 'B', 'C', 'D'], 0)
    const h2 = computePyqHash('Pick one', ['A', 'B', 'C', 'E'], 0)
    expect(h1).not.toBe(h2)
  })
})

describe('validatePyqItem', () => {
  const good = {
    text: 'What is the capital of Tamil Nadu?',
    options: ['Chennai', 'Coimbatore', 'Madurai', 'Salem'],
    correctIndex: 0,
  }

  it('accepts a well-formed row', () => {
    expect(validatePyqItem(good).ok).toBe(true)
  })

  it('rejects too-short text', () => {
    expect(validatePyqItem({ ...good, text: 'hi' }).ok).toBe(false)
  })

  it('rejects too few or too many options', () => {
    expect(validatePyqItem({ ...good, options: ['Chennai'] }).ok).toBe(false)
    expect(validatePyqItem({ ...good, options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }).ok).toBe(false)
  })

  it('rejects an out-of-range correctIndex (never a valid answer)', () => {
    expect(validatePyqItem({ ...good, correctIndex: 4 }).ok).toBe(false)
    expect(validatePyqItem({ ...good, correctIndex: -1 }).ok).toBe(false)
  })

  it('rejects invalid difficulty values', () => {
    expect(validatePyqItem({ ...good, difficulty: 'IMPOSSIBLE' }).ok).toBe(false)
  })

  it('rejects implausible years', () => {
    expect(validatePyqItem({ ...good, year: 1899 }).ok).toBe(false)
    expect(validatePyqItem({ ...good, year: 2036 }).ok).toBe(false)
  })

  it('accepts optional provenance fields when valid', () => {
    expect(validatePyqItem({ ...good, difficulty: 'HARD', year: 2019, sourceRef: 'Booklet A, Q12' }).ok).toBe(true)
  })
})
