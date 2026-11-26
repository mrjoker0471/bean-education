// ─── BEAN Classroom Intelligence (CI-5C): review assignment & case management ────
// Every expert review flows through a server-authorised assignment. Hard rules
// encoded here:
//   • Reviewer eligibility is re-verified SERVER-SIDE at assignment creation:
//     ACTIVE profile + scope match (exact domain, or exact language/task/domain).
//   • One open assignment per reviewer per subject — a reviewer never reviews
//     the same version twice, and a reviewer who already DECIDED a version is
//     never re-assigned to it (independence is preserved at the assignment layer
//     as well as by the distinct-reviewer rules in the decision ledgers).
//   • The assigning administrator must record the conflict-of-interest check:
//     a declared CONFLICT_FOUND refuses creation. The reviewer can always
//     RECUSE later with a reason (append-only).
//   • Assignments EXPIRE lazily (SYSTEM-attributed, idempotent) so a stale
//     assignment can never be used to submit a decision.
//   • The assignment carries NO decision: decisions are written only through
//     the authoritative append-only paths (ClassroomPackReview / CI-5E language
//     reviews); the assignment then stores the outcomeRef.

import { z } from 'zod'
import { resolveReviewerProfile, reviewerCanReviewDomain, reviewerCanReviewLanguage, isReviewerAssignableStatus, type ReviewerProfileRow } from './reviewers'
import type { Ci3LanguageTask } from './language'

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const ASSIGNMENT_STATUS = [
  'ASSIGNED',
  'IN_PROGRESS',
  'SUBMITTED',
  'COMPLETED',
  'EXPIRED',
  'REASSIGNED',
  'RECUSED',
  'CANCELLED',
] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUS)[number]

export const ASSIGNMENT_EVENT_TYPES = [
  'ASSIGNED',
  'STARTED',
  'SUBMITTED',
  'COMPLETED',
  'EXPIRED',
  'REASSIGNED',
  'RECUSED',
  'CANCELLED',
  'ADJUDICATION_REQUESTED',
  'ADJUDICATED',
] as const
export type AssignmentEventType = (typeof ASSIGNMENT_EVENT_TYPES)[number]

/** Statuses an assignment may be submitted/recused from. */
const OPEN_STATUSES: readonly AssignmentStatus[] = ['ASSIGNED', 'IN_PROGRESS']
/** Statuses that still occupy the reviewer's "one per subject" slot. */
export const BLOCKING_STATUSES: readonly AssignmentStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED']

// ─── Structural DB view ───────────────────────────────────────────────────────

export interface AssignmentRow {
  id: string
  subjectType: string
  subjectKey: string
  subjectVersion: string | null
  subjectChecksum: string | null
  riskClass: string | null
  reviewerProfileId: string
  reviewerCode: string
  assignedByAdminId: string
  status: string
  dueAt: Date | null
  expiresAt: Date | null
  coiCheckResult: string
  conflictNote: string | null
  outcomeRef: string | null
  reassignmentReason: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AssignmentEventRow {
  id: string
  assignmentId: string
  eventType: string
  actorKind: string
  actorId: string
  rationale: string | null
  payload: string | null
  createdAt: Date
}

export interface AssignmentDb {
  expertReviewAssignment: {
    create(args: { data: Record<string, unknown> }): Promise<AssignmentRow>
    findUnique(args: { where: Record<string, unknown> }): Promise<AssignmentRow | null>
    findFirst(args?: Record<string, unknown>): Promise<AssignmentRow | null>
    findMany(args?: Record<string, unknown>): Promise<AssignmentRow[]>
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<AssignmentRow>
  }
  expertReviewAssignmentEvent: {
    create(args: { data: Record<string, unknown> }): Promise<AssignmentEventRow>
    findMany(args?: Record<string, unknown>): Promise<AssignmentEventRow[]>
  }
}

export function assignmentDbFromPrisma(client: unknown): AssignmentDb {
  return client as AssignmentDb
}

// ─── Lazy expiry ──────────────────────────────────────────────────────────────

function isExpiredAssignment(a: AssignmentRow, now: Date): boolean {
  return OPEN_STATUSES.includes(a.status as AssignmentStatus) && !!a.expiresAt && a.expiresAt.getTime() < now.getTime()
}

async function expireAssignment(db: AssignmentDb, a: AssignmentRow, now: Date): Promise<AssignmentRow> {
  await db.expertReviewAssignmentEvent.create({
    data: {
      assignmentId: a.id,
      eventType: 'EXPIRED',
      actorKind: 'SYSTEM',
      actorId: 'system',
      rationale: `assignment acceptance window ended at ${a.expiresAt!.toISOString()} — reassignment required for the work to proceed`,
      payload: JSON.stringify({ previousStatus: a.status }),
    },
  })
  return db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'EXPIRED' } })
}

