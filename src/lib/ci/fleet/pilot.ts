// ─── BEAN Classroom Intelligence (CI-7B): controlled real expert pilot ───────
// Protocol constants and read-only derivations for the CI-7 pilot.
//
// DESIGN RULES (charter CI-7 §2):
// - This module NEVER replaces an existing authority. It pins the pilot
//   protocol's governing constants and derives pilot facts from the EXISTING
//   CI-4/CI-5/CI-6 ledgers (registry, curator reviews, reviewer profiles,
//   assignments, benchmark labels). Where an existing gate applies, the pilot
//   calls it — it does not re-implement it.
// - Every real count is derived from an authoritative ledger; missing values
//   are never calculated as successful outcomes. Until genuine humans complete
//   the real process, cohort/review/approval counts are honestly zero.
// - The pilot is restricted to non-consequential educational knowledge
//   validation (protocol §3). It never touches student data, transcription,
//   payments, admissions, hiring or any consequential decision.

import {
  computePackChecksum,
  getDomainPack,
  listDomainPacks,
  type DomainPack,
} from './domain-packs'
import { resolveCuratedStatus, type CuratedStatusResult } from './curator'
import { assertSourceContentUsable, listSources } from './sources'

/** Version of the pilot protocol these constants encode (protocol document §header). */
export const CI7_PILOT_PROTOCOL_VERSION = 'ci7-pilot-protocol-1'

/** The recommended pilot subject (CI-7A readiness audit; owner approval is gate G1). */
export const CI7_PILOT_DOMAIN_ID = 'education-pedagogy'
export const CI7_PILOT_PACK_VERSION = '1.0.0'

/**
 * Independent reviews the pilot requires before any acceptance evaluation.
 *
 * The EXISTING approval policy for a STANDARD pack requires 1 distinct
 * qualified approver (resolveCuratedStatus) — CI-7 never relaxes that. The
 * pilot deliberately requires MORE: at least two independent completed reviews
 * by two different verified experts, so genuine disagreement can be observed,
 * preserved and (where needed) adjudicated rather than hidden behind the
 * single-approval minimum.
 */
export const CI7_PILOT_MIN_INDEPENDENT_REVIEWS = 2

/** Hard exclusions (protocol §3) — recorded here so tests and reporting can bind to them. */
export const CI7_PILOT_EXCLUDED_USES: readonly string[] = [
  'student assessment decisions (grades, progress judgements, promotion/retention)',
  'payment, pricing, admissions, hiring, employment or institutional high-stakes decisions',
  'diagnosis of learning disabilities or health conditions; replacement of a qualified special-educational-needs assessment',
  'public ranking or grading of any named student',
  'retention/discipline decisions for any individual learner',
  'transcription, audio/video recording, or any voice capability (TRANSCRIPTION stays structurally UNSUPPORTED)',
  'global activation of the pack beyond the bounded restricted pilot scope',
  'use of quarantined or reference-only external material as content',
  'benchmark publication or model-performance claims beyond the CI-7F evidence rules',
]

/** Stop conditions (protocol §13) — any one halts the pilot. */
export const CI7_PILOT_STOP_CONDITIONS: readonly string[] = [
  'any attempt to use pilot output in a consequential decision',
  'credential verification cannot be completed honestly for a participant',
  'pack checksum drift without version-bound re-review',
  'licence status change on any cited source',
  'adjudication deadlock (recorded honestly, never resolved by forced consensus)',
  'evidence of a fabricated identity or credential',
  'owner authorisation withdrawn at any gate',
]

/**
 * Snapshot of the pilot pack as it exists RIGHT NOW, plus the protocol
 * discipline around it. Throws when the registry no longer matches the
 * protocol's pinned subject — CI-7 must fail loudly on drift rather than
 * silently review a different pack than the protocol describes.
 */
export function pilotPackSnapshot(): {
  protocolVersion: string
  domainId: string
  pack: DomainPack
  checksum: string
  approvalsRequired: number
  declaredStatus: string
  humanReviewRecorded: boolean
  sourceLicenceSnapshot: Array<{
    sourceId: string
    publisher: string
    version: string
    restrictions: string[]
    contentUsable: boolean
    reason: string | null
  }>
} {
  const found = getDomainPack(CI7_PILOT_DOMAIN_ID)
  if (!found) {
    throw new Error(`pilot protocol drift: domain ${CI7_PILOT_DOMAIN_ID} is not registered`)
  }
  const { pack, checksum } = found
  if (pack.packVersion !== CI7_PILOT_PACK_VERSION) {
    throw new Error(
      `pilot protocol drift: pack version ${pack.packVersion} != protocol ${CI7_PILOT_PACK_VERSION} — the protocol must be re-approved for the new version (gate G2)`,
    )
  }
  // derivation comes from the EXISTING curator authority (never re-implemented)
  const curated: CuratedStatusResult = resolveCuratedStatus(pack, [])
  const licenceSnapshot = pack.sources.map((citation) => {
    const gate = assertSourceContentUsable(citation.sourceId, { commercialOperation: true })
    const record = listSources().find((s) => s.sourceId === citation.sourceId) ?? null
    return {
      sourceId: citation.sourceId,
      publisher: record?.publisher ?? 'unknown',
      version: record?.version ?? 'unknown',
      restrictions: record?.licence.restrictions ?? [],
      contentUsable: gate.usable,
      reason: gate.usable ? null : (gate.reason ?? 'content not usable'),
    }
  })
  return {
    protocolVersion: CI7_PILOT_PROTOCOL_VERSION,
    domainId: CI7_PILOT_DOMAIN_ID,
    pack,
    checksum,
    approvalsRequired: curated.approvalsRequired,
    declaredStatus: pack.status,
    humanReviewRecorded: pack.humanReview !== null,
    sourceLicenceSnapshot: licenceSnapshot,
  }
}


/**
 * Guard against the protocol's subject silently disappearing from the
 * registry (e.g. a future pack retirement). Used by tests and reporting.
 */
export function pilotSubjectIsRegistered(): boolean {
  return listDomainPacks().some((p) => p.pack.domainId === CI7_PILOT_DOMAIN_ID)
}
