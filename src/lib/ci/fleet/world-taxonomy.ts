// ─── BEAN Classroom Intelligence (CI-4B): world taxonomy adapters ────────────
// Profession/competency classification layer on top of the CI-3 taxonomy
// (charter §6.2/§6.3; CI-4B mission §4). Rules baked into this module:
//
//  • Original identifiers are PRESERVED VERBATIM — an O*NET-SOC code or an
//    ESCO URI is never re-encoded, abbreviated or "translated" into BEAN ids.
//  • Every crosswalk record is a BEAN-CREATED MAPPING (`adaptedBy: 'BEAN'`)
//    with an explicit confidence — BEAN mappings are never passed off as
//    upstream data.
//  • Jurisdiction is per-record (O*NET = US; ESCO = EU; NCO/NSQF = India) and
//    classifications are never collapsed into one invented hierarchy.
//  • Only METADATA is imported (identifiers + labels + relationship facts).
//    Descriptive profiles are NOT imported in CI-4B — that is a controlled
//    ingestion run gated by `assertSourceContentUsable` (CI-4A licence gate).
//  • India NCO 2015: reuse permission UNVERIFIED (source unreachable at audit
//    time; no licence instrument) → NO content, NO identifiers, metadata
//    links only. India NSQF: level STRUCTURE cited as factual, BEAN-authored
//    representation, explicit non-claim (never a qualification/certificate).
//  • ESCO: identifiers ship only after a controlled API run verifies them
//    (UUID URIs cannot be asserted from memory) — LICENCE_GATE_PENDING.
//    The charter's mandated acknowledgement is exported for any BEAN surface
//    that ever presents ESCO-derived data.

import { registerSource, assertSourceContentUsable } from './sources'
import { SOURCE_QUALITY_CLASS } from './constants'
import { DOMAIN_FAMILIES } from './taxonomy'

const AUDIT_DATE = '2026-11-25'

// ─── Source registration (licence facts first) ────────────────────────────────

let worldSourcesRegistered = false

export const ESCO_CLASSIFICATION_ACKNOWLEDGEMENT =
  'This service uses the ESCO classification of the European Commission.'

/** Register one world-taxonomy source; a failed registration is a bug, not a soft state. */
function registerOrThrow(input: Parameters<typeof registerSource>[0]): void {
  const result = registerSource(input)
  if (!result.ok) {
    throw new Error(`world-taxonomy source registration failed: ${result.reason}`)
  }
}

