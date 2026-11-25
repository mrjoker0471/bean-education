// ─── CI-4A tests: source licence audit + content-ingestion quarantine ────────
//   A1  OpenStax records corrected to CC-BY-NC-SA-4.0 with machine-checkable
//       restrictions (CI-3 recorded CC-BY-4.0 — a licence misclassification,
//       verified against OpenStax's official distribution LICENSE 2026-11-25)
//   A2  citation/reference gate stays PERMITTED for restricted sources
//   A3  content-ingestion gate refuses NonCommercial sources in a commercial
//       operation (BEAN's default context)
//   A4  REFERENCE_ONLY sources refuse content ingestion, keep citations
//   A5  ShareAlike sources are commercially usable WITH recorded obligations
//   A6  explicit non-commercial context releases the NC quarantine (audit flag)
//   A7  schema back-compatibility (records without restrictions still valid)
//   A8  quarantine vocabulary: PERMISSION_PENDING / NO_DERIVATIVES / superseded
//   A9  every baseline seed source is fully provenance-recorded

import { describe, test, expect, beforeAll } from 'bun:test'
import {
  registerSource,
  getSource,
  listSources,
  assertSourceUsable,
  assertSourceContentUsable,
  resetSourcesForTests,
} from '@/lib/ci/fleet/sources'
import {
  ensurePackSourcesRegistered,
  resetPackSourcesForTests,
} from '@/lib/ci/fleet/packs/sources'
import { resetTaxonomySourcesForTests } from '@/lib/ci/fleet/taxonomy'
import { SOURCE_LICENCE_RESTRICTION } from '@/lib/ci/fleet/constants'

