// ─── BEAN Classroom Intelligence (CI-3B): source & licence registry ──────────
// No source enters any knowledge path until its licence, terms, version and
// attribution are recorded here (charter §3.5, §7.3). The registry is a
// provenance ledger — it stores metadata only; it never fetches network
// content, and a source record alone does not carry copyrighted text.
//
// Access to a public webpage is NOT permission to reproduce its contents
// (charter §7.3): every record therefore carries an explicit licence field and
// a verification timestamp, and `assertSourceUsable` refuses records that are
// incomplete, retired or superseded.

import { z } from 'zod'
import { SOURCE_QUALITY_CLASS, SOURCE_LICENCE_RESTRICTION, type SourceQualityClass, type SourceLicenceRestriction } from './constants'

export const sourceLicenceSchema = z.object({
  /** SPDX identifier when one exists (e.g. CC-BY-4.0, Apache-2.0, ODbL). */
  spdx: z.string().min(2).max(64).nullable(),
  /**
   * Where the licence terms live and what restrictions/attribution obligations
   * apply — a human-readable summary recorded at verification time.
   */
  statement: z.string().min(10).max(2000),
  /** ISO-8601 date the licence terms were actually checked. */
  verifiedAt: z.string().min(4).max(64),
  /**
   * CI-4A: machine-readable restrictions the licence imposes. Empty = none
   * recorded beyond attribution. These gate the CONTENT-INGESTION path only;
   * citation-level reference use is never affected by them.
   */
  restrictions: z.array(z.enum(Object.values(SOURCE_LICENCE_RESTRICTION) as [SourceLicenceRestriction, ...SourceLicenceRestriction[]])).max(8).default([]),
})
export type SourceLicence = z.infer<typeof sourceLicenceSchema>

export const sourceRecordSchema = z.object({
  sourceId: z.string().min(3).max(100).regex(/^[a-z0-9][a-z0-9._:-]*$/),
  title: z.string().min(3).max(300),
  /** Canonical URL or stable identifier for the source artefact. */
  canonicalRef: z.string().min(4).max(500),
  publisher: z.string().min(2).max(200),
  authors: z.array(z.string().min(1).max(200)).max(20).default([]),
  /** Publication / release date of the artefact (ISO-8601, best known). */
  publishedAt: z.string().min(4).max(64).nullable(),
  /** Jurisdiction this source governs/describes, when applicable. */
  jurisdiction: z.string().max(100).nullable(),
  /** Upstream version string of the artefact (e.g. "O*NET 31.0"). */
  version: z.string().min(1).max(100),
  /** True when a newer version exists and this record is historical. */
  superseded: z.boolean().default(false),
  /** Charter §7.2 quality class — gates what may rest on this source. */
  qualityClass: z.enum(Object.values(SOURCE_QUALITY_CLASS) as [SourceQualityClass, ...SourceQualityClass[]]),
  licence: sourceLicenceSchema,
  /** How BEAN may use this source (summary of permitted usage). */
  permittedUse: z.string().min(5).max(1000),
  /** Charter §6.4 attribution text to reproduce when the source is used. */
  attribution: z.string().min(5).max(1000),
}).strict()
export type SourceRecord = z.infer<typeof sourceRecordSchema>

// ─── Registry ─────────────────────────────────────────────────────────────────

const byId = new Map<string, SourceRecord>()

export type RegisterSourceResult =
  | { ok: true; sourceId: string; replaced: boolean }
  | { ok: false; reason: string }

/**
 * Register (or replace) a source record after strict validation. Unknown
 * fields are rejected; a superseded record may be registered for history but
 * is flagged and never resolves as usable.
 */