export function ensureWorldTaxonomySourcesRegistered(): void {
  if (worldSourcesRegistered) return

  registerOrThrow({
    sourceId: 'onet-web-database',
    title: 'O*NET Web database (O*NET OnLine, occupation profiles, knowledge areas, skills, abilities, work activities)',
    canonicalRef: 'https://www.onetonline.org/',
    publisher: 'National Center for O*NET Development, U.S. Department of Labor',
    authors: [],
    publishedAt: null,
    jurisdiction: 'United States (O*NET-SOC)',
    version: 'web production db, retrieved 2026-11-25 (DB version pinned at bulk import)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: 'CC-BY-4.0',
      statement:
        'O*NET is licensed CC BY 4.0 with attribution (verified live 2026-11-25: onetonline.org record pages carry "Creative Commons Attribution 4"/"CC-BY" notices; onetcenter.org/license.html states the CC BY 4.0 terms and that O*NET® is a trademark of the U.S. Department of Labor). Third-party resources referenced BY O*NET records are NOT automatically covered by this licence and require their own verification. CI-4B imports curated occupation identifiers + labels as metadata only; descriptive profiles stay unimported pending a controlled ingestion run.',
      verifiedAt: AUDIT_DATE,
      restrictions: [],
    },
    permittedUse:
      'Occupation identifier/label metadata with per-record attribution; O*NET trademark notice reproduced wherever O*NET is named in user-facing output; content ingestion (descriptive profiles) only through the licence-gated retrieval path with version pinned.',
    attribution:
      'This product uses information provided by O*NET® (O*NET OnLine, onetonline.org). O*NET® is a trademark of the U.S. Department of Labor. Licensed under CC BY 4.0 — data adapted by BEAN Education.',
  })

  registerOrThrow({
    sourceId: 'esco-classification',
    title: 'ESCO — European Skills, Competences, Qualifications and Occupations (European Commission)',
    canonicalRef: 'https://esco.ec.europa.eu/',
    publisher: 'European Commission (DG Employment, Social Affairs and Inclusion)',
    authors: [],
    publishedAt: null,
    jurisdiction: 'European Union (multilingual classification)',
    version: 'portal release ref. 2026-11-25 (version pinned at controlled import run)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: null,
      statement:
        'Free ACCESS to the ESCO portal is not itself a content licence. The European Commission requires the acknowledgement "This service uses the ESCO classification of the European Commission." and disclosure of adaptations when ESCO is used in services. CI-4B imports NO ESCO identifiers: concept URIs (data.europa.eu/esco/occupation/<uuid>) can only be recorded after a controlled API run verifies each identifier — memory-recalled UUIDs are forbidden. The adapter machinery is ready; the import state stays LICENCE_GATE_PENDING until that run is executed and recorded.',
      verifiedAt: AUDIT_DATE,
      restrictions: ['REFERENCE_ONLY'],
    },
    permittedUse:
      'Metadata import (identifiers, multilingual labels, occupation→skill relations) only through the controlled ingestion run with the EC acknowledgement + BEAN adaptation disclosure. No fabricated identifiers, ever.',
    attribution:
      ESCO_CLASSIFICATION_ACKNOWLEDGEMENT + ' ESCO data used as classification metadata; BEAN-created mappings are adaptations by BEAN Education, not ESCO content.',
  })

  registerOrThrow({
    sourceId: 'india-nco-2015',
    title: 'India National Classification of Occupations (NCO 2015), Directorate General of Employment, Ministry of Labour & Employment',
    canonicalRef: 'https://www.dge.gov.in/national_classification_of_occupations',
    publisher: 'Directorate General of Employment, Government of India',
    authors: [],
    publishedAt: '2015',
    jurisdiction: 'India',
    version: 'NCO 2015 (ISCO-08 structure)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: null,
      statement:
        'Reuse conditions could NOT be verified: dge.gov.in was unreachable from the CI-4A audit environment (2026-11-25) and the publication offers PDFs without a stated open-content licence. A downloadable PDF is not a reuse licence. Until a human verifies reuse permission, NO NCO content, codes or hierarchy text is stored — only the factual reference metadata (classification name, official URL, ISCO-08 relationship note, version).',
      verifiedAt: AUDIT_DATE,
      restrictions: ['REFERENCE_ONLY', 'PERMISSION_PENDING'],
    },
    permittedUse:
      'Reference metadata only: name, URL, version, ISCO-08 relationship facts. No codes, no hierarchy reproduction, no occupation text — until reuse permission is verified and recorded by a human reviewer.',
    attribution:
      'Reference: National Classification of Occupations — NCO 2015, Directorate General of Employment, Ministry of Labour & Employment, Government of India (dge.gov.in).',
  })

  registerOrThrow({
    sourceId: 'india-nsqf',
    title: 'India National Skills Qualifications Framework (NSQF) / National Qualifications Register (NQR)',
    canonicalRef: 'https://nqr.gov.in/nsqf',
    publisher: 'Ministry of Skill Development and Entrepreneurship / NCVET, Government of India',
    authors: [],
    publishedAt: null,
    jurisdiction: 'India',
    version: 'as published at nqr.gov.in (retrieved 2026-11-25; ncvet.gov.in 403)',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: null,
      statement:
        'Framework structure (10 outcome-based qualification levels, level descriptors as factual classification data) is CITED, not reproduced: BEAN represents the level structure in its own words with citation. nqr.gov.in was reachable at audit; ncvet.gov.in returned 403 (recorded honestly). NO claim that a BEAN-generated skill assessment is an NSQF qualification, NQR certificate or government certification — that non-claim is enforced in code and surfaced in outputs.',
      verifiedAt: AUDIT_DATE,
      restrictions: ['REFERENCE_ONLY'],
    },
    permittedUse:
      'BEAN-authored representation of the qualification-level structure with citation; explicit non-claim about certification. No descriptor text reproduction.',
    attribution:
      'Reference: National Skills Qualifications Framework (NSQF), Government of India (nqr.gov.in). BEAN Education representation; not a government publication.',
  })

  registerOrThrow({
    sourceId: 'ilo-isco-08',
    title: 'ILO International Standard Classification of Occupations (ISCO-08)',
    canonicalRef: 'https://www.ilo.org/publications/international-standard-classification-occupations-isco-08-structure-group-definitions',
    publisher: 'International Labour Organization',
    authors: [],
    publishedAt: '2008',
    jurisdiction: null,
    version: 'ISCO-08',
    superseded: false,
    qualityClass: SOURCE_QUALITY_CLASS.OFFICIAL_REGULATOR,
    licence: {
      spdx: null,
      statement:
        'ISCO-08 major-group/major-group-title identifiers and the one-line structural facts (e.g. "NCO 2015 incorporates ISCO-08") are treated as factual classification metadata. Full ILO descriptive text is NOT imported; ILO reuse terms must be re-read before any content import.',
      verifiedAt: AUDIT_DATE,
      restrictions: ['REFERENCE_ONLY'],
    },
    permittedUse:
      'Structural crosswalk facts and major-group identifiers with attribution; no descriptive text reproduction.',
    attribution:
      'Reference: ISCO-08, International Labour Organization (ilo.org). Crosswalk facts adapted by BEAN Education.',
  })

  worldSourcesRegistered = true
}


