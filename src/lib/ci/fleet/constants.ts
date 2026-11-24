// ─── BEAN Classroom Intelligence (CI-3B): fleet constants ────────────────────
// Stable identifiers for the agent fleet, worker pools, domain-pack lifecycle
// states, source-quality classes and task statuses. Extends — never replaces —
// the CI-1 constants in `../constants.ts`.
//
// Sources of authority:
// - Charter: docs/BEAN-CLASSROOM-INTELLIGENCE-AGENT-CHARTER.md (§5 catalogue,
//   §4.3 pools, §6.4 pack schema, §7.2 source hierarchy, §12 contract).
// - Existing CI conventions: src/lib/ci/constants.ts.

import { CI_AGENT } from '../constants'

/**
 * Stable fleet role IDs (charter §5). These are registry keys — they never
 * appear as authority in any request payload; the dispatcher derives them
 * server-side from class metadata and capacity.
 *
 * The three CI-1 agents keep their persisted enum names (`CI_AGENT.LEARNER` …)
 * for `ClassroomAgentRun.agent`; the fleet registry maps them onto the
 * charter's full identity strings without changing the CI-1 storage format.
 */
export const FLEET_AGENT_ID = {
  DISPATCHER: 'BEAN_CLASSROOM_DISPATCHER', // Agent 00
  OBSERVER: 'BEAN_CLASSROOM_OBSERVER', // Agent 01
  LEARNER: 'BEAN_LEARNER_AGENT', // Agent 02 (CI-1 LEARNER)
  TEACHER_JUDGE: 'BEAN_TEACHER_JUDGE', // Agent 03 (CI-1 TEACHER_JUDGE)
  SUBJECT_EXPERT: 'BEAN_SUBJECT_EXPERT', // Agent 04 (dynamic: BEAN_SUBJECT_EXPERT::<domain-id>)
  CURRICULUM: 'BEAN_CURRICULUM_SPECIALIST', // Agent 05
  PEDAGOGY: 'BEAN_PEDAGOGY_SPECIALIST', // Agent 06
  ASSESSMENT: 'BEAN_ASSESSMENT_SPECIALIST', // Agent 07
  LANGUAGE: 'BEAN_LANGUAGE_SPECIALIST', // Agent 08
  ACCESSIBILITY: 'BEAN_ACCESSIBILITY_SPECIALIST', // Agent 09
  RESEARCH_VERIFIER: 'BEAN_RESEARCH_VERIFIER', // Agent 10
  EVIDENCE_AUDITOR: 'BEAN_EVIDENCE_AUDITOR', // Agent 11
  SAFETY_GUARDIAN: 'BEAN_SAFETY_GUARDIAN', // Agent 12
  TEACHER_COACH: 'BEAN_TEACHER_COACH', // Agent 13
  STUDENT_REVISION_COACH: 'BEAN_STUDENT_REVISION_COACH', // Agent 14
  DOMAIN_CURATOR: 'BEAN_DOMAIN_CURATOR', // Agent 15
  REPORT_ORCHESTRATOR: 'BEAN_REPORT_ORCHESTRATOR', // Agent 16 (CI-1 ORCHESTRATOR)
  INDEPENDENT_CRITIC: 'BEAN_INDEPENDENT_CRITIC', // Agent 17
  PROFESSION_MENTOR: 'BEAN_PROFESSION_MENTOR', // Agent 18
} as const
export type FleetAgentId = (typeof FLEET_AGENT_ID)[keyof typeof FLEET_AGENT_ID]

/** How a role executes. Only the observer joins a live room (charter §4.1). */
export const FLEET_RUNTIME = {
  /** Deterministic in-process code, no model call. */
  DETERMINISTIC: 'DETERMINISTIC',
  /** Model-assisted work dispatched on the durable queue, after class. */
  QUEUED_SPECIALIST: 'QUEUED_SPECIALIST',
  /** Visible live-room participant (consent-gated, explicit dispatch only). */
  LIVE_ROOM: 'LIVE_ROOM',
  /** Background curation/maintenance workflow with human publication gates. */
  BACKGROUND_CURATION: 'BACKGROUND_CURATION',
} as const
export type FleetRuntime = (typeof FLEET_RUNTIME)[keyof typeof FLEET_RUNTIME]

/**
 * Bounded worker pools (charter §4.3). Capacity limits live in the dispatcher
 * (CI-3C); pools here name *which* workers a role may run on.
 */
