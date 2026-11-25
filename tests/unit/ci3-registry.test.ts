// ─── CI-3B tests: fleet registry, contracts, domain packs, sources, taxonomy ─
// Unit proofs for the agent-fleet foundation (no DB, no model calls):
//
//   R1  registry — strict validation, must-never wiring, dynamic domain rules,
//       subject-expert instance resolution against pack state
//   C1  contracts — the charter §12 envelope: strict shape, honesty rules
//       (real abstention, no unsupported assertions, self-flagged unavailable
//       evidence, explained failures), task-id scheme
//   P1  domain packs — full validator gates (V1–V8), VERIFIED refusal without
//       human review, seed packs all pass, dispatchability rules
//   S1  sources — licence-gated registration, superseded refusal, registry
//       completeness
//   T1  taxonomy — deterministic subject→domain resolution with matchedOn
//       evidence, honest no-match, caps; profession import gate stays honest

import { describe, test, expect, beforeEach, afterAll } from 'bun:test'

import {
  FLEET_AGENT_ID,
  FLEET_RUNTIME,
  FLEET_POOL,
  PACK_STATUS,
  SOURCE_QUALITY_CLASS,
  FLEET_TASK_STATUS,
  subjectExpertInstanceId,
  domainIdFromInstanceId,
  isSubjectExpertInstanceId,
} from '@/lib/ci/fleet/constants'
import {
  registerAgent,
  getAgentSpec,
  listAgents,
  resolveAgentId,
  resetRegistryForTests,
  reRegisterCoreFleetForTests,
  snapshotRegistryForTests,
  restoreRegistryForTests,
} from '@/lib/ci/fleet/registry'
import {
  validateFleetTaskOutput,
  fleetTaskId,
  FLEET_CONTRACT_VERSION,
} from '@/lib/ci/fleet/contracts'
import {
  registerDomainPack,
  validateDomainPack,
  getDomainPack,
  listDomainPacks,
  dispatchableDomainPacks,
  resetDomainPacksForTests,
  snapshotDomainPacksForTests,
  restoreDomainPacksForTests,
  domainCatalogueSummary,
} from '@/lib/ci/fleet/domain-packs'
import {
  registerSource,
  getSource,
  assertSourceUsable,
  resetSourcesForTests,
  snapshotSourcesForTests,
  restoreSourcesForTests,
  sourceRecordSchema,
} from '@/lib/ci/fleet/sources'
import {
  resolveDomainsForSubject,
  getDomainFamily,
  DOMAIN_FAMILIES,
  resetTaxonomySourcesForTests,
  professionCatalogue,
  PROFESSION_IMPORT_STATE,
  ISCED_F_BROAD_FIELDS,
} from '@/lib/ci/fleet/taxonomy'
import { ensurePackSourcesRegistered, resetPackSourcesForTests } from '@/lib/ci/fleet/packs/sources'
import { ensureSeedPacksRegistered, resetSeedPacksForTests } from '@/lib/ci/fleet/packs'
import { CI_AGENT } from '@/lib/ci/constants'
import { CI_AGENT_TO_FLEET_ID } from '@/lib/ci/fleet/constants'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validSource(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'test-source',
    title: 'Test Source Document',
    canonicalRef: 'https://example.com/test-source',
    publisher: 'Example Publisher',
    authors: [],
    publishedAt: '2026-01-01',
    jurisdiction: null,
    version: '1.0',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.PEER_REVIEWED,
    licence: { spdx: 'CC-BY-4.0', statement: 'Attribution required; verified terms recorded at registration.', verifiedAt: '2026-11-24' },
    permittedUse: 'Reference grounding for tests.',
    attribution: 'Test Source © Example Publisher, CC BY 4.0.',
    ...overrides,
  }
}

function validSpec(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'BEAN_TEST_ROLE',
    agentVersion: '1.0.0',
    title: 'BEAN Test Role',
    purpose: 'A test role registered only by the CI-3B test suite.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.SUBJECT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: ['do nothing harmful'],
    dynamicDomain: false,
    allowedDomains: [],
    capacityGated: true,
    ...overrides,
  }
}

