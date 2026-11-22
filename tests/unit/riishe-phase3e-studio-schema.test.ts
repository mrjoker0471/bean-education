import { describe, it, expect } from 'bun:test'

// ─── Phase 3E — Studio activity schemas + deterministic arithmetic ────────────
// Every interactive activity the model produces must pass strict programmatic
// validation BEFORE it can reach the UI: shape, bounds, id integrity, tree
// integrity, answer ranges. Formula walkthroughs additionally go through a
// server-side arithmetic evaluator (recursive descent — never eval/Function)
// that decides whether a walkthrough may be called verified or must be
// presented as illustrative. These tests pin those contracts.

import {
  evaluateArithmetic,
  formatComputedNumber,
  parseClaimedNumber,
  normalizeConceptMap,
  normalizeSteps,
  normalizeFormula,
  normalizeFlashcards,
  normalizeMiniTest,
  StudioValidationError,
} from '@/lib/riishe/studio'
import {
  conceptChildrenMap,
  conceptDepthOf,
  conceptRelatedIds,
  scoreMiniTest,
  shuffleWithSeed,
  STUDIO_MINITEST_HONESTY_NOTE,
} from '@/lib/riishe/studio-types'

// ─── Arithmetic evaluator ─────────────────────────────────────────────────────

describe('Phase 3E — deterministic arithmetic evaluator', () => {
  it('evaluates the four basic operators with correct precedence', () => {
    expect(evaluateArithmetic('2 + 3 * 4')).toBe(14)
    expect(evaluateArithmetic('(2 + 3) * 4')).toBe(20)
    expect(evaluateArithmetic('10 / 4')).toBe(2.5)
    expect(evaluateArithmetic('10 - 2 - 3')).toBe(5)
    expect(evaluateArithmetic('7 % 3')).toBe(1)
  })

  it('supports powers (both ^ and **), unary minus and decimals', () => {
    expect(evaluateArithmetic('2^10')).toBe(1024)
    expect(evaluateArithmetic('2**10')).toBe(1024)
    expect(evaluateArithmetic('2^3^2')).toBe(512) // right-associative
    expect(evaluateArithmetic('-3 + 5')).toBe(2)
    expect(evaluateArithmetic('2 * -0.5')).toBe(-1)
    expect(evaluateArithmetic('0.25 * 4')).toBe(1)
    expect(evaluateArithmetic('(.5 + .5) * 8')).toBe(8)
  })

  it('supports pi and the typographic operator symbols models emit', () => {
    expect(evaluateArithmetic('pi * 2')).toBeCloseTo(Math.PI * 2, 12)
    expect(evaluateArithmetic('π * 2')).toBeCloseTo(Math.PI * 2, 12)
    expect(evaluateArithmetic('6 × 7')).toBe(42)
    expect(evaluateArithmetic('9 ÷ 3')).toBe(3)
    expect(evaluateArithmetic('10 − 4')).toBe(6)
    expect(evaluateArithmetic('1,500 * 2')).toBe(3000) // thousands separators
  })

  it('rejects unsafe or malformed expressions instead of guessing', () => {
    expect(() => evaluateArithmetic('')).toThrow()
    expect(() => evaluateArithmetic('1 / 0')).toThrow(/division by zero/)
    expect(() => evaluateArithmetic('mass * 2')).toThrow(/unknown identifier/)
    expect(() => evaluateArithmetic('2 + +')).toThrow()
    expect(() => evaluateArithmetic('(1 + 2')).toThrow(/missing closing/)
    expect(() => evaluateArithmetic('1 2')).toThrow(/trailing/)
    expect(() => evaluateArithmetic('system("rm -rf")')).toThrow()
    expect(() => evaluateArithmetic('process.env')).toThrow()
  })

  it('formats computed values and parses claimed results tolerantly', () => {
    expect(formatComputedNumber(12.5)).toBe('12.5')
    expect(formatComputedNumber(1 / 3)).toBe('0.333333')
    expect(formatComputedNumber(-0)).toBe('0')
    expect(parseClaimedNumber('≈ 12.56 cm²')).toBeCloseTo(12.56, 10)
    expect(parseClaimedNumber('1,234.5 m')).toBeCloseTo(1234.5, 10)
    expect(parseClaimedNumber('~0')).toBe(0)
    expect(parseClaimedNumber('no number here')).toBeNull()
  })
})

// ─── Concept map validator ────────────────────────────────────────────────────

function node(id: string, parent: string | null, label = `Concept ${id}`) {
  return { id, label, parent, explanation: `Accessible explanation of ${label}.` }
}

