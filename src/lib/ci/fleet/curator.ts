// ─── BEAN Classroom Intelligence (CI-4C): domain-pack curation & human review ─
// The authorised curation workflow (charter §6.4 + CI-4 mission §6, §12).
//
// Hard rules encoded here (structurally, not by convention):
//  • Only an authenticated ADMIN session can record a review decision — the
//    API route resolves the reviewer identity SERVER-SIDE. Benchmarks, CI
//    workflows and agents have no session and therefore no path to this code.
//  • Every decision is append-only (Prisma ClassroomPackReview) and bound to
//    the EXACT pack checksum the reviewer inspected — a decision can never
//    silently apply to a changed version.
//  • VERIFIED is a DERIVED state: `resolveCuratedStatus` computes it from the
//    pack + recorded human approvals. HIGH_STAKES packs need TWO DISTINCT
//    reviewer approvals (risk-specific stronger review, charter §14 posture).
//    No machine path creates, edits or deletes review rows.
//  • REJECTED is terminal for the reviewed version — a new pack version
//    restarts review; the rejection row stays for the audit trail.
//  • A reviewer cannot approve a source licence on behalf of its rights
//    holder: review decisions never mutate source records (source licence
//    changes are owner-level code changes, recorded in git).

import { z } from 'zod'
import { PACK_STATUS, PACK_REVIEW_DECISION, type PackStatus, type PackReviewDecision } from './constants'
import { getDomainPack, listDomainPacks, computePackChecksum, dispatchableDomainPacks, type DomainPack } from './domain-packs'
import { ensurePackSourcesRegistered } from './packs/sources'

// ─── Decision input ───────────────────────────────────────────────────────────

/**
 * Minimal structural view of the Prisma client this module needs. The route
 * passes the real shared client; tests pass an equivalent. (Methods are
 * declared with loose arg types so both Prisma's typed client and test fakes
 * satisfy it structurally.)
 */
export interface CuratorDb {
  classroomPackReview: {
    // Method syntax (not property arrows) keeps these assignable from both the
    // real Prisma client's typed methods and the tests' fakes (bivariance).
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
    findMany(args?: Record<string, unknown>): Promise<PackReviewRow[]>
  }
}

/**
 * Adapter from the shared Prisma client to the structural CuratorDb view.
 * The typed Prisma client and this narrow structural view differ only in
 * declaration shape (the underlying rows are the same) — this adapter is the
 * single, documented place where that impedance is bridged; every other
 * module (and every test) works with CuratorDb directly.
 */
export function curatorDbFromPrisma(client: unknown): CuratorDb {
  return client as CuratorDb
}

export const packReviewInputSchema = z.object({
  packId: z.string().min(3).max(80),
  packVersion: z.string().min(1).max(40),
  packChecksum: z.string().min(16).max(64),
  decision: z.enum(Object.values(PACK_REVIEW_DECISION) as [PackReviewDecision, ...PackReviewDecision[]]),
  rationale: z.string().min(20).max(2000),
  evidence: z.string().min(20).max(2000),
}).strict()
export type PackReviewInput = z.infer<typeof packReviewInputSchema>

export interface ReviewerIdentity {
  /** Server-resolved ADMIN Student.id — never taken from the request body. */
  studentId: string
  /** Display-name snapshot for the audit trail. */
  displayName: string
}

export type PackReviewRow = {
  id: string
  packId: string
  packVersion: string
  packChecksum: string
  riskClass: string
  decision: PackReviewDecision
  reviewerStudentId: string
  reviewerName: string
  rationale: string
  evidence: string
  createdAt: Date
}

// ─── Pure status resolution (the VERIFIED gate is human-decision-derived) ────

export interface CuratedStatusResult {
  status: PackStatus
  explanation: string
  /** Distinct reviewers who APPROVED the exact reviewed checksum. */
  approvalsRecorded: number
  /** Approvals required for this risk class (2 for HIGH_STAKES). */
  approvalsRequired: number
  /** Any terminal rejection recorded against this checksum. */
  rejected: boolean
  /** Work-state signals recorded against this checksum. */
  changesRequested: boolean
  reReviewRequested: boolean
}