function validOutput(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: FLEET_CONTRACT_VERSION,
    taskId: 'sess-1:BEAN_SUBJECT_EXPERT:mathematics-statistics',
    classSessionId: 'sess-1',
    agentId: subjectExpertInstanceId('mathematics-statistics'),
    agentVersion: '1.0.0',
    domainPackId: 'mathematics-statistics',
    domainPackVersion: '1.0.0',
    language: { requested: 'en', detected: 'en', confidence: 'high' },
    status: FLEET_TASK_STATUS.COMPLETED,
    findings: [
      {
        findingId: 'f1',
        category: 'CONCEPT_ACCURACY',
        observation: 'The lesson described correlation as implying causation; the worked example did not establish causation.',
        evidenceRefIds: ['LESSON_PLAN'],
        evidenceKinds: ['LESSON_PLAN'],
        evidenceBasis: 'available',
        sourceRefs: [],
        confidence: 'medium',
        limitations: ['single lesson segment reviewed'],
        suggestion: 'Introduce a causation-vs-correlation contrast example.',
      },
    ],
    unknowns: [],
    conflicts: [],
    riskFlags: [],
    requiresHumanReview: false,
    ...overrides,
  }
}

/** Deep-clone the seed pack for gate-bypass tests. */
function seedPack(domainId: string): Record<string, unknown> {
  const found = getDomainPack(domainId)
  if (!found) throw new Error(`seed pack missing: ${domainId}`)
  return structuredClone(found.pack)
}

// Combined-run hygiene: this file resets and re-registers the fleet registry,
// source register and pack store around every test. bun executes every test
// file in one process (order filesystem-dependent), so the module-load state
// is snapshotted here and restored after the last test — this file's own
// behaviour is unchanged, but later files always observe the shipped state.
const fleetRegistrySnapshot = snapshotRegistryForTests()
const sourcesSnapshot = snapshotSourcesForTests()
const domainPacksSnapshot = snapshotDomainPacksForTests()
afterAll(() => {
  restoreRegistryForTests(fleetRegistrySnapshot)
  restoreSourcesForTests(sourcesSnapshot)
  restoreDomainPacksForTests(domainPacksSnapshot)
})

beforeEach(() => {
  // Full fleet state reset + re-seed (module once-flags included).
  resetRegistryForTests()
  resetSourcesForTests()
  resetDomainPacksForTests()
  resetTaxonomySourcesForTests()
  resetPackSourcesForTests()
  resetSeedPacksForTests()
  reRegisterCoreFleetForTests()
  ensureSeedPacksRegistered()
})

// ─── R1 registry ──────────────────────────────────────────────────────────────