describe('CI-4A source licence audit', () => {
  beforeAll(() => {
    resetSourcesForTests()
    resetPackSourcesForTests()
    resetTaxonomySourcesForTests()
    ensurePackSourcesRegistered()
  })

  test('A1 OpenStax records are CC-BY-NC-SA-4.0 with NON_COMMERCIAL + SHARE_ALIKE restrictions', () => {
    for (const id of ['openstax-mathematics', 'openstax-anatomy-physiology', 'openstax-science-series']) {
      const rec = getSource(id)!
      expect(rec).not.toBeNull()
      expect(rec.licence.spdx).toBe('CC-BY-NC-SA-4.0')
      expect(rec.licence.restrictions).toContain('NON_COMMERCIAL')
      expect(rec.licence.restrictions).toContain('SHARE_ALIKE')
      expect(rec.licence.verifiedAt).toBe('2026-11-25')
      expect(rec.licence.statement).toContain('AUDIT CORRECTION')
      expect(rec.permittedUse).toContain('Citation-level')
    }
  })

  test('A2 citation/reference gate remains permitted for restricted sources', () => {
    for (const id of ['openstax-mathematics', 'openstax-science-series', 'openstax-anatomy-physiology', 'ncert-textbooks', 'cefr-companion-volume']) {
      const gate = assertSourceUsable(id)
      expect(gate.usable).toBe(true)
    }
  })

  test('A3 content-ingestion gate refuses NonCommercial sources in the commercial default', () => {
    for (const id of ['openstax-mathematics', 'openstax-science-series', 'openstax-anatomy-physiology']) {
      const gate = assertSourceContentUsable(id) // commercialOperation defaults true
      expect(gate.usable).toBe(false)
      expect(gate.obligations).toEqual([])
      expect(gate.reason).toContain('NonCommercial')
      expect(gate.reason).toContain('citation/reference use remains permitted')
    }
  })

  test('A4 REFERENCE_ONLY sources refuse content ingestion but keep citations', () => {
    for (const id of ['ncert-textbooks', 'cefr-companion-volume']) {
      const gate = assertSourceContentUsable(id)
      expect(gate.usable).toBe(false)
      expect(gate.reason).toContain('reference/metadata-only')
      expect(assertSourceUsable(id).usable).toBe(true)
    }
  })

  test('A5 ShareAlike sources are usable with recorded obligations', () => {
    const gate = assertSourceContentUsable('mdn-web-docs')
    expect(gate.usable).toBe(true)
    expect(gate.obligations.some((o) => o.startsWith('SHARE_ALIKE'))).toBe(true)
    expect(gate.obligations.some((o) => o.startsWith('attribution:'))).toBe(true)
  })

  test('A6 explicit non-commercial context releases the NC quarantine with obligations', () => {
    const gate = assertSourceContentUsable('openstax-mathematics', { commercialOperation: false })
    expect(gate.usable).toBe(true)
    expect(gate.obligations.some((o) => o.startsWith('SHARE_ALIKE'))).toBe(true)
    expect(gate.obligations.some((o) => o.startsWith('attribution:'))).toBe(true)
  })

  test('A7 records without a restrictions array still register (schema back-compat)', () => {
    const result = registerSource({
      sourceId: 'ci4-audit-backcompat-example',
      title: 'Back-compat probe source (BEAN-authored)',
      canonicalRef: 'bean:ci4:audit:backcompat',
      publisher: 'BEAN Education',
      authors: [],
      publishedAt: null,
      jurisdiction: null,
      version: '1.0.0',
      superseded: false,
      qualityClass: 'ASSESSED_SECONDARY',
      licence: {
        spdx: null,
        statement: 'BEAN-authored probe record with no restrictions field at all.',
        verifiedAt: '2026-11-25',
      },
      permittedUse: 'Test-only probe for schema back-compatibility.',
      attribution: 'BEAN Education original content.',
    })
    expect(result.ok).toBe(true)
    const rec = getSource('ci4-audit-backcompat-example')!
    expect(rec.licence.restrictions).toEqual([])
    expect(assertSourceContentUsable('ci4-audit-backcompat-example').usable).toBe(true)
  })

  test('A8 quarantine vocabulary: PERMISSION_PENDING, NO_DERIVATIVES, superseded', () => {
    const base = {
      title: 'Quarantine vocabulary probe',
      canonicalRef: 'bean:ci4:audit:quarantine',
      publisher: 'BEAN Education',
      authors: [],
      publishedAt: null,
      jurisdiction: null,
      version: '1.0.0',
      superseded: false,
      qualityClass: 'ASSESSED_SECONDARY' as const,
      permittedUse: 'Test-only probe record.',
      attribution: 'BEAN Education original content.',
    }
    const record = (over: Partial<typeof base> & { sourceId: string; licence: object }) =>
      registerSource({ ...structuredClone(base), ...over })

    const pending = record({
      sourceId: 'ci4-audit-pending',
      licence: { spdx: null, statement: 'Permission is being sought from the rights holder.', verifiedAt: '2026-11-25', restrictions: [SOURCE_LICENCE_RESTRICTION.PERMISSION_PENDING] },
    })
    expect(pending.ok).toBe(true)
    expect(assertSourceUsable('ci4-audit-pending').usable).toBe(true) // citation ok
    expect(assertSourceContentUsable('ci4-audit-pending').usable).toBe(false)
    expect(assertSourceContentUsable('ci4-audit-pending').reason).toContain('permission pending')

    const nd = record({
      sourceId: 'ci4-audit-nd',
      licence: { spdx: 'CC-BY-ND-4.0', statement: 'No-derivatives licence probed by the audit suite.', verifiedAt: '2026-11-25', restrictions: [SOURCE_LICENCE_RESTRICTION.NO_DERIVATIVES] },
    })
    expect(nd.ok).toBe(true)
    expect(assertSourceContentUsable('ci4-audit-nd').usable).toBe(false)
    expect(assertSourceContentUsable('ci4-audit-nd').reason).toContain('derivative')

    const permissiveLicence = { spdx: 'CC-BY-4.0', statement: 'Permissive record that later becomes superseded.', verifiedAt: '2026-11-25', restrictions: [] }
    const sup = record({ sourceId: 'ci4-audit-superseded', licence: permissiveLicence })
    expect(sup.ok).toBe(true)
    registerSource({ ...structuredClone(base), sourceId: 'ci4-audit-superseded', licence: permissiveLicence, superseded: true })
    expect(assertSourceUsable('ci4-audit-superseded').usable).toBe(false)
    expect(assertSourceContentUsable('ci4-audit-superseded').usable).toBe(false)
    expect(assertSourceContentUsable('ci4-audit-superseded').reason).toContain('superseded')
  })

  test('A9 every baseline source record is fully provenance-recorded', () => {
    // The audit probes from A7/A8 share this file-scoped registry — scope the
    // assertion to the seed records: 9 CI-3 baseline sources (8 pack + 1
    // taxonomy) + 5 CI-4 BEAN-authored seeds (4 domain seeds + the knowledge
    // corpus record).
    const all = listSources().filter((r) => !r.sourceId.startsWith('ci4-audit'))
    expect(all.length).toBe(14)
    for (const rec of all) {
      expect(rec.title.length).toBeGreaterThan(3)
      expect(rec.canonicalRef.length).toBeGreaterThan(4)
      expect(rec.publisher.length).toBeGreaterThan(2)
      expect(rec.version.length).toBeGreaterThan(0)
      expect(rec.licence.statement.length).toBeGreaterThan(10)
      expect(rec.licence.verifiedAt.length).toBeGreaterThan(4)
      expect(rec.attribution.length).toBeGreaterThan(5)
      expect(rec.permittedUse.length).toBeGreaterThan(5)
    }
    const openstax = all.filter((r) => r.sourceId.startsWith('openstax'))
    expect(openstax.length).toBe(3)
  })
})