/** Clear the once-only flag so the next ensure call re-registers (tests only). */
export function resetWorldTaxonomySourcesForTests(): void {
  worldSourcesRegistered = false
}

// ─── Crosswalk model ─────────────────────────────────────────────────────────

/** BEAN-authored mapping confidence vocabulary (never upstream-authored). */
export const CROSSWALK_CONFIDENCE = {
  EXACT: 'EXACT', // occupation's core domain is unambiguous
  CLOSE: 'CLOSE', // strongly aligned; minor scope differences recorded
  PARTIAL: 'PARTIAL', // bridges two+ domains; all listed
  MANUAL_REVIEW: 'MANUAL_REVIEW', // plausible but needs a human curator
} as const
export type CrosswalkConfidence = (typeof CROSSWALK_CONFIDENCE)[keyof typeof CROSSWALK_CONFIDENCE]

export interface OccupationMappingRecord {
  /** Original upstream identifier, preserved verbatim (O*NET-SOC code). */
  externalId: string
  /** Source registry id that authored this identifier. */
  sourceId: string
  /** Upstream label, preserved verbatim as recorded from the source. */
  externalLabel: string
  /** BEAN domain family ids this occupation maps to (from DOMAIN_FAMILIES). */
  beanDomainIds: string[]
  /** BEAN-created mapping confidence. */
  confidence: CrosswalkConfidence
  /** Occupation→skill relationship facts are structural metadata, not prose. */
  note: string
  jurisdiction: string
  /** Every BEAN mapping is an adaptation — disclosed, never hidden. */
  adaptedBy: 'BEAN'
  verifiedAt: string
  /** Where the identifier+label were verified (live fetch, API run…). */
  verificationRef: string
}

/**
 * Curated O*NET occupation seed (CI-4B). Each identifier + label was verified
 * LIVE against onetonline.org on 2026-11-25 (page title equals the recorded
 * label). This is metadata import: identifiers, labels and BEAN's own domain
 * mappings. No O*NET descriptive text is reproduced anywhere.
 *
 * The set is deliberately SMALL and education-relevant: curated quality beats
 * manufactured coverage. Expansion happens through the same verify-then-record
 * process — never by bulk-asserting unverified codes.
 */
