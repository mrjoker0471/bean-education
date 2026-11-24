// ─── BEAN Classroom Intelligence (CI-3C): fleet dispatcher ───────────────────
// Turns class metadata into a deterministic fleet task plan and durably
// dispatches it after a class reaches a terminal live state.
//
// Honesty rules (charter §5/§10/§12):
//   • The dispatcher NEVER accepts agent identity from request payloads as
//     authority — every role is resolved server-side from class metadata and
//     the registry.
//   • The mandatory honesty pair (evidence auditor + safety guardian) and the
//     charter's core pair (learner + teacher judge) are ALWAYS planned.
//   • Subject specialists are planned only for subjects that deterministically
//     resolve to domain families with dispatchable packs — an unknown subject
//     is an honest "no specialist dispatch", never a guess (§10.2).
//   • The language specialist is planned only on real multilingual evidence.
//     No such evidence pipeline exists yet (CI-3D), so dispatch passes
//     `false` and records that honestly.
//   • Enrichment (coaching) is planned by default but is the FIRST role group
//     to yield under capacity backpressure (worker-side skip with reason).
//   • Dispatch is idempotent per class: taskKey uniqueness is a DB guarantee;
//     a concurrent dispatch race reports the winner's tasks as already queued.
//   • Consent gates everything: no consent → no tasks, no exceptions.

import { db } from '@/lib/db'
import {
  FLEET_AGENT_ID,
  FLEET_TASK_ROLE,
  FLEET_TASK_PRIORITY,
  FLEET_MAX_DOMAINS_PER_CLASS,
  subjectExpertInstanceId,
  type FleetTaskRole,
} from './constants'
import { FLEET_CONTRACT_VERSION, fleetTaskId } from './contracts'
import { resolveAgentId } from './registry'
import { resolveDomainsForSubject } from './taxonomy'
// Importing the seed packs guarantees the deployed knowledge base exists
// wherever dispatch runs (same pattern as the registry's auto-registration):
// subject experts resolve against the REAL pack state — a deployment without
// packs plans no specialists and records that honestly.
import './packs'
import { hasCiConsent } from '../queue'
import { ensureFleetWorker } from './worker'

// ─── Planning (pure, deterministic) ───────────────────────────────────────────

export interface PlannedFleetTask {
  taskKey: string
  agentId: string
  taskRole: FleetTaskRole
  priority: number
  contractVersion: string
  /** Present for subject experts: the resolved domain family id. */
  domainId?: string
}

export interface PlannedSkip {
  taskRole: FleetTaskRole | 'DOMAIN_SPECIALIST'
  /** Agent that was attempted, when known. */
  agentId: string | null
  reason: string
}

export interface FleetPlanInput {
  classSessionId: string
  teacherProfileId: string
  /** Free text from class metadata (subject + title). */
  subjectText: string
  /** True ONLY with real multilingual evidence (never inferred from text alone). */
  multilingualEvidence: boolean
  /** Enrichment coaching defaults to planned; callers may exclude it. */
  includeEnrichment?: boolean
}

export interface FleetPlan {
  tasks: PlannedFleetTask[]
  skips: PlannedSkip[]
  /** Informational honesty notes (e.g. why the language specialist is absent). */
  notes: string[]
}

function planned(classSessionId: string, agentId: string, taskRole: FleetTaskRole, domainId?: string): PlannedFleetTask {
  return {
    taskKey: fleetTaskId(classSessionId, agentId, domainId),
    agentId,
    taskRole,
    priority: FLEET_TASK_PRIORITY[taskRole],
    contractVersion: FLEET_CONTRACT_VERSION,
    ...(domainId !== undefined ? { domainId } : {}),
  }
}

/**
 * Deterministically plan the fleet for one class. Pure function — no DB, no
 * model calls, no randomness. Ordering of `tasks` is the documented plan
 * order (core → audit → domain → language → enrichment); the worker re-orders
 * by persisted priority.
 */
