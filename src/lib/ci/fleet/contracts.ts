// ─── BEAN Classroom Intelligence (CI-3B): versioned specialist contracts ─────
// The typed, validated contract EVERY fleet agent output must satisfy before
// anything is persisted or merged (charter §12). Aligned with the repository's
// existing CI Zod conventions (`../schemas.ts`) rather than introducing a
// competing format — same confidence vocabulary, same finding identity rules,
// same strictness posture: model output is untrusted input, unknown fields are
// rejected, every evidence id must be resolvable server-side.
//
// Contract version is semantic: CONTRACT_VERSION bumps whenever the shape or
// rules change; persisted outputs record the version that validated them.

import { z } from 'zod'
import { getDomainPack } from './domain-packs'
import { CI_EVIDENCE_KIND } from '../constants'
import {
  FLEET_TASK_STATUS,
  FLEET_MAX_FINDINGS,
  FLEET_MAX_EVIDENCE_REFS_PER_FINDING,
  FLEET_MAX_SOURCE_REFS_PER_FINDING,
  FLEET_OBSERVATION_MIN,
  FLEET_OBSERVATION_MAX,
  FLEET_MAX_UNKNOWN_ITEMS,
} from './constants'

/**
 * CI-4E bumps the contract to 1.1.0: the envelope gains an OPTIONAL
 * `handoffs` array of STRUCTURED cross-domain handoff records (charter §16.1
 * + CI-4 mission §8). A handoff record is a REPORT, never a dispatch order —
 * only server-side planning (dispatcher/planHandoffFollowUps) may create
 * queue tasks, so a model output can never spawn specialist work by itself.
 */
export const FLEET_CONTRACT_VERSION = '1.1.0'

/** Same authorised evidence-kind vocabulary as the CI-1 schemas (local copy so
 * the CI-1 module surface is untouched). */
const fleetEvidenceKindEnum = z.enum([
  CI_EVIDENCE_KIND.LESSON_PLAN,
  CI_EVIDENCE_KIND.ATTENDANCE_RECORD,
  CI_EVIDENCE_KIND.PARTICIPANT_INTERVALS,
  CI_EVIDENCE_KIND.WHITEBOARD_SNAPSHOT,
  CI_EVIDENCE_KIND.TEACHER_LESSON_NOTES,
])

// ─── Envelope ────────────────────────────────────────────────────────────────

const confidenceEnum = z.enum(['low', 'medium', 'high'])
const languageConfidenceEnum = z.enum(['low', 'medium', 'high'])

export const fleetLanguageInfoSchema = z.object({
  requested: z.string().max(35).nullable(),
  detected: z.string().max(35).nullable(),
  confidence: languageConfidenceEnum,
}).strict()
export type FleetLanguageInfo = z.infer<typeof fleetLanguageInfoSchema>

/**
 * A fleet finding. Extends the CI-1 finding honesty rules:
 * - `observation` bounded text
 * - `evidenceRefIds` must resolve to the job's evidence register (server-side
 *   check — the schema only enforces shape/bounds)
 * - `sourceRefs` cite registered knowledge sources (server-side check)
 * - `limitations` must be stated — a finding may carry its own caveats
 * - `evidenceBasis` honesty assessment (available/partially/unavailable)
 */
export const fleetFindingSchema = z.object({
  findingId: z.string().min(1).max(60),
  category: z.string().min(3).max(80),
  observation: z.string().min(FLEET_OBSERVATION_MIN).max(FLEET_OBSERVATION_MAX),
  evidenceRefIds: z.array(z.string().min(1).max(120)).max(FLEET_MAX_EVIDENCE_REFS_PER_FINDING).default([]),
  evidenceKinds: z.array(fleetEvidenceKindEnum).max(FLEET_MAX_EVIDENCE_REFS_PER_FINDING).default([]),
  /** available | partially_available | unavailable — honesty assessment. */
  evidenceBasis: z.enum(['available', 'partially_available', 'unavailable']),
  sourceRefs: z.array(z.string().min(1).max(100)).max(FLEET_MAX_SOURCE_REFS_PER_FINDING).default([]),
  confidence: confidenceEnum,
  limitations: z.array(z.string().min(3).max(300)).max(10).default([]),
  suggestion: z.string().max(600).nullable().default(null),
}).strict()
export type FleetFinding = z.infer<typeof fleetFindingSchema>

/** CI-4E structured handoff record (charter §16.1 contract fields). */
/** CI-4E: max structured handoff records per task output (bounded). */
export const FLEET_MAX_HANDOFFS_PER_OUTPUT = 3