export const OCCUPATION_MAPPINGS: readonly OccupationMappingRecord[] = [
  { externalId: '15-1252.00', sourceId: 'onet-web-database', externalLabel: 'Software Developers', beanDomainIds: ['computing-software-it'], confidence: 'EXACT', note: 'core software engineering occupation', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/15-1252.00 (title matched 2026-11-25)' },
  { externalId: '15-2051.00', sourceId: 'onet-web-database', externalLabel: 'Data Scientists', beanDomainIds: ['ai-data'], confidence: 'EXACT', note: 'data science occupation', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/15-2051.00 (title matched 2026-11-25)' },
  { externalId: '15-1244.00', sourceId: 'onet-web-database', externalLabel: 'Network and Computer Systems Administrators', beanDomainIds: ['cybersecurity-networks', 'computing-software-it'], confidence: 'CLOSE', note: 'primarily networks/infrastructure; secondary computing', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/15-1244.00 (title matched 2026-11-25)' },
  { externalId: '11-3021.00', sourceId: 'onet-web-database', externalLabel: 'Computer and Information Systems Managers', beanDomainIds: ['computing-software-it', 'business-management'], confidence: 'PARTIAL', note: 'management occupation bridging technology and business administration', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/11-3021.00 (title matched 2026-11-25)' },
  { externalId: '25-2021.00', sourceId: 'onet-web-database', externalLabel: 'Elementary School Teachers, Except Special Education', beanDomainIds: ['education-pedagogy'], confidence: 'EXACT', note: 'school teaching occupation', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/25-2021.00 (title matched 2026-11-25)' },
  { externalId: '25-1022.00', sourceId: 'onet-web-database', externalLabel: 'Mathematical Science Teachers, Postsecondary', beanDomainIds: ['education-pedagogy', 'mathematics-statistics'], confidence: 'PARTIAL', note: 'teacher occupation bridging education and mathematics', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/25-1022.00 (title matched 2026-11-25)' },
  { externalId: '25-1042.00', sourceId: 'onet-web-database', externalLabel: 'Biological Science Teachers, Postsecondary', beanDomainIds: ['education-pedagogy', 'biology-life'], confidence: 'PARTIAL', note: 'teacher occupation bridging education and biology', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/25-1042.00 (title matched 2026-11-25)' },
  { externalId: '29-1141.00', sourceId: 'onet-web-database', externalLabel: 'Registered Nurses', beanDomainIds: ['nursing-allied-health'], confidence: 'EXACT', note: 'health occupation — education context only, never clinical guidance (charter §14)', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/29-1141.00 (title matched 2026-11-25)' },
  { externalId: '13-2011.00', sourceId: 'onet-web-database', externalLabel: 'Accountants and Auditors', beanDomainIds: ['accounting-finance'], confidence: 'EXACT', note: 'finance/accounting occupation — educational concepts only, no personalised advice (charter §14)', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/13-2011.00 (title matched 2026-11-25)' },
  { externalId: '47-2111.00', sourceId: 'onet-web-database', externalLabel: 'Electricians', beanDomainIds: ['skilled-trades'], confidence: 'EXACT', note: 'skilled trade — educational examples distinguished from validated professional work (charter §14)', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/47-2111.00 (title matched 2026-11-25)' },
  { externalId: '19-2011.00', sourceId: 'onet-web-database', externalLabel: 'Astronomers', beanDomainIds: ['physics-space'], confidence: 'EXACT', note: 'physical-science research occupation', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/19-2011.00 (title matched 2026-11-25)' },
  { externalId: '25-4011.00', sourceId: 'onet-web-database', externalLabel: 'Archivists', beanDomainIds: ['history-philosophy'], confidence: 'PARTIAL', note: 'heritage/information occupation bridging history and information science', jurisdiction: 'US', adaptedBy: 'BEAN', verifiedAt: AUDIT_DATE, verificationRef: 'https://www.onetonline.org/link/summary/25-4011.00 (title matched 2026-11-25)' },
] as const

// ─── Per-source import state (honest, machine-checkable) ─────────────────────

export const WORLD_IMPORT_STATE = {
  /** Curated, live-verified metadata seed imported (identifiers + labels). */
  METADATA_SEED_IMPORTED: 'METADATA_SEED_IMPORTED',
  /** Adapter ready; identifiers ship only after a controlled verified run. */
  LICENCE_GATE_PENDING: 'LICENCE_GATE_PENDING',
  /** Reuse permission unverified — metadata links only, zero content. */
  NO_IMPORT_PERMISSION_UNVERIFIED: 'NO_IMPORT_PERMISSION_UNVERIFIED',
  /** Structure cited in BEAN-authored words; descriptor text not reproduced. */
  STRUCTURE_CITED_ONLY: 'STRUCTURE_CITED_ONLY',
} as const
export type WorldImportState = (typeof WORLD_IMPORT_STATE)[keyof typeof WORLD_IMPORT_STATE]

export interface WorldTaxonomySourceState {
  sourceId: string
  importState: WorldImportState
  recordCount: number
  note: string
}

/**
 * Per-source import state. The sum of these states IS the honest coverage
 * claim: 12 verified O*NET occupation mappings; zero ESCO/NCO occupation data.
 */
export function worldTaxonomySourceStates(): WorldTaxonomySourceState[] {
  const onetCount = OCCUPATION_MAPPINGS.filter((m) => m.sourceId === 'onet-web-database').length
  return [
    {
      sourceId: 'onet-web-database',
      importState: WORLD_IMPORT_STATE.METADATA_SEED_IMPORTED,
      recordCount: onetCount,
      note: 'curated occupation identifiers + labels verified live (CC BY 4.0, attribution + trademark notice required); descriptive profiles NOT imported',
    },
    {
      sourceId: 'esco-classification',
      importState: WORLD_IMPORT_STATE.LICENCE_GATE_PENDING,
      recordCount: 0,
      note: 'identifier URIs ship only via a controlled, verification-logged API run; EC acknowledgement string exported for that moment',
    },
    {
      sourceId: 'india-nco-2015',
      importState: WORLD_IMPORT_STATE.NO_IMPORT_PERMISSION_UNVERIFIED,
      recordCount: 0,
      note: 'reuse permission unverified and source unreachable from the audit environment — metadata links only',
    },
    {
      sourceId: 'india-nsqf',
      importState: WORLD_IMPORT_STATE.STRUCTURE_CITED_ONLY,
      recordCount: 0,
      note: 'level structure represented BEAN-authored with citation; explicit non-claim: never a qualification/certification',
    },
    {
      sourceId: 'ilo-isco-08',
      importState: WORLD_IMPORT_STATE.STRUCTURE_CITED_ONLY,
      recordCount: 0,
      note: 'structural crosswalk facts only (e.g. NCO↔ISCO-08 relationship)',
    },
  ]
}

// ─── Query API ────────────────────────────────────────────────────────────────

/** All occupation mappings for one BEAN domain family (empty = honest none). */
export function occupationMappingsForDomain(domainId: string): OccupationMappingRecord[] {
  return OCCUPATION_MAPPINGS.filter((m) => m.beanDomainIds.includes(domainId))
}

/** Exact lookup by verbatim external identifier (no normalisation games). */
export function occupationByExternalId(externalId: string): OccupationMappingRecord | null {
  return OCCUPATION_MAPPINGS.find((m) => m.externalId === externalId) ?? null
}

/**
 * Validate a mapping record: beanDomainIds must exist in DOMAIN_FAMILIES,
 * confidence must be from the vocabulary, and the source must be registered
 * AND content-usable per the CI-4A gate (a licence-quarantined source can
 * never gain new mappings even at metadata level without a human decision).
 */
export function validateOccupationMapping(
  mapping: OccupationMappingRecord,
): { ok: true } | { ok: false; reason: string } {
  ensureWorldTaxonomySourcesRegistered()
  const unknownDomains = mapping.beanDomainIds.filter((id) => !DOMAIN_FAMILIES.some((f) => f.domainId === id))
  if (unknownDomains.length > 0) {
    return { ok: false, reason: `unknown BEAN domain id in mapping ${mapping.externalId}: ${unknownDomains.join(',')}` }
  }
  if (!Object.values(CROSSWALK_CONFIDENCE).includes(mapping.confidence)) {
    return { ok: false, reason: `invalid crosswalk confidence: ${String(mapping.confidence)}` }
  }
  if (mapping.adaptedBy !== 'BEAN') {
    return { ok: false, reason: 'every BEAN mapping must be disclosed as adaptedBy BEAN' }
  }
  if (mapping.verificationRef.trim().length < 10) {
    return { ok: false, reason: `mapping ${mapping.externalId} lacks verification evidence` }
  }
  const gate = assertSourceContentUsable(mapping.sourceId)
  if (!gate.usable) {
    // Reference-only / permission-pending / NC sources cannot gain mappings —
    // the CI-4A quarantine is authoritative even at metadata level.
    return { ok: false, reason: `source ${mapping.sourceId} is not open for mapping import: ${gate.reason ?? 'quarantined'}` }
  }
  return { ok: true }
}

/**
 * Sanity: all shipped mappings must pass validation on import-time call.
 * Returns the list of invalid records (empty in a healthy deployment).
 */
export function invalidShippedMappings(): string[] {
  return OCCUPATION_MAPPINGS.filter((m) => !validateOccupationMapping(m).ok).map((m) => m.externalId)
}