describe('Phase 3E — concept map schema validation', () => {
  const valid = {
    title: 'Photosynthesis',
    nodes: [
      node('n1', null, 'Photosynthesis'),
      node('n2', 'n1', 'Light reactions'),
      node('n3', 'n1', 'Calvin cycle'),
      node('n4', 'n2', 'Chlorophyll'),
      node('n5', 'n3', 'Glucose'),
      node('n6', 'n3', 'Stomata'),
    ],
  }

  it('accepts a valid single-root tree and reorders it parent-first (BFS)', () => {
    const map = normalizeConceptMap(valid)
    expect(map.kind).toBe('concept-map')
    expect(map.title).toBe('Photosynthesis')
    expect(map.nodes[0].id).toBe('n1')
    // BFS order: root first, then level-one nodes before deeper ones
    expect(map.nodes.slice(1, 3).map(n => n.id).sort()).toEqual(['n2', 'n3'])
    expect(map.nodes[map.nodes.length - 1].id).toBe('n6')
  })

  it('rejects maps without exactly one central concept', () => {
    expect(() => normalizeConceptMap({ ...valid, nodes: valid.nodes.map(n => ({ ...n, parent: 'n1' })) })).toThrow(StudioValidationError)
    expect(() => normalizeConceptMap({ ...valid, nodes: [node('n1', null, 'A'), node('n2', null, 'B'), node('n3', 'n1', 'C')] })).toThrow(/exactly one central/)
  })

  it('rejects cycles and unknown parent references', () => {
    // Cycle among siblings below a valid root (the single-root rule fires
    // first when no root exists, so the cycle fixture keeps one).
    const cyc = {
      title: 't',
      nodes: [node('n1', null), node('n2', 'n3'), node('n3', 'n2'), node('n4', 'n1')],
    }
    expect(() => normalizeConceptMap(cyc)).toThrow(/cycle/)
    expect(() => normalizeConceptMap({ title: 't', nodes: [node('n1', null), node('n2', 'ghost'), node('n3', 'n1')] })).toThrow(/unknown parent/)
  })

  it('rejects duplicate/invalid ids, depth overflow and empty text', () => {
    expect(() => normalizeConceptMap({ title: 't', nodes: [node('n1', null), node('n1', 'n1'), node('n2', 'n1'), node('n3', 'n1')] })).toThrow(/duplicate/)
    expect(() => normalizeConceptMap({ title: 't', nodes: [node('n1', null), { ...node('n2', 'n1'), id: 'DROP TABLE' }, node('n3', 'n1'), node('n4', 'n1')] })).toThrow(/invalid node id/)
    expect(() =>
      normalizeConceptMap({
        title: 't',
        nodes: [node('a', null), node('b', 'a'), node('c', 'b'), node('d', 'c'), node('e', 'd'), node('f', 'e'), node('g', 'f')],
      }),
    ).toThrow(/deeper than 5/)
    expect(() =>
      normalizeConceptMap({
        title: 't',
        nodes: [node('n1', null), { ...node('n2', 'n1'), explanation: '   ' }, node('n3', 'n1'), node('n4', 'n1')],
      }),
    ).toThrow(/empty explanation/)
  })

  it('enforces the node-count bounds', () => {
    expect(() => normalizeConceptMap({ title: 't', nodes: [node('n1', null), node('n2', 'n1')] })).toThrow(/3–40/)
    const tooMany = Array.from({ length: 41 }, (_, i) => node(`n${i}`, i === 0 ? null : `n${i - 1}`))
    expect(() => normalizeConceptMap({ title: 't', nodes: tooMany })).toThrow(/3–40/)
  })

  it('exposes pure helpers for selection and navigation', () => {
    const map = normalizeConceptMap(valid)
    expect(conceptChildrenMap(map.nodes).get('n1')?.sort()).toEqual(['n2', 'n3'])
    expect(conceptDepthOf(map.nodes, 'n4')).toBe(2)
    expect(conceptRelatedIds(map.nodes, 'n2').map(n => n)).toEqual(['n1', 'n4'])
    expect(conceptRelatedIds(map.nodes, 'n1')).toEqual(['n2', 'n3'])
  })
})

// ─── Steps validator ──────────────────────────────────────────────────────────