export const FLEET_POOL = {
  OBSERVER: 'observerPool',
  TRANSCRIPTION: 'transcriptionPool',
  SUBJECT: 'subjectPool',
  PEDAGOGY: 'pedagogyPool',
  LANGUAGE: 'languagePool',
  EVIDENCE: 'evidencePool',
  REPORT: 'reportPool',
} as const
export type FleetPool = (typeof FLEET_POOL)[keyof typeof FLEET_POOL]

/** Domain-pack lifecycle (charter §6.4: "human reviewer and approval state"). */
export const PACK_STATUS = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  VERIFIED: 'VERIFIED',
  RETIRED: 'RETIRED',
} as const
export type PackStatus = (typeof PACK_STATUS)[keyof typeof PACK_STATUS]

/**
 * Charter §7.2 source hierarchy. Numeric rank 1 (best) … 6 (context only).
 * A source's quality class gates what claims may rest on it.
 */
export const SOURCE_QUALITY_CLASS = {
  OFFICIAL_REGULATOR: 'OFFICIAL_REGULATOR', // 1 — laws, regulators, standards bodies
  OFFICIAL_CURRICULUM: 'OFFICIAL_CURRICULUM', // 2 — education boards, qualification bodies
  PEER_REVIEWED: 'PEER_REVIEWED', // 3 — peer-reviewed literature, academic bodies
  PROFESSION_BODY: 'PROFESSION_BODY', // 4 — professional associations, recognised textbooks
  ASSESSED_SECONDARY: 'ASSESSED_SECONDARY', // 5 — carefully assessed secondary sources
  COMMUNITY_CONTEXT: 'COMMUNITY_CONTEXT', // 6 — context only, never sole authority
} as const
export type SourceQualityClass = (typeof SOURCE_QUALITY_CLASS)[keyof typeof SOURCE_QUALITY_CLASS]

/** Charter §12 task statuses — model failure ≠ low confidence ≠ no evidence. */
export const FLEET_TASK_STATUS = {
  COMPLETED: 'COMPLETED',
  PARTIAL: 'PARTIAL',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const
export type FleetTaskStatus = (typeof FLEET_TASK_STATUS)[keyof typeof FLEET_TASK_STATUS]

/**
 * Map CI-1 persisted agent names onto charter identities. The
 * `ClassroomAgentRun.agent` column keeps the CI-1 values; the registry is the
 * translation layer so fleet telemetry can speak the charter's names without
 * a storage migration.
 */
export const CI_AGENT_TO_FLEET_ID: Record<(typeof CI_AGENT)[keyof typeof CI_AGENT], FleetAgentId> = {
  [CI_AGENT.LEARNER]: FLEET_AGENT_ID.LEARNER,
  [CI_AGENT.TEACHER_JUDGE]: FLEET_AGENT_ID.TEACHER_JUDGE,
  [CI_AGENT.ORCHESTRATOR]: FLEET_AGENT_ID.REPORT_ORCHESTRATOR,
}

/** Subject-expert instance id format: `BEAN_SUBJECT_EXPERT::<domain-id>`. */
export const SUBJECT_EXPERT_ID_PREFIX = `${FLEET_AGENT_ID.SUBJECT_EXPERT}::`

export function subjectExpertInstanceId(domainId: string): string {
  return `${SUBJECT_EXPERT_ID_PREFIX}${domainId}`
}

export function isSubjectExpertInstanceId(id: string): boolean {
  return id.startsWith(SUBJECT_EXPERT_ID_PREFIX)
}

export function domainIdFromInstanceId(id: string): string | null {
  if (!isSubjectExpertInstanceId(id)) return null
  const domainId = id.slice(SUBJECT_EXPERT_ID_PREFIX.length)
  return domainId.length > 0 ? domainId : null
}

// ─── Fleet bounds (server-enforced) ──────────────────────────────────────────

/** Max findings per specialist task output (mirrors CI_DISPUTE_MAX_FINDINGS). */
export const FLEET_MAX_FINDINGS = 10
/** Max evidence refs a single finding may cite. */
export const FLEET_MAX_EVIDENCE_REFS_PER_FINDING = 5
/** Max source refs a single finding may cite. */
export const FLEET_MAX_SOURCE_REFS_PER_FINDING = 3
/** Observation text bounds per finding (matches the CI-1 finding bounds). */
export const FLEET_OBSERVATION_MIN = 10
export const FLEET_OBSERVATION_MAX = 1000
/** Max unknowns/conflicts/riskFlags listed per task output. */
export const FLEET_MAX_UNKNOWN_ITEMS = 10
/** Max domains one lesson may dispatch specialists for (charter §16.1 cap). */
export const FLEET_MAX_DOMAINS_PER_CLASS = 3
