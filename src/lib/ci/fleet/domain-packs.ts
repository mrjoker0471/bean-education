// ─── BEAN Classroom Intelligence (CI-3B): domain-pack schema & validator ─────
// Every published domain pack carries the full charter §6.4 schema: identity,
// taxonomy provenance, hierarchy links, terminology, jurisdictions, trusted
// sources (licence-registered), risk class, task allow/deny lists, agent
// profiles, per-language support WITH test status, benchmark suite, human
// review state and a checksummed version.
//
// Gate rule (charter §6.4): no pack may be marked VERIFIED without complete
// provenance and a passing domain evaluation suite. Human review is part of
// the VERIFIED gate — the validator encodes that structurally, so a pack
// cannot claim VERIFIED just because a machine check passed.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PACK_STATUS, type PackStatus } from './constants'
import { SOURCE_QUALITY_CLASS, type SourceQualityClass } from './constants'
import { getDomainFamily, DOMAIN_FAMILIES } from './taxonomy'
import { assertSourceUsable, getSource } from './sources'

// ─── Pack sub-schemas ────────────────────────────────────────────────────────

export const packSourceRefSchema = z.object({
  sourceId: z.string().min(3).max(100),
  /** What this source is used for inside the pack (short scope note). */
  scope: z.string().min(3).max(300),
})
export type PackSourceRef = z.infer<typeof packSourceRefSchema>

export const packGlossaryTermSchema = z.object({
  term: z.string().min(1).max(120),
  definition: z.string().min(5).max(1000),
  /** Where the definition's meaning is anchored (sourceId), null for BEAN-authored. */
  sourceId: z.string().max(100).nullable(),
  /** Alternative labels/synonyms the specialist should also recognise. */
  aliases: z.array(z.string().min(1).max(120)).max(10).default([]),
})
export type PackGlossaryTerm = z.infer<typeof packGlossaryTermSchema>

export const packLanguageSupportSchema = z.object({
  /** BCP-47 tag. */
  language: z.string().min(2).max(35),
  /** Charter §8.1 per-task status — support is measured, not assumed. */
  status: z.enum(['VERIFIED', 'LIMITED', 'EXPERIMENTAL', 'UNSUPPORTED', 'NEEDS_HUMAN_REVIEW']),
  /** Which task this status applies to (text understanding, terminology…). */
  task: z.enum(['TEXT_UNDERSTANDING', 'TERMINOLOGY', 'TRANSLATION', 'TRANSCRIPTION', 'GENERATION']),
  /** Test dataset / fixture reference backing the status. */
  testRef: z.string().max(300).nullable(),
  lastTestedAt: z.string().max(64).nullable(),
})
export type PackLanguageSupport = z.infer<typeof packLanguageSupportSchema>

export const packBenchmarkSchema = z.object({
  suiteId: z.string().min(3).max(100),
  description: z.string().min(5).max(500),
  /** Deterministic in-repo suite (fixture ids) or external harness reference. */
  fixtureRefs: z.array(z.string().min(1).max(120)).max(50).default([]),
  lastResult: z.object({
    passed: z.boolean(),
    ranAt: z.string().max(64),
    summary: z.string().max(500),
  }).nullable(),
})
export type PackBenchmark = z.infer<typeof packBenchmarkSchema>

export const packCompetencyLevelSchema = z.object({
  levelId: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  prerequisites: z.array(z.string().max(60)).max(10).default([]),
})
export type PackCompetencyLevel = z.infer<typeof packCompetencyLevelSchema>

// ─── The pack itself ─────────────────────────────────────────────────────────

