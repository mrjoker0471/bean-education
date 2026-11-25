// ─── BEAN Classroom Intelligence (CI-3B): typed fleet agent registry ─────────
// The registry is the single authority for which fleet roles exist, what they
// may run on, which contract version they speak, and which domain packs they
// accept. Registration is validated (strict schema) and versioned.
//
// The registry NEVER accepts agent identity from request payloads as
// authority (charter §12.1): dispatch code resolves roles server-side from
// class metadata; the registry is the server-side map they resolve against.

import { z } from 'zod'
import {
  FLEET_AGENT_ID,
  FLEET_RUNTIME,
  FLEET_POOL,
  type FleetAgentId,
  type FleetRuntime,
  type FleetPool,
} from './constants'
import { FLEET_CONTRACT_VERSION } from './contracts'
import { getDomainPack } from './domain-packs'
import { domainIdFromInstanceId, isSubjectExpertInstanceId } from './constants'

export const fleetAgentSpecSchema = z.object({
  agentId: z.string().min(3).max(120),
  agentVersion: z.string().min(1).max(60),
  title: z.string().min(3).max(200),
  purpose: z.string().min(10).max(1000),
  runtime: z.enum(Object.values(FLEET_RUNTIME) as [FleetRuntime, ...FleetRuntime[]]),
  pools: z.array(z.enum(Object.values(FLEET_POOL) as [FleetPool, ...FleetPool[]])).min(1).max(7),
  /** Contract version this role speaks (validated against the live contract). */
  contractVersion: z.literal(FLEET_CONTRACT_VERSION),
  /**
   * Charter §5 prohibitions — enforced behaviourally in code; recorded here so
   * tests and review can assert each role's must-nevers are wired.
   */
  mustNever: z.array(z.string().min(5).max(300)).max(20).default([]),
  /** Whether the role is dynamic per-domain (subject experts). */
  dynamicDomain: z.boolean().default(false),
  /** Restrict to listed domain ids when set (empty = any dispatchable pack). */
  allowedDomains: z.array(z.string().max(80)).max(40).default([]),
  /** Pools whose capacity gates this role (dispatcher consults these). */
  capacityGated: z.boolean().default(true),
}).strict()
export type FleetAgentSpec = z.infer<typeof fleetAgentSpecSchema>
/** Registration input: schema-defaulted fields (dynamicDomain, allowedDomains) are optional. */
export type FleetAgentSpecInput = z.input<typeof fleetAgentSpecSchema>

// ─── Registry store ──────────────────────────────────────────────────────────

const coreRoles = new Map<string, FleetAgentSpec>()

export type RegisterAgentResult =
  | { ok: true; agentId: string; replaced: boolean }
  | { ok: false; reason: string }

/**
 * Register (or replace) a core role spec after strict validation.
 * Subject-expert instances are NOT registered here — they are resolved
 * dynamically against dispatchable domain packs (see resolveAgentId).
 */
export function registerAgent(input: unknown): RegisterAgentResult {
  const parsed = fleetAgentSpecSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: `invalid agent spec: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 400)}` }
  }
  const spec = parsed.data
  if (spec.dynamicDomain && spec.agentId !== FLEET_AGENT_ID.SUBJECT_EXPERT) {
    return { ok: false, reason: 'dynamicDomain is reserved for the BEAN_SUBJECT_EXPERT template role' }
  }
  if (!spec.dynamicDomain && spec.agentId === FLEET_AGENT_ID.SUBJECT_EXPERT) {
    return { ok: false, reason: 'the template subject-expert role must be dynamicDomain' }
  }
  const replaced = coreRoles.has(spec.agentId)
  coreRoles.set(spec.agentId, spec)
  return { ok: true, agentId: spec.agentId, replaced }
}

export function getAgentSpec(agentId: string): FleetAgentSpec | null {
  return coreRoles.get(agentId) ?? null
}

/** All registered core roles, sorted by agentId (deterministic). */
export function listAgents(): FleetAgentSpec[] {
  return [...coreRoles.values()].sort((a, b) => a.agentId.localeCompare(b.agentId))
}

