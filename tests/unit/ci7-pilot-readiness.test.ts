// ─── CI-7A tests: pilot readiness — registry facts behind the selection doc ──
//   R1  the candidate set is exactly the 12 seeded packs, all v1.0.0, all
//       declared IN_REVIEW with humanReview null (nothing approved exists)
//   R2  the recommended pilot pack identity matches
//       docs/BEAN-CLASSROOM-INTELLIGENCE-CI7-PILOT-READINESS.md exactly
//   R3  every source cited by the recommended pack passes the commercial
//       content-ingestion gate (CI-4A authority) with zero obligations
//   R4  the eliminated candidates fail the licensing gate exactly as documented
//       (quarantined OpenStax sources, REFERENCE_ONLY CEFR/NCERT)
//   R5  the existing approval policy for the recommended pack is 1 distinct
//       qualified approver (STANDARD risk; HIGH_STAKES would require 2)
//   R6  the pack checksum is deterministic and bindable (V8 discipline)
//   R7  the pack's evaluation surface is bounded and inspectable: glossary,
//       competency levels, allowed/prohibited tasks, fixtures, agents
//
// Registry-only test (no database): mirrors the ci4-source-audit pattern.
// bun executes every test file in one process, so the source register is
// snapshotted before mutation and restored after the last test.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import {
  assertSourceContentUsable,
  assertSourceUsable,
  getSource,
  resetSourcesForTests,
  snapshotSourcesForTests,
  restoreSourcesForTests,
} from '@/lib/ci/fleet/sources'
import {
  ensurePackSourcesRegistered,
  resetPackSourcesForTests,
} from '@/lib/ci/fleet/packs/sources'
import { resetTaxonomySourcesForTests } from '@/lib/ci/fleet/taxonomy'
import {
  computePackChecksum,
  getDomainPack,
  listDomainPacks,
} from '@/lib/ci/fleet/domain-packs'
import {
  ensureSeedPacksRegistered,
  resetSeedPacksForTests,
} from '@/lib/ci/fleet/packs'
import { resolveCuratedStatus } from '@/lib/ci/fleet/curator'

// The recommended pilot candidate — must stay in lockstep with
// docs/BEAN-CLASSROOM-INTELLIGENCE-CI7-PILOT-READINESS.md §3.
const RECOMMENDED_DOMAIN = 'education-pedagogy'

const sourcesSnapshot = snapshotSourcesForTests()
afterAll(() => {
  restoreSourcesForTests(sourcesSnapshot)
})

