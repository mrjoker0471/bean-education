import { describe, it, expect } from 'bun:test'
import { isValidAnswerIndex } from '@/lib/answer-index'

// Phase 2A: the ONE canonical rule for what counts as an answered MCQ —
// an integer inside the question's real option range [0, optionCount).
// Out-of-range or malformed submissions must be treated as SKIPPED, never
// as a valid wrong answer.

describe('isValidAnswerIndex', () => {
  it('accepts integers inside the option range', () => {
    expect(isValidAnswerIndex(0, 4)).toBe(true)
    expect(isValidAnswerIndex(3, 4)).toBe(true)
    expect(isValidAnswerIndex(1, 2)).toBe(true)
  })

  it('rejects indices at or beyond the option count', () => {
    expect(isValidAnswerIndex(4, 4)).toBe(false)
    expect(isValidAnswerIndex(5, 4)).toBe(false)
    expect(isValidAnswerIndex(100, 4)).toBe(false)
  })

  it('rejects negative indices', () => {
    expect(isValidAnswerIndex(-1, 4)).toBe(false)
  })

  it('rejects non-integers and non-numbers', () => {
    expect(isValidAnswerIndex(1.5, 4)).toBe(false)
    expect(isValidAnswerIndex('2', 4)).toBe(false)
    expect(isValidAnswerIndex(null, 4)).toBe(false)
    expect(isValidAnswerIndex(undefined, 4)).toBe(false)
    expect(isValidAnswerIndex(NaN, 4)).toBe(false)
    expect(isValidAnswerIndex(Infinity, 4)).toBe(false)
  })

  it('rejects anything when the question has no options', () => {
    expect(isValidAnswerIndex(0, 0)).toBe(false)
    expect(isValidAnswerIndex(1, -3)).toBe(false)
  })

  it('accepts valid indices in larger option sets (2..6 options)', () => {
    expect(isValidAnswerIndex(5, 6)).toBe(true)
    expect(isValidAnswerIndex(1, 2)).toBe(true)
    expect(isValidAnswerIndex(6, 6)).toBe(false)
  })
})