describe('Phase 3E — step-by-step schema validation', () => {
  const step = (i: number) => ({ title: `Step ${i} title`, body: `Focused explanation body for step ${i}, long enough to be real teaching text.` })

  it('accepts a valid sequence and trims cosmetic noise', () => {
    const steps = normalizeSteps({ title: '  How transformers work  ', steps: [step(1), step(2), { ...step(3), example: '  Worked mini-example. ' }] })
    expect(steps.title).toBe('How transformers work')
    expect(steps.steps).toHaveLength(3)
    expect(steps.steps[2].example).toBe('Worked mini-example.')
  })

  it('rejects too-few steps and empty bodies', () => {
    expect(() => normalizeSteps({ steps: [step(1), step(2)] })).toThrow(/3–12/)
    expect(() => normalizeSteps({ steps: [step(1), { ...step(2), body: '  ' }, step(3)] })).toThrow(StudioValidationError)
  })
})

// ─── Formula walkthrough validator + verification ─────────────────────────────

describe('Phase 3E — formula walkthrough schema + deterministic verification', () => {
  const verifiedPayload = {
    title: 'Area of a circle',
    formula: 'A = pi * r^2',
    variables: [
      { symbol: 'A', meaning: 'area of the circle' },
      { symbol: 'r', meaning: 'radius' },
    ],
    steps: [
      { stage: 'substitute', description: 'Insert r = 2 cm into the formula.' },
      { stage: 'calculate', description: 'Square the radius and multiply by pi.', expression: 'pi * 2^2', claimedResult: '≈ 12.57 cm²' },
    ],
    result: { value: '12.57', units: 'cm²' },
  }

  it('marks a walkthrough verified when every numeric step recomputes to the claim', () => {
    const f = normalizeFormula(verifiedPayload)
    expect(f.kind).toBe('formula')
    expect(f.steps[1].verification?.matches).toBe(true)
    expect(f.steps[1].verification?.computed).toBe('12.566371')
    expect(f.result?.verified).toBe(true)
    expect(f.result?.illustrative).toBe(false)
  })

  it('downgrades to illustrative when arithmetic does not match — never invents certainty', () => {
    const wrong = { ...verifiedPayload, steps: [{ stage: 'calculate', description: 'compute', expression: 'pi * 2^2', claimedResult: '15.9' }], result: { value: '15.9', units: 'cm²' } }
    const f = normalizeFormula(wrong)
    expect(f.steps[0].verification?.matches).toBe(false)
    expect(f.result?.verified).toBe(false)
    expect(f.result?.illustrative).toBe(true)
    expect(f.result?.note).toBeTruthy()
  })

  it('marks unparseable expressions and division by zero as unverified', () => {
    const badExpr = { ...verifiedPayload, steps: [{ stage: 'calculate', description: 'compute', expression: 'pi * radius^2', claimedResult: '12.57' }], result: { value: '12.57' } }
    expect(normalizeFormula(badExpr).result?.illustrative).toBe(true)

    const div0 = { ...verifiedPayload, steps: [{ stage: 'calculate', description: 'compute', expression: '5 / 0', claimedResult: '∞' }], result: { value: '0' } }
    const f = normalizeFormula(div0)
    expect(f.steps[0].verification?.matches).toBe(false)
    expect(f.result?.verified).toBe(false)
  })

  it('treats a purely symbolic walkthrough (no expressions) as illustrative', () => {
    const symbolic = {
      title: 'Ohm\u2019s law',
      formula: 'V = I * R',
      variables: [{ symbol: 'V', meaning: 'voltage' }, { symbol: 'I', meaning: 'current' }, { symbol: 'R', meaning: 'resistance' }],
      steps: [{ stage: 'substitute', description: 'Substitute the measured current and resistance into V = I * R.' }],
      result: { value: 'I * R', units: 'V' },
    }
    const f = normalizeFormula(symbolic)
    expect(f.result?.verified).toBe(false)
    expect(f.result?.illustrative).toBe(true)
    expect(f.result?.note).toMatch(/illustrative/i)
  })

  it('rejects substitute steps that appear after calculate steps', () => {
    const outOfOrder = {
      ...verifiedPayload,
      steps: [
        { stage: 'calculate', description: 'compute', expression: 'pi * 2^2', claimedResult: '12.57' },
        { stage: 'substitute', description: 'Insert r = 2 cm.' },
      ],
    }
    expect(() => normalizeFormula(outOfOrder)).toThrow(/before calculate/)
  })

  it('requires a result when numeric calculate steps exist', () => {
    const noResult = { ...verifiedPayload, result: undefined }
    expect(() => normalizeFormula(noResult)).toThrow(/result is required/)
  })
})

// ─── Flashcards validator ─────────────────────────────────────────────────────

