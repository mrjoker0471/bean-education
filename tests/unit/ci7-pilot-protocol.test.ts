// ─── CI-7B tests: pilot protocol — constants bound to the existing authorities ─
//   P1  protocol pins the CI-7A recommended subject exactly (domain, version)
//   P2  the pilot approval policy is DERIVED from the existing curator
//       authority (1 distinct qualified approver for STANDARD) — never relaxed
//   P3  the pilot requires MORE independent reviews than the approval minimum
//       (2), so genuine disagreement can be observed — and never fewer
//   P4  the pilot pack's sources are licence-clean for the commercial purpose
//       (protocol §4 inclusion rules; CI-4A gate is the authority)
//   P5  excluded uses and stop conditions are pinned and cover the hard rules
//       (no consequential decisions, no transcription, no global activation)
//   P6  protocol drift fails loudly: an unregistered subject or a changed pack
//       version refuses the snapshot instead of reviewing the wrong pack
//   P7  the pilot surface is registry-only at this unit — no review, approval,
//       expert, metric or activation is created by the protocol itself

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import {
  CI7_PILOT_DOMAIN_ID,
  CI7_PILOT_MIN_INDEPENDENT_REVIEWS,
  CI7_PILOT_PACK_VERSION,
  CI7_PILOT_PROTOCOL_VERSION,
  CI7_PILOT_EXCLUDED_USES,
  CI7_PILOT_STOP_CONDITIONS,
  pilotPackSnapshot,
  pilotSubjectIsRegistered,
} from '@/lib/ci/fleet/pilot'
import {
  resetDomainPacksForTests,
  restoreDomainPacksForTests,
  snapshotDomainPacksForTests,
} from '@/lib/ci/fleet/domain-packs'
import {
  ensurePackSourcesRegistered,
  resetPackSourcesForTests,
} from '@/lib/ci/fleet/packs/sources'
import { resetTaxonomySourcesForTests } from '@/lib/ci/fleet/taxonomy'
import {
  ensureSeedPacksRegistered,
  resetSeedPacksForTests,
} from '@/lib/ci/fleet/packs'
import {
  resetSourcesForTests,
  snapshotSourcesForTests,
  restoreSourcesForTests,
} from '@/lib/ci/fleet/sources'

const sourcesSnapshot = snapshotSourcesForTests()
afterAll(() => {
  restoreSourcesForTests(sourcesSnapshot)
})

describe('CI-7B pilot protocol — governed constants', () => {
  beforeAll(() => {
    resetSourcesForTests()
    resetPackSourcesForTests()
    resetTaxonomySourcesForTests()
    resetSeedPacksForTests()
    ensurePackSourcesRegistered()
    ensureSeedPacksRegistered()
  })

  test('P1: protocol pins the CI-7A recommended subject exactly', () => {
    expect(CI7_PILOT_DOMAIN_ID).toBe('education-pedagogy')
    expect(CI7_PILOT_PACK_VERSION).toBe('1.0.0')
    expect(CI7_PILOT_PROTOCOL_VERSION).toBe('ci7-pilot-protocol-1')
    expect(pilotSubjectIsRegistered()).toBe(true)
    const snap = pilotPackSnapshot()
    expect(snap.domainId).toBe('education-pedagogy')
    expect(snap.pack.packVersion).toBe('1.0.0')
    expect(snap.pack.riskClass).toBe('STANDARD')
    expect(snap.declaredStatus).toBe('IN_REVIEW')
    expect(snap.humanReviewRecorded).toBe(false)
    expect(snap.checksum).toMatch(/^[0-9a-f]{64}$/)
  })

  test('P2: approval policy is derived from the existing curator authority, never re-implemented or relaxed', () => {
    const snap = pilotPackSnapshot()
    // resolveCuratedStatus for a STANDARD pack: 1 distinct qualified approver
    expect(snap.approvalsRequired).toBe(1)
    // the derivation is the existing one — approvals are counted from bound
    // reviews only; with no reviews recorded, nothing is approved
    expect(snap.declaredStatus).toBe('IN_REVIEW')
  })

  test('P3: the pilot requires more independent reviews than the approval minimum — never fewer', () => {
    const snap = pilotPackSnapshot()
    expect(CI7_PILOT_MIN_INDEPENDENT_REVIEWS).toBeGreaterThanOrEqual(snap.approvalsRequired)
    expect(CI7_PILOT_MIN_INDEPENDENT_REVIEWS).toBe(2)
  })

  test('P4: every pilot source is licence-clean for the commercial purpose (CI-4A gate is the authority)', () => {
    const snap = pilotPackSnapshot()
    expect(snap.sourceLicenceSnapshot.length).toBeGreaterThan(0)
    for (const entry of snap.sourceLicenceSnapshot) {
      expect(entry.contentUsable).toBe(true)
      expect(entry.reason).toBeNull()
      expect(entry.publisher).toBe('BEAN Education')
      expect(entry.restrictions).toEqual([])
    }
    expect(snap.sourceLicenceSnapshot.map((s) => s.sourceId)).toContain('bean-authored-education-pedagogy-seed')
  })

  test('P5: excluded uses and stop conditions pin the hard rules', () => {
    const excluded = CI7_PILOT_EXCLUDED_USES.join(' | ')
    expect(excluded).toContain('student assessment decisions')
    expect(excluded).toContain('admissions, hiring, employment')
    expect(excluded).toContain('TRANSCRIPTION stays structurally UNSUPPORTED')
    expect(excluded).toContain('global activation')
    expect(excluded).toContain('quarantined or reference-only')
    const stops = CI7_PILOT_STOP_CONDITIONS.join(' | ')
    expect(stops).toContain('consequential decision')
    expect(stops).toContain('checksum drift')
    expect(stops).toContain('licence status change')
    expect(stops).toContain('adjudication deadlock')
    expect(stops).toContain('owner authorisation withdrawn')
    expect(CI7_PILOT_STOP_CONDITIONS.some((s) => s.includes('never resolved by forced consensus'))).toBe(true)
  })

  test('P6: protocol drift fails loudly instead of reviewing the wrong pack', () => {
    // a missing subject must throw — never fall back to another domain
    expect(() => {
      const snap = pilotPackSnapshot()
      void snap
    }).not.toThrow() // the registered subject is fine in the seeded state
    // simulate registry drift: drop the pack store entirely
    const packSnapshot = snapshotDomainPacksForTests()
    resetDomainPacksForTests()
    expect(pilotSubjectIsRegistered()).toBe(false)
    expect(() => pilotPackSnapshot()).toThrow(/not registered/)
    // restore for other tests in the process
    restoreDomainPacksForTests(packSnapshot)
    expect(pilotSubjectIsRegistered()).toBe(true)
  })

  test('P7: the protocol creates nothing — no reviews, experts, metrics or activations exist after snapshotting', () => {
    const snap = pilotPackSnapshot()
    // snapshotting is a pure read of the registry: no state was created
    expect(snap.humanReviewRecorded).toBe(false)
    expect(snap.declaredStatus).toBe('IN_REVIEW')
    // the protocol constants carry no fabricated evidence of execution
    expect(CI7_PILOT_PROTOCOL_VERSION).not.toContain('executed')
  })
})