/**
 * Resolve the authoritative curated status of one pack version from recorded
 * human decisions. Pure: same pack + same rows ⇒ same verdict.
 *
 * Rules:
 *  - decisions bind to packId + packVersion + packChecksum (exact);
 *  - any REJECTED → REJECTED (terminal until a new version is registered);
 *  - otherwise VERIFIED when distinct-approver count ≥ required
 *    (1, or 2 for HIGH_STAKES) AND the pack itself passes the machine gates
 *    (the caller must have validated the pack — the route does);
 *  - otherwise the pack's declared status stands (DRAFT/IN_REVIEW).
 */
export function resolveCuratedStatus(
  pack: DomainPack,
  reviews: readonly PackReviewRow[],
): CuratedStatusResult {
  const checksum = computePackChecksum(pack)
  const bound = reviews.filter((r) => r.packId === pack.domainId && r.packVersion === pack.packVersion && r.packChecksum === checksum)
  const approvals = new Set(bound.filter((r) => r.decision === PACK_REVIEW_DECISION.APPROVED).map((r) => r.reviewerStudentId))
  const rejected = bound.some((r) => r.decision === PACK_REVIEW_DECISION.REJECTED)
  const changesRequested = bound.some((r) => r.decision === PACK_REVIEW_DECISION.CHANGES_REQUESTED)
  const reReviewRequested = bound.some((r) => r.decision === PACK_REVIEW_DECISION.RE_REVIEW_REQUESTED)
  const approvalsRequired = pack.riskClass === 'HIGH_STAKES' ? 2 : 1

  if (rejected) {
    return {
      status: PACK_STATUS.REJECTED,
      explanation: `a human curator REJECTED version ${pack.packVersion} (checksum ${checksum.slice(0, 12)}…) — terminal for this version; a new pack version restarts review and the rejection stays in the audit trail`,
      approvalsRecorded: approvals.size,
      approvalsRequired,
      rejected,
      changesRequested,
      reReviewRequested,
    }
  }
  if (approvals.size >= approvalsRequired) {
    return {
      status: PACK_STATUS.VERIFIED,
      explanation: `${approvals.size} distinct human approval${approvals.size === 1 ? '' : 's'} recorded for checksum ${checksum.slice(0, 12)}… (required ${approvalsRequired}) — human publication gate satisfied${pack.riskClass === 'HIGH_STAKES' ? ' for a HIGH_STAKES domain (two-reviewer rule)' : ''}`,
      approvalsRecorded: approvals.size,
      approvalsRequired,
      rejected,
      changesRequested,
      reReviewRequested,
    }
  }
  const workNote = changesRequested || reReviewRequested
    ? ` · work state recorded: ${[changesRequested ? 'CHANGES_REQUESTED' : null, reReviewRequested ? 'RE_REVIEW_REQUESTED' : null].filter(Boolean).join(', ')}`
    : ''
  return {
    status: pack.status === PACK_STATUS.VERIFIED ? PACK_STATUS.IN_REVIEW : pack.status,
    explanation: `${approvals.size}/${approvalsRequired} distinct human approval${approvalsRequired === 1 ? '' : 's'} recorded for checksum ${checksum.slice(0, 12)}… — pack remains ${pack.status === PACK_STATUS.VERIFIED ? 'IN_REVIEW (declared VERIFIED without recorded approvals is refused)' : pack.status}${workNote}`,
    approvalsRecorded: approvals.size,
    approvalsRequired,
    rejected,
    changesRequested,
    reReviewRequested,
  }
}

// ─── Recording a decision (the only write path; DB append-only) ──────────────

export type RecordReviewResult =
  | { ok: true; reviewId: string; curatedStatus: CuratedStatusResult }
  | { ok: false; status: number; error: string }

/**
 * Validate + append a curator decision. Called by the admin API route AFTER
 * requireAdmin() resolved the reviewer identity server-side. The reviewer
 * identity in `reviewer` NEVER comes from the request body.
 *
 * PrismaClient is injected (the module is used from route handlers where the
 * shared `db` client is imported; tests pass an isolated client).
 */
