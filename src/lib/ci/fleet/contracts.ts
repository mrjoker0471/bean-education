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

export const FLEET_CONTRACT_VERSION = '1.0.0'

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
