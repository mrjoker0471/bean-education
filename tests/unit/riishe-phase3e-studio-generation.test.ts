import { describe, it, expect, beforeEach } from 'bun:test'

// ─── Phase 3E — Studio generation pipeline (provider seam injected) ───────────
// Drives generateStudioActivity with an injected chatJson so NO provider is
// contacted. Pins the reliability contract:
//   - valid payloads pass through validation untouched (plain-text only)
//   - malformed payloads get ONE semantic repair retry carrying the exact
//     validation errors, then fail honestly (StudioGenerationError)
//   - provider failures fail honestly too
//   - page references survive only when the cited page was actually fed
//   - formula arithmetic is recomputed server-side; verification/illustrative
//     flags are decided by the server, never by the model
//   - the selected response language is carried into the system prompt

import {
  generateStudioActivity,
  StudioGenerationError,
  type StudioMaterialBlock,
} from '@/lib/riishe/studio'
import type { StudioGroundingContext } from '@/lib/riishe/studio'
import type { RiisheResponseLanguage } from '@/lib/riishe/tutor'

interface ChatCall {
  system: string
  user: string
}

const docBlocks: StudioMaterialBlock[] = [
  {
    label: 'Physics Essentials · pages 1–2',
    text: '[page 1]\nNewton\u2019s first law states that a body continues at rest or in uniform motion unless a net external force acts on it. [page 2]\nInertia is the property that resists changes in motion.',
    pages: [1, 2],
  },
]

const documentGrounding: StudioGroundingContext = { mode: 'document', docTitle: 'Physics Essentials', blocks: docBlocks }
const generalGrounding: StudioGroundingContext = { mode: 'general', blocks: [] }

function makeDeps(responses: unknown[]) {
  const calls: ChatCall[] = []
  let i = 0
  return {
    calls,
    deps: {
      chatJson: async <T,>(opts: { system: string; user: string }): Promise<T> => {
        calls.push({ system: opts.system, user: opts.user })
        const next = responses[Math.min(i, responses.length - 1)]
        i++
        if (next instanceof Error) throw next
        return next as T
      },
    },
  }
}

const validConceptMap = {
  title: 'Laws of motion',
  nodes: [
    { id: 'n1', label: 'Newton\u2019s laws', parent: null, explanation: 'The three laws describe how forces change motion.' },
    { id: 'n2', label: 'First law', parent: 'n1', explanation: 'A body stays at rest or in uniform motion without a net external force.' },
    { id: 'n3', label: 'Inertia', parent: 'n2', explanation: 'The resistance of a body to changes in its state of motion.' },
    { id: 'n4', label: 'Second law', parent: 'n1', explanation: 'Force equals mass times acceleration.' },
    { id: 'n5', label: 'Third law', parent: 'n1', explanation: 'Every action has an equal and opposite reaction.' },
    { id: 'n6', label: 'Momentum', parent: 'n4', explanation: 'Mass in motion; conserved in isolated systems.' },
  ],
}

const validMiniTest = {
  title: 'Motion check',
  questions: [
    {
      prompt: 'A book rests on a table. Which pair of forces balances?',
      options: ['Weight and normal reaction', 'Weight and friction', 'Normal reaction and air resistance', 'Weight and tension'],
      correctIndex: 0,
      explanation: 'The table pushes up with the normal reaction, which balances the book\u2019s weight; no horizontal forces act.',
      difficulty: 'foundation',
      pageRef: 1,
    },
    {
      prompt: 'A trolley accelerates at 2 m/s² under a 6 N force. What is its mass?',
      options: ['3 kg', '12 kg', '1.5 kg', '8 kg'],
      correctIndex: 0,
      explanation: 'Rearranging F = ma gives m = F/a = 6/2 = 3 kg, using the second-law relation from the material.',
      difficulty: 'application',
      pageRef: 99, // not in the fed pages — must be stripped
    },
    {
      prompt: 'Two skaters push off each other. What can be said about their momenta?',
      options: ['They are equal and opposite', 'Only the lighter one moves', 'Both stay at rest', 'The heavier one moves faster'],
      correctIndex: 0,
      explanation: 'The third law gives equal and opposite forces, so the gained momenta are equal and opposite (conservation).',
      difficulty: 'advanced',
    },
  ],
}

async function generate(
  kind: 'concept-map' | 'mini-test' | 'formula' | 'flashcards' | 'steps',
  responses: unknown[],
  grounding: StudioGroundingContext = documentGrounding,
  responseLanguage: RiisheResponseLanguage = 'auto',
) {
  const { deps, calls } = makeDeps(responses)
  const result = await generateStudioActivity({ kind, topic: 'Laws of motion', grounding, responseLanguage, deps })
  return { result, calls }
}

beforeEach(() => {})