describe('Phase 3E — flashcard schema validation', () => {
  const card = (i: number) => ({ front: `Front of card ${i}`, back: `Back of card ${i} with the explanation.`, kindTag: i % 2 === 0 ? 'definition' : 'qa' })

  it('accepts a valid mixed set and drops unknown kind tags', () => {
    const set = normalizeFlashcards({ title: 'Revision', cards: [card(1), card(2), card(3), { ...card(4), kindTag: 'not-a-tag' }] })
    expect(set.cards).toHaveLength(4)
    expect(set.cards[3].kindTag).toBeUndefined()
    expect(set.cards[0].kindTag).toBe('qa') // card(1): 1 % 2 === 1 → 'qa'
  })

  it('rejects sets below four cards and cards with empty sides', () => {
    expect(() => normalizeFlashcards({ cards: [card(1), card(2), card(3)] })).toThrow(/4–30/)
    expect(() => normalizeFlashcards({ cards: [card(1), card(2), card(3), { front: '  ', back: 'x' }] })).toThrow(StudioValidationError)
  })
})

// ─── Mini-test validator ──────────────────────────────────────────────────────

describe('Phase 3E — mini-test schema validation', () => {
  const q = (i: number, over: Record<string, unknown> = {}) => ({
    prompt: `Question ${i}: which statement is correct about the topic?`,
    options: ['First option', 'Second option', 'Third option', 'Fourth option'],
    correctIndex: i % 4,
    explanation: 'The correct option follows directly from the definition given in the material, while the distractors invert it.',
    ...over,
  })

  it('accepts a valid test, fixes the honesty note and orders difficulty ascending', () => {
    const test = normalizeMiniTest(
      {
        title: 'Photosynthesis check',
        questions: [q(1, { difficulty: 'application' }), q(2, { difficulty: 'foundation' }), q(3, { difficulty: 'advanced' })],
      },
      null,
    )
    expect(test.honestyNote).toBe(STUDIO_MINITEST_HONESTY_NOTE)
    expect(test.questions.map(x => x.difficulty)).toEqual(['foundation', 'application', 'advanced'])
  })

  it('keeps page references only when the cited page was actually fed to the model', () => {
    const payload = { title: 't', questions: [q(1, { pageRef: 3 }), q(2, { pageRef: 99 }), q(3)] }
    const grounded = normalizeMiniTest(payload, new Set([1, 2, 3, 4]))
    expect(grounded.questions[0].pageRef).toBe(3)
    expect(grounded.questions.find(x => x.prompt.startsWith('Question 2'))?.pageRef).toBeUndefined()

    const general = normalizeMiniTest(payload, null)
    expect(general.questions.every(x => x.pageRef === undefined)).toBe(true)
  })

  it('rejects duplicate options, out-of-range correctIndex and thin explanations', () => {
    expect(() => normalizeMiniTest({ questions: [q(1, { options: ['a', 'a', 'b', 'c'] }), q(2), q(3)] }, null)).toThrow(/duplicate options/)
    expect(() => normalizeMiniTest({ questions: [q(1, { correctIndex: 9 }), q(2), q(3)] }, null)).toThrow(/out-of-range/)
    expect(() => normalizeMiniTest({ questions: [q(1, { explanation: 'too short' }), q(2), q(3)] }, null)).toThrow(/real explanation/)
    expect(() => normalizeMiniTest({ questions: [q(1)] }, null)).toThrow(/3–10/)
  })
})

// ─── Client-side scoring + shuffle helpers ────────────────────────────────────

describe('Phase 3E — mini-test scoring + flashcard shuffle helpers', () => {
  it('scores deterministically and never inflates results', () => {
    const qs = [{ correctIndex: 0 }, { correctIndex: 2 }, { correctIndex: 1 }, { correctIndex: 3 }]
    expect(scoreMiniTest(qs, [0, 2, 1, 3])).toEqual({ correct: 4, answered: 4, total: 4, percent: 100 })
    expect(scoreMiniTest(qs, [1, 2, null, 0])).toEqual({ correct: 1, answered: 3, total: 4, percent: 25 })
    expect(scoreMiniTest(qs, [null, null, null, null])).toEqual({ correct: 0, answered: 0, total: 4, percent: 0 })
  })

  it('shuffles reproducibly for a seed and keeps every card', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = shuffleWithSeed(items, 42)
    const b = shuffleWithSeed(items, 42)
    expect(a).toEqual(b)
    expect([...a].sort()).toEqual([...items].sort())
    expect(shuffleWithSeed(items, 43)).not.toEqual(a)
  })
})
