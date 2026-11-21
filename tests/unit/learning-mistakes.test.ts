import { describe, it, expect, mock } from 'bun:test'

// ─── Mistake classification (Phase 3B, pure) ──────────────────────────────────
// Evidence-only categories: the system never guesses FACT/FORMULA/MISREAD —
// those exist only as student self-tags.

mock.module('@/lib/db', () => ({ db: {} }))

import { classifyMistake, normalizeStudentTag, mistakeRowToDTO } from '@/lib/learning/mistakes'

describe('classifyMistake — evidence-only categories', () => {
  it('CONCEPT requires a grounded concept name', () => {
    const r = classifyMistake({ priorWrongSameQuestion: 0, priorWrongSameTopic: 0, groundedConcept: 'Newton third law confusion' })
    expect(r.category).toBe('CONCEPT')
    expect(r.categoryReason).toContain('Newton third law confusion')
  })

  it('REPEAT_GAP on a repeated same-question miss', () => {
    const r = classifyMistake({ priorWrongSameQuestion: 1, priorWrongSameTopic: 0, groundedConcept: null })
    expect(r.category).toBe('REPEAT_GAP')
    expect(r.categoryReason).toContain('2 times')
  })

  it('REPEAT_GAP on a topic-level pattern (≥2 prior topic misses)', () => {
    const r = classifyMistake({ priorWrongSameQuestion: 0, priorWrongSameTopic: 2, groundedConcept: null })
    expect(r.category).toBe('REPEAT_GAP')
  })

  it('UNCLASSIFIED is the honest default — no guessing FACT/FORMULA/MISREAD', () => {
    const r = classifyMistake({ priorWrongSameQuestion: 0, priorWrongSameTopic: 1, groundedConcept: null })
    expect(r.category).toBe('UNCLASSIFIED')
    expect(r.categoryReason).toBeNull()
  })

  it('grounded concept wins over REPEAT_GAP (it explains the gap)', () => {
    const r = classifyMistake({ priorWrongSameQuestion: 2, priorWrongSameTopic: 2, groundedConcept: 'sign error' })
    expect(r.category).toBe('CONCEPT')
  })
})

describe('student self-tags', () => {
  it('accept only the four documented values', () => {
    expect(normalizeStudentTag('CONCEPT')).toBe('CONCEPT')
    expect(normalizeStudentTag('FACT')).toBe('FACT')
    expect(normalizeStudentTag('FORMULA')).toBe('FORMULA')
    expect(normalizeStudentTag('MISREAD')).toBe('MISREAD')
    expect(normalizeStudentTag('GUESS')).toBeNull()
    expect(normalizeStudentTag(null)).toBeNull()
    expect(normalizeStudentTag(42)).toBeNull()
  })
})

describe('mistakeRowToDTO — snapshot safety', () => {
  it('survives a corrupt snapshot without throwing and without inventing options', () => {
    const dto = mistakeRowToDTO(
      {
        id: 'm1',
        attemptId: 'a1',
        questionId: 'q1',
        source: 'BANK',
        topicId: null,
        topicName: 'Kinematics',
        chosenIndex: 2,
        correctIndex: 0,
        snapshotJson: '{not json',
        category: 'UNCLASSIFIED',
        categoryReason: null,
        studentTag: null,
        note: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      3,
    )
    expect(dto.text).toContain('unavailable')
    expect(dto.options).toEqual([])
    expect(dto.timesWrong).toBe(3)
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('renders a real snapshot with options and explanation', () => {
    const dto = mistakeRowToDTO(
      {
        id: 'm2',
        attemptId: 'a1',
        questionId: 'q1',
        source: 'RIISHE',
        topicId: null,
        topicName: null,
        chosenIndex: 1,
        correctIndex: 2,
        snapshotJson: JSON.stringify({ text: 'What is g?', options: ['9.8', '98', '1.6'], explanation: 'g is 9.8 m/s² on Earth.' }),
        category: 'REPEAT_GAP',
        categoryReason: 'Repeat gap — you have missed this exact question 2 times now.',
        studentTag: 'FACT',
        note: null,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      2,
    )
    expect(dto.text).toBe('What is g?')
    expect(dto.options.length).toBe(3)
    expect(dto.explanation).toContain('9.8')
    expect(dto.studentTag).toBe('FACT') // self-report preserved, never overwritten
    expect(dto.category).toBe('REPEAT_GAP')
  })
})