/** Load one assignment, applying lazy expiry first. */
export async function getAssignment(db: AssignmentDb, id: string, now: Date = new Date()): Promise<AssignmentRow | null> {
  const a = await db.expertReviewAssignment.findUnique({ where: { id } })
  if (!a) return null
  if (isExpiredAssignment(a, now)) return expireAssignment(db, a, now)
  return a
}

export async function listAssignments(db: AssignmentDb, filter: { status?: string; reviewerProfileId?: string; subjectType?: string; subjectKey?: string } = {}, now: Date = new Date()): Promise<AssignmentRow[]> {
  const where: Record<string, unknown> = {}
  if (filter.status) where.status = filter.status
  if (filter.reviewerProfileId) where.reviewerProfileId = filter.reviewerProfileId
  if (filter.subjectType) where.subjectType = filter.subjectType
  if (filter.subjectKey) where.subjectKey = filter.subjectKey
  const rows = await db.expertReviewAssignment.findMany({ where, orderBy: { createdAt: 'asc' as const } })
  const out: AssignmentRow[] = []
  for (const row of rows) {
    if (isExpiredAssignment(row, now)) out.push(await expireAssignment(db, row, now))
    else out.push(row)
  }
  return out
}

// ─── Assignment creation (the only entry point; server-authorised) ────────────

export const createAssignmentInputSchema = z.object({
  subjectType: z.enum(['DOMAIN_PACK', 'LANGUAGE_CAPABILITY', 'CLASSROOM_REPORT']),
  /** DOMAIN_PACK: the domainId. LANGUAGE_CAPABILITY: "tag:task[:domain]". */
  subjectKey: z.string().min(3).max(160),
  subjectVersion: z.string().min(1).max(40).optional(),
  subjectChecksum: z.string().min(16).max(64).optional(),
  riskClass: z.enum(['STANDARD', 'ELEVATED', 'HIGH_STAKES']).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  /** Admin conflict-of-interest check at assignment time. */
  coiCheck: z.enum(['NONE_DECLARED', 'CONFLICT_FOUND']),
  conflictNote: z.string().max(1000).optional(),
}).strict()

export type CreateAssignmentResult =
  | { ok: true; assignment: AssignmentRow }
  | { ok: false; status: number; error: string }

export interface AssignmentAdminActor {
  studentId: string
  displayName: string
}

/**
 * Create a review assignment. Everything that gates eligibility happens here,
 * server-side: reviewer must be ACTIVE, scope must match the subject exactly,
 * the admin COI check must be NONE_DECLARED (a declared conflict refuses), and
 * no open/prior assignment may exist for the same reviewer+subject version.
 */
