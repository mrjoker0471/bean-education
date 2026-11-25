// ─── CI-4B tests: world taxonomy adapters, identifier preservation, gates ────
//   B1  O*NET seed: every shipped mapping validated (source gate, domains,
//       confidence, BEAN adaptation disclosure, verification evidence)
//   B2  identifier preservation — external ids/labels round-trip verbatim
//   B3  jurisdiction separation — records carry their own jurisdiction
//   B4  crosswalk confidence vocabulary — invalid confidence refused
//   B5  unknown BEAN domain refused (no invented hierarchy collapse)
//   B6  quarantined sources cannot gain mappings (NCO/ESCO/no-import gate)
//   B7  per-source import states are honest (O*NET seed only; ESCO/NCO zero)
//   B8  ESCO acknowledgement string + non-fabrication guarantee
//   B9  NSQF/qualification non-claim recorded at source level
//   B10 domain query API round-trips (occupation ↔ domain)

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import {
  ensureWorldTaxonomySourcesRegistered,
  resetWorldTaxonomySourcesForTests,
  OCCUPATION_MAPPINGS,
  occupationMappingsForDomain,
  occupationByExternalId,
  validateOccupationMapping,
  invalidShippedMappings,
  worldTaxonomySourceStates,
  CROSSWALK_CONFIDENCE,
  ESCO_CLASSIFICATION_ACKNOWLEDGEMENT,
  WORLD_IMPORT_STATE,
  type OccupationMappingRecord,
} from '@/lib/ci/fleet/world-taxonomy'
import { getSource, listSources, resetSourcesForTests, snapshotSourcesForTests, restoreSourcesForTests } from '@/lib/ci/fleet/sources'
import { resetPackSourcesForTests } from '@/lib/ci/fleet/packs/sources'
import { resetTaxonomySourcesForTests } from '@/lib/ci/fleet/taxonomy'

// Combined-run hygiene: this file clears the global source register in
// beforeAll and re-registers ONLY the world-taxonomy sources. bun executes
// every test file in one process (order filesystem-dependent), so without a
// restore every file executed after this one would see the pack sources
// missing. Snapshot before the first mutation, restore after the last test.
const sourcesSnapshot = snapshotSourcesForTests()
afterAll(() => {
  restoreSourcesForTests(sourcesSnapshot)
})

