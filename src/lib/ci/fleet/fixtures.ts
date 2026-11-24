// ─── BEAN Classroom Intelligence (CI-3E): deterministic domain fixtures ───────
// The charter's domain fixture sets (§19 CI-3E, §19 CI-3H) — small, honest,
// deterministic cases that exercise the specialist runtime's grounding,
// handoff and refusal behaviour WITHOUT any model call. Each fixture describes
// a claim-shaped finding plus the expected deterministic verdict when run
// through the source-grounding post-pass. The suite is referenced by the seed
// packs' benchmark.fixtureRefs; the pack benchmark.lastResult stays null until
// the Domain Curator workflow (human publication gate) records a run.
//
// Fixture ids are stable: they are cited by packs and docs.

import { getSource } from './sources'
import { getDomainPack } from './domain-packs'
import { getDomainFamily } from './taxonomy'

export interface DomainFixture {
  id: string
  domainId: string
  /** The claim-shaped finding the grounding pass must judge. */
  claim: {
    observation: string
    sourceRefs: string[]
    /** Domain the claim actually belongs to (for handoff fixtures). */
    handoffTargetDomainId?: string
  }
  expected: {
    /** grounded: survives with the cited sources intact. */
    verdict: 'grounded' | 'demoted' | 'handoff' | 'refused'
    reason: string
  }
}

export const DOMAIN_GROUNDING_FIXTURES: readonly DomainFixture[] = [
  {
    id: 'ci3-fixture-grounding-generic',
    domainId: 'mathematics-statistics',
    claim: {
      observation: 'The board examples treated a hypothesis test as a fixed decision procedure rather than reporting uncertainty; the pack definition anchors the correct framing.',
      sourceRefs: ['openstax-mathematics'],
    },
    expected: { verdict: 'grounded', reason: 'source is registered and cited by the pack' },
  },
  {
    id: 'ci3-fixture-grounding-unregistered',
    domainId: 'mathematics-statistics',
    claim: {
      observation: 'A claim grounded only in an unregistered textbook id — the grounding pass must demote it to an unverified note.',
      sourceRefs: ['unregistered-textbook-42'],
    },
    expected: { verdict: 'demoted', reason: 'sourceRef does not resolve in the source registry' },
  },
  {
    id: 'ci3-fixture-physics-misconception',
    domainId: 'physics-space',
    claim: {
      observation: 'Learner-facing examples implied heavier objects always fall faster; the pack anchors the corrected framing with the registered physics source.',
      sourceRefs: ['openstax-science-series'],
    },
    expected: { verdict: 'grounded', reason: 'source is registered and cited by the pack' },
  },
  {
    id: 'ci3-fixture-chemistry-refusal',
    domainId: 'chemistry-materials',
    claim: {
      observation: 'Request implied a synthesis route for a hazardous substance; the pack safety boundary prohibits hazardous-synthesis instructions outright.',
      sourceRefs: [],
    },
    expected: { verdict: 'refused', reason: 'claim falls under the pack prohibitedTasks list' },
  },
  {
    id: 'ci3-fixture-handoff-cross-domain',
    domainId: 'mathematics-statistics',
    claim: {
      observation: 'The lesson material turned to macroeconomic modelling of interest rates, which the pack flags as economics territory.',
      sourceRefs: [],
      handoffTargetDomainId: 'economics-politics',
    },
    expected: { verdict: 'handoff', reason: 'target domain is declared in the pack relatedSubjectDomainIds' },
  },
  {
    id: 'ci3-fixture-languages-unverified-translation',
    domainId: 'languages-literature',
    claim: {
      observation: 'A translated technical term was offered without a pack-anchored source; the pack safety boundary requires unverified translations to be marked.',
      sourceRefs: [],
    },
    expected: { verdict: 'demoted', reason: 'no pack source anchors the translated term — treated as unverified' },
  },
] as const

export interface FixtureRunResult {
  id: string
  passed: boolean
  verdict: DomainFixture['expected']['verdict']
  detail: string
}

/**
 * Deterministic fixture verdicts — the SAME rules the specialist runtime's
 * grounding post-pass applies to model findings. No model call, no randomness.
 */
export function runDomainFixtureSuite(): { passed: number; failed: number; results: FixtureRunResult[] } {
  const results: FixtureRunResult[] = []
  for (const fx of DOMAIN_GROUNDING_FIXTURES) {
    let verdict: FixtureRunResult['verdict']
    let detail: string

    const packEntry = getDomainPack(fx.domainId)
    const pack = packEntry?.pack
    if (!pack) {
      verdict = 'demoted'
      detail = `pack "${fx.domainId}" is not registered — nothing can be grounded`
    } else if (fx.claim.handoffTargetDomainId !== undefined) {
      const validTarget =
        pack.relatedSubjectDomainIds.includes(fx.claim.handoffTargetDomainId) && getDomainFamily(fx.claim.handoffTargetDomainId) !== null
      verdict = validTarget ? 'handoff' : 'demoted'
      detail = validTarget
        ? `handoff to "${fx.claim.handoffTargetDomainId}" is a declared related domain`
        : `handoff target "${fx.claim.handoffTargetDomainId}" is not a declared related domain — demoted honestly`
    } else if (pack.prohibitedTasks.length > 0 && pack.prohibitedTasks.some((p) => matchesProhibition(p, fx.claim.observation))) {
      verdict = 'refused'
      detail = 'claim falls under a declared prohibited task — refused, never answered'
    } else if (fx.claim.sourceRefs.length === 0) {
      verdict = 'demoted'
      detail = 'no pack source anchors the claim — treated as unverified'
    } else {
      const allRegistered = fx.claim.sourceRefs.every((s) => {
        const rec = getSource(s)
        return rec !== null && pack.sources.some((ps) => ps.sourceId === s)
      })
      verdict = allRegistered ? 'grounded' : 'demoted'
      detail = allRegistered
        ? 'all sourceRefs resolve in the registry AND are cited by the pack'
        : 'at least one sourceRef is unregistered or outside the pack\u2019s declared sources — demoted honestly'
    }

    results.push({
      id: fx.id,
      passed: verdict === fx.expected.verdict,
      verdict,
      detail: `${detail} (expected ${fx.expected.verdict}: ${fx.expected.reason})`,
    })
  }
  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  }
}

/** Coarse prohibition matcher (the same heuristic the runtime applies). */
export function matchesProhibition(prohibitedTask: string, text: string): boolean {
  const key = prohibitedTask.toLowerCase()
  const words = key.split(/[^a-z0-9]+/).filter((w) => w.length > 3)
  if (words.length === 0) return false
  const hay = text.toLowerCase()
  const hits = words.filter((w) => hay.includes(w)).length
  return hits >= Math.min(2, words.length)
}