export async function createAssignment(
  db: AssignmentDb,
  admin: AssignmentAdminActor,
  reviewerProfile: ReviewerProfileRow,
  input: unknown,
): Promise<CreateAssignmentResult> {
  const parsed = createAssignmentInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid assignment: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const data = parsed.data

  // Reviewer must currently be assignable (ACTIVE; lazy expiry already applied by callers).
  if (!isReviewerAssignableStatus(reviewerProfile.status)) {
    return { ok: false, status: 409, error: `reviewer ${reviewerProfile.reviewerCode} is ${reviewerProfile.status} — only ACTIVE reviewers receive assignments` }
  }

  // CI-6F (additive): reviewer availability/workload control — a reviewer who
  // has paused availability receives no new assignments until they resume.
  if ((reviewerProfile as { availability?: string }).availability === 'PAUSED') {
    return { ok: false, status: 409, error: `reviewer ${reviewerProfile.reviewerCode} has paused availability — no new assignments are received until they resume` }
  }

  // Admin COI check: a declared conflict refuses the assignment outright.
  if (data.coiCheck === 'CONFLICT_FOUND') {
    return { ok: false, status: 409, error: 'conflict of interest recorded for this reviewer/subject — assignment refused; choose an independent reviewer (the COI note is preserved in the audit trail only via a recusal/reassignment record)' }
  }

  // Scope match — server-side, exact.
  if (data.subjectType === 'DOMAIN_PACK') {
    if (!reviewerCanReviewDomain(reviewerProfile, data.subjectKey)) {
      return { ok: false, status: 403, error: `reviewer ${reviewerProfile.reviewerCode} is not authorised for domain "${data.subjectKey}" — scope mismatch` }
    }
  } else if (data.subjectType === 'CLASSROOM_REPORT') {
    // Report audits are assigned by administrators to ACTIVE reviewers holding
    // an approved scope of EITHER kind (the report-audit itself is privacy-
    // masked and not domain-bound); the assignment carries the authorisation.
    const scope = reviewerProfile.category === 'DOMAIN_EXPERT'
      ? JSON.parse(reviewerProfile.approvedDomains) as string[]
      : JSON.parse(reviewerProfile.approvedLanguages) as unknown[]
    if (scope.length === 0) {
      return { ok: false, status: 403, error: `reviewer ${reviewerProfile.reviewerCode} holds no approved scope — report audits require an authorised reviewer` }
    }
  } else {
    const parts = data.subjectKey.split(':')
    if (parts.length < 2 || parts.length > 3) {
      return { ok: false, status: 400, error: 'LANGUAGE_CAPABILITY subjectKey must be "tag:task" or "tag:task:domain"' }
    }
    const [tag, task, domain] = parts
    if (!reviewerCanReviewLanguage(reviewerProfile, tag, task as Ci3LanguageTask, domain ?? null)) {
      return { ok: false, status: 403, error: `reviewer ${reviewerProfile.reviewerCode} is not authorised for language capability "${data.subjectKey}" — scope mismatch` }
    }
  }

  // Independence/duplicate guard: one open slot, and never re-assign a reviewer
  // who already decided this exact subject version.
  const existing = await listAssignments(db, { reviewerProfileId: reviewerProfile.id, subjectType: data.subjectType, subjectKey: data.subjectKey }, new Date())
  const blocking = existing.find((a) => BLOCKING_STATUSES.includes(a.status as AssignmentStatus))
  if (blocking) {
    return { ok: false, status: 409, error: `reviewer already has a ${blocking.status} assignment for this subject (${blocking.id}) — one open assignment per subject per reviewer` }
  }
  if (data.subjectChecksum) {
    const decided = existing.find((a) => a.status === 'COMPLETED' && a.subjectChecksum === data.subjectChecksum)
    if (decided) {
      return { ok: false, status: 409, error: 'reviewer already recorded a decision for this exact subject version — independent-review separation forbids re-assignment' }
    }
  }

  const created = await db.expertReviewAssignment.create({
    data: {
      subjectType: data.subjectType,
      subjectKey: data.subjectKey,
      subjectVersion: data.subjectVersion ?? null,
      subjectChecksum: data.subjectChecksum ?? null,
      riskClass: data.riskClass ?? null,
      reviewerProfileId: reviewerProfile.id,
      reviewerCode: reviewerProfile.reviewerCode,
      assignedByAdminId: admin.studentId,
      status: 'ASSIGNED',
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      coiCheckResult: 'PASS',
      conflictNote: data.conflictNote ?? null,
    },
  })
  await db.expertReviewAssignmentEvent.create({
    data: {
      assignmentId: created.id,
      eventType: 'ASSIGNED',
      actorKind: 'ADMIN',
      actorId: admin.studentId,
      rationale: `assigned to ${reviewerProfile.reviewerCode} after server-side scope match + COI check`,
      payload: JSON.stringify({
        subject: { type: data.subjectType, key: data.subjectKey, version: data.subjectVersion ?? null, checksum: data.subjectChecksum ?? null },
        coiCheck: data.coiCheck,
        conflictNote: data.conflictNote ?? null,
      }),
    },
  })
  return { ok: true, assignment: created }
}

// ─── Reviewer-side lifecycle (ownership always re-verified) ───────────────────

function ownershipGuard(a: AssignmentRow, profile: ReviewerProfileRow): { ok: false; status: number; error: string } | null {
  if (a.reviewerProfileId !== profile.id) {
    return { ok: false, status: 403, error: 'this assignment belongs to a different reviewer' }
  }
  return null
}

/** Reviewer starts work: ASSIGNED → IN_PROGRESS (ownership checked). */
export async function startAssignment(
  db: AssignmentDb,
  profile: ReviewerProfileRow,
  assignmentId: string,
  actorStudentId: string,
  now: Date = new Date(),
): Promise<CreateAssignmentResult> {
  const a = await getAssignment(db, assignmentId, now)
  if (!a) return { ok: false, status: 404, error: 'assignment not found' }
  const own = ownershipGuard(a, profile)
  if (own) return own
  if (a.status !== 'ASSIGNED') return { ok: false, status: 409, error: `assignment is ${a.status} — only ASSIGNED work can be started` }
  const updated = await db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'IN_PROGRESS' } })
  await db.expertReviewAssignmentEvent.create({
    data: { assignmentId: a.id, eventType: 'STARTED', actorKind: 'REVIEWER', actorId: actorStudentId, rationale: 'reviewer began the assigned review' },
  })
  return { ok: true, assignment: updated }
}