describe('CI-3B registry', () => {
  test('R1.1 core fleet auto-registers with every charter role', () => {
    const ids = listAgents().map(a => a.agentId)
    for (const expected of Object.values(FLEET_AGENT_ID)) {
      expect(ids).toContain(expected)
    }
    expect(listAgents().length).toBeGreaterThanOrEqual(19)
  })

  test('R1.2 subject-expert template is dynamic and instance-resolvable', () => {
    const template = getAgentSpec(FLEET_AGENT_ID.SUBJECT_EXPERT)
    expect(template).not.toBeNull()
    expect(template?.dynamicDomain).toBe(true)
    const instance = resolveAgentId(subjectExpertInstanceId('mathematics-statistics'))
    expect(instance.ok).toBe(true)
    if (instance.ok) {
      expect(instance.domainPackId).toBe('mathematics-statistics')
      expect(instance.spec.agentId).toBe(FLEET_AGENT_ID.SUBJECT_EXPERT)
    }
  })

  test('R1.3 subject-expert refuses unknown or non-dispatchable domains', () => {
    const unknown = resolveAgentId(subjectExpertInstanceId('does-not-exist'))
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.reason).toContain('no domain pack registered')

    // DRAFT packs are not dispatchable.
    const draft = seedPack('mathematics-statistics')
    draft.status = PACK_STATUS.DRAFT
    expect(registerDomainPack(draft).ok).toBe(true)
    const refused = resolveAgentId(subjectExpertInstanceId('mathematics-statistics'))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toContain('not dispatchable')
  })

  test('R1.4 dynamicDomain is reserved for the subject-expert template', () => {
    expect(registerAgent(validSpec({ dynamicDomain: true })).ok).toBe(false)
    expect(registerAgent(validSpec({ agentId: FLEET_AGENT_ID.SUBJECT_EXPERT, dynamicDomain: false })).ok).toBe(false)
  })

  test('R1.5 registration rejects contract-version drift and malformed specs', () => {
    expect(registerAgent(validSpec({ contractVersion: '0.0.1' })).ok).toBe(false)
    expect(registerAgent(validSpec({ agentId: 'x' })).ok).toBe(false)
    expect(registerAgent(validSpec({ pools: [] })).ok).toBe(false)
    expect(registerAgent('not-an-object')).ok === false
  })

  test('R1.6 every registered role carries non-empty must-never prohibitions', () => {
    for (const agent of listAgents()) {
      expect(agent.mustNever.length).toBeGreaterThan(0)
    }
  })

  test('R1.7 CI-1 persisted agent names map onto charter identities', () => {
    expect(CI_AGENT_TO_FLEET_ID[CI_AGENT.LEARNER]).toBe(FLEET_AGENT_ID.LEARNER)
    expect(CI_AGENT_TO_FLEET_ID[CI_AGENT.TEACHER_JUDGE]).toBe(FLEET_AGENT_ID.TEACHER_JUDGE)
    expect(CI_AGENT_TO_FLEET_ID[CI_AGENT.ORCHESTRATOR]).toBe(FLEET_AGENT_ID.REPORT_ORCHESTRATOR)
  })

  test('R1.8 observer never shares a pool with live-room duties beyond observerPool', () => {
    const observer = getAgentSpec(FLEET_AGENT_ID.OBSERVER)
    expect(observer?.runtime).toBe(FLEET_RUNTIME.LIVE_ROOM)
    expect(observer?.pools).toEqual([FLEET_POOL.OBSERVER])
    expect(observer?.mustNever.join(' ')).toContain('secretly record')
  })
})

// ─── C1 contracts ─────────────────────────────────────────────────────────────