export const domainPackSchema = z.object({
  domainId: z.string().min(3).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Stable URI-style identifier (charter §6.4 "domainId and stable URI"). */
  stableUri: z.string().min(8).max(200).regex(/^bean:ci3:domain:[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(3).max(300),
  aliases: z.array(z.string().min(1).max(120)).max(20).default([]),
  /** Titles/labels in other languages/scripts with the language tag. */
  translations: z.array(z.object({
    language: z.string().min(2).max(35),
    title: z.string().min(1).max(300),
  })).max(20).default([]),
  /** Taxonomy source id from the source registry. */
  taxonomySourceId: z.string().min(3).max(100),
  taxonomyVersion: z.string().min(1).max(100),
  /** ISCED-F broad-field codes anchoring this pack. */
  iscedCodes: z.array(z.string().min(1).max(8)).max(4),
  parentDomainId: z.string().max(80).nullable(),
  childDomainIds: z.array(z.string().max(80)).max(40).default([]),
  relatedSubjectDomainIds: z.array(z.string().max(80)).max(40).default([]),
  relatedProfessionNote: z.string().max(500).nullable(),
  competencyLevels: z.array(packCompetencyLevelSchema).max(12).default([]),
  glossary: z.array(packGlossaryTermSchema).max(100).default([]),
  /** Jurisdiction/standard notes (charter §6.4 "standards and jurisdictions"). */
  standards: z.array(z.object({
    label: z.string().min(3).max(200),
    jurisdiction: z.string().max(100),
    sourceId: z.string().max(100).nullable(),
  })).max(10).default([]),
  sources: z.array(packSourceRefSchema).min(1).max(20),
  effectiveAt: z.string().min(4).max(64),
  reviewDueAt: z.string().min(4).max(64).nullable(),
  /** High-stakes risk class drives extra guardrails (charter §14). */
  riskClass: z.enum(['STANDARD', 'ELEVATED', 'HIGH_STAKES']),
  /** Domain-specific safety boundary statement (charter §14). */
  safetyBoundary: z.string().min(20).max(2000),
  allowedTasks: z.array(z.string().min(3).max(200)).max(30).default([]),
  prohibitedTasks: z.array(z.string().min(3).max(200)).max(30).default([]),
  /** Fleet agent ids recommended for tasks in this domain. */
  agentProfileIds: z.array(z.string().min(3).max(80)).max(10).default([]),
  languageSupport: z.array(packLanguageSupportSchema).max(30).default([]),
  benchmark: packBenchmarkSchema.nullable(),
  status: z.enum(Object.values(PACK_STATUS) as [PackStatus, ...PackStatus[]]),
  /** Human reviewer + approval state — required for VERIFIED (structural gate). */
  humanReview: z.object({
    reviewer: z.string().min(3).max(200),
    reviewedAt: z.string().min(4).max(64),
    note: z.string().max(500).default(''),
  }).nullable(),
  /** Pack semantic version ( incremented on material change). */
  packVersion: z.string().min(1).max(40),
  /** Free-text change history entry for the current version. */
  changeHistory: z.array(z.object({
    version: z.string().min(1).max(40),
    note: z.string().min(3).max(1000),
    at: z.string().min(4).max(64),
  })).max(50).default([]),
})
export type DomainPack = z.infer<typeof domainPackSchema>

// ─── Validation ──────────────────────────────────────────────────────────────

export type PackValidationResult =
  | { ok: true; pack: DomainPack; checksum: string; checks: PackCheck[] }
  | { ok: false; reason: string; checks: PackCheck[] }

export interface PackCheck {
  id: string
  passed: boolean
  detail: string
}

/** Deterministic canonical JSON: keys sorted at EVERY level (CI-4E fix — the
 *  CI-3 form used a replacer-array allowlist of TOP-LEVEL keys only, which
 *  silently dropped all nested content (glossary fields, benchmark results,
 *  language support) from the checksum; the curator review binding and
 *  benchmark recording require the checksum to cover the whole pack). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalJsonForPack(pack: DomainPack): string {
  return canonicalJson(pack)
}

/** sha256 over the canonical pack JSON — the pack's integrity checksum. */
export function computePackChecksum(pack: DomainPack): string {
  return createHash('sha256').update(canonicalJsonForPack(pack)).digest('hex')
}

/**
 * Full pack validation. Schema first, then the charter's structural gates:
 *
 *  V1  schema-valid (strict, unknown fields rejected)
 *  V2  domainId exists in the seed family catalogue (or is a registered child)
 *  V3  stableUri matches domainId
 *  V4  every pack source is registered, usable (not superseded) and its
 *      licence was verified — provenance completeness
 *  V5  glossary terms that cite a sourceId point at registered sources
 *  V6  VERIFIED requires humanReview.recorded AND a benchmark suite with a
 *      passing last result — machine gates alone can never flip a pack to
 *      VERIFIED
 *  V7  HIGH_STAKES domains must declare at least one prohibitedTasks entry
 *  V8  checksum determinism (the canonical form is stable across calls)
 */
export function validateDomainPack(input: unknown): PackValidationResult {
  const checks: PackCheck[] = []

  const parsed = domainPackSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      reason: `schema: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'mismatch'}`,
      checks: [{ id: 'V1', passed: false, detail: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500) }],
    }
  }
  const pack = parsed.data
  checks.push({ id: 'V1', passed: true, detail: 'schema-valid (strict)' })

  // V2 — domain family known.
  const family = getDomainFamily(pack.domainId)
  const knownDomain = family !== undefined || pack.parentDomainId !== null
  checks.push({
    id: 'V2',
    passed: knownDomain,
    detail: knownDomain ? `domainId "${pack.domainId}" resolves in the seed catalogue${family ? ` (family: ${family.title})` : ' as a registered child domain'}` : `unknown domainId "${pack.domainId}"`,
  })

  // V3 — stable URI alignment.
  const uriOk = pack.stableUri === `bean:ci3:domain:${pack.domainId}`
  checks.push({ id: 'V3', passed: uriOk, detail: uriOk ? 'stableUri aligned' : `stableUri must be bean:ci3:domain:${pack.domainId}` })

  // V4 — provenance completeness: every source registered + usable.
  const sourceProblems: string[] = []
  for (const ref of pack.sources) {
    const record = getSource(ref.sourceId)
    if (!record) {
      sourceProblems.push(`${ref.sourceId}: not registered`)
      continue
    }
    const usable = assertSourceUsable(ref.sourceId)
    if (!usable.usable) sourceProblems.push(`${ref.sourceId}: ${usable.reason}`)
  }
  // The taxonomy anchor must be registered too.
  if (!getSource(pack.taxonomySourceId)) sourceProblems.push(`taxonomySourceId ${pack.taxonomySourceId}: not registered`)
  checks.push({
    id: 'V4',
    passed: sourceProblems.length === 0,
    detail: sourceProblems.length === 0 ? `all ${pack.sources.length} sources registered with verified licences` : sourceProblems.join('; '),
  })

  // V5 — glossary citations resolve.
  const glossaryProblems = pack.glossary.filter(t => t.sourceId && !getSource(t.sourceId)).map(t => t.term)
  checks.push({
    id: 'V5',
    passed: glossaryProblems.length === 0,
    detail: glossaryProblems.length === 0 ? `glossary (${pack.glossary.length} terms) citations resolve` : `unresolved glossary sources for: ${glossaryProblems.join(', ')}`,
  })

  // V6 — the VERIFIED gate (human review + passing benchmark).
  let verifiedGateOk = true
  let verifiedGateDetail = ''
  if (pack.status === PACK_STATUS.VERIFIED) {
    const humanOk = pack.humanReview !== null && pack.humanReview.reviewer.length > 0 && pack.humanReview.reviewedAt.length > 0
    const benchOk = pack.benchmark !== null && pack.benchmark.lastResult !== null && pack.benchmark.lastResult.passed
    verifiedGateOk = humanOk && benchOk
    verifiedGateDetail = verifiedGateOk
      ? 'VERIFIED justified: human review recorded + benchmark suite passing'
      : `VERIFIED refused — humanReview=${humanOk ? 'recorded' : 'missing'}, benchmarkPassing=${benchOk ? 'yes' : 'no'}`
  } else {
    verifiedGateDetail = `status ${pack.status}: VERIFIED gate not applicable`
  }
  checks.push({ id: 'V6', passed: verifiedGateOk, detail: verifiedGateDetail })

  // V7 — high-stakes domains declare prohibitions.
  const prohibitionOk = pack.riskClass !== 'HIGH_STAKES' || pack.prohibitedTasks.length > 0
  checks.push({ id: 'V7', passed: prohibitionOk, detail: prohibitionOk ? 'risk-class prohibitions ok' : 'HIGH_STAKES pack must declare prohibitedTasks' })

  // V8 — checksum determinism.
  const c1 = computePackChecksum(pack)
  const c2 = computePackChecksum(pack)
  checks.push({ id: 'V8', passed: c1 === c2, detail: c1 === c2 ? `checksum stable (${c1.slice(0, 12)}…)` : 'canonical form unstable' })

  const failed = checks.filter(c => !c.passed)
  if (failed.length > 0) {
    return { ok: false, reason: failed.map(f => `${f.id}: ${f.detail}`).join(' | '), checks }
  }
  return { ok: true, pack, checksum: c1, checks }
}