/** Reviewer recusal — always allowed while open, always with a reason, append-only. */
export async function recuseAssignment(
  db: AssignmentDb,
  profile: ReviewerProfileRow,
  assignmentId: string,
  reason: string,
  actorStudentId: string,
  now: Date = new Date(),
): Promise<CreateAssignmentResult> {
  if (!reason || reason.trim().length < 10) return { ok: false, status: 400, error: 'recusal requires a reason (min 10 chars) — recusals are part of the permanent audit trail' }
  const a = await getAssignment(db, assignmentId, now)
  if (!a) return { ok: false, status: 404, error: 'assignment not found' }
  const own = ownershipGuard(a, profile)
  if (own) return own
  if (!OPEN_STATUSES.includes(a.status as AssignmentStatus)) return { ok: false, status: 409, error: `assignment is ${a.status} — recusal applies to open assignments` }
  const updated = await db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'RECUSED' } })
  await db.expertReviewAssignmentEvent.create({
    data: { assignmentId: a.id, eventType: 'RECUSED', actorKind: 'REVIEWER', actorId: actorStudentId, rationale: reason },
  })
  return { ok: true, assignment: updated }
}

// ─── Admin-side lifecycle ─────────────────────────────────────────────────────

export async function cancelAssignment(db: AssignmentDb, admin: AssignmentAdminActor, assignmentId: string, reason: string, now: Date = new Date()): Promise<CreateAssignmentResult> {
  if (!reason || reason.trim().length < 10) return { ok: false, status: 400, error: 'cancellation requires a reason (min 10 chars)' }
  const a = await getAssignment(db, assignmentId, now)
  if (!a) return { ok: false, status: 404, error: 'assignment not found' }
  if (!OPEN_STATUSES.includes(a.status as AssignmentStatus)) return { ok: false, status: 409, error: `assignment is ${a.status} — only open assignments can be cancelled` }
  const updated = await db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'CANCELLED' } })
  await db.expertReviewAssignmentEvent.create({
    data: { assignmentId: a.id, eventType: 'CANCELLED', actorKind: 'ADMIN', actorId: admin.studentId, rationale: reason },
  })
  return { ok: true, assignment: updated }
}

export const reassignInputSchema = z.object({
  reason: z.string().min(10).max(1000),
  newReviewerProfileId: z.string().min(3).max(64),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict()

/**
 * Reassign: close the current assignment as REASSIGNED (reason recorded) and
 * create the replacement through the SAME eligibility gates as creation —
 * scope match, COI check and independence all re-run for the new reviewer.
 */
export async function reassignAssignment(
  db: AssignmentDb,
  admin: AssignmentAdminActor,
  assignmentId: string,
  input: unknown,
  resolveProfile: (profileId: string) => Promise<ReviewerProfileRow | null>,
  now: Date = new Date(),
): Promise<CreateAssignmentResult> {
  const parsed = reassignInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid reassignment: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const a = await getAssignment(db, assignmentId, now)
  if (!a) return { ok: false, status: 404, error: 'assignment not found' }
  if (!OPEN_STATUSES.includes(a.status as AssignmentStatus)) return { ok: false, status: 409, error: `assignment is ${a.status} — only open assignments can be reassigned` }
  const newProfile = await resolveProfile(parsed.data.newReviewerProfileId)
  if (!newProfile) return { ok: false, status: 404, error: 'new reviewer profile not found' }
  if (newProfile.id === a.reviewerProfileId) {
    return { ok: false, status: 409, error: 'reassignment to the same reviewer is a no-op — recuse or cancel instead' }
  }
  // Validate the replacement FIRST: if the new reviewer fails any gate (scope,
  // COI, independence) the original assignment stays open — the subject is
  // never left silently unassigned by a failed reassignment.
  const replacement = await createAssignment(db, admin, newProfile, {
    subjectType: a.subjectType,
    subjectKey: a.subjectKey,
    subjectVersion: a.subjectVersion ?? undefined,
    subjectChecksum: a.subjectChecksum ?? undefined,
    riskClass: a.riskClass ?? undefined,
    expiresAt: parsed.data.expiresAt,
    coiCheck: 'NONE_DECLARED',
  })
  if (!replacement.ok) return replacement
  const closed = await db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'REASSIGNED', reassignmentReason: parsed.data.reason } })
  await db.expertReviewAssignmentEvent.create({
    data: { assignmentId: a.id, eventType: 'REASSIGNED', actorKind: 'ADMIN', actorId: admin.studentId, rationale: parsed.data.reason, payload: JSON.stringify({ newReviewerProfileId: parsed.data.newReviewerProfileId, replacementAssignmentId: replacement.assignment.id }) },
  })
  return { ok: true, assignment: closed }
}