export function registerSource(input: unknown): RegisterSourceResult {
  const parsed = sourceRecordSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, reason: `invalid source record: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const record = parsed.data
  const existing = byId.get(record.sourceId)
  byId.set(record.sourceId, record)
  return { ok: true, sourceId: record.sourceId, replaced: existing !== undefined }
}

/** Get a registered source record (or null). */
export function getSource(sourceId: string): SourceRecord | null {
  return byId.get(sourceId) ?? null
}

/** All registered sources, sorted by sourceId (deterministic). */
export function listSources(): SourceRecord[] {
  return [...byId.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
}

/**
 * The gate every consumption path must call before a source contributes to a
 * task, pack or retrieval. Refuses: unregistered, superseded, or records
 * whose licence verification is missing.
 */
export function assertSourceUsable(sourceId: string): { usable: boolean; reason: string } {
  const record = byId.get(sourceId)
  if (!record) return { usable: false, reason: `source not registered: ${sourceId}` }
  if (record.superseded) return { usable: false, reason: `source superseded: ${sourceId}` }
  if (!record.licence.verifiedAt) return { usable: false, reason: `licence unverified: ${sourceId}` }
  if (record.qualityClass === SOURCE_QUALITY_CLASS.COMMUNITY_CONTEXT) {
    // Usable, but only ever as context — enforced by callers via the class.
    return { usable: true, reason: 'community-context: allowed as context only, never sole authority (charter §7.2)' }
  }
  return { usable: true, reason: 'ok' }
}

/** CI-4A: why content ingestion is refused, as machine-checkable obligations. */
export interface ContentUsabilityResult {
  usable: boolean
  /** Obligations that MUST accompany any permitted ingestion (ShareAlike…). */
  obligations: string[]
  /** Honest refusal reason when usable=false; absent/null when usable. */
  reason?: string
}

/**
 * CI-4A content-ingestion gate. Distinct from `assertSourceUsable` (which
 * governs citation/reference use): this gate governs ingesting a source's
 * CONTENT — retrieval chunks, prompt material, knowledge records, anything
 * that reproduces or adapts source text.
 *
 * BEAN operates commercially (premium subscriptions, teacher payouts), so the
 * default assumes a commercial operation; a caller may only opt out with an
 * explicit, auditable flag (e.g. a non-commercial research export).
 *
 * Refusal reasons are recorded verbatim in retrieval audit trails — the
 * quarantine is a documented fact, not a heuristic.
 */
export function assertSourceContentUsable(
  sourceId: string,
  context: { commercialOperation?: boolean } = {},
): ContentUsabilityResult {
  const commercial = context.commercialOperation ?? true
  const citation = assertSourceUsable(sourceId)
  if (!citation.usable) return { usable: false, obligations: [], reason: citation.reason }
  const record = byId.get(sourceId)! // citation gate found it
  const restrictions = record.licence.restrictions ?? []
  if (restrictions.includes(SOURCE_LICENCE_RESTRICTION.PERMISSION_PENDING)) {
    return { usable: false, obligations: [], reason: `content quarantined: reuse permission pending for ${sourceId}` }
  }
  if (restrictions.includes(SOURCE_LICENCE_RESTRICTION.REFERENCE_ONLY)) {
    return { usable: false, obligations: [], reason: `content ingestion forbidden: ${sourceId} is reference/metadata-only` }
  }
  if (commercial && restrictions.includes(SOURCE_LICENCE_RESTRICTION.NON_COMMERCIAL)) {
    return {
      usable: false,
      obligations: [],
      reason: `content ingestion forbidden: ${sourceId} is NonCommercial-licensed and BEAN operates commercially — separate written permission required (citation/reference use remains permitted)`,
    }
  }
  if (restrictions.includes(SOURCE_LICENCE_RESTRICTION.NO_DERIVATIVES)) {
    return { usable: false, obligations: [], reason: `content ingestion forbidden: ${sourceId} licence forbids derivative works` }
  }
  const obligations: string[] = []
  if (restrictions.includes(SOURCE_LICENCE_RESTRICTION.SHARE_ALIKE)) {
    obligations.push(`SHARE_ALIKE: adaptations of ingested ${sourceId} content must carry the same licence and attribution`)
  }
  obligations.push(`attribution: ${record.attribution}`)
  return { usable: true, obligations }
}

/** Reset the registry (tests only). */
export function resetSourcesForTests(): void {
  byId.clear()
}

/** Clear the once-only flag so the next ensure call re-registers (tests only). */
export function resetSourceRegistrationFlagForTests(): void {
  // this file has no once-flag; kept for symmetry with the other seed modules
}