describe('CI-7A pilot readiness — registry facts', () => {
  beforeAll(() => {
    resetSourcesForTests()
    resetPackSourcesForTests()
    resetTaxonomySourcesForTests()
    resetSeedPacksForTests()
    ensurePackSourcesRegistered()
    ensureSeedPacksRegistered()
  })

  test('R1: the candidate set is exactly the 12 seeded packs, all v1.0.0, all declared IN_REVIEW, humanReview null', () => {
    const packs = listDomainPacks()
    expect(packs.length).toBe(12)
    for (const { pack, checksum } of packs) {
      expect(pack.packVersion).toBe('1.0.0')
      expect(pack.status).toBe('IN_REVIEW')
      expect(pack.humanReview).toBeNull()
      expect(checksum).toBe(computePackChecksum(pack))
    }
    const ids = packs.map((p) => p.pack.domainId).sort()
    expect(ids).toEqual([
      'accounting-finance',
      'agriculture-agritech',
      'biology-life',
      'chemistry-materials',
      'computing-software-it',
      'education-pedagogy',
      'engineering',
      'health-medicine-edu',
      'history-philosophy',
      'languages-literature',
      'mathematics-statistics',
      'physics-space',
    ])
  })

  test('R2: the recommended pilot pack identity matches the readiness document', () => {
    const found = getDomainPack(RECOMMENDED_DOMAIN)
    expect(found).not.toBeNull()
    const { pack, checksum } = found!
    expect(pack.stableUri).toBe('bean:ci3:domain:education-pedagogy')
    expect(pack.packVersion).toBe('1.0.0')
    expect(pack.riskClass).toBe('STANDARD')
    expect(pack.iscedCodes).toEqual(['01'])
    expect(pack.taxonomySourceId).toBe('unesco-isced-f-2013')
    expect(pack.effectiveAt).toBe('2026-11-25')
    expect(pack.reviewDueAt).toBe('2027-05-25')
    // the declared status is IN_REVIEW with no human review — a pilot starts
    // from a state where zero approvals exist and none will be fabricated
    expect(pack.status).toBe('IN_REVIEW')
    expect(pack.humanReview).toBeNull()
    // safety boundary keeps the pilot advisory and non-consequential
    expect(pack.safetyBoundary).toContain('advisory for lesson design')
    expect(pack.prohibitedTasks).toContain('diagnose learning disabilities or health conditions')
    expect(pack.prohibitedTasks).toContain('make retention/discipline decisions for an individual learner')
    // checksum is bindable and stable within the process
    expect(computePackChecksum(pack)).toBe(checksum)
  })

  test('R3: every source cited by the recommended pack passes the commercial content gate with zero external licence obligations', () => {
    const { pack } = getDomainPack(RECOMMENDED_DOMAIN)!
    expect(pack.sources.length).toBeGreaterThan(0)
    for (const citation of pack.sources) {
      const gate = assertSourceContentUsable(citation.sourceId, { commercialOperation: true })
      expect(gate.usable).toBe(true)
      // zero external licence obligations — the only recorded duty is BEAN's
      // own attribution line (no ShareAlike / NonCommercial / version-pin duties)
      expect(gate.obligations.length).toBeGreaterThan(0)
      expect(gate.obligations.every((o) => o.startsWith('attribution:'))).toBe(true)
      const record = getSource(citation.sourceId)
      expect(record).not.toBeNull()
      expect(record!.publisher).toBe('BEAN Education')
      expect(record!.version).toBe('1.0.0')
      expect(record!.licence.restrictions ?? []).toEqual([])
    }
    // the pack's single content source is the BEAN-authored pedagogy seed
    expect(pack.sources.map((s) => s.sourceId)).toContain('bean-authored-education-pedagogy-seed')
  })

  test('R4: eliminated candidates fail the licensing gate exactly as documented', () => {
    // OpenStax-sourced packs: NonCommercial quarantine in a commercial operation
    const openstax = ['openstax-mathematics', 'openstax-anatomy-physiology', 'openstax-science-series']
    for (const sourceId of openstax) {
      const gate = assertSourceContentUsable(sourceId, { commercialOperation: true })
      expect(gate.usable).toBe(false)
      expect(gate.reason).toContain('NonCommercial')
    }
    // citation-level reference stays permitted (citation != ingestion permission)
    const citationGate = assertSourceUsable('openstax-mathematics')
    expect(citationGate.usable).toBe(true)
    // REFERENCE_ONLY sources: content ingestion forbidden outright
    for (const sourceId of ['cefr-companion-volume', 'ncert-textbooks']) {
      const gate = assertSourceContentUsable(sourceId, { commercialOperation: true })
      expect(gate.usable).toBe(false)
      expect(gate.reason).toContain('reference')
    }
  })

  test('R5: the existing approval policy requires 1 distinct qualified approver for the recommended STANDARD pack', () => {
    const { pack } = getDomainPack(RECOMMENDED_DOMAIN)!
    // no reviews recorded — the derivation must demand exactly 1 approval and
    // leave the pack at its declared IN_REVIEW state (nothing fabricated)
    const result = resolveCuratedStatus(pack, [])
    expect(result.approvalsRequired).toBe(1)
    expect(result.approvalsRecorded).toBe(0)
    expect(result.status).toBe('IN_REVIEW')
  })

  test('R6: checksum determinism — the same pack computes one stable bindable checksum', () => {
    const { pack, checksum } = getDomainPack(RECOMMENDED_DOMAIN)!
    expect(computePackChecksum(pack)).toBe(computePackChecksum(pack))
    expect(computePackChecksum(pack)).toBe(checksum)
    expect(checksum).toMatch(/^[0-9a-f]{64}$/)
  })

  test('R7: the evaluation surface is bounded and inspectable without student data', () => {
    const { pack } = getDomainPack(RECOMMENDED_DOMAIN)!
    expect(pack.glossary.length).toBe(5)
    expect(pack.glossary.every((g) => g.sourceId === 'bean-authored-education-pedagogy-seed')).toBe(true)
    expect(pack.competencyLevels.length).toBeGreaterThan(0)
    expect(pack.allowedTasks.length).toBeGreaterThan(0)
    expect(pack.benchmark.fixtureRefs).toContain('ci4-fixture-education-grounded')
    // two specialist agent bindings — grounding coverage exists
    expect(pack.agentProfileIds).toContain('BEAN_SUBJECT_EXPERT::education-pedagogy')
    expect(pack.agentProfileIds).toContain('BEAN_PEDAGOGY_SPECIALIST')
    // translation field exists but language support stays experimental seed state
    expect(pack.languageSupport.every((l) => l.status === 'EXPERIMENTAL' && l.testRef === 'pending CI-3F benchmark')).toBe(true)
  })
})