// ─── Submission hooks (called by the CI-5D/5E authoritative submit paths) ─────

/** Reviewer marks the decision submitted (ASSIGNED/IN_PROGRESS → SUBMITTED). */
export async function markAssignmentSubmitted(db: AssignmentDb, profile: ReviewerProfileRow, assignmentId: string, actorStudentId: string, now: Date = new Date()): Promise<CreateAssignmentResult> {
  const a = await getAssignment(db, assignmentId, now)
  if (!a) return { ok: false, status: 404, error: 'assignment not found' }
  const own = ownershipGuard(a, profile)
  if (own) return own
  if (!OPEN_STATUSES.includes(a.status as AssignmentStatus)) return { ok: false, status: 409, error: `assignment is ${a.status} — cannot submit` }
  const updated = await db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'SUBMITTED' } })
  await db.expertReviewAssignmentEvent.create({
    data: { assignmentId: a.id, eventType: 'SUBMITTED', actorKind: 'REVIEWER', actorId: actorStudentId, rationale: 'review decision submitted to the authoritative ledger' },
  })
  return { ok: true, assignment: updated }
}

/** Authoritative path recorded the decision → COMPLETED with outcomeRef. */
export async function markAssignmentCompleted(db: AssignmentDb, assignmentId: string, outcomeRef: string, now: Date = new Date()): Promise<CreateAssignmentResult> {
  const a = await getAssignment(db, assignmentId, now)
  if (!a) return { ok: false, status: 404, error: 'assignment not found' }
  if (a.status !== 'SUBMITTED') return { ok: false, status: 409, error: `assignment is ${a.status} — completion applies after SUBMITTED` }
  const updated = await db.expertReviewAssignment.update({ where: { id: a.id }, data: { status: 'COMPLETED', outcomeRef } })
  await db.expertReviewAssignmentEvent.create({
    data: { assignmentId: a.id, eventType: 'COMPLETED', actorKind: 'SYSTEM', actorId: 'system', rationale: 'authoritative decision ledger recorded the review outcome', payload: JSON.stringify({ outcomeRef }) },
  })
  return { ok: true, assignment: updated }
}

// ─── Disagreement detection (pure; used by CI-5D adjudication) ────────────────

export interface DisagreementResult {
  disagreement: boolean
  detail: string
  approvals: string[]
  objections: { decision: string; reviewerStudentId: string }[]
}

/**
 * Detect a disagreement among decisions bound to the SAME subject version:
 * at least one APPROVED alongside any REJECTED/CHANGES_REQUESTED/
 * RE_REVIEW_REQUESTED. Both opinions are preserved; the caller must never
 * average scores or silently prefer the favourable one — an independent
 * adjudicator assignment is the recorded resolution path.
 */
export function detectReviewDisagreement(
  reviews: readonly { decision: string; reviewerStudentId: string }[],
): DisagreementResult {
  const approvals = reviews.filter((r) => r.decision === 'APPROVED').map((r) => r.reviewerStudentId)
  const objections = reviews
    .filter((r) => ['REJECTED', 'CHANGES_REQUESTED', 'RE_REVIEW_REQUESTED'].includes(r.decision))
    .map((r) => ({ decision: r.decision, reviewerStudentId: r.reviewerStudentId }))
  const disagreement = approvals.length > 0 && objections.length > 0
  return {
    disagreement,
    detail: disagreement
      ? `${approvals.length} approval(s) vs ${objections.length} objection(s) on the same subject version — both opinions preserved; independent adjudication required before any publication path proceeds`
      : 'no disagreement among recorded decisions',
    approvals,
    objections,
  }
}

export async function listAssignmentEvents(db: AssignmentDb, assignmentId: string): Promise<AssignmentEventRow[]> {
  return db.expertReviewAssignmentEvent.findMany({ where: { assignmentId }, orderBy: { createdAt: 'asc' as const } })
}