describe('CI-3B specialist contracts', () => {
  test('C1.1 valid specialist output passes all honesty checks', () => {
    const result = validateFleetTaskOutput(validOutput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.checks.every(c => c.passed)).toBe(true)
      expect(result.output.findings[0]?.findingId).toBe('f1')
    }
  })

  test('C1.2 unknown fields and wrong contract version are rejected', () => {
    expect(validateFleetTaskOutput({ ...validOutput(), sneakyField: true }).ok).toBe(false)
    expect(validateFleetTaskOutput({ ...validOutput(), contractVersion: '9.9.9' }).ok).toBe(false)
  })

  test('C1.3 INSUFFICIENT_EVIDENCE with "available" evidence findings is refused', () => {
    const result = validateFleetTaskOutput(
      validOutput({
        status: FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE,
        findings: [validOutput().findings[0]],
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('C2')
  })

  test('C1.4 real abstention (no findings) is accepted', () => {
    const result = validateFleetTaskOutput(
      validOutput({
        status: FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE,
        findings: [],
        unknowns: ['lesson material does not name the statistics topic covered'],
      }),
    )
    expect(result.ok).toBe(true)
  })

  test('C1.5 COMPLETED findings citing zero evidence with no limitations are refused', () => {
    const finding = {
      ...validOutput().findings[0]!,
      evidenceRefIds: [],
      evidenceKinds: [],
      limitations: [],
    }
    const result = validateFleetTaskOutput(validOutput({ findings: [finding] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('C3')
  })

  test('C1.6 COMPLETED with unknowns listed is accepted (charter §12 escape hatch)', () => {
    const finding = {
      ...validOutput().findings[0]!,
      evidenceRefIds: [],
      evidenceKinds: [],
      limitations: [],
    }
    const result = validateFleetTaskOutput(validOutput({ findings: [finding], unknowns: ['evidence bundle not yet indexed'] }))
    expect(result.ok).toBe(true)
  })

  test('C1.7 unavailable-evidence findings must carry a limitation', () => {
    const finding = { ...validOutput().findings[0]!, evidenceBasis: 'unavailable', limitations: [] }
    const result = validateFleetTaskOutput(validOutput({ findings: [finding] }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('C4')
  })

  test('C1.8 FAILED outputs must explain themselves', () => {
    expect(validateFleetTaskOutput(validOutput({ status: FLEET_TASK_STATUS.FAILED, findings: [] })).ok).toBe(false)
    const explained = validateFleetTaskOutput(validOutput({ status: FLEET_TASK_STATUS.FAILED, findings: [], unknowns: ['provider timeout after retries'] }))
    expect(explained.ok).toBe(true)
  })

  test('C1.9 malformed source refs are refused; bounds are enforced', () => {
    const badRef = { ...validOutput().findings[0]!, sourceRefs: ['BAD REF!'] }
    expect(validateFleetTaskOutput(validOutput({ findings: [badRef] })).ok).toBe(false)

    const many = Array.from({ length: 11 }, (_, i) => ({
      ...validOutput().findings[0]!,
      findingId: `f${i}`,
    }))
    expect(validateFleetTaskOutput(validOutput({ findings: many })).ok).toBe(false)
  })

  test('C1.10 task id scheme is deterministic and instance-aware', () => {
    expect(fleetTaskId('s1', FLEET_AGENT_ID.LEARNER)).toBe('s1:BEAN_LEARNER_AGENT')
    expect(fleetTaskId('s1', FLEET_AGENT_ID.SUBJECT_EXPERT, 'mathematics-statistics')).toBe(
      's1:BEAN_SUBJECT_EXPERT:mathematics-statistics',
    )
    expect(domainIdFromInstanceId('BEAN_SUBJECT_EXPERT::ai-data')).toBe('ai-data')
    expect(isSubjectExpertInstanceId('BEAN_LEARNER_AGENT')).toBe(false)
    expect(domainIdFromInstanceId('BEAN_SUBJECT_EXPERT::')).toBeNull()
  })
})

// ─── P1 domain packs ──────────────────────────────────────────────────────────

describe('CI-3B domain packs', () => {
  test('P1.1 all seed packs pass the full validator', () => {
    for (const seed of listDomainPacks()) {
      const result = validateDomainPack(seed.pack)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.checks.every(c => c.passed)).toBe(true)
        expect(result.checks.map(c => c.id)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'])
      }
    }
    expect(listDomainPacks().length).toBe(12) // 4 CI-3B seeds + 4 CI-3E core families + 4 CI-4C candidates
  })

  test('P1.2 VERIFIED is structurally refused without recorded human review', () => {
    const p = seedPack('mathematics-statistics')
    p.status = PACK_STATUS.VERIFIED
    p.humanReview = null
    const result = validateDomainPack(p)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('VERIFIED refused')
  })

  test('P1.3 VERIFIED is refused even with human review but failing benchmark', () => {
    const p = seedPack('mathematics-statistics')
    p.status = PACK_STATUS.VERIFIED
    p.humanReview = { reviewer: 'domain-reviewer', reviewedAt: '2026-11-24', note: '' }
    const result = validateDomainPack(p)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('benchmarkPassing=no')
  })

  test('P1.4 VERIFIED passes only with human review AND passing benchmark', () => {
    const p = seedPack('mathematics-statistics')
    p.status = PACK_STATUS.VERIFIED
    p.humanReview = { reviewer: 'domain-reviewer', reviewedAt: '2026-11-24', note: 'seed content checked' }
    p.benchmark = { ...(p.benchmark as object), lastResult: { passed: true, ranAt: '2026-11-24', summary: 'fixture suite green' } }
    const result = validateDomainPack(p)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.pack.status).toBe(PACK_STATUS.VERIFIED)
  })

  test('P1.5 pack with an unregistered source fails provenance gate V4', () => {
    const p = seedPack('computing-software-it')
    p.sources = [...(p.sources as object[]), { sourceId: 'unregistered-source', scope: 'bad' }]
    const result = validateDomainPack(p)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('V4')
  })

  test('P1.6 pack whose source later becomes superseded stops dispatching', () => {
    // Seed pack currently dispatchable.
    expect(dispatchableDomainPacks().map(d => d.pack.domainId)).toContain('mathematics-statistics')
    // Supersede the maths source: re-register same id with superseded=true.
    const src = getSource('openstax-mathematics')!
    registerSource({ ...structuredClone(src), superseded: true })
    expect(assertSourceUsable('openstax-mathematics').usable).toBe(false)
    // The existing registration is unaffected (checksum recorded at
    // registration), but re-validation now fails V4.
    const p = seedPack('mathematics-statistics')
    const result = validateDomainPack(p)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('superseded')
  })

  test('P1.7 HIGH_STAKES packs must declare prohibited tasks (V7)', () => {
    const health = getDomainPack('health-medicine-edu')
    expect(health?.pack.riskClass).toBe('HIGH_STAKES')
    expect(health?.pack.prohibitedTasks.join(' ')).toContain('diagnosis')
    const bad = seedPack('health-medicine-edu')
    bad.prohibitedTasks = []
    expect(validateDomainPack(bad).ok).toBe(false)
  })

  test('P1.8 checksum is stable and content-sensitive', () => {
    const a = getDomainPack('mathematics-statistics')!
    const b = getDomainPack('mathematics-statistics')!
    expect(a.checksum).toBe(b.checksum)
    const p = seedPack('mathematics-statistics')
    p.title = 'Changed title'
    expect(registerDomainPack(p).ok).toBe(true)
    expect(getDomainPack('mathematics-statistics')!.checksum).not.toBe(a.checksum)
  })

  test('P1.9 seed packs are honest IN_REVIEW — dispatchable with the review flag', () => {
    const dispatchable = dispatchableDomainPacks()
    expect(dispatchable.length).toBe(12) // 4 CI-3B seeds + 4 CI-3E core families + 4 CI-4C candidates
    for (const d of dispatchable) {
      expect(d.pack.status).toBe(PACK_STATUS.IN_REVIEW)
      expect(d.underReview).toBe(true)
    }
  })

  test('P1.10 catalogue summary never claims exhaustiveness', () => {
    const s = domainCatalogueSummary()
    expect(s.families).toBe(DOMAIN_FAMILIES.length)
    expect(s.note).toContain('not exhaustive')
  })
})

// ─── S1 sources ───────────────────────────────────────────────────────────────

describe('CI-3B source & licence registry', () => {
  test('S1.1 registration requires complete licence provenance', () => {
    const missing = validSource()
    delete (missing as Record<string, unknown>).licence
    expect(registerSource(missing).ok).toBe(false)
    const bad = validSource({ licence: { spdx: null, statement: 'x', verifiedAt: '' } })
    expect(registerSource(bad).ok).toBe(false)
    expect(registerSource(validSource()).ok).toBe(true)
    expect(getSource('test-source')).not.toBeNull()
  })

  test('S1.2 superseded sources refuse usability', () => {
    expect(registerSource(validSource({ superseded: true })).ok).toBe(true)
    expect(assertSourceUsable('test-source').usable).toBe(false)
  })

  test('S1.3 unregistered sources refuse usability', () => {
    expect(assertSourceUsable('never-registered').usable).toBe(false)
  })

  test('S1.4 community-context sources are usable but flagged context-only', () => {
    expect(registerSource(validSource({ qualityClass: SOURCE_QUALITY_CLASS.COMMUNITY_CONTEXT })).ok).toBe(true)
    const res = assertSourceUsable('test-source')
    expect(res.usable).toBe(true)
    expect(res.reason).toContain('context only')
  })

  test('S1.5 seed pack sources are registered with verified licences', () => {
    // CI-4A audit: the three OpenStax records were re-verified 2026-11-25 and
    // corrected to CC-BY-NC-SA-4.0 (NonCommercial quarantine) — the licence
    // identity is now asserted, not just a verification date. The remaining
    // sources keep their original 2026-11-24 verification.
    const audited: Record<string, { verifiedAt: string; spdx: string | null }> = {
      'openstax-mathematics': { verifiedAt: '2026-11-25', spdx: 'CC-BY-NC-SA-4.0' },
      'openstax-anatomy-physiology': { verifiedAt: '2026-11-25', spdx: 'CC-BY-NC-SA-4.0' },
      'mdn-web-docs': { verifiedAt: '2026-11-24', spdx: 'CC-BY-SA-2.5' },
      'python-docs-psf': { verifiedAt: '2026-11-24', spdx: 'PSF-2.0' },
      'unesco-isced-f-2013': { verifiedAt: '2026-11-24', spdx: null },
    }
    for (const [id, expected] of Object.entries(audited)) {
      const src = getSource(id)
      expect(src).not.toBeNull()
      expect(src?.licence.verifiedAt).toBe(expected.verifiedAt)
      expect(src?.licence.spdx).toBe(expected.spdx)
    }
  })
})

// ─── T1 taxonomy ──────────────────────────────────────────────────────────────

describe('CI-3B taxonomy adapter', () => {
  test('T1.1 ISCED seed has the 11 broad fields', () => {
    expect(ISCED_F_BROAD_FIELDS.length).toBe(11)
    expect(ISCED_F_BROAD_FIELDS[4]?.code).toBe('04')
  })

  test('T1.2 deterministic subject resolution with matchedOn evidence', () => {
    const a = resolveDomainsForSubject('Algebra and Statistics fundamentals')
    expect(a.matched).toBe(true)
    if (a.matched) {
      expect(a.domains[0]?.domainId).toBe('mathematics-statistics')
      expect(a.domains[0]?.matchedOn.length).toBeGreaterThan(0)
      expect(a.domains[0]?.iscedCodes).toContain('05')
    }
    // Determinism: same input, same output.
    const b = resolveDomainsForSubject('Algebra and Statistics fundamentals')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('T1.3 cross-disciplinary subject resolves multiple families under the cap', () => {
    const r = resolveDomainsForSubject('environmental science with chemistry and statistics')
    expect(r.matched).toBe(true)
    if (r.matched) {
      expect(r.domains.length).toBeGreaterThan(1)
      expect(r.domains.length).toBeLessThanOrEqual(3)
      expect(r.truncated === false || r.truncated === true).toBe(true)
    }
  })

  test('T1.4 unmatched subject resolves honestly empty — never guessed', () => {
    const r = resolveDomainsForSubject('Advanced underwater basket weaving')
    expect(r.matched).toBe(false)
    expect(r.domains).toEqual([])
    const empty = resolveDomainsForSubject('')
    expect(empty.matched).toBe(false)
  })

  test('T1.5 word-boundary matching prevents token false positives', () => {
    // "art" must not trigger from "smart" or "party".
    expect(getDomainFamily('arts-design-crafts')?.matchTokens).toContain('fine arts')
    const r = resolveDomainsForSubject('smart buildings workshop')
    // "architecture/built" tokens should not fire on "smart buildings"...
    const fired = r.matched && r.domains.some(d => d.domainId === 'arts-design-crafts')
    expect(fired).toBe(false)
  })

  test('T1.6 profession catalogue stays at the licence gate — no fabricated data', () => {
    const cat = professionCatalogue()
    expect(cat.importState).toBe(PROFESSION_IMPORT_STATE)
    expect(cat.nodes).toEqual([])
    expect(cat.note).toContain('licence verification')
  })
})