export const fleetHandoffSchema = z.object({
  /** Stable id for the handoff (traceable in audit trails). */
  handoffId: z.string().min(3).max(120),
  /** Source domain pack id that emitted the handoff. */
  sourceDomainId: z.string().min(3).max(80),
  /** Target domain pack id — must be a DECLARED related domain (C7). */
  targetDomainId: z.string().min(3).max(80),
  /** The specific question being handed over (bounded). */
  question: z.string().min(10).max(600),
  /** Evidence kinds the receiver may rely on (subset of the charter kinds). */
  permittedEvidenceKinds: z.array(fleetEvidenceKindEnum).max(FLEET_MAX_EVIDENCE_REFS_PER_FINDING).default([]),
  /** The output contract version the receiver must answer under. */
  outputContractVersion: z.string().min(3).max(40),
  /** Budget bounds for the receiving task (honest defaults, server-clamped). */
  budget: z.object({
    maxAttempts: z.number().int().min(1).max(3).default(2),
    timeoutMs: z.number().int().min(5_000).max(120_000).default(60_000),
  }).default({ maxAttempts: 2, timeoutMs: 60_000 }),
  /** Return status of the handoff record itself. */
  returnStatus: z.enum(['RECORDED', 'DISPATCHED', 'REFUSED', 'ANSWERED', 'TIMEOUT', 'REFUSED_TARGET_UNAVAILABLE']).default('RECORDED'),
}).strict()
export type FleetHandoff = z.infer<typeof fleetHandoffSchema>

/**
 * The charter §12 envelope. `status` distinguishes model failure (FAILED),
 * low confidence (limitations + confidence) and insufficient evidence
 * (INSUFFICIENT_EVIDENCE with empty/absent findings) — the three are never
 * conflated.
 */
export const fleetTaskOutputSchema = z.object({
  contractVersion: z.literal(FLEET_CONTRACT_VERSION),
  taskId: z.string().min(3).max(200),
  classSessionId: z.string().min(1).max(120),
  agentId: z.string().min(3).max(120),
  agentVersion: z.string().min(1).max(60),
  domainPackId: z.string().max(80).nullable().default(null),
  domainPackVersion: z.string().max(40).nullable().default(null),
  language: fleetLanguageInfoSchema,
  status: z.enum(Object.values(FLEET_TASK_STATUS) as [keyof typeof FLEET_TASK_STATUS & string, ...(keyof typeof FLEET_TASK_STATUS & string)[]]),
  findings: z.array(fleetFindingSchema).max(FLEET_MAX_FINDINGS).default([]),
  unknowns: z.array(z.string().min(3).max(300)).max(FLEET_MAX_UNKNOWN_ITEMS).default([]),
  conflicts: z.array(z.string().min(3).max(300)).max(FLEET_MAX_UNKNOWN_ITEMS).default([]),
  riskFlags: z.array(z.string().min(3).max(120)).max(FLEET_MAX_UNKNOWN_ITEMS).default([]),
  /** CI-4E structured handoffs (see fleetHandoffSchema; bounded). */
  handoffs: z.array(fleetHandoffSchema).max(FLEET_MAX_HANDOFFS_PER_OUTPUT).default([]),
  /** Safety guardian / auditor escalations reach humans through this flag. */
  requiresHumanReview: z.boolean().default(false),
}).strict()
export type FleetTaskOutput = z.infer<typeof fleetTaskOutputSchema>

// ─── Structural honesty rules (beyond the schema) ────────────────────────────

export type FleetContractCheck = { id: string; passed: boolean; detail: string }

export type FleetContractResult =
  | { ok: true; output: FleetTaskOutput; checks: FleetContractCheck[] }
  | { ok: false; reason: string; checks: FleetContractCheck[] }

/**
 * Validate a candidate task output. Schema first, then the charter's
 * structural honesty rules:
 *
 *  C1  schema-valid and strictly typed (unknown fields rejected)
 *  C2  INSUFFICIENT_EVIDENCE outputs carry no findings resting on
 *      `available` evidence — abstention must be real abstention
 *  C3  COMPLETED outputs must cite at least one evidence kind or explicitly
 *      list `unknowns`/`limitations` — no unsupported assertions
 *  C4  findings resting on `unavailable` evidence must say so via
 *      evidenceBasis AND carry a limitation (the orchestrator flags them)
 *  C5  FAILED outputs carry an explanation through `unknowns` or riskFlags —
 *      a bare failure is never merged silently
 *  C6  source refs are well-formed registry ids (existence is checked at
 *      merge time by the evidence auditor against the registered set)
 */