export function planFleetTasks(input: FleetPlanInput): FleetPlan {
  const tasks: PlannedFleetTask[] = []
  const skips: PlannedSkip[] = []
  const notes: string[] = []

  // 1. Core pair — always planned (charter §5: learner + teacher judge).
  tasks.push(
    planned(input.classSessionId, FLEET_AGENT_ID.LEARNER, FLEET_TASK_ROLE.CORE),
    planned(input.classSessionId, FLEET_AGENT_ID.TEACHER_JUDGE, FLEET_TASK_ROLE.CORE),
  )

  // 2. Mandatory honesty pair — always planned (§12: outputs are audited and
  //    safety-checked; these two run even when every specialist skips).
  tasks.push(
    planned(input.classSessionId, FLEET_AGENT_ID.EVIDENCE_AUDITOR, FLEET_TASK_ROLE.MANDATORY_AUDIT),
    planned(input.classSessionId, FLEET_AGENT_ID.SAFETY_GUARDIAN, FLEET_TASK_ROLE.MANDATORY_AUDIT),
  )

  // 3. Domain specialists — only for deterministically resolved domains with
  //    dispatchable packs; capped at FLEET_MAX_DOMAINS_PER_CLASS.
  const resolution = resolveDomainsForSubject(input.subjectText, FLEET_MAX_DOMAINS_PER_CLASS)
  if (!resolution.matched) {
    skips.push({ taskRole: FLEET_TASK_ROLE.DOMAIN_SPECIALIST, agentId: null, reason: `no domain family matched (${resolution.reason})` })
    notes.push('subject specialist not planned: subject did not resolve to a domain family — no guessing')
  } else {
    notes.push(`subject resolved to ${resolution.domains.length} domain(s)${resolution.truncated ? ' (truncated to cap)' : ''}: ${resolution.domains.map(d => d.domainId).join(', ')}`)
    for (const domain of resolution.domains) {
      const instanceId = subjectExpertInstanceId(domain.domainId)
      const resolved = resolveAgentId(instanceId)
      if (!resolved.ok) {
        skips.push({ taskRole: FLEET_TASK_ROLE.DOMAIN_SPECIALIST, agentId: instanceId, reason: resolved.reason })
        continue
      }
      tasks.push(planned(input.classSessionId, instanceId, FLEET_TASK_ROLE.DOMAIN_SPECIALIST, domain.domainId))
    }
  }

  // 4. Language specialist — only on real multilingual evidence.
  if (input.multilingualEvidence) {
    const resolved = resolveAgentId(FLEET_AGENT_ID.LANGUAGE)
    if (!resolved.ok) {
      skips.push({ taskRole: FLEET_TASK_ROLE.LANGUAGE, agentId: FLEET_AGENT_ID.LANGUAGE, reason: resolved.reason })
    } else {
      tasks.push(planned(input.classSessionId, FLEET_AGENT_ID.LANGUAGE, FLEET_TASK_ROLE.LANGUAGE))
    }
  } else {
    notes.push('language specialist not planned: no multilingual evidence (none exists yet — the transcription evidence pipeline is CI-3D)')
  }

  // 5. Enrichment coaching — planned by default, first to yield under load.
  if (input.includeEnrichment !== false) {
    for (const agentId of [FLEET_AGENT_ID.TEACHER_COACH, FLEET_AGENT_ID.STUDENT_REVISION_COACH]) {
      const resolved = resolveAgentId(agentId)
      if (!resolved.ok) {
        skips.push({ taskRole: FLEET_TASK_ROLE.ENRICHMENT, agentId, reason: resolved.reason })
        continue
      }
      tasks.push(planned(input.classSessionId, agentId, FLEET_TASK_ROLE.ENRICHMENT))
    }
  } else {
    notes.push('enrichment not planned: caller excluded it')
  }

  return { tasks, skips, notes }
}

// ─── Dispatch (durable, idempotent, consent-gated) ────────────────────────────

export type DispatchOutcome =
  | {
      dispatched: true
      classSessionId: string
      queued: PlannedFleetTask[]
      alreadyQueued: string[]
      skipped: PlannedSkip[]
      notes: string[]
    }
  | { dispatched: false; reason: 'class_not_found' | 'no_live_session' | 'class_not_terminal' | 'no_consent' }

/**
 * Plan and durably dispatch the fleet for one ended class. Guards, in order:
 *   1. the class exists and belongs to a real teacher profile;
 *   2. a live session existed and has reached a terminal state (ENDED or
 *      INTERRUPTED) — fleet work never races a running room;
 *   3. the teacher currently holds CI consent (checked against the teacher's
 *      Student account, never a client-supplied id).
 *
 * Idempotent: taskKey is UNIQUE — a repeat dispatch (e.g. duplicate lifecycle
 * webhooks) re-reads the winner's rows and reports them as already queued.
 * Starts the worker pool when at least one task was queued.
 */
export async function dispatchFleetForSession(opts: {
  classSessionId: string
  includeEnrichment?: boolean
  /**
   * Must be backed by real multilingual evidence (transcription/language
   * signals). No such pipeline exists yet — the default stays `false` and the
   * plan records that honestly. CI-3D wires the evidence source.
   */
  multilingualEvidence?: boolean
}): Promise<DispatchOutcome> {
  const cls = await db.classSession.findUnique({
    where: { id: opts.classSessionId },
    select: {
      id: true,
      teacherProfileId: true,
      subject: true,
      title: true,
      teacherProfile: { select: { studentId: true } },
      liveSession: { select: { id: true, status: true } },
    },
  })
  if (!cls) return { dispatched: false, reason: 'class_not_found' }
  if (!cls.liveSession) return { dispatched: false, reason: 'no_live_session' }
  if (cls.liveSession.status !== 'ENDED' && cls.liveSession.status !== 'INTERRUPTED') {
    return { dispatched: false, reason: 'class_not_terminal' }
  }
  if (!(await hasCiConsent(cls.teacherProfile.studentId))) {
    return { dispatched: false, reason: 'no_consent' }
  }

  const plan = planFleetTasks({
    classSessionId: cls.id,
    teacherProfileId: cls.teacherProfileId,
    subjectText: `${cls.subject} ${cls.title}`,
    multilingualEvidence: opts.multilingualEvidence === true,
    includeEnrichment: opts.includeEnrichment,
  })

  const queued: PlannedFleetTask[] = []
  const alreadyQueued: string[] = []
  for (const task of plan.tasks) {
    try {
      await db.classroomFleetTask.create({
        data: {
          taskKey: task.taskKey,
          classSessionId: cls.id,
          teacherProfileId: cls.teacherProfileId,
          agentId: task.agentId,
          taskRole: task.taskRole,
          priority: task.priority,
          status: 'QUEUED',
          attempts: 0,
          maxAttempts: 3,
          contractVersion: task.contractVersion,
        },
      })
      queued.push(task)
    } catch (err) {
      // Duplicate dispatch race (duplicate lifecycle events): the winner's
      // row is reported honestly instead of failing.
      if ((err as { code?: string }).code === 'P2002') {
        const winner = await db.classroomFleetTask.findUnique({ where: { taskKey: task.taskKey } })
        if (winner) alreadyQueued.push(task.taskKey)
        continue
      }
      throw err
    }
  }

  if (queued.length > 0) ensureFleetWorker()

  return {
    dispatched: true,
    classSessionId: cls.id,
    queued,
    alreadyQueued,
    skipped: plan.skips,
    notes: plan.notes,
  }
}