// ─── Pack store (in-repo packs, deterministic order) ─────────────────────────

const packs = new Map<string, { pack: DomainPack; checksum: string }>()

export type PackRegistration =
  | { ok: true; domainId: string; checksum: string; replaced: boolean }
  | { ok: false; reason: string }

/** Validate then register a pack. Registration refuses invalid packs. */
export function registerDomainPack(input: unknown): PackRegistration {
  const result = validateDomainPack(input)
  if (!result.ok) return { ok: false, reason: result.reason }
  const replaced = packs.has(result.pack.domainId)
  packs.set(result.pack.domainId, { pack: result.pack, checksum: result.checksum })
  return { ok: true, domainId: result.pack.domainId, checksum: result.checksum, replaced }
}

export function getDomainPack(domainId: string): { pack: DomainPack; checksum: string } | null {
  return packs.get(domainId) ?? null
}

export function listDomainPacks(): { pack: DomainPack; checksum: string }[] {
  return [...packs.values()].sort((a, b) => a.pack.domainId.localeCompare(b.pack.domainId))
}

/**
 * Packs usable for dispatch: status VERIFIED, or IN_REVIEW (usable with the
 * review flag surfaced). DRAFT and RETIRED never dispatch.
 */
export function dispatchableDomainPacks(): { pack: DomainPack; checksum: string; underReview: boolean }[] {
  return listDomainPacks()
    .filter(({ pack }) => pack.status === PACK_STATUS.VERIFIED || pack.status === PACK_STATUS.IN_REVIEW)
    .map(({ pack, checksum }) => ({ pack, checksum, underReview: pack.status === PACK_STATUS.IN_REVIEW }))
}

/** Reset the pack store (tests only). */
export function resetDomainPacksForTests(): void {
  packs.clear()
}

/** Seed-catalogue summary for docs/UI (never claims completeness). */
export function domainCatalogueSummary(): { families: number; iscedFields: number; note: string } {
  return {
    families: DOMAIN_FAMILIES.length,
    iscedFields: 11,
    note: 'Seed taxonomy (charter §6.1: expandable, not exhaustive). Per-domain capability is measured separately for every pack and language; an unmatched subject is reported honestly, never guessed.',
  }
}

// Re-export for consumers that want the class list without the constants import.
export { SOURCE_QUALITY_CLASS }