export async function recordPackReview(
  db: CuratorDb,
  reviewer: ReviewerIdentity,
  input: unknown,
): Promise<RecordReviewResult> {
  ensurePackSourcesRegistered()
  const parsed = packReviewInputSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, status: 400, error: `invalid review: ${first?.path.join('.') ?? '?'} — ${first?.message ?? 'schema mismatch'}` }
  }
  const data = parsed.data
  const entry = getDomainPack(data.packId)
  if (!entry) {
    return { ok: false, status: 404, error: `unknown pack: ${data.packId}` }
  }
  // The decision must bind to the pack content AS IT EXISTS NOW — a decision
  // recorded against a stale checksum would be meaningless (and could be a
  // downgrade of a newer version). Honest refusal, no silent rebinding.
  if (data.packVersion !== entry.pack.packVersion) {
    return { ok: false, status: 409, error: `pack ${data.packId} is at version ${entry.pack.packVersion}, not ${data.packVersion} — re-inspect and re-submit for the current version` }
  }
  const currentChecksum = computePackChecksum(entry.pack)
  if (data.packChecksum !== currentChecksum) {
    return { ok: false, status: 409, error: `checksum mismatch for ${data.packId}: the pack content changed since it was inspected — re-inspect and re-submit` }
  }
  const created = await db.classroomPackReview.create({
    data: {
      packId: data.packId,
      packVersion: data.packVersion,
      packChecksum: data.packChecksum,
      riskClass: entry.pack.riskClass,
      decision: data.decision,
      reviewerStudentId: reviewer.studentId,
      reviewerName: reviewer.displayName,
      rationale: data.rationale,
      evidence: data.evidence,
    },
  })
  const reviews = await listPackReviews(db, data.packId)
  return { ok: true, reviewId: created.id, curatedStatus: resolveCuratedStatus(entry.pack, reviews) }
}

/** Append-only read: every recorded decision for one pack (oldest first). */
export async function listPackReviews(db: CuratorDb, packId: string): Promise<PackReviewRow[]> {
  const rows = await db.classroomPackReview.findMany({
    where: { packId },
    orderBy: { createdAt: 'asc' as const },
  })
  return rows as PackReviewRow[]
}

// ─── Curated summaries (admin inspection surface) ────────────────────────────

export interface CuratedPackSummary {
  domainId: string
  title: string
  riskClass: string
  declaredStatus: PackStatus
  curatedStatus: PackStatus
  explanation: string
  approvalsRecorded: number
  approvalsRequired: number
  packVersion: string
  checksum: string
  sourceCount: number
  fixtureCount: number
  reviewCount: number
}

/**
 * Every registered pack with its curated status. Reviews are fetched per pack
 * (the registry is small — 12 packs; a cross-join is unnecessary).
 */
export async function curatedPackSummaries(db: CuratorDb): Promise<CuratedPackSummary[]> {
  ensurePackSourcesRegistered()
  const out: CuratedPackSummary[] = []
  for (const { pack, checksum } of listDomainPacks()) {
    const reviews = await listPackReviews(db, pack.domainId)
    const curated = resolveCuratedStatus(pack, reviews)
    out.push({
      domainId: pack.domainId,
      title: pack.title,
      riskClass: pack.riskClass,
      declaredStatus: pack.status,
      curatedStatus: curated.status,
      explanation: curated.explanation,
      approvalsRecorded: curated.approvalsRecorded,
      approvalsRequired: curated.approvalsRequired,
      packVersion: pack.packVersion,
      checksum,
      sourceCount: pack.sources.length,
      fixtureCount: pack.benchmark?.fixtureRefs.length ?? 0,
      reviewCount: reviews.length,
    })
  }
  return out
}

/**
 * Dispatch-time pack resolution: the machine gate (dispatchableDomainPacks)
 * AND the human gate (curated status) must both pass. A pack the curator
 * REJECTED — or whose approvals are insufficient for its risk class — never
 * dispatches, no matter what the declared status says. The dispatcher adopts
 * this as its pack source in CI-4E/4G.
 */
export function curatedDispatchablePacks(
  reviews: readonly PackReviewRow[],
): { pack: DomainPack; checksum: string; underReview: boolean; curatedStatus: PackStatus }[] {
  const out: { pack: DomainPack; checksum: string; underReview: boolean; curatedStatus: PackStatus }[] = []
  for (const entry of dispatchableDomainPacks()) {
    const curated = resolveCuratedStatus(entry.pack, reviews)
    if (curated.status !== PACK_STATUS.VERIFIED && curated.status !== PACK_STATUS.IN_REVIEW) continue
    out.push({ pack: entry.pack, checksum: entry.checksum, underReview: entry.underReview, curatedStatus: curated.status })
  }
  return out
}