export type AgentResolution =
  | { ok: true; spec: FleetAgentSpec; instanceAgentId: string; domainPackId: string | null; underReviewPack: boolean }
  | { ok: false; reason: string }

/**
 * Resolve ANY agent id (core or dynamic subject-expert instance) to a usable
 * spec. For subject-expert instances the domain pack must exist and be
 * dispatchable (VERIFIED or IN_REVIEW) — a specialist without a usable pack
 * is an honest "cannot dispatch", never a guessed run.
 */
export function resolveAgentId(agentId: string): AgentResolution {
  const domainInstance = domainIdFromInstanceId(agentId)
  if (domainInstance !== null) {
    const template = coreRoles.get(FLEET_AGENT_ID.SUBJECT_EXPERT)
    if (!template) return { ok: false, reason: 'subject-expert template role not registered' }
    const found = getDomainPack(domainInstance)
    if (!found) return { ok: false, reason: `no domain pack registered for "${domainInstance}"` }
    if (found.pack.status !== 'VERIFIED' && found.pack.status !== 'IN_REVIEW') {
      return { ok: false, reason: `domain pack "${domainInstance}" is ${found.pack.status} — not dispatchable` }
    }
    if (template.allowedDomains.length > 0 && !template.allowedDomains.includes(domainInstance)) {
      return { ok: false, reason: `subject expert restricted from domain "${domainInstance}"` }
    }
    return {
      ok: true,
      spec: template,
      instanceAgentId: agentId,
      domainPackId: domainInstance,
      underReviewPack: found.pack.status === 'IN_REVIEW',
    }
  }
  const spec = coreRoles.get(agentId)
  if (!spec) return { ok: false, reason: `agent not registered: ${agentId}` }
  return { ok: true, spec, instanceAgentId: agentId, domainPackId: null, underReviewPack: false }
}

/** Reset the registry (tests only). */
export function resetRegistryForTests(): void {
  coreRoles.clear()
}

/**
 * Snapshot the fleet registry (tests only) — pair with restoreRegistryForTests
 * in afterAll so a mutating test file never leaks registry state into other
 * files in the same combined bun test process (execution order is
 * filesystem-dependent).
 */
export function snapshotRegistryForTests(): Array<[string, FleetAgentSpec]> {
  return Array.from(coreRoles.entries())
}

/** Restore a snapshot taken by snapshotRegistryForTests (tests only). */
export function restoreRegistryForTests(snapshot: Array<[string, FleetAgentSpec]>): void {
  coreRoles.clear()
  for (const [agentId, spec] of snapshot) coreRoles.set(agentId, spec)
}

/** Re-run core fleet registration after a reset (tests only). */
export function reRegisterCoreFleetForTests(): void {
  registerCoreFleet()
}

/**
 * Register the full CI-3 fleet core with charter §5 must-nevers. Idempotent.
 * Roles whose implementations arrive in later milestones are registered now
 * with `capacityGated` semantics unchanged — dispatch code checks runtime
 * capability before use, the registry documents the fleet.
 */