export function validateFleetTaskOutput(input: unknown): FleetContractResult {
  const checks: FleetContractCheck[] = []
  const parsed = fleetTaskOutputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      reason: `contract schema: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 500)}`,
      checks: [{ id: 'C1', passed: false, detail: 'schema mismatch' }],
    }
  }
  const output = parsed.data
  checks.push({ id: 'C1', passed: true, detail: `schema-valid, contract ${FLEET_CONTRACT_VERSION}` })

  // C2 — real abstention.
  const insuffAvailableFindings = output.status === FLEET_TASK_STATUS.INSUFFICIENT_EVIDENCE
    ? output.findings.filter(f => f.evidenceBasis === 'available')
    : []
  checks.push({
    id: 'C2',
    passed: insuffAvailableFindings.length === 0,
    detail: insuffAvailableFindings.length === 0
      ? 'abstention integrity ok'
      : `INSUFFICIENT_EVIDENCE output carries ${insuffAvailableFindings.length} finding(s) claiming available evidence`,
  })

  // C3 — no unsupported assertions on COMPLETED.
  const unsupported = output.status === FLEET_TASK_STATUS.COMPLETED
    ? output.findings.filter(f => f.evidenceKinds.length === 0 && f.evidenceRefIds.length === 0 && output.unknowns.length === 0 && f.limitations.length === 0)
    : []
  checks.push({
    id: 'C3',
    passed: unsupported.length === 0,
    detail: unsupported.length === 0 ? 'evidence citation ok' : `${unsupported.length} finding(s) cite no evidence and declare no limitation`,
  })

  // C4 — unavailable-evidence findings must be self-flagged.
  const unflagged = output.findings.filter(f => f.evidenceBasis === 'unavailable' && f.limitations.length === 0)
  checks.push({
    id: 'C4',
    passed: unflagged.length === 0,
    detail: unflagged.length === 0 ? 'unavailable-evidence honesty ok' : `${unflagged.length} finding(s) rest on unavailable evidence without a limitation`,
  })

  // C5 — failures must explain themselves.
  const bareFailure = output.status === FLEET_TASK_STATUS.FAILED && output.unknowns.length === 0 && output.riskFlags.length === 0
  checks.push({ id: 'C5', passed: !bareFailure, detail: bareFailure ? 'FAILED output explains nothing' : 'failure explanation ok' })

  // C6 — source-ref well-formedness (registry existence at merge time).
  const malformedSourceRef = output.findings.flatMap(f => f.sourceRefs).find(ref => !/^[a-z0-9][a-z0-9._:-]*$/i.test(ref))
  checks.push({ id: 'C6', passed: malformedSourceRef === undefined, detail: malformedSourceRef === undefined ? 'source-ref format ok' : `malformed sourceRef: ${malformedSourceRef}` })

  // C7 — CI-4E handoff integrity: every structured handoff's target must be a
  // DECLARED related domain of the emitting pack (checked against the live
  // pack registry when the pack resolves; handoffs from pack-less outputs are
  // refused outright — a handoff without a source pack is meaningless). The
  // RECEIVER's own gates apply again at planning time (planHandoffFollowUps).
  let handoffOk = true
  let handoffDetail = 'no handoffs recorded'
  if (output.handoffs.length > 0) {
    const srcPack = output.domainPackId ? getDomainPack(output.domainPackId) : null
    if (!srcPack) {
      handoffOk = false
      handoffDetail = 'handoffs recorded without a resolvable source pack — refused'
    } else {
      const badTarget = output.handoffs.find(h => !srcPack.pack.relatedSubjectDomainIds.includes(h.targetDomainId))
      handoffOk = badTarget === undefined
      handoffDetail = handoffOk
        ? `${output.handoffs.length} handoff(s) target declared related domains only`
        : `handoff to "${badTarget!.targetDomainId}" is not a declared related domain of "${srcPack.pack.domainId}"`
    }
  }
  checks.push({ id: 'C7', passed: handoffOk, detail: handoffDetail })

  const failed = checks.filter(c => !c.passed)
  if (failed.length > 0) {
    return { ok: false, reason: failed.map(f => `${f.id}: ${f.detail}`).join(' | '), checks }
  }
  return { ok: true, output, checks }
}

/**
 * Task identity scheme used by the dispatcher (CI-3C) and persisted on audit
 * rows: `<classSessionId>:<agentId>[:<instance>]` — instance is the domain id
 * for dynamic subject specialists. Deterministic and unique per job.
 */
export function fleetTaskId(classSessionId: string, agentId: string, instance?: string): string {
  return instance ? `${classSessionId}:${agentId}:${instance}` : `${classSessionId}:${agentId}`
}