describe('CI-4B world taxonomy', () => {
  beforeAll(() => {
    resetSourcesForTests()
    resetPackSourcesForTests()
    resetTaxonomySourcesForTests()
    resetWorldTaxonomySourcesForTests()
    ensureWorldTaxonomySourcesRegistered()
  })

  test('B1 every shipped occupation mapping passes validation', () => {
    expect(invalidShippedMappings()).toEqual([])
    for (const m of OCCUPATION_MAPPINGS) {
      expect(validateOccupationMapping(m).ok).toBe(true)
    }
  })

  test('B2 identifiers and labels are preserved verbatim (no re-encoding)', () => {
    const sd = occupationByExternalId('15-1252.00')!
    expect(sd).not.toBeNull()
    expect(sd.externalId).toBe('15-1252.00') // verbatim, dots included
    expect(sd.externalLabel).toBe('Software Developers') // upstream label as recorded
    expect(sd.externalLabel).not.toBe(sd.externalLabel.toUpperCase()) // no normalisation games
    // O*NET-SOC format check on every shipped id: NN-NNNN.NN or NN-NNNN.00
    for (const m of OCCUPATION_MAPPINGS) {
      expect(m.externalId).toMatch(/^\d{2}-\d{4}\.\d{2}$/)
    }
  })

  test('B3 jurisdiction is per-record and never collapsed', () => {
    for (const m of OCCUPATION_MAPPINGS) {
      expect(m.jurisdiction).toBe('US') // O*NET seed is US jurisdiction
      expect(m.sourceId).toBe('onet-web-database')
    }
    const nco = getSource('india-nco-2015')!
    expect(nco.jurisdiction).toBe('India')
    const onet = getSource('onet-web-database')!
    expect(onet.jurisdiction).toBe('United States (O*NET-SOC)')
  })

  test('B4 invalid crosswalk confidence is refused', () => {
    const base = OCCUPATION_MAPPINGS[0]
    const bad = { ...base, externalId: '99-9999.99', confidence: 'GUESS' as unknown as OccupationMappingRecord['confidence'] }
    const result = validateOccupationMapping(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('confidence')
    // every shipped mapping uses the vocabulary
    for (const m of OCCUPATION_MAPPINGS) {
      expect(Object.values(CROSSWALK_CONFIDENCE)).toContain(m.confidence)
    }
  })

  test('B5 unknown BEAN domain ids are refused — no invented hierarchy', () => {
    const bad = { ...OCCUPATION_MAPPINGS[0], beanDomainIds: ['not-a-real-domain'] }
    const result = validateOccupationMapping(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('unknown BEAN domain')
  })

  test('B6 quarantined/unverified sources cannot gain mappings', () => {
    // NCO 2015 is PERMISSION_PENDING + REFERENCE_ONLY — mapping import refused.
    const ncoAttempt = validateOccupationMapping({
      externalId: 'fake-nco-code', sourceId: 'india-nco-2015', externalLabel: 'would-be NCO node',
      beanDomainIds: ['skilled-trades'], confidence: 'MANUAL_REVIEW', note: 'attempted import',
      jurisdiction: 'India', adaptedBy: 'BEAN', verifiedAt: '2026-11-25',
      verificationRef: 'https://www.dge.gov.in/national_classification_of_occupations (unreachable)',
    })
    expect(ncoAttempt.ok).toBe(false)
    if (!ncoAttempt.ok) expect(ncoAttempt.reason).toContain('not open for mapping import')
    // ESCO is REFERENCE_ONLY at the licence gate — same refusal.
    const escoAttempt = validateOccupationMapping({
      externalId: 'http://data.europa.eu/esco/occupation/fabricated', sourceId: 'esco-classification',
      externalLabel: 'fabricated URI is refused', beanDomainIds: ['computing-software-it'],
      confidence: 'MANUAL_REVIEW', note: 'attempted import', jurisdiction: 'EU', adaptedBy: 'BEAN',
      verifiedAt: '2026-11-25', verificationRef: 'no verification run exists',
    })
    expect(escoAttempt.ok).toBe(false)
    // no shipped mapping references a quarantined source
    for (const m of OCCUPATION_MAPPINGS) {
      expect(m.sourceId).not.toBe('india-nco-2015')
      expect(m.sourceId).not.toBe('esco-classification')
    }
  })

  test('B7 per-source import states are honest — O*NET seed only', () => {
    const states = worldTaxonomySourceStates()
    const byId = Object.fromEntries(states.map((s) => [s.sourceId, s]))
    expect(byId['onet-web-database'].importState).toBe(WORLD_IMPORT_STATE.METADATA_SEED_IMPORTED)
    expect(byId['onet-web-database'].recordCount).toBe(OCCUPATION_MAPPINGS.length)
    expect(byId['esco-classification'].importState).toBe(WORLD_IMPORT_STATE.LICENCE_GATE_PENDING)
    expect(byId['esco-classification'].recordCount).toBe(0)
    expect(byId['india-nco-2015'].importState).toBe(WORLD_IMPORT_STATE.NO_IMPORT_PERMISSION_UNVERIFIED)
    expect(byId['india-nco-2015'].recordCount).toBe(0)
    expect(byId['india-nsqf'].importState).toBe(WORLD_IMPORT_STATE.STRUCTURE_CITED_ONLY)
    expect(byId['ilo-isco-08'].importState).toBe(WORLD_IMPORT_STATE.STRUCTURE_CITED_ONLY)
  })

  test('B8 ESCO acknowledgement exists and no ESCO identifier is fabricated', () => {
    expect(ESCO_CLASSIFICATION_ACKNOWLEDGEMENT).toBe(
      'This service uses the ESCO classification of the European Commission.',
    )
    const esco = getSource('esco-classification')!
    expect(esco.licence.statement).toContain('LICENCE_GATE_PENDING')
    for (const m of OCCUPATION_MAPPINGS) {
      expect(m.externalId.startsWith('http://data.europa.eu/esco')).toBe(false)
    }
  })

  test('B9 qualification non-claim is recorded at source level', () => {
    const nsqf = getSource('india-nsqf')!
    expect(nsqf.licence.statement).toContain('NO claim that a BEAN-generated skill assessment is an NSQF qualification')
    expect(nsqf.licence.restrictions).toContain('REFERENCE_ONLY')
    expect(nsqf.attribution).toContain('not a government publication')
  })

  test('B10 domain query API round-trips both directions', () => {
    const computing = occupationMappingsForDomain('computing-software-it')
    expect(computing.map((m) => m.externalId)).toContain('15-1252.00')
    const education = occupationMappingsForDomain('education-pedagogy')
    expect(education.map((m) => m.externalId)).toContain('25-2021.00')
    expect(education.map((m) => m.externalId)).toContain('25-1022.00') // PARTIAL bridge included
    expect(occupationMappingsForDomain('not-a-domain')).toEqual([])
    // every domainId referenced by any mapping resolves through the domain query
    const referenced = new Set(OCCUPATION_MAPPINGS.flatMap((m) => m.beanDomainIds))
    for (const domainId of referenced) {
      const back = occupationMappingsForDomain(domainId)
      expect(back.length).toBeGreaterThan(0)
    }
    // the curated seed covers the CI-4 priority areas with verified records
    expect(OCCUPATION_MAPPINGS.length).toBeGreaterThanOrEqual(12)
    expect(listSources().map((s) => s.sourceId)).toContain('onet-web-database')
  })
})