export function registerCoreFleet(): void {
  const register = (spec: FleetAgentSpecInput) => {
    const res = registerAgent(spec)
    if (!res.ok) throw new Error(`core fleet registration failed for ${spec.agentId}: ${res.reason}`)
  }

  register({
    agentId: FLEET_AGENT_ID.DISPATCHER,
    agentVersion: '1.0.0',
    title: 'BEAN Fleet Dispatcher / Classroom Coordinator',
    purpose: 'Deterministically decide which agents work on a class, sequence their tasks, enforce consent and capacity, and record gaps honestly.',
    runtime: FLEET_RUNTIME.DETERMINISTIC,
    pools: [FLEET_POOL.REPORT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'invent attendance or class-completion state',
      'change teacher/student roles',
      'bypass consent checks',
      'dispatch all agents by default',
      'make Trust & Safety decisions',
    ],
    capacityGated: false,
  })

  register({
    agentId: FLEET_AGENT_ID.OBSERVER,
    agentVersion: '1.0.0',
    title: 'BEAN Classroom Observer',
    purpose: 'Visible, consent-gated LiveKit programmatic participant collecting only permitted structured signals; quiet by default; leaves cleanly.',
    runtime: FLEET_RUNTIME.LIVE_ROOM,
    pools: [FLEET_POOL.OBSERVER],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'secretly record audio or video',
      'capture video silently',
      'infer emotions from faces or voices',
      'infer attention from silence or camera-off status',
      'publish feedback during class',
      'store raw media by default',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.LEARNER,
    agentVersion: '2.0.0',
    title: 'BEAN Learner Agent (CI-1, upgraded)',
    purpose: 'Examine the lesson from the learner-experience perspective on authorised class-level evidence; separate class-level from individual-level information.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'submit a public student review',
      'impersonate a student',
      'claim an individual learner understood or failed without individual learning evidence',
      'infer intelligence or potential',
      'fabricate student sentiment',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.TEACHER_JUDGE,
    agentVersion: '2.0.0',
    title: 'BEAN Teacher Judge Agent (CI-1, upgraded)',
    purpose: 'Evaluate the lesson against the ten published teaching-quality categories with evidence-backed, calibration-aware observations.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'score accent, appearance, gender, disability, religion, ethnicity, personality or other protected characteristics',
      'treat student silence or poor network as teacher fault',
      'change public ratings, teacher status or payouts',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.SUBJECT_EXPERT,
    agentVersion: '1.0.0',
    title: 'BEAN Subject-Matter Specialist (dynamic per domain)',
    purpose: 'Check subject-specific claims, concepts, procedures and terminology inside the scope of its verified domain pack; hand off cross-domain topics.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.SUBJECT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'pretend to be a licensed professional',
      'provide unsupported diagnosis or legal/financial instruction',
      'present retrieval text as verified truth without provenance',
    ],
    dynamicDomain: true,
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.CURRICULUM,
    agentVersion: '1.0.0',
    title: 'BEAN Curriculum & Standards Specialist',
    purpose: 'Map lessons to the applicable curriculum/syllabus version and jurisdiction, distinguishing official standards from teacher notes.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'invent syllabus units',
      'claim official approval',
      'apply one jurisdiction standard as universal',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.PEDAGOGY,
    agentVersion: '1.0.0',
    title: 'BEAN Pedagogy & Instructional Design Specialist',
    purpose: 'Review lesson sequencing, scaffolding, cognitive load and practice opportunities; separate evidence from generic pedagogical advice.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'evaluate a teacher personality',
      'claim one teaching style is best for every learner',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.ASSESSMENT,
    agentVersion: '1.0.0',
    title: 'BEAN Assessment & Question-Quality Specialist',
    purpose: 'Examine tests, examples and practice questions for alignment, answer-key validity, ambiguity and bias; flag unsupported PYQ claims.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.SUBJECT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'mark generated questions as official exam questions without provenance',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.LANGUAGE,
    agentVersion: '1.0.0',
    title: 'BEAN Language & Multilingual Specialist',
    purpose: 'Coordinate language identification, code-switching preservation, terminology integrity and confidence-aware transcription handling.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.LANGUAGE],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'claim support for a language merely because a model returned text',
      'conceal low confidence',
      'erase regional or dialect differences',
      'translate an unverified technical term as certain',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.ACCESSIBILITY,
    agentVersion: '1.0.0',
    title: 'BEAN Accessibility & Inclusion Specialist',
    purpose: 'Identify avoidable barriers in permitted teaching artefacts; recommend plain-language and alternative formats without inferring disability.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'diagnose a learner',
      'infer disability from behaviour',
      'expose personal accommodations to other users',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.RESEARCH_VERIFIER,
    agentVersion: '1.0.0',
    title: 'BEAN Research & Source Verification Specialist',
    purpose: 'Verify factual claims against registered, licence-cleared sources by priority class; return not-verified when sources do not settle the question.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.EVIDENCE],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'invent citations, links, page numbers, quotes or source authority',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.EVIDENCE_AUDITOR,
    agentVersion: '1.0.0',
    title: 'BEAN Evidence & Hallucination Auditor',
    purpose: 'Independently challenge specialist findings: every finding must point to resolvable permitted evidence; overclaims and disagreements are surfaced, never smoothed.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.EVIDENCE],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'rewrite evidence to make an agent look correct',
      'resolve a teacher dispute',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.SAFETY_GUARDIAN,
    agentVersion: '1.0.0',
    title: 'BEAN Safety, Privacy & Fairness Guardian',
    purpose: 'Apply deterministic policy checks plus model-assisted risk detection; enforce consent, data-minimisation and protected-characteristic boundaries; escalate to humans.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.EVIDENCE],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'autonomously investigate or decide safeguarding outcomes',
      'punish a teacher or student',
      'disclose a reporter identity',
      'act as an emergency service',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.TEACHER_COACH,
    agentVersion: '1.0.0',
    title: 'BEAN Teacher Development Coach',
    purpose: 'Convert verified, comparable evaluation observations into development recommendations with sample thresholds; never alter official reviews.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'publish rankings',
      'produce unsupported trend claims',
      'use AI scores to penalise earnings or modify a teacher profile automatically',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.STUDENT_REVISION_COACH,
    agentVersion: '1.0.0',
    title: 'BEAN Student Revision Coach',
    purpose: 'Turn class-level summaries and separately authorised individual learning evidence into revision activities linked to real BEAN resources.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.PEDAGOGY],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'infer mastery from attendance',
      'claim a learner is weak or strong without evidence',
      'create fake progress or public rankings',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.DOMAIN_CURATOR,
    agentVersion: '1.0.0',
    title: 'BEAN Domain Knowledge Curator',
    purpose: 'Controlled ingestion and maintenance of taxonomy/domain packs with licence validation; drafts only — publication requires the human approval gate.',
    runtime: FLEET_RUNTIME.BACKGROUND_CURATION,
    pools: [FLEET_POOL.EVIDENCE],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'automatically publish unreviewed or unlicensed data as authoritative knowledge',
    ],
    capacityGated: false,
  })

  register({
    agentId: FLEET_AGENT_ID.REPORT_ORCHESTRATOR,
    agentVersion: '2.0.0',
    title: 'BEAN Final Report Orchestrator (CI-1, extended)',
    purpose: 'Deterministically validate, merge and version specialist outputs into teacher/student/admin outputs; preserve disagreements and uncertainty.',
    runtime: FLEET_RUNTIME.DETERMINISTIC,
    pools: [FLEET_POOL.REPORT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'invent a consensus',
      'hide conflicting opinions',
      'turn a recommendation into a disciplinary decision',
      'modify booking, attendance or payment state',
    ],
    capacityGated: false,
  })

  register({
    agentId: FLEET_AGENT_ID.INDEPENDENT_CRITIC,
    agentVersion: '1.0.0',
    title: 'BEAN Independent Critic',
    purpose: 'One bounded second-pass review of a draft report for omissions, contradictions and overclaiming; proposes corrections to the orchestrator.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.REPORT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'create new facts',
      'run unlimited self-debate loops',
    ],
    capacityGated: true,
  })

  register({
    agentId: FLEET_AGENT_ID.PROFESSION_MENTOR,
    agentVersion: '1.0.0',
    title: 'BEAN Profession Mentor (on demand)',
    purpose: 'Help students explore professions and pathways from evidence-backed profiles with jurisdiction awareness and explicit uncertainty.',
    runtime: FLEET_RUNTIME.QUEUED_SPECIALIST,
    pools: [FLEET_POOL.SUBJECT],
    contractVersion: FLEET_CONTRACT_VERSION,
    mustNever: [
      'guarantee employment',
      'invent salary data',
      'provide discriminatory career filtering',
      'present a local licence requirement without a jurisdiction-specific source',
    ],
    capacityGated: true,
  })
}

// Auto-register the core fleet on module import (same pattern as the CI-1
// pipeline module): importing the registry guarantees the fleet exists.
registerCoreFleet()