describe('Phase 3E — studio generation: valid payloads', () => {
  it('passes a valid concept map through untouched and grounds it as document', async () => {
    const { result, calls } = await generate('concept-map', [validConceptMap])
    expect(result.grounding).toBe('document')
    expect(result.docTitle).toBe('Physics Essentials')
    expect(result.activity.kind).toBe('concept-map')
    if (result.activity.kind !== 'concept-map') throw new Error('unreachable')
    expect(result.activity.title).toBe('Laws of motion')
    expect(result.activity.nodes).toHaveLength(6)
    // The provider received the fenced material and the topic
    expect(calls).toHaveLength(1)
    expect(calls[0].system).toContain('VISUAL CONCEPT MAP')
    expect(calls[0].user).toContain('<document source="student study material">')
    expect(calls[0].user).toContain('Topic: Laws of motion')
    expect(calls[0].user).toContain('untrusted STUDY DATA')
  })

  it('carries the selected response language into the system prompt', async () => {
    const { calls } = await generate('flashcards', [{
      title: 'Revision',
      cards: [
        { front: 'Define inertia.', back: 'Inertia is the resistance of a body to changes in its state of motion.', kindTag: 'definition' },
        { front: 'State the second law.', back: 'F = ma — force equals mass times acceleration.', kindTag: 'fact' },
        { front: 'What is momentum?', back: 'Mass in motion: p = mv.', kindTag: 'qa' },
        { front: 'State the third law.', back: 'Every action has an equal and opposite reaction.', kindTag: 'fact' },
      ],
    }], documentGrounding, 'ta')
    expect(calls[0].system).toMatch(/RESPONSE LANGUAGE — Tamil/)
    expect(calls[0].system).toMatch(/every string value .* must be written in the language/i)
  })

  it('keeps verified page references in document mode and strips fabricated ones', async () => {
    const { result } = await generate('mini-test', [validMiniTest])
    expect(result.grounding).toBe('document')
    if (result.activity.kind !== 'mini-test') throw new Error('unreachable')
    const withRef = result.activity.questions.find(q => q.prompt.startsWith('A book rests'))
    const fabricated = result.activity.questions.find(q => q.prompt.startsWith('A trolley'))
    expect(withRef?.pageRef).toBe(1)
    expect(fabricated?.pageRef).toBeUndefined()
  })

  it('never keeps page references in general mode (nothing was fed)', async () => {
    const { result } = await generate('mini-test', [validMiniTest], generalGrounding)
    expect(result.grounding).toBe('general')
    if (result.activity.kind !== 'mini-test') throw new Error('unreachable')
    expect(result.activity.questions.every(q => q.pageRef === undefined)).toBe(true)
  })

  it('marks correct arithmetic verified and wrong arithmetic illustrative', async () => {
    const good = await generate('formula', [{
      title: 'Area of a circle',
      formula: 'A = pi * r^2',
      variables: [{ symbol: 'A', meaning: 'area' }, { symbol: 'r', meaning: 'radius' }],
      steps: [
        { stage: 'substitute', description: 'Insert r = 2 cm.' },
        { stage: 'calculate', description: 'Multiply.', expression: 'pi * 2^2', claimedResult: '≈ 12.57 cm²' },
      ],
      result: { value: '12.57', units: 'cm²' },
    }])
    if (good.result.activity.kind !== 'formula') throw new Error('unreachable')
    expect(good.result.activity.result?.verified).toBe(true)
    expect(good.result.activity.result?.illustrative).toBe(false)

    const bad = await generate('formula', [{
      title: 'Area of a circle',
      formula: 'A = pi * r^2',
      variables: [{ symbol: 'A', meaning: 'area' }, { symbol: 'r', meaning: 'radius' }],
      steps: [{ stage: 'calculate', description: 'Multiply.', expression: 'pi * 2^2', claimedResult: '25.13' }],
      result: { value: '25.13', units: 'cm²' },
    }])
    if (bad.result.activity.kind !== 'formula') throw new Error('unreachable')
    expect(bad.result.activity.result?.verified).toBe(false)
    expect(bad.result.activity.result?.illustrative).toBe(true)
    expect(bad.result.activity.result?.note).toMatch(/does not match/)
  })
})

describe('Phase 3E — studio generation: honest failure paths', () => {
  it('repairs a malformed payload with one retry carrying the exact validation errors', async () => {
    const broken = { ...validConceptMap, nodes: validConceptMap.nodes.slice(0, 2) } // too few nodes
    const { result, calls } = await generate('concept-map', [broken, validConceptMap])
    expect(result.activity.kind).toBe('concept-map')
    expect(calls).toHaveLength(2)
    expect(calls[1].user).toMatch(/rejected by validation: concept map needs 3–40 nodes/)
    expect(calls[1].user).toContain('Fix exactly these problems')
  })

  it('fails honestly after two rejected payloads — no fabricated activity', async () => {
    const broken = { ...validConceptMap, nodes: validConceptMap.nodes.slice(0, 2) }
    await expect(generate('concept-map', [broken, broken])).rejects.toThrow(StudioGenerationError)
    await expect(generate('concept-map', [broken, broken])).rejects.toThrow(/failed validation twice/)
  })

  it('maps provider failures to an honest error mentioning the retry', async () => {
    await expect(generate('steps', [new Error('provider down')])).rejects.toThrow(/could not reach the AI provider/)
  })

  it('rejects non-object payloads honestly', async () => {
    await expect(generate('flashcards', ['just a string'])).rejects.toThrow(StudioGenerationError)
  })

  it('reports general grounding when no material blocks were usable', async () => {
    const { result } = await generate('steps', [{
      title: 'Steps',
      steps: [
        { title: 'One', body: 'First focused step with real content.' },
        { title: 'Two', body: 'Second focused step with real content.' },
        { title: 'Three', body: 'Third focused step with real content.' },
      ],
    }], generalGrounding)
    expect(result.grounding).toBe('general')
    expect(result.docTitle).toBeUndefined()
  })
})
